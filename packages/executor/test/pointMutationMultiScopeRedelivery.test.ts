import {
  PointMutationAttemptDiscoveryInputV1Error,
  type PointMutationAttemptDiscoveryContinuationV1,
} from "@flarex/persistence-postgres/point-mutation-attempt-discovery";
import {
  PointMutationRedeliveryScopeDiscoverySqlV1Error,
  type PointMutationRedeliveryScopeCandidateV1,
  type PointMutationRedeliveryScopeDiscoveryContinuationV1,
  type PointMutationRedeliveryScopeDiscoveryV1,
} from "@flarex/persistence-postgres/point-mutation-redelivery-scope-discovery";
import { Cause, Deferred, Effect, Exit, Fiber, Result } from "effect";
import {
  FlarexDbV1StorageGenerationSchema,
  ReplacementScopeIdV1Schema,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as executorRoot from "../src";
import type {
  PointMutationAttemptRedeliveryPageV1,
  PointMutationAttemptRedeliveryV1,
} from "../src/pointMutationAttemptRedelivery";
import {
  PointMutationMultiScopeRedeliveryCorruptionV1Error,
  PointMutationMultiScopeRedeliveryInputV1Error,
  createPointMutationMultiScopeRedeliveryV1,
  type PointMutationMultiScopeQueueEntryV1,
  type PointMutationMultiScopeRedeliveryContinuationV1,
} from "../src/pointMutationMultiScopeRedelivery";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const DIRECTORY_CONTINUATION = scopeContinuation(999);

describe("O08-B2b2b2b1b2b2a bounded multi-scope redelivery", () => {
  it("stays private and rejects malformed or contradictory continuations", async () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      "createPointMutationMultiScopeRedeliveryV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("createPointMutationMultiScopeRedeliveryV1" in executorRoot)
      .toBe(false);

    const operation = createPointMutationMultiScopeRedeliveryV1(
      directory(() => Effect.succeed(directoryPage([], null))),
      redelivery(() => Effect.succeed(attemptPage(null))),
    );
    for (const invalid of [
      {},
      input({ scopeLimit: 0 }),
      input({ maxAttemptPages: 101 }),
      input({ maxCandidateAttempts: 2, maxAttemptPages: 1 }),
      { ...input(), extra: true },
      input({
        continuation: continuation(
          { kind: "unstarted" },
          [queueEntry(locator(1), { kind: "unstarted" })],
        ),
      }),
      input({
        continuation: continuation(
          { kind: "exhausted" },
          [
            queueEntry(locator(1), { kind: "unstarted" }),
            queueEntry(locator(1), { kind: "unstarted" }),
          ],
        ),
      }),
    ]) {
      const failure = await runEffectFailure(operation.sweepEffect(invalid));
      expect(failure).toBeInstanceOf(
        PointMutationMultiScopeRedeliveryInputV1Error,
      );
    }
  });

  it.each([
    { queued: 99, scopeLimit: 100, expectedLimit: 1 },
    { queued: 40, scopeLimit: 100, expectedLimit: 60 },
  ])(
    "limits the one directory query to remaining queue capacity %#",
    async ({ queued, scopeLimit, expectedLimit }) => {
      const directoryInputs: unknown[] = [];
      const redeliveryInputs: unknown[] = [];
      const scopes = Array.from({ length: queued }, (_, index) =>
        queueEntry(locator(index + 1), { kind: "unstarted" })
      );
      const operation = createPointMutationMultiScopeRedeliveryV1(
        directory((rawInput) => {
          directoryInputs.push(rawInput);
          return Effect.succeed(directoryPage([], DIRECTORY_CONTINUATION));
        }),
        redelivery((rawInput) => {
          redeliveryInputs.push(rawInput);
          return Effect.succeed(attemptPage(null));
        }),
      );

      const result = await runEffect(operation.sweepEffect(input({
        scopeLimit,
        maxAttemptPages: 1,
        maxCandidateAttempts: 1,
        continuation: continuation(
          { kind: "continuing", continuation: DIRECTORY_CONTINUATION },
          scopes,
        ),
      })));

      expect(directoryInputs).toEqual([{
        limit: expectedLimit,
        continuation: DIRECTORY_CONTINUATION,
      }]);
      expect(redeliveryInputs).toHaveLength(1);
      expect(result.scopeDirectoryQueries).toBe(1);
      expect(result.continuation?.scopes).toHaveLength(queued - 1);
    },
  );

  it("skips directory I/O at capacity and does not issue a later query after processing", async () => {
    let directoryCalls = 0;
    const redeliveryInputs: unknown[] = [];
    const scopes = Array.from({ length: 100 }, (_, index) =>
      queueEntry(locator(index + 1), { kind: "unstarted" })
    );
    const operation = createPointMutationMultiScopeRedeliveryV1(
      directory(() => {
        directoryCalls += 1;
        return Effect.succeed(directoryPage([], null));
      }),
      redelivery((rawInput) => {
        redeliveryInputs.push(rawInput);
        return Effect.succeed(attemptPage(null));
      }),
    );

    const result = await runEffect(operation.sweepEffect(input({
      maxAttemptPages: 2,
      maxCandidateAttempts: 2,
      continuation: continuation(
        { kind: "continuing", continuation: DIRECTORY_CONTINUATION },
        scopes,
      ),
    })));

    expect(directoryCalls).toBe(0);
    expect(redeliveryInputs).toHaveLength(2);
    expect(result.scopeDirectoryQueries).toBe(0);
    expect(result.continuation?.directory).toEqual({
      kind: "continuing",
      continuation: DIRECTORY_CONTINUATION,
    });
    expect(result.continuation?.scopes).toHaveLength(98);
  });

  it("queries unstarted once, preserves empty continuing pages, and never queries exhausted state", async () => {
    const directoryInputs: unknown[] = [];
    const operation = createPointMutationMultiScopeRedeliveryV1(
      directory((rawInput) => {
        directoryInputs.push(rawInput);
        return Effect.succeed(directoryPage([], DIRECTORY_CONTINUATION));
      }),
      redelivery(() => Effect.succeed(attemptPage(null))),
    );

    const first = await runEffect(operation.sweepEffect(input()));
    expect(directoryInputs).toEqual([{ limit: 100 }]);
    expect(first.continuation).toEqual(continuation(
      { kind: "continuing", continuation: DIRECTORY_CONTINUATION },
      [],
    ));

    const exhausted = await runEffect(operation.sweepEffect(input({
      continuation: continuation({ kind: "exhausted" }, []),
    })));
    expect(directoryInputs).toHaveLength(1);
    expect(exhausted).toMatchObject({
      scopeDirectoryQueries: 0,
      scopes: [],
      continuation: null,
    });
  });

  it("does no queued scope work when the issued directory query fails", async () => {
    const failure = new PointMutationRedeliveryScopeDiscoverySqlV1Error({
      operation: "discover",
      cause: new Error("directory unavailable"),
    });
    let redeliveryCalls = 0;
    const operation = createPointMutationMultiScopeRedeliveryV1(
      directory(() => Effect.fail(failure)),
      redelivery(() => {
        redeliveryCalls += 1;
        return Effect.succeed(attemptPage(null));
      }),
    );

    await expect(runEffectFailure(operation.sweepEffect(input({
      continuation: continuation(
        { kind: "continuing", continuation: DIRECTORY_CONTINUATION },
        [queueEntry(locator(1), { kind: "unstarted" })],
      ),
    })))).resolves.toBe(failure);
    expect(redeliveryCalls).toBe(0);
  });

  it("processes one-candidate pages round-robin within both budgets", async () => {
    const calls: string[] = [];
    const perScopeCalls = new Map<string, number>();
    const operation = createPointMutationMultiScopeRedeliveryV1(
      directory(() => Effect.succeed(directoryPage(
        [locator(1), locator(2)],
        null,
      ))),
      redelivery((rawInput) => {
        const record = rawInput as Readonly<{
          readonly deploymentId: string;
          readonly scopeId: string;
        }>;
        calls.push(record.scopeId);
        const count = (perScopeCalls.get(record.scopeId) ?? 0) + 1;
        perScopeCalls.set(record.scopeId, count);
        const candidate = attemptCandidate(
          record.deploymentId,
          record.scopeId,
          count,
        );
        return Effect.succeed(attemptPage(
          count === 1
            ? attemptContinuation(record.deploymentId, record.scopeId, count)
            : null,
          [candidate],
        ));
      }),
    );

    const result = await runEffect(operation.sweepEffect(input({
      maxAttemptPages: 4,
      maxCandidateAttempts: 4,
    })));
    expect(calls).toEqual([
      locator(1).scopeId,
      locator(2).scopeId,
      locator(1).scopeId,
      locator(2).scopeId,
    ]);
    expect(result).toMatchObject({
      scopeDirectoryQueries: 1,
      attemptPagesCharged: 4,
      candidateAttemptsCharged: 4,
      continuation: null,
    });
    expect(result.scopes).toHaveLength(4);
  });

  it("resumes the exact queued order and inner continuation after budget exhaustion", async () => {
    let directoryCalls = 0;
    const redeliveryInputs: unknown[] = [];
    const firstScopeContinuation = attemptContinuation(
      locator(1).deploymentId,
      locator(1).scopeId,
      1,
    );
    const operation = createPointMutationMultiScopeRedeliveryV1(
      directory(() => {
        directoryCalls += 1;
        return Effect.succeed(directoryCalls === 1
          ? directoryPage([locator(1), locator(2)], DIRECTORY_CONTINUATION)
          : directoryPage([], null));
      }),
      redelivery((rawInput) => {
        redeliveryInputs.push(rawInput);
        const record = rawInput as Readonly<{
          readonly deploymentId: string;
          readonly scopeId: string;
          readonly continuation?: PointMutationAttemptDiscoveryContinuationV1;
        }>;
        return Effect.succeed(attemptPage(
          record.scopeId === locator(1).scopeId &&
              record.continuation === undefined
            ? firstScopeContinuation
            : null,
          [attemptCandidate(record.deploymentId, record.scopeId, 1)],
        ));
      }),
    );

    const first = await runEffect(operation.sweepEffect(input({
      maxAttemptPages: 1,
      maxCandidateAttempts: 1,
    })));
    expect(first.continuation).toEqual(continuation(
      { kind: "continuing", continuation: DIRECTORY_CONTINUATION },
      [
        queueEntry(locator(2), { kind: "unstarted" }),
        queueEntry(locator(1), {
          kind: "continuing",
          continuation: firstScopeContinuation,
        }),
      ],
    ));

    const second = await runEffect(operation.sweepEffect(input({
      maxAttemptPages: 2,
      maxCandidateAttempts: 2,
      ...(first.continuation === null
        ? {}
        : { continuation: first.continuation }),
    })));
    expect(directoryCalls).toBe(2);
    expect(redeliveryInputs).toEqual([
      {
        deploymentId: locator(1).deploymentId,
        scopeId: locator(1).scopeId,
        limit: 1,
      },
      {
        deploymentId: locator(2).deploymentId,
        scopeId: locator(2).scopeId,
        limit: 1,
      },
      {
        deploymentId: locator(1).deploymentId,
        scopeId: locator(1).scopeId,
        limit: 1,
        continuation: firstScopeContinuation,
      },
    ]);
    expect(second.scopes.map(({ locator: scope }) => scope.scopeId)).toEqual([
      locator(2).scopeId,
      locator(1).scopeId,
    ]);
    expect(second.continuation).toBeNull();
  });

  it("charges and removes a failed page while preserving exact private error identity", async () => {
    const cause = { mutable: true };
    const failure = new PointMutationAttemptDiscoveryInputV1Error({
      reason: "invalidInput",
      cause,
    });
    let calls = 0;
    const operation = createPointMutationMultiScopeRedeliveryV1(
      directory(() => Effect.succeed(directoryPage(
        [locator(1), locator(2)],
        null,
      ))),
      redelivery(() => {
        calls += 1;
        return calls === 1
          ? Effect.fail(failure)
          : Effect.succeed(attemptPage(null));
      }),
    );

    const result = await runEffect(operation.sweepEffect(input({
      maxAttemptPages: 2,
      maxCandidateAttempts: 2,
    })));
    expect(result.attemptPagesCharged).toBe(2);
    expect(result.candidateAttemptsCharged).toBe(1);
    expect(result.continuation).toBeNull();
    const failed = result.scopes[0];
    expect(failed).toMatchObject({ kind: "failed", locator: locator(1) });
    if (failed?.kind !== "failed") throw new Error("expected failure data");
    expect(failed.error).toBe(failure);
    expect(Object.isFrozen(failed)).toBe(true);
    expect(Object.isFrozen(failed.locator)).toBe(true);
    expect(Object.isFrozen(failure)).toBe(false);
    expect(Object.isFrozen(cause)).toBe(false);
    cause.mutable = false;
    expect(failure.cause).toEqual({ mutable: false });
    expect(result.scopes[1]).toMatchObject({
      kind: "processed",
      locator: locator(2),
    });
  });

  it("fails closed on duplicate discovered locators and overfull inner pages", async () => {
    const directoryOverflowOperation =
      createPointMutationMultiScopeRedeliveryV1(
        directory(() => Effect.succeed(directoryPage(
          [locator(1), locator(2)],
          null,
        ))),
        redelivery(() => Effect.succeed(attemptPage(null))),
      );
    await expect(runEffectFailure(directoryOverflowOperation.sweepEffect(
      input({ scopeLimit: 1 }),
    ))).resolves.toMatchObject({
      _tag: "PointMutationMultiScopeRedeliveryCorruptionV1Error",
      reason: "directoryCandidateOverflow",
    });

    const duplicateOperation = createPointMutationMultiScopeRedeliveryV1(
      directory(() => Effect.succeed(directoryPage(
        [locator(1), locator(1)],
        null,
      ))),
      redelivery(() => Effect.succeed(attemptPage(null))),
    );
    await expect(runEffectFailure(duplicateOperation.sweepEffect(input())))
      .resolves.toMatchObject({
        _tag: "PointMutationMultiScopeRedeliveryCorruptionV1Error",
        reason: "duplicateScopeLocator",
      });

    let overflowingPageItemReads = 0;
    let overflowingItemReads = 0;
    const unreachableOverflowItem = {
      get candidate(): never {
        overflowingItemReads += 1;
        throw new Error("overflow item must not be visited");
      },
      get disposition(): never {
        overflowingItemReads += 1;
        throw new Error("overflow item must not be visited");
      },
    } satisfies PointMutationAttemptRedeliveryPageV1["items"][number];
    const reachableOverflowItem = Object.freeze({
      candidate: attemptCandidate(
        locator(1).deploymentId,
        locator(1).scopeId,
        1,
      ),
      disposition: Object.freeze({ kind: "busy" as const }),
    }) satisfies PointMutationAttemptRedeliveryPageV1["items"][number];
    const overflowingPage = {
      horizon: "2026-07-21T00:00:10.000Z",
      get items() {
        overflowingPageItemReads += 1;
        if (overflowingPageItemReads > 1) {
          throw new Error("overflow page items must be read exactly once");
        }
        return [reachableOverflowItem, unreachableOverflowItem] as const;
      },
      continuation: null,
    } satisfies PointMutationAttemptRedeliveryPageV1;
    const overflowOperation = createPointMutationMultiScopeRedeliveryV1(
      directory(() => Effect.succeed(directoryPage([locator(1)], null))),
      redelivery(() => Effect.succeed(overflowingPage)),
    );
    const overflow = await runEffectFailure(
      overflowOperation.sweepEffect(input()),
    );
    expect(overflow).toBeInstanceOf(
      PointMutationMultiScopeRedeliveryCorruptionV1Error,
    );
    expect(overflow).toMatchObject({ reason: "attemptPageOverflow" });
    expect(overflowingPageItemReads).toBe(1);
    expect(overflowingItemReads).toBe(0);
  });

  it("keeps defects and interruption in Cause and mints no continuation", async () => {
    const defect = new Error("redelivery defect");
    const defectOperation = createPointMutationMultiScopeRedeliveryV1(
      directory(() => Effect.succeed(directoryPage([locator(1)], null))),
      redelivery(() => Effect.die(defect)),
    );
    const defectExit = await runEffect(Effect.exit(
      defectOperation.sweepEffect(input()),
    ));
    expect(Exit.isFailure(defectExit)).toBe(true);
    if (Exit.isFailure(defectExit)) {
      const observedDefect = Cause.findDefect(defectExit.cause);
      expect(Result.isSuccess(observedDefect)).toBe(true);
      if (Result.isSuccess(observedDefect)) {
        expect(observedDefect.success).toBe(defect);
      }
    }

    const entered = await runEffect(Deferred.make<void>());
    const interruptedOperation = createPointMutationMultiScopeRedeliveryV1(
      directory(() => Effect.succeed(directoryPage([locator(1)], null))),
      redelivery(() => Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined);
        return yield* Effect.never;
      })),
    );
    const program = Effect.gen(function* () {
      const fiber = yield* interruptedOperation.sweepEffect(input()).pipe(
        Effect.forkChild,
      );
      yield* Deferred.await(entered);
      const completion = yield* Fiber.await(fiber).pipe(Effect.forkChild);
      yield* Fiber.interrupt(fiber);
      return yield* Fiber.join(completion);
    });
    const interruptedExit = await runEffect(program);
    expect(Exit.isFailure(interruptedExit)).toBe(true);
    if (Exit.isFailure(interruptedExit)) {
      expect(Cause.hasInterruptsOnly(interruptedExit.cause)).toBe(true);
    }
  });
});

