import os
import sys
import asyncio
import traceback

# Fix for Windows: psycopg (async Postgres driver) requires SelectorEventLoop
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8')

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from langchain_core.messages import HumanMessage

load_dotenv()

# ── Global State ──
agent_app = None
_init_task = None
_last_error = None

class ChatRequest(BaseModel):
    message: str
    user_id: str
    chat_id: str
    role: str = "copilot"

class EmbedRequest(BaseModel):
    text: str
    chat_id: str
    sender_id: str

class GroupSummaryRequest(BaseModel):
    chat_history: str
    group_name: str
    new_member_name: str

# ── Initialization with Retry ──
MAX_RETRIES = 10
RETRY_DELAY = 15  # seconds between retries

async def init_agent():
    """Initialize the AI agent. Retries up to MAX_RETRIES times if anything fails."""
    global agent_app, _last_error

    POSTGRES_URI = os.getenv("POSTGRES_DB_URI")
    if not POSTGRES_URI:
        _last_error = "POSTGRES_DB_URI not set!"
        print(f"🚨 {_last_error}")
        return

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"\n🔄 Init attempt {attempt}/{MAX_RETRIES}...")
            _last_error = None

            # Step 1: Connect to Neon DB (with retry-friendly settings)
            print("  → Connecting to Neon PostgreSQL...")
            from psycopg_pool import AsyncConnectionPool
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

            pool = AsyncConnectionPool(
                conninfo=POSTGRES_URI,
                min_size=0,       # DON'T eagerly connect — Neon might be asleep
                max_size=5,
                max_idle=240.0,
                timeout=30.0,
                kwargs={"autocommit": True, "prepare_threshold": 0},
            )
            await pool.open()     # opens lazily since min_size=0
            
            saver = AsyncPostgresSaver(conn=pool)
            await saver.setup()
            print("  ✅ PostgreSQL checkpointer ready.")

            # Step 2: Build the agent
            print("  → Building AI agent...")
            from agent import init_mcp, create_agent_graph
            llm, tools = await init_mcp()
            graph = create_agent_graph(llm, tools)
            agent_app = graph.compile(checkpointer=saver)

            print(f"✅ AI Agent is LIVE! (attempt {attempt})")
            return  # success

        except Exception as e:
            _last_error = f"Attempt {attempt}: {e}"
            print(f"❌ Attempt {attempt} failed: {e}")
            traceback.print_exc()
            if attempt < MAX_RETRIES:
                print(f"   Retrying in {RETRY_DELAY}s...")
                await asyncio.sleep(RETRY_DELAY)
            else:
                print("🚨 All init attempts exhausted. /chat will return 503.")

# ── Lifespan ──
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _init_task

    print("🚀 Starting NexusChat AI Service...")

    # Launch init entirely in background — no pool, no DB, nothing blocking here.
    # This guarantees FastAPI binds to the port in <1 second so Render never kills us.
    _init_task = asyncio.create_task(init_agent())

    yield  # server is running

    # Shutdown
    print("🛑 Shutting down...")
    try:
        from agent import mcp_manager
        await mcp_manager.cleanup()
    except Exception:
        pass

app = FastAPI(title="NexusChat AI Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Endpoints ──

@app.get("/health")
async def health_check():
    return {
        "status": "awake",
        "agent_ready": agent_app is not None,
        "last_error": _last_error,
    }

@app.post("/api/upload_pdf")
async def upload_pdf(file: UploadFile = File(...)):
    import shutil
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    temp_path = f"temp_{file.filename}"
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        from crag_tool import process_and_store_pdf
        chunks = process_and_store_pdf(temp_path, file.filename)
        return {"status": "success", "message": f"Learned from {file.filename} ({chunks} chunks)."}
    except Exception as e:
        print(f"PDF Upload Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.post("/api/embed")
async def embed_message(req: EmbedRequest):
    """Receives normal chat messages and adds them to ChromaDB."""
    try:
        from crag_tool import get_vector_store
        from langchain_core.documents import Document

        doc = Document(
            page_content=req.text,
            metadata={"chat_id": req.chat_id, "sender_id": req.sender_id, "source": "chat"}
        )
        get_vector_store().add_documents([doc])
        return {"status": "success"}
    except Exception as e:
        print(f"Embedding error: {e}")
        return {"status": "error", "detail": str(e)}

@app.post("/api/chat/stream")
async def chat_stream_endpoint(req: ChatRequest):
    # Wait up to 120 seconds for the agent (covers retries + Neon wake-up)
    for _ in range(120):
        if agent_app is not None:
            break
        await asyncio.sleep(1)

    if not agent_app:
        raise HTTPException(
            status_code=503,
            detail=f"Agent not ready. Last error: {_last_error}"
        )

    async def generate():
        try:
            inputs = {"messages": [HumanMessage(content=req.message)]}
            config = {"configurable": {"thread_id": req.chat_id, "role": req.role}}

            async for msg, metadata in agent_app.astream(inputs, stream_mode="messages", config=config):
                if msg.content and metadata.get("langgraph_node") == "agent":
                    yield msg.content
        except Exception as e:
            print(f"Stream error: {e}")
            yield f"\n[Error: {str(e)}]"

    return StreamingResponse(generate(), media_type="text/plain")

@app.post("/api/group/summary")
async def generate_group_summary(req: GroupSummaryRequest):
    """Generate a concise summary of group chat history for a new member."""
    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import HumanMessage as SummaryMessage

        llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.3)

        prompt = f"""Summarize this group chat "{req.group_name}" for {req.new_member_name} who just joined.

Cover:
1. **Main Topics** — What was discussed?
2. **Key Decisions** — Any conclusions or agreements?
3. **Action Items** — Pending tasks or follow-ups?
4. **Active Members** — Who contributed most?

Max 300 words. Be friendly and welcoming.

Chat History:
{req.chat_history}"""

        response = await llm.ainvoke([SummaryMessage(content=prompt)])
        return {"summary": response.content}
    except Exception as e:
        print(f"Summary generation error: {e}")
        return {"summary": f"Could not generate summary: {str(e)}"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    host = "0.0.0.0" if os.environ.get("RENDER") else "127.0.0.1"
    uvicorn.run("main:app", host=host, port=port, reload=not os.environ.get("RENDER"))
