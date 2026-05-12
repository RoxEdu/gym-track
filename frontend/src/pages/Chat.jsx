import { useAuth } from "../lib/auth";
import CoachChat from "../components/CoachChat";

export default function Chat() {
  const { user } = useAuth();
  const name = (user?.name || "").split(" ")[0] || "there";

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <div className="px-5 pt-6 pb-3 flex-shrink-0">
        <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-1">/ coach</div>
        <h1 className="font-display text-3xl font-bold">Ask your coach</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <CoachChat name={name} />
      </div>
    </div>
  );
}
