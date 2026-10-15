import { observeExecution } from "../../execution/diagnostics/operation";
// Quiet calls retain lazy operation bodies; actual caller/SDK policy owns diagnostic spans.
import { Clock, Effect } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { isJsonObject, type JsonObject } from "flarex-protocol/json";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { BoundedRequestContext, BoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";
import { requireLogicalRelationalAdmission, type LogicalRelationalAdmission } from "../../storage/documents/logicalDocuments/relationalAdmission";
import { requireLogicalRelationalReadAdmission, type LogicalRelationalReadAdmission } from "../../storage/documents/logicalDocuments/relationalAdmission";
import { makeLogicalDocumentWorkingSet, type LogicalDocumentChanges, type LogicalDocumentActivity } from "../../storage/documents/logicalDocuments/workingSet";
import type { LogicalStorageReadReadiness } from "../../storage/documents/logicalDocuments/model";
import type { CommerceSetNullSelection, CommerceReferenceReplacement } from "./commands";
import { bindPreparedLogicalRelationalRows, detachLogicalRelationalActivityJson } from "../../storage/documents/logicalDocuments/relationalRows";
import { commerceError, logicalCommerceError, type CommerceTransactionError } from "./model";
import { projectCommerceRequestFailure } from "./request";
import { defaultCommerceResources, logicalCommerceWorkingSetLimits, type CommerceResources } from "./resources";

/** A selected read borrows only read mechanics and its accepting transaction. */
export const makeLogicalCommerceReadParticipant = Effect.fn("LogicalCommerce.makeReadParticipant")(function* (
  admission: LogicalRelationalReadAdmission, tx: FlarexMetadataTransaction,
  lifetime: BoundedRequestLifetime<CommerceTransactionError>, id: string, resources: CommerceResources,
) {
  const state = yield* requireLogicalRelationalReadAdmission(admission, tx).pipe(Effect.mapError(projectCommerceRequestFailure));
  const selected = state.readReadiness;
  const readReadiness: LogicalStorageReadReadiness<CommerceTransactionError> = {
    ...selected,
    requireDemand: (demandTx, demand) => selected.requireDemand(demandTx, demand).pipe(Effect.mapError(projectCommerceRequestFailure)),
  };
  const working = yield* makeLogicalDocumentWorkingSet({
    tx, scopeId: state.authority.scopeId, clock: state.clock, lifetime,
    tables: selected.mechanics.tables,
    ...(selected.mechanics.relationalCapabilities === undefined ? {} : {
      relationalCapabilities: selected.mechanics.relationalCapabilities,
    }),
    searchDefinitions: selected.mechanics.searchDefinitions,
    readReadiness,
    requireAdmission: requireLogicalRelationalReadAdmission(admission, tx).pipe(Effect.asVoid, Effect.mapError(projectCommerceRequestFailure)),
    validateDocument: () => Effect.fail(commerceError("invalidAuthority")),
    error: logicalCommerceError,
    uniqueConflict: () => commerceError("invalidAuthority"),
    limits: { ...logicalCommerceWorkingSetLimits, pageRows: resources.queryRows, identities: resources.catalogRows },
  }, AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis), [], []);
  return Object.freeze({
    store: yield* working.relationalTable(lifetime.context, id, state.defaultTableName), resources,
    table: (context: BoundedRequestContext, table: string) => working.relationalTable(context, id, table),
    transactionTime: (context: BoundedRequestContext) => working.readTransactionTime(context, id),
  });
});

declare const closureBrand: unique symbol;
export interface LogicalCommerceClosure { readonly [closureBrand]: true }
export interface LogicalCommerceMutation {
  readonly ordinal: number;
  readonly table: string;
  readonly operation: "insert" | "patch" | "replace" | "delete";
  readonly before: JsonObject | null;
  readonly after: JsonObject | null;
}
export interface LogicalCommerceObservedRow {
  readonly table: string;
  readonly row: JsonObject;
}
export interface LogicalCommerceSetNull {
  readonly sourceTable: string;
  readonly sourceColumn: string;
  readonly targetTable: string;
  readonly targetColumn: string;
  readonly targetKey: string;
}
export interface LogicalCommerceReferenceReplacement extends LogicalCommerceSetNull {
  readonly desiredKeys: readonly string[];
}
export interface LogicalCommerceLifecycleObservation {
  readonly table: string;
  readonly key: Readonly<Record<string, string>>;
  readonly operation: "softDelete" | "restore";
  readonly beforeDeletedAt: string | null;
  readonly afterDeletedAt: string | null;
  readonly attemptOrdinal: number | null;
  readonly rowAtOperation: JsonObject | null;
}
interface ClosureState {
  readonly admission: LogicalRelationalAdmission;
  readonly tx: FlarexMetadataTransaction;
  readonly lifetime: BoundedRequestLifetime<CommerceTransactionError>;
  readonly changes: LogicalDocumentChanges;
  readonly activity: () => Effect.Effect<LogicalCommerceActivity, CommerceTransactionError>;
  readonly maximumIndexEntries: number;
  readonly maximumFacts: number;
  readonly maximumIdentities: number;
  readonly logicalPublication: "mixed" | undefined;
}
const closures = new WeakMap<object, ClosureState>();

