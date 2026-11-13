import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { deserialize } from "node:v8";
import { Schema } from "effect";
import * as SchemaAOTCompiler from "effect/schema/SchemaAOTCompiler";
import { suites } from "./cases";

const { values } = parseArgs({ options: { out: { type: "string" },
  iterations: { type: "string", default: "100000" }, rounds: { type: "string", default: "5" } } });
assert(values.out !== undefined, "Provide --out <artifact directory>");
const iterations = Number(values.iterations), rounds = Number(values.rounds);
assert(Number.isSafeInteger(iterations) && iterations > 0 && iterations <= 10000000);
assert(Number.isSafeInteger(rounds) && rounds > 0 && rounds <= 20);
const out = resolve(values.out);
await mkdir(out, { recursive: true });
const generatedPath = resolve(out, "core-schema-aot.mjs");
const source = SchemaAOTCompiler.compile(suites.map(suite => ({ ast: suite.schema.ast, operations: ["decode"] })));
const runtimeSpecifier = JSON.stringify("effect/schema/SchemaCompiler/runtime");
assert(source.includes(runtimeSpecifier));
// Permit an external artifact directory to resolve this exact installed runtime.
// The emitted parser code itself is unchanged and contains no dynamic compilation.
const generated = source.replace(runtimeSpecifier, JSON.stringify(import.meta.resolve("effect/schema/SchemaCompiler/runtime")));
await writeFile(generatedPath, generated);
const Measurement = Schema.Struct({ name: Schema.String, input: Schema.Literals(["valid", "invalid"]),
  policy: Schema.Literals(["default", "strict"]),
  iterations: Schema.Int, nsPerDecode: Schema.Finite, cpuMs: Schema.Finite, successes: Schema.Int });
const decodeWorker = Schema.decodeUnknownSync(Schema.Struct({ mode: Schema.Literals(["interpreter", "aot"]),
  observations: Schema.String, measurements: Schema.Array(Measurement) }));
const runs: (ReturnType<typeof decodeWorker> & { readonly round: number })[] = [];
let reference: unknown;
for (let round = 0; round < rounds; round++) {
  for (const mode of round % 2 === 0 ? ["interpreter", "aot"] : ["aot", "interpreter"]) {
    const child = spawnSync(process.execPath, ["--disallow-code-generation-from-strings", "--conditions=source", "--import", import.meta.resolve("tsx"),
      fileURLToPath(new URL("./worker.ts", import.meta.url)), mode, generatedPath, String(iterations)],
    { encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    const result = decodeWorker(JSON.parse(child.stdout));
    assert.equal(result.mode, mode);
    const observed: unknown = deserialize(Buffer.from(result.observations, "base64"));
    if (reference === undefined) reference = observed;
    else assert.deepEqual(observed, reference, "Generated values and ordered diagnostics must match the interpreter");
    runs.push({ ...result, round });
  }
}
const median = (numbers: readonly number[]) => {
  const ordered = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1]! + ordered[middle]!) / 2 : ordered[middle]!;
};
const summary = suites.flatMap(suite => ["default", "strict"].flatMap(policy => ["valid", "invalid"].map(input => {
  const ns = (mode: string) => median(runs.filter(run => run.mode === mode).flatMap(run =>
    run.measurements.filter(row => row.name === suite.name && row.policy === policy && row.input === input).map(row => row.nsPerDecode)));
  const interpreterNs = ns("interpreter"), aotNs = ns("aot");
  return { schema: suite.name, policy, input, interpreterNs, aotNs, speedup: interpreterNs / aotNs };
})));
const require = createRequire(import.meta.url);
const { version } = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }))(require("effect/package.json"));
const effectCoreSha256 = createHash("sha256").update(readFileSync(resolve(dirname(require.resolve("effect/package.json")), "dist/internal/core.js"))).digest("hex");
await writeFile(resolve(out, "results.json"), JSON.stringify({ node: process.version, effect: version,
  effectCoreSha256, platform: process.platform, arch: process.arch, iterations, rounds, generatedBytes: Buffer.byteLength(generated),
  semanticsMatch: true, codeGenerationFromStrings: false, summary, runs }, null, 2));
console.table(summary);
console.log(`Matched decoded values and ordered diagnostics in every worker. Artifacts: ${out}`);
