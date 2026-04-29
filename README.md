# 🌌 NexusChat AI Workspace

NexusChat is a state-of-the-art, full-stack Agentic Chat Workspace. It transforms a standard real-time MERN messaging application into a powerful, omniscient AI environment using **LangGraph**, **ChromaDB**, and **Corrective RAG (CRAG)** architectures.

![NexusChat Preview](client/public/logo_icon.svg)

---

## ✨ Core Features

### 1. 🤖 Dynamic AI Personas
*   **The Co-Pilot**: Tag `@AI` in any human-to-human chat room. The AI will observe the conversation context and instantly stream a helpful response.
*   **The Dedicated Assistant**: Click on the permanent **Nexus AI Co-Pilot** user in your sidebar for a private, 1-on-1 ChatGPT-style conversation. The AI dynamically swaps its system prompts based on which role it is fulfilling.

### 2. 🧠 Omniscient Memory & Persistence
*   **Thread Checkpointing**: Powered by **LangGraph `AsyncPostgresSaver`** connected to a Neon cloud PostgreSQL database. The AI never forgets a conversation; thread histories are perfectly maintained across sessions.
*   **Vector "Eavesdropping"**: Every human-to-human message sent is secretly intercepted by a Node.js background process, forwarded to a Python FastAPI service, and securely embedded into a local **ChromaDB** Vector Database. 

### 3. 📚 Corrective RAG (CRAG) Pipeline
Built on the rigorous mathematical bounds of the Yan et al. (2024) research paper, NexusChat's knowledge retrieval is incredibly robust:
*   **PDF Knowledge Base**: Upload PDFs directly through the UI. The FastAPI server chunks and embeds the document.
*   **The Grader**: When you ask a question, the agent retrieves documents and uses a custom LangChain LLM-Grader.
    *   `Score >= 0.7 (CORRECT)`: Answers using strictly local vector documents.
    *   `Score < 0.3 (INCORRECT)`: Discards local context and falls back completely to live **Tavily Web Search**.
    *   `0.3 <= Score < 0.7 (AMBIGUOUS)`: Combines local vector knowledge with Tavily Web Search to generate the best possible answer.

### 4. 🛠️ Real-World Tooling (MCP Integration)
The LangGraph agent is wired into a **Model Context Protocol (MCP)** manager. It has live, sandboxed access to local machine filesystems and GitHub, allowing it to retrieve codebase snippets, analyze local files, and execute developer workflows directly from the chat UI!

### 5. ⚡ Real-Time Streaming Architecture
No waiting for long API calls. The Python FastAPI service yields chunks of AI responses instantly. The Node.js server intercepts these streams and pushes them to the React frontend via custom `Socket.io` events, rendering the AI's thoughts token-by-token.

---

## 💻 Technology Stack

### Frontend (Client)
*   **Framework**: React 18 + Vite
*   **Styling**: Tailwind CSS v4, Glassmorphism UI
*   **State & Real-time**: Context API, Socket.io-client
*   **Typography**: Google Fonts (Inter, Outfit)

### Main Backend (Node.js)
*   **Server**: Express.js, Node.js
*   **Database**: MongoDB Atlas (via Mongoose)
*   **Real-time Communication**: Socket.io
*   **Media Storage**: Cloudinary (Image uploads)

### AI Microservice (Python)
*   **Framework**: FastAPI, Uvicorn
*   **Orchestration**: LangChain, LangGraph
*   **Memory Checkpointer**: PostgreSQL (Neon via `psycopg` & `langgraph-checkpoint-postgres`)
*   **Vector Store**: ChromaDB
*   **Search Fallback**: Tavily API
*   **Observability**: LangSmith

---

## 🏗️ Architecture Flow

1.  **Human Chat**: User A sends a message to User B.
2.  **Storage**: Node.js saves to MongoDB and emits to User B via Socket.io.
3.  **Eavesdropper Sync**: Node.js asynchronously fires a POST request to `FastAPI:8000/api/embed`.
4.  **Vectorization**: Python embeds the text into ChromaDB, tagging it with `chat_id`.
5.  **AI Invocation**: User A types `@AI what did we talk about?`.
6.  **Streaming**: Node.js calls `FastAPI:8000/api/chat/stream` with `role="copilot"`.
7.  **Reasoning**: LangGraph state machine triggers. Agent recognizes the need for context and calls the `search_knowledge` tool.
8.  **CRAG Evaluation**: Vector DB is searched. Results are graded. If poor, Tavily web search is fired.
9.  **Token Yield**: Agent generates final answer, streaming chunks back to Node.js, which are pushed to React via WebSockets.

---

## 🚀 How to Run Locally

### 1. Start the React Frontend
```bash
cd client
npm install
npm run dev
```

### 2. Start the Node.js Backend
```bash
cd server
npm install
npm run server
```

### 3. Start the Python AI Service
```bash
cd ai_service
# Ensure your virtual environment is active (.venv/Scripts/activate)
uvicorn main:app --reload --port 8000
```
