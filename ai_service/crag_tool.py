import os
from pydantic import BaseModel, Field
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_chroma import Chroma
from langchain_core.prompts import ChatPromptTemplate
from langchain_community.tools.tavily_search import TavilySearchResults
from langchain_core.tools import tool
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document

# Initialize Chroma Vector Store for local knowledge
embeddings = OpenAIEmbeddings()
vector_store = Chroma(
    collection_name="nexuschat_knowledge",
    embedding_function=embeddings,
    persist_directory="./chroma_db"
)

retriever = vector_store.as_retriever()

# Data model for the Grader
class GradeDocuments(BaseModel):
    """Score for relevance check on retrieved documents."""
    score: float = Field(description="Relevance score of the document to the question, from 0.0 (completely irrelevant) to 1.0 (perfectly relevant)")

# LLM with structured output for grading relevance
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
structured_llm_grader = llm.with_structured_output(GradeDocuments)

system = """You are an expert evaluator assessing the relevance of a retrieved document to a user question. \n 
    Carefully analyze the semantic meaning. Output a float score between 0.0 and 1.0.
    1.0 means the document contains the exact answer.
    0.5 means it is partially relevant or related.
    0.0 means it is completely irrelevant."""
grade_prompt = ChatPromptTemplate.from_messages([
    ("system", system),
    ("human", "Retrieved document: \n\n {document} \n\n User question: {question}"),
])
retrieval_grader = grade_prompt | structured_llm_grader

# Web Search Tool (Tavily)
web_search_tool = TavilySearchResults(max_results=3)

@tool
async def search_knowledge(query: str) -> str:
    """Searches the internal knowledge base. Uses the exact CRAG paper logic (Correct, Incorrect, Ambiguous thresholds) to route to Web Search if needed."""
    print(f"\n🔍 [CRAG] Searching knowledge base for: {query}")
    
    # 1. Retrieve from local Chroma DB
    docs = await retriever.ainvoke(query)
    
    relevant_docs = []
    search_web = False
    
    # 2. Grade Documents using CRAG Thresholds (th1=0.3, th2=0.7)
    if not docs:
        print("⚠️ [CRAG] No local documents found. Action: INCORRECT (Web Search Only)")
        search_web = True
    else:
        max_score = 0.0
        good_docs = []
        
        for d in docs:
            try:
                result = await retrieval_grader.ainvoke({"question": query, "document": d.page_content})
                score = getattr(result, 'score', 0.0)
                max_score = max(max_score, score)
                
                # Keep document if it's above the lower threshold
                if score >= 0.3:
                    good_docs.append(d.page_content)
            except Exception as e:
                print(f"Grader error: {e}")
                
        # 3. CRAG Action Routing based on highest score
        if max_score >= 0.7:
            print(f"✅ [CRAG] Max score {max_score}. Action: CORRECT. Using local documents only.")
            relevant_docs = good_docs
            search_web = False
            
        elif max_score < 0.3:
            print(f"❌ [CRAG] Max score {max_score}. Action: INCORRECT. Discarding all local docs. Web Search only.")
            relevant_docs = []
            search_web = True
            
        else:
            print(f"⚖️ [CRAG] Max score {max_score}. Action: AMBIGUOUS. Combining local docs + Web Search.")
            relevant_docs = good_docs
            search_web = True
                
    # 4. Web Search Action
    if search_web:
        print(f"🌐 [CRAG] Executing Tavily Web Search...")
        try:
            web_results = await web_search_tool.ainvoke({"query": query})
            web_content = "\n".join([f"Source: {d.get('url', 'Web')}\n{d.get('content', '')}" for d in web_results])
            relevant_docs.append(f"WEB SEARCH RESULTS:\n{web_content}")
        except Exception as e:
            print(f"Web search failed: {e}")
        
    if not relevant_docs:
        return "No relevant information found locally or on the web."
        
    return "\n\n---\n\n".join(relevant_docs)

def process_and_store_pdf(file_path: str, filename: str):
    """Extracts text from a PDF and stores it in ChromaDB."""
    from langchain_community.document_loaders import PyPDFLoader
    
    print(f"📄 Processing PDF: {filename}")
    loader = PyPDFLoader(file_path)
    docs = loader.load()
    
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    splits = text_splitter.split_documents(docs)
    
    # Add metadata to chunks
    for split in splits:
        split.metadata["source"] = filename
        
    vector_store.add_documents(splits)
    print(f"✅ Saved {len(splits)} chunks from {filename} to ChromaDB.")
    return len(splits)
