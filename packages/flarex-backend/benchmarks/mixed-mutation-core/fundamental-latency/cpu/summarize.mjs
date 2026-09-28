import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const directory = process.argv[2];
if (directory === undefined) throw new Error("Usage: node summarize.mjs <diagnostic-output-directory>");
const raw = JSON.parse(existsSync(join(directory, "raw.json"))
  ? readFileSync(join(directory, "raw.json"), "utf8")
  : gunzipSync(readFileSync(join(directory, "raw.json.gz"))).toString("utf8"));
if (raw.diagnostic?.kind !== "node-inspector-cpu" || raw.mode !== "smoke" ||
  raw.observationMode !== "untraced") throw new Error("Expected untraced Node CPU diagnostic smoke");

function bucket(frame) {
  const url = frame.url;
  if (frame.functionName === "(idle)") return "idle";
  if (frame.functionName === "(garbage collector)") return "gc";
  if (url.startsWith("node:inspector")) return "inspector";
  if (url.includes("/effect/dist/") || url.includes("/effect@")) return "effect";
  if (url.includes("/drizzle-orm/")) return "drizzle";
  if (url.includes("/pg/lib/") || url.includes("/pg@")) return "pgDriver";
  if (url.startsWith("./packages/persistence-postgres/")) return "persistence";
  if (url.startsWith("./packages/flarex-protocol/")) return "protocol";
  if (url.startsWith("./packages/medusa-adapter/")) return "medusaAdapter";
  if (url.startsWith("./packages/payload-adapter/")) return "payloadAdapter";
  if (url.startsWith("node:")) return "nodeOther";
  if (url === "") return "nativeOther";
  return "other";
}

const rows = [];
for (const sample of raw.samples) {
  if (sample.status !== "ok") throw new Error(`Failed diagnostic sample ${sample.id}`);
  const profilePath = join(directory, "cpu", `${sample.id}.cpuprofile`);
  const profileBytes = existsSync(profilePath) ? readFileSync(profilePath)
    : gunzipSync(readFileSync(`${profilePath}.gz`));
  const sidecar = JSON.parse(readFileSync(join(directory, "cpu", `${sample.id}.json`), "utf8"));
  if (sidecar.id !== sample.id || sidecar.workload !== sample.workload ||
    sidecar.temperature !== sample.temperature || sidecar.revision !== raw.revision ||
    sidecar.workingDiffSha256 !== raw.workingDiffSha256 ||
    JSON.stringify(sidecar.sourceHashes) !== JSON.stringify(raw.environment.sourceHashes) ||
    createHash("sha256").update(profileBytes).digest("hex") !== sidecar.profileSha256 ||
    Math.abs(sidecar.invocationWallMs - sample.wallMs) > 0.001)
    throw new Error(`Profile identity mismatch ${sample.id}`);
  const profile = JSON.parse(profileBytes.toString("utf8"));
  if (profile.samples.length !== profile.timeDeltas.length)
    throw new Error(`Profile sample/delta mismatch ${sample.id}`);
  if (![sample.wallMs, sidecar.invocationWallMs, profile.startTime, profile.endTime]
    .every(value => typeof value === "number" && Number.isFinite(value) && value >= 0) ||
    profile.endTime < profile.startTime ||
    profile.timeDeltas.some(value => typeof value !== "number" || !Number.isFinite(value) ||
      value < 0)) throw new Error(`Invalid profile timing ${sample.id}`);
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const weights = {};
  for (let i = 0; i < profile.samples.length; i++) {
    const frame = nodes.get(profile.samples[i])?.callFrame;
    if (frame === undefined) throw new Error(`Missing CPU node ${sample.id}`);
    const group = bucket(frame);
    weights[group] = (weights[group] ?? 0) + profile.timeDeltas[i] / 1000;
  }
  rows.push({ id: sample.id, workload: sample.workload,
    temperature: sample.temperature, invocationWallMs: sample.wallMs,
    profileWindowMs: (profile.endTime - profile.startTime) / 1000,
    leafSampleWeightsMs: Object.fromEntries(Object.entries(weights).sort()),
  });
}
process.stdout.write(JSON.stringify({ format: "flarex.node-cpu-leaf-sample-summary",
  note: "Disjoint leaf timeDelta weights, including idle/GC/Inspector overhead; not CPU self-time proof, invocation-only duration, allocation accounting or latency acceptance.",
  revision: raw.revision, workingDiffSha256: raw.workingDiffSha256,
  rows }, null, 2) + "\n");
