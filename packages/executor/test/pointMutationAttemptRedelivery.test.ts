import {
  PointMutationAttemptDiscoveryInputV1Error,
  type PointMutationAttemptDiscoveryCandidateV1,
  type PointMutationAttemptDiscoveryV1,
} from "@flarex/persistence-postgres/point-mutation-attempt-discovery";
import {
  PointMutationExecutionClaimAcquisitionStaleV1Error,
} from "@flarex/persistence-postgres/transaction-session-activation";
import { Deferred, Effect, Fiber } from "effect";
import { ReplacementScopeIdV1Schema } from
  "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as executorRoot from "../src";
import {
  createPointMutationAttemptRedeliveryV1,
  type PointMutationAttemptRedeliveryDispositionV1,
} from "../src/pointMutationAttemptRedelivery";
import { decodePointMutationSessionAttemptSelectorV1 } from
  "../src/pointMutationSessionAttemptSelector";
import type { StoredPointMutationCrashRedispatchV1 } from
  "../src/storedAttemptAuthentication";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const FIRST = candidate(
  "94000000-0000-4000-8000-000000000001",
  "expiredClaim",
  "2026-07-21T00:00:00.000Z",
);
const SECOND = candidate(
  "94000000-0000-4000-8000-000000000002",
  "finishingSession",
  "2026-07-21T00:00:01.000Z",
);

describe("O08-B2b2b2b1b2a bounded point-attempt redelivery", () => {
  it("stays off the executor package root", () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      "createPointMutationAttemptRedeliveryV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("createPointMutationAttemptRedeliveryV1" in executorRoot)
      .toBe(false);
    type ImpossibleClosedState = Extract<
      PointMutationAttemptRedeliveryDispositionV1,
      {
        readonly kind: "closed";
        readonly reason: "authorityExpired";
        readonly lifecycle: "aborted";
      }
    >;
    expectTypeOf<ImpossibleClosedState>().toEqualTypeOf<never>();
  });

  it("processes one page sequentially and returns only owned redacted outcomes", async () => {
    const calls: Array<string> = [];
    const releaseFirst = await runEffect(Deferred.make<void>());
    const firstEntered = await runEffect(Deferred.make<void>());
    const redelivery = createPointMutationAttemptRedeliveryV1(
      discovery([FIRST, SECOND]),
      redispatch((input) => Effect.gen(function* () {
        const selector = decodePointMutationSessionAttemptSelectorV1(input);
        calls.push(selector.sessionId);
        if (selector.sessionId === FIRST.selector.sessionId) {
          yield* Deferred.succeed(firstEntered, undefined);
          yield* Deferred.await(releaseFirst);
          return Object.freeze({ kind: "busy" as const });
        }
        return Object.freeze({
          kind: "closed" as const,
          reason: "dirtyOpen" as const,
          lifecycle: "aborted" as const,
          terminalizedAt: "2026-07-21T00:01:00.000Z",
        });
      })),
    );

    const program = Effect.gen(function* () {
      const fiber = yield* redelivery.sweepEffect({ limit: 2 }).pipe(
        Effect.forkChild,
      );
      yield* Deferred.await(firstEntered);
      expect(calls).toEqual([FIRST.selector.sessionId]);
      yield* Deferred.succeed(releaseFirst, undefined);
      return yield* Fiber.join(fiber);
    });
    const result = await runEffect(program);
    expect(calls).toEqual([
      FIRST.selector.sessionId,
      SECOND.selector.sessionId,
    ]);
    expect(result).toEqual({
      horizon: "2026-07-21T00:00:10.000Z",
      items: [
        { candidate: FIRST, disposition: { kind: "busy" } },
        {
          candidate: SECOND,
          disposition: {
            kind: "closed",
            reason: "dirtyOpen",
            lifecycle: "aborted",
            terminalizedAt: "2026-07-21T00:01:00.000Z",
          },
        },
      ],
      continuation: null,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items)).toBe(true);
    expect(Object.isFrozen(result.items[0]?.candidate.selector)).toBe(true);
  });

  it("stops at the first typed failure and preserves its source identity", async () => {
    const failure = new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "attemptReplaced",
    });
    const calls: Array<string> = [];
    const redelivery = createPointMutationAttemptRedeliveryV1(
      discovery([FIRST, SECOND]),
      redispatch((input) => {
        const selector = decodePointMutationSessionAttemptSelectorV1(input);
        calls.push(selector.sessionId);
        return Effect.fail(failure);
      }),
    );

    await expect(runEffectFailure(redelivery.sweepEffect({ limit: 2 })))
      .resolves.toBe(failure);
    expect(calls).toEqual([FIRST.selector.sessionId]);
  });

  it("preserves a discovery failure and never enters redispatch", async () => {
    const failure = new PointMutationAttemptDiscoveryInputV1Error({
      reason: "invalidInput",
    });
    let redispatchCalls = 0;
    const redelivery = createPointMutationAttemptRedeliveryV1(
      Object.freeze({ discoverEffect: () => Effect.fail(failure) }),
      redispatch(() => {
        redispatchCalls += 1;
        return Effect.succeed(Object.freeze({ kind: "busy" }));
      }),
    );

    await expect(runEffectFailure(redelivery.sweepEffect({})))
      .resolves.toBe(failure);
    expect(redispatchCalls).toBe(0);
  });
});

function candidate(
  sessionId: string,
  source: PointMutationAttemptDiscoveryCandidateV1["source"],
  eligibleAt: string,
): PointMutationAttemptDiscoveryCandidateV1 {
  return Object.freeze({
    selector: Object.freeze({
      deploymentId: TransactionGrantDeploymentIdV1Schema.make(
        "deployment_redelivery_unit",
      ),
      scopeId: ReplacementScopeIdV1Schema.make(
        "scope_94000000-0000-4000-8000-000000000010",
      ),
      sessionId: TransactionSessionIdV1Schema.make(sessionId),
      attemptFence: TransactionAttemptFenceSchema.make(1n),
    }),
    source,
    eligibleAt,
  });
}

function discovery(
  candidates: ReadonlyArray<PointMutationAttemptDiscoveryCandidateV1>,
): Pick<PointMutationAttemptDiscoveryV1, "discoverEffect"> {
  return Object.freeze({
    discoverEffect: () => Effect.succeed(Object.freeze({
      horizon: "2026-07-21T00:00:10.000Z",
      candidates: Object.freeze([...candidates]),
      continuation: null,
    })),
  });
}

function redispatch(
  operation: Pick<
    StoredPointMutationCrashRedispatchV1,
    "redispatchExactPointMutationAttempt"
  >["redispatchExactPointMutationAttempt"],
): Pick<
  StoredPointMutationCrashRedispatchV1,
  "redispatchExactPointMutationAttempt"
> {
  return Object.freeze({ redispatchExactPointMutationAttempt: operation });
}
