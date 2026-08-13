import { Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  fromCurrentTaskRunAttemptAggregate,
  toCurrentApplicationTaskRunAttemptDecision,
  toCurrentLegacyTaskRunAttemptDecision,
  toCurrentTaskRunAttemptAggregate,
  type ApplicationTaskLifecycleOutcomeByOperation,
  type LegacyTaskLifecycleOutcomeByOperation,
  type TaskLifecycleDecisionOperation,
} from "../src/runAttempt/DefinitionReference.js";
import {
  decideApplicationCompleteAttemptV1,
  decideApplicationHandleLeaseExpiryV1,
  decideApplicationHeartbeatAttemptV1,
  decideApplicationRequestCancellationV1,
  decideApplicationStartAttemptV1,
  decideCompleteAttemptV1,
  decideHandleLeaseExpiryV1,
  decideHeartbeatAttemptV1,
  decideRequestCancellationV1,
  decideStartAttemptV1,
} from "../src/runAttempt/Layers/RunAttemptLifecycleLive.js";
import type {
  ApplicationCompleteAttemptOutcomeV1,
  ApplicationHandleLeaseExpiryOutcomeV1,
  ApplicationHeartbeatAttemptOutcomeV1,
  ApplicationRequestCancellationOutcomeV1,
  ApplicationStartAttemptOutcomeV1,
  ApplicationTaskRunAttemptDecisionV1,
  ApplicationTaskRunAttemptAggregateV1,
  CompleteAttemptOutcomeV1,
  CurrentCompleteAttemptOutcome,
  CurrentHandleLeaseExpiryOutcome,
  CurrentHeartbeatAttemptOutcome,
  CurrentRequestCancellationOutcome,
  CurrentStartAttemptOutcome,
  CurrentTaskRunAttemptDecision,
  CurrentTaskRunAttemptAggregate,
  HandleLeaseExpiryOutcomeV1,
  HeartbeatAttemptOutcomeV1,
  RequestCancellationOutcomeV1,
  StartAttemptOutcomeV1,
  TaskDefinitionRevisionIdV1,
  TaskRunAttemptAggregateV1,
  TaskRunAttemptDecisionV1,
} from "../src/runAttempt/Model.js";
import {
  ATTEMPT_ID,
  ATTEMPT_NUMBER_1,
  FENCE_1,
  JITTER,
  LEASE_VERSION_1,
  NOW,
  RUN_ID,
  databaseTime,
  duration,
  executingAggregate,
  heartbeatSequence,
  readyAggregate,
} from "./support.js";

const APPLICATION_TARGET = new Uint8Array(32).fill(0x6a);

