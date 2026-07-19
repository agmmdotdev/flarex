import { rm } from "node:fs/promises";

const paths = [
  new URL("../.probe-state/p28-token.txt", import.meta.url),
  new URL("../wrangler.postgres.runtime.jsonc", import.meta.url),
];
await Promise.all(paths.map(path => rm(path, { force: true })));
process.stdout.write(`${JSON.stringify({
  kind: "local-probe-secrets-removed",
  removedPaths: paths.length,
})}\n`);
