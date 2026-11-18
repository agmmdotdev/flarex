import assert from "node:assert/strict";
import { it } from "vitest";
import { captureCpuProfile } from "../../../packages/executor/test/performance/measurement/cpu.ts";
import { createCpuMeasurementCollector } from "../../../packages/executor/test/performance/measurement/collectors/cpu.ts";
import { Result } from "effect";
import { captureCostDiagnostics, serverDurations } from "./measurement-costs.mjs";

it("retains every server protocol duration without query text and refuses malformed timing", () => {
  const result = serverDurations("fx_duration|80|1|LOG:  duration: 0.100 ms\r\n" +
    "fx_duration|80|2|LOG:  duration: 0.200 ms\nfx_duration|80|3|LOG:  duration: 0.300 ms\n" +
    "fx_duration|81|1|LOG:  duration: 1.000 ms\nfx_duration|82|1|LOG:  checkpoint complete\n");
  assert.deepEqual(result.entries.map(entry => entry.backendPid), [80, 80, 80, 81]); assert.equal(result.totalMs, 1.6);
  for (const malformed of ["missing", "0..1"]) assert.throws(() => serverDurations(`fx_duration|80|4|LOG:  duration: ${malformed} ms`), /protocol/);
});

it("reuses full inspector frame identities for same-line columns and generated scripts", () => {
  const callFrame = { functionName: "", scriptId: "1", url: "", lineNumber: 3, columnNumber: 1 };
  const nodes = [{ id: 1, callFrame, children: [2, 3] },
    { id: 2, callFrame: { ...callFrame, columnNumber: 2 }, children: [] },
    { id: 3, callFrame: { ...callFrame, scriptId: "2" }, children: [] }];
  const profile = Result.getOrThrow(captureCpuProfile({ nodes, startTime: 0, endTime: 100, samples: [2, 3], timeDeltas: [50, 50] }));
  assert.equal(profile.nodes[1].callFrame.columnNumber, 2); assert.equal(profile.nodes[2].callFrame.scriptId, "2");
});

it("retains failed diagnostic inputs and captures server evidence independently of CPU failure", async () => {
  const target = {}; const initiating = new Error("malformed bounded CPU evidence");
  const log = "fx_duration|80|4|LOG:  duration: malformed ms";
  const collector = { failures: () => [{ stage: "cpuDecode", cause: initiating }], evidence: () => { throw initiating; } };
  const failures = await captureCostDiagnostics(target, collector, async () => log);
  assert.equal(failures.length, 3); assert.equal(failures[0], initiating);
  assert.equal(target.profile.failures[0].evidence.message, initiating.message); assert.equal(target.serverDurationLog, log);
});

it("captures a real complete bounded CPU profile through the reused owner", async () => {
  const collector = createCpuMeasurementCollector({ allocations: false });
  await collector.capture(async () => {
    let checksum = 0; const until = performance.now() + 15;
    while (performance.now() < until) for (let index = 0; index < 100; index++) checksum += Math.sqrt(index);
    assert.ok(checksum > 0);
  });
  const target = {}; const failures = await captureCostDiagnostics(target, collector, async () => "fx_duration|80|1|LOG:  duration: 0.100 ms\n");
  assert.deepEqual(failures, []); assert.ok(target.profile.summary.definitelyInsideSamples > 0);
  assert.equal(target.profile.evidence.cpuIntervalMicroseconds, 1000);
  const initiating = new Error("CPU-stop-witness");
  const incomplete = { evidence: () => ({ ...collector.evidence(), complete: false, failures: ["cpuStop"] }),
    failures: () => [{ stage: "cpuStop", cause: initiating }] };
  const rejected = {};
  const faults = await captureCostDiagnostics(rejected, incomplete, async () => "fx_duration|80|1|LOG:  duration: 0.100 ms\n");
  assert.ok(faults.includes(initiating), "Collector's initiating error survives alongside the incomplete-capture refusal");
  const saved = JSON.parse(JSON.stringify(rejected));
  assert.equal(saved.profile.failures[0].evidence.message, "CPU-stop-witness");
  assert.equal(saved.server.entries.length, 1);
});
