import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";
import { Sparkles, RefreshCw, ChevronDown, ChevronUp, ShieldCheck, ShieldAlert, Send, Loader2, MessageCircle, CheckCircle, XCircle } from "lucide-react";

const SUGGESTIONS = [
  "I can only train 3 days this week",
  "My calf is sore, give it a rest",
  "I can't do pull-ups today, swap them",
  "My chest is lagging, focus more on it",
  "How is my progress looking?",
  "When should I move to the next mesocycle?",
];

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

  // Reschedule: user mentions fewer training days
  const dayPatterns = [
    /(?:only|just|can only|have only|only have|limited to)\s+(\d)\s*days?/,
    /(\d)\s*days?\s+(?:this|a|per)\s+week/,
    /(?:train|workout|work\s*out|exercise|gym)\s+(?:only\s+)?(\d)\s*days?/,
    /(\d)\s*days?\s+(?:available|left|only|remaining)/,
    /reduce.*?(\d)\s*days?/,
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

  // Replace specific exercise: "can't do pull-ups", "swap bench press", etc.
  // Skip if the message reads as an injury+muscle-group complaint — the remove handler is preferred.
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

  // Injury: avoid muscle exercises
  if (looksLikeInjury || t.includes("avoid") || t.includes("skip")) {
    for (const [key, val] of Object.entries(_MUSCLE_MAP)) {
      if (t.includes(key)) return { type: "remove_exercises", muscle_groups: [val] };
    }
  }

  // Volume: lagging muscle
  const volumeWords = ["not growing", "not getting bigger", "lagging", "weak point", "need more", "focus more on", "improve my", "bring up", "prioritize"];
  if (volumeWords.some(w => t.includes(w))) {
    for (const [key, val] of Object.entries(_MUSCLE_MAP)) {
      if (t.includes(key)) return { type: "add_volume", muscle_groups: [val], extra_sets: 2 };
    }
  }

  return null;
}

