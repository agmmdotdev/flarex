import { Clock, Effect } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { isJsonObject, type JsonObject } from "flarex-protocol/json";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { ScopeClockRecord } from "../scopeClock";
import type { BoundedRequestContext, BoundedRequestLifetime } from "../boundedRequestLifetime";
import { requireLogicalRelationalAdmission, type LogicalRelationalAdmission } from "../logicalDocuments/relationalAdmission";
import { makeLogicalDocumentWorkingSet, type LogicalDocumentChanges } from "../logicalDocuments/workingSet";
import { prepareLogicalRelationalRows } from "../logicalDocuments/relationalRows";
import { validateLogicalDocumentChanges } from "../logicalDocuments/contribution";
import { enterLogicalDocumentMaterialization } from "../logicalDocuments/materialization";
import { commerceError, logicalCommerceError, type CommerceTransactionError } from "./model";
import { projectCommerceRequestFailure } from "./request";
import { defaultCommerceResources } from "./resources";

declare const closureBrand: unique symbol;
export interface LogicalCommerceClosure { readonly [closureBrand]: true }
export interface LogicalCommerceMutation {
  readonly ordinal: number;
  readonly table: string;
  readonly operation: "insert" | "patch" | "replace" | "delete";
  readonly before: JsonObject | null;
  readonly after: JsonObject | null;
}
export interface LogicalCommerceLifecycleObservation {
  readonly table: string;
  readonly key: Readonly<Record<string, string>>;
  readonly operation: "softDelete" | "restore";
  readonly beforeDeletedAt: string | null;
  readonly afterDeletedAt: string | null;
  readonly attemptOrdinal: number | null;
}
interface ClosureState {
  readonly admission: LogicalRelationalAdmission;
  readonly tx: FlarexMetadataTransaction;
  readonly lifetime: BoundedRequestLifetime<CommerceTransactionError>;
  readonly changes: LogicalDocumentChanges;
}
const closures = new WeakMap<object, ClosureState>();

/** A native participant borrows its root's transaction and lifetime. It owns no
 * commit allocation, outcome, initialization receipt or physical settlement. */
export const makeLogicalCommerceParticipant = Effect.fn("LogicalCommerce.make")(function* (
  admission: LogicalRelationalAdmission, tx: FlarexMetadataTransaction,
  lifetime: BoundedRequestLifetime<CommerceTransactionError>, initialContext: BoundedRequestContext, id: string,
) {
  const state = yield* requireLogicalRelationalAdmission(admission, tx).pipe(Effect.mapError(projectCommerceRequestFailure));
  // Reject incomplete semantic profiles before exposing any table operation.
  for (const table of state.tables) yield* Effect.fromResult(prepareLogicalRelationalRows(table.definition, state.schema.capabilities, logicalCommerceError));
  const working = yield* makeLogicalDocumentWorkingSet({ tx, scopeId: state.authority.scopeId, clock: state.clock, lifetime,
    tables: state.tables.map(table => ({ tableId: table.tableId, logicalName: table.localName, relational: table.definition })),
    relationalCapabilities: state.schema.capabilities,
    requireAdmission: requireLogicalRelationalAdmission(admission, tx).pipe(Effect.asVoid, Effect.mapError(projectCommerceRequestFailure)),
    validateDocument: write => Effect.fromResult(state.values.validate(write.tableId, write.document))
      .pipe(Effect.mapError(cause => commerceError("invalidInput", cause))), error: logicalCommerceError,
    uniqueConflict: () => commerceError("invalidInput"),
    limits: { pageRows: 256, identities: 128, documentBytes: 65_536 },
  }, AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis), state.unique, state.indexes.filter(index => index.access.kind === "developer"));
  const first = state.tables[0];
  if (first === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const store = yield* working.relationalTable(initialContext, id, first.localName);
  const close = Effect.fn("LogicalCommerce.close")(function* () {
    const changes = yield* working.close();
    // SAFETY: only this registry authenticates a closed admission/lifetime pair.
    const closure = Object.freeze({}) as LogicalCommerceClosure;
    closures.set(closure, { admission, tx, lifetime, changes });
    return closure;
  });
  return Object.freeze({ store, resources: defaultCommerceResources, close,
    attemptCount: working.attemptCount,
    table: (context: Parameters<typeof working.relationalTable>[0], table: string) => working.relationalTable(context, id, table) });
});

/** The atomic root inspects authenticated in-memory activity before it
 * consumes the same closure for publication. This grants no storage handle. */
