import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ChevronRight, ChevronLeft } from "lucide-react";

const STEPS = ["welcome", "stats", "experience", "goal", "schedule", "split"];
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

  const next = async () => {
    if (step === STEPS.length - 2) {
      // load splits before split selection
      try {
        const r = await api.get("/splits");
        setSplits(r.data);
      } catch {}
    }
    if (step === STEPS.length - 1) {
      await api.put("/profile/onboarding", data);
      if (selectedSplit) {
        await api.post("/programs", { split_id: selectedSplit, weeks: 4 });
      }
      await refresh();
      navigate("/today", { replace: true });
      return;
    }
    setStep(step + 1);
  };
  const back = () => setStep(Math.max(0, step - 1));

  const renderStep = () => {
    switch (STEPS[step]) {
      case "welcome":
        return (
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-3">/ welcome</div>
            <h2 className="font-display text-5xl font-bold leading-tight mb-4">Let's calibrate.</h2>
            <p className="text-muted-foreground">A few questions to set up your profile, generate a program, and tune volume targets to your level. Takes about 60 seconds.</p>
          </div>
        );
      case "stats":
        return (
          <div className="space-y-5">
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-3">/ stats</div>
            <h2 className="font-display text-4xl font-bold">Your basics.</h2>
            <div className="grid grid-cols-2 gap-3">
              {[{k:"sex",label:"Sex",options:["male","female","other"]}].map((f) => (
                <div key={f.k} className="col-span-2 flex gap-2">
                  {f.options.map((o) => (
                    <button key={o} data-testid={`onboarding-sex-${o}`} onClick={() => setData({...data, sex: o})} className={`flex-1 py-3 rounded-md font-mono uppercase text-xs tracking-wider border ${data.sex===o ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}>{o}</button>
                  ))}
                </div>
              ))}
              <Field label="Age" testid="onboarding-age" value={data.age} onChange={(v) => setData({...data, age: parseInt(v)||0})} />
              <Field label="Height (cm)" testid="onboarding-height" value={data.height_cm} onChange={(v) => setData({...data, height_cm: parseFloat(v)||0})} />
              <Field label="Weight (kg)" testid="onboarding-weight" value={data.weight_kg} onChange={(v) => setData({...data, weight_kg: parseFloat(v)||0})} />
              <div className="flex gap-2">
                {["kg","lbs"].map((u) => (
                  <button key={u} data-testid={`onboarding-units-${u}`} onClick={() => setData({...data, units: u})} className={`flex-1 py-3 rounded-md font-mono uppercase text-xs tracking-wider border ${data.units===u ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>{u}</button>
                ))}
              </div>
            </div>
          </div>
        );
      case "experience":
        return (
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-3">/ experience</div>
            <h2 className="font-display text-4xl font-bold mb-6">How long have you been training?</h2>
            <div className="space-y-3">
              {[
                {k:"beginner", t:"Beginner", d:"<1 year of consistent training"},
                {k:"intermediate", t:"Intermediate", d:"1-3 years, can program your own work"},
                {k:"advanced", t:"Advanced", d:"3+ years, near genetic ceiling on key lifts"},
              ].map((o) => (
                <button key={o.k} data-testid={`onboarding-exp-${o.k}`} onClick={() => setData({...data, experience: o.k})} className={`w-full text-left p-4 rounded-md border transition-all ${data.experience===o.k ? "border-primary bg-primary/5" : "border-border"}`}>
                  <div className="font-display text-xl font-semibold">{o.t}</div>
                  <div className="text-sm text-muted-foreground">{o.d}</div>
                </button>
              ))}
            </div>
          </div>
        );
      case "goal":
        return (
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-3">/ goal</div>
            <h2 className="font-display text-4xl font-bold mb-6">What's the primary goal?</h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                {k:"hypertrophy", t:"Hypertrophy"},
                {k:"strength", t:"Strength"},
                {k:"recomp", t:"Recomp"},
                {k:"cut", t:"Fat Loss"},
              ].map((o) => (
                <button key={o.k} data-testid={`onboarding-goal-${o.k}`} onClick={() => setData({...data, goal: o.k})} className={`p-5 rounded-md border ${data.goal===o.k ? "border-primary bg-primary/5" : "border-border"}`}>
                  <div className="font-display text-2xl font-semibold">{o.t}</div>
                </button>
              ))}
            </div>
          </div>
        );
      case "schedule":
        return (
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-3">/ schedule</div>
            <h2 className="font-display text-4xl font-bold mb-6">Days per week?</h2>
            <div className="grid grid-cols-4 gap-2">
              {[3,4,5,6].map((d) => (
                <button key={d} data-testid={`onboarding-days-${d}`} onClick={() => setData({...data, days_per_week: d})} className={`py-6 rounded-md border font-mono text-2xl ${data.days_per_week===d ? "border-primary bg-primary/5 text-primary" : "border-border"}`}>{d}</button>
              ))}
            </div>
            <h3 className="font-display text-2xl font-semibold mt-8 mb-3">Equipment available</h3>
            <div className="flex flex-wrap gap-2">
              {EQUIPMENT.map((e) => {
                const on = data.equipment.includes(e);
                return (
                  <button key={e} data-testid={`onboarding-eq-${e}`} onClick={() => setData({...data, equipment: on ? data.equipment.filter(x => x !== e) : [...data.equipment, e]})} className={`px-4 py-2 rounded-full text-xs font-mono uppercase tracking-wider border ${on ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}>{e}</button>
                );
              })}
            </div>
          </div>
        );
      case "split":
        return (
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-3">/ split</div>
            <h2 className="font-display text-4xl font-bold mb-6">Pick a split</h2>
            <div className="space-y-3">
              {splits.map((s) => (
                <button key={s.id} data-testid={`onboarding-split-${s.id}`} onClick={() => setSelectedSplit(s.id)} className={`w-full text-left p-4 rounded-md border ${selectedSplit===s.id ? "border-primary bg-primary/5" : "border-border"}`}>
                  <div className="flex justify-between items-center mb-1">
                    <div className="font-display text-xl font-semibold">{s.name}</div>
                    <div className="text-xs font-mono text-muted-foreground">{s.frequency_per_week}x/week</div>
                  </div>
                  <div className="text-sm text-muted-foreground">{s.description}</div>
                </button>
              ))}
            </div>
          </div>
        );
      default: return null;
    }
  };

  const canProceed = STEPS[step] !== "split" || !!selectedSplit;

  return (
    <div className="min-h-screen px-6 py-10 max-w-xl mx-auto relative">
      <div className="grain" />
      <div className="mb-8 flex gap-1.5">
        {STEPS.map((_, i) => (
          <div key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-secondary"}`} />
        ))}
      </div>
      <div className="fade-up" key={step}>{renderStep()}</div>
      <div className="mt-12 flex gap-3">
        {step > 0 && <Button variant="ghost" onClick={back} data-testid="onboarding-back"><ChevronLeft size={16} /> Back</Button>}
        <div className="flex-1" />
        <Button onClick={next} disabled={!canProceed} className="bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-6 font-mono uppercase tracking-wider" data-testid="onboarding-next">
          {step === STEPS.length - 1 ? "Finish" : "Next"} <ChevronRight size={16} className="ml-1" />
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, testid }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <Input type="number" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid} className="bg-secondary border-border font-mono text-lg" />
    </div>
  );
}
