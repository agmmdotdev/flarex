import { Deferred, Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  PointMutationExecutionClaimLivenessResultV1,
  PointMutationExecutionClaimLivenessV1,
} from
  "@flarex/persistence-postgres/transaction-execution-claim-liveness";
import {
  TransactionExecutionClaimFenceV1Schema,
  TransactionExecutionClaimOwnerV1Schema,
} from "@flarex/persistence-postgres/transaction-execution-claim";
import { ReplacementScopeIdV1Schema } from
  "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";

import { createPointMutationExecutionClaimVaultV1 } from
  "../src/pointMutationExecutionClaim";
import * as executorRoot from "../src";
import {
  createPointMutationExecutionLivenessCoordinatorV1,
  PointMutationExecutionLivenessClosedV1Error,
  PointMutationExecutionLivenessConfigurationV1Error,
  validatePointMutationExecutionLivenessConfigurationV1Result,
} from "../src/pointMutationExecutionClaimLiveness";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const SELECTOR = Object.freeze({
  deploymentId: TransactionGrantDeploymentIdV1Schema.make(
    "deployment_liveness_unit",
  ),
  scopeId: ReplacementScopeIdV1Schema.make(
    "scope_7b100000-0000-4000-8000-000000000001",
  ),
  sessionId: TransactionSessionIdV1Schema.make(
    "7b100000-0000-4000-8000-000000000002",
  ),
  attemptFence: TransactionAttemptFenceSchema.make(1n),
});
const OBSERVATION = Object.freeze({
  claimOwner: TransactionExecutionClaimOwnerV1Schema.make(
    "7b100000-0000-4000-8000-000000000003",
  ),
  claimFence: TransactionExecutionClaimFenceV1Schema.make(1n),
  claimedAt: "2026-07-21T00:00:00.000Z",
  claimExpiresAt: "2026-07-21T00:01:00.000Z",
});
const RENEWED_OPEN: PointMutationExecutionClaimLivenessResultV1 =
  Object.freeze({
    kind: "renewed",
    phase: "open",
    leaseExpiresAt: "2026-07-21T01:00:00.000Z",
    executionClaim: OBSERVATION,
  });
const RENEWED_RELATION_CONFLICTED:
  PointMutationExecutionClaimLivenessResultV1 = Object.freeze({
    kind: "renewed",
    phase: "relationConflicted",
    leaseExpiresAt: "2026-07-21T01:00:00.000Z",
    executionClaim: OBSERVATION,
  });

