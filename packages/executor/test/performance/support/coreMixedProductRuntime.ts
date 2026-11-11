import { Cause, Clock, Context, Data, Effect, Exit, Option } from "effect";
import { executePointMutationV1 } from "../../../../function-runtime/src/pointMutation";
import { createFunctionRuntimeAuthV1 } from "../../../../function-runtime/src/functionApiCore";
import { CoreApplicationMutationError } from "../../../../persistence-postgres/src/application/coreMutation";
import type { CoreNativeApplicationMutationConfiguration } from "../../../../persistence-postgres/src/application/coreNativeMutation";
import type { CoreTransaction } from "../../../../persistence-postgres/src/core/api";
import { captureExecutionDiagnosticContext } from "../../../../persistence-postgres/src/execution/diagnostics/operation";
import type { CommerceTransactionError } from "../../../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { makeCoreApplicationReadSession } from "../../../../standard-application-invocation/src/CoreApplicationReadSession";
import { decodeAdmittedFrameworkOperationV1Result, type AdmittedFrameworkOperationV1 } from "flarex-protocol/internal/admitted-framework-operation-v1";
import { inspectVerifiedApplicationMutationGrantV1 } from "flarex-protocol/internal/application-mutation-grant-v1";
import { captureDocumentValueWithSize } from "flarex-protocol/document-value";
import type { Json } from "flarex-protocol/json";
import type { QueryCursorBroker } from "flarex-protocol/query-cursor";
import { isCanonicalFlarexRuntimeObjectV1 } from "flarex-protocol/value";

export class CoreMixedProductRuntimeError extends Data.TaggedError("CoreMixedProductRuntimeError")<{
  readonly cause: unknown;
}> {}

type RuntimeInput = Parameters<CoreNativeApplicationMutationConfiguration<never, never>["open"]>[0] & Readonly<{
  transaction: Pick<CoreTransaction, "unixTime" | "tableNumber" | "get" | "startQuery" | "insert" | "patch" | "replace" | "delete">;
  native: (request: AdmittedFrameworkOperationV1) => Effect.Effect<Json, CommerceTransactionError>;
  handler: unknown;
  queryCursor: QueryCursorBroker;
}>;

/** Trusted authored benchmark code uses the real portable mutation kernel and
 * callback drain. This host supplies no Worker isolation or deterministic globals.
 * Core still owns every operation, authority check, request and durable outcome. */
export const executeCoreMixedProduct = Effect.fn("CoreMixedProductRuntime.execute")(function* (input: RuntimeInput) {
  const target = input.program.runtimeTarget.function;
  const grant = inspectVerifiedApplicationMutationGrantV1(input.grant).payload;
  if (grant.auth.kind !== "anonymous" || target.args.type !== "any" || target.returns !== null
    || target.visibility !== "public" || typeof input.handler !== "function" || !isCanonicalFlarexRuntimeObjectV1(input.arguments))
    return yield* new CoreApplicationMutationError({ reason: "unsupportedSelection" });
  const callbackContext = yield* Effect.withFiber(fiber => Effect.succeed(Context.add(
    captureExecutionDiagnosticContext(fiber), Clock.Clock, Context.get(fiber.context, Clock.Clock),
  )));
  const session = makeCoreApplicationReadSession<Effect.Error<typeof input.revalidate>, CommerceTransactionError | CoreApplicationMutationError>(input,
    callbackContext, input.queryCursor, { maxPendingCallbacks: 32, maxOpenQueries: 1 });
  const context = Object.freeze({ auth: createFunctionRuntimeAuthV1({ kind: "anonymous" }),
    db: Object.freeze({
      get: (id: string) => session.run(() => input.transaction.get(id).pipe(Effect.map(Option.getOrNull))),
      insert: (table: string, value: unknown) => session.run(() => input.transaction.insert(table, value)),
      patch: (id: string, value: unknown) => session.run(() => input.transaction.patch(id, value)),
      replace: (id: string, value: unknown) => session.run(() => input.transaction.replace(id, value)),
      delete: (id: string) => session.run(() => input.transaction.delete(id)),
    }),
    privateMixed: Object.freeze({ call: (participant: string, operation: string, args: unknown) => session.run(() => Effect.gen(function* () {
      const request = yield* Effect.fromResult(decodeAdmittedFrameworkOperationV1Result({
        format: "flarex.admitted-framework-operation", version: 1, participant, operation, args,
      })).pipe(Effect.mapError(cause => new CoreApplicationMutationError({ reason: "argumentsInvalid", cause })));
      return yield* input.native(request);
    })) }),
  });
  const execution = () => executePointMutationV1({ function: { path: target.path, kind: "mutation", visibility: "public",
    argsValidator: { type: "any" }, returnsValidator: null }, arguments: input.arguments, tables: input.tables },
  { resolve: path => path === target.path ? { isMutation: true, isPublic: true, _handler: input.handler } : undefined },
  { open: () => ({ context, isCoreApplicationError: () => false,
    journal: { close: () => undefined, drain: () => Effect.runPromiseWith(callbackContext)(session.closeAndDrain) } }) });
  return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    // The foreign host edge owns its complete Promise, including late callbacks.
    // Join it before the root can release resources, even if interrupted.
    const pending = execution();
    const foreign = Effect.tryPromise({ try: () => pending, catch: cause => new CoreMixedProductRuntimeError({ cause }) });
    const completed = yield* Effect.exit(restore(foreign).pipe(Effect.onInterrupt(() => Effect.promise(() => pending.then(
      () => undefined, () => undefined,
    )))));
    const drained = yield* Effect.exit(session.closeAndDrain);
    if (Exit.isFailure(drained)) return yield* Effect.failCause(Exit.isFailure(completed)
      ? Cause.combine(completed.cause, drained.cause) : drained.cause);
    if (Exit.isFailure(completed)) return yield* Effect.failCause(completed.cause);
    return (yield* Effect.fromResult(captureDocumentValueWithSize(completed.value)).pipe(
      Effect.mapError(cause => new CoreMixedProductRuntimeError({ cause })))).value;
  }));
});
