import { Button } from "../components/ui/button";
import { supabase } from "../lib/supabase";

export default function Login() {
  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/auth/callback" },
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden bg-background">
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-primary/30 blur-3xl rounded-full" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-destructive/10 blur-3xl rounded-full" />
      </div>
      <div className="grain" />
      <div className="relative z-10 w-full max-w-md fade-up">
        <div className="mb-12">
          <div className="text-xs font-mono uppercase tracking-[0.4em] text-primary mb-3">/ gymtrack</div>
          <h1 className="font-display text-6xl sm:text-7xl font-bold leading-[0.95] tracking-tight">
            Train. <br/>
            <span className="text-primary">Measure.</span><br/>
            Adapt.
          </h1>
          <p className="mt-6 text-muted-foreground text-base max-w-sm">
            A serious progress tracker for serious lifters. Honest projections, deterministic insights, no hype.
          </p>
        </div>
        <Button
          onClick={handleLogin}
          data-testid="google-login-btn"
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 py-7 text-base font-mono uppercase tracking-widest rounded-md"
        >
          Continue with Google
        </Button>
        <div className="mt-8 grid grid-cols-3 gap-4 text-xs font-mono">
          <div><div className="text-primary text-lg">60+</div><div className="text-muted-foreground uppercase tracking-wider">exercises</div></div>
          <div><div className="text-primary text-lg">6</div><div className="text-muted-foreground uppercase tracking-wider">splits</div></div>
          <div><div className="text-primary text-lg">∞</div><div className="text-muted-foreground uppercase tracking-wider">progress</div></div>
        </div>
      </div>
    </div>
  );
}
