import { Cause, Effect, Exit, Result } from "effect";
import type { Json } from "flarex-protocol/json";
import type { BoundedRequestContext, BoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";
import { getCommerceCommand, type CommerceCommand, type CommerceCommandContext } from "./commands";
import { commerceError, type CommerceTransactionError } from "./model";
import type { CommerceStore } from "./storeModel";
import type { CommerceResources } from "./resources";
import { makeCommerceOperations, type CommerceOperations } from "./operations";
import { captureCommerceJsonData } from "./request";
import type { CommerceSetNullSelection, CommerceReferenceReplacement, CommerceDeletedReferenceSelection } from "./commands";

type CommerceContextWorking = Readonly<{ store: CommerceStore; resources: CommerceResources;
    table: (context: BoundedRequestContext, tableId: string) => Effect.Effect<CommerceStore, CommerceTransactionError>;
    transactionTime?: (context: BoundedRequestContext) => Effect.Effect<string, CommerceTransactionError>;
    detachDeletedReference?: (context: BoundedRequestContext, selection: CommerceDeletedReferenceSelection) => Effect.Effect<void, CommerceTransactionError>;
    checkpointRelationalReferences?: (context: BoundedRequestContext, tableName: string) => Effect.Effect<void, CommerceTransactionError>;
    planSetNull?: (context: BoundedRequestContext, selection: CommerceSetNullSelection) => Effect.Effect<void, CommerceTransactionError>;
    planReferenceReplacement?: (context: BoundedRequestContext, selection: CommerceReferenceReplacement) => Effect.Effect<void, CommerceTransactionError> }>;
type CommerceContextInvocation = (context: BoundedRequestContext, command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError>;
type CommerceContextEventCapture = (context: BoundedRequestContext, event: unknown) => Effect.Effect<void, CommerceTransactionError>;

/** Same borrowed-manager semantics for standalone and composite owners. */
export function makeCommerceCommandContext(
  lifetime: BoundedRequestLifetime<CommerceTransactionError>, working: CommerceContextWorking,
  id: string, manager: BoundedRequestContext,
  invoke: CommerceContextInvocation, captureEvent: CommerceContextEventCapture,
  operations?: CommerceOperations, callLimit?: number,
): CommerceCommandContext {
  const detachDeletedReference = working.detachDeletedReference;
  const checkpointRelationalReferences = working.checkpointRelationalReferences;
  const planSetNull = working.planSetNull;
  const planReferenceReplacement = working.planReferenceReplacement;
  const transactionTime = working.transactionTime;
  return Object.freeze({ manager, resources: working.resources, store: working.store,
    table: tableId => working.table(manager, tableId),
    ...(transactionTime === undefined ? {} : { transactionTime: transactionTime(manager) }),
    ...(detachDeletedReference === undefined ? {} : { detachDeletedReference: (selection: CommerceDeletedReferenceSelection) => detachDeletedReference(manager, selection) }),
    ...(planSetNull === undefined ? {} : { planSetNull: (selection: CommerceSetNullSelection) => planSetNull(manager, selection) }),
    ...(planReferenceReplacement === undefined ? {} : { planReferenceReplacement: (selection: CommerceReferenceReplacement) => planReferenceReplacement(manager, selection) }),
    ...(checkpointRelationalReferences === undefined ? {} : { checkpointRelationalReferences: (tableName: string) => checkpointRelationalReferences(manager, tableName) }),
    captureLocalEvent: event => captureEvent(manager, event),
    nested: (child, args) => lifetime.nested(manager, id, context => invoke(context, child, args), getCommerceCommand(child)?.mode),
    rejectEvent: lifetime.operation(manager, id, "write", Effect.fail(commerceError("unadmittedEvent"))),
    recordFailure: cause => lifetime.recordFailure(manager, cause),
    refuse: error => lifetime.operation(manager, id, "read", Effect.fail(error)),
    ...(operations === undefined ? {} : { enqueue: <Value>(
      prepare: () => Result.Result<Json, CommerceTransactionError>,
      work: (captured: Json) => Effect.Effect<Value, CommerceTransactionError>,
    ) => operations.submit(() => Result.gen(function* () {
      const input = yield* prepare();
      const captured = yield* captureCommerceJsonData(input, lifetime.remainingBytes());
      yield* lifetime.charge(captured.bytes);
      return captured.value;
    }), work) }),
    borrow: work => lifetime.nested(manager, id, child => callLimit === undefined
      ? work(makeCommerceCommandContext(lifetime, working, id, child, invoke, captureEvent))
      : withCommerceCommandContext(lifetime, working, id, child, invoke, captureEvent, callLimit, work)),
  } satisfies CommerceCommandContext);
}

/** A command and every nested borrow close their own FIFO before the manager is
 * revoked. The native transaction callback itself never enters this queue. */
export const withCommerceCommandContext = Effect.fn("Commerce.withCommandContext")(function* <Value>(
  lifetime: BoundedRequestLifetime<CommerceTransactionError>, working: CommerceContextWorking,
  id: string, manager: BoundedRequestContext,
  invoke: CommerceContextInvocation, captureEvent: CommerceContextEventCapture,
  callLimit: number | undefined,
  work: (context: CommerceCommandContext) => Effect.Effect<Value, CommerceTransactionError>,
): Effect.fn.Return<Value, CommerceTransactionError> {
  if (callLimit === undefined) return yield* Effect.suspend(() =>
    work(makeCommerceCommandContext(lifetime, working, id, manager, invoke, captureEvent)));
  return yield* Effect.acquireUseRelease(
    makeCommerceOperations(lifetime, callLimit, manager, true),
    operations => Effect.suspend(() => work(makeCommerceCommandContext(
      lifetime, working, id, manager, invoke, captureEvent, operations, callLimit,
    ))).pipe(Effect.tap(() => operations.seal), Effect.catchCause(cause =>
      Effect.exit(operations.seal).pipe(Effect.flatMap(sealed => Effect.failCause(
        Exit.isFailure(sealed) ? Cause.combine(cause, sealed.cause) : cause,
      ))))),
    operations => operations.close,
  );
});
