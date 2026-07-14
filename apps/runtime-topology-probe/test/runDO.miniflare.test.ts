import { describe, expect, it } from "vitest";

import { copyCloudflareRpcRecord } from "../src/effectBoundary";
import {
  decodeProbeOrdinalEffect,
  decodeProbeRunIdEffect,
  newProbeClaimToken,
  probeRunActorId,
  probeSpanId,
} from "../src/identity";
import {
  decodeProbeRunRequestV1Effect,
  ProbeDurationMsSchema,
  PROBE_PROTOCOL_VERSION_V1,
  ProbeTraceSpanV1Schema,
  type ProbeRunRequestV1,
} from "../src/protocol";
import {
  decodeProbeRunRegistrationReceiptV1OrNull,
  decodeProbeRunStatusReceiptV1OrNull,
  decodeProbeSampleClaimReceiptV1OrNull,
  decodeProbeSampleFinalizeReceiptV1OrNull,
  ProbeRunStatusRequestV1Schema,
  ProbeSampleFinalizeRequestV1Schema,
  type ProbeSampleClaimReceiptV1,
} from "../src/runProtocol";
import {
  gatewaySampleFromRun,
  type ProbeGatewaySampleV1,
  type ProbeSyncWakeObservationV1,
} from "../src/runtimeProtocol";
import {
  createRuntimeProbeHarness,
  removeRuntimeProbePersistPath,
  type RuntimeProbeHarness,
} from "./runtimeHarness";
import { runEffectTestSync } from "./effectTest";

