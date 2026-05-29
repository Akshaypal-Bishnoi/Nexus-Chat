import os
import sys
import asyncio

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
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg_pool import AsyncConnectionPool

load_dotenv()

# Global State 
agent_app = None
pool = None
_init_task = None  # strong reference so GC doesn't kill it

class ChatRequest(BaseModel):
    message: str
    user_id: str
    chat_id: str
    role: str = "copilot"

class EmbedRequest(BaseModel):
    text: str
    chat_id: str
    sender_id: str

# Initialization with Retry
MAX_RETRIES = 10
RETRY_DELAY = 10  # seconds between retries

async def init_agent(pg_pool):
    """Initialize the AI agent. Retries up to MAX_RETRIES times if anything fails."""
    global agent_app

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"\n🔄 Initialization attempt {attempt}/{MAX_RETRIES}...")

            # Step 1: Connect checkpointer to Neon DB
            print("  → Connecting to Neon PostgreSQL...")
            saver = AsyncPostgresSaver(conn=pg_pool)
            await saver.setup()
            print("  ✅ PostgreSQL checkpointer ready.")

            # Step 2: Build agent (imports crag_tool lazily so module-level errors are caught here)
            print("  → Building AI agent graph...")
            from agent import init_mcp, create_agent_graph
            llm, tools = await init_mcp()
            graph = create_agent_graph(llm, tools)
            agent_app = graph.compile(checkpointer=saver)

            print(f"✅ AI Agent is LIVE! (attempt {attempt})")
            return  # success — exit the retry loop

        except Exception as e:
            print(f"❌ Attempt {attempt} failed: {e}")
            if attempt < MAX_RETRIES:
                print(f"   Retrying in {RETRY_DELAY}s...")
                await asyncio.sleep(RETRY_DELAY)
            else:
                print("🚨 All initialization attempts failed. The /chat endpoint will return 503.")

# Lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    global pool, _init_task

    print("🚀 Starting NexusChat AI Service...")

    POSTGRES_URI = os.getenv("POSTGRES_DB_URI")
    if not POSTGRES_URI:
        raise RuntimeError("POSTGRES_DB_URI is not set!")

    pool = AsyncConnectionPool(
        conninfo=POSTGRES_URI,
        max_size=10,
        max_idle=240.0,
        kwargs={"autocommit": True, "prepare_threshold": 0},
    )

    async with pool:
        # Launch init in background so FastAPI binds to port immediately (Render won't kill us)
        _init_task = asyncio.create_task(init_agent(pool))

        yield  # server is running

        # Shutdown
        print("🛑 Shutting down...")
        from agent import mcp_manager
        await mcp_manager.cleanup()

app = FastAPI(title="NexusChat AI Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

#Endpoints

@app.get("/health")
async def health_check():
    return {"status": "awake", "agent_ready": agent_app is not None}

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
    # Wait up to 90 seconds for the agent to finish initializing (covers retries)
    for _ in range(90):
        if agent_app is not None:
            break
        await asyncio.sleep(1)

    if not agent_app:
        raise HTTPException(status_code=503, detail="Agent is still starting up. Please try again in a minute.")

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
