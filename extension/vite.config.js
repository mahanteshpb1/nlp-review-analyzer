import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync } from "fs";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "copy-extension-files",
      closeBundle() {
        // Copy content/background scripts (not bundled through Vite entry)
        // They're copied as-is since they run in page context
        copyFileSync("src/content.js",    "dist/content.js");
        copyFileSync("src/background.js", "dist/background.js");
      },
    },
  ],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
      },
    },
    // Keep chunks readable for debugging
    minify: "terser",
    sourcemap: false,
  },
});