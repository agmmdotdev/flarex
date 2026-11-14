import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

// Diagnostic kernels, not replacement validators or application implementations.
// Projection consumes controlled, trusted fixture data. It would have to follow
// the authoritative decoder/capture boundary in application code.
interface Row { price: number; quantity: number }
class OwnedRow {
  constructor(readonly price: number, readonly quantity: number) {}
}
const count = Number(process.argv[2] ?? "2000000");
assert(Number.isSafeInteger(count) && count > 0 && count <= 100000000);
const fixture = JSON.stringify(Array.from({ length: 1024 }, (_, i) => ({ price: i + 1, quantity: i % 7 + 1 })));
const parsed: Row[] = JSON.parse(fixture);
const projected = parsed.map(row => new OwnedRow(row.price, row.quantity));
const plain = parsed.map(row => ({ price: row.price, quantity: row.quantity }));
function sumParsed(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) { const row = parsed[i & 1023]!; sum += row.price * row.quantity; }
  return sum;
}
function sumOwned(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) { const row = projected[i & 1023]!; sum += row.price * row.quantity; }
  return sum;
}
function sumPlain(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) { const row = plain[i & 1023]!; sum += row.price * row.quantity; }
  return sum;
}
function projectAndSum(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i += 1024) {
    const rows = parsed.map(row => new OwnedRow(row.price, row.quantity));
    for (let j = 0; j < Math.min(1024, iterations - i); j++) { const row = rows[j]!; sum += row.price * row.quantity; }
  }
  return sum;
}
function staticCalculation(price: number, quantity: number): number { return price * quantity + 1; }
// Intentional positive control: AOT cannot precompile code created at run time.
// A constant string can itself be compiled by Bun. The process-specific comment
// makes this body unavailable at build time without changing its calculation.
const dynamicCalculation = new Function("price", "quantity", `return price * quantity + 1; // ${process.pid}`);
function callStatic(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += staticCalculation(i & 1023, i % 7 + 1);
  return sum;
}
function callDynamic(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += dynamicCalculation(i & 1023, i % 7 + 1);
  return sum;
}
const measurements: { name: string; iterations: number; wallMs: number; cpuMs: number; checksum: number }[] = [];
for (const [name, run] of [["json-properties", sumParsed], ["owned-class-properties", sumOwned],
  ["owned-plain-properties", sumPlain], ["projection-plus-one-pass", projectAndSum],
  ["static-function", callStatic], ["runtime-generated-function", callDynamic]] as const) {
  for (let i = 0; i < 5; i++) run(10000);
  const beforeCpu = process.cpuUsage();
  const before = performance.now();
  const checksum = run(count);
  const wallMs = performance.now() - before;
  const cpu = process.cpuUsage(beforeCpu);
  measurements.push({ name, iterations: count, wallMs, cpuMs: (cpu.user + cpu.system) / 1000, checksum });
}
assert.equal(measurements[0]!.checksum, measurements[1]!.checksum);
assert.equal(measurements[0]!.checksum, measurements[2]!.checksum);
assert.equal(measurements[0]!.checksum, measurements[3]!.checksum);
assert.equal(measurements[4]!.checksum, measurements[5]!.checksum);
process.stdout.write(JSON.stringify({ runtime: process.versions, measurements }));
