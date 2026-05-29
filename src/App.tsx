import * as Tooltip from "@radix-ui/react-tooltip";
import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useState } from "react";
import { ForkCanvas } from "./canvas/ForkCanvas";
import { OnboardingDialog } from "./chrome/OnboardingDialog";
import { TopBar } from "./chrome/TopBar";
import { applyAppearance, getInitialAppearance } from "./lib/appearance";
import { applyChatTextSize, getInitialChatTextSize } from "./lib/chatTextSize";
import { isOnboarded } from "./lib/preferredProvider";
import { subscribeStreamEvents } from "./lib/streamBridge";
import { AppearanceProvider } from "./state/appearanceContext";
import { useDetectionStore } from "./state/detectionStore";
import { useWorkspaceStore } from "./state/workspaceStore";

function App() {
  const hydrate = useWorkspaceStore((s) => s.hydrate);
  const hydrateDetection = useDetectionStore((s) => s.hydrate);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  // Apply persisted UI preferences before first paint so messages render at
  // the user's preferred size and appearance on cold launch (no visible jump).
  useEffect(() => {
    applyChatTextSize(getInitialChatTextSize());
    applyAppearance(getInitialAppearance());
  }, []);

  useEffect(() => {
    hydrate();
    // Kick off CLI detection in parallel — Settings + ModelPicker read this
    // cache to decide which transport to default to for a given provider.
    hydrateDetection().catch((err) =>
      console.error("detection hydrate failed", err),
    );
    // First launch: show the chooser so the user lands in a working state
    // before they create their first session. We open after a short tick so
    // the canvas paints first and the modal animates in over a stable view.
    if (!isOnboarded()) {
      const t = window.setTimeout(() => setOnboardingOpen(true), 250);
      return () => window.clearTimeout(t);
    }
  }, [hydrate, hydrateDetection]);

  // Allow other parts of the chrome (Help popover's "re-run setup") to
  // request the dialog without prop-drilling. Cheap event channel via a
  // window-level CustomEvent — no need for global state.
  useEffect(() => {
    const handler = () => setOnboardingOpen(true);
    window.addEventListener("forkly:open-onboarding", handler);
    return () => window.removeEventListener("forkly:open-onboarding", handler);
  }, []);

  useEffect(() => {
    // Race-safe subscription pattern. Under React StrictMode + Vite HMR, the
    // cleanup can fire BEFORE subscribeStreamEvents() resolves. Without the
    // `cancelled` flag, the listeners would leak — and once enough HMR
    // cycles stack, you get duplicate event handling, runaway store
    // mutations, and the multi-GB memory blowup we just hit.
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    subscribeStreamEvents()
      .then((u) => {
        if (cancelled) {
          u();
        } else {
          unlisten = u;
        }
      })
      .catch((err) => console.error("stream subscription failed", err));
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  return (
    <AppearanceProvider>
      <Tooltip.Provider delayDuration={300} skipDelayDuration={150}>
        <ReactFlowProvider>
          <main className="relative h-screen w-screen overflow-hidden bg-bg">
            <TopBar />
            <ForkCanvas />
          </main>
          <OnboardingDialog open={onboardingOpen} onOpenChange={setOnboardingOpen} />
        </ReactFlowProvider>
      </Tooltip.Provider>
    </AppearanceProvider>
  );
}

export default App;