describe.sequential("P07A ProbeRunDO state machine", () => {
  it("registers one immutable cell idempotently and rejects conflicts", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const run = validRun("p07a_register", { payloadBytes: 1 });
      const created = await register(harness, run);
      const repeated = await register(harness, run);
      const conflict = await register(harness, {
        ...run,
        dimensions: { ...run.dimensions, payloadBytes: 2 },
      });

      expect(created).toMatchObject({ kind: "registered", created: true });
      expect(repeated).toMatchObject({ kind: "registered", created: false });
      expect(conflict).toMatchObject({
        kind: "rejected",
        error: { code: "registration-conflict", retryable: false },
      });
      if (created.kind !== "registered") throw new Error("run not created");
      expect(created.status.run).toEqual(run);
    } finally {
      await harness.dispose();
    }
  });

  it("atomically grants only one token for a raced sample ordinal", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const run = validRun("p07a_claim_race", {
        repetitions: 25,
        concurrency: 25,
      });
      await register(harness, run);
      const receipts = await Promise.all(
        Array.from({ length: 25 }, () => claim(harness, run, 0)),
      );
      const claimed = receipts.filter(receipt => receipt.kind === "claimed");
      const rejected = receipts.filter(receipt => receipt.kind === "rejected");
      const status = await readStatus(harness, run);

      expect(claimed).toHaveLength(1);
      expect(rejected).toHaveLength(24);
      expect(
        rejected.every(
          receipt =>
            receipt.kind === "rejected" &&
            receipt.error.code === "sample-already-claimed",
        ),
      ).toBe(true);
      expect(status.counters).toMatchObject({
        claimed: 1,
        outstanding: 1,
        highWaterOutstandingClaims: 1,
      });
    } finally {
      await harness.dispose();
    }
  });

  it("records maximum outstanding claim lifetimes separately from the target", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const run = validRun("p07a_observed", {
        repetitions: 4,
        concurrency: 3,
      });
      await register(harness, run);
      const first = await requiredClaim(harness, run, 0);
      await requiredClaim(harness, run, 1);
      await requiredClaim(harness, run, 2);
      const capped = await claim(harness, run, 3);
      expect(capped).toMatchObject({
        kind: "rejected",
        error: { code: "concurrency-limit", retryable: true },
      });
      const overlapping = await readStatus(harness, run);
      expect(
        overlapping.samples.map(sample => sample.observedOutstandingClaims),
      ).toEqual([3, 3, 3]);
      expect(overlapping.counters.highWaterOutstandingClaims).toBe(3);

      await finalize(harness, run, first, 0);
      const fourth = await requiredClaim(harness, run, 3);
      expect(fourth.observedOutstandingClaims).toBe(3);
      const after = await readStatus(harness, run);
      expect(after.counters).toMatchObject({
        claimed: 4,
        terminal: 1,
        outstanding: 3,
        highWaterOutstandingClaims: 3,
      });
      expect(after.run.dimensions.concurrency).toBe(3);
    } finally {
      await harness.dispose();
    }
  });

  it("accounts accepted payload, journal, and unique-code budgets atomically", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const run = validRun("p07a_aggregate_budgets", {
        scenario: "facet_journal",
        codeMode: "new-code",
        repetitions: 2,
        concurrency: 2,
        payloadBytes: 3,
        journalEntries: 2,
      });
      await register(harness, run);
      await requiredClaim(harness, run, 0);
      await requiredClaim(harness, run, 1);
      const excess = await claim(harness, run, 2);
      const status = await readStatus(harness, run);

      expect(excess).toMatchObject({
        kind: "rejected",
        error: { code: "sample-out-of-range", retryable: false },
      });
      expect(status.budgets).toMatchObject({
        planned: {
          sampleClaims: 2,
          payloadBytes: 6,
          journalEntries: 4,
          uniqueCodeIds: 2,
        },
        consumed: {
          sampleClaims: 2,
          payloadBytes: 6,
          journalEntries: 4,
          uniqueCodeIds: 2,
        },
      });
    } finally {
      await harness.dispose();
    }
  });

  it("fences finalization and makes only an identical retry idempotent", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const run = validRun("p07a_finalize");
      await register(harness, run);
      const claimed = await requiredClaim(harness, run, 0);
      const wrongToken = await finalize(
        harness,
        run,
        { ...claimed, claimToken: newProbeClaimToken() },
        0,
      );
      expect(wrongToken).toMatchObject({
        kind: "rejected",
        error: { code: "claim-token-mismatch", retryable: false },
      });

      const first = await finalize(harness, run, claimed, 0);
      const retry = await finalize(harness, run, claimed, 0);
      const rewrite = await finalize(harness, run, claimed, 0, 2);
      expect(first).toMatchObject({ kind: "finalized", idempotent: false });
      expect(retry).toMatchObject({ kind: "finalized", idempotent: true });
      expect(rewrite).toMatchObject({
        kind: "rejected",
        error: { code: "finalization-conflict", retryable: false },
      });
      const status = await readStatus(harness, run);
      expect(status.counters).toMatchObject({
        claimed: 1,
        terminal: 1,
        completed: 1,
        outstanding: 0,
      });
    } finally {
      await harness.dispose();
    }
  });

  it("rejects contradictory sync-wake evidence before durable finalization", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const run = validRun("p07a_wake_evidence", {
        scenario: "commit_wake",
      });
      await register(harness, run);
      const claimed = await requiredClaim(harness, run, 0);
      const sampleOrdinal = ordinal(0);
      const successful = gatewaySampleFromRun(run, sampleOrdinal, {
        edgeColo: null,
        outcome: { kind: "ok" },
        spans: [
          successfulSpan("mock_sync_wake_rtt", 1, 0),
          successfulSpan("sync_cursor_io", 2, 1),
        ],
      });
      const transportError = {
        code: "runtime_failure",
        retryable: true,
        stage: "mock_sync_wake_rtt",
      } as const;
      const failedBeforeReceipt = gatewaySampleFromRun(run, sampleOrdinal, {
        edgeColo: null,
        outcome: { kind: "error", error: transportError },
        spans: [
          ProbeTraceSpanV1Schema.make({
            spanId: probeSpanId(ordinal(1)),
            parentSpanId: probeSpanId(ordinal(0)),
            name: "mock_sync_wake_rtt",
            durationMs: ProbeDurationMsSchema.make(1),
            outcome: { kind: "error", error: transportError },
          }),
        ],
      });

      const successfulButUnobserved = await finalizeEvidence(
        harness,
        run,
        claimed,
        successful,
        { kind: "unobserved" },
      );
      const failedButDuplicate = await finalizeEvidence(
        harness,
        run,
        claimed,
        failedBeforeReceipt,
        { kind: "observed", disposition: "duplicate" },
      );
      const gapAtWrongStage = await finalizeEvidence(
        harness,
        run,
        claimed,
        failedBeforeReceipt,
        { kind: "observed", disposition: "gap" },
      );

      for (
        const receipt of [
          successfulButUnobserved,
          failedButDuplicate,
          gapAtWrongStage,
        ]
      ) {
        expect(receipt).toMatchObject({
          kind: "rejected",
          error: { code: "identity-mismatch", retryable: false },
        });
      }
      const accepted = await finalizeEvidence(
        harness,
        run,
        claimed,
        successful,
        { kind: "observed", disposition: "applied" },
      );
      expect(accepted).toMatchObject({ kind: "finalized", idempotent: false });
    } finally {
      await harness.dispose();
    }
  });

  it("keeps an abandoned claim visible across a runtime restart", async () => {
    const firstHarness = await createRuntimeProbeHarness({
      removePersistPathOnDispose: false,
    });
    const persistPath = firstHarness.persistPath;
    let firstDisposed = false;
    try {
      const run = validRun("p07a_restart");
      await register(firstHarness, run);
      const claimed = await requiredClaim(firstHarness, run, 0);
      await firstHarness.dispose();
      firstDisposed = true;

      const restarted = await createRuntimeProbeHarness({
        persistPath,
        removePersistPathOnDispose: false,
      });
      try {
        const status = await readStatus(restarted, run);
        expect(status.state).toBe("outstanding-claims");
        expect(status.samples).toEqual([
          expect.objectContaining({ state: "claimed", sampleOrdinal: 0 }),
        ]);
        const duplicate = await claim(restarted, run, 0);
        expect(duplicate).toMatchObject({
          kind: "rejected",
          error: { code: "sample-already-claimed", retryable: false },
        });
        const finalized = await finalize(restarted, run, claimed, 0);
        expect(finalized).toMatchObject({
          kind: "finalized",
          idempotent: false,
        });
      } finally {
        await restarted.dispose();
      }
    } finally {
      if (!firstDisposed) await firstHarness.dispose();
      await removeRuntimeProbePersistPath(persistPath);
    }
  });

  it("rejects a run routed to the wrong deterministic object", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const run = validRun("p07a_right_actor");
      const wrongId = runEffectTestSync(
        decodeProbeRunIdEffect("p07a_wrong_actor"),
      );
      const bindings = await harness.bindings();
      const raw = await bindings.PROBE_RUNS.getByName(probeRunActorId(wrongId))
        .register(run);
      const receipt = decodeProbeRunRegistrationReceiptV1OrNull(
        copyCloudflareRpcRecord(raw),
      );
      expect(receipt).toMatchObject({
        kind: "rejected",
        error: { code: "identity-mismatch", retryable: false },
      });
    } finally {
      await harness.dispose();
    }
  });
});