describe("O08-B2b2b2b1b1 structured execution-claim liveness", () => {
  it("stays off the executor package root", () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      | "createPointMutationExecutionLivenessCoordinatorV1"
      | "PointMutationExecutionLivenessClosedV1Error"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("createPointMutationExecutionLivenessCoordinatorV1" in executorRoot)
      .toBe(false);
  });

  it("renews immediately and periodically under TestClock, then stops", async () => {
    let calls = 0;
    const fixture = makeCoordinator(() => {
      calls += 1;
      return Effect.succeed(RENEWED_OPEN);
    });
    const release = await runEffect(Deferred.make<void>());
    const program = Effect.gen(function* () {
      const fiber = yield* fixture.coordinator.run(
        fixture.scope,
        "execute",
        () => Deferred.await(release).pipe(Effect.as("done")),
      ).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(calls).toBe(1);
      yield* TestClock.adjust("9 millis");
      expect(calls).toBe(1);
      yield* TestClock.adjust("1 millis");
      expect(calls).toBe(2);
      yield* TestClock.adjust("10 millis");
      expect(calls).toBe(3);
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(fiber)).toBe("done");
      yield* TestClock.adjust("1 minute");
      expect(calls).toBe(3);
    });
    await runEffect(program.pipe(Effect.provide(TestClock.layer())));
  });

  it("keeps supervising after a periodic relation conflict", async () => {
    let calls = 0;
    const fixture = makeCoordinator(() => Effect.succeed(++calls === 1
      ? RENEWED_OPEN
      : RENEWED_RELATION_CONFLICTED));
    const release = await runEffect(Deferred.make<void>());
    const program = Effect.gen(function* () {
      const fiber = yield* fixture.coordinator.run(
        fixture.scope,
        "execute",
        () => Deferred.await(release).pipe(Effect.as("done")),
      ).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("10 millis");
      expect(calls).toBe(2);
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(fiber)).toBe("done");
    });
    await runEffect(program.pipe(Effect.provide(TestClock.layer())));
  });

  it("rejects a relation-conflicted root as initial execution authority", async () => {
    let bodyCalls = 0;
    const fixture = makeCoordinator(
      () => Effect.succeed(RENEWED_RELATION_CONFLICTED),
    );
    const error = await runEffectFailure(fixture.coordinator.run(
      fixture.scope,
      "execute",
      () => Effect.sync(() => {
        bodyCalls += 1;
      }),
    ));
    expect(error).toMatchObject({
      _tag: "PointMutationExecutionLivenessClosedV1Error",
      reason: "initialPhaseMismatch",
    });
    expect(bodyCalls).toBe(0);
  });

  it("accepts a relation-conflicted root only for replacement work", async () => {
    let bodyCalls = 0;
    const fixture = makeCoordinator(
      () => Effect.succeed(RENEWED_RELATION_CONFLICTED),
      10,
      "replaceRelationConflict",
    );
    const result = await runEffect(fixture.coordinator.run(
      fixture.scope,
      "replaceRelationConflict",
      () => Effect.sync(() => {
        bodyCalls += 1;
        return "recovered" as const;
      }),
    ));
    expect(result).toBe("recovered");
    expect(bodyCalls).toBe(1);

    const openFixture = makeCoordinator(
      () => Effect.succeed(RENEWED_OPEN),
      10,
      "replaceRelationConflict",
    );
    await expect(runEffectFailure(openFixture.coordinator.run(
      openFixture.scope,
      "replaceRelationConflict",
      () => Effect.void,
    ))).resolves.toMatchObject({
      _tag: "PointMutationExecutionLivenessClosedV1Error",
      reason: "initialPhaseMismatch",
    });
  });

  it("quiesces renewal while C05-A settles and throughout publication", async () => {
    let calls = 0;
    const fixture = makeCoordinator(() => Effect.sync(() => {
      calls += 1;
      return calls === 1
        ? RENEWED_OPEN
        : Object.freeze({ kind: "consumedByFinishing" as const });
    }));
    const finishing = await runEffect(Deferred.make<void>());
    const publication = await runEffect(Deferred.make<void>());
    const program = Effect.gen(function* () {
      const fiber = yield* fixture.coordinator.run(
        fixture.scope,
        "execute",
        (control) => Effect.gen(function* () {
          yield* control.enterFinishing(Deferred.await(finishing));
          yield* Deferred.await(publication);
          return "committed" as const;
        }),
      ).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("10 millis");
      expect(calls).toBe(1);
      yield* Deferred.succeed(finishing, undefined);
      yield* TestClock.adjust("1 minute");
      expect(calls).toBe(1);
      yield* Deferred.succeed(publication, undefined);
      expect(yield* Fiber.join(fiber)).toBe("committed");
    });
    await runEffect(program.pipe(Effect.provide(TestClock.layer())));
  });

  it("settles an in-flight renewal before entering C05-A", async () => {
    let calls = 0;
    let finishingCalls = 0;
    const renewalStarted = await runEffect(Deferred.make<void>());
    const allowFinishing = await runEffect(Deferred.make<void>());
    const releaseRenewal = await runEffect(
      Deferred.make<PointMutationExecutionClaimLivenessResultV1>(),
    );
    const fixture = makeCoordinator(() => Effect.suspend(() => {
      calls += 1;
      if (calls === 1) return Effect.succeed(RENEWED_OPEN);
      return Deferred.succeed(renewalStarted, undefined).pipe(
        Effect.andThen(Deferred.await(releaseRenewal)),
      );
    }));
    const program = Effect.gen(function* () {
      const fiber = yield* fixture.coordinator.run(
        fixture.scope,
        "execute",
        (control) => Deferred.await(allowFinishing).pipe(
          Effect.andThen(control.enterFinishing(Effect.sync(() => {
            finishingCalls += 1;
            return "committed" as const;
          }))),
        ),
      ).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("10 millis");
      yield* Deferred.await(renewalStarted);
      yield* Deferred.succeed(allowFinishing, undefined);
      yield* Effect.yieldNow;
      expect(finishingCalls).toBe(0);
      yield* Deferred.succeed(releaseRenewal, RENEWED_OPEN);
      expect(yield* Fiber.join(fiber)).toBe("committed");
      expect(finishingCalls).toBe(1);
    });
    await runEffect(program.pipe(Effect.provide(TestClock.layer())));
  });

  it("fails closed when the claim is consumed before finishing", async () => {
    let calls = 0;
    const fixture = makeCoordinator(() => Effect.succeed(++calls === 1
      ? RENEWED_OPEN
      : Object.freeze({ kind: "consumedByFinishing" as const })));
    const program = Effect.gen(function* () {
      const fiber = yield* fixture.coordinator.run(
        fixture.scope,
        "execute",
        () => Effect.never,
      ).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("10 millis");
      return yield* Fiber.join(fiber);
    });
    const error = await runEffectFailure(
      program.pipe(Effect.provide(TestClock.layer())),
    );
    expect(error).toBeInstanceOf(PointMutationExecutionLivenessClosedV1Error);
    expect(error).toMatchObject({ reason: "claimConsumedBeforeFinishing" });
  });

  it("routes failed roots to terminalization-required without running work", async () => {
    let bodyCalls = 0;
    const fixture = makeCoordinator(() => Effect.succeed(Object.freeze({
      kind: "terminalizationRequired" as const,
      reason: "failedRoot" as const,
      leaseExpiresAt: "2026-07-21T01:00:00.000Z",
      executionClaim: OBSERVATION,
    })));
    const error = await runEffectFailure(fixture.coordinator.run(
      fixture.scope,
      "execute",
      () => Effect.sync(() => {
        bodyCalls += 1;
      }),
    ));
    expect(error).toMatchObject({
      _tag: "PointMutationExecutionLivenessClosedV1Error",
      reason: "failedRootRequiresTerminalization",
    });
    expect(bodyCalls).toBe(0);
  });

  it("rejects invalid heartbeat headroom before persistence or work", async () => {
    let renewalCalls = 0;
    const fixture = makeCoordinator(
      () => {
        renewalCalls += 1;
        return Effect.succeed(RENEWED_OPEN);
      },
      31,
    );
    const error = await runEffectFailure(fixture.coordinator.run(
      fixture.scope,
      "execute",
      () => Effect.void,
    ));
    expect(error).toBeInstanceOf(
      PointMutationExecutionLivenessConfigurationV1Error,
    );
    expect(error).toMatchObject({
      reason: "heartbeatIntervalExceedsClaimHeadroom",
    });
    expect(renewalCalls).toBe(0);
  });

  it("exposes the same heartbeat validation for composition preflight", () => {
    const fixture = makeCoordinator(() => Effect.succeed(RENEWED_OPEN));

    const result =
      validatePointMutationExecutionLivenessConfigurationV1Result(
        fixture.liveness,
        { heartbeatIntervalMilliseconds: 31 },
      );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        reason: "heartbeatIntervalExceedsClaimHeadroom",
      });
    }
  });

  it("rejects cross-factory scopes and mode mismatches", async () => {
    const fixture = makeCoordinator(() => Effect.succeed(RENEWED_OPEN));
    const other = makeScope("execute");
    await expect(runEffectFailure(fixture.coordinator.run(
      other.scope,
      "execute",
      () => Effect.void,
    ))).resolves.toMatchObject({
      _tag: "InvalidPointMutationExecutionClaimV1Error",
      reason: "notSameFactory",
    });
    await expect(runEffectFailure(fixture.coordinator.run(
      fixture.scope,
      "finishOnly",
      () => Effect.void,
    ))).resolves.toMatchObject({
      _tag: "InvalidPointMutationExecutionClaimV1Error",
      reason: "modeUnavailable",
    });
  });
});

