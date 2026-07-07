import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(__dirname),
  resolve: {
    dedupe: [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@codemirror/commands",
      "@codemirror/search",
      "@codemirror/lint",
      "@codemirror/autocomplete",
    ],
  },
  plugins: [react()],
  server: {
    host: process.env.HOST || "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        // Proxy API/SSE/WS requests to the pi-kot backend
        target: `http://localhost:${process.env.VITE_API_PORT ?? "3332"}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