/** A native participant borrows its root's transaction and lifetime. It owns no
 * commit allocation, outcome, initialization receipt or physical settlement. */
export const makeLogicalCommerceParticipant = Effect.fnUntraced(function* (
  admission: LogicalRelationalAdmission, tx: FlarexMetadataTransaction,
  lifetime: BoundedRequestLifetime<CommerceTransactionError>, initialContext: BoundedRequestContext, id: string,
  allowReferenceReplacement = false, selectedResources?: CommerceResources, logicalPublication?: "mixed",
) {
  const resources = selectedResources ?? defaultCommerceResources;
  const maximumIdentities = selectedResources?.catalogRows ?? logicalCommerceWorkingSetLimits.identities;
  const state = yield* requireLogicalRelationalAdmission(admission, tx).pipe(Effect.mapError(projectCommerceRequestFailure));
  const sourceReadReadiness = state.readReadiness;
  if (sourceReadReadiness.kind === "finiteQueryRequired") return yield* Effect.fail(commerceError("invalidAuthority"));
  const readReadiness: LogicalStorageReadReadiness<CommerceTransactionError> = sourceReadReadiness.kind === "full"
    ? sourceReadReadiness : Object.freeze({ ...sourceReadReadiness,
      requireDemand: (demandTx, demand) => sourceReadReadiness.requireDemand(demandTx, demand).pipe(Effect.mapError(projectCommerceRequestFailure)),
    });
  // Read mechanics were authenticated once by their host lease. Full native
  // participants retain the complete pre-operation semantic-profile check.
  if (readReadiness.kind === "full")
    for (const table of state.tables) yield* Effect.fromResult(bindPreparedLogicalRelationalRows(table.mechanics, logicalCommerceError));
  const working = yield* makeLogicalDocumentWorkingSet({ tx, scopeId: state.authority.scopeId, clock: state.clock, lifetime,
    tables: readReadiness.kind === "queryRequired" ? readReadiness.mechanics.tables :
      state.writeMechanics.tables,
    ...(readReadiness.kind === "queryRequired" ? (
      readReadiness.mechanics.relationalCapabilities === undefined ? {} : {
        relationalCapabilities: readReadiness.mechanics.relationalCapabilities,
      }
    ) : { writeMechanics: state.writeMechanics,
      ...(state.writeMechanics.relationalCapabilities === undefined ? {} : {
        relationalCapabilities: state.writeMechanics.relationalCapabilities,
      }) }),
    searchDefinitions: readReadiness.kind === "queryRequired" ? readReadiness.mechanics.searchDefinitions : state.writeMechanics.searchDefinitions,
    readReadiness,
    requireAdmission: requireLogicalRelationalAdmission(admission, tx).pipe(Effect.asVoid, Effect.mapError(projectCommerceRequestFailure)),
    validateDocument: write => Effect.fromResult(state.values.validate(write.tableId, write.document))
      .pipe(Effect.mapError(cause => commerceError("invalidInput", cause))), error: logicalCommerceError,
    uniqueConflict: () => commerceError("invalidInput"),
    limits: { ...logicalCommerceWorkingSetLimits, pageRows: selectedResources?.queryRows ?? logicalCommerceWorkingSetLimits.pageRows,
      identities: maximumIdentities },
  }, AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis),
    readReadiness.kind === "queryRequired" ? state.unique : state.writeMechanics.unique,
    readReadiness.kind === "queryRequired" ? [] : state.writeMechanics.indexes);
  const first = state.tables[0];
  if (first === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const store = yield* working.relationalTable(initialContext, id, first.localName);
  const names = state.tableNames;
  const projectActivity = makeLogicalCommerceActivityProjection(names);
  const close = Effect.fnUntraced(function* () {
    const changes = yield* working.close();
    const activity = yield* working.readActivityContribution(yield* working.closedActivityContribution);
    // SAFETY: only this registry authenticates a closed admission/lifetime pair.
    const closure = Object.freeze({}) as LogicalCommerceClosure;
    closures.set(closure, { admission, tx, lifetime, changes, activity: () => projectActivity(activity),
      maximumIndexEntries: selectedResources?.catalogRows ?? logicalCommerceWorkingSetLimits.identities,
      maximumFacts: resources.facts, maximumIdentities, logicalPublication });
    return closure;
  }, work => observeExecution("LogicalCommerce.close", work, "caller"));
  const callActivity = Effect.fnUntraced(function* (
    cursor: ReturnType<typeof working.activityCursor>,
  ) {
    return yield* projectActivity(yield* working.readActivityContribution(yield* working.activityContribution, cursor));
  }, work => observeExecution("LogicalCommerce.callActivity", work, "caller"));
  return Object.freeze({ store, resources, close,
    transactionTime: (context: BoundedRequestContext) => working.readTransactionTime(context, id),
    activityCursor: working.activityCursor, callActivity,
    attemptCount: working.attemptCount, lifecycleCount: working.lifecycleCount,
    planSetNull: (context: BoundedRequestContext, selection: CommerceSetNullSelection) => Effect.gen(function* () {
      const admitted = yield* requireLogicalRelationalAdmission(admission, tx).pipe(Effect.mapError(projectCommerceRequestFailure));
      const source = admitted.tables.find(table => table.localName === selection.sourceTable);
      const target = admitted.tables.find(table => table.localName === selection.targetTable);
      if (source === undefined || target === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
      yield* working.planSetNull(context, id, { sourceTableId: source.tableId, sourceColumn: selection.sourceColumn,
        targetTableId: target.tableId, targetColumn: selection.targetColumn, targetKey: selection.targetKey });
    }),
    ...(allowReferenceReplacement ? { planReferenceReplacement: (context: BoundedRequestContext,
      selection: CommerceReferenceReplacement) => Effect.gen(function* () {
      const admitted = yield* requireLogicalRelationalAdmission(admission, tx).pipe(Effect.mapError(projectCommerceRequestFailure));
      const source = admitted.tables.find(table => table.localName === selection.sourceTable);
      const target = admitted.tables.find(table => table.localName === selection.targetTable);
      if (source === undefined || target === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
      yield* working.planReferenceReplacement(context, id, { sourceTableId: source.tableId,
        sourceColumn: selection.sourceColumn, targetTableId: target.tableId,
        targetColumn: selection.targetColumn, targetKey: selection.targetKey,
        desiredKeys: selection.desiredKeys });
    }) } : {}),
    table: (context: Parameters<typeof working.relationalTable>[0], table: string) => working.relationalTable(context, id, table) });
}, work => observeExecution("LogicalCommerce.make", work, "caller"));

/** The atomic root inspects authenticated in-memory activity before it
 * consumes the same closure for publication. This grants no storage handle. */
export const inspectLogicalCommerceActivity = Effect.fnUntraced(function* (
  closure: LogicalCommerceClosure, lifetime: BoundedRequestLifetime<CommerceTransactionError>,
) {
  const closed = closures.get(closure);
  if (closed === undefined || closed.lifetime !== lifetime || !lifetime.isClosing())
    return yield* Effect.fail(commerceError("invalidAuthority"));
  yield* requireLogicalRelationalAdmission(closed.admission, closed.tx).pipe(Effect.mapError(projectCommerceRequestFailure));
  return yield* closed.activity();
}, work => observeExecution("LogicalCommerce.inspectActivity", work, "caller"));

/** Both live call evidence and closed aggregate evidence use the same projection.
 * Neither view carries a storage or settlement capability. */
export const projectLogicalCommerceActivity = Effect.fnUntraced(function* (
  names: Pick<ReadonlyMap<CatalogTableId, string>, "get">,
  activity: Pick<LogicalDocumentChanges, "attempts" | "lifecycle" | "observedRows" | "setNull" | "referenceReplacements">,
) {
  const mutations: LogicalCommerceMutation[] = [];
  for (const attempt of activity.attempts) {
    const table = names.get(attempt.tableId);
    const before = attempt.before?.valueJson ?? null;
    const after = attempt.after?.valueJson ?? null;
    if (table === undefined || table !== attempt.tableName ||
      (before !== null && !isJsonObject(before)) || (after !== null && !isJsonObject(after)))
      return yield* Effect.fail(commerceError("storedCorruption"));
    mutations.push(Object.freeze({ ordinal: attempt.ordinal, table, operation: attempt.operation, before, after }));
  }
  const lifecycle: LogicalCommerceLifecycleObservation[] = [];
  for (const observation of activity.lifecycle) {
    const table = names.get(observation.tableId);
    if (table === undefined || table !== observation.tableName) return yield* Effect.fail(commerceError("storedCorruption"));
    lifecycle.push(Object.freeze({ table, key: observation.key, operation: observation.operation,
      beforeDeletedAt: observation.beforeDeletedAt, afterDeletedAt: observation.afterDeletedAt,
      attemptOrdinal: observation.attemptOrdinal, rowAtOperation: observation.rowAtOperation }));
  }
  const observedRows: LogicalCommerceObservedRow[] = [];
  for (const observation of activity.observedRows) {
    const table = names.get(observation.tableId);
    if (table === undefined || table !== observation.tableName || !isJsonObject(observation.value))
      return yield* Effect.fail(commerceError("storedCorruption"));
    observedRows.push(Object.freeze({ table, row: observation.value }));
  }
  const setNull: LogicalCommerceSetNull[] = [];
  for (const intent of activity.setNull) {
    const sourceTable = names.get(intent.sourceTableId);
    const targetTable = names.get(intent.targetTableId);
    if (sourceTable === undefined || targetTable === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
    setNull.push(Object.freeze({ sourceTable, sourceColumn: intent.sourceColumn, targetTable,
      targetColumn: intent.targetColumn, targetKey: intent.targetKey }));
  }
  const referenceReplacements: LogicalCommerceReferenceReplacement[] = [];
  for (const intent of activity.referenceReplacements) {
    const sourceTable = names.get(intent.sourceTableId);
    const targetTable = names.get(intent.targetTableId);
    if (sourceTable === undefined || targetTable === undefined)
      return yield* Effect.fail(commerceError("storedCorruption"));
    referenceReplacements.push(Object.freeze({ sourceTable, sourceColumn: intent.sourceColumn,
      targetTable, targetColumn: intent.targetColumn, targetKey: intent.targetKey,
      desiredKeys: intent.desiredKeys }));
  }
  // Complete source/corruption refusal above precedes detachment. Exact owned
  // canonical rows retain their immutable JSON projections; cursor calls do
  // not clone and freeze every previously observed row again.
  return Object.freeze({
    mutations: Object.freeze(mutations.map(mutation => Object.freeze({ ...mutation,
      before: detachLogicalRelationalActivityJson(mutation.before), after: detachLogicalRelationalActivityJson(mutation.after) }))),
    lifecycle: Object.freeze(lifecycle.map(observation => Object.freeze({ ...observation,
      key: Object.freeze({ ...observation.key }), rowAtOperation: detachLogicalRelationalActivityJson(observation.rowAtOperation) }))),
    observedRows: Object.freeze(observedRows.map(observation => Object.freeze({ ...observation,
      row: detachLogicalRelationalActivityJson(observation.row) }))),
    setNull: Object.freeze(setNull.map(intent => Object.freeze({ ...intent }))),
    referenceReplacements: Object.freeze(referenceReplacements.map(intent => Object.freeze({ ...intent,
      desiredKeys: Object.freeze([...intent.desiredKeys]) }))),
  });
}, work => observeExecution("LogicalCommerce.projectActivity", work, "caller"));

/** One current value projection owned by the original admitted source. It
 * retains neither a live verdict nor an additional graph/settlement authority. */
export type LogicalCommerceActivity = Effect.Success<ReturnType<typeof projectLogicalCommerceActivity>>;

export function makeLogicalCommerceActivityProjection(names: Pick<ReadonlyMap<CatalogTableId, string>, "get">) {
  // A foreign mutable view never inherits a prior complete verdict merely by
  // retaining its wrapper identity. Row detachment owns the useful immutable
  // projection retention, including genuinely new cursor views.
  return (activity: LogicalDocumentActivity): Effect.Effect<LogicalCommerceActivity, CommerceTransactionError> =>
    projectLogicalCommerceActivity(names, activity);
}

/** The root consumes exactly once while the source callback is still live. */
export const consumeLogicalCommerceClosure = Effect.fnUntraced(function* (
  closure: LogicalCommerceClosure, lifetime: BoundedRequestLifetime<CommerceTransactionError>,
) {
  const closed = closures.get(closure);
  if (closed === undefined || closed.lifetime !== lifetime || !lifetime.isClosing())
    return yield* Effect.fail(commerceError("invalidAuthority"));
  closures.delete(closure);
  const state = yield* requireLogicalRelationalAdmission(closed.admission, closed.tx).pipe(Effect.mapError(projectCommerceRequestFailure));
  return Object.freeze({ ...closed, state });
}, work => observeExecution("LogicalCommerce.consume", work, "caller"));
