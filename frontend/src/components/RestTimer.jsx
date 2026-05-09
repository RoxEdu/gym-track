import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Pause, Play, X, Plus, Minus } from "lucide-react";

export default function RestTimer({ seconds, onClose }) {
  const [remaining, setRemaining] = useState(seconds);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || remaining <= 0) return;
    const t = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(t);
  }, [paused, remaining]);

  useEffect(() => {
    if (remaining === 0) {
      try { navigator.vibrate?.(300); } catch {}
    }
  }, [remaining]);

  const mins = Math.max(0, Math.floor(remaining / 60));
  const secs = Math.max(0, remaining % 60);
  const pct = Math.max(0, (remaining / seconds) * 100);

  return (
    <div className="fixed bottom-20 inset-x-0 z-40 px-4 fade-up" data-testid="rest-timer">
      <div className="max-w-2xl mx-auto bg-card border border-border rounded-xl p-4 glow-accent">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Rest</div>
            <div className="font-display text-4xl font-semibold tabular-nums">
              {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
            </div>
            <div className="h-1 bg-secondary rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={() => setRemaining((r) => Math.max(0, r - 15))} data-testid="rest-minus"><Minus size={16} /></Button>
            <Button variant="ghost" size="icon" onClick={() => setRemaining((r) => r + 15)} data-testid="rest-plus"><Plus size={16} /></Button>
            <Button variant="ghost" size="icon" onClick={() => setPaused((p) => !p)} data-testid="rest-pause">{paused ? <Play size={16}/> : <Pause size={16} />}</Button>
            <Button variant="ghost" size="icon" onClick={onClose} data-testid="rest-close"><X size={16} /></Button>
          </div>
        </div>
      </div>
    </div>
  );
}
