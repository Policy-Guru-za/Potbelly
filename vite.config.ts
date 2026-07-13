import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    chunkSizeWarningLimit: 650,
    outDir: ".web-assets",
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, "src/client/app.ts"),
        info: resolve(import.meta.dirname, "src/client/info.ts"),
        recipe: resolve(import.meta.dirname, "src/client/recipe.ts"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/chunks/[name]-[hash].js",
        assetFileNames: ({ names }) => names.includes("style.css") ? "assets/site-[hash][extname]" : "assets/[name]-[hash][extname]",
      },
    },
  },
});
