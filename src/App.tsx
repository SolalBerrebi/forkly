import * as Tooltip from "@radix-ui/react-tooltip";
import { ReactFlowProvider } from "@xyflow/react";
import { useEffect } from "react";
import { ForkCanvas } from "./canvas/ForkCanvas";
import { TopBar } from "./chrome/TopBar";
import { applyAppearance, getInitialAppearance } from "./lib/appearance";
import { applyChatTextSize, getInitialChatTextSize } from "./lib/chatTextSize";
import { subscribeStreamEvents } from "./lib/streamBridge";
import { AppearanceProvider } from "./state/appearanceContext";
import { useWorkspaceStore } from "./state/workspaceStore";

function App() {
  const hydrate = useWorkspaceStore((s) => s.hydrate);

  // Apply persisted UI preferences before first paint so messages render at
  // the user's preferred size and appearance on cold launch (no visible jump).
  useEffect(() => {
    applyChatTextSize(getInitialChatTextSize());
    applyAppearance(getInitialAppearance());
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

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
        </ReactFlowProvider>
      </Tooltip.Provider>
    </AppearanceProvider>
  );
}

export default App;
