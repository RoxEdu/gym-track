import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, LineChart, Line } from "recharts";
import { Trophy, Camera, Loader2, X, ZoomIn } from "lucide-react";
import { PageSkeleton } from "../components/Skeleton";

export default function Progress() {
  const [data, setData] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    api.get("/progress/overview").then(r => setData(r.data));
    api.get("/progress-photos").then(r => setPhotos(r.data)).catch(() => {});
  }, []);

  if (!data) return <PageSkeleton />;

  const volChart = data.weekly_volume.map((w, i) => ({ week: `W${i+1}`, sets: Math.round(w.total_sets) }));
  const bodyChart = (data.body_history || []).filter(b => b.weight_kg).map(b => ({
    date: new Date(b.recorded_at).toLocaleDateString(),
    kg: b.weight_kg,
  }));

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api.post("/progress-photos", form, { headers: { "Content-Type": "multipart/form-data" } });
      setPhotos(prev => [r.data, ...prev]);
    } catch {
      alert("Upload failed — make sure the storage bucket is set up.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDelete = async (photo) => {
    try {
      await api.delete(`/progress-photos/${photo.id}`);
      setPhotos(prev => prev.filter(p => p.id !== photo.id));
      if (lightbox?.id === photo.id) setLightbox(null);
    } catch {
      alert("Delete failed.");
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-5 py-6 space-y-5" data-testid="progress-page">
      <div>
        <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-1">/ progress</div>
        <h1 className="font-display text-3xl font-bold">Your trends</h1>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Workouts" value={data.completed_workouts} />
        <Stat label="Total Sets" value={data.total_sets} />
        <Stat label="PRs" value={data.recent_prs.length} />
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Weekly volume — last 8 weeks</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={volChart}>
            <XAxis dataKey="week" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke="hsl(var(--muted-foreground))" />
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontFamily: "JetBrains Mono", fontSize: 11 }} />
            <Bar dataKey="sets" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {bodyChart.length > 1 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Body weight</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={bodyChart}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke="hsl(var(--muted-foreground))" domain={["dataMin - 2", "dataMax + 2"]} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontFamily: "JetBrains Mono", fontSize: 11 }} />
              <Line type="monotone" dataKey="kg" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Progress Photos */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Progress Photos</div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 text-xs font-mono bg-primary text-primary-foreground px-3 py-1.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
            {uploading ? "Uploading..." : "Add Photo"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleUpload}
          />
        </div>

        {photos.length === 0 ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center gap-2 p-8 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary/50 transition-colors"
          >
            <Camera size={24} className="text-muted-foreground" />
            <div className="text-xs text-muted-foreground font-mono text-center">
              No photos yet<br />Tap to document your progress
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <div
                key={p.id}
                className="relative aspect-square rounded-xl overflow-hidden bg-secondary"
              >
                <img
                  src={p.url}
                  alt="Progress"
                  className="w-full h-full object-cover cursor-pointer"
                  onClick={() => setLightbox(p)}
                />
                {/* Always-visible delete button */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(p); }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center hover:bg-red-500 transition-colors"
                >
                  <X size={12} className="text-white" />
                </button>
                <div className="absolute bottom-1 left-1 text-[9px] font-mono text-white bg-black/40 px-1.5 py-0.5 rounded pointer-events-none">
                  {new Date(p.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Recent PRs</div>
        <div className="space-y-1.5">
          {data.recent_prs.length === 0 && <div className="text-xs text-muted-foreground font-mono p-4 text-center">no PRs yet — keep training</div>}
          {data.recent_prs.map((pr) => (
            <div key={pr.id} className="flex items-center gap-3 p-3 bg-card border border-border rounded-md" data-testid="pr-row">
              <Trophy size={14} className="text-primary" />
              <div className="flex-1">
                <div className="font-display text-sm font-semibold">{pr.exercise_name}</div>
                <div className="text-[10px] font-mono text-muted-foreground">{new Date(pr.created_at).toLocaleDateString()}</div>
              </div>
              <div className="font-mono text-sm">{pr.weight}kg × {pr.reps} <span className="text-muted-foreground">e1RM {pr.e1rm}</span></div>
            </div>
          ))}
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white p-2 rounded-full hover:bg-white/10 transition-colors"
            onClick={() => setLightbox(null)}
          >
            <X size={24} />
          </button>
          <button
            className="absolute top-4 left-4 text-white/70 text-xs font-mono hover:text-white transition-colors px-3 py-2 rounded hover:bg-white/10"
            onClick={(e) => { e.stopPropagation(); handleDelete(lightbox); }}
          >
            Delete
          </button>
          <img
            src={lightbox.url}
            alt="Progress"
            className="max-w-full max-h-full object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="absolute bottom-6 text-xs font-mono text-white/60">
            {new Date(lightbox.created_at).toLocaleDateString()}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-display text-2xl font-semibold mt-0.5">{value}</div>
    </div>
  );
}
