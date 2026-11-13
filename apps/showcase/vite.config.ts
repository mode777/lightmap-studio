import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Deployed under the repository's GitHub Pages path.
export default defineConfig({
  base: "/lightmap-studio/",
  plugins: [react()],
  build: {
    target: "es2022",
    // Never inline assets (wasm especially) into the bundle.
    assetsInlineLimit: 0
  }
});
