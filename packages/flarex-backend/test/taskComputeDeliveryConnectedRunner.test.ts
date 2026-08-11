import {
  decodeTaskRequestedEffectSequenceV1,
  TaskRunIdV1Schema,
} from "@flarex/durable-task/internal/run-attempt-v1";
import type {
  TaskComputeDeliveryCandidate,
  TaskComputeDeliveryCandidateDiscovery,
  TaskComputeDeliveryCandidatePage,
  TaskComputeDeliveryDiscoveryError,
  TaskComputeDeliveryOperation,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-discovery";
import {
  TaskComputeDeliveryDiscoverySqlError,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-discovery";
import type {
  TaskComputeDeliveryRepositoryV1,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-repository-v1";
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  replacementScopeIdV1FromUuid,
  type ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  TaskComputeDeliveryCandidateRunner,
  TaskComputeDeliveryCandidateRunnerInputError,
  type TaskComputeDeliveryCandidateRunnerShape,
} from "../src/taskComputeDelivery/CandidateRunner";
import {
  decodeTaskComputeDeliveryConnectedContinuationV1,
} from "../src/taskComputeDelivery/ConnectedContinuation";
import {
  makeTaskComputeDeliveryConnectedRunnerLayer,
  TaskComputeDeliveryConnectedRunner,
  TaskComputeDeliveryConnectedRunnerContractError,
  type TaskComputeDeliveryConnectedRunnerError,
  type TaskComputeDeliveryConnectedRunnerOptions,
  type TaskComputeDeliveryConnectedRunnerShape,
} from "../src/taskComputeDelivery/ConnectedRunner";
import {
  TaskComputeDeliveryTrustedDirectory,
  type TaskComputeDeliveryTrustedDirectoryPage,
  type TaskComputeDeliveryTrustedDirectoryReadyItem,
  type TaskComputeDeliveryTrustedDirectoryShape,
} from "../src/taskComputeDelivery/TrustedDirectory";

const SCOPE_1 = replacementScopeIdV1FromUuid(
  "96000000-0000-4000-8000-000000000001",
);
const SCOPE_2 = replacementScopeIdV1FromUuid(
  "96000000-0000-4000-8000-000000000002",
);
const decodeRunId = Schema.decodeUnknownResult(TaskRunIdV1Schema);

describe("DTE06-C3 bounded connected delivery runner", () => {
  it("keeps the private runner success, error, and requirement channels exact", () => {
    type RunEffect = ReturnType<TaskComputeDeliveryConnectedRunnerShape["run"]>;
    type Success = Assert<IsExact<
      Effect.Success<RunEffect>["version"],
      "flarex.task-compute-delivery-connected-runner-receipt.v1"
    >>;
    type Failure = Assert<IsExact<
      Effect.Error<RunEffect>,
      TaskComputeDeliveryConnectedRunnerError
    >>;
    type Services = Assert<IsExact<Effect.Services<RunEffect>, never>>;
    expectTypeOf<Success>().toEqualTypeOf<true>();
    expectTypeOf<Failure>().toEqualTypeOf<true>();
    expectTypeOf<Services>().toEqualTypeOf<true>();
  });

  it("alternates dispatch/cancellation and advances fairly across scopes", async () => {
    const order: string[] = [];
    const directory = twoScopeDirectory(order);
    const candidateRunner = recordingCandidateRunner(order);
    const receipt = await run(directory, candidateRunner, policy(), null);

    expect(receipt).toMatchObject({
      stopReason: "cycle_exhausted",
      directoryPagesCharged: 2,
      scopeVisits: 2,
      dispatchPagesCharged: 2,
      cancellationPagesCharged: 2,
      confirmedDispatchPagesRead: 2,
      confirmedCancellationPagesRead: 2,
      confirmedDispatchCandidatesHandled: 2,
      confirmedCancellationCandidatesHandled: 2,
      candidateFailures: 0,
      continuation: null,
    });
    expect(order).toEqual([
      "directory:scope-1",
      "scope-1:dispatch:discover",
      "scope-1:dispatch:run",
      "scope-1:cancellation:discover",
      "scope-1:cancellation:run",
      "directory:scope-2",
      "scope-2:dispatch:discover",
      "scope-2:dispatch:run",
      "scope-2:cancellation:discover",
      "scope-2:cancellation:run",
    ]);
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it("resumes the exact active scope in a fresh runner instance", async () => {
    const firstOrder: string[] = [];
    const constrained = policy({
      maximumDispatchPages: 1,
      maximumDispatchCandidates: 1,
      maximumDispatchProviderCalls: 1,
    });
    const first = await run(
      twoScopeDirectory(firstOrder),
      recordingCandidateRunner(firstOrder),
      constrained,
      null,
    );
    expect(first.stopReason).toBe("dispatch_page_budget");
    expect(first.continuation).not.toBeNull();
    const decoded = await Effect.runPromise(
      decodeTaskComputeDeliveryConnectedContinuationV1(first.continuation),
    );
    expect(decoded.activeScope).toMatchObject({
      expectedDeploymentId: "scope-2",
      expectedScopeId: SCOPE_2,
      nextOperation: "dispatch",
      dispatchPagesCharged: 0,
      cancellationPagesCharged: 0,
    });

    const resumedOrder: string[] = [];
    const second = await run(
      twoScopeDirectory(resumedOrder),
      recordingCandidateRunner(resumedOrder),
      constrained,
      first.continuation,
    );
    expect(second.stopReason).toBe("cycle_exhausted");
    expect(second.continuation).toBeNull();
    expect(resumedOrder).toEqual([
      "directory:resolve:scope-2",
      "scope-2:dispatch:discover",
      "scope-2:dispatch:run",
      "scope-2:cancellation:discover",
      "scope-2:cancellation:run",
    ]);
  });

  it("rejects a resumed terminal page that changes the finite snapshot", async () => {
    const firstPage = continuingDispatchPage(SCOPE_1);
    const constrained = policy({
      maximumDispatchPages: 1,
      maximumDispatchPagesPerScope: 2,
    });
    const first = await run(
      singleScopeDirectory([], { dispatchPage: firstPage }),
      recordingCandidateRunner([]),
      constrained,
      null,
    );
    expect(first.stopReason).toBe("dispatch_page_budget");

    await expect(run(
      singleScopeDirectory([], {
        dispatchPage: Object.freeze({
          ...candidatePage("dispatch", candidate("dispatch", SCOPE_1)),
          databaseTimeBound: "2026-08-12T00:00:00.000Z",
        }),
      }),
      recordingCandidateRunner([]),
      constrained,
      first.continuation,
    )).rejects.toMatchObject({
      _tag: "TaskComputeDeliveryConnectedRunnerContractError",
      reason: "continuation_snapshot_mismatch",
    });
  });

  it("rejects a resumed candidate beyond the original high-water", async () => {
    const firstPage = continuingDispatchPage(SCOPE_1);
    const constrained = policy({
      maximumDispatchPages: 1,
      maximumDispatchPagesPerScope: 2,
    });
    const first = await run(
      singleScopeDirectory([], { dispatchPage: firstPage }),
      recordingCandidateRunner([]),
      constrained,
      null,
    );

    await expect(run(
      singleScopeDirectory([], {
        dispatchPage: candidatePage(
          "dispatch",
          candidateAt("dispatch", "3", "3"),
        ),
      }),
      recordingCandidateRunner([]),
      constrained,
      first.continuation,
    )).rejects.toMatchObject({
      _tag: "TaskComputeDeliveryConnectedRunnerContractError",
      reason: "candidate_outside_snapshot",
    });
  });

  it("rejects an unordered candidate page", async () => {
    await expect(run(
      singleScopeDirectory([], {
        dispatchPage: Object.freeze({
          operation: "dispatch",
          databaseTimeBound: "2026-08-11T00:00:00.000Z",
          candidates: Object.freeze([
            candidateAt("dispatch", "2", "2"),
            candidateAt("dispatch", "1", "1"),
          ]),
          continuation: null,
        }),
      }),
      recordingCandidateRunner([]),
      policy({ candidatesPerPage: 2 }),
      null,
    )).rejects.toMatchObject({
      _tag: "TaskComputeDeliveryConnectedRunnerContractError",
      reason: "candidate_ordering_mismatch",
    });
  });

  it("rejects a continuation last position behind the returned page", async () => {
    const returned = candidateAt("dispatch", "2", "2");
    const behind = candidateAt("dispatch", "1", "1");
    const highWater = candidateAt("dispatch", "3", "3");
    await expect(run(
      singleScopeDirectory([], {
        dispatchPage: Object.freeze({
          operation: "dispatch",
          databaseTimeBound: "2026-08-11T00:00:00.000Z",
          candidates: Object.freeze([returned]),
          continuation: Object.freeze({
            codecVersion: 1,
            operation: "dispatch",
            databaseTimeBound: "2026-08-11T00:00:00.000Z",
            highWater: continuationPosition(highWater),
            last: continuationPosition(behind),
          }),
        }),
      }),
      recordingCandidateRunner([]),
      policy(),
      null,
    )).rejects.toMatchObject({
      _tag: "TaskComputeDeliveryConnectedRunnerContractError",
      reason: "continuation_last_mismatch",
    });
  });

  it("rejects an empty page that claims to keep advancing", async () => {
    const highWater = candidateAt("dispatch", "2", "2");
    const last = candidateAt("dispatch", "1", "1");
    await expect(run(
      singleScopeDirectory([], {
        dispatchPage: Object.freeze({
          operation: "dispatch",
          databaseTimeBound: "2026-08-11T00:00:00.000Z",
          candidates: Object.freeze([]),
          continuation: Object.freeze({
            codecVersion: 1,
            operation: "dispatch",
            databaseTimeBound: "2026-08-11T00:00:00.000Z",
            highWater: continuationPosition(highWater),
            last: continuationPosition(last),
          }),
        }),
      }),
      recordingCandidateRunner([]),
      policy(),
      null,
    )).rejects.toMatchObject({
      _tag: "TaskComputeDeliveryConnectedRunnerContractError",
      reason: "continuation_last_mismatch",
    });
  });

  it("rejects a resumed directory page that changes its high-water", async () => {
    const constrained = policy({ maximumScopeVisits: 1 });
    const first = await run(
      twoScopeDirectory([]),
      recordingCandidateRunner([]),
      constrained,
      null,
    );
    expect(first.stopReason).toBe("scope_visit_budget");

    await expect(run(
      fixedDirectoryPage(Object.freeze({
        items: Object.freeze([]),
        continuation: Object.freeze({
          codecVersion: 1,
          highWaterScopeId: SCOPE_1,
          lastScopeId: SCOPE_1,
        }),
      })),
      recordingCandidateRunner([]),
      constrained,
      first.continuation,
    )).rejects.toMatchObject({
      _tag: "TaskComputeDeliveryConnectedRunnerContractError",
      reason: "directory_continuation_invalid",
    });
  });

  it("rejects a resumed directory cursor that does not advance", async () => {
    const constrained = policy({ maximumScopeVisits: 1 });
    const first = await run(
      twoScopeDirectory([]),
      recordingCandidateRunner([]),
      constrained,
      null,
    );

    await expect(run(
      fixedDirectoryPage(Object.freeze({
        items: Object.freeze([]),
        continuation: Object.freeze({
          codecVersion: 1,
          highWaterScopeId: SCOPE_2,
          lastScopeId: SCOPE_1,
        }),
      })),
      recordingCandidateRunner([]),
      constrained,
      first.continuation,
    )).rejects.toMatchObject({
      _tag: "TaskComputeDeliveryConnectedRunnerContractError",
      reason: "directory_continuation_invalid",
    });
  });

  it("retains a full page charge when discovery has unknown progress", async () => {
    const order: string[] = [];
    const directory = singleScopeDirectory(order, {
      dispatchFailure: new TaskComputeDeliveryDiscoverySqlError({
        operation: "dispatch",
        phase: "decision_uncertain",
        cause: "lost response",
      }),
    });
    const receipt = await run(
      directory,
      recordingCandidateRunner(order),
      policy(),
      null,
    );

    expect(receipt).toMatchObject({
      stopReason: "cycle_exhausted",
      discoveryFailures: 1,
      dispatchPagesCharged: 1,
      dispatchCandidatesCharged: 1,
      dispatchProviderCallsCharged: 0,
      totalOperationsCharged: 1,
      confirmedDispatchPagesRead: 0,
      confirmedDispatchCandidatesHandled: 0,
      confirmedDispatchProviderCalls: 0,
      cancellationPagesCharged: 1,
      cancellationProviderCallsCharged: 1,
      confirmedCancellationPagesRead: 1,
    });
    expect(order).toEqual([
      "directory:scope-1",
      "scope-1:cancellation:discover",
      "scope-1:cancellation:run",
    ]);
  });

  it("keeps typed candidate failure local and preserves conservative charges", async () => {
    const order: string[] = [];
    const candidateRunner = recordingCandidateRunner(order, {
      dispatchFailure: new TaskComputeDeliveryCandidateRunnerInputError({
        operation: "dispatch",
        reason: "invalid_candidate",
      }),
    });
    const receipt = await run(
      singleScopeDirectory(order),
      candidateRunner,
      policy(),
      null,
    );

    expect(receipt).toMatchObject({
      stopReason: "cycle_exhausted",
      candidateFailures: 1,
      dispatchProviderCallsCharged: 1,
      confirmedDispatchCandidatesHandled: 0,
      confirmedDispatchProviderCalls: 0,
      confirmedCancellationCandidatesHandled: 1,
    });
  });

  it("persists an unknown-progress page charge across runner restart", async () => {
    const constrained = policy({
      maximumDispatchPages: 1,
      maximumDispatchCandidates: 1,
      maximumDispatchProviderCalls: 1,
      maximumDispatchPagesPerScope: 2,
    });
    const first = await run(
      singleScopeDirectory([], {
        dispatchFailure: new TaskComputeDeliveryDiscoverySqlError({
          operation: "dispatch",
          phase: "decision_uncertain",
          cause: "lost response",
        }),
      }),
      recordingCandidateRunner([]),
      constrained,
      null,
    );
    expect(first.stopReason).toBe("dispatch_page_budget");
    const decoded = await Effect.runPromise(
      decodeTaskComputeDeliveryConnectedContinuationV1(first.continuation),
    );
    expect(decoded.activeScope).toMatchObject({
      dispatch: { kind: "unstarted" },
      dispatchPagesCharged: 1,
      cancellation: { kind: "exhausted" },
      cancellationPagesCharged: 1,
      nextOperation: "dispatch",
    });

    const resumedOrder: string[] = [];
    const second = await run(
      singleScopeDirectory(resumedOrder),
      recordingCandidateRunner(resumedOrder),
      constrained,
      first.continuation,
    );
    expect(second.stopReason).toBe("cycle_exhausted");
    expect(resumedOrder).toEqual([
      "scope-1:dispatch:discover",
      "scope-1:dispatch:run",
    ]);
  });

  it("charges a timed-out discovery page and still advances the other operation", async () => {
    const order: string[] = [];
    let finalized = false;
    const receipt = await runWithTestClock(
      singleScopeDirectory(order, {
        dispatchEffect: Effect.never.pipe(Effect.ensuring(Effect.sync(() => {
          finalized = true;
        }))),
      }),
      recordingCandidateRunner(order),
      policy({
        maximumRunMilliseconds: 1_000,
        maximumOperationMilliseconds: 10,
        settlementReserveMilliseconds: 10,
      }),
      null,
    );
    expect(receipt).toMatchObject({
      stopReason: "cycle_exhausted",
      discoveryFailures: 1,
      dispatchPagesCharged: 1,
      confirmedDispatchPagesRead: 0,
      cancellationPagesCharged: 1,
      confirmedCancellationPagesRead: 1,
    });
    expect(finalized).toBe(true);
  });

  it("preserves external interruption and cannot return a charged receipt", async () => {
    let finalized = false;
    const entered = await Effect.runPromise(Deferred.make<void>());
    const directory = singleScopeDirectory([], {
      dispatchEffect: Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.ensuring(Effect.sync(() => {
          finalized = true;
        })),
      ),
    });
    const layer = makeTaskComputeDeliveryConnectedRunnerLayer(policy()).pipe(
      Layer.provide(dependencyLayer(
        directory,
        recordingCandidateRunner([]),
      )),
    );
    const exit = await Effect.runPromise(Effect.gen(function* () {
      const runner = yield* TaskComputeDeliveryConnectedRunner;
      const fiber = yield* runner.run(null).pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(fiber);
      yield* Effect.yieldNow;
      return yield* Fiber.await(fiber);
    }).pipe(Effect.provide(layer)));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) throw new Error("expected interrupted runner");
    expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    expect(finalized).toBe(true);
  });

  it("lets candidate-local directory timeout settle before the outer boundary", async () => {
    const order: string[] = [];
    const receipt = await runWithTestClock(
      candidateLocalTimeoutDirectory(order),
      recordingCandidateRunner(order),
      policy({
        maximumRunMilliseconds: 100,
        maximumOperationMilliseconds: 11,
        settlementReserveMilliseconds: 1,
      }),
      null,
    );

    expect(receipt).toMatchObject({
      stopReason: "cycle_exhausted",
      scopeResolutionFailures: 1,
      scopeVisits: 2,
    });
    expect(order).toContain("scope-2:dispatch:run");
  });

  it("rejects a mismatched freshly resolved active scope", async () => {
    const constrained = policy({
      maximumDispatchPages: 1,
      maximumDispatchCandidates: 1,
      maximumDispatchProviderCalls: 1,
    });
    const first = await run(
      twoScopeDirectory([]),
      recordingCandidateRunner([]),
      constrained,
      null,
    );
    const mismatched = twoScopeDirectory([], { mismatchedResolve: true });

    await expect(run(
      mismatched,
      recordingCandidateRunner([]),
      constrained,
      first.continuation,
    )).rejects.toBeInstanceOf(
      TaskComputeDeliveryConnectedRunnerContractError,
    );
  });

  it("rejects a policy that cannot admit one complete candidate page", async () => {
    const layer = makeTaskComputeDeliveryConnectedRunnerLayer(policy({
      candidatesPerPage: 2,
      maximumTotalOperations: 1,
    })).pipe(
      Layer.provide(dependencyLayer(
        singleScopeDirectory([]),
        recordingCandidateRunner([]),
      )),
    );
    await expect(Effect.runPromise(Effect.gen(function* () {
      yield* TaskComputeDeliveryConnectedRunner;
    }).pipe(Effect.provide(layer)))).rejects.toMatchObject({
      _tag: "TaskComputeDeliveryConnectedRunnerConfigurationError",
      reason: "invalid_policy",
    });
  });

  it("maps a hostile duration policy value to the typed configuration channel", async () => {
    const input = policy();
    const hostile = new Proxy(input, {
      get(target, property, receiver) {
        return property === "maximumOperationMilliseconds"
          ? Symbol("invalid duration")
          : Reflect.get(target, property, receiver);
      },
    });
    const layer = makeTaskComputeDeliveryConnectedRunnerLayer(hostile).pipe(
      Layer.provide(dependencyLayer(
        singleScopeDirectory([]),
        recordingCandidateRunner([]),
      )),
    );
    await expect(Effect.runPromise(Effect.gen(function* () {
      yield* TaskComputeDeliveryConnectedRunner;
    }).pipe(Effect.provide(layer)))).rejects.toMatchObject({
      _tag: "TaskComputeDeliveryConnectedRunnerConfigurationError",
      reason: "invalid_policy",
    });
  });

  it("maps a hostile directory page getter to the typed contract channel", async () => {
    const item = readyItem("scope-1", SCOPE_1, []);
    const page = Object.freeze({
      items: Object.freeze([item]),
      continuation: null,
    });
    const hostile = new Proxy(page, {
      get(target, property, receiver) {
        if (property === "items") throw new Error("hostile items getter");
        return Reflect.get(target, property, receiver);
      },
    });
    const directory: TaskComputeDeliveryTrustedDirectoryShape = Object.freeze({
      singleCandidateDiscoverSettlementBudgetMilliseconds: 5,
      resolveSettlementBudgetMilliseconds: 5,
      discover: () => Effect.succeed(hostile),
      resolve: () => Effect.succeed(item),
    });
    await expect(run(
      directory,
      recordingCandidateRunner([]),
      policy(),
      null,
    )).rejects.toMatchObject({
      _tag: "TaskComputeDeliveryConnectedRunnerContractError",
      reason: "directory_page_capture_invalid",
    });
  });
});

function twoScopeDirectory(
  order: string[],
  options: Readonly<{ readonly mismatchedResolve?: boolean }> = {},
): TaskComputeDeliveryTrustedDirectoryShape {
  const first = readyItem("scope-1", SCOPE_1, order);
  const second = readyItem("scope-2", SCOPE_2, order);
  let calls = 0;
  let directory: TaskComputeDeliveryTrustedDirectoryShape;
  const methods: TaskComputeDeliveryTrustedDirectoryShape = {
    singleCandidateDiscoverSettlementBudgetMilliseconds: 5,
    resolveSettlementBudgetMilliseconds: 5,
    discover(this: unknown) {
      if (this !== directory) return Effect.die("directory receiver lost");
      return Effect.sync(() => {
      calls += 1;
      if (calls === 1) {
        order.push("directory:scope-1");
        return Object.freeze({
          items: Object.freeze([first]),
          continuation: Object.freeze({
            codecVersion: 1 as const,
            highWaterScopeId: SCOPE_2,
            lastScopeId: SCOPE_1,
          }),
        });
      }
      order.push("directory:scope-2");
      return Object.freeze({ items: Object.freeze([second]), continuation: null });
      });
    },
    resolve(this: unknown, candidate: unknown) {
      if (this !== directory) return Effect.die("resolve receiver lost");
      return Effect.sync(() => {
      const deploymentId = candidateDeployment(candidate);
      order.push(`directory:resolve:${deploymentId}`);
      return options.mismatchedResolve === true
        ? first
        : deploymentId === "scope-1" ? first : second;
      });
    },
  };
  directory = Object.freeze(methods);
  return directory;
}

function fixedDirectoryPage(
  page: TaskComputeDeliveryTrustedDirectoryPage,
): TaskComputeDeliveryTrustedDirectoryShape {
  let directory: TaskComputeDeliveryTrustedDirectoryShape;
  const methods: TaskComputeDeliveryTrustedDirectoryShape = {
    singleCandidateDiscoverSettlementBudgetMilliseconds: 5,
    resolveSettlementBudgetMilliseconds: 5,
    discover(this: unknown) {
      return this === directory
        ? Effect.succeed(page)
        : Effect.die("directory receiver lost");
    },
    resolve() {
      return Effect.die("resolve must not be called for fixed page test");
    },
  };
  directory = Object.freeze(methods);
  return directory;
}

function candidateLocalTimeoutDirectory(
  order: string[],
): TaskComputeDeliveryTrustedDirectoryShape {
  const ready = readyItem("scope-2", SCOPE_2, order);
  let calls = 0;
  let directory: TaskComputeDeliveryTrustedDirectoryShape;
  const methods: TaskComputeDeliveryTrustedDirectoryShape = {
    singleCandidateDiscoverSettlementBudgetMilliseconds: 11,
    resolveSettlementBudgetMilliseconds: 11,
    discover(this: unknown) {
      if (this !== directory) return Effect.die("directory receiver lost");
      calls += 1;
      if (calls === 1) {
        return Effect.never.pipe(Effect.timeoutOrElse({
          duration: "10 millis",
          orElse: () => Effect.succeed(Object.freeze({
            items: Object.freeze([Object.freeze({
              kind: "failed" as const,
              deploymentId: "scope-1",
              scopeId: SCOPE_1,
              reason: "authority_unavailable" as const,
            })]),
            continuation: Object.freeze({
              codecVersion: 1 as const,
              highWaterScopeId: SCOPE_2,
              lastScopeId: SCOPE_1,
            }),
          })),
        }));
      }
      order.push("directory:scope-2");
      return Effect.succeed(Object.freeze({
        items: Object.freeze([ready]),
        continuation: null,
      }));
    },
    resolve() {
      return Effect.die("resolve must not be called in one invocation");
    },
  };
  directory = Object.freeze(methods);
  return directory;
}

function singleScopeDirectory(
  order: string[],
  options: Readonly<{
    readonly dispatchFailure?: TaskComputeDeliveryDiscoveryError<"dispatch">;
    readonly dispatchNever?: boolean;
    readonly dispatchPage?: TaskComputeDeliveryCandidatePage<"dispatch">;
    readonly dispatchEffect?: Effect.Effect<
      TaskComputeDeliveryCandidatePage<"dispatch">,
      TaskComputeDeliveryDiscoveryError<"dispatch">
    >;
  }> = {},
): TaskComputeDeliveryTrustedDirectoryShape {
  const item = readyItem("scope-1", SCOPE_1, order, options);
  let directory: TaskComputeDeliveryTrustedDirectoryShape;
  const methods: TaskComputeDeliveryTrustedDirectoryShape = {
    singleCandidateDiscoverSettlementBudgetMilliseconds: 5,
    resolveSettlementBudgetMilliseconds: 5,
    discover(this: unknown) {
      if (this !== directory) return Effect.die("directory receiver lost");
      return Effect.sync(() => {
        order.push("directory:scope-1");
        return Object.freeze({
          items: Object.freeze([item]),
          continuation: null,
        });
      });
    },
    resolve(this: unknown) {
      return this === directory
        ? Effect.succeed(item)
        : Effect.die("resolve receiver lost");
    },
  };
  directory = Object.freeze(methods);
  return directory;
}

function readyItem(
  deploymentId: string,
  scopeId: ReplacementScopeIdV1,
  order: string[],
  options: Readonly<{
    readonly dispatchFailure?: TaskComputeDeliveryDiscoveryError<"dispatch">;
    readonly dispatchNever?: boolean;
    readonly dispatchPage?: TaskComputeDeliveryCandidatePage<"dispatch">;
    readonly dispatchEffect?: Effect.Effect<
      TaskComputeDeliveryCandidatePage<"dispatch">,
      TaskComputeDeliveryDiscoveryError<"dispatch">
    >;
  }> = {},
): TaskComputeDeliveryTrustedDirectoryReadyItem {
  const discovery = discoveryFor(deploymentId, scopeId, order, options);
  return Object.freeze({
    kind: "ready",
    deploymentId,
    scopeId,
    discovery,
    repository: unusedRepository(),
  });
}

function discoveryFor(
  deploymentId: string,
  scopeId: ReplacementScopeIdV1,
  order: string[],
  options: Readonly<{
    readonly dispatchFailure?: TaskComputeDeliveryDiscoveryError<"dispatch">;
    readonly dispatchNever?: boolean;
    readonly dispatchPage?: TaskComputeDeliveryCandidatePage<"dispatch">;
    readonly dispatchEffect?: Effect.Effect<
      TaskComputeDeliveryCandidatePage<"dispatch">,
      TaskComputeDeliveryDiscoveryError<"dispatch">
    >;
  }>,
): TaskComputeDeliveryCandidateDiscovery {
  let discovery: TaskComputeDeliveryCandidateDiscovery;
  const methods: TaskComputeDeliveryCandidateDiscovery = {
    discoverDispatchCandidates(this: unknown) {
      if (this !== discovery) return Effect.die("dispatch discovery receiver lost");
      return Effect.suspend(() => {
      if (options.dispatchFailure !== undefined) {
        return Effect.fail(options.dispatchFailure);
      }
      if (options.dispatchEffect !== undefined) return options.dispatchEffect;
      if (options.dispatchNever === true) return Effect.never;
      order.push(`${deploymentId}:dispatch:discover`);
      return Effect.succeed(options.dispatchPage ?? candidatePage(
          "dispatch",
          candidate("dispatch", scopeId),
        ));
      });
    },
    discoverCancellationCandidates(this: unknown) {
      if (this !== discovery) {
        return Effect.die("cancellation discovery receiver lost");
      }
      return Effect.sync(() => {
      order.push(`${deploymentId}:cancellation:discover`);
      return candidatePage(
        "cancellation",
        candidate("cancellation", scopeId),
      );
      });
    },
  };
  discovery = Object.freeze(methods);
  return discovery;
}

function candidatePage<Operation extends TaskComputeDeliveryOperation>(
  operation: Operation,
  value: TaskComputeDeliveryCandidate<Operation>,
): TaskComputeDeliveryCandidatePage<Operation> {
  return Object.freeze({
    operation,
    databaseTimeBound: "2026-08-11T00:00:00.000Z",
    candidates: Object.freeze([value]),
    continuation: null,
  });
}

function candidate<Operation extends TaskComputeDeliveryOperation>(
  operation: Operation,
  scopeId: ReplacementScopeIdV1,
): TaskComputeDeliveryCandidate<Operation> {
  const suffix = scopeId === SCOPE_1 ? "1" : "2";
  return Object.freeze({
    operation,
    eligibleAt: "2026-08-11T00:00:00.000Z",
    runId: success(decodeRunId(
      `run_96000000-0000-4000-8000-00000000000${suffix}`,
    )),
    requestedEffectSequence: success(
      decodeTaskRequestedEffectSequenceV1(operation === "dispatch" ? "1" : "2"),
    ),
  });
}

function candidateAt<Operation extends TaskComputeDeliveryOperation>(
  operation: Operation,
  runSuffix: string,
  sequence: string,
): TaskComputeDeliveryCandidate<Operation> {
  return Object.freeze({
    operation,
    eligibleAt: "2026-08-11T00:00:00.000Z",
    runId: success(decodeRunId(
      `run_96000000-0000-4000-8000-00000000000${runSuffix}`,
    )),
    requestedEffectSequence: success(
      decodeTaskRequestedEffectSequenceV1(sequence),
    ),
  });
}

function continuingDispatchPage(
  _scopeId: ReplacementScopeIdV1,
): TaskComputeDeliveryCandidatePage<"dispatch"> {
  const value = candidateAt("dispatch", "1", "1");
  const highWater = candidateAt("dispatch", "2", "2");
  return Object.freeze({
    operation: "dispatch",
    databaseTimeBound: "2026-08-11T00:00:00.000Z",
    candidates: Object.freeze([value]),
    continuation: Object.freeze({
      codecVersion: 1,
      operation: "dispatch",
      databaseTimeBound: "2026-08-11T00:00:00.000Z",
      highWater: continuationPosition(highWater),
      last: continuationPosition(value),
    }),
  });
}

function continuationPosition(candidate: TaskComputeDeliveryCandidate) {
  return Object.freeze({
    eligibleAt: candidate.eligibleAt,
    runId: candidate.runId,
    requestedEffectSequence: String(candidate.requestedEffectSequence),
  });
}

function recordingCandidateRunner(
  order: string[],
  options: Readonly<{
    readonly dispatchFailure?: TaskComputeDeliveryCandidateRunnerInputError;
  }> = {},
): TaskComputeDeliveryCandidateRunnerShape {
  let runner: TaskComputeDeliveryCandidateRunnerShape;
  const methods: TaskComputeDeliveryCandidateRunnerShape = {
    runDispatch(this: unknown, _repository, value) {
      if (this !== runner) return Effect.die("dispatch runner receiver lost");
      return Effect.suspend(() => {
      order.push(`${deploymentFor(value)}:dispatch:run`);
      return options.dispatchFailure === undefined
        ? Effect.succeed(Object.freeze({
          kind: "dispatch_not_called" as const,
          acquisition: Object.freeze({
            kind: "busy" as const,
            claimExpiresAt: new Date("2026-08-11T00:01:00.000Z"),
          }),
        }))
        : Effect.fail(options.dispatchFailure);
      });
    },
    runCancellation(this: unknown, _repository, value) {
      if (this !== runner) {
        return Effect.die("cancellation runner receiver lost");
      }
      return Effect.sync(() => {
      order.push(`${deploymentFor(value)}:cancellation:run`);
      return Object.freeze({
        kind: "cancellation_not_called" as const,
        acquisition: Object.freeze({ kind: "waiting_dispatch" as const }),
      });
      });
    },
  };
  runner = Object.freeze(methods);
  return runner;
}

function deploymentFor(candidate: TaskComputeDeliveryCandidate): string {
  return candidate.runId.endsWith("1") ? "scope-1" : "scope-2";
}

function unusedRepository(): TaskComputeDeliveryRepositoryV1 {
  const unused = () => Effect.die("repository must not be called by test runner");
  return Object.freeze({
    acquireDispatch: unused,
    markDispatchDeliveryStarted: unused,
    renewDispatchClaim: unused,
    releaseDispatchBeforeDelivery: unused,
    recordDispatchAcceptance: unused,
    recordDispatchKnownFailure: unused,
    acquireCancellation: unused,
    markCancellationDeliveryStarted: unused,
    renewCancellationClaim: unused,
    releaseCancellationBeforeDelivery: unused,
    recordCancellationReceipt: unused,
    recordCancellationKnownFailure: unused,
  });
}

function policy(
  overrides: Partial<TaskComputeDeliveryConnectedRunnerOptions> = {},
): TaskComputeDeliveryConnectedRunnerOptions {
  return Object.freeze({
    maximumDirectoryPages: 10,
    maximumScopeVisits: 10,
    maximumDispatchPages: 10,
    maximumCancellationPages: 10,
    maximumDispatchCandidates: 10,
    maximumCancellationCandidates: 10,
    maximumDispatchProviderCalls: 10,
    maximumCancellationProviderCalls: 10,
    maximumTotalOperations: 20,
    maximumDispatchPagesPerScope: 1,
    maximumCancellationPagesPerScope: 1,
    candidatesPerPage: 1,
    maximumRunMilliseconds: 10_000,
    maximumOperationMilliseconds: 1_000,
    settlementReserveMilliseconds: 1_000,
    ...overrides,
  });
}

async function run(
  directory: TaskComputeDeliveryTrustedDirectoryShape,
  candidateRunner: TaskComputeDeliveryCandidateRunnerShape,
  options: TaskComputeDeliveryConnectedRunnerOptions,
  continuation: Parameters<TaskComputeDeliveryConnectedRunnerShape["run"]>[0],
) {
  const layer = makeTaskComputeDeliveryConnectedRunnerLayer(options).pipe(
    Layer.provide(dependencyLayer(directory, candidateRunner)),
  );
  return Effect.runPromise(Effect.gen(function* () {
    const runner = yield* TaskComputeDeliveryConnectedRunner;
    return yield* runner.run(continuation);
  }).pipe(Effect.provide(layer)));
}

async function runWithTestClock(
  directory: TaskComputeDeliveryTrustedDirectoryShape,
  candidateRunner: TaskComputeDeliveryCandidateRunnerShape,
  options: TaskComputeDeliveryConnectedRunnerOptions,
  continuation: Parameters<TaskComputeDeliveryConnectedRunnerShape["run"]>[0],
) {
  const layer = makeTaskComputeDeliveryConnectedRunnerLayer(options).pipe(
    Layer.provide(dependencyLayer(directory, candidateRunner)),
  );
  return Effect.runPromise(Effect.gen(function* () {
    const runner = yield* TaskComputeDeliveryConnectedRunner;
    const fiber = yield* runner.run(continuation).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    yield* TestClock.adjust("10 millis");
    return yield* Fiber.join(fiber);
  }).pipe(
    Effect.provide(layer),
    Effect.provide(TestClock.layer()),
  ));
}

function candidateDeployment(input: unknown): string {
  if (typeof input !== "object" || input === null) return "invalid";
  const descriptor = Object.getOwnPropertyDescriptor(input, "deploymentId");
  return descriptor !== undefined && "value" in descriptor
      && typeof descriptor.value === "string"
    ? descriptor.value
    : "invalid";
}

function dependencyLayer(
  directory: TaskComputeDeliveryTrustedDirectoryShape,
  candidateRunner: TaskComputeDeliveryCandidateRunnerShape,
) {
  return Layer.mergeAll(
    Layer.succeed(
      TaskComputeDeliveryTrustedDirectory,
      TaskComputeDeliveryTrustedDirectory.of(directory),
    ),
    Layer.succeed(
      TaskComputeDeliveryCandidateRunner,
      TaskComputeDeliveryCandidateRunner.of(candidateRunner),
    ),
  );
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  return Result.getOrThrow(result);
}

type IsExact<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

type Assert<Value extends true> = Value;
