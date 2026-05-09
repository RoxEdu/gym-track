import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function AuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    const hash = location.hash || window.location.hash;
    const m = hash.match(/session_id=([^&]+)/);
    if (!m) {
      navigate("/login", { replace: true });
      return;
    }
    const session_id = m[1];
    api.post("/auth/session", { session_id })
      .then((r) => {
        setUser(r.data.user);
        const dest = r.data.user?.onboarded ? "/today" : "/onboarding";
        navigate(dest, { replace: true, state: { user: r.data.user } });
      })
      .catch(() => navigate("/login", { replace: true }));
  }, [navigate, location, setUser]);

  return (
    <div className="min-h-screen flex items-center justify-center" data-testid="auth-callback">
      <div className="text-center">
        <div className="font-display text-3xl mb-2">Signing in</div>
        <div className="text-muted-foreground text-sm font-mono">authenticating session...</div>
      </div>
    </div>
  );
}
