import {
  Cause,
  Effect,
  Exit,
  Result,
} from "effect";
import { captureExecutionDiagnosticContext } from "../../execution/diagnostics/operation";
import { LocatedReadCommittedTransactionFailureV1 } from "../../execution/readCommittedTransactionFailure";

export async function runPointCommitInTransactionEffect<Value, Failure>(
  effect: Effect.Effect<Value, Failure>,
  diagnosticContext?: ReturnType<typeof captureExecutionDiagnosticContext>,
): Promise<Result.Result<Value, Failure>> {
  const exit = await (diagnosticContext === undefined ? Effect.runPromiseExit(effect)
    : Effect.runPromiseExitWith(diagnosticContext)(effect));
  if (Exit.isSuccess(exit)) return Result.succeed(exit.value);
  const reason = exit.cause.reasons[0];
  if (exit.cause.reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason))
    return Result.fail(reason.error);
  throw exit.cause;
}

export function runPointCommitPromiseEffect<Value, Failure>(
  work: (diagnosticContext: ReturnType<typeof captureExecutionDiagnosticContext>) => PromiseLike<Value>,
  mapFailure: (cause: unknown) => Failure,
): Effect.Effect<Value, Failure> {
  return Effect.withFiber(fiber => Effect.tryPromise({
    try: () => work(captureExecutionDiagnosticContext(fiber)),
    catch: cause => {
      const callback = cause instanceof LocatedReadCommittedTransactionFailureV1 && cause.issue.kind === "callbackRolledBack"
        ? cause.issue.callbackCause : cause;
      return Cause.isCause(callback) ? callback : cause;
    },
  }).pipe(
    Effect.catchIf(Cause.isCause,
      cause => Effect.failCause(Cause.map(cause, mapFailure)),
      cause => Effect.failSync(() => mapFailure(cause))),
  ));
}

export function projectPointCommitTransactionResult<A, E>(
  result: Result.Result<A, E>,
): A {
  // oxlint-disable-next-line flarex/no-result-get-or-throw-without-boundary -- REVIEW: compatibility - located native Drizzle transaction callbacks require rejection with the exact typed failure; CMS maps this same Promise kernel at its participant boundary
  return Result.getOrThrow(result);
}
