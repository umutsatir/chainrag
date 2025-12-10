import json
import os
import sys
from pathlib import Path
# .env can be added here if needed, but it is not required now as we are using a local model.

# RAG and FAISS Libraries
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document

# ---------------------------------------------------------
# 1. PROFESSIONAL PATH CONFIGURATION
# ---------------------------------------------------------

# Location of this file: chainrag/data-embedding/scripts/
CURRENT_SCRIPT_DIR = Path(__file__).resolve().parent

# Project Root Directory: chainrag/
# scripts -> data-embedding -> chainrag (3 levels up)
PROJECT_ROOT = CURRENT_SCRIPT_DIR.parent.parent

# Data Paths (Access to central 'data' folder)
DATA_DIR = PROJECT_ROOT / "data"
INPUT_FILE = DATA_DIR / "processed" / "documents.jsonl"
OUTPUT_DB_DIR = DATA_DIR / "vector_db" # Where the FAISS index will be saved

# ---------------------------------------------------------
# 2. FUNCTIONS
# ---------------------------------------------------------

def load_documents_from_jsonl(file_path):
    """
    Reads JSONL file and converts it to LangChain Document objects.
    """
    documents = []
    
    # Check if file exists
    if not file_path.exists():
        print(f"[ERROR] File not found: {file_path}")
        print("Please run the 'data-collection' module first.")
        return []

    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            try:
                data = json.loads(line)
                # Metadata is critical for the LLM to cite sources when answering.
                doc = Document(
                    page_content=data['text'],
                    metadata={
                        "source": data.get('tx_hash', 'unknown'), 
                        "date": data.get('date', ''),
                        "type": data.get('type', 'unknown'),
                        "token": data.get('token', 'ETH')
                    }
                )
                documents.append(doc)
            except json.JSONDecodeError:
                print(f"[WARNING] Skipped malformed line.")
                continue
                
    return documents

def main():
    print(f"--- ChainRAG Embedding Module ---")
    print(f"• Project Root: {PROJECT_ROOT}")
    print(f"• Input File: {INPUT_FILE}")
    print(f"• Output Destination: {OUTPUT_DB_DIR}")
    print("-" * 40)

    # 1. Load Data
    print("1. Loading processed data...")
    docs = load_documents_from_jsonl(INPUT_FILE)
    
    if not docs:
        print("No documents found to process. Exiting.")
        return
    
    print(f"   -> Success: {len(docs)} documents loaded into memory.")

    # 2. Model Preparation
    print("\n2. Preparing Embedding model (HuggingFace)...")
    # 'all-MiniLM-L6-v2' is lightweight and fast (CPU friendly)
    try:
        embeddings = HuggingFaceEmbeddings(
            model_name="sentence-transformers/all-MiniLM-L6-v2"
        )
    except Exception as e:
        print(f"[ERROR] Error loading model: {e}")
        return

    # 3. Creating Vector Database (FAISS)
    print("\n3. Creating vectors and indexing with FAISS...")
    print("   (This process may take some time depending on data size)")
    
    vector_store = FAISS.from_documents(
        documents=docs,
        embedding=embeddings
    )

    # 4. Saving
    print(f"\n4. Writing index to disk: {OUTPUT_DB_DIR}")
    # Create folder if it doesn't exist
    OUTPUT_DB_DIR.mkdir(parents=True, exist_ok=True)
    
    vector_store.save_local(str(OUTPUT_DB_DIR))

    print("\n✅ PROCESS COMPLETED!")
    print(f"Vector database is ready. You can now proceed to the query phase.")

if __name__ == "__main__":
    main()