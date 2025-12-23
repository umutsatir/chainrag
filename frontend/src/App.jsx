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
                block: "start",
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
            statusMessage: "Hazırlanıyor...",
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
                content: "Bir hata oluştu. Backend çalışıyor mu?",
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
                <div className="text-center text-gray-400 mt-20">
                    <p>Adres girip yeni bir chat başlat.</p>
                </div>
            );
        }

        if (activeChat.status !== "done") {
            if (activeChat.status === "error") {
                return (
                    <div className="flex flex-col items-center justify-center h-full text-red-600 gap-2 text-sm">
                        <p>
                            Hazırlık hatası:{" "}
                            {activeChat.statusMessage || "Bilinmeyen hata."}
                        </p>
                        <p className="text-xs text-gray-400">
                            Tag: {activeChat.tag}
                        </p>
                    </div>
                );
            }
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

        if (activeMessages.length === 0) {
            return (
                <div className="text-center text-gray-400 mt-20">
                    <p>Henüz mesaj yok. Sorunu yaz.</p>
                </div>
            );
        }

        return activeMessages.map((msg, idx) => (
            <div
                ref={idx === activeMessages.length - 1 ? lastMessageRef : null}
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
                        <div className="bg-white border border-gray-200 rounded-xl shadow-md p-3 flex gap-2 items-center min-h-[56px]">
                            <input
                                value={addressInput}
                                onChange={(e) =>
                                    setAddressInput(e.target.value)
                                }
                                placeholder="Ethereum address"
                                className="flex-1 min-w-0 h-10 px-3 outline-none text-gray-700 placeholder-gray-400 bg-transparent text-sm truncate"
                                onKeyPress={(e) =>
                                    e.key === "Enter" && startChat()
                                }
                            />
                            <button
                                onClick={startChat}
                                className="h-10 px-4 rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg shrink-0 text-sm"
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
                                    <div
                                        key={chat.id}
                                        className={`w-full px-3 py-3 rounded-lg border text-sm transition flex items-start gap-2 ${
                                            chat.id === activeChatId
                                                ? "bg-blue-600 text-white border-blue-600"
                                                : "bg-white text-gray-700 border-gray-200 hover:border-blue-400"
                                        }`}
                                    >
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setActiveChatId(chat.id)
                                            }
                                            className="text-left flex-1"
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
                                                            ? "text-green-200 md:text-green-100"
                                                            : chat.status ===
                                                              "error"
                                                            ? "text-red-200 md:text-red-100"
                                                            : "text-gray-200 md:text-gray-100"
                                                    }
                                                >
                                                    {chat.status}
                                                </span>
                                            </div>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setChats((prev) => {
                                                    const filtered =
                                                        prev.filter(
                                                            (c) =>
                                                                c.id !== chat.id
                                                        );
                                                    if (
                                                        activeChatId === chat.id
                                                    ) {
                                                        const nextActive =
                                                            filtered[0]?.id ||
                                                            null;
                                                        setActiveChatId(
                                                            nextActive
                                                        );
                                                        setActiveMessages(
                                                            nextActive
                                                                ? loadMessages(
                                                                      nextActive
                                                                  )
                                                                : []
                                                        );
                                                    }
                                                    return filtered;
                                                });
                                                // Remove messages from storage as well
                                                if (
                                                    typeof window !==
                                                    "undefined"
                                                ) {
                                                    localStorage.removeItem(
                                                        `${MSG_KEY_PREFIX}${chat.id}`
                                                    );
                                                }
                                            }}
                                            className="text-xs px-2 py-1 rounded border border-red-500 text-white hover:bg-red-300 bg-red-500 transition font-semibold"
                                            title="Chat'i sil"
                                        >
                                            ✕ Sil
                                        </button>
                                    </div>
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
