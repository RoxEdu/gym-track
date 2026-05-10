import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Send, Loader2 } from "lucide-react";

const SUGGESTIONS = [
  "How is my progress looking?",
  "What should I focus on this week?",
  "Which muscles am I undertrained in?",
  "Explain my current split",
  "How do I fix a missed workout?",
  "When should I move to the next mesocycle?",
];

export default function Chat() {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const name = (user?.name || "").split(" ")[0] || "there";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (text) => {
    const content = (text || input).trim();
    if (!content || loading) return;
    setInput("");

    const userMsg = { role: "user", content };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setLoading(true);

    try {
      const r = await api.post("/chat", { messages: nextMessages });
      setMessages([...nextMessages, { role: "assistant", content: r.data.message }]);
    } catch {
      setMessages([...nextMessages, { role: "assistant", content: "Something went wrong. Try again." }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="px-5 pt-6 pb-3 flex-shrink-0">
        <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-1">/ coach</div>
        <h1 className="font-display text-3xl font-bold">Ask your coach</h1>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Hey {name} — ask me anything about your training, recovery, or program.
            </p>
            <div className="space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="w-full text-left text-sm px-4 py-3 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all font-mono text-muted-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-card border border-border rounded-bl-sm"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-card border border-border px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-2 text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              <span className="text-sm font-mono">thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-5 pb-6 pt-2 border-t border-border bg-background/95 backdrop-blur">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask anything…"
            rows={1}
            className="flex-1 bg-secondary border border-border rounded-xl px-4 py-3 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary max-h-32"
            style={{ fieldSizing: "content" }}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            className="w-11 h-11 bg-primary text-primary-foreground rounded-xl flex items-center justify-center disabled:opacity-40 transition-opacity flex-shrink-0"
          >
            <Send size={16} />
          </button>
        </div>
        {messages.length > 0 && (
          <p className="text-[10px] font-mono text-muted-foreground mt-2 text-center">
            Responses are AI-generated based on your actual training data.
          </p>
        )}
      </div>
    </div>
  );
}
