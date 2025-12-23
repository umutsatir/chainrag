from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os
import json
import sys
import subprocess
import threading
from pathlib import Path
from dotenv import load_dotenv

# --- LIBRARIES ---
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser, JsonOutputParser
from fastapi.middleware.cors import CORSMiddleware

# API Configuration
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths
CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
ENV_PATH = PROJECT_ROOT / ".env"
DB_ROOT = PROJECT_ROOT / "data" / "vector_db"

load_dotenv(dotenv_path=ENV_PATH)
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# 1. INITIALIZE MODELS (shared)
embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")

llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash", 
    google_api_key=GOOGLE_API_KEY,
    temperature=0 
)

# Vector store cache per tag
VECTOR_CACHE = {}

# Prep job statuses per tag
PREP_STATUS = {}

def sanitize_tag(raw_tag: str) -> str:
    import re
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", raw_tag).strip("-").lower()
    return cleaned

def load_vector_store(tag: str):
    cleaned = sanitize_tag(tag)
    if cleaned in VECTOR_CACHE:
        return VECTOR_CACHE[cleaned]
    
    target_dir = DB_ROOT / cleaned
    if not target_dir.exists():
        raise HTTPException(status_code=404, detail=f"Vector DB for tag '{cleaned}' not found.")
    try:
        store = FAISS.load_local(str(target_dir), embeddings, allow_dangerous_deserialization=True)
        VECTOR_CACHE[cleaned] = store
        return store
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load vector DB: {e}")

def run_pipeline(tag: str, address: str):
    """
    Run fetch_data then ingest_data for the given address/tag.
    Updates PREP_STATUS along the way for frontend polling.
    """
    cleaned = sanitize_tag(tag)
    PREP_STATUS[cleaned] = {"state": "running", "message": "Fetching data..."}
    try:
        fetch_cmd = [
            sys.executable,
            str(SCRIPTS_DIR / "fetch_data.py"),
            "--address",
            address,
        ]
        fetch_res = subprocess.run(fetch_cmd, capture_output=True, text=True)
        if fetch_res.returncode != 0:
            PREP_STATUS[cleaned] = {"state": "error", "message": fetch_res.stderr or "fetch_data failed"}
            return

        PREP_STATUS[cleaned] = {"state": "running", "message": "Building embeddings..."}
        ingest_cmd = [
            sys.executable,
            str(SCRIPTS_DIR / "ingest_data.py"),
            "--tag",
            cleaned,
            "--db-dir",
            str(DB_ROOT),
        ]
        ingest_res = subprocess.run(ingest_cmd, capture_output=True, text=True)
        if ingest_res.returncode != 0:
            PREP_STATUS[cleaned] = {"state": "error", "message": ingest_res.stderr or "ingest_data failed"}
            return

        PREP_STATUS[cleaned] = {"state": "done", "message": "Vector DB ready."}
        # Warm cache
        VECTOR_CACHE.pop(cleaned, None)
        load_vector_store(cleaned)
    except Exception as e:
        PREP_STATUS[cleaned] = {"state": "error", "message": str(e)}


# --- 3. ADVANCED INTENT ANALYSIS (LIMIT + SORT + FILTER) ---

filter_template = """
You are an expert database query parser. Analyze the user's question.
Provide output in JSON format with three keys: "filters", "sort", and "limit".

1. FILTERS (Extract only these fields):
   - "token": Token symbol (e.g., USDT, ETH, PEPE, WETH).
   - "type": "erc20_transfer" (for token transfers) or "normal_tx" (for ETH transfers).
   - "direction": "Incoming" (received) or "Outgoing" (sent).

2. SORT (Chronological Intent):
   - "desc": If user asks for "latest", "last", "newest", "recent", "today", "current".
   - "asc": If user asks for "first", "oldest", "earliest".
   - null: If no specific time order is mentioned.

3. LIMIT (Count - BE CAREFUL):
   - Extract the integer representing the *quantity* of results desired.
   - TRAP WARNING: 
     * "100 USDT transfer" -> 100 is an AMOUNT, not a limit. (Default limit is 5).
     * "Transactions in 2024" -> 2024 is a DATE, not a limit.
     * "Block 5421" -> Not a limit.
   - If no quantity is explicitly specified, default to 5.
   - Maximum limit is 20.

Examples:
Q: "Show me the last 3 transactions" -> JSON: {{"filters": {{}}, "sort": "desc", "limit": 3}}
Q: "Transfers above 100 USDT" -> JSON: {{"filters": {{"token": "USDT"}}, "sort": null, "limit": 5}}
Q: "Oldest 10 incoming ETH txs" -> JSON: {{"filters": {{"token": "ETH", "direction": "Incoming"}}, "sort": "asc", "limit": 10}}

User Question: {question}
JSON Output:
"""

