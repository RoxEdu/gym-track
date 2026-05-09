import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import NumPad from "../components/NumPad";
import RestTimer from "../components/RestTimer";
import { Check, ChevronLeft, Trash2, Youtube, Sparkles, Zap, AlertTriangle, MoreVertical, Clock } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

const SET_TYPE_META = {
  normal:  { label: "Normal",  badge: null,        ring: "border-border" },
  warmup:  { label: "Warmup",  badge: "WU",        ring: "border-muted-foreground/40" },
  dropset: { label: "Dropset", badge: "DROP",      ring: "border-orange-400/60" },
  myo:     { label: "Myo-rep", badge: "MYO",       ring: "border-blue-400/60" },
  cluster: { label: "Cluster", badge: "CLUSTER",   ring: "border-purple-400/60" },
};

export default function ActiveWorkout() {
  const { workoutId } = useParams();
  const navigate = useNavigate();
  const [workout, setWorkout] = useState(null);
  const [sets, setSets] = useState([]);
  const [recs, setRecs] = useState({}); // { workout_exercise_id: {weight, reps, rir, source} }
  const [readiness, setReadiness] = useState({}); // { workout_exercise_id: 0..1 }
  const [plateauIds, setPlateauIds] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showRest, setShowRest] = useState(0);
  const [showVideo, setShowVideo] = useState(null);
  const [pendingType, setPendingType] = useState({}); // setRow key -> set_type override

  const load = async () => {
    const [r1, r2] = await Promise.all([
      api.get(`/workouts/${workoutId}`),
      api.get(`/workouts/${workoutId}/recommendations`),
    ]);
    setWorkout(r1.data.workout);
    setSets(r1.data.sets);
    setRecs(r2.data.recommendations || {});
    setReadiness(r2.data.readiness || {});
    setPlateauIds(r2.data.plateau_exercise_ids || []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [workoutId]);

  if (!workout) return <div className="p-6 font-mono">loading...</div>;

  const getSetsForEx = (wexId) => sets.filter(s => s.workout_exercise_id === wexId).sort((a,b) => a.set_index - b.set_index);

  const buildSuggestion = (we) => {
    const exSets = getSetsForEx(we.id);
    if (exSets.length > 0) {
      const last = exSets[exSets.length - 1];
      return { weight: last.weight, reps: last.reps, rir: last.rir };
    }
    const r = recs[we.id];
    return r ? { weight: r.weight, reps: r.reps, rir: r.rir } : { weight: 0, reps: we.rep_range[0], rir: 2 };
  };

  const logSet = async (we, setIndex, weight, reps, rir = 0, set_type = "normal", seconds = null) => {
    const r = await api.post("/sets", {
      workout_id: workout.id,
      workout_exercise_id: we.id,
      exercise_id: we.exercise_id,
      set_index: setIndex,
      weight, reps, rir, set_type, seconds, completed: true,
    });
    setSets((s) => [...s, r.data]);
    if (set_type !== "warmup") setShowRest(we.rest_seconds || 120);
  };

  const removeSet = async (id) => {
    await api.delete(`/sets/${id}`);
    setSets((s) => s.filter(x => x.id !== id));
  };

  const updateSetField = async (s, field, value) => {
    const upd = { weight: s.weight, reps: s.reps, rir: s.rir, set_type: s.set_type, [field]: value };
    await api.put(`/sets/${s.id}`, upd);
    setSets((arr) => arr.map(x => x.id === s.id ? { ...x, [field]: value } : x));
  };

  const finish = async () => {
    await api.post(`/workouts/${workoutId}/complete`);
    navigate("/today");
  };

  const completedCount = sets.filter(s => s.completed && s.set_type !== "warmup").length;
  const totalTarget = workout.exercises.reduce((a,e) => a + e.target_sets, 0);

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 pb-32" data-testid="active-workout">
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/today")}><ChevronLeft size={16} /> Back</Button>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{completedCount} / {totalTarget} sets</div>
      </div>
      <h1 className="font-display text-3xl font-bold">{workout.name}</h1>

      <div className="mt-6 space-y-6">
        {workout.exercises.map((we) => {
          const exSets = getSetsForEx(we.id);
          const suggested = buildSuggestion(we);
          const rec = recs[we.id];
          const readyPct = Math.round((readiness[we.id] ?? 1) * 100);
          const isPlateau = plateauIds.includes(we.id);
          return (
            <div key={we.id} className="bg-card border border-border rounded-xl p-4" data-testid={`exercise-${we.id}`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-display text-xl font-semibold">{we.exercise_name}</div>
                    {isPlateau && (
                      <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border border-orange-400/50 text-orange-400 flex items-center gap-1" data-testid={`plateau-${we.id}`}>
                        <AlertTriangle size={10} /> plateau
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-0.5">target {we.target_sets} × {we.rep_range[0]}-{we.rep_range[1]} • rest {we.rest_seconds}s</div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setShowVideo(we.exercise_id)} data-testid={`video-btn-${we.id}`}><Youtube size={18} /></Button>
              </div>

              {/* Recommendation + readiness chip row */}
              <div className="flex items-center gap-2 mb-3 text-[10px] font-mono">
                {rec && (
                  <span className="px-2 py-1 rounded bg-primary/10 text-primary border border-primary/30 flex items-center gap-1" data-testid={`rec-${we.id}`}>
                    <Sparkles size={10} /> rec {rec.weight}kg × {rec.reps} <span className="text-primary/70 ml-1">({rec.source.replace("_", " ")})</span>
                  </span>
                )}
                <span className={`px-2 py-1 rounded border flex items-center gap-1 ${readyPct < 60 ? "border-orange-400/50 text-orange-400" : "border-border text-muted-foreground"}`} data-testid={`ready-${we.id}`}>
                  <Zap size={10} /> ready {readyPct}%
                </span>
              </div>

              <div className="space-y-1.5">
                {Array.from({ length: Math.max(we.target_sets, exSets.length + 1) }).map((_, i) => {
                  const s = exSets[i];
                  const setKey = `${we.id}-${i}`;
                  const currentType = s?.set_type || pendingType[setKey] || "normal";
                  return (
                    <SetRow
                      key={i}
                      setIndex={i}
                      set={s}
                      suggested={suggested}
                      setType={currentType}
                      onChangeType={(nt) => {
                        if (s) updateSetField(s, "set_type", nt);
                        else setPendingType((p) => ({ ...p, [setKey]: nt }));
                      }}
                      onEdit={(field, value) => setEditing({ we, setIndex: i, field, value: String(value || ""), set_type: currentType })}
                      onLog={() => logSet(we, i, suggested.weight, suggested.reps, suggested.rir, currentType)}
                      onDelete={() => s && removeSet(s.id)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <Button onClick={finish} className="fixed bottom-20 left-4 right-4 max-w-2xl mx-auto bg-primary text-primary-foreground hover:bg-primary/90 py-6 font-mono uppercase tracking-wider z-30" data-testid="finish-workout-btn">
        <Check size={18} className="mr-2" /> Finish workout
      </Button>

      {showRest > 0 && <RestTimer seconds={showRest} onClose={() => setShowRest(0)} />}

      {editing && (
        <NumPad
          label={editing.field}
          value={editing.value}
          onChange={(v) => setEditing({ ...editing, value: v })}
          onClose={() => setEditing(null)}
          onConfirm={async (val) => {
            const { we, setIndex, field, set_type } = editing;
            const exSets = getSetsForEx(we.id);
            const s = exSets[setIndex];
            if (s) {
              await updateSetField(s, field, val);
            } else {
              const sug = buildSuggestion(we);
              const data = { weight: sug.weight, reps: sug.reps, rir: sug.rir || 2, [field]: val };
              await logSet(we, setIndex, data.weight, data.reps, data.rir, set_type || "normal");
            }
            setEditing(null);
          }}
        />
      )}

      {showVideo && <VideoModal exerciseId={showVideo} onClose={() => setShowVideo(null)} />}
    </div>
  );
}

function SetRow({ setIndex, set, suggested, setType, onChangeType, onEdit, onLog, onDelete }) {
  const isLogged = !!set;
  const meta = SET_TYPE_META[setType] || SET_TYPE_META.normal;
  const dim = setType === "warmup";
  return (
    <div className={`grid grid-cols-[20px,28px,1fr,1fr,1fr,40px] gap-1.5 items-center py-2 px-2 rounded-md border ${meta.ring} ${isLogged ? "bg-primary/5" : "bg-secondary/30"} ${dim ? "opacity-60" : ""}`} data-testid={`set-row-${setIndex}`}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="text-muted-foreground hover:text-foreground" data-testid={`set-type-${setIndex}`}>
            <MoreVertical size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {Object.entries(SET_TYPE_META).map(([k, v]) => (
            <DropdownMenuItem key={k} onClick={() => onChangeType(k)} data-testid={`set-type-opt-${k}-${setIndex}`}>
              {v.badge && <span className="text-[9px] font-mono mr-2 px-1 rounded bg-secondary">{v.badge}</span>}
              {v.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="text-xs font-mono text-muted-foreground">#{setIndex + 1}</div>
      <button onClick={() => onEdit("weight", set?.weight ?? suggested.weight)} className="text-left py-1.5 px-2 rounded bg-background border border-border" data-testid={`set-weight-${setIndex}`}>
        <div className="text-[9px] font-mono uppercase text-muted-foreground flex items-center justify-between">
          <span>kg</span>
          {meta.badge && <span className="text-primary/70">{meta.badge}</span>}
        </div>
        <div className="font-mono text-sm">{set?.weight ?? `${suggested.weight}`}</div>
      </button>
      <button onClick={() => onEdit("reps", set?.reps ?? suggested.reps)} className="text-left py-1.5 px-2 rounded bg-background border border-border" data-testid={`set-reps-${setIndex}`}>
        <div className="text-[9px] font-mono uppercase text-muted-foreground">reps</div>
        <div className="font-mono text-sm">{set?.reps ?? `${suggested.reps}`}</div>
      </button>
      <button onClick={() => onEdit("rir", set?.rir ?? suggested.rir ?? 2)} className="text-left py-1.5 px-2 rounded bg-background border border-border" data-testid={`set-rir-${setIndex}`}>
        <div className="text-[9px] font-mono uppercase text-muted-foreground">rir</div>
        <div className="font-mono text-sm">{set?.rir ?? (suggested.rir ?? 2)}</div>
      </button>
      {isLogged ? (
        <button onClick={onDelete} className="text-muted-foreground hover:text-destructive p-1" data-testid={`set-delete-${setIndex}`}><Trash2 size={14} /></button>
      ) : (
        <button onClick={onLog} className="bg-primary text-primary-foreground rounded p-1.5" data-testid={`set-log-${setIndex}`}><Check size={14} /></button>
      )}
    </div>
  );
}

function VideoModal({ exerciseId, onClose }) {
  const [ex, setEx] = useState(null);
  useEffect(() => { api.get(`/exercises/${exerciseId}`).then(r => setEx(r.data.exercise)); }, [exerciseId]);
  return (
    <div className="fixed inset-0 z-50 bg-background/90 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl max-w-xl w-full p-4" onClick={(e) => e.stopPropagation()}>
        <div className="font-display text-xl font-semibold mb-3">{ex?.name}</div>
        {ex?.youtube_id && (
          <div className="aspect-video rounded overflow-hidden">
            <iframe className="w-full h-full" src={`https://www.youtube.com/embed/${ex.youtube_id}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" />
          </div>
        )}
        <Button onClick={onClose} className="mt-3 w-full" variant="outline" data-testid="video-close">Close</Button>
      </div>
    </div>
  );
}