describe("Application lifecycle adapter parity", () => {
  it("keeps start and heartbeat decisions generation-neutral", () => {
    const candidate = {
      attemptId: ATTEMPT_ID,
      attemptNumber: ATTEMPT_NUMBER_1,
      executionFence: FENCE_1,
    };
    assertParity(
      "start_attempt",
      decideStartAttemptV1({
        type: "start_attempt",
        runId: RUN_ID,
        expectedRunVersion: readyAggregate().runVersion,
        retryJitter: JITTER,
      }, { databaseNowMs: NOW, current: readyAggregate(), attemptGrantCandidate: candidate }),
      decideApplicationStartAttemptV1({
        type: "start_attempt",
        runId: RUN_ID,
        expectedRunVersion: readyAggregate().runVersion,
        retryJitter: JITTER,
      }, {
        databaseNowMs: NOW,
        current: applicationAggregate(readyAggregate()),
        attemptGrantCandidate: candidate,
      }),
    );

    const current = executingAggregate({ leaseExpiresAt: databaseTime(NOW + 30_000) });
    assertParity(
      "heartbeat_attempt",
      decideHeartbeatAttemptV1({
        type: "heartbeat_attempt",
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        executionFence: FENCE_1,
        heartbeatSequence: heartbeatSequence(2),
      }, { databaseNowMs: NOW, current, attemptGrantCandidate: null }),
      decideApplicationHeartbeatAttemptV1({
        type: "heartbeat_attempt",
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        executionFence: FENCE_1,
        heartbeatSequence: heartbeatSequence(2),
      }, {
        databaseNowMs: NOW,
        current: applicationAggregate(current),
        attemptGrantCandidate: null,
      }),
    );
  });

  it("keeps retry, terminal completion, cancellation, and expiry decisions identical", () => {
    const active = executingAggregate({ effectCursor: 8n });
    const failed = {
      type: "complete_attempt" as const,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      executionFence: FENCE_1,
      completion: {
        kind: "failed" as const,
        failure: { kind: "task_failure" as const, code: "handler_failed" as const, message: null },
        retry: { kind: "override_delay" as const, delayMs: duration(1) },
        executionDurationMs: null,
      },
    };
    assertParity(
      "complete_attempt",
      decideCompleteAttemptV1(failed, { databaseNowMs: NOW, current: active, attemptGrantCandidate: null }),
      decideApplicationCompleteAttemptV1(failed, {
        databaseNowMs: NOW,
        current: applicationAggregate(active),
        attemptGrantCandidate: null,
      }),
    );

    const succeeded = {
      type: "complete_attempt" as const,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      executionFence: FENCE_1,
      completion: { kind: "succeeded" as const, result: null, executionDurationMs: null },
    };
    const legacyCompletion = decideCompleteAttemptV1(succeeded, {
      databaseNowMs: NOW,
      current: active,
      attemptGrantCandidate: null,
    });
    const applicationCompletion = decideApplicationCompleteAttemptV1(succeeded, {
      databaseNowMs: NOW,
      current: applicationAggregate(active),
      attemptGrantCandidate: null,
    });
    assertParity("complete_attempt", legacyCompletion, applicationCompletion);
    const legacyCommitted = Result.getOrThrow(legacyCompletion);
    const applicationCommitted = Result.getOrThrow(applicationCompletion);
    if (legacyCommitted.kind !== "commit" || applicationCommitted.kind !== "commit") {
      throw new Error("Expected committed completion.");
    }
    assertParity(
      "complete_attempt",
      decideCompleteAttemptV1(succeeded, {
        databaseNowMs: NOW,
        current: legacyCommitted.next,
        attemptGrantCandidate: null,
      }),
      decideApplicationCompleteAttemptV1(succeeded, {
        databaseNowMs: NOW,
        current: applicationCommitted.next,
        attemptGrantCandidate: null,
      }),
    );

    assertParity(
      "request_cancellation",
      decideRequestCancellationV1({
        type: "request_cancellation",
        runId: RUN_ID,
        reason: { code: "requested", message: null },
      }, { databaseNowMs: NOW, current: active, attemptGrantCandidate: null }),
      decideApplicationRequestCancellationV1({
        type: "request_cancellation",
        runId: RUN_ID,
        reason: { code: "requested", message: null },
      }, {
        databaseNowMs: NOW,
        current: applicationAggregate(active),
        attemptGrantCandidate: null,
      }),
    );

    const expired = executingAggregate({
      leaseExpiresAt: databaseTime(NOW - 1),
      effectCursor: 8n,
    });
    const expiry = {
      type: "handle_lease_expiry" as const,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      executionFence: FENCE_1,
      expectedLeaseVersion: LEASE_VERSION_1,
    };
    assertParity(
      "handle_lease_expiry",
      decideHandleLeaseExpiryV1(expiry, {
        databaseNowMs: NOW,
        current: expired,
        attemptGrantCandidate: null,
      }),
      decideApplicationHandleLeaseExpiryV1(expiry, {
        databaseNowMs: NOW,
        current: applicationAggregate(expired),
        attemptGrantCandidate: null,
      }),
    );
  });

  it("rejects divergent Application identities before current and replay decisions", () => {
    const start = {
      type: "start_attempt" as const,
      runId: RUN_ID,
      expectedRunVersion: readyAggregate().runVersion,
      retryJitter: JITTER,
    };
    const committed = Result.getOrThrow(decideApplicationStartAttemptV1(
      start,
      {
        databaseNowMs: NOW,
        current: applicationAggregate(readyAggregate()),
        attemptGrantCandidate: {
          attemptId: ATTEMPT_ID,
          attemptNumber: ATTEMPT_NUMBER_1,
          executionFence: FENCE_1,
        },
      },
    ));
    if (committed.kind !== "commit") throw new Error("Expected commit.");
    const divergent = corruptNestedApplicationIdentity(committed.next);

    const currentFailure = Result.getOrThrow(Result.flip(
      decideApplicationHeartbeatAttemptV1({
        type: "heartbeat_attempt",
        runId: RUN_ID,
        attemptId: "attempt_00000000-0000-4000-8000-000000000099" as typeof ATTEMPT_ID,
        executionFence: FENCE_1,
        heartbeatSequence: heartbeatSequence(1),
      }, {
        databaseNowMs: NOW,
        current: divergent,
        attemptGrantCandidate: null,
      }),
    ));
    expect(currentFailure).toMatchObject({
      _tag: "InvalidRunAttemptTransitionError",
      operation: "heartbeat_attempt",
      reason: "next_state_invalid",
    });

    const replayFailure = Result.getOrThrow(Result.flip(
      decideApplicationStartAttemptV1(start, {
        databaseNowMs: NOW,
        current: divergent,
        attemptGrantCandidate: {
          attemptId: ATTEMPT_ID,
          attemptNumber: ATTEMPT_NUMBER_1,
          executionFence: FENCE_1,
        },
      }),
    ));
    expect(replayFailure).toMatchObject({
      _tag: "InvalidRunAttemptTransitionError",
      operation: "start_attempt",
      reason: "next_state_invalid",
    });
  });
});

