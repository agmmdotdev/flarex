import { describe, expect, it } from "vitest";

import {
  probeRegisteredRunReceiptMatchesRequest,
  probeRunStatusReceiptMatchesRequest,
  probeRuntimeFailureRetryable,
  probeSampleClaimReceiptMatchesRequest,
  probeSampleFinalizeReceiptMatchesRequest,
} from "../src/gateway";
import {
  decodeProbeOrdinalEffect,
  decodeProbeRunIdEffect,
  newProbeClaimToken,
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
  probeRunBudgetPlanV1,
  PROBE_RUN_BUDGET_LIMITS_V1,
  ProbePublicSampleRequestV1Schema,
  ProbeRunRegistrationReceiptV1Schema,
  ProbeRunStatusReceiptV1Schema,
  ProbeRunStatusRequestV1Schema,
  ProbeRunStatusV1Schema,
  ProbeSampleClaimReceiptV1Schema,
  ProbeSampleFinalizeRequestV1Schema,
  ProbeSampleFinalizeReceiptV1Schema,
} from "../src/runProtocol";
import {
  controlledProbeGatewaySampleV1,
  gatewaySampleFromRun,
  ProbeSampleControlV1Schema,
} from "../src/runtimeProtocol";
import { runEffectTestSync } from "./effectTest";

