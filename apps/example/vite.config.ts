import { defineConfig } from "vite";
import { flarex } from "flarex-dev/vite";

export default defineConfig({
  plugins: [flarex()],
  build: {
    lib: {
      entry: "flarex/_generated/worker.ts",
      formats: ["es"],
      fileName: "worker",
    },
    rollupOptions: {
      external: ["cloudflare:workers"],
    },
  },
});
