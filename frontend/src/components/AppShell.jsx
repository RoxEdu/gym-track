import { NavLink, useLocation } from "react-router-dom";
import { Activity, Dumbbell, TrendingUp, Sparkles, User } from "lucide-react";

const tabs = [
  { to: "/today", label: "Today", icon: Activity, testid: "nav-today" },
  { to: "/exercises", label: "Library", icon: Dumbbell, testid: "nav-exercises" },
  { to: "/progress", label: "Progress", icon: TrendingUp, testid: "nav-progress" },
  { to: "/insights", label: "Insights", icon: Sparkles, testid: "nav-insights" },
  { to: "/settings", label: "Profile", icon: User, testid: "nav-settings" },
];

export default function AppShell({ children }) {
  const loc = useLocation();
  return (
    <div className="min-h-screen bg-background text-foreground relative">
      <div className="grain" />
      <main className="pb-24 pt-2 relative z-10">{children}</main>
      <nav className="fixed bottom-0 inset-x-0 bg-card/95 backdrop-blur-xl border-t border-border bottom-nav-shadow z-50">
        <div className="max-w-2xl mx-auto grid grid-cols-5">
          {tabs.map((t) => {
            const active = loc.pathname.startsWith(t.to);
            const Icon = t.icon;
            return (
              <NavLink
                key={t.to}
                to={t.to}
                data-testid={t.testid}
                className={`flex flex-col items-center justify-center gap-1 py-3 transition-colors ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
                <span className="text-[10px] font-mono uppercase tracking-wider">{t.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