function assertParity<Operation extends TaskLifecycleDecisionOperation>(
  operation: Operation,
  legacyResult: Result.Result<
    TaskRunAttemptDecisionV1<
      LegacyTaskLifecycleOutcomeByOperation[Operation]
    >,
    unknown
  >,
  applicationResult: Result.Result<
    ApplicationTaskRunAttemptDecisionV1<
      ApplicationTaskLifecycleOutcomeByOperation[Operation]
    >,
    unknown
  >,
): void {
  const legacy = Result.getOrThrow(legacyResult);
  const application = Result.getOrThrow(applicationResult);
  const legacyCurrent = toCurrentLegacyTaskRunAttemptDecision(
    operation,
    legacy,
  );
  const applicationCurrent = toCurrentApplicationTaskRunAttemptDecision(
    operation,
    application,
  );
  expect(normalizeReferences(applicationCurrent)).toEqual(
    normalizeReferences(legacyCurrent),
  );
  expect(containsKey(application, "taskDefinitionRevisionId")).toBe(false);
}

function assertStaticDecisionAdapterContracts(
  legacyStart: TaskRunAttemptDecisionV1<StartAttemptOutcomeV1>,
  applicationStart: ApplicationTaskRunAttemptDecisionV1<
    ApplicationStartAttemptOutcomeV1
  >,
  legacyHeartbeat: TaskRunAttemptDecisionV1<HeartbeatAttemptOutcomeV1>,
  applicationHeartbeat: ApplicationTaskRunAttemptDecisionV1<
    ApplicationHeartbeatAttemptOutcomeV1
  >,
  legacyComplete: TaskRunAttemptDecisionV1<CompleteAttemptOutcomeV1>,
  applicationComplete: ApplicationTaskRunAttemptDecisionV1<
    ApplicationCompleteAttemptOutcomeV1
  >,
  legacyCancellation: TaskRunAttemptDecisionV1<RequestCancellationOutcomeV1>,
  applicationCancellation: ApplicationTaskRunAttemptDecisionV1<
    ApplicationRequestCancellationOutcomeV1
  >,
  legacyExpiry: TaskRunAttemptDecisionV1<HandleLeaseExpiryOutcomeV1>,
  applicationExpiry: ApplicationTaskRunAttemptDecisionV1<
    ApplicationHandleLeaseExpiryOutcomeV1
  >,
): void {
  expectTypeOf(toCurrentLegacyTaskRunAttemptDecision("start_attempt", legacyStart))
    .toEqualTypeOf<CurrentTaskRunAttemptDecision<CurrentStartAttemptOutcome>>();
  expectTypeOf(toCurrentApplicationTaskRunAttemptDecision("start_attempt", applicationStart))
    .toEqualTypeOf<CurrentTaskRunAttemptDecision<CurrentStartAttemptOutcome>>();
  expectTypeOf(toCurrentLegacyTaskRunAttemptDecision("heartbeat_attempt", legacyHeartbeat))
    .toEqualTypeOf<CurrentTaskRunAttemptDecision<CurrentHeartbeatAttemptOutcome>>();
  expectTypeOf(toCurrentApplicationTaskRunAttemptDecision("heartbeat_attempt", applicationHeartbeat))
    .toEqualTypeOf<CurrentTaskRunAttemptDecision<CurrentHeartbeatAttemptOutcome>>();
  expectTypeOf(toCurrentLegacyTaskRunAttemptDecision("complete_attempt", legacyComplete))
    .toEqualTypeOf<CurrentTaskRunAttemptDecision<CurrentCompleteAttemptOutcome>>();
  expectTypeOf(toCurrentApplicationTaskRunAttemptDecision("complete_attempt", applicationComplete))
    .toEqualTypeOf<CurrentTaskRunAttemptDecision<CurrentCompleteAttemptOutcome>>();
  expectTypeOf(toCurrentLegacyTaskRunAttemptDecision("request_cancellation", legacyCancellation))
    .toEqualTypeOf<CurrentTaskRunAttemptDecision<CurrentRequestCancellationOutcome>>();
  expectTypeOf(toCurrentApplicationTaskRunAttemptDecision("request_cancellation", applicationCancellation))
    .toEqualTypeOf<CurrentTaskRunAttemptDecision<CurrentRequestCancellationOutcome>>();
  expectTypeOf(toCurrentLegacyTaskRunAttemptDecision("handle_lease_expiry", legacyExpiry))
    .toEqualTypeOf<CurrentTaskRunAttemptDecision<CurrentHandleLeaseExpiryOutcome>>();
  expectTypeOf(toCurrentApplicationTaskRunAttemptDecision("handle_lease_expiry", applicationExpiry))
    .toEqualTypeOf<CurrentTaskRunAttemptDecision<CurrentHandleLeaseExpiryOutcome>>();
  // @ts-expect-error Application decisions cannot enter the Legacy adapter.
  toCurrentLegacyTaskRunAttemptDecision("start_attempt", applicationStart);
  // @ts-expect-error Legacy decisions cannot enter the Application adapter.
  toCurrentApplicationTaskRunAttemptDecision("start_attempt", legacyStart);
}