export default function Insights() {
  const { user } = useAuth();
  const [data, setData] = useState({ insights: [], weekly_volume: {}, previous_weekly_volume: {}, landmarks: {}, recovery: {}, digest: null, streak_days: 0, weak_subgroups: [], top_movers: [] });
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [showDigestData, setShowDigestData] = useState(false);

  // Coach chat state
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // proposed plan change
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const name = (user?.name || "").split(" ")[0] || "there";

  const load = () => api.get("/insights").then(r => setData(r.data));
  useEffect(() => { load(); }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatLoading]);

  const generateDigest = async () => {
    setGenerating(true);
    try {
      const r = await api.post("/insights/digest");
      setData((d) => ({ ...d, digest: r.data }));
    } finally { setGenerating(false); }
  };

  const send = async (text) => {
    const content = (text || input).trim();
    if (!content || chatLoading) return;
    setInput("");
    setPendingAction(null);
    setApplyResult(null);

    const userMsg = { role: "user", content };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setChatLoading(true);

    try {
      const intent = detectIntent(content);

      const [chatResult, previewResult] = await Promise.allSettled([
        api.post("/chat", { messages: nextMessages }),
        intent ? api.post("/coach/preview", intent) : Promise.resolve(null),
      ]);

      if (chatResult.status === "rejected") throw chatResult.reason;

      const chatData = chatResult.value.data;
      setMessages([...nextMessages, { role: "assistant", content: chatData.message }]);

      // Client-side intent wins; fall back to chat's returned action
      if (previewResult.status === "fulfilled" && previewResult.value?.data) {
        setPendingAction(previewResult.value.data);
      } else if (chatData.action) {
        setPendingAction(chatData.action);
      }
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.response?.status || err?.message || "unknown";
      setMessages([...nextMessages, { role: "assistant", content: `Sorry, something went wrong. (${detail})` }]);
    } finally {
      setChatLoading(false);
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

  const digest = data.digest;
  const digestSourceLabel = {
    llm: { label: "Claude Sonnet 4.5", icon: ShieldCheck, color: "text-primary" },
    fallback: { label: "Rule-based", icon: ShieldAlert, color: "text-muted-foreground" },
    guard_failed: { label: "Guard intercepted — using safe fallback", icon: ShieldAlert, color: "text-orange-400" },
  }[digest?.source] || { label: "", icon: null, color: "" };
  const SourceIcon = digestSourceLabel.icon;

  return (
    <div className="max-w-2xl mx-auto px-5 py-6 space-y-5" data-testid="insights-page">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-1">/ insights</div>
          <h1 className="font-display text-3xl font-bold">Signals</h1>
        </div>
        {data.streak_days >= 2 && (
          <div className="text-right">
            <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">streak</div>
            <div className="font-display text-2xl text-primary font-semibold" data-testid="streak-days">{data.streak_days}d</div>
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-primary" />
            <div className="text-[10px] font-mono uppercase tracking-widest text-primary">Weekly digest</div>
            {digest && SourceIcon && (
              <span className={`text-[9px] font-mono uppercase tracking-widest flex items-center gap-1 ${digestSourceLabel.color}`} data-testid="digest-source">
                <SourceIcon size={10} /> {digestSourceLabel.label}
              </span>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={generateDigest} disabled={generating} data-testid="generate-digest-btn">
            <RefreshCw size={12} className={`mr-1 ${generating ? "animate-spin" : ""}`} /> {digest ? "Refresh" : "Generate"}
          </Button>
        </div>
        {digest ? (
          <>
            <p className="text-sm leading-relaxed whitespace-pre-line">{digest.text}</p>
            {digest.data_snapshot && (
              <button onClick={() => setShowDigestData(s => !s)} className="mt-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground flex items-center gap-1" data-testid="digest-see-data">
                {showDigestData ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {showDigestData ? "Hide" : "See"} the data
              </button>
            )}
            {showDigestData && digest.data_snapshot && (
              <div className="mt-2 p-3 bg-secondary/40 rounded-md text-[11px] font-mono space-y-1.5" data-testid="digest-data">
                <div><span className="text-muted-foreground">Workouts: </span>{digest.data_snapshot.completed_workouts} ({Math.round(digest.data_snapshot.compliance * 100)}% adherence)</div>
                <div><span className="text-muted-foreground">Streak: </span>{digest.data_snapshot.streak_days}d</div>
                {digest.data_snapshot.top_movers?.length > 0 && (
                  <div><span className="text-muted-foreground">Movers: </span>{digest.data_snapshot.top_movers.map(m => `${m.subgroup.replace(/_/g,' ')} ${m.delta >= 0 ? '+' : ''}${m.delta}`).join(", ")}</div>
                )}
                {digest.data_snapshot.weak_subgroups?.length > 0 && (
                  <div><span className="text-muted-foreground">Below MEV: </span>{digest.data_snapshot.weak_subgroups.map(w => `${w.subgroup.replace(/_/g,' ')} ${w.sets}/${w.mev}`).join(", ")}</div>
                )}
                {digest.data_snapshot.prs?.length > 0 && (
                  <div><span className="text-muted-foreground">PRs: </span>{digest.data_snapshot.prs.map(p => `${p.exercise_name} ${p.weight}kg×${p.reps}`).join(", ")}</div>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Generate an AI-written digest of your week. Numbers cross-checked against your data — hallucinations rejected.</p>
        )}
      </div>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Volume vs landmarks</div>
        <div className="bg-card border border-border rounded-xl p-4 space-y-2">
          {Object.entries(data.weekly_volume).sort((a,b) => b[1]-a[1]).slice(0, 12).map(([sg, sets]) => {
            const lm = data.landmarks?.[sg] || { mev: 0, mav: 10, mrv: 20 };
            const pct = Math.min(100, (sets / lm.mrv) * 100);
            const inMav = sets >= lm.mev && sets <= lm.mav;
            return (
              <div key={sg} className="flex items-center gap-3">
                <div className="text-xs font-mono w-28 text-muted-foreground">{sg.replace(/_/g, " ")}</div>
                <div className="flex-1 h-3 bg-secondary rounded-full relative overflow-hidden">
                  <div className="absolute inset-y-0" style={{ left: `${(lm.mev / lm.mrv) * 100}%`, width: `${((lm.mav - lm.mev) / lm.mrv) * 100}%`, background: "hsl(var(--primary) / 0.15)" }} />
                  <div className="absolute inset-y-0 left-0 transition-all" style={{ width: `${pct}%`, background: inMav ? "hsl(var(--primary))" : "hsl(var(--destructive) / 0.7)" }} />
                </div>
                <div className="font-mono text-xs w-16 text-right">{sets.toFixed(1)} / {lm.mrv}</div>
              </div>
            );
          })}
          {Object.keys(data.weekly_volume).length === 0 && <div className="text-center text-xs text-muted-foreground font-mono py-4">log your first session to see volume</div>}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Active insights</div>
        {data.insights.length === 0 && <div className="text-xs text-muted-foreground font-mono p-4 text-center">all clear</div>}
        {data.insights.map((ins) => {
          const isOpen = !!expanded[ins.id];
          return (
            <div key={ins.id} className={`p-4 rounded-md border ${ins.severity === "success" ? "border-primary/40 bg-primary/5" : ins.severity === "warning" ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"}`} data-testid={`insight-item-${ins.type}`}>
              <div className="font-display text-base font-semibold">{ins.title}</div>
              <div className="text-xs text-muted-foreground mt-1">{ins.body}</div>
              {ins.data && (
                <button onClick={() => setExpanded(e => ({ ...e, [ins.id]: !e[ins.id] }))} className="mt-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground flex items-center gap-1" data-testid={`insight-see-data-${ins.type}`}>
                  {isOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />} see data
                </button>
              )}
              {isOpen && ins.data && (
                <pre className="mt-2 p-2 bg-secondary/40 rounded text-[10px] font-mono overflow-x-auto" data-testid={`insight-data-${ins.type}`}>{JSON.stringify(ins.data, null, 2)}</pre>
              )}
            </div>
          );
        })}
      </div>

      {/* Coach chat */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <MessageCircle size={13} className="text-primary" />
            <div className="text-[10px] font-mono uppercase tracking-widest text-primary">Ask your coach</div>
          </div>
          {messages.length > 0 && (
            <button
              onClick={() => { setMessages([]); setPendingAction(null); setApplyResult(null); }}
              className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              clear chat
            </button>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Hey {name}. I've got your week in front of me — tell me what's going on and we'll figure it out together.</p>
              <div className="space-y-2">
                {SUGGESTIONS.map((s) => (
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

              {/* Proposal card inline in thread — auto-scrolled to by bottomRef */}
              {pendingAction && (
                <div className="border-2 border-primary bg-primary/10 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-primary" />
                    <span className="text-xs font-mono font-bold uppercase tracking-widest text-primary">Coach proposal — tap to apply</span>
                  </div>
                  <pre className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{pendingAction.summary}</pre>
                  <div className="flex gap-2">
                    <button
                      onClick={applyAction}
                      disabled={applying}
                      className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-mono font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                      {applying ? "Applying…" : "Apply changes"}
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

              {chatLoading && (
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
              disabled={!input.trim() || chatLoading}
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
      </div>
    </div>
  );
}
