import { Data, Effect, Exit } from "effect";
import type { PrivateProductAttemptExecution } from "@flarex/medusa-adapter/internal/product-attempt";
import type { CommerceTransactionError, Json } from "@flarex/persistence-postgres/internal/commerce-values";

class NativeProductOperationDiagnosticError extends Data.TaggedError("NativeProductOperationDiagnosticError")<{
  readonly phase: "synchronous" | "promise";
  readonly cause: unknown;
}> {}

/** Benchmark-only observer owner. Retain one diagnostic failure for the
 * series, await observation before teardown, and replay the native Exit. */
export function makeNativeProductOperationDiagnostics(observer: (method: string, args: Json,
  exit: Exit.Exit<PrivateProductAttemptExecution, CommerceTransactionError>, elapsedMs: number) => void | Promise<void>) {
  let firstFailure: NativeProductOperationDiagnosticError | undefined;
  function observeAndReplay(method: string, args: Json,
    exit: Exit.Exit<PrivateProductAttemptExecution, CommerceTransactionError>, elapsedMs: number
  ): Effect.Effect<PrivateProductAttemptExecution, CommerceTransactionError> {
    // Forwarding must not annotate the already-completed native Cause.
    return Effect.gen(function* () {
    yield* Effect.try({ try: () => observer(method, args, exit, elapsedMs),
      catch: cause => new NativeProductOperationDiagnosticError({ phase: "synchronous", cause }) }).pipe(
      Effect.flatMap(observation => observation === undefined ? Effect.void : Effect.tryPromise({
        try: () => observation,
        catch: cause => new NativeProductOperationDiagnosticError({ phase: "promise", cause }),
      })),
      Effect.match({ onFailure: failure => { firstFailure ??= failure; }, onSuccess: () => undefined }),
    );
    return yield* Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.failCause(exit.cause);
    });
  }
  return Object.freeze({ observeAndReplay, assertMeasurement() {
    if (firstFailure !== undefined) throw firstFailure;
  } });
}
