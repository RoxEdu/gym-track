import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";

export default function AuthCallback() {
  const navigate = useNavigate();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        navigate("/login", { replace: true });
        return;
      }
      try {
        const r = await api.get("/auth/me");
        const dest = r.data?.onboarded ? "/today" : "/onboarding";
        navigate(dest, { replace: true });
      } catch {
        navigate("/login", { replace: true });
      }
    });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center" data-testid="auth-callback">
      <div className="text-center">
        <div className="font-display text-3xl mb-2">Signing in</div>
        <div className="text-muted-foreground text-sm font-mono">authenticating session...</div>
      </div>
    </div>
  );
}