void assertStaticDecisionAdapterContracts;

type CallerOwnedOutcome = Readonly<{
  readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
}>;
function assertCallerOwnedOutcomeRemainsOpaque(
  decision: ApplicationTaskRunAttemptDecisionV1<CallerOwnedOutcome>,
): void {
  if (decision.kind === "no_change" && decision.disposition === "current") {
    expectTypeOf(decision.outcome).toEqualTypeOf<CallerOwnedOutcome>();
  }
}
void assertCallerOwnedOutcomeRemainsOpaque;

function applicationAggregate(
  legacy: TaskRunAttemptAggregateV1,
): ApplicationTaskRunAttemptAggregateV1 {
  const current = replaceDefinitionReferences(toCurrentTaskRunAttemptAggregate({
    generation: "legacy_definition_v1",
    aggregate: legacy,
  }));
  const persisted = Result.getOrThrow(fromCurrentTaskRunAttemptAggregate(
    current,
    "application_v1",
  ));
  if (persisted.generation !== "application_v1") {
    throw new Error("Expected Application aggregate.");
  }
  return persisted.aggregate;
}

function corruptNestedApplicationIdentity(
  aggregate: ApplicationTaskRunAttemptAggregateV1,
): ApplicationTaskRunAttemptAggregateV1 {
  const owned = mutableClone(aggregate) as Record<string, unknown>;
  const digests = collectDigestOwners(owned);
  if (digests.length < 2) throw new Error("Expected a nested Application identity.");
  const nestedOwner = digests[1];
  if (nestedOwner === undefined) throw new Error("Expected nested identity owner.");
  nestedOwner.applicationTaskRuntimeTargetSha256 = new Uint8Array(32).fill(0x27);
  return owned as unknown as ApplicationTaskRunAttemptAggregateV1;

  function collectDigestOwners(value: unknown): Record<string, unknown>[] {
    const owners: Record<string, unknown>[] = [];
    visit(value);
    return owners;

    function visit(input: unknown): void {
      if (input === null || typeof input !== "object" ||
        input instanceof Uint8Array) return;
      if (Array.isArray(input)) {
        for (const child of input) visit(child);
        return;
      }
      const record = input as Record<string, unknown>;
      if (record.applicationTaskRuntimeTargetSha256 instanceof Uint8Array) {
        owners.push(record);
      }
      for (const child of Object.values(record)) visit(child);
    }
  }
}

function mutableClone(value: unknown): unknown {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (Array.isArray(value)) return value.map(mutableClone);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    mutableClone(child),
  ]));
}

function replaceDefinitionReferences(
  value: CurrentTaskRunAttemptAggregate,
): CurrentTaskRunAttemptAggregate {
  return visit(value) as CurrentTaskRunAttemptAggregate;

  function visit(input: unknown): unknown {
    if (input instanceof Uint8Array) return new Uint8Array(input);
    if (Array.isArray(input)) return input.map(visit);
    if (input === null || typeof input !== "object") return input;
    const record = input as Readonly<Record<string, unknown>>;
    const transformed = Object.fromEntries(
      Object.entries(record).map(([key, child]) => [key, visit(child)]),
    );
    if (!("definitionReference" in record)) return transformed;
    return {
      ...transformed,
      definitionReference: {
        generation: "application_v1",
        applicationTaskRuntimeTargetSha256: APPLICATION_TARGET,
      },
    };
  }
}

function normalizeReferences(value: unknown): unknown {
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(normalizeReferences);
  if (value === null || typeof value !== "object") return value;
  const record = value as Readonly<Record<string, unknown>>;
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [
    key,
    key === "definitionReference" ? "definition" : normalizeReferences(child),
  ]));
}

function containsKey(value: unknown, key: string): boolean {
  if (value instanceof Uint8Array || value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) return value.some((child) => containsKey(child, key));
  const record = value as Readonly<Record<string, unknown>>;
  return Object.hasOwn(record, key) || Object.values(record).some((child) =>
    containsKey(child, key));
}
