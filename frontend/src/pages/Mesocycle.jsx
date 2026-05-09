import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { PageSkeleton } from "../components/Skeleton";
import { CalendarRange, RefreshCw, Sparkles, ChevronRight } from "lucide-react";

export default function Mesocycle() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const load = () => api.get("/programs/mesocycle").then(r => setData(r.data));
  useEffect(() => { load(); }, []);

  if (!data) return <PageSkeleton />;

  const redistribute = async () => {
    setBusy(true);
    try { await api.post("/programs/redistribute"); await load(); } finally { setBusy(false); }
  };

  const startNext = async () => {
    setBusy(true);
    try {
      await api.post("/programs/next-mesocycle", { weeks: 4 });
      await load();
    } finally { setBusy(false); }
  };

  const allCompleted = data.weeks.length > 0 && data.weeks.every(w => w.workouts.every(wk => wk.status === "completed"));

  return (
    <div className="max-w-2xl mx-auto px-5 py-6 space-y-5" data-testid="mesocycle-page">
      <div>
        <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-1">/ mesocycle</div>
        <h1 className="font-display text-3xl font-bold">Program plan</h1>
        {data.program && <div className="text-xs font-mono text-muted-foreground mt-1">{data.program.split_name} • {data.program.weeks}-week block</div>}
      </div>

      <div className="flex gap-2">
        <Button onClick={redistribute} variant="outline" disabled={busy} data-testid="redistribute-btn"><RefreshCw size={14} className="mr-1.5" /> Redistribute missed</Button>
        {allCompleted && (
          <Button onClick={startNext} disabled={busy} className="bg-primary text-primary-foreground" data-testid="next-mesocycle-btn"><Sparkles size={14} className="mr-1.5" /> Start next mesocycle</Button>
        )}
      </div>

      <div className="space-y-3">
        {data.weeks.map((w) => {
          const completion = w.target_sets > 0 ? Math.round((w.completed_sets / w.target_sets) * 100) : 0;
          return (
            <div key={w.week_index} className={`bg-card border rounded-xl p-4 ${w.is_current ? "border-primary" : "border-border"}`} data-testid={`week-${w.week_index}`}>
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <div className="font-display text-lg font-semibold">Week {w.week_index + 1}</div>
                  {w.is_deload && <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded bg-orange-400/10 text-orange-400 border border-orange-400/40">deload</span>}
                  {w.is_current && <span className="text-[9px] font-mono uppercase tracking-widest text-primary">current</span>}
                </div>
                <div className="font-mono text-xs text-muted-foreground">{w.completed_sets}/{w.target_sets} sets · {completion}%</div>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden mb-3">
                <div className="h-full bg-primary transition-all" style={{ width: `${completion}%` }} />
              </div>
              <div className="space-y-1">
                {w.workouts.map((wk) => (
                  <button key={wk.id} onClick={() => navigate(`/workout/${wk.id}`)} className="w-full flex items-center justify-between text-left p-2 rounded hover:bg-secondary/50 transition-colors" data-testid={`week-workout-${wk.id}`}>
                    <div className="flex items-center gap-2 text-sm">
                      <span className={`w-2 h-2 rounded-full ${wk.status === "completed" ? "bg-primary" : wk.status === "in_progress" ? "bg-orange-400" : "bg-secondary border border-border"}`} />
                      <span>{wk.name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                      <span>{new Date(wk.scheduled_date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
                      <ChevronRight size={12} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {data.weeks.length === 0 && <div className="text-center text-sm text-muted-foreground font-mono p-8">no active program — set one up in Profile</div>}
      </div>
    </div>
  );
}
