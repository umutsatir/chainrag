import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";

const API_BASE = "http://127.0.0.1:8000";
const META_KEY = "chainrag_chats_meta_v1";
const MSG_KEY_PREFIX = "chainrag_chat_msgs_v1_";

const sanitizeTag = (text) =>
    text
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "unknown";

function App() {
    const [addressInput, setAddressInput] = useState("");
    const [query, setQuery] = useState("");
    const [chats, setChats] = useState([]); // metadata only (no messages)
    const [activeChatId, setActiveChatId] = useState(null);
    const [activeMessages, setActiveMessages] = useState([]); // messages of active chat
    const [pollingTag, setPollingTag] = useState(null);
    const pollRef = useRef(null);
    const lastMessageRef = useRef(null);
    const hydratedRef = useRef(false);
    const prevChatsRef = useRef([]);

    const activeChat = chats.find((c) => c.id === activeChatId);

    // Scroll to the last message when messages change
    useEffect(() => {
        if (lastMessageRef.current) {
            lastMessageRef.current.scrollIntoView({
                behavior: "smooth",
                block: "end",
            });
        }
    }, [activeMessages]);

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
                // Status poll error - silent fail
            }
        };
        tick();
        pollRef.current = setInterval(tick, 3000);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [pollingTag]);

    const loadMessages = (chatId) => {
        if (!chatId || typeof window === "undefined") return [];
        try {
            const key = `${MSG_KEY_PREFIX}${chatId}`;
            const raw = localStorage.getItem(key);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        } catch (err) {
            // Failed to load messages - silent fail
        }
        return [];
    };

    const saveMessages = (chatId, msgs) => {
        if (!chatId || typeof window === "undefined") return;
        try {
            const key = `${MSG_KEY_PREFIX}${chatId}`;
            localStorage.setItem(key, JSON.stringify(msgs));
        } catch (err) {
            // Failed to save messages - silent fail
        }
    };

    // Load chats/activeChatId from localStorage on mount
    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const raw = localStorage.getItem(META_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.chats)) {
                    // Ensure all chats have loading: false on load (prevents stuck typing state)
                    const normalizedChats = parsed.chats.map((chat) => ({
                        ...chat,
                        loading: false, // Always reset loading state on refresh
                    }));
                    setChats(normalizedChats);
                    prevChatsRef.current = normalizedChats; // Track loaded chats

                    // Determine active chat ID: prefer saved one, but verify it exists
                    let initialId = null;
                    if (parsed.activeChatId) {
                        // Verify the saved activeChatId actually exists in chats
                        const chatExists = normalizedChats.some(
                            (c) => c.id === parsed.activeChatId
                        );
                        if (chatExists) {
                            initialId = parsed.activeChatId;
                        } else if (normalizedChats.length > 0) {
                            // Fallback to first chat if saved ID doesn't exist
                            initialId = normalizedChats[0].id;
                        }
                    } else if (normalizedChats.length > 0) {
                        initialId = normalizedChats[0].id;
                    }

                    setActiveChatId(initialId);
                    if (initialId) {
                        const msgs = loadMessages(initialId);
                        setActiveMessages(msgs);
                    } else {
                        setActiveMessages([]);
                    }
                }
            }
            // Mark as hydrated after initial load completes (even if no data)
            hydratedRef.current = true;
        } catch (err) {
            // Failed to load chats meta - still mark as hydrated
            hydratedRef.current = true;
        }
    }, []);

    // Persist chats + activeChatId to localStorage whenever they change
    useEffect(() => {
        if (typeof window === "undefined") return;
        // Don't save until initial hydration is complete
        if (!hydratedRef.current) {
            return;
        }

        // Safety check: Don't overwrite with empty chats if we had chats before
        // This prevents accidental deletion during re-renders
        const hadChats = prevChatsRef.current.length > 0;
        const hasChats = chats.length > 0;

        if (!hasChats && hadChats) {
            return; // Don't save empty chats if we had chats before
        }

        try {
            localStorage.setItem(
                META_KEY,
                JSON.stringify({ chats, activeChatId })
            );
            prevChatsRef.current = chats;
        } catch (err) {
            // Failed to save chats meta - silent fail
        }
    }, [chats, activeChatId]);

    // When activeChatId changes, load its messages
    useEffect(() => {
        if (!activeChatId) {
            setActiveMessages([]);
            return;
        }
        const msgs = loadMessages(activeChatId);
        setActiveMessages(msgs);
    }, [activeChatId]);

    const startChat = async () => {
        if (!addressInput) return;
        const tag = sanitizeTag(addressInput);
        const newChat = {
            id: `chat-${Date.now()}`,
            address: addressInput,
            tag,
            status: "preparing",
            statusMessage: "Preparing...",
            loading: false,
        };
        setChats((prev) => [...prev, newChat]);
        setActiveChatId(newChat.id);
        saveMessages(newChat.id, []);
        setActiveMessages([]);
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
            setChats((prev) =>
                prev.map((chat) =>
                    chat.id === newChat.id
                        ? {
                              ...chat,
                              status: "error",
                              statusMessage: "Preparation failed.",
                          }
                        : chat
                )
            );
        }
    };

    const sendMessage = async () => {
        if (!activeChat || !query || activeChat.status !== "done") return;
        const userMsg = { role: "user", content: query };
        const updatedMessages = [...activeMessages, userMsg];

        setActiveMessages(updatedMessages);
        saveMessages(activeChat.id, updatedMessages);
        setChats((prev) =>
            prev.map((c) =>
                c.id === activeChat.id ? { ...c, loading: true } : c
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
            const finalMessages = [...updatedMessages, assistantMsg];
            setActiveMessages(finalMessages);
            saveMessages(activeChat.id, finalMessages);
            setChats((prev) =>
                prev.map((c) =>
                    c.id === activeChat.id
                        ? {
                              ...c,
                              loading: false,
                          }
                        : c
                )
            );
        } catch (err) {
            const errorMsg = {
                role: "assistant",
                content: "An error occurred. Is the backend running?",
            };
            const finalMessages = [...updatedMessages, errorMsg];
            setActiveMessages(finalMessages);
            saveMessages(activeChat.id, finalMessages);
            setChats((prev) =>
                prev.map((c) =>
                    c.id === activeChat.id
                        ? {
                              ...c,
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
                <div className="flex flex-col items-center justify-center h-full text-slate-400 opacity-60">
                    <div className="text-6xl mb-4">💬</div>
                    <p className="text-lg font-medium">Select or start a chat to begin</p>
                </div>
            );
        }

        if (activeChat.status !== "done") {
            if (activeChat.status === "error") {
                return (
                    <div className="flex flex-col items-center justify-center h-full text-red-500 gap-3">
                        <div className="bg-red-50 p-4 rounded-full">
                            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <div className="text-center">
                            <p className="font-semibold">Preparation Error</p>
                            <p className="text-sm opacity-80">{activeChat.statusMessage || "Unknown error."}</p>
                        </div>
                    </div>
                );
            }
            return (
                <div className="flex flex-col items-center justify-center h-full text-indigo-600 gap-4">
                    <div className="relative">
                        <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                    </div>
                    <div className="text-center">
                        <p className="font-medium text-slate-600">{activeChat.statusMessage || "Preparing..."}</p>
                        <p className="text-xs text-slate-400 mt-1 font-mono bg-slate-100 px-2 py-1 rounded-md inline-block">
                            Tag: {activeChat.tag}
                        </p>
                    </div>
                </div>
            );
        }

        if (activeMessages.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-slate-400">
                    <p className="text-lg">No messages yet.</p>
                    <p className="text-sm">Type your question below to start analyzing.</p>
                </div>
            );
        }

        return activeMessages.map((msg, idx) => (
            <div
                ref={idx === activeMessages.length - 1 ? lastMessageRef : null}
                key={idx}
                className={`flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                } mb-4`}
            >
                <div
                    className={`max-w-[85%] md:max-w-[75%] p-4 rounded-2xl shadow-sm text-sm md:text-base break-words overflow-hidden ${
                        msg.role === "user"
                            ? "bg-indigo-600 text-white rounded-br-none"
                            : "bg-white text-slate-700 border border-slate-100 rounded-bl-none"
                    }`}
                >
                    <div className="leading-relaxed">
                        {msg.role === "assistant" ? (
                            <ReactMarkdown
                                components={{
                                    strong: ({ node, ...props }) => (
                                        <span className="font-bold text-indigo-900" {...props} />
                                    ),
                                    ul: ({ node, ...props }) => (
                                        <ul className="list-disc pl-5 my-2 space-y-1" {...props} />
                                    ),
                                    ol: ({ node, ...props }) => (
                                        <ol className="list-decimal pl-5 my-2 space-y-1" {...props} />
                                    ),
                                    li: ({ node, ...props }) => (
                                        <li className="" {...props} />
                                    ),
                                    p: ({ node, ...props }) => (
                                        <p className="mb-2 last:mb-0" {...props} />
                                    ),
                                    a: ({ node, ...props }) => (
                                        <a className="text-indigo-500 hover:underline font-medium" target="_blank" rel="noopener noreferrer" {...props} />
                                    ),
                                    code: ({ node, inline, className, children, ...props }) => (
                                        <code className={`${inline ? "bg-slate-100 text-slate-800 px-1 py-0.5 rounded text-xs font-mono" : "block bg-slate-800 text-slate-100 p-3 rounded-lg overflow-x-auto text-xs my-2"}`} {...props}>
                                            {children}
                                        </code>
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
                        <div className="mt-3 pt-3 border-t border-slate-200/50 text-xs opacity-70 flex items-center gap-1">
                            <span>📚</span>
                            <span className="font-medium">{msg.sources.length} sources</span>
                        </div>
                    )}
                </div>
            </div>
        ));
    };

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex justify-center py-4 px-4 md:px-8">
            <div className="w-full max-w-7xl grid grid-cols-12 gap-6 h-[92vh]">
                
                {/* Sidebar */}
                <div className="col-span-12 md:col-span-4 lg:col-span-3 flex flex-col gap-4 h-full min-h-0">
                    {/* Header / Logo */}
                    <div className="flex items-center gap-2 px-2">
                        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">C</div>
                        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">ChainRAG</h1>
                    </div>

                    {/* New Chat Input */}
                    <div className="bg-white p-1.5 rounded-xl shadow-sm border border-slate-200 flex gap-2">
                        <input
                            value={addressInput}
                            onChange={(e) => setAddressInput(e.target.value)}
                            placeholder="0x..."
                            className="flex-1 min-w-0 h-10 px-3 outline-none text-slate-700 placeholder-slate-400 bg-transparent text-sm font-mono"
                            onKeyPress={(e) => e.key === "Enter" && startChat()}
                        />
                        <button
                            onClick={startChat}
                            className="h-10 px-4 rounded-lg font-medium bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all text-sm whitespace-nowrap"
                        >
                            + New
                        </button>
                    </div>

                    {/* Chat List */}
                    <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
                        <div className="p-3 border-b border-slate-100 bg-slate-50/50">
                            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Recent Chats</h2>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {chats.length === 0 && (
                                <div className="text-center text-slate-400 text-sm py-10 px-4">
                                    No active sessions. Start a new chat above.
                                </div>
                            )}
                            {chats.map((chat) => (
                                <div
                                    key={chat.id}
                                    onClick={() => setActiveChatId(chat.id)}
                                    className={`group w-full p-3 rounded-xl text-sm transition-all cursor-pointer border ${
                                        chat.id === activeChatId
                                            ? "bg-indigo-50 border-indigo-200 shadow-sm"
                                            : "bg-transparent border-transparent hover:bg-slate-50 hover:border-slate-100"
                                    }`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <span className={`font-mono font-medium ${chat.id === activeChatId ? "text-indigo-700" : "text-slate-700"}`}>
                                            {chat.address.slice(0, 6)}...{chat.address.slice(-4)}
                                        </span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setChats((prev) => {
                                                    const filtered = prev.filter((c) => c.id !== chat.id);
                                                    if (activeChatId === chat.id) {
                                                        const nextActive = filtered[0]?.id || null;
                                                        setActiveChatId(nextActive);
                                                        setActiveMessages(nextActive ? loadMessages(nextActive) : []);
                                                    }
                                                    return filtered;
                                                });
                                                if (typeof window !== "undefined") {
                                                    localStorage.removeItem(`${MSG_KEY_PREFIX}${chat.id}`);
                                                }
                                            }}
                                            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity p-1"
                                            title="Delete"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-slate-400 truncate max-w-[100px]">{chat.tag}</span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                            chat.status === "done" ? "bg-green-100 text-green-700" :
                                            chat.status === "error" ? "bg-red-100 text-red-700" :
                                            "bg-amber-100 text-amber-700"
                                        }`}>
                                            {chat.status === "done" ? "Ready" : chat.status}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Main Chat Area */}
                <div className="col-span-12 md:col-span-8 lg:col-span-9 flex flex-col h-full gap-4 min-h-0">
                    {/* Messages */}
                    <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col relative">
                        <div className="flex-1 overflow-y-auto p-6">
                            {renderMessages()}
                            {activeChat?.loading && (
                                <div className="flex justify-start animate-pulse mt-4">
                                    <div className="bg-slate-100 px-4 py-3 rounded-2xl rounded-bl-none text-slate-500 text-sm flex items-center gap-2">
                                        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        {/* Input Area */}
                        <div className="p-4 bg-white border-t border-slate-100">
                            <div className="flex gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200 focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-500/10 transition-all">
                                <input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder={activeChat?.status === "done" ? "Ask about transactions, balances, or patterns..." : "Waiting for preparation..."}
                                    className="flex-1 px-3 bg-transparent outline-none text-slate-700 placeholder-slate-400"
                                    onKeyPress={(e) => e.key === "Enter" && sendMessage()}
                                    disabled={!activeChat || activeChat.status !== "done" || activeChat.loading}
                                />
                                <button
                                    onClick={sendMessage}
                                    disabled={!activeChat || activeChat.status !== "done" || activeChat.loading}
                                    className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
                                        !activeChat || activeChat.status !== "done" || activeChat.loading
                                            ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                                            : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-md hover:shadow-lg active:scale-95"
                                    }`}
                                >
                                    <span>Send</span>
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                </button>
                            </div>
                            <div className="text-center mt-2">
                                <p className="text-[10px] text-slate-400">AI can make mistakes. Verify important transaction data.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default App;
