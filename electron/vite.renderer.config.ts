import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./renderer/", import.meta.url)),
  publicDir: fileURLToPath(new URL("../public/", import.meta.url)),
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("../src/", import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL("../dist-electron/renderer/", import.meta.url)),
    emptyOutDir: true,
  },
});
