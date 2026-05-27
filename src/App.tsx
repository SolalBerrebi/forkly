import { ReactFlowProvider } from "@xyflow/react";
import { useEffect } from "react";
import { ForkCanvas } from "./canvas/ForkCanvas";
import { TopBar } from "./chrome/TopBar";
import { useWorkspaceStore } from "./state/workspaceStore";

function App() {
  const hydrate = useWorkspaceStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <ReactFlowProvider>
      <main className="relative h-screen w-screen overflow-hidden bg-[var(--color-bg)]">
        <TopBar />
        <ForkCanvas />
      </main>
    </ReactFlowProvider>
  );
}

export default App;
