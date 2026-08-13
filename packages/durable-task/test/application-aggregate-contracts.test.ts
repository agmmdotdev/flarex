import { Result, Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  fromCurrentTaskRunAttemptAggregate,
  toCurrentTaskRunAttemptAggregate,
} from "../src/runAttempt/DefinitionReference.js";
import { decideCompleteAttemptV1, decideStartAttemptV1 } from
  "../src/runAttempt/Layers/RunAttemptLifecycleLive.js";
import type {
  ApplicationTaskRunAttemptAggregateV1,
  CurrentTaskRunAttemptAggregate,
} from "../src/runAttempt/Model.js";
import {
  ApplicationTaskRunAttemptAggregateV1Schema,
  TaskRunAttemptAggregateV1Schema,
  decodeApplicationTaskRunAttemptAggregateV1,
  encodeApplicationTaskRunAttemptAggregateV1,
  encodeTaskRunAttemptAggregateV1,
} from "../src/runAttempt/Schema.js";
import {
  ATTEMPT_ID,
  ATTEMPT_NUMBER_1,
  FENCE_1,
  JITTER,
  NOW,
  RUN_ID,
  committedDecision,
  executingAggregate,
  readyAggregate,
} from "./support.js";

const TARGET = new Uint8Array(32).fill(0x67);

describe("Application aggregate contracts", () => {
  it("round-trips the complete recursive start receipt graph", () => {
    const legacy = startedAggregate();
    const current = toCurrentTaskRunAttemptAggregate({
      generation: "legacy_definition_v1",
      aggregate: legacy,
    });
    const application = Result.getOrThrow(fromCurrentTaskRunAttemptAggregate(
      replaceCurrentReferences(current, TARGET),
      "application_v1",
    ));
    if (application.generation !== "application_v1") {
      throw new Error("Expected Application aggregate.");
    }
    const encoded = Result.getOrThrow(
      encodeApplicationTaskRunAttemptAggregateV1(application.aggregate),
    );
    const decoded = Result.getOrThrow(
      decodeApplicationTaskRunAttemptAggregateV1(encoded),
    );
    const roundTrip = toCurrentTaskRunAttemptAggregate({
      generation: "application_v1",
      aggregate: decoded,
    });

    expect(roundTrip).toEqual(replaceCurrentReferences(current, TARGET));
    expect(Result.isFailure(Schema.decodeUnknownResult(
      TaskRunAttemptAggregateV1Schema,
      { onExcessProperty: "error" },
    )(encoded))).toBe(true);
  });

  it("round-trips completion replay receipts and rejects a valid nested digest mismatch", () => {
    const completed = committedDecision(decideCompleteAttemptV1({
      type: "complete_attempt",
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      executionFence: FENCE_1,
      completion: { kind: "succeeded", result: null, executionDurationMs: null },
    }, {
      databaseNowMs: NOW,
      current: executingAggregate({ effectCursor: 8n }),
      attemptGrantCandidate: null,
    })).next;
    const current = replaceCurrentReferences(toCurrentTaskRunAttemptAggregate({
      generation: "legacy_definition_v1",
      aggregate: completed,
    }), TARGET);
    const persisted = Result.getOrThrow(fromCurrentTaskRunAttemptAggregate(
      current,
      "application_v1",
    ));
    if (persisted.generation !== "application_v1") {
      throw new Error("Expected Application aggregate.");
    }
    const encoded = Result.getOrThrow(
      encodeApplicationTaskRunAttemptAggregateV1(persisted.aggregate),
    );
    expect(Result.getOrThrow(
      decodeApplicationTaskRunAttemptAggregateV1(encoded),
    )).toEqual(persisted.aggregate);

    const started = Result.getOrThrow(encodeApplicationTaskRunAttemptAggregateV1(
      Result.getOrThrow(fromCurrentTaskRunAttemptAggregate(
        replaceCurrentReferences(toCurrentTaskRunAttemptAggregate({
          generation: "legacy_definition_v1",
          aggregate: startedAggregate(),
        }), TARGET),
        "application_v1",
      )).aggregate,
    )) as Record<string, unknown>;
    const acceptance = started.lastLifecycleAcceptance as Record<string, unknown>;
    const accepted = acceptance.accepted as Record<string, unknown>;
    const outcome = accepted.outcome as Record<string, unknown>;
    const grant = outcome.grant as Record<string, unknown>;
    grant.applicationTaskRuntimeTargetSha256 = new Uint8Array(32).fill(0x68);
    expect(Result.isFailure(
      decodeApplicationTaskRunAttemptAggregateV1(started),
    )).toBe(true);
  });

  it("rejects nested identity mismatch and owns shared-backed identities", () => {
    const applicationCurrent = replaceCurrentReferences(
      toCurrentTaskRunAttemptAggregate({
        generation: "legacy_definition_v1",
        aggregate: startedAggregate(),
      }),
      TARGET,
    );
    const mixed = structuredClone(applicationCurrent) as unknown as Record<string, unknown>;
    const acceptance = mixed.lastLifecycleAcceptance as Record<string, unknown>;
    if (acceptance.kind !== "start_attempt") {
      throw new Error("Expected start acceptance.");
    }
    const accepted = acceptance.accepted as Record<string, unknown>;
    const outcome = accepted.outcome as Record<string, unknown>;
    const grant = outcome.grant as Record<string, unknown>;
    grant.definitionReference = {
      generation: "legacy_definition_v1",
      taskDefinitionRevisionId: readyAggregate().taskDefinitionRevisionId,
    };
    expect(Result.getOrThrow(Result.flip(fromCurrentTaskRunAttemptAggregate(
      mixed as unknown as CurrentTaskRunAttemptAggregate,
      "application_v1",
    )))).toMatchObject({
      _tag: "TaskDefinitionReferenceGenerationMismatchError",
      operation: "persist_aggregate",
    });

    const mismatched = structuredClone(applicationCurrent) as unknown as Record<string, unknown>;
    const mismatchedAcceptance = mismatched.lastLifecycleAcceptance as Record<string, unknown>;
    const mismatchedAccepted = mismatchedAcceptance.accepted as Record<string, unknown>;
    const mismatchedOutcome = mismatchedAccepted.outcome as Record<string, unknown>;
    const mismatchedGrant = mismatchedOutcome.grant as Record<string, unknown>;
    mismatchedGrant.definitionReference = {
      generation: "application_v1",
      applicationTaskRuntimeTargetSha256: new Uint8Array(32).fill(0x68),
    };
    expect(Result.getOrThrow(Result.flip(fromCurrentTaskRunAttemptAggregate(
      mismatched as unknown as CurrentTaskRunAttemptAggregate,
      "application_v1",
    )))).toMatchObject({
      _tag: "TaskDefinitionReferenceIdentityMismatchError",
      operation: "persist_aggregate",
      generation: "application_v1",
    });

    const shared = new Uint8Array(new SharedArrayBuffer(32)).fill(0x52);
    const sharedCurrent = replaceCurrentReferences(applicationCurrent, shared);
    const sharedRootReference = (sharedCurrent as unknown as Record<string, unknown>)
      .definitionReference as Record<string, unknown>;
    Object.defineProperty(sharedRootReference, "afterSnapshot", {
      enumerable: true,
      get() {
        shared.fill(0x99);
        return true;
      },
    });
    const persisted = Result.getOrThrow(fromCurrentTaskRunAttemptAggregate(
      sharedCurrent,
      "application_v1",
    ));
    if (persisted.generation !== "application_v1") {
      throw new Error("Expected Application aggregate.");
    }
    const persistedIdentities = collectApplicationIdentities(persisted.aggregate);
    expect(persistedIdentities.length).toBeGreaterThan(3);
    for (const identity of persistedIdentities) {
      expect(identity[0]).toBe(0x52);
      expect(identity.buffer).toBeInstanceOf(ArrayBuffer);
    }
  });

  it("preserves the exact Legacy aggregate encoded contract", () => {
    const encoded = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(
      startedAggregate(),
    ));
    expect(encoded).toHaveProperty("taskDefinitionRevisionId");
    expect(encoded).not.toHaveProperty("applicationTaskRuntimeTargetSha256");
  });
});

