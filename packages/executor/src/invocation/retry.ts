import {
  InvokeSessionIndexOccConflictError,
  InvokeSessionOccConflictError,
  InvokeSessionTableOccConflictError,
} from "@flarex/persistence-postgres";
import { Data, Effect, Exit } from "effect";

import type { AppDataEngineRegistry } from "./appDataEngines";
import {
  InvokeRetryExhaustedError,
  InvokeRetryPolicyError,
} from "./errors";
import {
  invokeSessionFailureCause,
  invokeSyscall,
  type BeginInvokeSessionEffectError,
  type FinishInvokeSessionEffectError,
  type InvokeSessionOperations,
  runInvokeSessionPromise,
} from "./sessions";
import type {
  FlarexExecutorControlPersistence,
  RunMutationInvokeWithRetriesInput,
  RunMutationInvokeWithRetriesResult,
  RunQueryInvokeWithRetriesInput,
  RunQueryInvokeWithRetriesResult,
  RunInvokeWithRetriesInput,
  RunInvokeWithRetriesResult,
} from "./types";

const DEFAULT_MAX_ATTEMPTS = 8;

export class InvokeAttemptForeignError extends Data.TaggedError(
  "InvokeAttemptForeignError",
)<{
  readonly cause: unknown;
}> {}

export type RunInvokeWithRetriesEffectError =
  | BeginInvokeSessionEffectError
  | FinishInvokeSessionEffectError
  | InvokeAttemptForeignError
  | InvokeRetryExhaustedError
  | InvokeRetryPolicyError;

export function runInvokeWithRetriesEffect(
  persistence: FlarexExecutorControlPersistence,
  appDataEngines: AppDataEngineRegistry,
  sessionOperations: InvokeSessionOperations,
  input: RunQueryInvokeWithRetriesInput,
): Effect.Effect<
  RunQueryInvokeWithRetriesResult,
  RunInvokeWithRetriesEffectError
>;
export function runInvokeWithRetriesEffect(
  persistence: FlarexExecutorControlPersistence,
  appDataEngines: AppDataEngineRegistry,
  sessionOperations: InvokeSessionOperations,
  input: RunMutationInvokeWithRetriesInput,
): Effect.Effect<
  RunMutationInvokeWithRetriesResult,
  RunInvokeWithRetriesEffectError
>;
export function runInvokeWithRetriesEffect(
  persistence: FlarexExecutorControlPersistence,
  appDataEngines: AppDataEngineRegistry,
  sessionOperations: InvokeSessionOperations,
  input: RunInvokeWithRetriesInput,
): Effect.Effect<RunInvokeWithRetriesResult, RunInvokeWithRetriesEffectError>;
export function runInvokeWithRetriesEffect(
  persistence: FlarexExecutorControlPersistence,
  appDataEngines: AppDataEngineRegistry,
  sessionOperations: InvokeSessionOperations,
  input: RunInvokeWithRetriesInput,
): Effect.Effect<RunInvokeWithRetriesResult, RunInvokeWithRetriesEffectError> {
  return runInvokeWithRetriesOperation(
    persistence,
    appDataEngines,
    sessionOperations,
    input,
  );
}

export function runInvokeWithRetriesPromise<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  return runInvokeSessionPromise(
    effect.pipe(Effect.mapError((error) =>
      error instanceof InvokeAttemptForeignError ? error.cause : error
    )),
  );
}

const runInvokeWithRetriesOperation = Effect.fn(
  "Executor.invokeSession.runWithRetries",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  appDataEngines: AppDataEngineRegistry,
  sessionOperations: InvokeSessionOperations,
  input: RunInvokeWithRetriesInput,
): Effect.fn.Return<
  RunInvokeWithRetriesResult,
  RunInvokeWithRetriesEffectError
> {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isFinite(maxAttempts) ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts <= 0
  ) {
    return yield* Effect.fail(
      new InvokeRetryPolicyError("maxAttempts must be a positive integer."),
    );
  }

  const runAttempt = (
    attempt: number,
  ): Effect.Effect<
    RunInvokeWithRetriesResult,
    RunInvokeWithRetriesEffectError
  > => Effect.gen(function* () {
    const session = yield* sessionOperations.begin(input);
    const postBegin = Effect.gen(function* () {
      const value = yield* Effect.tryPromise({
        try: () => input.runAttempt({
          attempt,
          maxAttempts,
          session,
          syscall: (syscall) => invokeSyscall(persistence, appDataEngines, {
            deploymentId: input.deploymentId,
            projectId: input.projectId,
            sessionId: session.sessionId,
            syscall,
          }),
        }),
        catch: (cause) => new InvokeAttemptForeignError({ cause }),
      });
      const finished = yield* sessionOperations.finish({
        deploymentId: input.deploymentId,
        projectId: input.projectId,
        sessionId: session.sessionId,
        value,
      });
      return {
        ...finished,
        attempts: attempt,
        beginTs: session.beginTs,
      };
    }).pipe(
      Effect.onExit((exit) => Exit.isFailure(exit)
        ? settleBestEffortAbort(sessionOperations.abort({
          deploymentId: input.deploymentId,
          projectId: input.projectId,
          sessionId: session.sessionId,
        }))
        : Effect.void),
    );

    return yield* Effect.matchEffect(postBegin, {
      onFailure: (error) => {
        const authoritativeError = error instanceof InvokeAttemptForeignError
          ? error.cause
          : invokeSessionFailureCause(error);
        if (
          session.function.kind === "mutation" &&
          isRetryableInvokeError(authoritativeError)
        ) {
          return attempt < maxAttempts
            ? Effect.suspend(() => runAttempt(attempt + 1))
            : Effect.fail(
              new InvokeRetryExhaustedError(maxAttempts, authoritativeError),
            );
        }
        return Effect.fail(error);
      },
      onSuccess: Effect.succeed,
    });
  });

  return yield* runAttempt(1);
});

function settleBestEffortAbort<A, E>(
  abort: Effect.Effect<A, E>,
): Effect.Effect<void> {
  // The retry contract suppresses only the abort operation's typed failure.
  // Effect.result leaves interruption and defects in the Cause channel.
  return Effect.result(abort).pipe(Effect.asVoid);
}

export function isRetryableInvokeError(error: unknown): boolean {
  if (
    error instanceof InvokeSessionOccConflictError ||
    error instanceof InvokeSessionTableOccConflictError ||
    error instanceof InvokeSessionIndexOccConflictError
  ) {
    return true;
  }

  const record = asErrorRecord(error);
  if (record === null) {
    return false;
  }
  return (
    record.name === "InvokeSessionOccConflictError" ||
    record.name === "InvokeSessionTableOccConflictError" ||
    record.name === "InvokeSessionIndexOccConflictError" ||
    record.code === "40001"
  );
}

function asErrorRecord(
  error: unknown,
): { name?: unknown; code?: unknown } | null {
  // SAFETY: the guard below proves the value is a non-null object; the
  // cast only declares the optional diagnostic fields read by callers.
  return typeof error === "object" && error !== null
    ? (error as { name?: unknown; code?: unknown })
    : null;
}
