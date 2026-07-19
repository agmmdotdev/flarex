import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const appRoot = new URL("../", import.meta.url);
const stateDirectory = new URL("../.probe-state/", import.meta.url);
const tokenUrl = new URL("p28-token.txt", stateDirectory);
const token = randomBytes(32).toString("base64url");
await mkdir(stateDirectory, { recursive: true });
await rm(tokenUrl, { force: true });
await writeFile(tokenUrl, token, {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx",
});

const wranglerCli = createRequire(import.meta.url).resolve("wrangler");
const child = spawn(
  process.execPath,
  [
    wranglerCli,
    "secret",
    "put",
    "RUNTIME_TOPOLOGY_PROBE_TOKEN",
    "--config",
    "wrangler.gateway.jsonc",
  ],
  {
    cwd: filePath(appRoot),
    stdio: ["pipe", "pipe", "pipe"],
  },
);
child.stdin.end(token);
let output = "";
child.stdout.on("data", chunk => {
  output += String(chunk);
});
child.stderr.on("data", chunk => {
  output += String(chunk);
});
const code = await new Promise<number | null>((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});
if (code !== 0) {
  await rm(tokenUrl, { force: true });
  throw new Error(`Wrangler secret update failed: ${output.slice(-2_000)}`);
}
process.stdout.write(`${JSON.stringify({
  kind: "probe-token-configured",
  worker: "flarex-runtime-topology-probe-gateway",
})}\n`);

function filePath(url: URL): string {
  return decodeURIComponent(url.pathname).replace(/^\/(?:([A-Za-z]:))/, "$1");
}
