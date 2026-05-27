import { ReactFlowProvider } from "@xyflow/react";
import { useEffect } from "react";
import { ForkCanvas } from "./canvas/ForkCanvas";
import { TopBar } from "./chrome/TopBar";
import { subscribeStreamEvents } from "./lib/streamBridge";
import { useWorkspaceStore } from "./state/workspaceStore";

function App() {
  const hydrate = useWorkspaceStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    subscribeStreamEvents()
      .then((u) => {
        unlisten = u;
      })
      .catch((err) => console.error("stream subscription failed", err));
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  return (
    <ReactFlowProvider>
      <main className="relative h-screen w-screen overflow-hidden bg-bg">
        <TopBar />
        <ForkCanvas />
      </main>
    </ReactFlowProvider>
  );
}

export default App;
