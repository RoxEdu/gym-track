import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";
import { Sparkles, RefreshCw, ChevronDown, ChevronUp, ShieldCheck, ShieldAlert, MessageCircle } from "lucide-react";
import CoachChat from "../components/CoachChat";

export default function Insights() {
  const { user } = useAuth();
  const [data, setData] = useState({ insights: [], weekly_volume: {}, previous_weekly_volume: {}, landmarks: {}, recovery: {}, digest: null, streak_days: 0, weak_subgroups: [], top_movers: [] });
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [showDigestData, setShowDigestData] = useState(false);
  const name = (user?.name || "").split(" ")[0] || "there";

  const load = () => api.get("/insights").then(r => setData(r.data));
  useEffect(() => { load(); }, []);

  const generateDigest = async () => {
    setGenerating(true);
    try {
      const r = await api.post("/insights/digest");
      setData((d) => ({ ...d, digest: r.data }));
    } finally { setGenerating(false); }
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
        <div className="flex items-center gap-2 mb-3">
          <MessageCircle size={13} className="text-primary" />
          <div className="text-[10px] font-mono uppercase tracking-widest text-primary">Ask your coach</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <CoachChat name={name} />
        </div>
      </div>
    </div>
  );
}
