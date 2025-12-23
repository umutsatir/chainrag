import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";

const API_BASE = "http://127.0.0.1:8000";

const sanitizeTag = (text) =>
    text
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "unknown";

function App() {
    const [addressInput, setAddressInput] = useState("");
    const [query, setQuery] = useState("");
    const [chats, setChats] = useState([]);
    const [activeChatId, setActiveChatId] = useState(null);
    const [pollingTag, setPollingTag] = useState(null);
    const pollRef = useRef(null);
    const lastMessageRef = useRef(null);

    const activeChat = chats.find((c) => c.id === activeChatId);

    // Scroll to the last message when chat changes
    useEffect(() => {
        if (lastMessageRef.current) {
            lastMessageRef.current.scrollIntoView({
                behavior: "smooth",
                block: "start",
            });
        }
    }, [activeChat?.messages]);

    // Poll backend for preparation status
    useEffect(() => {
        if (!pollingTag) return;
        const tick = async () => {
            try {
                const res = await fetch(
                    `${API_BASE}/prepare/status?tag=${pollingTag}`
                );
                const data = await res.json();
                const status = data.status || {};
                setChats((prev) =>
                    prev.map((chat) =>
                        chat.tag === pollingTag
                            ? {
                                  ...chat,
                                  status: status.state,
                                  statusMessage: status.message,
                              }
                            : chat
                    )
                );
                if (status.state === "done" || status.state === "error") {
                    setPollingTag(null);
                    if (pollRef.current) clearInterval(pollRef.current);
                }
            } catch (err) {
                console.error("Status poll error", err);
            }
        };
        tick();
        pollRef.current = setInterval(tick, 3000);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [pollingTag]);

    const startChat = async () => {
        if (!addressInput) return;
        const tag = sanitizeTag(addressInput);
        const newChat = {
            id: `chat-${Date.now()}`,
            address: addressInput,
            tag,
            status: "preparing",
            statusMessage: "Hazırlanıyor...",
            messages: [],
            loading: false,
        };
        setChats((prev) => [...prev, newChat]);
        setActiveChatId(newChat.id);
        setAddressInput("");

        try {
            const res = await fetch(`${API_BASE}/prepare`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address: addressInput }),
            });
            if (!res.ok) throw new Error(`Prepare failed ${res.status}`);
            const data = await res.json();
            const status = data.status || {};
            setChats((prev) =>
                prev.map((chat) =>
                    chat.id === newChat.id
                        ? {
                              ...chat,
                              status: status.state || "preparing",
                              statusMessage: status.message,
                          }
                        : chat
                )
            );
            setPollingTag(tag);
        } catch (err) {
            console.error(err);
            setChats((prev) =>
                prev.map((chat) =>
                    chat.id === newChat.id
                        ? {
                              ...chat,
                              status: "error",
                              statusMessage: "Hazırlık başlatılamadı.",
                          }
                        : chat
                )
            );
        }
    };

    const sendMessage = async () => {
        if (!activeChat || !query || activeChat.status !== "done") return;
        const userMsg = { role: "user", content: query };
        const updatedMessages = [...activeChat.messages, userMsg];

        setChats((prev) =>
            prev.map((c) =>
                c.id === activeChat.id
                    ? { ...c, messages: updatedMessages, loading: true }
                    : c
            )
        );
        setQuery("");

        try {
            const res = await fetch(`${API_BASE}/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    query: userMsg.content,
                    tag: activeChat.tag,
                }),
            });
            if (!res.ok) throw new Error(`Chat failed ${res.status}`);
            const data = await res.json();
            const assistantMsg = {
                role: "assistant",
                content: data.answer,
                sources: data.sources,
            };
            setChats((prev) =>
                prev.map((c) =>
                    c.id === activeChat.id
                        ? {
                              ...c,
                              messages: [...updatedMessages, assistantMsg],
                              loading: false,
                          }
                        : c
                )
            );
        } catch (err) {
            console.error(err);
            const errorMsg = {
                role: "assistant",
                content: "Bir hata oluştu. Backend çalışıyor mu?",
            };
            setChats((prev) =>
                prev.map((c) =>
                    c.id === activeChat.id
                        ? {
                              ...c,
                              messages: [...updatedMessages, errorMsg],
                              loading: false,
                          }
                        : c
                )
            );
        }
    };

    const renderMessages = () => {
        if (!activeChat) {
            return (
                <div className="text-center text-gray-400 mt-20">
                    <p>Adres girip yeni bir chat başlat.</p>
                </div>
            );
        }

        if (activeChat.status !== "done") {
            return (
                <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
                    <p>{activeChat.statusMessage || "Hazırlanıyor..."}</p>
                    <p className="text-xs text-gray-400">
                        Tag: {activeChat.tag}
                    </p>
                </div>
            );
        }

        if (activeChat.messages.length === 0) {
            return (
                <div className="text-center text-gray-400 mt-20">
                    <p>Henüz mesaj yok. Sorunu yaz.</p>
                </div>
            );
        }

        return activeChat.messages.map((msg, idx) => (
            <div
                ref={
                    idx === activeChat.messages.length - 1
                        ? lastMessageRef
                        : null
                }
                key={idx}
                className={`flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                }`}
            >
                <div
                    className={`max-w-[80%] p-4 rounded-2xl shadow-sm wrap-break-word whitespace-pre-wrap ${
                        msg.role === "user"
                            ? "bg-blue-600 text-white rounded-br-none"
                            : "bg-gray-100 text-gray-800 border border-gray-200 rounded-bl-none"
                    }`}
                >
                    <div className="text-sm md:text-base leading-relaxed">
                        {msg.role === "assistant" ? (
                            <ReactMarkdown
                                components={{
                                    strong: ({ node, ...props }) => (
                                        <span
                                            className="font-bold"
                                            {...props}
                                        />
                                    ),
                                    ul: ({ node, ...props }) => (
                                        <ul
                                            className="list-disc pl-5 my-2"
                                            {...props}
                                        />
                                    ),
                                    ol: ({ node, ...props }) => (
                                        <ol
                                            className="list-decimal pl-5 my-2"
                                            {...props}
                                        />
                                    ),
                                    li: ({ node, ...props }) => (
                                        <li className="mb-1" {...props} />
                                    ),
                                    p: ({ node, ...props }) => (
                                        <p
                                            className="mb-2 last:mb-0"
                                            {...props}
                                        />
                                    ),
                                    a: ({ node, ...props }) => (
                                        <a
                                            className="text-blue-600 hover:underline"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            {...props}
                                        />
                                    ),
                                }}
                            >
                                {msg.content}
                            </ReactMarkdown>
                        ) : (
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                        )}
                    </div>
                    {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-3 pt-2 border-top border-gray-300/50 text-xs opacity-75">
                            <span className="font-semibold">📚 Sources:</span>{" "}
                            {msg.sources.length} documents scanned.
                        </div>
                    )}
                </div>
            </div>
        ));
    };

    return (
        <div className="min-h-screen bg-gray-100 py-10 px-4 font-sans flex justify-center">
            <div className="w-[90vw] max-w-7xl">
                <h1 className="text-4xl font-bold text-center text-blue-600 mb-8 tracking-tight">
                    ChainRAG 🔗
                </h1>

                <div className="grid grid-cols-12 gap-4">
                    {/* Sidebar */}
                    <div className="col-span-12 md:col-span-4 lg:col-span-3 space-y-4">
                        {/* New chat creator */}
                        <div className="bg-white border border-gray-200 rounded-xl shadow-md p-3 flex gap-2 items-center h-14">
                            <input
                                value={addressInput}
                                onChange={(e) =>
                                    setAddressInput(e.target.value)
                                }
                                placeholder="Ethereum address (public key)"
                                className="flex-1 h-12 px-3 outline-none text-gray-700 placeholder-gray-400 bg-transparent"
                                onKeyPress={(e) =>
                                    e.key === "Enter" && startChat()
                                }
                            />
                            <button
                                onClick={startChat}
                                className="h-12 px-5 rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg"
                            >
                                Yeni
                            </button>
                        </div>

                        {/* Chat list */}
                        <div className="bg-white border border-gray-200 rounded-xl shadow-md p-3 h-[640px] overflow-y-auto">
                            {chats.length === 0 && (
                                <div className="text-center text-gray-400 text-sm py-10">
                                    Henüz chat yok.
                                </div>
                            )}
                            <div className="flex flex-col gap-2">
                                {chats.map((chat) => (
                                    <button
                                        key={chat.id}
                                        onClick={() => setActiveChatId(chat.id)}
                                        className={`text-left w-full px-3 py-3 rounded-lg border text-sm transition ${
                                            chat.id === activeChatId
                                                ? "bg-blue-600 text-white border-blue-600"
                                                : "bg-white text-gray-700 border-gray-200 hover:border-blue-400"
                                        }`}
                                    >
                                        <div className="font-semibold">
                                            {chat.address.slice(0, 6)}...
                                            {chat.address.slice(-4)}
                                        </div>
                                        <div className="text-xs opacity-80">
                                            Tag: {chat.tag}
                                        </div>
                                        <div className="text-xs">
                                            Durum:{" "}
                                            <span
                                                className={
                                                    chat.status === "done"
                                                        ? "text-green-600"
                                                        : chat.status ===
                                                          "error"
                                                        ? "text-red-600"
                                                        : "text-gray-600"
                                                }
                                            >
                                                {chat.status}
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Chat area */}
                    <div className="col-span-12 md:col-span-8 lg:col-span-9 space-y-4">
                        <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-6 h-[600px] overflow-y-auto flex flex-col space-y-4">
                            {renderMessages()}
                            {activeChat?.loading && (
                                <div className="flex justify-start animate-pulse">
                                    <div className="bg-gray-200 p-4 rounded-2xl rounded-bl-none text-gray-500 text-sm">
                                        Typing...
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 bg-white p-2 rounded-xl shadow-md border border-gray-200">
                            <input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Sorunu yaz (aktif chat'in DB'si kullanılacak)"
                                className="flex-1 p-3 outline-none text-gray-700 placeholder-gray-400 bg-transparent"
                                onKeyPress={(e) =>
                                    e.key === "Enter" && sendMessage()
                                }
                                disabled={
                                    !activeChat ||
                                    activeChat.status !== "done" ||
                                    activeChat.loading
                                }
                            />
                            <button
                                onClick={sendMessage}
                                disabled={
                                    !activeChat ||
                                    activeChat.status !== "done" ||
                                    activeChat.loading
                                }
                                className={`px-6 py-3 rounded-lg font-medium transition-colors duration-200 hover:cursor-pointer ${
                                    !activeChat ||
                                    activeChat.status !== "done" ||
                                    activeChat.loading
                                        ? "bg-gray-300 cursor-not-allowed text-gray-500"
                                        : "bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg"
                                }`}
                            >
                                Gönder
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default App;
