import { defineConfig } from "vite";
import { flarex } from "flarex-backend/vite";

export default defineConfig({
  plugins: [flarex({ workerName: "flarex-example" })],
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
