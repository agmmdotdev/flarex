import { Cause, Exit, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { calibrateRootCounters, createRootCounterCollector, decodeRootCounterEvidence } from "./rootCounters";

const reading = (user: number, thread = true) => ({ process: { user, system: user / 2 },
  thread: thread ? { user: user / 2, system: 0 } : null, eventLoop: { idle: 0, active: 0, utilization: 0 } });

describe("minimal root counter boundary", () => {
  it("brackets asynchronous attempt cleanup and leaves evidence processing after settlement", async () => {
    const order: string[] = [];
    let clock = 0, cpu = 0;
    const collector = createRootCounterCollector({ now: () => clock++, read: () => {
      order.push("read"); return reading(cpu);
    } });
    const result = { value: "unchanged" };
    expect(await collector.capture(async () => {
      order.push("call"); cpu += 4;
      await Promise.resolve(); order.push("attemptCleanup"); cpu += 6;
      return result;
    })).toBe(result);
    cpu += 100; // Verification/report work cannot affect already read counters.
    const evidence = collector.evidence();
    expect(order).toEqual(["read", "call", "attemptCleanup", "read"]);
    expect(evidence).toMatchObject({ complete: true, counters: { process: { user: 10, system: 5 },
      thread: { user: 5, system: 0 }, window: { startMonotonicMs: 0, endMonotonicMs: 3 } },
      callWindow: { startMonotonicMs: 1, endMonotonicMs: 2 },
      resolution: { unit: "microseconds", processMicroseconds: null, threadMicroseconds: null, wallPrecisionMs: null } });
    expect(Result.isSuccess(decodeRootCounterEvidence(evidence))).toBe(true);
  });

  it.each(["before", "after"] as const)("a %s reader failure preserves the business result and attempts both reads", async side => {
    let calls = 0, clock = 0;
    const fault = new Error("private reader failure");
    const collector = createRootCounterCollector({ now: () => clock++, read: () => {
      if (++calls === (side === "before" ? 1 : 2)) throw fault;
      return reading(10);
    } });
    const result = { committed: true };
    expect(await collector.capture(async () => result)).toBe(result);
    expect(calls).toBe(2);
    expect(collector.evidence()).toMatchObject({ complete: false, counters: null });
    expect(collector.failures()[0]?.cause).toBe(fault);
  });

  it("preserves original rejected Cause/Exit including interruption when the after reader also fails", async () => {
    const original = Exit.failCause(Cause.fromReasons([Cause.makeFailReason("business"), Cause.makeInterruptReason(1)]));
    let calls = 0, clock = 0;
    const collector = createRootCounterCollector({ now: () => clock++, read: () => {
      if (++calls === 2) throw new Error("counter fault");
      return reading(0);
    } });
    await expect(collector.capture(async () => { throw original; })).rejects.toBe(original);
    expect(calls).toBe(2);
    expect(collector.evidence().complete).toBe(false);
  });

  it("retains unavailable thread CPU without invalidating process evidence", async () => {
    let clock = 0, calls = 0;
    const collector = createRootCounterCollector({ now: () => clock++, read: () => reading(calls++, false) });
    await collector.capture(async () => undefined);
    expect(collector.evidence()).toMatchObject({ complete: true, counters: { thread: null } });
  });

  it.each(["decreasing", "malformed", "threadChanges", "reversedClock"] as const)("invalidates %s readings after the actual call", async kind => {
    let clock = 0, calls = 0;
    const collector = createRootCounterCollector({ now: () => kind === "reversedClock" ? 100 - clock++ : clock++,
      read: () => {
        const current = calls++;
        return kind === "malformed" ? { process: { user: -1 } }
          : reading(kind === "decreasing" ? 100 - current : current, kind !== "threadChanges" || current === 0);
      } });
    expect(await collector.capture(async () => "completed")).toBe("completed");
    const evidence = collector.evidence();
    expect(evidence.complete).toBe(false);
    expect(Result.isSuccess(decodeRootCounterEvidence(evidence))).toBe(true);
    const schemaFaults = collector.failures().filter(entry => Schema.isSchemaError(entry.cause));
    if (kind === "decreasing" || kind === "malformed") {
      expect(schemaFaults).toHaveLength(kind === "malformed" ? 2 : 1);
      expect(schemaFaults.every(entry => entry.stage === "validation")).toBe(true);
      for (const entry of schemaFaults) {
        if (!Schema.isSchemaError(entry.cause)) throw new Error("Missing original SchemaError");
        expect(entry.cause.message).toContain("process");
        expect(entry.cause.message).toContain("user");
      }
    }
    if (kind === "threadChanges") expect(collector.failures()).toMatchObject([
      { stage: "validation", cause: { _tag: "RootCounterDiagnosticError", reason: "threadAvailabilityChanged" } },
    ]);
    const faults = collector.failures();
    expect(collector.evidence()).toBe(evidence);
    expect(collector.failures()).toEqual(faults);
  });

  it("retains a malformed adapter's precise validation fault beside its partner reader acquisition fault", async () => {
    const acquisition = new Error("before counter acquisition failed");
    let reads = 0, clock = 0;
    const malformed = { ...reading(1), process: { user: "invalid", system: 0 } };
    const collector = createRootCounterCollector({ now: () => clock++, read: () => {
      if (++reads === 1) throw acquisition;
      return malformed;
    } });
    expect(await collector.capture(async () => "committed")).toBe("committed");
    expect(reads).toBe(2);
    expect(collector.evidence()).toMatchObject({ complete: false, failures: ["beforeRead", "validation", "validation"] });
    expect(collector.failures()[0]?.cause).toBe(acquisition);
    const last = collector.failures()[2]?.cause;
    expect(Schema.isSchemaError(last)).toBe(true);
    if (!Schema.isSchemaError(last)) throw new Error("Missing malformed-reading SchemaError");
    expect(last.message).toContain("process");
    expect(last.message).toContain("user");
    expect(last.message).toContain("Expected number");
  });

  it("retains a decreasing delta's precise SchemaError beside a clock acquisition fault", async () => {
    const acquisition = new Error("clock acquisition failed");
    let clocks = 0, reads = 0;
    const collector = createRootCounterCollector({ now: () => {
      if (++clocks === 1) throw acquisition;
      return clocks;
    }, read: () => reading(10 - reads++) });
    const value = Exit.succeed("original outcome");
    expect(await collector.capture(async () => value)).toBe(value);
    expect(reads).toBe(2);
    expect(collector.evidence()).toMatchObject({ complete: false, failures: ["clock", "validation"] });
    expect(collector.failures()[0]?.cause).toBe(acquisition);
    const fault = collector.failures()[1]?.cause;
    if (!Schema.isSchemaError(fault)) throw new Error("Missing decreasing-delta SchemaError");
    expect(fault.message).toContain("process");
    expect(fault.message).toContain("user");
  });

  it("retains eight bounded back-to-back read calibrations without business execution", () => {
    let clock = 0, reads = 0;
    const calibration = calibrateRootCounters({ now: () => clock++, read: () => reading(reads++) });
    expect(reads).toBe(16);
    expect(calibration).toHaveLength(8);
    expect(calibration.every(sample => sample.complete)).toBe(true);
    expect(calibration[0]?.counters?.process.user).toBe(1);
  });

  it("rejects persisted complete claims with inconsistent delta, window or invented resolution", () => {
    let clock = 0, reads = 0;
    const valid = calibrateRootCounters({ now: () => clock++, read: () => reading(reads++) })[0];
    if (valid?.counters === null || valid === undefined) throw new Error("Missing valid counter evidence");
    expect(Result.isFailure(decodeRootCounterEvidence({ ...valid,
      counters: { ...valid.counters, process: { user: 999, system: 0 } } }))).toBe(true);
    expect(Result.isFailure(decodeRootCounterEvidence({ ...valid, callWindow: { startMonotonicMs: 0, endMonotonicMs: 1 } }))).toBe(true);
    expect(Result.isFailure(decodeRootCounterEvidence({ ...valid, resolution: { ...valid.resolution, processMicroseconds: 1 } }))).toBe(true);
  });
});
