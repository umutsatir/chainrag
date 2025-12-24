import argparse
import os
import json
import requests
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
import re

# Paths
CURRENT_SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_SCRIPT_DIR.parent 
ENV_PATH = PROJECT_ROOT / ".env"
load_dotenv(dotenv_path=ENV_PATH)

DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PROC_DIR = DATA_DIR / "processed"

# Create directories if they don't exist
RAW_DIR.mkdir(parents=True, exist_ok=True)
PROC_DIR.mkdir(parents=True, exist_ok=True)

# Configuration
ETHERSCAN_API_KEY = os.getenv("ETHERSCAN_API_KEY")
ETHERSCAN_BASE_URL = "https://api.etherscan.io/v2/api"
ETHERSCAN_CHAIN_ID = "1"  # Mainnet

# --- IMPORTANT: Transaction Limit ---
# We limit to the latest 10000 transactions to prevent database bloat
# and ensure the RAG system remains fast and relevant.
TX_LIMIT = 10000 

def sanitize_tag(raw_tag: str) -> str:
    """
    Normalize a user-provided tag so it is filesystem-safe.
    Keeps lowercase letters, numbers, dashes and underscores.
    Falls back to a timestamp if the result is empty.
    """
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", raw_tag).strip("-").lower()
    if not cleaned:
        cleaned = datetime.now(timezone.utc).strftime("run-%Y%m%d-%H%M%S")
    return cleaned

def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)

def write_jsonl(path, documents):
    with open(path, "w", encoding="utf-8") as f:
        for doc in documents:
            f.write(json.dumps(doc, ensure_ascii=False) + "\n")

def ts_to_date(ts):
    return datetime.fromtimestamp(int(ts), timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

def call_etherscan(module, action, **params):
    query = {
        "module": module,
        "action": action,
        "apikey": ETHERSCAN_API_KEY,
        "chainid": ETHERSCAN_CHAIN_ID,
        **params,
    }
    try:
        resp = requests.get(ETHERSCAN_BASE_URL, params=query, timeout=20)
        data = resp.json()
        
        if data.get("status") == "0" and data.get("message") == "No transactions found":
            return []
        
        if data.get("status") != "1":
            print(f"⚠ Etherscan Warning ({action}): {data.get('message')}")
            return []

        return data.get("result", [])
    except Exception as e:
        print(f"Connection Error: {e}")
        return []

def fetch_normal_transactions(address):
    # Fetch latest transactions (sort=desc)
    return call_etherscan(
        module="account",
        action="txlist",
        address=address,
        startblock=0,
        endblock=99999999,
        page=1,
        offset=TX_LIMIT,
        sort="desc",
    )

def fetch_erc20_transfers(address):
    return call_etherscan(
        module="account",
        action="tokentx",
        address=address,
        page=1,
        offset=TX_LIMIT, 
        sort="desc",
    )

# --- DATA CONVERSION & PREPARATION ---

def convert_to_documents(address, normal_txs, erc20_txs):
    docs = []

    # 1. Process Normal Transactions
    for idx, tx in enumerate(normal_txs):
        val_eth = float(tx['value']) / 1e18
        date_str = ts_to_date(tx['timeStamp'])
        
        # Text for LLM to read
        text = (
            f"[NORMAL TRANSACTION]\n"
            f"Type: Ethereum Transfer\n"
            f"Date: {date_str}\n"
            f"Amount: {val_eth:.6f} ETH\n"
            f"From: {tx['from']}\n"
            f"To: {tx['to']}\n"
            f"Hash: {tx['hash']}\n"
        )
        
        # Determine Direction
        direction = "Outgoing" if tx["from"].lower() == address.lower() else "Incoming"

        docs.append({
            "id": f"normal_{tx['hash']}", 
            "address": address,
            "type": "normal_tx",
            "date": date_str,
            "timestamp": int(tx['timeStamp']),
            "token": "ETH",
            "direction": direction,
            "tx_hash": tx["hash"],
            "text": text
        })

    # 2. Process ERC20 Token Transfers
    for idx, tx in enumerate(erc20_txs):
        try:
            decimals = int(tx["tokenDecimal"])
            amount = float(tx["value"]) / (10 ** decimals)
        except:
            amount = 0.0

        direction = "Outgoing" if tx["from"].lower() == address.lower() else "Incoming"
        date_str = ts_to_date(tx['timeStamp'])

        text = (
            f"[TOKEN TRANSFER]\n"
            f"Type: ERC20 Transfer\n"
            f"Date: {date_str}\n"
            f"Token: {tx['tokenSymbol']} ({tx['tokenName']})\n"
            f"Amount: {amount:.4f} {tx['tokenSymbol']}\n"
            f"Direction: {direction}\n"
            f"From: {tx['from']}\n"
            f"To: {tx['to']}\n"
            f"Hash: {tx['hash']}\n"
        )

        # UNIQUE ID GENERATION:
        # A single transaction hash may contain multiple transfers.
        # We append the index '_{idx}' to prevent overwriting data in FAISS.
        unique_id = f"erc20_{tx['hash']}_{idx}"

        docs.append({
            "id": unique_id,
            "address": address,
            "type": "erc20_transfer",
            "date": date_str,
            "timestamp": int(tx['timeStamp']),
            "token": tx["tokenSymbol"],
            "direction": direction,
            "tx_hash": tx["hash"],
            "text": text
        })

    return docs

def main():
    parser = argparse.ArgumentParser(description="Fetch transactions and convert to RAG docs.")
    parser.add_argument("--address", help="Ethereum address to fetch. If omitted, prompts interactively.")
    args = parser.parse_args()

    address = args.address or input("Enter Ethereum Address (e.g., Vitalik): ").strip()
    if not address:
        print("No address provided.")
        return
    
    # Tag derives from the public key to keep outputs discoverable per address
    tag = sanitize_tag(address)

    print(f"\n[INFO] Fetching data for: {address}")
    print(f"   (Limit: Last {TX_LIMIT} transactions)")
    print(f"   (Tag: {tag})")

    normal_txs = fetch_normal_transactions(address)
    print(f"[OK] Fetched {len(normal_txs)} Normal ETH transactions.")
    
    erc20_txs = fetch_erc20_transfers(address)
    print(f"[OK] Fetched {len(erc20_txs)} ERC20 Token transfers.")

    # Save raw data for debugging
    raw_normal_path = RAW_DIR / f"{tag}_normal_txs.json"
    raw_erc20_path = RAW_DIR / f"{tag}_erc20_transfers.json"
    save_json(raw_normal_path, normal_txs)
    save_json(raw_erc20_path, erc20_txs)

    # Convert to RAG format
    documents = convert_to_documents(address, normal_txs, erc20_txs)
    
    # Save processed data
    processed_path = PROC_DIR / f"{tag}_documents.jsonl"
    write_jsonl(processed_path, documents)

    print(f"\n[SUCCESS] Successfully processed {len(documents)} documents.")
    print(f"[SAVED] Saved processed: {processed_path}")
    print(f"[SAVED] Saved raw normal txs: {raw_normal_path}")
    print(f"[SAVED] Saved raw erc20 txs: {raw_erc20_path}")
    print("\nNext Step: Run 'python scripts/ingest_data.py --tag {tag}' to build the vector database.")

if __name__ == "__main__":
    if not ETHERSCAN_API_KEY:
        print("ERROR: ETHERSCAN_API_KEY not found. Please check your .env file.")
    else:
        main()