import os
import json
import requests
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

# Load environment variables from project root .env (at chainrag/.env)
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent.parent / ".env")

ETHERSCAN_API_KEY = os.getenv("ETHERSCAN_API_KEY")
# V2 docs: https://docs.etherscan.io/ — supports multichain via chainid.
# Default to V2 base URL; override via ENV if needed.
ETHERSCAN_BASE_URL = os.getenv("ETHERSCAN_BASE_URL", "https://api.etherscan.io/v2/api")
ETHERSCAN_CHAIN_ID = os.getenv("ETHERSCAN_CHAIN_ID", "1")  # 1 = Ethereum mainnet

# Define paths relative to the script location to ensure data goes to chainrag/data
# script is in chainrag/data-collection/scripts/
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data"

RAW_DIR = DATA_DIR / "raw"
PROC_DIR = DATA_DIR / "processed"
RAW_DIR.mkdir(parents=True, exist_ok=True)
PROC_DIR.mkdir(parents=True, exist_ok=True)

# -------------------------------
#  Helpers
# -------------------------------

def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)

def write_jsonl(path, documents):
    with open(path, "w") as f:
        for doc in documents:
            f.write(json.dumps(doc, ensure_ascii=False) + "\n")

def ts_to_date(ts):
    return datetime.utcfromtimestamp(int(ts)).strftime("%Y-%m-%d %H:%M:%S")


# -------------------------------
#  Etherscan API wrappers
# -------------------------------

def call_etherscan(module, action, **params):
    """Call Etherscan API per docs with chainid + apikey."""
    query = {
        "module": module,
        "action": action,
        "apikey": ETHERSCAN_API_KEY,
        "chainid": ETHERSCAN_CHAIN_ID,  # V2 supports multichain
        **params,
    }
    resp = requests.get(ETHERSCAN_BASE_URL, params=query, timeout=15)
    data = resp.json()

    if data.get("status") != "1":
        # Etherscan returns status "0"/"0" on empty result too; surface message
        print(f"Etherscan error ({module}/{action}):", data.get("message"), data.get("result"))
        return []

    return data.get("result", [])


def fetch_normal_transactions(address, start_block=0, end_block=99999999):
    return call_etherscan(
        module="account",
        action="txlist",
        address=address,
        startblock=start_block,
        endblock=end_block,
        sort="asc",
    )


def fetch_erc20_transfers(address):
    return call_etherscan(
        module="account",
        action="tokentx",
        address=address,
        sort="asc",
    )


# -------------------------------
#  Convert raw data → RAG format
# -------------------------------

def convert_to_documents(address, normal_txs, erc20_txs):
    docs = []

    # --- Normal transactions ---
    for tx in normal_txs:
        text = (
            f"[NORMAL TX]\n"
            f"Hash: {tx['hash']}\n"
            f"Block: {tx['blockNumber']}\n"
            f"Date: {ts_to_date(tx['timeStamp'])}\n"
            f"From: {tx['from']}\n"
            f"To: {tx['to']}\n"
            f"Value (ETH): {int(tx['value']) / 1e18}\n"
            f"Gas Used: {tx['gasUsed']}\n"
        )

        docs.append({
            "id": f"normal_{tx['hash']}",
            "address": address,
            "type": "normal_tx",
            "date": ts_to_date(tx["timeStamp"]),
            "tx_hash": tx["hash"],
            "text": text
        })

    # --- ERC20 transfers ---
    for tx in erc20_txs:
        direction = (
            "Outgoing" if tx["from"].lower() == address.lower()
            else "Incoming"
        )

        amount = int(tx["value"]) / (10 ** int(tx["tokenDecimal"]))

        text = (
            f"[ERC20 TRANSFER]\n"
            f"Hash: {tx['hash']}\n"
            f"Block: {tx['blockNumber']}\n"
            f"Date: {ts_to_date(tx['timeStamp'])}\n"
            f"Token: {tx['tokenName']} ({tx['tokenSymbol']})\n"
            f"Amount: {amount}\n"
            f"From: {tx['from']}\n"
            f"To: {tx['to']}\n"
            f"Direction: {direction}\n"
        )

        docs.append({
            "id": f"erc20_{tx['hash']}",
            "address": address,
            "type": "erc20_transfer",
            "date": ts_to_date(tx["timeStamp"]),
            "token": tx["tokenSymbol"],
            "tx_hash": tx["hash"],
            "text": text
        })

    return docs


# -------------------------------
#  Main
# -------------------------------

def main():
    address = input("Enter Ethereum address: ").strip()

    print(f"Fetching data for: {address}")

    normal_txs = fetch_normal_transactions(address)
    erc20_txs = fetch_erc20_transfers(address)

    print(f"Normal TX count: {len(normal_txs)}")
    print(f"ERC20 TX count: {len(erc20_txs)}")

    # Save raw
    save_json(RAW_DIR / "normal_txs.json", normal_txs)
    save_json(RAW_DIR / "erc20_transfers.json", erc20_txs)

    # Process → documents.jsonl
    documents = convert_to_documents(address, normal_txs, erc20_txs)
    write_jsonl(PROC_DIR / "documents.jsonl", documents)

    print(f"Generated {len(documents)} documents!")
    print("Saved to: data/processed/documents.jsonl")

if __name__ == "__main__":
    if not ETHERSCAN_API_KEY:
        print("ERROR: Set ETHERSCAN_API_KEY environment variable first.")
    else:
        main()
