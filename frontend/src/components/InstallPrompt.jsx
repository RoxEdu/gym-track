import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Download, X } from "lucide-react";

const DISMISSED_KEY = "gymtrack_install_dismissed_v1";

export default function InstallPrompt() {
  const [evt, setEvt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setEvt(e);
      const dismissed = localStorage.getItem(DISMISSED_KEY);
      if (!dismissed) setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!visible || !evt) return null;

  const install = async () => {
    evt.prompt();
    await evt.userChoice;
    setVisible(false);
  };
  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  };

  return (
    <div className="fixed bottom-24 inset-x-4 max-w-md mx-auto z-40 bg-card border border-primary/40 rounded-xl p-3 shadow-2xl flex items-center gap-3 fade-up" data-testid="install-prompt">
      <Download size={18} className="text-primary flex-shrink-0" />
      <div className="flex-1">
        <div className="font-display text-sm font-semibold">Install GymTrack</div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">add to home screen for offline use</div>
      </div>
      <Button size="sm" onClick={install} className="bg-primary text-primary-foreground" data-testid="install-confirm">Install</Button>
      <button onClick={dismiss} className="text-muted-foreground hover:text-foreground" data-testid="install-dismiss" aria-label="Dismiss"><X size={14} /></button>
    </div>
  );
}
