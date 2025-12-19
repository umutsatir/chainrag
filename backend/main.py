from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os
from pathlib import Path
from dotenv import load_dotenv

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough, RunnableParallel
from fastapi.middleware.cors import CORSMiddleware

# Set up FastAPI app
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directory paths
CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent
ENV_PATH = PROJECT_ROOT / ".env"
DB_DIR = PROJECT_ROOT / "data" / "vector_db"

load_dotenv(dotenv_path=ENV_PATH)
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# Create embeddings
embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")

# Database Loading
if DB_DIR.exists():
    try:
        vector_store = FAISS.load_local(str(DB_DIR), embeddings, allow_dangerous_deserialization=True)
        retriever = vector_store.as_retriever(search_kwargs={"k": 5})
    except Exception as e:
        print(f"Database loading error: {e}")
        vector_store = None
        retriever = None
else:
    vector_store = None
    retriever = None

# LLM
llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    google_api_key=GOOGLE_API_KEY,
    temperature=0.3
)


# MANUAL CHAIN CONSTRUCTION (LCEL Method)

# A. Prompt
template = """
You are a Senior Blockchain Forensic Analyst analyzing Etherscan data.
Your task is to examine the provided transaction history (Context) and provide the most accurate, evidence-based answer to the user's question.

INSTRUCTIONS:
1. Use ONLY the CONTEXT data provided below. Do not fabricate information from outside sources.
2. Pay close attention to transaction dates, amounts, and the "Incoming/Outgoing" (Direction) flow.
3. If the answer is not in the context, honestly state: "This information was not found in the provided transaction history."
4. Use professional language. **Bold** key data points (Amounts, Token Symbols, Dates).
5. Organize the answer in bullet points for easy readability.

Context (Transactions from Database):
{context}

User Question:
{question}
"""
prompt = ChatPromptTemplate.from_template(template)

# B. Document Merging Function
def format_docs(docs):
    return "\n\n".join(doc.page_content for doc in docs)

# C. Chain Construction
if retriever:
    # Retrieve data and process in parallel
    # This structure allows us to keep both the answer and the sources (context)
    rag_chain_from_docs = (
        RunnablePassthrough.assign(context=(lambda x: format_docs(x["context"])))
        | prompt
        | llm
        | StrOutputParser()
    )

    rag_chain = RunnableParallel(
        {"context": retriever, "question": RunnablePassthrough()}
    ).assign(answer=rag_chain_from_docs)

else:
    rag_chain = None

# API ENDPOINT
class QueryRequest(BaseModel):
    query: str

@app.post("/chat")
async def chat_endpoint(request: QueryRequest):
    if not rag_chain:
        raise HTTPException(status_code=500, detail="Vector database not loaded.")
    
    try:
        # Run the chain
        response = rag_chain.invoke(request.query)
        
        # Since we manually constructed the chain using LCEL, the response structure is:
        # {'context': [Doc1, Doc2...], 'question': '...', 'answer': '...'}
        
        sources = [doc.page_content for doc in response["context"]]
        
        return {
            "answer": response["answer"],
            "sources": sources
        }
    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
    # To Run: uvicorn backend.main:app --reload