function input(overrides: Readonly<{
  readonly scopeLimit?: number;
  readonly maxAttemptPages?: number;
  readonly maxCandidateAttempts?: number;
  readonly continuation?: PointMutationMultiScopeRedeliveryContinuationV1;
}> = {}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    scopeLimit: overrides.scopeLimit ?? 100,
    maxAttemptPages: overrides.maxAttemptPages ?? 100,
    maxCandidateAttempts: overrides.maxCandidateAttempts ?? 100,
    ...(overrides.continuation === undefined
      ? {}
      : { continuation: overrides.continuation }),
  });
}

function locator(sequence: number): PointMutationRedeliveryScopeCandidateV1 {
  const suffix = sequence.toString().padStart(12, "0");
  return Object.freeze({
    deploymentId: TransactionGrantDeploymentIdV1Schema.make(
      `deployment_multi_scope_${suffix}`,
    ),
    scopeId: ReplacementScopeIdV1Schema.make(
      `scope_96000000-0000-4000-8000-${suffix}`,
    ),
  });
}

function queueEntry(
  scope: PointMutationRedeliveryScopeCandidateV1,
  attemptDiscovery: PointMutationMultiScopeQueueEntryV1["attemptDiscovery"],
): PointMutationMultiScopeQueueEntryV1 {
  return Object.freeze({ locator: scope, attemptDiscovery });
}

