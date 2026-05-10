import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { LogOut, Plus, RefreshCw, Check } from "lucide-react";

export default function Settings() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [splits, setSplits] = useState([]);
  const [body, setBody] = useState([]);
  const [weight, setWeight] = useState("");
  const [bf, setBf] = useState("");
  const [daysPerWeek, setDaysPerWeek] = useState(user?.days_per_week || 4);
  const [savingDays, setSavingDays] = useState(false);
  const [daysSaved, setDaysSaved] = useState(false);
  const [redistributing, setRedistributing] = useState(false);
  const [redistributeMsg, setRedistributeMsg] = useState(null);

  const load = async () => {
    const [s, b] = await Promise.all([api.get("/splits"), api.get("/body")]);
    setSplits(s.data);
    setBody(b.data);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { setDaysPerWeek(user?.days_per_week || 4); }, [user?.days_per_week]);

  const switchSplit = async (split_id) => {
    await api.post("/programs", { split_id, weeks: 4 });
    await refresh();
  };

  const saveBody = async () => {
    if (!weight && !bf) return;
    await api.post("/body", {
      weight_kg: weight ? parseFloat(weight) : null,
      body_fat_pct: bf ? parseFloat(bf) : null,
    });
    setWeight(""); setBf(""); load(); refresh();
  };

  const saveDays = async () => {
    setSavingDays(true);
    try {
      await api.put("/profile", { days_per_week: daysPerWeek });
      await refresh();
      setDaysSaved(true);
      setTimeout(() => setDaysSaved(false), 2000);
    } finally {
      setSavingDays(false);
    }
  };

  const redistribute = async () => {
    setRedistributing(true);
    setRedistributeMsg(null);
    try {
      const r = await api.post("/programs/redistribute");
      const n = r.data?.redistributed || 0;
      setRedistributeMsg(n > 0 ? `Rescheduled ${n} missed workout${n > 1 ? "s" : ""}` : "No missed workouts to reschedule");
    } catch {
      setRedistributeMsg("Failed — try again");
    } finally {
      setRedistributing(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-5 py-6 space-y-5" data-testid="settings-page">
      <div>
        <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-1">/ profile</div>
        <h1 className="font-display text-3xl font-bold">{user?.name}</h1>
        <div className="text-xs font-mono text-muted-foreground">{user?.email}</div>
      </div>

      {/* Stats */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-2">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Profile</div>
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          <Stat k="Goal" v={user?.goal} />
          <Stat k="Experience" v={user?.experience} />
          <Stat k="Days/week" v={user?.days_per_week} />
          <Stat k="Weight" v={user?.weight_kg ? `${user.weight_kg} ${user.units || "kg"}` : "—"} />
        </div>
      </div>

      {/* Days per week editor */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">Training days per week</div>
        <div className="flex gap-2 mb-3">
          {[3, 4, 5, 6].map((d) => (
            <button
              key={d}
              onClick={() => setDaysPerWeek(d)}
              className={`flex-1 py-3 rounded-xl border-2 font-mono text-lg font-bold transition-all ${daysPerWeek === d ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40"}`}
            >
              {d}
            </button>
          ))}
        </div>
        <Button
          onClick={saveDays}
          disabled={savingDays || daysPerWeek === user?.days_per_week}
          className="w-full font-mono uppercase tracking-wider"
        >
          {daysSaved ? <><Check size={14} className="mr-1.5" />Saved</> : "Save"}
        </Button>
      </div>

      {/* Missed workouts */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Missed workouts</div>
        <p className="text-xs text-muted-foreground font-mono mb-3">Reschedules any past-due workouts to upcoming days.</p>
        <Button
          onClick={redistribute}
          disabled={redistributing}
          variant="outline"
          className="w-full font-mono uppercase tracking-wider"
        >
          <RefreshCw size={14} className={`mr-2 ${redistributing ? "animate-spin" : ""}`} />
          {redistributing ? "Rescheduling…" : "Redistribute missed"}
        </Button>
        {redistributeMsg && (
          <p className="text-xs font-mono text-muted-foreground mt-2 text-center">{redistributeMsg}</p>
        )}
      </div>

      {/* Body log */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Log body measurement</div>
        <div className="flex gap-2">
          <Input placeholder="Weight (kg)" type="number" value={weight} onChange={(e) => setWeight(e.target.value)} className="bg-secondary border-border" data-testid="body-weight-input" />
          <Input placeholder="Body fat %" type="number" value={bf} onChange={(e) => setBf(e.target.value)} className="bg-secondary border-border" data-testid="body-bf-input" />
          <Button onClick={saveBody} className="bg-primary text-primary-foreground" data-testid="body-save-btn"><Plus size={16} /></Button>
        </div>
        {body.length > 0 && (
          <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
            {body.slice(0, 8).map(b => (
              <div key={b.id} className="flex justify-between text-[11px] font-mono text-muted-foreground">
                <span>{new Date(b.recorded_at).toLocaleDateString()}</span>
                <span>{b.weight_kg ? `${b.weight_kg}kg` : ""} {b.body_fat_pct ? `${b.body_fat_pct}%` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Switch split */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Switch split / regenerate program</div>
        <div className="space-y-2">
          {splits.map((s) => (
            <button key={s.id} onClick={() => switchSplit(s.id)} data-testid={`switch-split-${s.id}`} className="w-full text-left p-3 border border-border rounded-xl hover:border-primary/50 transition-colors">
              <div className="flex justify-between items-center">
                <div className="font-display text-sm font-semibold">{s.name}</div>
                <div className="text-[10px] font-mono text-muted-foreground">{s.days_per_week}d/wk</div>
              </div>
              {s.description && <div className="text-xs text-muted-foreground mt-0.5">{s.description}</div>}
            </button>
          ))}
        </div>
      </div>

      <Button onClick={logout} variant="outline" className="w-full font-mono uppercase tracking-wider" data-testid="logout-btn">
        <LogOut size={14} className="mr-2" />Sign out
      </Button>
    </div>
  );
}

function Stat({ k, v }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{k}</div>
      <div className="text-sm">{v ?? "—"}</div>
    </div>
  );
}
