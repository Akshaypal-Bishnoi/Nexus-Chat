import os
import sys
import asyncio

# Fix for Windows: psycopg (async Postgres driver) requires SelectorEventLoop
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from agent import init_mcp, create_agent_graph, mcp_manager

load_dotenv()

# Global graph instance & checkpointer
agent_app = None
checkpointer = None

class ChatRequest(BaseModel):
    message: str
    user_id: str
    chat_id: str
    role: str = "copilot"

class EmbedRequest(BaseModel):
    text: str
    chat_id: str
    sender_id: str

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handles startup and shutdown with proper async context management."""
    global agent_app, checkpointer

    print("🚀 Starting up NexusChat AI Service...")
    
    POSTGRES_URI = os.getenv("POSTGRES_DB_URI")
    if not POSTGRES_URI:
        raise RuntimeError("POSTGRES_DB_URI is not set in .env!")

    # Create the async Postgres checkpointer and set up the DB tables
    async with AsyncPostgresSaver.from_conn_string(POSTGRES_URI) as saver:
        await saver.setup()  # Creates the langgraph checkpoint tables automatically
        checkpointer = saver
        
        print("✅ PostgreSQL checkpointer connected and ready!")
        
        # Initialize MCP tools and compile agent with the checkpointer
        llm, tools = await init_mcp()
        graph = create_agent_graph(llm, tools)
        agent_app = graph.compile(checkpointer=checkpointer)
        
        print("✅ AI Agent compiled with persistent memory!")
        
        yield  # Server runs here
        
        # Shutdown
        print("🛑 Shutting down AI Service...")
        await mcp_manager.cleanup()

app = FastAPI(title="NexusChat AI Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {"status": "ok", "agent_ready": agent_app is not None}

@app.post("/api/upload_pdf")
async def upload_pdf(file: UploadFile = File(...)):
    import shutil
    import os
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")
        
    temp_path = f"temp_{file.filename}"
    try:
        # Save file locally temporarily
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Process and store in Chroma
        from crag_tool import process_and_store_pdf
        chunks = process_and_store_pdf(temp_path, file.filename)
        
        return {"status": "success", "message": f"Successfully learned from {file.filename} ({chunks} chunks)."}
    except Exception as e:
        print(f"PDF Upload Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Cleanup temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.post("/api/embed")
async def embed_message(req: EmbedRequest):
    """Eavesdropper endpoint: receives normal chat messages and adds them to ChromaDB"""
    try:
        from crag_tool import vector_store
        from langchain_core.documents import Document
        
        doc = Document(
            page_content=req.text,
            metadata={"chat_id": req.chat_id, "sender_id": req.sender_id, "source": "chat"}
        )
        vector_store.add_documents([doc])
        return {"status": "success"}
    except Exception as e:
        print(f"Embedding error: {e}")
        return {"status": "error", "detail": str(e)}

@app.post("/api/chat/stream")
async def chat_stream_endpoint(req: ChatRequest):
    global agent_app
    if not agent_app:
        raise HTTPException(status_code=503, detail="Agent not ready")

    async def generate():
        try:
            inputs = {"messages": [HumanMessage(content=req.message)]}
            # thread_id is per-chat-room, so each conversation has its own memory!
            # We also pass the role so the agent knows which persona to use.
            config = {"configurable": {"thread_id": req.chat_id, "role": req.role}}
            
            async for msg, metadata in agent_app.astream(inputs, stream_mode="messages", config=config):
                if msg.content and metadata.get("langgraph_node") == "agent":
                    yield msg.content
        except Exception as e:
            print(f"Error in stream: {e}")
            yield f"\n[Error: {str(e)}]"

    return StreamingResponse(generate(), media_type="text/plain")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, loop="asyncio")