filter_prompt = ChatPromptTemplate.from_template(filter_template)
filter_chain = filter_prompt | llm | JsonOutputParser()

# --- 4. ANSWER GENERATOR (RAG) ---
answer_template = """
You are a Senior Blockchain Forensic Analyst.
Answer the user's question based ONLY on the transaction list provided below (Context).

INSTRUCTIONS:
1. Stick strictly to the dates, amounts, and tokens in the context.
2. Present transactions in a clear, chronological order.
3. For every transaction mentioned, include the last 4 digits of the hash in parentheses (e.g., ...a1b2).
4. If no relevant data is found in the context, state "No relevant transactions found."

Context:
{context}

User Question: {question}
"""
answer_prompt = ChatPromptTemplate.from_template(answer_template)
answer_chain = answer_prompt | llm | StrOutputParser()


# --- 5. API ENDPOINTS ---
class QueryRequest(BaseModel):
    query: str
    tag: str

class PrepRequest(BaseModel):
    address: str

@app.post("/prepare")
async def prepare_endpoint(req: PrepRequest):
    tag = sanitize_tag(req.address)
    existing = PREP_STATUS.get(tag)
    if existing and existing.get("state") in {"running", "done"}:
        return {"tag": tag, "status": existing}

    # Kick off background thread
    thread = threading.Thread(target=run_pipeline, args=(tag, req.address), daemon=True)
    thread.start()
    PREP_STATUS[tag] = {"state": "running", "message": "Queued..."}
    return {"tag": tag, "status": PREP_STATUS[tag]}

@app.get("/prepare/status")
async def prepare_status(tag: str):
    cleaned = sanitize_tag(tag)
    status = PREP_STATUS.get(cleaned)
    if not status:
        return {"tag": cleaned, "status": {"state": "unknown", "message": "No job found."}}
    return {"tag": cleaned, "status": status}

@app.post("/chat")
async def chat_endpoint(request: QueryRequest):
    if not request.tag:
        raise HTTPException(status_code=400, detail="tag is required")
    vector_store = load_vector_store(request.tag)
    
    try:
        # A. Intent Extraction
        print(f"Query: {request.query}")
        intent = {}
        try:
            intent = filter_chain.invoke({"question": request.query})
            print(f"🧠 Intent Detected: {intent}")
        except Exception as e:
            print(f"Intent Parsing Error: {e}")
            intent = {}
        
        # Clean filters (remove null/empty)
        filters = {k: v for k, v in intent.get("filters", {}).items() if v}
        sort_order = intent.get("sort")
        
        # Determine Limit (Default: 5)
        user_limit = intent.get("limit", 5) 
        if not isinstance(user_limit, int): user_limit = 5

        # --- SAFETY CHECK ---
        # Cap the limit at 20 to prevent token exhaustion.
        if user_limit > 20: 
            user_limit = 20
            print("⚠ User limit capped at 20 for safety.")

        # B. Search Strategy (Deep Retrieval vs. Direct Retrieval)
        
        # If sorting is required (e.g., "Latest transactions"), we must cast a wide net (k=5000).
        # Semantic search doesn't guarantee chronological order, so we fetch many, then sort manually.
        k_val = user_limit 
        
        if sort_order:
            k_val = 5000 # Fetch huge pool to ensure we catch the true latest/oldest
            print(f"⚡ Sorting requested: Wide Search activated (k={k_val})")

        # C. Perform FAISS Search
        if filters:
            docs = vector_store.similarity_search(request.query, k=k_val, filter=filters)
        else:
            docs = vector_store.similarity_search(request.query, k=k_val)

        # D. Post-Processing (Python Sort & Slice)
        if sort_order:
            print(f"⏳ Sorting in Python: {sort_order}")
            # desc = True (Newest to Oldest), asc = False (Oldest to Newest)
            reverse_mode = True if sort_order == "desc" else False
            
            # Sort by timestamp metadata
            docs = sorted(
                docs, 
                key=lambda x: int(x.metadata.get("timestamp", 0)), 
                reverse=reverse_mode
            )
            
            # CRITICAL: Slice to the user's requested limit AFTER sorting
            docs = docs[:user_limit]

        # E. Generate Answer
        context_text = "\n\n".join([d.page_content for d in docs])
        
        if not context_text:
            return {"answer": "No relevant transactions found matching your criteria.", "sources": []}

        answer = answer_chain.invoke({"context": context_text, "question": request.query})
        sources = [d.page_content for d in docs]
        
        return {"answer": answer, "sources": sources}

    except Exception as e:
        print(f"Server Error: {e}")
        # Return the error message to the frontend for debugging
        raise HTTPException(status_code=500, detail=str(e))