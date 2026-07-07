import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { getSavedTheme, applyTheme } from "./lib/theme";
import "./styles/themes.css";

// Apply saved theme before first render
applyTheme(getSavedTheme());

const root = document.getElementById("root");
if (root === null) throw new Error("root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
