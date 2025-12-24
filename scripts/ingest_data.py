import argparse
import json
import os
import sys
from pathlib import Path
from typing import Optional

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
PROCESSED_DIR = DATA_DIR / "processed"
DEFAULT_INPUT_FILE = PROCESSED_DIR / "documents.jsonl"
DEFAULT_DB_ROOT = DATA_DIR / "vector_db"

# ---------------------------------------------------------
# 2. FUNCTIONS
# ---------------------------------------------------------
def sanitize_tag(tag: str) -> str:
    # Keep the same rules as fetch_data.py so tags match filenames.
    import re
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", tag).strip("-").lower()
    return cleaned

def resolve_input_file(tag: Optional[str], explicit_path: Optional[str]):
    """
    Decide which processed JSONL file to ingest.
    Priority:
      1) explicit --input-file path
      2) --tag <tag> -> data/processed/{tag}_documents.jsonl
      3) fallback to default documents.jsonl
    """
    if explicit_path:
        return Path(explicit_path)
    if tag:
        cleaned = sanitize_tag(tag)
        return PROCESSED_DIR / f"{cleaned}_documents.jsonl"
    return DEFAULT_INPUT_FILE

def resolve_db_dir(tag: Optional[str], db_root: Optional[str]):
    """
    Decide where to store the FAISS index.
    If a tag is provided, store under <db_root>/<tag>. Otherwise, use root.
    """
    root = Path(db_root) if db_root else DEFAULT_DB_ROOT
    if tag:
        return root / sanitize_tag(tag)
    return root

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
    parser = argparse.ArgumentParser(description="Ingest processed documents into FAISS.")
    parser.add_argument("--tag", help="Dataset tag used during fetch (e.g., public key).")
    parser.add_argument("--input-file", help="Explicit path to a processed JSONL file.")
    parser.add_argument("--db-dir", help="Root directory to store the FAISS index (defaults to data/vector_db).")
    args = parser.parse_args()

    target_input = resolve_input_file(args.tag, args.input_file)
    target_db_dir = resolve_db_dir(args.tag, args.db_dir)

    print(f"--- ChainRAG Embedding Module ---")
    print(f"* Input File: {target_input}")
    print(f"* Output DB: {target_db_dir}")
    print("-" * 40)

    # 1. Load Data
    print("1. Loading processed documents...")
    docs = load_documents_from_jsonl(target_input)
    
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
    print(f"\n4. Saving Vector Database to: {target_db_dir}")
    target_db_dir.mkdir(parents=True, exist_ok=True)
    
    vector_store.save_local(str(target_db_dir))

    print("\n[OK] PROCESS COMPLETED SUCCESSFULLY!")
    print(f"The Vector Database is ready. You can now start the Backend.")

if __name__ == "__main__":
    main()