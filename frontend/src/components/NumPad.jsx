import { useState } from "react";
import { Button } from "./ui/button";
import { Delete, Check } from "lucide-react";

/** Custom NumPad for set logging. value is string. onConfirm receives parsed number. */
export default function NumPad({ value, onChange, onConfirm, onClose, label = "WEIGHT" }) {
  const press = (k) => {
    if (k === "del") {
      onChange(value.slice(0, -1));
    } else if (k === ".") {
      if (!value.includes(".")) onChange(value + ".");
    } else {
      onChange((value === "0" ? "" : value) + k);
    }
  };
  const keys = ["1","2","3","4","5","6","7","8","9",".","0","del"];
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end" data-testid="numpad-overlay">
      <div className="w-full max-w-2xl mx-auto bg-card border-t border-border rounded-t-2xl p-4 fade-up">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
            <div className="font-display text-5xl font-semibold">{value || "0"}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="numpad-close">Cancel</Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {keys.map((k) => (
            <button
              key={k}
              data-testid={`numpad-${k}`}
              onClick={() => press(k)}
              className="numpad-key bg-secondary hover:bg-secondary/80 text-foreground py-4 rounded-md text-xl font-mono font-medium flex items-center justify-center"
            >
              {k === "del" ? <Delete size={20} /> : k}
            </button>
          ))}
        </div>
        <Button
          className="w-full mt-3 bg-primary text-primary-foreground hover:bg-primary/90 py-6 font-mono uppercase tracking-wider"
          onClick={() => onConfirm(parseFloat(value || "0"))}
          data-testid="numpad-confirm"
        >
          <Check size={18} className="mr-2" /> Confirm
        </Button>
      </div>
    </div>
  );
}
