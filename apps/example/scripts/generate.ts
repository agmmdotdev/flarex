import { generateFlarex } from "flarex-backend";
import { fileURLToPath } from "node:url";

await generateFlarex({
  root: fileURLToPath(new URL("..", import.meta.url)),
  workerName: "flarex-example",
});
