import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Route } from "../../src/routes/index";
import "../../src/styles.css";

// The TanStack Start frontend normally hydrates an SSR route. For an offline
// file:// Electron window, render the existing page component directly.
// This keeps page components unchanged and avoids a local HTTP server.
const App = Route.options.component;
const root = document.getElementById("root");
if (!App || !root) throw new Error("The E-CLASS desktop root component is missing.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
