import { generateFlarex } from "flarex-dev";
import { fileURLToPath } from "node:url";

await generateFlarex({
  root: fileURLToPath(new URL("..", import.meta.url)),
});
