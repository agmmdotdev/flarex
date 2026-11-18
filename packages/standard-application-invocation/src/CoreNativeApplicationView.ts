import { Effect } from "effect";
import { CoreTransactionError, type CoreError, type CoreNativeRootBindingMetadata, type CoreNativeRootOperation } from "@flarex/persistence-postgres/internal/core";
import type { CoreWorkerMutationOperations } from "./CoreApplicationMutationRunner";
const refused = () => Effect.fail(new CoreTransactionError({ reason: "authorityRevoked" }));

/** The selected private mixed profile grants one Application insertion and its
 * pending read/patch. It carries no committed read, query or finalizer. */
export const makeCoreNativeApplicationInsertView = Effect.fn("CoreNativeApplication.makeInsertView")(function* (
  operation: CoreNativeRootOperation, metadata: CoreNativeRootBindingMetadata,
  withinOperation: <Value>(mode: "read" | "write", work: Effect.Effect<Value, CoreError>) => Effect.Effect<Value, CoreError>,
): Effect.fn.Return<CoreWorkerMutationOperations, CoreError> {
  const grant = metadata.applicationInsert;
  if (grant === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
  const application = yield* operation.applicationInsert(grant.binding);
  return Object.freeze({ unixTime: operation.unixTime,
    tableNumber: (table: string) => table === grant.table.name ? Effect.succeed(grant.table.number) : refused(),
    insert: (table: string, value: unknown) => withinOperation("write", table === grant.table.name ? application.insert(value) : refused()),
    get: (id: string) => withinOperation("read", application.readPending(id)),
    patch: (id: string, value: unknown) => withinOperation("write", application.patchPending(id, value)),
    startQuery: () => withinOperation("read", refused()),
    replace: () => withinOperation("write", refused()), delete: () => withinOperation("write", refused()),
  });
});
