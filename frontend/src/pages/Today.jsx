import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";
import { Calendar, Flame, TrendingUp, ArrowRight, Sparkles } from "lucide-react";

export default function Today() {
  const { user } = useAuth();
  const [workout, setWorkout] = useState(null);
  const [insights, setInsights] = useState({ insights: [], weekly_volume: {}, recovery: {}, digest: null });
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/workouts/today").then(r => setWorkout(r.data.workout));
    api.get("/insights").then(r => setInsights(r.data));
  }, []);

  const totalVolumeSets = Object.values(insights.weekly_volume || {}).reduce((a,b) => a+b, 0);
  const recoveryAvg = Object.values(insights.recovery || {}).length > 0
    ? Object.values(insights.recovery).reduce((a,b) => a+b, 0) / Object.values(insights.recovery).length
    : 1;

  const start = async () => {
    if (!workout) return;
    await api.post(`/workouts/${workout.id}/start`);
    navigate(`/workout/${workout.id}`);
  };

  return (
    <div className="max-w-2xl mx-auto px-5 py-6 space-y-5" data-testid="today-page">
      <header className="fade-up">
        <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-1">/ today</div>
        <h1 className="font-display text-4xl font-bold">Hi, {user?.name?.split(" ")[0] || "Athlete"}.</h1>
        <p className="text-sm text-muted-foreground mt-1">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
      </header>

      {workout ? (
        <div className="bg-card border border-border rounded-xl p-5 fade-up delay-1 relative overflow-hidden" data-testid="today-workout-card">
          <div className="absolute -right-12 -top-12 w-48 h-48 bg-primary/10 rounded-full blur-3xl" />
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">next session</div>
          <div className="font-display text-3xl font-semibold mt-1">{workout.name}</div>
          <div className="mt-3 flex items-center gap-4 text-xs font-mono text-muted-foreground">
            <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(workout.scheduled_date).toLocaleDateString()}</span>
            <span>{workout.exercises.length} exercises</span>
            <span>{workout.exercises.reduce((a,e) => a + e.target_sets, 0)} sets</span>
          </div>
          <div className="mt-4 space-y-1.5 text-sm">
            {workout.exercises.slice(0, 5).map((e, i) => (
              <div key={i} className="flex justify-between text-muted-foreground">
                <span>{e.exercise_name}</span>
                <span className="font-mono">{e.target_sets} × {e.rep_range[0]}-{e.rep_range[1]}</span>
              </div>
            ))}
            {workout.exercises.length > 5 && <div className="text-xs text-muted-foreground">+ {workout.exercises.length - 5} more</div>}
          </div>
          <Button onClick={start} className="mt-5 w-full bg-primary text-primary-foreground hover:bg-primary/90 py-6 font-mono uppercase tracking-wider" data-testid="today-start-btn">
            Start Workout <ArrowRight size={16} className="ml-2" />
          </Button>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-6 text-center fade-up delay-1">
          <div className="font-display text-2xl font-semibold mb-2">No workout scheduled</div>
          <p className="text-sm text-muted-foreground mb-4">Generate a program to get started.</p>
          <Button onClick={() => navigate("/settings")} variant="outline" data-testid="today-no-program">Set up program</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 fade-up delay-2">
        <ScoreCard icon={<Flame size={16} />} label="Recovery" value={`${Math.round(recoveryAvg * 100)}%`} testid="recovery-card" />
        <ScoreCard icon={<TrendingUp size={16} />} label="Volume / week" value={`${Math.round(totalVolumeSets)} sets`} testid="volume-card" />
      </div>

      {insights.digest?.text && (
        <div className="bg-card border border-border rounded-xl p-5 fade-up delay-3" data-testid="weekly-digest">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} className="text-primary" />
            <div className="text-[10px] font-mono uppercase tracking-widest text-primary">Weekly digest</div>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-line">{insights.digest.text}</p>
        </div>
      )}

      {insights.insights?.length > 0 && (
        <div className="space-y-2 fade-up delay-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Insights</div>
          {insights.insights.slice(0, 3).map((ins) => (
            <div key={ins.id} className={`p-4 rounded-md border ${ins.severity === "success" ? "border-primary/40 bg-primary/5" : ins.severity === "warning" ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"}`} data-testid={`insight-${ins.type}`}>
              <div className="font-display text-base font-semibold">{ins.title}</div>
              <div className="text-xs text-muted-foreground mt-1">{ins.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreCard({ icon, label, value, testid }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4" data-testid={testid}>
      <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-mono uppercase tracking-widest">{icon} {label}</div>
      <div className="font-display text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}
