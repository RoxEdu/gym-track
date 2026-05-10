import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { LogOut, Plus, RefreshCw, Check, ChevronDown } from "lucide-react";

function OptionRow({ label, value, options, onChange }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">{label}</div>
      <div className="flex gap-2 flex-wrap">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`px-3 py-2 rounded-xl border-2 text-xs font-mono transition-all ${
              value === o.value
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Settings() {
  const { user, logout, refresh } = useAuth();
  const [splits, setSplits] = useState([]);
  const [body, setBody] = useState([]);
  const [weight, setWeight] = useState("");
  const [bf, setBf] = useState("");
  const [redistributing, setRedistributing] = useState(false);
  const [redistributeMsg, setRedistributeMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Editable profile state
  const [profile, setProfile] = useState({
    goal: user?.goal || "hypertrophy",
    experience: user?.experience || "intermediate",
    units: user?.units || "kg",
    days_per_week: user?.days_per_week || 4,
  });

  const p = (update) => setProfile((prev) => ({ ...prev, ...update }));

  const profileChanged =
    profile.goal !== user?.goal ||
    profile.experience !== user?.experience ||
    profile.units !== user?.units ||
    profile.days_per_week !== user?.days_per_week;

  const load = async () => {
    const [s, b] = await Promise.all([api.get("/splits"), api.get("/body")]);
    setSplits(s.data);
    setBody(b.data);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    setProfile({
      goal: user?.goal || "hypertrophy",
      experience: user?.experience || "intermediate",
      units: user?.units || "kg",
      days_per_week: user?.days_per_week || 4,
    });
  }, [user?.goal, user?.experience, user?.units, user?.days_per_week]);

  const saveProfile = async () => {
    setSaving(true);
    try {
      await api.put("/profile", profile);
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

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

  const redistribute = async () => {
    setRedistributing(true);
    setRedistributeMsg(null);
    try {
      const r = await api.post("/programs/redistribute");
      const n = r.data?.redistributed || 0;
      setRedistributeMsg(n > 0 ? `Rescheduled ${n} missed workout${n > 1 ? "s" : ""}` : "No missed workouts found");
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

      {/* Profile editor */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Edit profile</div>

        <OptionRow
          label="Goal"
          value={profile.goal}
          onChange={(v) => p({ goal: v })}
          options={[
            { value: "hypertrophy", label: "Hypertrophy" },
            { value: "strength", label: "Strength" },
            { value: "recomp", label: "Recomp" },
            { value: "cut", label: "Fat Loss" },
          ]}
        />

        <OptionRow
          label="Experience"
          value={profile.experience}
          onChange={(v) => p({ experience: v })}
          options={[
            { value: "beginner", label: "Beginner" },
            { value: "intermediate", label: "Intermediate" },
            { value: "advanced", label: "Advanced" },
          ]}
        />

        <OptionRow
          label="Units"
          value={profile.units}
          onChange={(v) => p({ units: v })}
          options={[
            { value: "kg", label: "Metric (kg)" },
            { value: "lbs", label: "Imperial (lbs)" },
          ]}
        />

        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">Days per week</div>
          <div className="flex gap-2">
            {[3, 4, 5, 6].map((d) => (
              <button
                key={d}
                onClick={() => p({ days_per_week: d })}
                className={`flex-1 py-3 rounded-xl border-2 font-mono text-lg font-bold transition-all ${
                  profile.days_per_week === d
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:border-primary/40"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <Button
          onClick={saveProfile}
          disabled={saving || !profileChanged}
          className="w-full font-mono uppercase tracking-wider"
        >
          {saved ? <><Check size={14} className="mr-1.5" />Saved</> : saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      {/* Missed workouts */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Missed workouts</div>
        <p className="text-xs text-muted-foreground font-mono mb-3">Pushes any overdue sessions to the next available days.</p>
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
          <Input
            placeholder="Weight (kg)"
            type="number"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="bg-secondary border-border"
            data-testid="body-weight-input"
          />
          <Input
            placeholder="Body fat %"
            type="number"
            value={bf}
            onChange={(e) => setBf(e.target.value)}
            className="bg-secondary border-border"
            data-testid="body-bf-input"
          />
          <Button onClick={saveBody} className="bg-primary text-primary-foreground" data-testid="body-save-btn">
            <Plus size={16} />
          </Button>
        </div>
        {body.length > 0 && (
          <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
            {body.slice(0, 8).map((b) => (
              <div key={b.id} className="flex justify-between text-[11px] font-mono text-muted-foreground">
                <span>{new Date(b.recorded_at).toLocaleDateString()}</span>
                <span>
                  {b.weight_kg ? `${b.weight_kg}kg` : ""} {b.body_fat_pct ? `${b.body_fat_pct}%` : ""}
                </span>
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
            <button
              key={s.id}
              onClick={() => switchSplit(s.id)}
              data-testid={`switch-split-${s.id}`}
              className="w-full text-left p-3 border border-border rounded-xl hover:border-primary/50 transition-colors"
            >
              <div className="flex justify-between items-center">
                <div className="font-display text-sm font-semibold">{s.name}</div>
                <div className="text-[10px] font-mono text-muted-foreground">{s.days_per_week}d/wk</div>
              </div>
              {s.description && <div className="text-xs text-muted-foreground mt-0.5">{s.description}</div>}
            </button>
          ))}
        </div>
      </div>

      <Button
        onClick={logout}
        variant="outline"
        className="w-full font-mono uppercase tracking-wider"
        data-testid="logout-btn"
      >
        <LogOut size={14} className="mr-2" />Sign out
      </Button>
    </div>
  );
}