function continuation(
  directoryState: PointMutationMultiScopeRedeliveryContinuationV1["directory"],
  scopes: ReadonlyArray<PointMutationMultiScopeQueueEntryV1>,
): PointMutationMultiScopeRedeliveryContinuationV1 {
  return Object.freeze({
    codecVersion: 1,
    directory: directoryState,
    scopes: Object.freeze([...scopes]),
  });
}

function scopeContinuation(
  sequence: number,
): PointMutationRedeliveryScopeDiscoveryContinuationV1 {
  return Object.freeze({
    codecVersion: 1,
    highWaterScopeId: ScopeIdSchema.make(
      `scope_96000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
    ),
    lastScopeId: ScopeIdSchema.make(
      `scope_96000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
    ),
  });
}

function attemptContinuation(
  deploymentId: string,
  scopeId: string,
  sequence: number,
): PointMutationAttemptDiscoveryContinuationV1 {
  return Object.freeze({
    codecVersion: 1,
    deploymentId: TransactionGrantDeploymentIdV1Schema.make(deploymentId),
    scopeId: ReplacementScopeIdV1Schema.make(scopeId),
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: "1",
    epoch: ScopeEpochSchema.make("epoch_multi_scope"),
    horizon: "2026-07-21T00:00:10.000Z",
    lastEligibleAt: `2026-07-21T00:00:0${sequence}.000Z`,
    lastSource: "expiredClaim",
    lastSessionId: TransactionSessionIdV1Schema.make(
      `97000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
    ),
    lastAttemptFence: "1",
  });
}

function attemptCandidate(
  deploymentId: string,
  scopeId: string,
  sequence: number,
) {
  return Object.freeze({
    selector: Object.freeze({
      deploymentId: TransactionGrantDeploymentIdV1Schema.make(deploymentId),
      scopeId: ReplacementScopeIdV1Schema.make(scopeId),
      sessionId: TransactionSessionIdV1Schema.make(
        `98000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
      ),
      attemptFence: TransactionAttemptFenceSchema.make(1n),
    }),
    source: "expiredClaim" as const,
    eligibleAt: `2026-07-21T00:00:0${sequence}.000Z`,
  });
}

