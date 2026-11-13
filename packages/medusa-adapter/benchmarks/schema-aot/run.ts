import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { deserialize } from "node:v8";
import { Schema } from "effect";
import * as SchemaAOTCompiler from "effect/schema/SchemaAOTCompiler";
import { suites } from "./cases";

const { values } = parseArgs({ options: { out: { type: "string" },
  iterations: { type: "string", default: "100000" }, rounds: { type: "string", default: "5" } } });
const iterations = Number(values.iterations), rounds = Number(values.rounds);
assert(Number.isSafeInteger(iterations) && iterations > 0 && iterations <= 10000000);
assert(Number.isSafeInteger(rounds) && rounds > 0 && rounds <= 20);
const out = values.out === undefined ? await mkdtemp(resolve(tmpdir(), "flarex-schema-aot-")) : resolve(values.out);
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
let ownerReference: unknown;
for (let round = 0; round < rounds; round++) {
  for (const mode of round % 2 === 0 ? ["interpreter", "aot"] : ["aot", "interpreter"]) {
    const workerArgs = ["--disallow-code-generation-from-strings", "--conditions=source",
      ...(mode === "interpreter" ? ["--import", new URL("../../../../scripts/schema-aot-interpreter.mjs", import.meta.url).href] : []),
      "--import", import.meta.resolve("tsx"),
      fileURLToPath(new URL("./worker.ts", import.meta.url)), mode, generatedPath, String(iterations)];
    const child = spawnSync(process.execPath, workerArgs,
    { encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    if (round === 0) {
      const activationArgs = workerArgs.slice();
      activationArgs.splice(-4, 4, fileURLToPath(new URL("./activation.mjs", import.meta.url)), mode);
      const activation = spawnSync(process.execPath, activationArgs, { encoding: "utf8", timeout: 120000, windowsHide: true });
      assert.ifError(activation.error);
      assert.equal(activation.status, 0, activation.stderr);
      const observedOwners: unknown = deserialize(Buffer.from(activation.stdout, "base64"));
      if (ownerReference === undefined) ownerReference = observedOwners;
      else assert.deepEqual(observedOwners, ownerReference, "Existing owner parsers must match");
    }
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
  semanticsMatch: true, ownerDecodersMatch: true, rawAccessorParity: true,
  codeGenerationFromStrings: false, summary, runs }, null, 2));
console.table(summary);
console.log(`Matched decoded values and ordered diagnostics in every worker. Artifacts: ${out}`);
