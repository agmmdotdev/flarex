import { readFile } from "node:fs/promises";

import { verifyExecutorBundleMeta } from "./bundleGraph";

const metafilePath = process.argv[2];
if (metafilePath === undefined) {
  throw new Error("Usage: checkBundleMeta.ts <bundle-meta.json>");
}

const raw = await readFile(metafilePath, "utf8");
const parsed: unknown = JSON.parse(raw);
const result = verifyExecutorBundleMeta(parsed);

console.log(
  `Verified executor bundle graph: ${result.inputCount} inputs, ${result.outputCount} outputs, no migration/PGlite persistence inputs.`,
);
