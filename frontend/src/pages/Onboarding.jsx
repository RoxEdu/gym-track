import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";
import { ChevronRight, ChevronLeft, Loader2 } from "lucide-react";

const STEPS = [
  "welcome", "sex", "units", "age", "height", "weight",
  "experience", "goal", "schedule", "equipment", "split",
];
const EQUIPMENT = ["barbell", "dumbbell", "machine", "cable", "bodyweight"];

export default function Onboarding() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [data, setData] = useState({
    sex: "male", age: 25, height_cm: 175, weight_kg: 75,
    experience: "intermediate", goal: "hypertrophy", days_per_week: 4,
    equipment: ["barbell", "dumbbell", "machine", "cable", "bodyweight"], units: "kg",
  });
  const [splits, setSplits] = useState([]);
  const [selectedSplit, setSelectedSplit] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const d = (update) => setData((prev) => ({ ...prev, ...update }));

  const next = async () => {
    if (STEPS[step] === "equipment") {
      try {
        const r = await api.get("/splits");
        setSplits(r.data);
      } catch {}
    }
    if (step === STEPS.length - 1) {
      setSubmitting(true);
      try {
        await api.put("/profile/onboarding", data);
        if (selectedSplit) {
          await api.post("/programs", { split_id: selectedSplit, weeks: 4 });
        }
        await refresh();
        navigate("/today", { replace: true });
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setStep(step + 1);
  };

  const back = () => setStep(Math.max(0, step - 1));

  const cmToDisplay = (cm) => {
    if (data.units === "kg") return `${cm} cm`;
    const totalIn = cm / 2.54;
    const ft = Math.floor(totalIn / 12);
    const inch = Math.round(totalIn % 12);
    return `${ft}'${inch}"`;
  };

  const kgToDisplay = (kg) => {
    if (data.units === "kg") return `${kg.toFixed(1)} kg`;
    return `${Math.round(kg * 2.20462)} lbs`;
  };

  const SCHEDULE_HINT = {
    3: "Full Body · 3×/week",
    4: "Upper / Lower · 4×/week",
    5: "PPL + extras · 5×/week",
    6: "Push / Pull / Legs · 6×/week",
  };

  const renderStep = () => {
    switch (STEPS[step]) {
      case "welcome":
        return (
          <div className="space-y-5">
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary">/ welcome</div>
            <h2 className="font-display text-5xl font-bold leading-tight">Let's calibrate.</h2>
            <p className="text-muted-foreground text-lg leading-relaxed">A few questions to build your program and tune volume targets to your level. Takes about 60 seconds.</p>
          </div>
        );

      case "sex":
        return (
          <div className="space-y-6">
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary">/ about you</div>
            <h2 className="font-display text-4xl font-bold">Biological sex?</h2>
            <div className="flex gap-3">
              {["male", "female", "other"].map((o) => (
                <button
                  key={o}
                  data-testid={`onboarding-sex-${o}`}
                  onClick={() => d({ sex: o })}
                  className={`flex-1 py-6 rounded-2xl border-2 font-mono uppercase text-sm tracking-wider transition-all ${data.sex === o ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        );

      case "units":
        return (
          <div className="space-y-6">
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary">/ units</div>
            <h2 className="font-display text-4xl font-bold">Preferred units?</h2>
            <div className="flex gap-4">
              {[
                { k: "kg", t: "Metric", sub: "kg · cm" },
                { k: "lbs", t: "Imperial", sub: "lbs · ft" },
              ].map((u) => (
                <button
                  key={u.k}
                  data-testid={`onboarding-units-${u.k}`}
                  onClick={() => d({ units: u.k })}
                  className={`flex-1 py-8 rounded-2xl border-2 transition-all ${data.units === u.k ? "bg-primary/10 border-primary" : "border-border hover:border-primary/40"}`}
                >
                  <div className="font-display text-3xl font-bold">{u.t}</div>
                  <div className="text-xs font-mono text-muted-foreground mt-1">{u.sub}</div>
                </button>
              ))}
            </div>
          </div>
        );

      case "age":
        return (
          <div className="space-y-6">
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary">/ age</div>
            <h2 className="font-display text-4xl font-bold">How old are you?</h2>
            <SliderField
              value={data.age} min={14} max={70} step={1}
              displayValue={data.age}
              unit="yrs"
              testid="onboarding-age"
              onChange={(v) => d({ age: v })}
            />
          </div>
        );

      case "height":
        return (
          <div className="space-y-6">
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary">/ height</div>
            <h2 className="font-display text-4xl font-bold">How tall are you?</h2>
            <SliderField
              value={data.height_cm} min={140} max={220} step={1}
              displayValue={cmToDisplay(data.height_cm)}
              testid="onboarding-height"
              onChange={(v) => d({ height_cm: v })}
            />
          </div>
        );

      case "weight":
        return (
          <div className="space-y-6">
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary">/ weight</div>
            <h2 className="font-display text-4xl font-bold">Current bodyweight?</h2>
            <SliderField
              value={data.weight_kg} min={40} max={200} step={0.5}
              displayValue={kgToDisplay(data.weight_kg)}
              testid="onboarding-weight"
              onChange={(v) => d({ weight_kg: v })}
            />
          </div>
        );

      case "experience":
        return (
          <div className="space-y-6">
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary">/ experience</div>
            <h2 className="font-display text-4xl font-bold">How long have you been training?</h2>
            <div className="space-y-3">
              {[
                { k: "beginner", t: "Beginner", d: "Less than 1 year of consistent training" },
                { k: "intermediate", t: "Intermediate", d: "1–3 years, can run your own programming" },
                { k: "advanced", t: "Advanced", d: "3+ years, approaching genetic ceiling" },
              ].map((o) => (
                <button
                  key={o.k}
                  data-testid={`onboarding-exp-${o.k}`}
                  onClick={() => d({ experience: o.k })}
                  className={`w-full text-left p-5 rounded-2xl border-2 transition-all ${data.experience === o.k ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                >
                  <div className="font-display text-xl font-semibold">{o.t}</div>
                  <div className="text-sm text-muted-foreground mt-0.5">{o.d}</div>
                </button>
              ))}
            </div>
          </div>
        );

      case "goal":
        return (
          <div className="space-y-6">
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary">/ goal</div>
            <h2 className="font-display text-4xl font-bold">Primary goal?</h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { k: "hypertrophy", t: "Hypertrophy", d: "Build muscle size" },
                { k: "strength", t: "Strength", d: "Move more weight" },
                { k: "recomp", t: "Recomp", d: "Lose fat, gain muscle" },
                { k: "cut", t: "Fat Loss", d: "Reduce body fat" },
              ].map((o) => (
                <button
                  key={o.k}
                  data-testid={`onboarding-goal-${o.k}`}
                  onClick={() => d({ goal: o.k })}
                  className={`p-5 rounded-2xl border-2 text-left transition-all ${data.goal === o.k ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                >
                  <div className="font-display text-xl font-bold">{o.t}</div>
                  <div className="text-xs text-muted-foreground mt-1">{o.d}</div>
                </button>
              ))}
            </div>
          </div>
        );

      case "schedule":
        return (
          <div className="space-y-6">
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary">/ schedule</div>
            <h2 className="font-display text-4xl font-bold">Days per week?</h2>
            <div className="grid grid-cols-4 gap-3">
              {[3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  data-testid={`onboarding-days-${n}`}
                  onClick={() => d({ days_per_week: n })}
                  className={`py-9 rounded-2xl border-2 font-mono text-4xl font-bold transition-all ${data.days_per_week === n ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40"}`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground font-mono">{SCHEDULE_HINT[data.days_per_week]}</p>
          </div>
        );

      case "equipment":
        return (
          <div className="space-y-6">
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary">/ equipment</div>
            <h2 className="font-display text-4xl font-bold">What do you have access to?</h2>
            <div className="space-y-2">
              {EQUIPMENT.map((e) => {
                const on = data.equipment.includes(e);
                return (
                  <button
                    key={e}
                    data-testid={`onboarding-eq-${e}`}
                    onClick={() => d({ equipment: on ? data.equipment.filter(x => x !== e) : [...data.equipment, e] })}
                    className={`w-full flex items-center justify-between px-5 py-4 rounded-2xl border-2 font-mono uppercase text-sm tracking-wider transition-all ${on ? "bg-primary/5 border-primary text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}
                  >
                    {e}
                    <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${on ? "bg-primary border-primary" : "border-muted-foreground"}`}>
                      {on && <div className="w-2 h-2 bg-primary-foreground rounded-full" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );

      case "split": {
        const sorted = [...splits].sort((a, b) => (a.days_per_week || 0) - (b.days_per_week || 0));
        return (
          <div className="space-y-4">
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary">/ split</div>
            <h2 className="font-display text-4xl font-bold">Pick any split.</h2>
            <p className="text-sm text-muted-foreground">Choose whatever structure suits you — ignore the day count if you want.</p>
            <div className="space-y-2">
              {sorted.length === 0 && (
                <div className="text-xs text-muted-foreground font-mono p-4 text-center">Loading splits…</div>
              )}
              {sorted.map((s) => (
                <button
                  key={s.id}
                  data-testid={`onboarding-split-${s.id}`}
                  onClick={() => setSelectedSplit(s.id)}
                  className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${selectedSplit === s.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                >
                  <div className="flex justify-between items-center mb-1">
                    <div className="font-display text-xl font-semibold">{s.name}</div>
                    <span className="text-xs font-mono text-muted-foreground bg-secondary px-2 py-0.5 rounded-full flex-shrink-0">{s.days_per_week}d/wk</span>
                  </div>
                  <div className="text-sm text-muted-foreground mb-2">{s.description}</div>
                  <div className="flex flex-wrap gap-1">
                    {(s.days || []).map((day) => (
                      <span key={day.day_index} className="text-[10px] font-mono bg-secondary px-2 py-0.5 rounded-full text-muted-foreground">{day.name}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  const canProceed = () => {
    if (STEPS[step] === "split") return !!selectedSplit;
    if (STEPS[step] === "equipment") return data.equipment.length > 0;
    return true;
  };

  return (
    <div className="min-h-screen flex flex-col px-6 max-w-xl mx-auto">
      <div className="grain" />

      {/* Progress bar — top with explicit safe-area padding */}
      <div className="pt-14 pb-5 flex gap-1.5">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= step ? "bg-primary" : "bg-secondary"}`}
          />
        ))}
      </div>

      {/* Spacer — pushes content to bottom half of screen */}
      <div className="flex-1 min-h-[40px]" />

      {/* Question content */}
      <div className="fade-up pb-8" key={step}>
        {renderStep()}
      </div>

      {/* Navigation */}
      <div className="pb-12 flex items-center gap-3">
        {step > 0 && (
          <Button variant="ghost" onClick={back} data-testid="onboarding-back" className="px-3">
            <ChevronLeft size={18} />
          </Button>
        )}
        <div className="flex-1" />
        <Button
          onClick={next}
          disabled={!canProceed() || submitting}
          className="bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-6 font-mono uppercase tracking-wider"
          data-testid="onboarding-next"
        >
          {submitting ? (
            <Loader2 size={16} className="animate-spin mr-2" />
          ) : null}
          {step === STEPS.length - 1 ? "Let's go" : "Next"}
          {!submitting && <ChevronRight size={16} className="ml-1" />}
        </Button>
      </div>
    </div>
  );
}

function SliderField({ value, min, max, step = 1, displayValue, unit, testid, onChange }) {
  const dec = () => onChange(Math.max(min, Math.round((value - step) / step) * step));
  const inc = () => onChange(Math.min(max, Math.round((value + step) / step) * step));
  return (
    <div className="space-y-5">
      <div className="font-display text-6xl font-bold tabular-nums">
        {typeof displayValue === "string" ? displayValue : (
          <>
            {displayValue}
            {unit && <span className="text-3xl font-normal text-muted-foreground ml-2">{unit}</span>}
          </>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        data-testid={testid}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 rounded-full cursor-pointer"
        style={{ accentColor: "hsl(var(--primary))" }}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-muted-foreground">{min}</span>
        <div className="flex items-center gap-4">
          <button
            onClick={dec}
            className="w-12 h-12 rounded-full border-2 border-border flex items-center justify-center text-2xl font-mono hover:border-primary hover:text-primary transition-colors"
          >−</button>
          <button
            onClick={inc}
            className="w-12 h-12 rounded-full border-2 border-border flex items-center justify-center text-2xl font-mono hover:border-primary hover:text-primary transition-colors"
          >+</button>
        </div>
        <span className="text-xs font-mono text-muted-foreground">{max}</span>
      </div>
    </div>
  );
}
