import {
  defineModule,
  sourceModule,
  task,
  type TaskReference,
  v,
} from "@flarex/application-definition";
import { inspectTaskRun } from
  "@flarex/application-invocation/internal/task-run";
import { inspectTaskReference } from
  "@flarex/application-definition/internal/task-definition";
import {
  type StandardApplicationTaskRunCreationReceipt,
  type StandardApplicationTaskSystemApi,
  StandardApplicationTaskSystem,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-system";
import {
  StandardApplicationTaskRunQuery,
  type StandardApplicationTaskRunQueryApi,
  type StandardApplicationTaskRunStatus,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-run-query";
import { Brand, Cause, Effect, Exit, Result } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  inspectTask,
  startTask,
  type TaskRun,
  type TaskRunStatus,
} from "../src/index.js";

const tasksModule = defineModule({
  path: "tasks/cooking",
  source: sourceModule({
    path: "functions/tasks/cooking.js",
    bytes: new TextEncoder().encode("export const prepare = 1;\n"),
  }),
  functions: {},
});
const prepare = Result.getOrThrow(task({
  id: "cooking.prepare",
  handler: { module: tasksModule, exportName: "prepare" },
  payload: v.object({ recipeId: v.string(), servings: v.number() }),
  returns: v.object({ prepared: v.boolean() }),
  attempts: {
    retry: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 60_000,
      randomize: true,
    },
    outOfMemory: { kind: "disabled" },
  },
  maximumDurationInSeconds: 30,
  compute: "standard-1x",
  queue: { kind: "default" },
}));

describe("clean Task invocation primitive", () => {
  it("admits a typed payload through the existing Task System", async () => {
    const receipt = makeReceipt();
    const createRun = vi.fn<StandardApplicationTaskSystemApi["createRun"]>(
      () => Effect.succeed(receipt),
    );
    const system = StandardApplicationTaskSystem.of({ createRun });
    const requestKey = Brand.nominal<
      Parameters<StandardApplicationTaskSystemApi["createRun"]>[1]["requestKey"]
    >()("task-request-1");
    const identity = Object.freeze({
      kind: "user" as const,
      user: Object.freeze({
        tokenIdentifier: "clean-task-test",
        subject: "user-1",
        issuer: "https://system-test.flarex.invalid",
      }),
    });

    const run = await Effect.runPromise(startTask(
      prepare.reference,
      { recipeId: "recipe-1", servings: 4 },
      { requestKey, identity },
    ).pipe(Effect.provideService(StandardApplicationTaskSystem, system)));

    expect(run).toEqual({ runId: receipt.runId });
    expect(Object.isFrozen(run)).toBe(true);
    expect(inspectTaskRun(run).receipt).toBe(receipt);
    expect(inspectTaskRun(run).standardReference).toBe(
      inspectTaskReference(prepare.reference).standard,
    );
    expect(Object.isFrozen(inspectTaskRun(run))).toBe(true);
    expect(createRun).toHaveBeenCalledWith(
      expect.any(Object),
      {
        version: 1,
        requestKey,
        payload: { recipeId: "recipe-1", servings: 4 },
        executionIdentity: identity,
      },
    );
    expectTypeOf(run).toEqualTypeOf<TaskRun<
      Readonly<{ readonly prepared: boolean }>
    >>();
  });

  it("rejects a forged run at the private metadata bridge", () => {
    const forged = Object.freeze({
      runId: makeReceipt().runId,
    }) as TaskRun<unknown>;

    expect(() => inspectTaskRun(forged)).toThrow(
      "Task run metadata is unavailable.",
    );
  });

  it("reads a genuine run through the authoritative Task query service", async () => {
    const receipt = makeReceipt();
    const createRun = vi.fn<StandardApplicationTaskSystemApi["createRun"]>(
      () => Effect.succeed(receipt),
    );
    const system = StandardApplicationTaskSystem.of({ createRun });
    const run = await startRun(system);
    const expected = makeStatus(receipt);
    const inspect = vi.fn<StandardApplicationTaskRunQueryApi["inspect"]>(
      () => Effect.succeed(expected),
    );
    const status = await Effect.runPromise(inspectTask(run).pipe(
      Effect.provideService(
        StandardApplicationTaskRunQuery,
        StandardApplicationTaskRunQuery.of({ inspect }),
      ),
    ));

    expect(status).toBe(expected);
    expect(inspect).toHaveBeenCalledOnce();
    expect(inspect).toHaveBeenCalledWith(receipt.runId);
    expectTypeOf(status).toEqualTypeOf<TaskRunStatus>();
  });

  it("defects on a forged handle before query I/O", async () => {
    const receipt = makeReceipt();
    const forged = Object.freeze({ runId: receipt.runId }) as TaskRun<unknown>;
    const forbiddenInspect = vi.fn<
      StandardApplicationTaskRunQueryApi["inspect"]
    >(
      () => Effect.succeed(makeStatus(receipt)),
    );
    const forgedExit = await Effect.runPromise(Effect.exit(inspectTask(forged)
      .pipe(Effect.provideService(
        StandardApplicationTaskRunQuery,
        StandardApplicationTaskRunQuery.of({ inspect: forbiddenInspect }),
      ))));
    expect(Exit.isFailure(forgedExit)).toBe(true);
    if (Exit.isFailure(forgedExit)) {
      const defect = Cause.findDefect(forgedExit.cause);
      expect(Result.isSuccess(defect)).toBe(true);
      if (Result.isSuccess(defect)) {
        expect(defect.success).toBeInstanceOf(TypeError);
        if (defect.success instanceof TypeError) {
          expect(defect.success.message).toBe(
            "Task run metadata is unavailable.",
          );
        }
      }
    }
    expect(forbiddenInspect).not.toHaveBeenCalled();
  });
});

