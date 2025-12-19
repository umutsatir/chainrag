import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

function App() {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query) return;

    // Add user message to chat
    const newMessages = [...messages, { role: 'user', content: query }];
    setMessages(newMessages);
    setLoading(true);

    try {
      // Send the query to the backend
      const response = await fetch('http://127.0.0.1:8000/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: query }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Add assistant response to chat
      setMessages([...newMessages, { 
        role: 'assistant', 
        content: data.answer,
        sources: data.sources 
      }]);

    } catch (error) {
      console.error("Hata:", error);
      setMessages([...newMessages, { role: 'assistant', content: "Bir hata oluştu. Backend çalışıyor mu?" }]);
    } finally {
      setLoading(false);
      setQuery("");
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 py-10 px-4 font-sans">
      <div className="max-w-3xl mx-auto">
        
        {/* Title */}
        <h1 className="text-4xl font-bold text-center text-blue-600 mb-8 tracking-tight">
          ChainRAG 🔗
        </h1>
        
        {/* Chat Box */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-6 h-[600px] overflow-y-auto mb-6 flex flex-col space-y-4">
          
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20">
              <p>Henüz bir mesaj yok. Blockchain hakkında bir soru sor!</p>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div 
              key={idx} 
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div 
                className={`max-w-[80%] p-4 rounded-2xl shadow-sm ${
                  msg.role === 'user' 
                    ? 'bg-blue-600 text-white rounded-br-none' 
                    : 'bg-gray-100 text-gray-800 border border-gray-200 rounded-bl-none'
                }`}
              >
                <div className="text-sm md:text-base leading-relaxed">
                  {msg.role === 'assistant' ? (
                    <ReactMarkdown
                      components={{
                        strong: ({node, ...props}) => <span className="font-bold" {...props} />,
                        ul: ({node, ...props}) => <ul className="list-disc pl-5 my-2" {...props} />,
                        ol: ({node, ...props}) => <ol className="list-decimal pl-5 my-2" {...props} />,
                        li: ({node, ...props}) => <li className="mb-1" {...props} />,
                        p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
                        a: ({node, ...props}) => <a className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
                
                {/* Sources Display */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-gray-300/50 text-xs opacity-75">
                    <span className="font-semibold">📚 Sources:</span> {msg.sources.length} documents scanned.
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start animate-pulse">
              <div className="bg-gray-200 p-4 rounded-2xl rounded-bl-none text-gray-500 text-sm">
                Typing...
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="flex gap-3 bg-white p-2 rounded-xl shadow-md border border-gray-200">
          <input 
            value={query} 
            onChange={(e) => setQuery(e.target.value)} 
            placeholder="E.g.: When was the last transfer by Vitalik?" 
            className="flex-1 p-3 outline-none text-gray-700 placeholder-gray-400 bg-transparent"
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            disabled={loading}
          />
          <button 
            onClick={handleSearch} 
            disabled={loading}
            className={`px-6 py-3 rounded-lg font-medium transition-colors duration-200 hover:cursor-pointer ${
              loading 
                ? 'bg-gray-300 cursor-not-allowed text-gray-500' 
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg'
            }`}
          >
            {loading ? '...' : 'Send'}
          </button>
        </div>

      </div>
    </div>
  );
}

export default App;