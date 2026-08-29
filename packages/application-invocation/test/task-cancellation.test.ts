import {
  defineModule,
  sourceModule,
  task,
  v,
} from "@flarex/application-definition";
import {
  type StandardApplicationTaskCancellationApi,
  type StandardApplicationTaskCancellationError,
  type StandardApplicationTaskCancellationReceipt,
  StandardApplicationTaskCancellation,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-cancellation";
import {
  type StandardApplicationTaskRunCreationReceipt,
  type StandardApplicationTaskSystemApi,
  StandardApplicationTaskSystem,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-system";
import { Brand, Cause, Data, Effect, Exit, Result } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  cancelTask,
  startTask,
  type CancelTaskOptionsError,
  type CancelTaskResult,
  type TaskRun,
} from "../src/index.js";

const tasksModule = defineModule({
  path: "tasks/cancellation",
  source: sourceModule({
    path: "functions/tasks/cancellation.js",
    bytes: new TextEncoder().encode("export const work = 1;\n"),
  }),
  functions: {},
});
const work = Result.getOrThrow(task({
  id: "cancellation.work",
  handler: { module: tasksModule, exportName: "work" },
  payload: v.object({ workId: v.string() }),
  returns: v.null(),
  attempts: {
    retry: {
      maxAttempts: 1,
      factor: 1,
      minTimeoutInMs: 0,
      maxTimeoutInMs: 0,
      randomize: false,
    },
    outOfMemory: { kind: "disabled" },
  },
  maximumDurationInSeconds: 30,
  compute: "standard-1x",
  queue: { kind: "default" },
}));

class CancellationUnavailableFailure extends Data.TaggedError(
  "TaskSystemRunAttemptUnavailableError",
)<{
  readonly operation: "request_cancellation";
  readonly runId: CancelTaskResult["runId"];
  readonly reason: "unavailable";
}> {}

describe("clean Task cancellation primitive", () => {
  it("authenticates a run and requests cancellation without a message", async () => {
    const run = await startRun();
    const receipt = cancellationRequestedReceipt("accepted");
    const request = vi.fn<StandardApplicationTaskCancellationApi["request"]>(
      () => Effect.succeed(receipt),
    );

    const result = await Effect.runPromise(cancelTask(run).pipe(
      Effect.provideService(
        StandardApplicationTaskCancellation,
        StandardApplicationTaskCancellation.of({ request }),
      ),
    ));

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(run.runId, {
      code: "requested",
      message: null,
    });
    expect(result).toEqual({
      runId: run.runId,
      observedAtMs: receipt.observedAtMs,
      runVersion: receipt.runVersion,
      status: "cancellationRequested",
      replayed: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expectTypeOf(result).toEqualTypeOf<CancelTaskResult>();
  });

  it("accepts an exact safe reason and projects an idempotent terminal replay", async () => {
    const run = await startRun();
    const receipt = terminalCancelledReceipt("idempotent");
    const request = vi.fn<StandardApplicationTaskCancellationApi["request"]>(
      () => Effect.succeed(receipt),
    );

    const result = await Effect.runPromise(cancelTask(run, {
      reason: "The user closed the workspace",
    }).pipe(Effect.provideService(
      StandardApplicationTaskCancellation,
      StandardApplicationTaskCancellation.of({ request }),
    )));

    expect(request).toHaveBeenCalledWith(run.runId, {
      code: "requested",
      message: "The user closed the workspace",
    });
    expect(result.status).toBe("cancelled");
    expect(result.replayed).toBe(true);
  });

  it("projects already-requested and already-terminal observations", async () => {
    const run = await startRun();
    const receipts = [
      currentReceipt(run.runId, "already_requested"),
      currentReceipt(run.runId, "already_terminal"),
    ] as const;
    let call = 0;
    const request = vi.fn<StandardApplicationTaskCancellationApi["request"]>(
      () => Effect.succeed(receipts[call++] ?? receipts[1]),
    );
    const service = StandardApplicationTaskCancellation.of({ request });

    const alreadyRequested = await Effect.runPromise(cancelTask(run).pipe(
      Effect.provideService(StandardApplicationTaskCancellation, service),
    ));
    const alreadyTerminal = await Effect.runPromise(cancelTask(run).pipe(
      Effect.provideService(StandardApplicationTaskCancellation, service),
    ));

    expect(alreadyRequested).toMatchObject({
      status: "alreadyRequested",
      replayed: false,
    });
    expect(alreadyTerminal).toMatchObject({
      status: "alreadyTerminal",
      replayed: false,
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["empty", ""],
    ["control character", "stop\u0000now"],
    ["oversized UTF-8", "x".repeat(1_025)],
  ])("rejects an %s reason before command I/O", async (_label, reason) => {
    const run = await startRun();
    const request = vi.fn<StandardApplicationTaskCancellationApi["request"]>(
      () => Effect.die("must not request cancellation"),
    );

    const failure = await Effect.runPromise(Effect.flip(cancelTask(run, {
      reason,
    }).pipe(Effect.provideService(
      StandardApplicationTaskCancellation,
      StandardApplicationTaskCancellation.of({ request }),
    ))));

    expect(failure).toMatchObject({
      _tag: "CancelTaskOptionsError",
      field: "reason",
      reason: "invalid_message",
    });
    if (failure._tag === "CancelTaskOptionsError") {
      expectTypeOf(failure).toEqualTypeOf<CancelTaskOptionsError>();
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("preserves a Standard command failure by identity without retry", async () => {
    const run = await startRun();
    const failure: StandardApplicationTaskCancellationError =
      new CancellationUnavailableFailure({
        operation: "request_cancellation",
        runId: run.runId,
        reason: "unavailable",
      });
    const request = vi.fn<StandardApplicationTaskCancellationApi["request"]>(
      () => Effect.fail(failure),
    );

    const received = await Effect.runPromise(Effect.flip(cancelTask(run).pipe(
      Effect.provideService(
        StandardApplicationTaskCancellation,
        StandardApplicationTaskCancellation.of({ request }),
      ),
    )));

    expect(received).toBe(failure);
    expect(request).toHaveBeenCalledOnce();
  });

  it("defects on a forged handle before options or command I/O", async () => {
    const forged = Object.freeze({ runId: makeCreationReceipt().runId }) as
      TaskRun<unknown>;
    const request = vi.fn<StandardApplicationTaskCancellationApi["request"]>(
      () => Effect.die("must not request cancellation"),
    );

    const exit = await Effect.runPromise(Effect.exit(cancelTask(forged, {
      reason: "",
    }).pipe(Effect.provideService(
      StandardApplicationTaskCancellation,
      StandardApplicationTaskCancellation.of({ request }),
    ))));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const defect = Cause.findDefect(exit.cause);
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
    expect(request).not.toHaveBeenCalled();
  });
});

async function startRun(): Promise<TaskRun<null>> {
  const receipt = makeCreationReceipt();
  const system = StandardApplicationTaskSystem.of({
    createRun: () => Effect.succeed(receipt),
  });
  const requestKey = Brand.nominal<
    Parameters<StandardApplicationTaskSystemApi["createRun"]>[1]["requestKey"]
  >()("task-cancellation-request");
  return Effect.runPromise(startTask(
    work.reference,
    { workId: "work-1" },
    {
      requestKey,
      identity: Object.freeze({
        kind: "user" as const,
        user: Object.freeze({
          tokenIdentifier: "clean-task-cancellation",
          subject: "user-cancellation",
          issuer: "https://system-test.flarex.invalid",
        }),
      }),
    },
  ).pipe(Effect.provideService(StandardApplicationTaskSystem, system)));
}

function makeCreationReceipt(): StandardApplicationTaskRunCreationReceipt {
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
    runId: runId("run_00000000-0000-4000-8000-000000000072"),
    applicationTaskRuntimeTargetSha256: runtimeTarget(
      new Uint8Array(32).fill(0x72),
    ),
    createdAtMs: databaseTime(1_000),
    requestKeySha256: requestKeySha256(new Uint8Array(32).fill(1)),
    requestSha256: requestSha256(new Uint8Array(32).fill(2)),
    creationAuthoritySha256: authoritySha256(new Uint8Array(32).fill(3)),
  });
}

type CancellationOutcome = StandardApplicationTaskCancellationReceipt["outcome"];
type CancellationRequestedOutcome = Extract<
  CancellationOutcome,
  { readonly kind: "cancellation_requested" }
>;

function cancellationRequestedReceipt(
  disposition: "accepted" | "idempotent",
): StandardApplicationTaskCancellationReceipt {
  const attemptId = Brand.nominal<
    CancellationRequestedOutcome["attempt"]["attemptId"]
  >();
  const attemptNumber = Brand.nominal<
    CancellationRequestedOutcome["attempt"]["attemptNumber"]
  >();
  const executionFence = Brand.nominal<
    CancellationRequestedOutcome["attempt"]["executionFence"]
  >();
  const generation = Brand.nominal<
    CancellationRequestedOutcome["cancellation"]["generation"]
  >();
  const databaseTime = Brand.nominal<
    StandardApplicationTaskCancellationReceipt["observedAtMs"]
  >();
  const runVersion = Brand.nominal<
    StandardApplicationTaskCancellationReceipt["runVersion"]
  >();
  return Object.freeze({
    disposition,
    observedAtMs: databaseTime(2_000),
    runVersion: runVersion(2n),
    outcome: Object.freeze({
      kind: "cancellation_requested",
      attempt: Object.freeze({
        attemptId: attemptId("attempt_00000000-0000-4000-8000-000000000072"),
        attemptNumber: attemptNumber(1),
        executionFence: executionFence(1n),
      }),
      cancellation: Object.freeze({
        kind: "requested",
        generation: generation(1n),
        reason: Object.freeze({ code: "requested", message: null }),
        requestedAtMs: databaseTime(2_000),
      }),
    }),
    evidence: Object.freeze([]),
    requestedEffects: Object.freeze([]),
  });
}

function terminalCancelledReceipt(
  disposition: "accepted" | "idempotent",
): StandardApplicationTaskCancellationReceipt {
  const requested = cancellationRequestedReceipt(disposition);
  const generation = Brand.nominal<
    Extract<CancellationOutcome, { readonly kind: "terminal_cancelled" }>[
      "terminal"
    ]["cancellationGeneration"]
  >();
  return Object.freeze({
    ...requested,
    outcome: Object.freeze({
      kind: "terminal_cancelled",
      terminal: Object.freeze({
        kind: "cancelled",
        completedAtMs: requested.observedAtMs,
        attempt: null,
        cancellationGeneration: generation(1n),
        reason: Object.freeze({ code: "requested", message: null }),
        resolution: "without_active_attempt",
        executionDurationMs: null,
      }),
    }),
  });
}

function currentReceipt(
  runId: CancelTaskResult["runId"],
  reason: "already_requested" | "already_terminal",
): StandardApplicationTaskCancellationReceipt {
  const requested = cancellationRequestedReceipt("accepted");
  const currentOutcome: Extract<
    CancellationOutcome,
    { readonly kind: "current" }
  > = {
    kind: "current",
    reason,
    state: {
      version: "flarex.run-attempt-state.v1",
      runId,
      applicationTaskRuntimeTargetSha256:
        makeCreationReceipt().applicationTaskRuntimeTargetSha256,
      runVersion: requested.runVersion,
      phase: "ready",
      ready: { kind: "initial", eligibleAtMs: requested.observedAtMs },
      cancellation: {
        kind: "not_requested",
        generation: Brand.nominal<
          Extract<
            Extract<CancellationOutcome, { readonly kind: "current" }>["state"],
            { readonly phase: "ready" }
          >["cancellation"]["generation"]
        >()(0n),
      },
    },
  };
  return Object.freeze({
    ...requested,
    disposition: "current",
    outcome: Object.freeze(currentOutcome),
  });
}
