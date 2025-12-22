import json
import os
import sys
from pathlib import Path

# RAG and FAISS Libraries
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document

# ---------------------------------------------------------
# 1. CONFIGURATION AND PATHS
# ---------------------------------------------------------

# Location of this script: chainrag/scripts/
CURRENT_SCRIPT_DIR = Path(__file__).resolve().parent

# Project Root: chainrag/
PROJECT_ROOT = CURRENT_SCRIPT_DIR.parent

# Data Paths
DATA_DIR = PROJECT_ROOT / "data"
INPUT_FILE = DATA_DIR / "processed" / "documents.jsonl"
OUTPUT_DB_DIR = DATA_DIR / "vector_db" 

# ---------------------------------------------------------
# 2. FUNCTIONS
# ---------------------------------------------------------

def load_documents_from_jsonl(file_path):
    """
    Reads the JSONL file and converts each line into a LangChain Document object.
    Crucial Step: Correctly mapping metadata for Hybrid Search.
    """
    documents = []
    
    # File check
    if not file_path.exists():
        print(f"[ERROR] File not found: {file_path}")
        print("Please run 'python scripts/fetch_data.py' first.")
        return []

    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            try:
                data = json.loads(line)
                
                # --- METADATA MAPPING ---
                # This metadata is used by the backend for filtering (e.g., "Show only Outgoing USDT")
                
                doc = Document(
                    page_content=data['text'],
                    metadata={
                        "source": data.get('tx_hash', 'unknown'), 
                        "date": data.get('date', ''),
                        "timestamp": data.get('timestamp', 0), # Useful for sorting if needed
                        "type": data.get('type', 'unknown'),   # 'normal_tx' or 'erc20_transfer'
                        "token": data.get('token', 'ETH'),     # 'USDT', 'ETH', etc.
                        "direction": data.get('direction', 'unknown'), # Critical for In/Out filtering
                        "address": data.get('address', 'unknown')
                    }
                )
                documents.append(doc)
            except json.JSONDecodeError:
                print(f"[WARNING] Skipped malformed JSON line.")
                continue
                
    return documents

def main():
    print(f"--- ChainRAG Embedding Module ---")
    print(f"• Input File: {INPUT_FILE}")
    print(f"• Output DB: {OUTPUT_DB_DIR}")
    print("-" * 40)

    # 1. Load Data
    print("1. Loading processed documents...")
    docs = load_documents_from_jsonl(INPUT_FILE)
    
    if not docs:
        print("No documents found. Exiting.")
        return
    
    print(f"   -> Success: Loaded {len(docs)} documents into memory.")

    # 2. Prepare Embedding Model
    print("\n2. Initializing Embedding Model (HuggingFace)...")
    try:
        embeddings = HuggingFaceEmbeddings(
            model_name="sentence-transformers/all-MiniLM-L6-v2"
        )
    except Exception as e:
        print(f"[ERROR] Failed to load model: {e}")
        return

    # 3. Create Vector Database (FAISS)
    print("\n3. Generating Vectors and Indexing with FAISS...")
    print("   (This process may take a moment depending on data size...)")
    
    vector_store = FAISS.from_documents(
        documents=docs,
        embedding=embeddings
    )

    # 4. Save to Disk
    print(f"\n4. Saving Vector Database to: {OUTPUT_DB_DIR}")
    OUTPUT_DB_DIR.mkdir(parents=True, exist_ok=True)
    
    vector_store.save_local(str(OUTPUT_DB_DIR))

    print("\n✅ PROCESS COMPLETED SUCCESSFULLY!")
    print(f"The Vector Database is ready. You can now start the Backend.")

if __name__ == "__main__":
    main()