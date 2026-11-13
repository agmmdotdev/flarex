import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { serialize } from "node:v8";
import { pathToFileURL } from "node:url";
import { Result, Schema, SchemaIssue } from "effect";
import { suites } from "./cases";

const [mode, generatedPath, count] = process.argv.slice(2);
assert(mode === "interpreter" || mode === "aot");
assert(generatedPath !== undefined);
const iterations = Number(count);
assert(Number.isSafeInteger(iterations) && iterations > 0);
if (mode === "aot") {
  const generated = await import(pathToFileURL(generatedPath).href);
  generated.install(suites.map(suite => suite.schema.ast));
}

// Create fresh parsers after installation. Existing core module-level parser
// closures are intentionally outside this isolated experiment's activation.
const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();
const observations: unknown[] = [];
const measurements: { name: string; policy: string; input: string; iterations: number; nsPerDecode: number; cpuMs: number; successes: number }[] = [];
for (const suite of suites) {
  for (const policy of ["default", "strict"] as const) {
  const options = policy === "strict" ? { onExcessProperty: "error" as const } : {};
  for (const errors of ["first", "all"] as const) {
    const decode = Schema.decodeUnknownResult(suite.schema, { errors, ...options });
    for (const [expected, inputs] of [[true, suite.valid], [false, suite.invalid]] as const) {
      for (const input of inputs) {
        const parsed = decode(input);
        assert.equal(Result.isSuccess(parsed), expected, `${suite.name}: corpus expectation`);
        observations.push(Result.match(parsed, {
          onSuccess: value => ({ ok: true, value }),
          onFailure: error => ({ ok: false, message: error.message, ...formatIssue(error.issue) }),
        }));
      }
    }
    const first = suite.valid[0];
    assert(typeof first === "object" && first !== null);
    const excess = decode({ ...first, excessField: true });
    assert.equal(Result.isSuccess(excess), policy === "default", `${suite.name}: excess-key policy`);
    observations.push(Result.match(excess, {
      onSuccess: value => ({ ok: true, value }),
      onFailure: error => ({ ok: false, message: error.message, ...formatIssue(error.issue) }),
    }));
  }
  const decode = Schema.decodeUnknownResult(suite.schema, options);
  for (const [kind, inputs] of [["valid", suite.valid], ["invalid", suite.invalid]] as const) {
    const measuredCount = kind === "valid" ? iterations : Math.min(iterations, 10000);
    for (let i = 0; i < 5000; i++) decode(inputs[i % inputs.length]);
    let successes = 0;
    const beforeCpu = process.cpuUsage();
    const before = performance.now();
    for (let i = 0; i < measuredCount; i++) {
      if (Result.isSuccess(decode(inputs[i % inputs.length]))) successes++;
    }
    const elapsedMs = performance.now() - before;
    const cpu = process.cpuUsage(beforeCpu);
    assert.equal(successes, kind === "valid" ? measuredCount : 0);
    measurements.push({ name: suite.name, policy, input: kind, iterations: measuredCount,
      nsPerDecode: elapsedMs * 1e6 / measuredCount, cpuMs: (cpu.user + cpu.system) / 1000, successes });
  }
  }
}
process.stdout.write(JSON.stringify({ mode, observations: serialize(observations).toString("base64"), measurements }));
