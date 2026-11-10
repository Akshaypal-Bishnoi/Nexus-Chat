# NexusChat AI Agent — Architecture & System Design (`design.md`)

## 1. Executive Summary

This document outlines the architectural decisions and engineering specifications for the **NexusChat AI Agent**, designed to satisfy the core tenets of high-performance conversational agents:
1. **Low Latency (<500ms TTFB)**: Token-level Server-Sent Events (SSE) bridged asynchronously to WebSockets.
2. **Factual Correctness ("Get Things Right")**: Evaluated Web Search with a Corrective RAG (CRAG) grading harness to eliminate hallucination.
3. **Stateful Temporal Memory ("Remember What & When")**: Dual-tier memory via persistent PostgreSQL state checkpointing (exact conversational history) coupled with vector embeddings for long-term semantic recall.

---

## 2. High-Level System Architecture

The agent is decoupled into a dual-microservice topology to isolate compute-intensive LLM workflows from high-throughput client connections:

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Layer                           │
│  React.js (Vite) + Socket.IO Client + Optimistic UI Updates │
└──────────────────────────────┬──────────────────────────────┘
                               │ WebSocket (Bi-directional)
┌──────────────────────────────▼──────────────────────────────┐
│                  Gateway & Real-time Layer                  │
│               Node.js + Express + Socket.IO                 │
│  - Session authentication & JWT validation                  │
│  - Instant event routing & 3-state read receipts            │
│  - Real-time token streaming bridge                         │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP POST (SSE Stream)
┌──────────────────────────────▼──────────────────────────────┐
│                    AI Orchestration Core                    │
│                 Python FastAPI + LangGraph                  │
│  - Cyclic StateGraph workflow execution                     │
│  - Dynamic tool routing & execution harness                 │
│  - Lazy-pooled Async Postgres Checkpointer                  │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
    ┌──────────▼──────────┐        ┌──────────▼──────────┐
    │  Web Search Engine  │        │   Memory Storage    │
    │  - Tavily Search    │        │  - PostgreSQL State │
    │  - Relevance Grader │        │  - ChromaDB Vectors │
    └─────────────────────┘        └─────────────────────┘
```

---

## 3. Core Requirements Breakdown

### 3.1. Web Search & Correctness ("Get Things Right")

Rather than allowing an LLM to hallucinate or blindly stuffing web results into the prompt, the agent uses an **Evaluator-Grader Search Harness** powered by Tavily and LangGraph:

1. **Query Formulation**: The agent identifies information gaps and triggers the search tool.
2. **Document Relevance Grading**: Retrieved chunks/snippets are evaluated using a structured output grader (`gpt-4o-mini` with temperature=0) yielding a normalized relevance score $S \in [0.0, 1.0]$.
3. **Dynamic Routing**:
   - **$S \ge 0.7$ (Correct)**: Context is certified high-confidence; response is synthesized directly.
   - **$0.3 \le S < 0.7$ (Ambiguous)**: Local knowledge is augmented with real-time Tavily web search.
   - **$S < 0.3$ (Irrelevant/Stale)**: Local assumptions are discarded; Tavily web search is executed to retrieve verified, real-time ground truth.

This ensures the agent grounds answers on factual, up-to-date web data with zero unverified assumptions.

---

### 3.2. Latency & Speed Optimization ("Answer Fast")

LLM agent tool executions are inherently slow. To provide an instantaneous user experience:
- **Token-Level Streaming**: Responses are streamed via `StreamingResponse(generate(), media_type="text/plain")` from the FastAPI engine to the Node.js gateway, and immediately piped through Socket.IO (`socket.emit("updateMessage")`) down to the React frontend.
- **Time-to-First-Byte (TTFB)**: First token arrives in **<500ms**, eliminating perceived wait time.
- **Lazy Connection Pooling**: Neon PostgreSQL pools are initiated with `min_size=0, max_size=5` and lazy async opening to avoid cold-start blocking during container startup.

---

### 3.3. Memory Architecture ("Remember What You Asked and When")

The agent solves the temporal context problem through a two-tiered memory mechanism:

#### A. Exact Session Checkpointing (LangGraph `AsyncPostgresSaver`)
- Every interaction in a thread is serialized into a PostgreSQL state store indexed by `thread_id` (the chat/session identifier).
- State captures:
  - Exact user inputs with absolute UTC timestamps.
  - Intermediate tool calls and search arguments.
  - Final responses.
- Allows the agent to accurately reference: *"What did I ask 10 minutes ago?"* or *"When did we check the latest stock price?"*

#### B. Passive Long-Term Semantic Memory (ChromaDB Vector Store)
- Conversations are asynchronously vectorized using a fire-and-forget pattern.
- Stored vectors contain metadata: `{ chat_id, sender_id, timestamp, source: "chat" }`.
- Even after active context windows roll over, the agent can semantically recall past preferences, promises, and topics discussed across previous days.

---

## 4. Key Architectural Trade-offs & Decisions

| Decision | Chosen Approach | Alternative Considered | Why |
|---|---|---|---|
| **Agent Orchestration** | LangGraph StateGraph | Linear LangChain Chains | LangGraph natively supports cyclic graphs (agent decides to search, re-evaluate, or answer), state checkpointing, and interruptibility. |
| **Search Engine** | Tavily Search API | Generic Google/SerpAPI | Tavily is optimized for agentic pipelines, returning clean, markdown-stripped snippets with citations rather than raw HTML. |
| **Real-time Transport** | SSE (Python) $\rightarrow$ WebSocket (Node) | Pure WebSockets throughout | SSE is stateless, HTTP/2-friendly, and naturally handles streaming LLM chunks without WebSocket handshake overhead on the AI service. |
| **Persistence** | PostgreSQL (`AsyncPostgresSaver`) | In-memory `MemorySaver` | Ephemeral memory disappears when server restarts. Postgres guarantees state durability across deploys and crashes. |

---

## 5. Repository Structure

```
├── ai_service/
│   ├── main.py            # FastAPI entry point, lifespan, SSE streaming endpoint
│   ├── agent.py           # LangGraph StateGraph, ToolNode, agent prompt definitions
│   ├── crag_tool.py       # Search harness: Tavily integration + LLM relevance grading
│   ├── mcp_manager.py     # Protocol manager for extended tool execution
│   └── requirements.txt   # Core Python dependencies
├── server/
│   ├── controllers/       # Message and chat orchestration
│   ├── models/            # MongoDB schemas (messages, users, groups)
│   └── server.js          # Socket.IO gateway, JWT auth, SSE-to-WebSocket bridge
├── client/
│   ├── src/               # React (Vite) UI, chat windows, message streams
│   └── context/           # Context API for real-time state management
└── design.md              # System design document
```

