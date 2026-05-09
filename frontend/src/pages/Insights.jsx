import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Sparkles, RefreshCw } from "lucide-react";

export default function Insights() {
  const [data, setData] = useState({ insights: [], weekly_volume: {}, landmarks: {}, recovery: {}, digest: null });
  const [generating, setGenerating] = useState(false);
  const load = () => api.get("/insights").then(r => setData(r.data));
  useEffect(() => { load(); }, []);

  const generateDigest = async () => {
    setGenerating(true);
    try {
      const r = await api.post("/insights/digest");
      setData((d) => ({ ...d, digest: r.data }));
    } finally { setGenerating(false); }
  };

  return (
    <div className="max-w-2xl mx-auto px-5 py-6 space-y-5" data-testid="insights-page">
      <div>
        <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-1">/ insights</div>
        <h1 className="font-display text-3xl font-bold">Signals</h1>
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-primary" />
            <div className="text-[10px] font-mono uppercase tracking-widest text-primary">Weekly digest</div>
          </div>
          <Button size="sm" variant="ghost" onClick={generateDigest} disabled={generating} data-testid="generate-digest-btn">
            <RefreshCw size={12} className={`mr-1 ${generating ? "animate-spin" : ""}`} /> {data.digest ? "Refresh" : "Generate"}
          </Button>
        </div>
        {data.digest ? (
          <p className="text-sm leading-relaxed whitespace-pre-line">{data.digest.text}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Generate an AI-written digest of your week. Pulls only your real data — no hype, no invented numbers.</p>
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
        {data.insights.map((ins) => (
          <div key={ins.id} className={`p-4 rounded-md border ${ins.severity === "success" ? "border-primary/40 bg-primary/5" : ins.severity === "warning" ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"}`} data-testid={`insight-item-${ins.type}`}>
            <div className="font-display text-base font-semibold">{ins.title}</div>
            <div className="text-xs text-muted-foreground mt-1">{ins.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
