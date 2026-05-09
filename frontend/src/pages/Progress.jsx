import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, LineChart, Line } from "recharts";
import { Trophy } from "lucide-react";

export default function Progress() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/progress/overview").then(r => setData(r.data)); }, []);
  if (!data) return <div className="p-6 font-mono">loading...</div>;

  const volChart = data.weekly_volume.map((w, i) => ({ week: `W${i+1}`, sets: Math.round(w.total_sets) }));
  const bodyChart = (data.body_history || []).filter(b => b.weight_kg).map(b => ({ date: new Date(b.recorded_at).toLocaleDateString(), kg: b.weight_kg }));

  return (
    <div className="max-w-2xl mx-auto px-5 py-6 space-y-5" data-testid="progress-page">
      <div>
        <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-1">/ progress</div>
        <h1 className="font-display text-3xl font-bold">Your trends</h1>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Workouts" value={data.completed_workouts} />
        <Stat label="Total Sets" value={data.total_sets} />
        <Stat label="PRs" value={data.recent_prs.length} />
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Weekly volume — last 8 weeks</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={volChart}>
            <XAxis dataKey="week" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke="hsl(var(--muted-foreground))" />
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontFamily: "JetBrains Mono", fontSize: 11 }} />
            <Bar dataKey="sets" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {bodyChart.length > 1 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Body weight</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={bodyChart}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke="hsl(var(--muted-foreground))" domain={["dataMin - 2", "dataMax + 2"]} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontFamily: "JetBrains Mono", fontSize: 11 }} />
              <Line type="monotone" dataKey="kg" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Recent PRs</div>
        <div className="space-y-1.5">
          {data.recent_prs.length === 0 && <div className="text-xs text-muted-foreground font-mono p-4 text-center">no PRs yet — keep training</div>}
          {data.recent_prs.map((pr) => (
            <div key={pr.id} className="flex items-center gap-3 p-3 bg-card border border-border rounded-md" data-testid="pr-row">
              <Trophy size={14} className="text-primary" />
              <div className="flex-1">
                <div className="font-display text-sm font-semibold">{pr.exercise_name}</div>
                <div className="text-[10px] font-mono text-muted-foreground">{new Date(pr.created_at).toLocaleDateString()}</div>
              </div>
              <div className="font-mono text-sm">{pr.weight}kg × {pr.reps} <span className="text-muted-foreground">e1RM {pr.e1rm}</span></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-display text-2xl font-semibold mt-0.5">{value}</div>
    </div>
  );
}
