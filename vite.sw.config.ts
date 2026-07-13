import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: ".sw-build",
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/pwa/sw.ts"),
      name: "PotbellyServiceWorker",
      formats: ["es"],
      fileName: () => "sw-template.js",
    },
    rollupOptions: { output: { codeSplitting: false } },
  },
});
