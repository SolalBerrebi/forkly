import { ReactFlowProvider } from "@xyflow/react";
import { ForkCanvas } from "./canvas/ForkCanvas";
import { TopBar } from "./chrome/TopBar";

function App() {
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
