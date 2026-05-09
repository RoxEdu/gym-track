import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import NumPad from "../components/NumPad";
import RestTimer from "../components/RestTimer";
import { Check, ChevronLeft, Plus, Trash2, Trophy, Youtube } from "lucide-react";

export default function ActiveWorkout() {
  const { workoutId } = useParams();
  const navigate = useNavigate();
  const [workout, setWorkout] = useState(null);
  const [sets, setSets] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [editing, setEditing] = useState(null); // { wexId, setIndex, field: weight|reps|rir, value }
  const [showRest, setShowRest] = useState(0);
  const [showVideo, setShowVideo] = useState(null);

  const load = async () => {
    const r = await api.get(`/workouts/${workoutId}`);
    setWorkout(r.data.workout);
    setSets(r.data.sets);
  };
  useEffect(() => { load(); }, [workoutId]);

  if (!workout) return <div className="p-6 font-mono">loading...</div>;

  const getSetsForEx = (wexId) => sets.filter(s => s.workout_exercise_id === wexId).sort((a,b) => a.set_index - b.set_index);

  const logSet = async (we, setIndex, weight, reps, rir = 0) => {
    const r = await api.post("/sets", {
      workout_id: workout.id,
      workout_exercise_id: we.id,
      exercise_id: we.exercise_id,
      set_index: setIndex,
      weight, reps, rir, completed: true,
    });
    setSets((s) => [...s, r.data]);
    setShowRest(we.rest_seconds || 120);
  };

  const removeSet = async (id) => {
    await api.delete(`/sets/${id}`);
    setSets((s) => s.filter(x => x.id !== id));
  };

  const finish = async () => {
    await api.post(`/workouts/${workoutId}/complete`);
    navigate("/today");
  };

  const completedCount = sets.filter(s => s.completed).length;
  const totalTarget = workout.exercises.reduce((a,e) => a + e.target_sets, 0);

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 pb-32" data-testid="active-workout">
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/today")}><ChevronLeft size={16} /> Back</Button>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{completedCount} / {totalTarget} sets</div>
      </div>
      <h1 className="font-display text-3xl font-bold">{workout.name}</h1>

      <div className="mt-6 space-y-6">
        {workout.exercises.map((we, exIdx) => {
          const exSets = getSetsForEx(we.id);
          const lastSet = exSets[exSets.length - 1];
          const suggested = lastSet ? { weight: lastSet.weight, reps: lastSet.reps } : { weight: 0, reps: we.rep_range[0] };
          return (
            <div key={we.id} className={`bg-card border rounded-xl p-4 ${exIdx === activeIdx ? "border-primary" : "border-border"}`} data-testid={`exercise-${we.id}`}>
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex-1">
                  <div className="font-display text-xl font-semibold">{we.exercise_name}</div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">target {we.target_sets} × {we.rep_range[0]}-{we.rep_range[1]} • rest {we.rest_seconds}s</div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setShowVideo(we.exercise_id)} data-testid={`video-btn-${we.id}`}><Youtube size={18} /></Button>
              </div>

              <div className="space-y-1.5">
                {Array.from({ length: Math.max(we.target_sets, exSets.length + 1) }).map((_, i) => {
                  const s = exSets[i];
                  return (
                    <SetRow
                      key={i}
                      setIndex={i}
                      set={s}
                      suggested={suggested}
                      onEdit={(field, value) => setEditing({ we, setIndex: i, field, value: String(value || "") })}
                      onLog={() => logSet(we, i, suggested.weight, suggested.reps, 0)}
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
            const { we, setIndex, field } = editing;
            const exSets = getSetsForEx(we.id);
            const s = exSets[setIndex];
            if (s) {
              const upd = { ...s, [field]: val };
              await api.put(`/sets/${s.id}`, { weight: upd.weight, reps: upd.reps, rir: upd.rir });
              setSets((arr) => arr.map(x => x.id === s.id ? { ...x, [field]: val } : x));
            } else {
              const lastSet = exSets[exSets.length - 1];
              const sug = lastSet || { weight: 0, reps: we.rep_range[0], rir: 0 };
              const data = { weight: sug.weight, reps: sug.reps, rir: 0, [field]: val };
              await logSet(we, setIndex, data.weight, data.reps, data.rir);
            }
            setEditing(null);
          }}
        />
      )}

      {showVideo && <VideoModal exerciseId={showVideo} onClose={() => setShowVideo(null)} />}
    </div>
  );
}

function SetRow({ setIndex, set, suggested, onEdit, onLog, onDelete }) {
  const isLogged = !!set;
  return (
    <div className={`grid grid-cols-[28px,1fr,1fr,1fr,40px] gap-2 items-center py-2 px-2 rounded-md ${isLogged ? "bg-primary/5" : "bg-secondary/30"}`} data-testid={`set-row-${setIndex}`}>
      <div className="text-xs font-mono text-muted-foreground">#{setIndex + 1}</div>
      <button onClick={() => onEdit("weight", set?.weight ?? suggested.weight)} className="text-left py-1.5 px-2 rounded bg-background border border-border" data-testid={`set-weight-${setIndex}`}>
        <div className="text-[9px] font-mono uppercase text-muted-foreground">kg</div>
        <div className="font-mono text-sm">{set?.weight ?? `${suggested.weight}`}</div>
      </button>
      <button onClick={() => onEdit("reps", set?.reps ?? suggested.reps)} className="text-left py-1.5 px-2 rounded bg-background border border-border" data-testid={`set-reps-${setIndex}`}>
        <div className="text-[9px] font-mono uppercase text-muted-foreground">reps</div>
        <div className="font-mono text-sm">{set?.reps ?? `${suggested.reps}`}</div>
      </button>
      <button onClick={() => onEdit("rir", set?.rir ?? 0)} className="text-left py-1.5 px-2 rounded bg-background border border-border" data-testid={`set-rir-${setIndex}`}>
        <div className="text-[9px] font-mono uppercase text-muted-foreground">rir</div>
        <div className="font-mono text-sm">{set?.rir ?? 0}</div>
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
