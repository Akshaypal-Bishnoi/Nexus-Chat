import os
from pydantic import BaseModel, Field
from langchain_core.tools import tool
from langchain_core.documents import Document

# Lazy Singletons
# These are created on first use, NOT at import time.
# This prevents the entire service from crashing if an API key is momentarily unavailable.

_vector_store = None
_retriever = None
_retrieval_grader = None
_web_search_tool = None


def _get_vector_store():
    global _vector_store
    if _vector_store is None:
        from langchain_openai import OpenAIEmbeddings
        from langchain_chroma import Chroma
        _vector_store = Chroma(
            collection_name="nexuschat_knowledge",
            embedding_function=OpenAIEmbeddings(),
            persist_directory="./chroma_db",
        )
    return _vector_store

# Public accessor for the /api/embed endpoint
vector_store = property(lambda self: _get_vector_store())


def _get_retriever():
    global _retriever
    if _retriever is None:
        _retriever = _get_vector_store().as_retriever()
    return _retriever


def _get_grader():
    global _retrieval_grader
    if _retrieval_grader is None:
        from langchain_openai import ChatOpenAI
        from langchain_core.prompts import ChatPromptTemplate

        class GradeDocuments(BaseModel):
            """Score for relevance check on retrieved documents."""
            score: float = Field(
                description="Relevance score 0.0 (irrelevant) to 1.0 (perfectly relevant)"
            )

        llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
        grader_llm = llm.with_structured_output(GradeDocuments)

        prompt = ChatPromptTemplate.from_messages([
            ("system",
             "You are an expert evaluator assessing the relevance of a retrieved document to a user question. "
             "Output a float score between 0.0 and 1.0. "
             "1.0 = exact answer, 0.5 = partially relevant, 0.0 = completely irrelevant."),
            ("human", "Retrieved document: \n\n {document} \n\n User question: {question}"),
        ])
        _retrieval_grader = prompt | grader_llm
    return _retrieval_grader


def _get_web_search():
    global _web_search_tool
    if _web_search_tool is None:
        from langchain_community.tools.tavily_search import TavilySearchResults
        _web_search_tool = TavilySearchResults(max_results=3)
    return _web_search_tool


@tool
async def search_knowledge(query: str) -> str:
    """Searches the internal knowledge base using CRAG logic. Falls back to web search if needed."""
    print(f"\n🔍 [CRAG] Searching for: {query}")

    retriever = _get_retriever()
    grader = _get_grader()

    docs = await retriever.ainvoke(query)

    relevant_docs = []
    search_web = False

    if not docs:
        print("⚠️ [CRAG] No local documents. Falling back to web search.")
        search_web = True
    else:
        max_score = 0.0
        good_docs = []

        for d in docs:
            try:
                result = await grader.ainvoke({"question": query, "document": d.page_content})
                score = getattr(result, 'score', 0.0)
                max_score = max(max_score, score)
                if score >= 0.3:
                    good_docs.append(d.page_content)
            except Exception as e:
                print(f"Grader error: {e}")

        if max_score >= 0.7:
            print(f"✅ [CRAG] Score {max_score:.2f} → CORRECT (local only)")
            relevant_docs = good_docs
        elif max_score < 0.3:
            print(f"❌ [CRAG] Score {max_score:.2f} → INCORRECT (web only)")
            search_web = True
        else:
            print(f"⚖️ [CRAG] Score {max_score:.2f} → AMBIGUOUS (local + web)")
            relevant_docs = good_docs
            search_web = True

    if search_web:
        print("🌐 [CRAG] Running web search...")
        try:
            web_tool = _get_web_search()
            web_results = await web_tool.ainvoke({"query": query})
            web_content = "\n".join(
                [f"Source: {d.get('url', 'Web')}\n{d.get('content', '')}" for d in web_results]
            )
            relevant_docs.append(f"WEB SEARCH RESULTS:\n{web_content}")
        except Exception as e:
            print(f"Web search failed: {e}")

    if not relevant_docs:
        return "No relevant information found locally or on the web."

    return "\n\n---\n\n".join(relevant_docs)


def get_vector_store():
    """Public accessor for the embed endpoint."""
    return _get_vector_store()


def process_and_store_pdf(file_path: str, filename: str):
    """Extracts text from a PDF and stores it in ChromaDB."""
    from langchain_community.document_loaders import PyPDFLoader
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    print(f"📄 Processing PDF: {filename}")
    loader = PyPDFLoader(file_path)
    docs = loader.load()

    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    splits = splitter.split_documents(docs)

    for split in splits:
        split.metadata["source"] = filename

    store = _get_vector_store()
    store.add_documents(splits)
    print(f"✅ Saved {len(splits)} chunks from {filename}.")
    return len(splits)
