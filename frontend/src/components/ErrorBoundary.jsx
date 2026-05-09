import React from "react";

export default class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    // Log for debugging
    console.error("[ErrorBoundary]", error, info);
  }
  reset = () => {
    this.setState({ error: null });
    window.location.href = "/today";
  };
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center px-6 bg-background text-foreground" data-testid="error-boundary">
          <div className="max-w-md text-center">
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-destructive mb-3">/ error</div>
            <h1 className="font-display text-4xl font-bold mb-3">Something cracked.</h1>
            <p className="text-sm text-muted-foreground mb-6">
              An unexpected error happened. Your logged sets are safe — they live on our backend. Reload to continue.
            </p>
            <pre className="text-[10px] font-mono p-3 bg-card border border-border rounded-md text-left overflow-auto max-h-32 mb-6">{String(this.state.error?.message || this.state.error)}</pre>
            <button onClick={this.reset} className="bg-primary text-primary-foreground px-6 py-3 rounded-md font-mono uppercase tracking-wider text-sm" data-testid="error-reload">
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