describe("runtime hop failure classification", () => {
  it("retries transport failures and selected server responses only", () => {
    expect(probeRuntimeFailureRetryable({ kind: "transport" })).toBe(true);
    expect(
      probeRuntimeFailureRetryable({ kind: "response-status", status: 500 }),
    ).toBe(true);
    expect(
      probeRuntimeFailureRetryable({ kind: "response-status", status: 503 }),
    ).toBe(true);
  });

  it("does not retry contract, identity, or client response failures", () => {
    expect(probeRuntimeFailureRetryable({ kind: "invalid-receipt" })).toBe(false);
    expect(
      probeRuntimeFailureRetryable({ kind: "response-status", status: 400 }),
    ).toBe(false);
    expect(
      probeRuntimeFailureRetryable({ kind: "response-status", status: 409 }),
    ).toBe(false);
  });

  it("rejects observed concurrency above the registered control limit", () => {
    expect(() =>
      ProbeSampleControlV1Schema.make({
        phase: "measurement",
        terminalState: "completed",
        measurementDisposition: "eligible",
        configuredConcurrency: 1,
        observedOutstandingClaims: 2,
        scenarioWindowDurationMs: ProbeDurationMsSchema.make(1),
        syncWake: { kind: "not-applicable" },
        externalRequestIncludesControlPlane: true,
      })
    ).toThrow();
  });

  it("correlates every successful RunDO receipt before trusting it", () => {
    const run = validRun("p07a_receipt_correlation", { concurrency: 3 });
    const otherRun = validRun("p07a_other_receipt");
    const status = registeredStatus(run);
    const registration = ProbeRunRegistrationReceiptV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      kind: "registered",
      created: true,
      status,
    });
    const found = ProbeRunStatusReceiptV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      kind: "found",
      status,
    });
    const sampleOrdinal = ordinal(0);
    const command = ProbePublicSampleRequestV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      runId: run.runId,
      sampleOrdinal,
    });
    const otherCommand = ProbePublicSampleRequestV1Schema.make({
      ...command,
      runId: otherRun.runId,
    });
    const claim = ProbeSampleClaimReceiptV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      kind: "claimed",
      claimToken: newProbeClaimToken(),
      run,
      sampleOrdinal,
      phase: "measurement",
      observedOutstandingClaims: 1,
    });
    if (claim.kind !== "claimed") throw new Error("claim fixture rejected");
    const fragment = gatewaySampleFromRun(run, sampleOrdinal, {
      edgeColo: null,
      outcome: { kind: "ok" },
      spans: [],
    });
    const finalization = ProbeSampleFinalizeReceiptV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      kind: "finalized",
      idempotent: false,
      sample: controlledProbeGatewaySampleV1(
        fragment,
        ProbeSampleControlV1Schema.make({
          phase: "measurement",
          terminalState: "completed",
          measurementDisposition: "eligible",
          configuredConcurrency: 3,
          observedOutstandingClaims: 3,
          scenarioWindowDurationMs: ProbeDurationMsSchema.make(1),
          syncWake: { kind: "not-applicable" },
          externalRequestIncludesControlPlane: true,
        }),
      ),
    });
    const finalizeRequest = ProbeSampleFinalizeRequestV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      runId: run.runId,
      sampleOrdinal,
      claimToken: claim.claimToken,
      fragment,
      scenarioWindowDurationMs: ProbeDurationMsSchema.make(1),
      syncWake: { kind: "not-applicable" },
    });
    if (registration.kind !== "registered") {
      throw new Error("registration fixture rejected");
    }
    if (found.kind !== "found") throw new Error("status fixture rejected");
    if (finalization.kind !== "finalized") {
      throw new Error("finalization fixture rejected");
    }

    expect(probeRegisteredRunReceiptMatchesRequest(registration, run)).toBe(
      true,
    );
    expect(
      probeRegisteredRunReceiptMatchesRequest(registration, otherRun),
    ).toBe(false);
    expect(
      probeRunStatusReceiptMatchesRequest(
        found,
        ProbeRunStatusRequestV1Schema.make({
          protocolVersion: command.protocolVersion,
          runId: command.runId,
        }),
      ),
    ).toBe(true);
    expect(
      probeRunStatusReceiptMatchesRequest(
        found,
        ProbeRunStatusRequestV1Schema.make({
          protocolVersion: otherCommand.protocolVersion,
          runId: otherCommand.runId,
        }),
      ),
    ).toBe(false);
    expect(probeSampleClaimReceiptMatchesRequest(claim, command)).toBe(true);
    expect(probeSampleClaimReceiptMatchesRequest(claim, otherCommand)).toBe(
      false,
    );
    const aboveCapClaim = ProbeSampleClaimReceiptV1Schema.make({
      ...claim,
      observedOutstandingClaims: 4,
    });
    const wrongPhaseClaim = ProbeSampleClaimReceiptV1Schema.make({
      ...claim,
      phase: "warmup",
    });
    if (aboveCapClaim.kind !== "claimed" || wrongPhaseClaim.kind !== "claimed") {
      throw new Error("invalid claim correlation fixture");
    }
    expect(
      probeSampleClaimReceiptMatchesRequest(aboveCapClaim, command),
    ).toBe(false);
    expect(
      probeSampleClaimReceiptMatchesRequest(wrongPhaseClaim, command),
    ).toBe(false);
    expect(
      probeSampleFinalizeReceiptMatchesRequest(
        finalization,
        finalizeRequest,
        claim,
      ),
    ).toBe(true);
    expect(
      probeSampleFinalizeReceiptMatchesRequest(
        finalization,
        ProbeSampleFinalizeRequestV1Schema.make({
          ...finalizeRequest,
          runId: otherRun.runId,
        }),
        claim,
      ),
    ).toBe(false);
    const requestError = {
      code: "runtime_failure",
      retryable: false,
      stage: "request",
    } as const;
    expect(
      probeSampleFinalizeReceiptMatchesRequest(
        finalization,
        ProbeSampleFinalizeRequestV1Schema.make({
          ...finalizeRequest,
          fragment: gatewaySampleFromRun(run, sampleOrdinal, {
            edgeColo: null,
            outcome: { kind: "error", error: requestError },
            spans: [],
          }),
        }),
        claim,
      ),
    ).toBe(false);
    expect(
      probeSampleFinalizeReceiptMatchesRequest(
        finalization,
        ProbeSampleFinalizeRequestV1Schema.make({
          ...finalizeRequest,
          scenarioWindowDurationMs: ProbeDurationMsSchema.make(2),
        }),
        claim,
      ),
    ).toBe(false);
    expect(
      probeSampleFinalizeReceiptMatchesRequest(
        finalization,
        ProbeSampleFinalizeRequestV1Schema.make({
          ...finalizeRequest,
          syncWake: { kind: "observed", disposition: "applied" },
        }),
        claim,
      ),
    ).toBe(false);
  });

  it("rejects finalization receipts whose measured spans drift", () => {
    const run = validRun("p07a_span_correlation", {
      scenario: "session_echo",
    });
    const sampleOrdinal = ordinal(0);
    const claim = ProbeSampleClaimReceiptV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      kind: "claimed",
      claimToken: newProbeClaimToken(),
      run,
      sampleOrdinal,
      phase: "measurement",
      observedOutstandingClaims: 1,
    });
    if (claim.kind !== "claimed") throw new Error("claim fixture rejected");
    const fragment = gatewaySampleFromRun(run, sampleOrdinal, {
      edgeColo: null,
      outcome: { kind: "ok" },
      spans: [sessionSpan(1)],
    });
    const request = ProbeSampleFinalizeRequestV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      runId: run.runId,
      sampleOrdinal,
      claimToken: claim.claimToken,
      fragment,
      scenarioWindowDurationMs: ProbeDurationMsSchema.make(1),
      syncWake: { kind: "not-applicable" },
    });
    const receipt = ProbeSampleFinalizeReceiptV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      kind: "finalized",
      idempotent: false,
      sample: controlledProbeGatewaySampleV1(
        fragment,
        ProbeSampleControlV1Schema.make({
          phase: "measurement",
          terminalState: "completed",
          measurementDisposition: "eligible",
          configuredConcurrency: 1,
          observedOutstandingClaims: 1,
          scenarioWindowDurationMs: ProbeDurationMsSchema.make(1),
          syncWake: { kind: "not-applicable" },
          externalRequestIncludesControlPlane: true,
        }),
      ),
    });
    if (receipt.kind !== "finalized") {
      throw new Error("finalization fixture rejected");
    }

    expect(
      probeSampleFinalizeReceiptMatchesRequest(receipt, request, claim),
    ).toBe(true);
    expect(
      probeSampleFinalizeReceiptMatchesRequest(
        receipt,
        ProbeSampleFinalizeRequestV1Schema.make({
          ...request,
          fragment: gatewaySampleFromRun(run, sampleOrdinal, {
            edgeColo: null,
            outcome: { kind: "ok" },
            spans: [sessionSpan(2)],
          }),
        }),
        claim,
      ),
    ).toBe(false);
  });
});