async function startRun(
  system: StandardApplicationTaskSystemApi,
): Promise<TaskRun<Readonly<{ readonly prepared: boolean }>>> {
  const requestKey = Brand.nominal<
    Parameters<StandardApplicationTaskSystemApi["createRun"]>[1]["requestKey"]
  >()("task-inspection-request");
  return Effect.runPromise(startTask(
    prepare.reference,
    { recipeId: "recipe-inspection", servings: 2 },
    {
      requestKey,
      identity: Object.freeze({
        kind: "user" as const,
        user: Object.freeze({
          tokenIdentifier: "clean-task-inspection",
          subject: "user-inspection",
          issuer: "https://system-test.flarex.invalid",
        }),
      }),
    },
  ).pipe(Effect.provideService(StandardApplicationTaskSystem,
    StandardApplicationTaskSystem.of(system))));
}

function makeStatus(
  receipt: StandardApplicationTaskRunCreationReceipt,
): StandardApplicationTaskRunStatus {
  const runVersion = Brand.nominal<
    StandardApplicationTaskRunStatus["runVersion"]
  >();
  return Object.freeze({
    runId: receipt.runId,
    createdAtMs: receipt.createdAtMs,
    observedAtMs: receipt.createdAtMs,
    runVersion: runVersion(1n),
    state: Object.freeze({
      kind: "ready" as const,
      eligibleAtMs: receipt.createdAtMs,
      retry: null,
      cancellation: Object.freeze({ kind: "not_requested" as const }),
    }),
  });
}

function makeReceipt(): StandardApplicationTaskRunCreationReceipt {
  const runId = Brand.nominal<StandardApplicationTaskRunCreationReceipt["runId"]>();
  const runtimeTarget = Brand.nominal<
    StandardApplicationTaskRunCreationReceipt[
      "applicationTaskRuntimeTargetSha256"
    ]
  >();
  const databaseTime = Brand.nominal<
    StandardApplicationTaskRunCreationReceipt["createdAtMs"]
  >();
  const requestKeySha256 = Brand.nominal<
    StandardApplicationTaskRunCreationReceipt["requestKeySha256"]
  >();
  const requestSha256 = Brand.nominal<
    StandardApplicationTaskRunCreationReceipt["requestSha256"]
  >();
  const authoritySha256 = Brand.nominal<
    StandardApplicationTaskRunCreationReceipt["creationAuthoritySha256"]
  >();
  return Object.freeze({
    status: "created",
    version: 1,
    runId: runId("run-clean-task-1"),
    applicationTaskRuntimeTargetSha256: runtimeTarget(new Uint8Array(32)),
    createdAtMs: databaseTime(1_000),
    requestKeySha256: requestKeySha256(new Uint8Array(32).fill(1)),
    requestSha256: requestSha256(new Uint8Array(32).fill(2)),
    creationAuthoritySha256: authoritySha256(new Uint8Array(32).fill(3)),
  });
}

function compileTimeContractChecks(): void {
  // @ts-expect-error Task payload references are invariant and cannot be widened.
  const widened: TaskReference<
    Readonly<{ readonly recipeId: string }>,
    Readonly<{ readonly prepared: boolean }>
  > = prepare.reference;
  void widened;
}

void compileTimeContractChecks;
