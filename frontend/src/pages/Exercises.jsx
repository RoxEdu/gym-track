import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Input } from "../components/ui/input";
import { Search } from "lucide-react";

const CATEGORIES = ["all", "chest", "back", "shoulders", "arms", "legs", "core"];

export default function Exercises() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const params = {};
    if (filter !== "all") params.category = filter;
    if (search) params.search = search;
    api.get("/exercises", { params }).then(r => setItems(r.data));
  }, [filter, search]);

  return (
    <div className="max-w-2xl mx-auto px-5 py-6" data-testid="exercises-page">
      <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-1">/ library</div>
      <h1 className="font-display text-3xl font-bold mb-4">Exercises</h1>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
        <Input data-testid="exercise-search" placeholder="Search exercises..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 bg-card border-border" />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-5 px-5">
        {CATEGORIES.map((c) => (
          <button key={c} data-testid={`filter-${c}`} onClick={() => setFilter(c)} className={`px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-wider whitespace-nowrap border ${filter===c ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}>{c}</button>
        ))}
      </div>
      <div className="space-y-1.5">
        {items.map((e) => (
          <button key={e.id} onClick={() => navigate(`/exercises/${e.id}`)} data-testid={`exercise-item-${e.id}`} className="w-full text-left p-3 bg-card border border-border rounded-md hover:border-primary/50 transition-colors flex items-center justify-between">
            <div>
              <div className="font-display text-base font-semibold">{e.name}</div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-0.5">{e.category} • {e.equipment} • {e.movement}</div>
            </div>
            <div className="text-xs font-mono text-muted-foreground">→</div>
          </button>
        ))}
        {items.length === 0 && <div className="text-center py-12 text-muted-foreground text-sm font-mono">no exercises found</div>}
      </div>
    </div>
  );
}
