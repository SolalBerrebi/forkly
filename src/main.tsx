import React from "react";
import ReactDOM from "react-dom/client";
// Bundle Geist locally — first-frame text on cold launch matches what users
// will see in screenshots and on signed-build first runs (no font flash).
import "@fontsource/geist-sans/300.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-mono/300.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@xyflow/react/dist/style.css";
import "./theme/globals.css";
import App from "./App";
import { ErrorBoundary } from "./chrome/ErrorBoundary";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary label="app">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