interface RunOverrides {
  readonly codeMode?: "new-code" | "stable";
  readonly repetitions?: number;
  readonly concurrency?: number;
  readonly journalEntries?: number;
  readonly payloadBytes?: number;
  readonly scenario?: ProbeRunRequestV1["scenario"];
  readonly warmupRepetitions?: number;
}

function validRun(
  runIdValue: string,
  overrides: RunOverrides = {},
): ProbeRunRequestV1 {
  return runEffectTestSync(
    decodeProbeRunRequestV1Effect({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      runId: runEffectTestSync(decodeProbeRunIdEffect(runIdValue)),
      scenario: overrides.scenario ?? "edge_echo",
      repetitions: overrides.repetitions ?? 1,
      warmupRepetitions: overrides.warmupRepetitions ?? 0,
      dimensions: {
        codeMode: overrides.codeMode ?? "stable",
        concurrency: overrides.concurrency ?? 1,
        journalEntries: overrides.journalEntries ?? 0,
        payloadBytes: overrides.payloadBytes ?? 0,
        sessionMode: "new-session",
      },
    }),
  );
}

async function register(harness: RuntimeProbeHarness, run: ProbeRunRequestV1) {
  const bindings = await harness.bindings();
  const raw = await bindings.PROBE_RUNS.getByName(probeRunActorId(run.runId))
    .register(run);
  const receipt = decodeProbeRunRegistrationReceiptV1OrNull(
    copyCloudflareRpcRecord(raw),
  );
  if (receipt === null) throw new Error("invalid registration receipt");
  return receipt;
}

