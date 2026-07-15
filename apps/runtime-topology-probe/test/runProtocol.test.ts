import { describe, expect, it } from "vitest";

import {
  decodeProbeOrdinalEffect,
  decodeProbeRunIdEffect,
} from "../src/identity";
import {
  decodeProbeRunRequestV1Effect,
  PROBE_PROTOCOL_VERSION_V1,
  type ProbeRunRequestV1,
} from "../src/protocol";
import {
  decodeProbePublicSampleRequestV1Effect,
  probeRunEvidencePageReceiptMatchesRequestV1,
  probeRunBudgetPlanV1,
  PROBE_RUN_BUDGET_LIMITS_V1,
  ProbeRunEvidencePageReceiptV1Schema,
  ProbeRunEvidencePageRequestV1Schema,
  ProbeRunSampleStatusV1Schema,
  ProbeRunStatusV1Schema,
} from "../src/runProtocol";
import { runEffectTest, runEffectTestSync } from "./effectTest";

describe("P07A run-control protocol", () => {
  it("accepts only the compact public sample command", async () => {
    const run = validRun("p07a_compact");
    const command = await runEffectTest(
      decodeProbePublicSampleRequestV1Effect({
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        runId: run.runId,
        sampleOrdinal: ordinal(0),
      }),
    );

    expect(command).toEqual({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      runId: run.runId,
      sampleOrdinal: 0,
    });
    await expect(
      runEffectTest(
        decodeProbePublicSampleRequestV1Effect({
          ...command,
          run,
          phase: "measurement",
          payload: "caller-controlled",
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("derives bounded aggregate plans from one immutable run cell", () => {
    const run = validRun("p07a_budgets", {
      repetitions: 2,
      warmupRepetitions: 1,
      payloadBytes: 3,
      journalEntries: 2,
      scenario: "facet_journal",
    });

    expect(probeRunBudgetPlanV1(run)).toEqual({
      sampleClaims: 3,
      payloadBytes: 9,
      journalEntries: 6,
      uniqueCodeIds: 1,
    });
    expect(PROBE_RUN_BUDGET_LIMITS_V1).toMatchObject({
      sampleClaims: 600,
      uniqueCodeIds: 16,
    });
  });

  it("rejects impossible concurrency and reordered synthetic-sync cells", async () => {
    await expect(
      runEffectTest(
        decodeProbeRunRequestV1Effect({
          ...validRun("p07a_concurrency"),
          repetitions: 1,
          dimensions: {
            ...validRun("p07a_concurrency").dimensions,
            concurrency: 2,
          },
        }),
      ),
    ).rejects.toBeDefined();
    await expect(
      runEffectTest(
        decodeProbeRunRequestV1Effect({
          ...validRun("p07a_wake_order"),
          scenario: "commit_wake",
          repetitions: 2,
          dimensions: {
            ...validRun("p07a_wake_order").dimensions,
            concurrency: 2,
          },
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("binds evidence pages to one exact bounded request window", () => {
    const run = validRun("p07b_evidence_page", { repetitions: 2 });
    const request = ProbeRunEvidencePageRequestV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      runId: run.runId,
      cursor: ordinal(0),
      limit: 1,
    });
    const valid = ProbeRunEvidencePageReceiptV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      kind: "page",
      runId: run.runId,
      records: [{
        kind: "not-started",
        runId: run.runId,
        sampleOrdinal: ordinal(0),
        phase: "measurement",
      }],
      nextCursor: ordinal(1),
    });
    if (valid.kind !== "page") throw new Error("page fixture is rejected");

    expect(probeRunEvidencePageReceiptMatchesRequestV1(valid, request, run))
      .toBe(true);
    const stalled = ProbeRunEvidencePageReceiptV1Schema.make({
      ...valid,
      nextCursor: ordinal(0),
    });
    const overlapping = ProbeRunEvidencePageReceiptV1Schema.make({
      ...valid,
      records: [{
        kind: "not-started",
        runId: run.runId,
        sampleOrdinal: ordinal(1),
        phase: "measurement",
      }],
    });
    const wrongRun = ProbeRunEvidencePageReceiptV1Schema.make({
      ...valid,
      runId: validRun("p07b_evidence_wrong_run").runId,
    });
    if (
      stalled.kind !== "page" ||
      overlapping.kind !== "page" ||
      wrongRun.kind !== "page"
    ) {
      throw new Error("invalid page fixture kind");
    }
    expect(probeRunEvidencePageReceiptMatchesRequestV1(stalled, request, run))
      .toBe(false);
    expect(probeRunEvidencePageReceiptMatchesRequestV1(
      overlapping,
      request,
      run,
    )).toBe(false);
    expect(probeRunEvidencePageReceiptMatchesRequestV1(wrongRun, request, run))
      .toBe(false);
  });

  it("rejects status receipts whose sample rows contradict durable aggregates", () => {
    const run = validRun("p07a_status_relations", {
      repetitions: 2,
      concurrency: 2,
    });
    const first = ProbeRunSampleStatusV1Schema.make({
      sampleOrdinal: ordinal(0),
      phase: "measurement",
      state: "claimed",
      observedOutstandingClaims: 2,
      measurementDisposition: null,
      syncWake: null,
    });
    const second = ProbeRunSampleStatusV1Schema.make({
      sampleOrdinal: ordinal(1),
      phase: "measurement",
      state: "claimed",
      observedOutstandingClaims: 2,
      measurementDisposition: null,
      syncWake: null,
    });
    const status = ProbeRunStatusV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      run,
      state: "outstanding-claims",
      sealed: false,
      reconciled: false,
      evidenceFrozen: false,
      budgets: {
        limits: PROBE_RUN_BUDGET_LIMITS_V1,
        planned: probeRunBudgetPlanV1(run),
        consumed: {
          sampleClaims: 2,
          payloadBytes: 0,
          journalEntries: 0,
          uniqueCodeIds: 0,
        },
      },
      counters: {
        claimed: 2,
        terminal: 0,
        completed: 0,
        failed: 0,
        abandoned: 0,
        outstanding: 2,
        highWaterOutstandingClaims: 2,
        eligible: 0,
        excludedWarmup: 0,
        excludedDuplicateWake: 0,
      },
      samples: [first, second],
    });
    const completedFirst = ProbeRunSampleStatusV1Schema.make({
      sampleOrdinal: ordinal(0),
      phase: "measurement",
      state: "completed",
      observedOutstandingClaims: 2,
      measurementDisposition: "eligible",
      syncWake: { kind: "not-applicable" },
    });
    const completedSecond = ProbeRunSampleStatusV1Schema.make({
      ...completedFirst,
      sampleOrdinal: ordinal(1),
    });
    const duplicateSecond = ProbeRunSampleStatusV1Schema.make({
      ...second,
      sampleOrdinal: ordinal(0),
    });
    const wrongPhaseSecond = ProbeRunSampleStatusV1Schema.make({
      ...second,
      phase: "warmup",
    });

    expect(() =>
      ProbeRunStatusV1Schema.make({
        ...status,
        samples: [completedFirst, second],
      })
    ).toThrow();
    expect(() =>
      ProbeRunStatusV1Schema.make({
        ...status,
        samples: [first, duplicateSecond],
      })
    ).toThrow();
    expect(() =>
      ProbeRunStatusV1Schema.make({
        ...status,
        samples: [first, wrongPhaseSecond],
      })
    ).toThrow();

    const completeStatus = ProbeRunStatusV1Schema.make({
      ...status,
      state: "complete",
      counters: {
        claimed: 2,
        terminal: 2,
        completed: 2,
        failed: 0,
        abandoned: 0,
        outstanding: 0,
        highWaterOutstandingClaims: 2,
        eligible: 2,
        excludedWarmup: 0,
        excludedDuplicateWake: 0,
      },
      samples: [completedFirst, completedSecond],
    });
    const impossibleEdgeWake = ProbeRunSampleStatusV1Schema.make({
      sampleOrdinal: ordinal(0),
      phase: "measurement",
      state: "completed",
      observedOutstandingClaims: 2,
      measurementDisposition: "excluded-duplicate-wake",
      syncWake: { kind: "observed", disposition: "duplicate" },
    });
    expect(() =>
      ProbeRunStatusV1Schema.make({
        ...completeStatus,
        counters: {
          ...completeStatus.counters,
          eligible: 1,
          excludedDuplicateWake: 1,
        },
        samples: [impossibleEdgeWake, completedSecond],
      })
    ).toThrow();

    const warmupRun = validRun("p07a_status_warmup", {
      repetitions: 1,
      warmupRepetitions: 1,
    });
    const warmupSample = ProbeRunSampleStatusV1Schema.make({
      sampleOrdinal: ordinal(0),
      phase: "warmup",
      state: "completed",
      observedOutstandingClaims: 1,
      measurementDisposition: "excluded-warmup",
      syncWake: { kind: "not-applicable" },
    });
    const warmupStatus = ProbeRunStatusV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      run: warmupRun,
      state: "partial",
      sealed: false,
      reconciled: false,
      evidenceFrozen: false,
      budgets: {
        limits: PROBE_RUN_BUDGET_LIMITS_V1,
        planned: probeRunBudgetPlanV1(warmupRun),
        consumed: {
          sampleClaims: 1,
          payloadBytes: 0,
          journalEntries: 0,
          uniqueCodeIds: 0,
        },
      },
      counters: {
        claimed: 1,
        terminal: 1,
        completed: 1,
        failed: 0,
        abandoned: 0,
        outstanding: 0,
        highWaterOutstandingClaims: 1,
        eligible: 0,
        excludedWarmup: 1,
        excludedDuplicateWake: 0,
      },
      samples: [warmupSample],
    });
    expect(() =>
      ProbeRunStatusV1Schema.make({
        ...warmupStatus,
        counters: {
          ...warmupStatus.counters,
          eligible: 1,
          excludedWarmup: 0,
        },
        samples: [
          ProbeRunSampleStatusV1Schema.make({
            sampleOrdinal: ordinal(0),
            phase: "warmup",
            state: "completed",
            observedOutstandingClaims: 1,
            measurementDisposition: "eligible",
            syncWake: { kind: "not-applicable" },
          }),
        ],
      })
    ).toThrow();

    const wakeRun = validRun("p07a_status_wake_state", {
      scenario: "commit_wake",
    });
    const wakeStatusBase = {
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      run: wakeRun,
      state: "complete" as const,
      sealed: false,
      reconciled: false,
      evidenceFrozen: false,
      budgets: {
        limits: PROBE_RUN_BUDGET_LIMITS_V1,
        planned: probeRunBudgetPlanV1(wakeRun),
        consumed: {
          sampleClaims: 1,
          payloadBytes: 0,
          journalEntries: 0,
          uniqueCodeIds: 0,
        },
      },
      counters: {
        claimed: 1,
        terminal: 1,
        completed: 1,
        failed: 0,
        abandoned: 0,
        outstanding: 0,
        highWaterOutstandingClaims: 1,
        eligible: 1,
        excludedWarmup: 0,
        excludedDuplicateWake: 0,
      },
    };
    const completedUnobserved = ProbeRunSampleStatusV1Schema.make({
      sampleOrdinal: ordinal(0),
      phase: "measurement",
      state: "completed",
      observedOutstandingClaims: 1,
      measurementDisposition: "eligible",
      syncWake: { kind: "unobserved" },
    });
    const failedApplied = ProbeRunSampleStatusV1Schema.make({
      sampleOrdinal: ordinal(0),
      phase: "measurement",
      state: "failed",
      observedOutstandingClaims: 1,
      measurementDisposition: "eligible",
      syncWake: { kind: "observed", disposition: "applied" },
    });
    expect(() =>
      ProbeRunStatusV1Schema.make({
        ...wakeStatusBase,
        samples: [completedUnobserved],
      })
    ).toThrow();
    expect(() =>
      ProbeRunStatusV1Schema.make({
        ...wakeStatusBase,
        counters: {
          ...wakeStatusBase.counters,
          completed: 0,
          failed: 1,
        },
        samples: [failedApplied],
      })
    ).toThrow();
  });
});

interface RunOverrides {
  readonly concurrency?: number;
  readonly repetitions?: number;
  readonly warmupRepetitions?: number;
  readonly payloadBytes?: number;
  readonly journalEntries?: number;
  readonly scenario?: ProbeRunRequestV1["scenario"];
}

function validRun(
  runIdValue: string,
  overrides: RunOverrides = {},
): ProbeRunRequestV1 {
  const scenario = overrides.scenario ?? "edge_echo";
  return runEffectTestSync(
    decodeProbeRunRequestV1Effect({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      runId: runEffectTestSync(decodeProbeRunIdEffect(runIdValue)),
      scenario,
      repetitions: overrides.repetitions ?? 1,
      warmupRepetitions: overrides.warmupRepetitions ?? 0,
      dimensions: {
        codeMode: "stable",
        concurrency: overrides.concurrency ?? 1,
        journalEntries: overrides.journalEntries ?? 0,
        payloadBytes: overrides.payloadBytes ?? 0,
        sessionMode: "new-session",
      },
    }),
  );
}

function ordinal(value: number) {
  return runEffectTestSync(decodeProbeOrdinalEffect(value));
}
