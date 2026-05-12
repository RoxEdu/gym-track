import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Sparkles, Send, Loader2, CheckCircle, XCircle, AlertCircle, ArrowRight } from "lucide-react";

const _MUSCLE_MAP = {
  hamstring: "hamstrings", hamstrings: "hamstrings",
  quad: "quads", quads: "quads", quadricep: "quads",
  chest: "chest", pec: "chest",
  "lower back": "lower_back", back: "upper_back",
  lats: "lats", lat: "lats",
  shoulder: "side_delt", delt: "side_delt",
  calf: "calves", calves: "calves",
  bicep: "biceps", biceps: "biceps",
  tricep: "triceps", triceps: "triceps",
  glute: "glutes", glutes: "glutes", hip: "glutes",
  knee: "quads", wrist: "biceps", elbow: "triceps",
};

function detectIntent(text) {
  const t = text.toLowerCase();

  // Reschedule: user mentions fewer training days/times/sessions/workouts
  const U = "(?:days?|times?|sessions?|workouts?)";
  const dayPatterns = [
    new RegExp(`(?:only|just|can only|have only|only have|limited to)(?:\\s+(?:workout|train|exercise|work\\s*out|go to (?:the\\s+)?gym))?\\s+(?:for\\s+)?(\\d)\\s*${U}`),
    new RegExp(`(\\d)\\s*${U}\\s+(?:this|a|per|each)\\s+week`),
    new RegExp(`(?:train|workout|work\\s*out|exercise|gym|go to (?:the\\s+)?gym)\\s+(?:only\\s+|for\\s+)?(\\d)\\s*${U}`),
    new RegExp(`(\\d)\\s*${U}\\s+(?:available|left|only|remaining)`),
    new RegExp(`reduce.*?(\\d)\\s*${U}`),
    new RegExp(`(?:cut\\s+(?:down\\s+)?to|drop\\s+to|down\\s+to)\\s+(\\d)\\s*${U}`),
  ];
  for (const pat of dayPatterns) {
    const m = t.match(pat);
    if (m) {
      const days = parseInt(m[1], 10);
      if (days >= 1 && days <= 6) return { type: "reschedule_week", days };
    }
  }

  const injuryWords = ["injur", "hurt", "pain", "sore", "strain", "sprain", "torn", "rest my", "can't use", "cannot use", "bad knee", "bad shoulder", "bad back"];
  const looksLikeInjury = injuryWords.some(w => t.includes(w));

  if (!looksLikeInjury) {
    const replacePatterns = [
      /(?:can[' ]?t|cannot|don[' ]?t want to|won[' ]?t)\s+do\s+([a-z0-9\-\s]+?)(?:\s+today|\s+this\s+week|[.,!?]|$)/,
      /(?:replace|swap|switch(?:\s+out)?|sub(?:stitute)?|change)\s+(?:the\s+|my\s+)?([a-z0-9\-\s]+?)(?:\s+(?:for|with)\b|[.,!?]|$)/,
      /(?:skip|no|drop)\s+(?:the\s+|my\s+)?([a-z0-9\-\s]+?)(?:\s+today|\s+this\s+week|[.,!?]|$)/,
      /(?:i\s+hate|i\s+can[' ]?t\s+stand)\s+([a-z0-9\-\s]+?)(?:[.,!?]|$)/,
    ];
    for (const pat of replacePatterns) {
      const m = t.match(pat);
      if (m) {
        const query = m[1].replace(/^(?:any|some|the|a|my)\s+/, "").trim();
        if (query.length >= 3 && !["it", "that", "this", "them", "stuff", "things"].includes(query)) {
          return { type: "replace_exercise", exercise_query: query };
        }
      }
    }
  }

  if (looksLikeInjury || t.includes("avoid") || t.includes("skip")) {
    for (const [key, val] of Object.entries(_MUSCLE_MAP)) {
      if (t.includes(key)) return { type: "remove_exercises", muscle_groups: [val] };
    }
  }

  const volumeWords = ["not growing", "not getting bigger", "lagging", "weak point", "need more", "focus more on", "improve my", "bring up", "prioritize"];
  if (volumeWords.some(w => t.includes(w))) {
    for (const [key, val] of Object.entries(_MUSCLE_MAP)) {
      if (t.includes(key)) return { type: "add_volume", muscle_groups: [val], extra_sets: 2 };
    }
  }

  return null;
}

function _isEmptyAction(action) {
  if (!action) return true;
  if (action.type === "reschedule_week") return !(action.new_workouts || []).length;
  if (action.type === "remove_exercises") return !(action.removals || []).length;
  if (action.type === "add_volume") return !(action.additions || []).length;
  if (action.type === "replace_exercise") return !(action.swaps || []).length;
  return false;
}

const DEFAULT_SUGGESTIONS = [
  "I can only train 3 days this week",
  "My calf is sore, give it a rest",
  "I can't do pull-ups today, swap them",
  "My chest is lagging, focus more on it",
  "How is my progress looking?",
  "When should I move to the next mesocycle?",
];

export default function CoachChat({ name = "there", suggestions = DEFAULT_SUGGESTIONS, intro }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, pendingAction, applyResult]);

  const send = async (text) => {
    const content = (text || input).trim();
    if (!content || loading) return;
    setInput("");
    setPendingAction(null);
    setApplyResult(null);

    const userMsg = { role: "user", content };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setLoading(true);

    try {
      const intent = detectIntent(content);
      const [chatResult, previewResult] = await Promise.allSettled([
        api.post("/chat", { messages: nextMessages }),
        intent ? api.post("/coach/preview", intent) : Promise.resolve(null),
      ]);

      if (chatResult.status === "rejected") throw chatResult.reason;
      const chatData = chatResult.value.data;
      setMessages([...nextMessages, { role: "assistant", content: chatData.message }]);

      if (previewResult.status === "fulfilled" && previewResult.value?.data) {
        setPendingAction(previewResult.value.data);
      } else if (chatData.action) {
        setPendingAction(chatData.action);
      }
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.response?.status || err?.message || "unknown";
      setMessages([...nextMessages, { role: "assistant", content: `Sorry, something went wrong. (${detail})` }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const applyAction = async () => {
    if (!pendingAction) return;
    setApplying(true);
    try {
      const r = await api.post("/coach/apply", { type: pendingAction.type, payload: pendingAction });
      setApplyResult({ ok: true, message: r.data.message });
      setPendingAction(null);
    } catch {
      setApplyResult({ ok: false, message: "Failed to apply changes. Please try again." });
    } finally {
      setApplying(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="space-y-3">
      {messages.length === 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {intro || `Hey ${name}. I've got your week in front of me — tell me what's going on and we'll figure it out together.`}
          </p>
          <div className="space-y-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="w-full text-left text-sm px-4 py-2.5 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all font-mono text-muted-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.length > 0 && (
        <div className="space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-secondary border border-border rounded-bl-sm"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}

          {pendingAction && pendingAction.type === "no_program" && (
            <div className="border-2 border-orange-500/50 bg-orange-500/10 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} className="text-orange-400" />
                <span className="text-xs font-mono font-bold uppercase tracking-widest text-orange-400">Set up your program first</span>
              </div>
              <p className="text-sm text-foreground leading-relaxed">{pendingAction.summary}</p>
              <button
                onClick={() => navigate(pendingAction.cta_path || "/today")}
                className="w-full flex items-center justify-center gap-1.5 py-3 bg-orange-500 text-white rounded-xl text-sm font-mono font-bold hover:bg-orange-600 transition-colors"
              >
                <ArrowRight size={14} />
                {pendingAction.cta_label || "Set up program"}
              </button>
            </div>
          )}

          {pendingAction && pendingAction.type !== "no_program" && (
            <div className="border-2 border-primary bg-primary/10 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-primary" />
                <span className="text-xs font-mono font-bold uppercase tracking-widest text-primary">Coach proposal — tap to apply</span>
              </div>
              <pre className="text-sm text-foreground whitespace-pre-wrap leading-relaxed font-sans">{pendingAction.summary}</pre>
              <div className="flex gap-2">
                <button
                  onClick={applyAction}
                  disabled={applying || _isEmptyAction(pendingAction)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-mono font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                  {applying ? "Applying…" : _isEmptyAction(pendingAction) ? "Nothing to apply" : "Apply changes"}
                </button>
                <button
                  onClick={() => setPendingAction(null)}
                  disabled={applying}
                  className="px-4 py-3 border border-border rounded-xl text-sm font-mono text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {applyResult && (
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-mono ${applyResult.ok ? "bg-primary/10 text-primary border border-primary/30" : "bg-destructive/10 text-destructive border border-destructive/30"}`}>
              {applyResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
              {applyResult.message}
            </div>
          )}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-secondary border border-border px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-2 text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-sm font-mono">thinking…</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 items-end pt-1">
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
        <p className="text-[10px] font-mono text-muted-foreground text-center">
          Responses are AI-generated based on your actual training data.
        </p>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
