import { useEffect, useState } from "react";
import { WifiOff, CloudUpload } from "lucide-react";
import { getQueueSize } from "../lib/offlineQueue";

export default function OfflineBadge() {
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [queue, setQueue] = useState(0);

  useEffect(() => {
    const upd = () => setOnline(navigator.onLine);
    const refresh = () => getQueueSize().then(setQueue);
    window.addEventListener("online", upd);
    window.addEventListener("offline", upd);
    refresh();
    const t = setInterval(refresh, 4000);
    return () => { window.removeEventListener("online", upd); window.removeEventListener("offline", upd); clearInterval(t); };
  }, []);

  if (online && queue === 0) return null;
  return (
    <div className="fixed top-2 right-2 z-50 bg-card border border-border rounded-full px-3 py-1.5 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest" data-testid="offline-badge" role="status" aria-live="polite">
      {!online ? (
        <><WifiOff size={11} className="text-orange-400" /> <span>offline{queue > 0 ? ` · ${queue} queued` : ""}</span></>
      ) : (
        <><CloudUpload size={11} className="text-primary" /> <span>{queue} syncing</span></>
      )}
    </div>
  );
}