function directoryPage(
  candidates: ReadonlyArray<PointMutationRedeliveryScopeCandidateV1>,
  next: PointMutationRedeliveryScopeDiscoveryContinuationV1 | null,
) {
  return Object.freeze({
    candidates: Object.freeze([...candidates]),
    continuation: next,
  });
}

function attemptPage(
  next: PointMutationAttemptDiscoveryContinuationV1 | null,
  candidates: ReadonlyArray<ReturnType<typeof attemptCandidate>> = [],
): PointMutationAttemptRedeliveryPageV1 {
  return Object.freeze({
    horizon: "2026-07-21T00:00:10.000Z",
    items: Object.freeze(candidates.map((candidate) => Object.freeze({
      candidate,
      disposition: Object.freeze({ kind: "busy" as const }),
    }))),
    continuation: next,
  });
}

function directory(
  operation: PointMutationRedeliveryScopeDiscoveryV1["discoverEffect"],
): Pick<PointMutationRedeliveryScopeDiscoveryV1, "discoverEffect"> {
  return Object.freeze({ discoverEffect: operation });
}

function redelivery(
  operation: PointMutationAttemptRedeliveryV1["sweepEffect"],
): Pick<PointMutationAttemptRedeliveryV1, "sweepEffect"> {
  return Object.freeze({ sweepEffect: operation });
}
