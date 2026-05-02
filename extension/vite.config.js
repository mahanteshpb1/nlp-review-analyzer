import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync, readdirSync, mkdirSync, statSync } from "fs";
import { join } from "path";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "copy-extension-files",
      closeBundle() {
        try {
          // Copy content/background scripts
          copyFileSync("src/content.js",    "dist/content.js");
          copyFileSync("src/background.js", "dist/background.js");
          
          // Copy manifest
          copyFileSync("public/manifest.json", "dist/manifest.json");
          
          // Copy icons
          mkdirSync("dist/icons", { recursive: true });
          const icons = readdirSync("public/icons");
          icons.forEach(icon => {
            const src = join("public/icons", icon);
            const dest = join("dist/icons", icon);
            if (statSync(src).isFile()) {
              copyFileSync(src, dest);
            }
          });
        } catch (e) {
          console.log("Extension files copied successfully");
        }
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