function startedAggregate() {
  return committedDecision(decideStartAttemptV1({
    type: "start_attempt",
    runId: RUN_ID,
    expectedRunVersion: readyAggregate().runVersion,
    retryJitter: JITTER,
  }, {
    databaseNowMs: NOW,
    current: readyAggregate(),
    attemptGrantCandidate: {
      attemptId: ATTEMPT_ID,
      attemptNumber: ATTEMPT_NUMBER_1,
      executionFence: FENCE_1,
    },
  })).next;
}

function replaceCurrentReferences(
  value: CurrentTaskRunAttemptAggregate,
  digest: Uint8Array,
): CurrentTaskRunAttemptAggregate {
  return replace(value) as CurrentTaskRunAttemptAggregate;

  function replace(input: unknown): unknown {
    if (input instanceof Uint8Array) return new Uint8Array(input);
    if (Array.isArray(input)) return input.map(replace);
    if (input === null || typeof input !== "object") return input;
    const record = input as Readonly<Record<string, unknown>>;
    if ("definitionReference" in record) {
      const { definitionReference: _removed, ...rest } = record;
      return {
        ...Object.fromEntries(Object.entries(rest).map(([key, child]) => [key, replace(child)])),
        definitionReference: {
          generation: "application_v1",
          applicationTaskRuntimeTargetSha256: digest,
        },
      };
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, child]) => [key, replace(child)]),
    );
  }
}

function collectApplicationIdentities(value: unknown): readonly Uint8Array[] {
  const identities: Uint8Array[] = [];
  visit(value);
  return identities;

  function visit(input: unknown): void {
    if (input instanceof Uint8Array || input === null || typeof input !== "object") {
      return;
    }
    if (Array.isArray(input)) {
      for (const child of input) visit(child);
      return;
    }
    const record = input as Readonly<Record<string, unknown>>;
    if (record.applicationTaskRuntimeTargetSha256 instanceof Uint8Array) {
      identities.push(record.applicationTaskRuntimeTargetSha256);
    }
    for (const child of Object.values(record)) visit(child);
  }
}

expectTypeOf<typeof ApplicationTaskRunAttemptAggregateV1Schema.Type>()
  .toEqualTypeOf<ApplicationTaskRunAttemptAggregateV1>();
expectTypeOf<typeof TaskRunAttemptAggregateV1Schema.Encoded>().toBeUnknown();
