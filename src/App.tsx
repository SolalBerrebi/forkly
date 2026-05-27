import { GitFork } from "lucide-react";

function App() {
  return (
    <main className="cross-grid relative flex h-screen w-screen items-center justify-center overflow-hidden">
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-[0_0_40px_-12px_rgba(124,92,255,0.4)]">
          <GitFork className="h-6 w-6 text-[var(--color-accent-from)]" />
        </div>

        <div className="space-y-2">
          <h1 className="font-mono text-3xl tracking-tight">
            forkly
          </h1>
          <p className="font-sans text-sm text-[var(--color-fg-muted)]">
            A spatial canvas for LLM conversations.
          </p>
        </div>

        <div className="mt-6 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/60 px-3 py-1 font-mono text-xs text-[var(--color-fg-subtle)]">
          M0 · scaffold complete
        </div>
      </div>

      <footer className="absolute bottom-4 right-4 font-mono text-xs text-[var(--color-fg-subtle)]">
        v0.1.0-dev
      </footer>
    </main>
  );
}

export default App;