function validRun(
  runIdValue: string,
  options: {
    readonly concurrency?: number;
    readonly scenario?: ProbeRunRequestV1["scenario"];
  } = {},
): ProbeRunRequestV1 {
  return runEffectTestSync(
    decodeProbeRunRequestV1Effect({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      runId: runEffectTestSync(decodeProbeRunIdEffect(runIdValue)),
      scenario: options.scenario ?? "edge_echo",
      repetitions: options.concurrency ?? 1,
      warmupRepetitions: 0,
      dimensions: {
        codeMode: "stable",
        concurrency: options.concurrency ?? 1,
        journalEntries: 0,
        payloadBytes: 0,
        sessionMode: "new-session",
      },
    }),
  );
}

function registeredStatus(run: ProbeRunRequestV1) {
  return ProbeRunStatusV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    run,
    state: "registered",
    sealed: false,
    reconciled: false,
    evidenceFrozen: false,
    budgets: {
      limits: PROBE_RUN_BUDGET_LIMITS_V1,
      planned: probeRunBudgetPlanV1(run),
      consumed: {
        sampleClaims: 0,
        payloadBytes: 0,
        journalEntries: 0,
        uniqueCodeIds: 0,
      },
    },
    counters: {
      claimed: 0,
      terminal: 0,
      completed: 0,
      failed: 0,
      abandoned: 0,
      outstanding: 0,
      highWaterOutstandingClaims: 0,
      eligible: 0,
      excludedWarmup: 0,
      excludedDuplicateWake: 0,
    },
    samples: [],
  });
}

function ordinal(value: number) {
  return runEffectTestSync(decodeProbeOrdinalEffect(value));
}

function sessionSpan(durationMs: number) {
  return ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(ordinal(1)),
    parentSpanId: probeSpanId(ordinal(0)),
    name: "gateway_session_rtt",
    durationMs: ProbeDurationMsSchema.make(durationMs),
    outcome: { kind: "ok" },
  });
}