async function claim(
  harness: RuntimeProbeHarness,
  run: ProbeRunRequestV1,
  ordinalValue: number,
): Promise<ProbeSampleClaimReceiptV1> {
  const bindings = await harness.bindings();
  const raw = await bindings.PROBE_RUNS.getByName(probeRunActorId(run.runId))
    .claim({
      protocolVersion: run.protocolVersion,
      runId: run.runId,
      sampleOrdinal: ordinal(ordinalValue),
    });
  const receipt = decodeProbeSampleClaimReceiptV1OrNull(
    copyCloudflareRpcRecord(raw),
  );
  if (receipt === null) throw new Error("invalid claim receipt");
  return receipt;
}

async function requiredClaim(
  harness: RuntimeProbeHarness,
  run: ProbeRunRequestV1,
  ordinalValue: number,
) {
  const receipt = await claim(harness, run, ordinalValue);
  if (receipt.kind !== "claimed") throw new Error(receipt.error.code);
  return receipt;
}

async function finalize(
  harness: RuntimeProbeHarness,
  run: ProbeRunRequestV1,
  claimReceipt: Extract<ProbeSampleClaimReceiptV1, { readonly kind: "claimed" }>,
  ordinalValue: number,
  durationMs = 1,
) {
  const sampleOrdinal = ordinal(ordinalValue);
  return await finalizeEvidence(
    harness,
    run,
    claimReceipt,
    gatewaySampleFromRun(run, sampleOrdinal, {
      edgeColo: null,
      outcome: { kind: "ok" },
      spans: [],
    }),
    { kind: "not-applicable" },
    durationMs,
  );
}

async function finalizeEvidence(
  harness: RuntimeProbeHarness,
  run: ProbeRunRequestV1,
  claimReceipt: Extract<ProbeSampleClaimReceiptV1, { readonly kind: "claimed" }>,
  fragment: ProbeGatewaySampleV1,
  syncWake: ProbeSyncWakeObservationV1,
  durationMs = 1,
) {
  const bindings = await harness.bindings();
  const request = ProbeSampleFinalizeRequestV1Schema.make({
    protocolVersion: run.protocolVersion,
    runId: run.runId,
    sampleOrdinal: claimReceipt.sampleOrdinal,
    claimToken: claimReceipt.claimToken,
    fragment,
    scenarioWindowDurationMs: ProbeDurationMsSchema.make(durationMs),
    syncWake,
  });
  const raw = await bindings.PROBE_RUNS.getByName(probeRunActorId(run.runId))
    .finalize(request);
  const receipt = decodeProbeSampleFinalizeReceiptV1OrNull(
    copyCloudflareRpcRecord(raw),
  );
  if (receipt === null) throw new Error("invalid finalization receipt");
  return receipt;
}

function successfulSpan(
  name: "mock_sync_wake_rtt" | "sync_cursor_io",
  spanOrdinal: number,
  parentOrdinal: number,
) {
  return ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(ordinal(spanOrdinal)),
    parentSpanId: probeSpanId(ordinal(parentOrdinal)),
    name,
    durationMs: ProbeDurationMsSchema.make(1),
    outcome: { kind: "ok" },
  });
}

async function readStatus(
  harness: RuntimeProbeHarness,
  run: ProbeRunRequestV1,
) {
  const bindings = await harness.bindings();
  const raw = await bindings.PROBE_RUNS.getByName(probeRunActorId(run.runId))
    .status(
      ProbeRunStatusRequestV1Schema.make({
        protocolVersion: run.protocolVersion,
        runId: run.runId,
      }),
    );
  const receipt = decodeProbeRunStatusReceiptV1OrNull(
    copyCloudflareRpcRecord(raw),
  );
  if (receipt === null || receipt.kind !== "found") {
    throw new Error("run status not found");
  }
  return receipt.status;
}

function ordinal(value: number) {
  return runEffectTestSync(decodeProbeOrdinalEffect(value));
}
