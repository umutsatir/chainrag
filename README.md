# ChainRAG 🔗

**ChainRAG** is an AI assistant that enables natural language querying on Ethereum blockchain data using **Retrieval-Augmented Generation (RAG)** architecture.

It allows users to input an Ethereum wallet address, analyze its transaction history (Normal Transactions & ERC20 Transfers), and chat with this data.

## Authors
1. Mehmet Nuri Başa - 210104004060
2. Umut Hüseyin Satır - 210104004074

## 🚀 Features

*   **Automated Data Fetching:** Fetches transaction history of the specified wallet using the Etherscan API.
*   **Vector Database:** Processes fetched data and converts it into a local vector database using FAISS.
*   **Smart Chat:** Ask natural language questions about transaction history powered by Google Gemini (LLM).
    *   *"Who did I send money to last?"*
    *   *"How much USDT did I spend last month?"*
    *   *"Have I ever interacted with Vitalik.eth?"*
*   **Modern Interface:** User-friendly interface built with React and TailwindCSS.
*   **Local Storage:** Chat history is stored locally in your browser.

## 🛠️ Tech Stack

*   **Backend:** Python, FastAPI, LangChain
*   **Frontend:** React, Vite, TailwindCSS
*   **AI & RAG:** Google Gemini (LLM), HuggingFace Embeddings (`all-MiniLM-L6-v2`), FAISS (Vector DB)
*   **Data Source:** Etherscan API

## 📦 Installation

Follow these steps to run the project locally.

### Requirements

*   Python 3.10+
*   Node.js 16+
*   Etherscan API Key (Free to obtain)
*   Google Gemini API Key (Available from AI Studio)

### 1. Clone the Project

```bash
git clone https://github.com/username/chainrag.git
cd chainrag
```

### 2. Backend Setup

```bash
# Create a virtual environment (Optional but recommended)
python -m venv venv
# For Windows:
venv\Scripts\activate
# For Mac/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Environment Variables (.env)

Create a `.env` file in the root directory and add your API keys:

```env
GOOGLE_API_KEY=your_google_api_key_here
ETHERSCAN_API_KEY=your_etherscan_api_key_here
```

### 4. Frontend Setup

```bash
cd frontend
npm install
```

## ▶️ Usage

You need to use two separate terminals to run the application.

**Terminal 1 (Backend):**

```bash
# Ensure you are in the root directory
uvicorn backend.main:app --reload
```
The backend will run at `http://127.0.0.1:8000`.

**Terminal 2 (Frontend):**

```bash
cd frontend
npm run dev
```
The frontend will typically run at `http://localhost:5173`. Open this address in your browser.

## 📂 Project Structure

```
chainrag/
├── backend/             # FastAPI server and RAG logic
├── data/                # Processed data and Vector DB (FAISS)
├── frontend/            # React interface
├── scripts/             # Data fetching and processing scripts
│   ├── fetch_data.py    # Fetches data from Etherscan
│   └── ingest_data.py   # Vectorizes the data
├── .env                 # API keys
└── requirements.txt     # Python libraries
```

## ⚠️ Notes

*   **Data Limit:** By default, the last 10,000 transactions are fetched due to performance and API limits.
*   **Windows Users:** If you encounter emoji character errors in the terminal, the scripts are configured to use fallback text automatically.

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## 📄 License
This project was developed for the Natural Language Processing course.
