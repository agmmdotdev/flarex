import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Result, Schema, SchemaIssue } from "effect";
import { suites } from "../schema-aot/cases";

// Installers are selected at build time. Every runtime consumes the same module
// graph for that selection; no generated module is imported from disk at run time.
const iterations = Number(process.argv[2] ?? "250000");
assert(Number.isSafeInteger(iterations) && iterations > 0 && iterations <= 10000000);
const observations: unknown[] = [];
const measurements: { name: string; iterations: number; wallMs: number; cpuMs: number; checksum: number }[] = [];
const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();
for (const suite of suites) {
  for (const policy of ["default", "strict"] as const) {
    const options = policy === "strict" ? { onExcessProperty: "error" as const } : {};
    for (const errors of ["first", "all"] as const) {
      const decode = Schema.decodeUnknownResult(suite.schema, { ...options, errors });
      const observe = (input: unknown, expected: boolean) => {
        const parsed = decode(input);
        assert.equal(Result.isSuccess(parsed), expected, suite.name);
        observations.push(Result.match(parsed, {
          onSuccess: value => ({ ok: true, value }),
          onFailure: error => ({ ok: false, message: error.message, ...formatIssue(error.issue) }),
        }));
      };
      for (const input of suite.valid) observe(input, true);
      for (const input of suite.invalid) observe(input, false);
      const first = suite.valid[0];
      assert(typeof first === "object" && first !== null);
      observe({ ...first, excessField: true }, policy === "default");
    }
    const decode = Schema.decodeUnknownResult(suite.schema, options);
    for (const [kind, inputs] of [["valid", suite.valid], ["invalid", suite.invalid]] as const) {
      const count = kind === "valid" ? iterations : Math.min(iterations, 10000);
      for (let i = 0; i < 5000; i++) decode(inputs[i % inputs.length]);
      let checksum = 0;
      const beforeCpu = process.cpuUsage();
      const before = performance.now();
      for (let i = 0; i < count; i++) if (Result.isSuccess(decode(inputs[i % inputs.length]))) checksum++;
      const wallMs = performance.now() - before;
      const cpu = process.cpuUsage(beforeCpu);
      assert.equal(checksum, kind === "valid" ? count : 0);
      measurements.push({ name: `${suite.name}/${policy}/${kind}`, iterations: count,
        wallMs, cpuMs: (cpu.user + cpu.system) / 1000, checksum });
    }
  }
}
// Tagged values preserve BigInt, undefined and non-finite numbers across engines.
const parity = JSON.stringify(observations, (_, value: unknown) =>
  value === undefined ? { $undefined: true } : typeof value === "bigint" ? { $bigint: String(value) }
    : typeof value === "number" && !Number.isFinite(value) ? { $number: String(value) } : value);
process.stdout.write(JSON.stringify({ runtime: process.versions, parity, measurements }));
