import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { ChevronLeft, Trophy } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";

export default function ExerciseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => { api.get(`/exercises/${id}`).then(r => setData(r.data)); }, [id]);
  if (!data) return <div className="p-6 font-mono">loading...</div>;
  const { exercise, history, pr } = data;
  const chartData = [...history].reverse().map(h => ({ date: new Date(h.performed_at).toLocaleDateString(), e1rm: h.e1rm, weight: h.weight, reps: h.reps }));

  return (
    <div className="max-w-2xl mx-auto px-5 py-6" data-testid="exercise-detail">
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="mb-3"><ChevronLeft size={16} /> Back</Button>
      <h1 className="font-display text-3xl font-bold">{exercise.name}</h1>
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-1">{exercise.category} • {exercise.equipment} • {exercise.movement}</div>

      {exercise.youtube_id && (
        <div className="aspect-video rounded-xl overflow-hidden mt-4 bg-card border border-border">
          <iframe className="w-full h-full" src={`https://www.youtube.com/embed/${exercise.youtube_id}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" />
        </div>
      )}

      {pr && (
        <div className="mt-4 bg-card border border-primary/40 rounded-xl p-4 flex items-center gap-3" data-testid="pr-card">
          <Trophy size={20} className="text-primary" />
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">personal record</div>
            <div className="font-display text-2xl font-semibold">{pr.weight} kg × {pr.reps} <span className="text-sm text-muted-foreground font-mono">→ e1RM {pr.e1rm}kg</span></div>
          </div>
        </div>
      )}

      <h2 className="font-display text-xl font-semibold mt-6 mb-2">Subgroup contributions</h2>
      <div className="space-y-1.5">
        {Object.entries(exercise.subgroups || {}).map(([k, v]) => (
          <div key={k} className="flex items-center gap-3">
            <div className="text-xs font-mono w-32 text-muted-foreground">{k.replace(/_/g, " ")}</div>
            <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${v * 100}%` }} />
            </div>
            <div className="text-xs font-mono w-10 text-right">{Math.round(v * 100)}%</div>
          </div>
        ))}
      </div>

      {chartData.length > 1 && (
        <div className="mt-6">
          <h2 className="font-display text-xl font-semibold mb-2">Estimated 1RM trend</h2>
          <div className="bg-card border border-border rounded-xl p-3">
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={chartData}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontFamily: "JetBrains Mono", fontSize: 11 }} />
                <Line type="monotone" dataKey="e1rm" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-6">
          <h2 className="font-display text-xl font-semibold mb-2">Recent sets</h2>
          <div className="space-y-1">
            {history.slice(0, 20).map((h) => (
              <div key={h.id} className="flex justify-between p-2 bg-card border border-border rounded text-xs font-mono">
                <span>{new Date(h.performed_at).toLocaleDateString()}</span>
                <span>{h.weight}kg × {h.reps} @ RIR {h.rir} → e1RM {h.e1rm}kg</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