function makeCoordinator(
  renew: PointMutationExecutionClaimLivenessV1["renewEffect"],
  heartbeatIntervalMilliseconds = 10,
  mode: "execute" | "finishOnly" | "replaceRelationConflict" = "execute",
) {
  const { vault, scope } = makeScope(mode);
  const liveness: PointMutationExecutionClaimLivenessV1 = Object.freeze({
    configuration: Result.succeed(Object.freeze({
      claimDurationMilliseconds: 60,
      leaseRenewalDurationMilliseconds: 120,
      maximumLiveSnapshotRetentionMilliseconds: 1_000,
    })),
    renewEffect: renew,
  });
  return Object.freeze({
    scope,
    liveness,
    coordinator: createPointMutationExecutionLivenessCoordinatorV1(
      vault.admission,
      liveness,
      Object.freeze({ heartbeatIntervalMilliseconds }),
    ),
  });
}

function makeScope(
  mode: "execute" | "finishOnly" | "replaceRelationConflict",
) {
  const vault = createPointMutationExecutionClaimVaultV1();
  const claim = vault.issuer.mint(Object.freeze({
    selector: SELECTOR,
    observation: OBSERVATION,
    mode,
  }));
  const scope = Result.getOrThrow(vault.admission.admit(claim, mode));
  return Object.freeze({ vault, scope });
}