export const inspectLogicalCommerceActivity = Effect.fn("LogicalCommerce.inspectActivity")(function* (
  closure: LogicalCommerceClosure, lifetime: BoundedRequestLifetime<CommerceTransactionError>,
) {
  const closed = closures.get(closure);
  if (closed === undefined || closed.lifetime !== lifetime || !lifetime.isClosing())
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const state = yield* requireLogicalRelationalAdmission(closed.admission, closed.tx).pipe(Effect.mapError(projectCommerceRequestFailure));
  const names = new Map(state.tables.map(table => [table.tableId, table.localName]));
  const mutations: LogicalCommerceMutation[] = [];
  for (const attempt of closed.changes.attempts) {
    const table = names.get(attempt.tableId);
    const before = attempt.before?.valueJson ?? null;
    const after = attempt.after?.valueJson ?? null;
    if (table === undefined || table !== attempt.tableName ||
      (before !== null && !isJsonObject(before)) || (after !== null && !isJsonObject(after)))
      return yield* Effect.fail(commerceError("storedCorruption"));
    mutations.push(Object.freeze({ ordinal: attempt.ordinal, table, operation: attempt.operation, before, after }));
  }
  const lifecycle: LogicalCommerceLifecycleObservation[] = [];
  for (const observation of closed.changes.lifecycle) {
    const table = names.get(observation.tableId);
    if (table === undefined || table !== observation.tableName) return yield* Effect.fail(commerceError("storedCorruption"));
    lifecycle.push(Object.freeze({ table, key: observation.key, operation: observation.operation,
      beforeDeletedAt: observation.beforeDeletedAt, afterDeletedAt: observation.afterDeletedAt,
      attemptOrdinal: observation.attemptOrdinal }));
  }
  return Object.freeze({ mutations: Object.freeze(mutations), lifecycle: Object.freeze(lifecycle) });
});

/** The root consumes exactly once while the source callback is still live. */
export const consumeLogicalCommerceClosure = Effect.fn("LogicalCommerce.consume")(function* (
  closure: LogicalCommerceClosure, lifetime: BoundedRequestLifetime<CommerceTransactionError>,
) {
  const closed = closures.get(closure);
  if (closed === undefined || closed.lifetime !== lifetime || !lifetime.isClosing())
    return yield* Effect.fail(commerceError("invalidAuthority"));
  closures.delete(closure);
  const state = yield* requireLogicalRelationalAdmission(closed.admission, closed.tx).pipe(Effect.mapError(projectCommerceRequestFailure));
  return Object.freeze({ ...closed, state });
});

/** Called only after the outer owner has acquired publication exclusion. */
export const prepareLogicalCommerceContribution = Effect.fn("LogicalCommerce.prepareContribution")(function* (
  closed: Effect.Success<ReturnType<typeof consumeLogicalCommerceClosure>>, clock: ScopeClockRecord,
) {
  const { state, tx, admission } = closed;
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(state.authority.scopeId)).pipe(Effect.mapError(projectCommerceRequestFailure));
  const contribution = yield* validateLogicalDocumentChanges({ tx, scopeId: state.authority.scopeId,
    tables: new Set(state.tables.map(table => table.tableId)), maximumIndexEntries: 128, error: logicalCommerceError }, closed.changes);
  const requireAdmission = requireLogicalRelationalAdmission(admission, tx).pipe(Effect.asVoid, Effect.mapError(projectCommerceRequestFailure));
  const core = yield* enterLogicalDocumentMaterialization({
    coverage: "sourceBound",
    command: { authorityPins: { deploymentId: TransactionGrantDeploymentIdV1Schema.make(state.authority.deploymentId),
      scopeId: scope.scopeId, schemaVersionId: state.schemaVersionId }, rowIntents: state.tables.map(table => ({ tableId: table.tableId })) },
    intrinsic: state.indexes.filter(index => index.access.kind === "by_creation_time"),
    developer: state.indexes.filter(index => index.access.kind === "developer"), unique: state.unique,
    relations: null, options: {}, requireAdmission,
    validateWrites: (_, changes) => Effect.forEach(changes, change => change.kind === "deleted" ? Effect.void :
      Effect.fromResult(state.values.validate(change.tableId, change.document)).pipe(Effect.mapError(cause => commerceError("invalidInput", cause))), { discard: true }),
  }, tx, state.authority, clock).pipe(Effect.mapError(projectCommerceRequestFailure));
  const delta = yield* core.prepareDelta(contribution.changes, contribution.dependencies).pipe(Effect.mapError(projectCommerceRequestFailure));
  return Object.freeze({ changes: contribution.changes,
    lower: (commitSeq: Parameters<typeof delta.lower>[0]) => delta.lower(commitSeq).pipe(Effect.mapError(projectCommerceRequestFailure)) });
});
