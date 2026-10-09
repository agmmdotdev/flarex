import { Clock, Effect } from "effect";
import { MAX_POINT_COMMIT_MATERIAL_ROWS_V1 } from "flarex-protocol/commit-protocol";
import {
  MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1,
  MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1,
} from "../../storage/materialization/limits";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import type { BoundedRequestContext, BoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";
import { requireLogicalRelationalAdmission, type LogicalRelationalAdmission } from "../../storage/documents/logicalDocuments/relationalAdmission";
import { requireLogicalRelationalReadAdmission, type LogicalRelationalReadAdmission } from "../../storage/documents/logicalDocuments/relationalAdmission";
import { makeLogicalDocumentWorkingSet, type LogicalDocumentChanges, type LogicalDocumentActivity } from "../../storage/documents/logicalDocuments/workingSet";
import type { LogicalStorageReadReadiness } from "../../storage/documents/logicalDocuments/model";
import type { CommerceSetNullSelection, CommerceReferenceReplacement } from "./commands";
import { bindPreparedLogicalRelationalRows } from "../../storage/documents/logicalDocuments/relationalRows";
import { validateLogicalDocumentChanges } from "../../storage/documents/logicalDocuments/contribution";
import { enterLogicalDocumentMaterialization, logicalMaterializationBatchBudget } from "../../storage/documents/logicalDocuments/materialization";
import { forEachLogicalSetNullPage, forEachLogicalReferenceReplacementPage,
  selectLogicalReferenceReplacement } from "../../storage/documents/logicalDocuments/referencePages";
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
}
const closures = new WeakMap<object, ClosureState>();

/** A native participant borrows its root's transaction and lifetime. It owns no
 * commit allocation, outcome, initialization receipt or physical settlement. */
export const makeLogicalCommerceParticipant = Effect.fn("LogicalCommerce.make")(function* (
  admission: LogicalRelationalAdmission, tx: FlarexMetadataTransaction,
  lifetime: BoundedRequestLifetime<CommerceTransactionError>, initialContext: BoundedRequestContext, id: string,
  allowReferenceReplacement = false, selectedResources?: CommerceResources,
) {
  const resources = selectedResources ?? defaultCommerceResources;
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
      identities: selectedResources?.catalogRows ?? logicalCommerceWorkingSetLimits.identities },
  }, AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis),
    readReadiness.kind === "queryRequired" ? state.unique : state.writeMechanics.unique,
    readReadiness.kind === "queryRequired" ? [] : state.writeMechanics.indexes);
  const first = state.tables[0];
  if (first === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const store = yield* working.relationalTable(initialContext, id, first.localName);
  const names = state.tableNames;
  const projectActivity = makeLogicalCommerceActivityProjection(names);
  const close = Effect.fn("LogicalCommerce.close")(function* () {
    const changes = yield* working.close();
    const activity = yield* working.readActivityContribution(yield* working.closedActivityContribution);
    // SAFETY: only this registry authenticates a closed admission/lifetime pair.
    const closure = Object.freeze({}) as LogicalCommerceClosure;
    closures.set(closure, { admission, tx, lifetime, changes, activity: () => projectActivity(activity),
      maximumIndexEntries: selectedResources?.catalogRows ?? logicalCommerceWorkingSetLimits.identities,
      maximumFacts: resources.facts });
    return closure;
  });
  const callActivity = Effect.fn("LogicalCommerce.callActivity")(function* (
    cursor: ReturnType<typeof working.activityCursor>,
  ) {
    return yield* projectActivity(yield* working.readActivityContribution(yield* working.activityContribution, cursor));
  });
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
});

/** The atomic root inspects authenticated in-memory activity before it
 * consumes the same closure for publication. This grants no storage handle. */
export const inspectLogicalCommerceActivity = Effect.fn("LogicalCommerce.inspectActivity")(function* (
  closure: LogicalCommerceClosure, lifetime: BoundedRequestLifetime<CommerceTransactionError>,
) {
  const closed = closures.get(closure);
  if (closed === undefined || closed.lifetime !== lifetime || !lifetime.isClosing())
    return yield* Effect.fail(commerceError("invalidAuthority"));
  yield* requireLogicalRelationalAdmission(closed.admission, closed.tx).pipe(Effect.mapError(projectCommerceRequestFailure));
  return yield* closed.activity();
});

/** Both live call evidence and closed aggregate evidence use the same projection.
 * Neither view carries a storage or settlement capability. */
export const projectLogicalCommerceActivity = Effect.fn("LogicalCommerce.projectActivity")(function* (
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
  // Native policies see one detached JSON contribution. Canonical runtime
  // values and their mutable bytes remain private to the original working set.
  const detached = structuredClone({ mutations, lifecycle, observedRows, setNull, referenceReplacements });
  for (const mutation of detached.mutations) {
    freezeActivityJson(mutation.before); freezeActivityJson(mutation.after); Object.freeze(mutation);
  }
  for (const observation of detached.lifecycle) {
    Object.freeze(observation.key); freezeActivityJson(observation.rowAtOperation); Object.freeze(observation);
  }
  for (const observation of detached.observedRows) { freezeActivityJson(observation.row); Object.freeze(observation); }
  for (const intent of detached.setNull) Object.freeze(intent);
  for (const intent of detached.referenceReplacements) { Object.freeze(intent.desiredKeys); Object.freeze(intent); }
  return Object.freeze({ mutations: Object.freeze(detached.mutations), lifecycle: Object.freeze(detached.lifecycle),
    observedRows: Object.freeze(detached.observedRows), setNull: Object.freeze(detached.setNull),
    referenceReplacements: Object.freeze(detached.referenceReplacements) });
});

// Only the checked JSON fields assembled above enter this projection. This is
// deliberate detachment of an owned contribution, not an unknown-input parser.
const freezeActivityJson = (value: Json): void => {
  if (value === null || typeof value !== "object") return;
  for (const child of Array.isArray(value) ? value : Object.values(value)) freezeActivityJson(child);
  Object.freeze(value);
};

/** One current value projection owned by the original admitted source. It
 * retains neither a live verdict nor an additional graph/settlement authority. */
export type LogicalCommerceActivity = Effect.Success<ReturnType<typeof projectLogicalCommerceActivity>>;

export function makeLogicalCommerceActivityProjection(names: Pick<ReadonlyMap<CatalogTableId, string>, "get">) {
  let projected: Readonly<{ source: LogicalDocumentActivity; value: LogicalCommerceActivity }> | undefined;
  return (activity: LogicalDocumentActivity): Effect.Effect<LogicalCommerceActivity, CommerceTransactionError> => {
    if (projected?.source === activity) return Effect.succeed(projected.value);
    return projectLogicalCommerceActivity(names, activity).pipe(Effect.tap(value => Effect.sync(() => {
      projected = Object.freeze({ source: activity, value });
    })));
  };
}

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
  allowReferenceReplacement = false,
) {
  const { state, tx, admission } = closed;
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(state.authority.scopeId)).pipe(Effect.mapError(projectCommerceRequestFailure));
  const contribution = yield* validateLogicalDocumentChanges({ tx, scopeId: state.authority.scopeId,
    tables: new Set(state.tables.map(table => table.tableId)), maximumIndexEntries: closed.maximumIndexEntries,
    error: logicalCommerceError,
    ...(closed.changes.setNull.length === 0 ? {} : { allowSetNull: true as const }),
    ...(allowReferenceReplacement ? { allowReferenceReplacement: true as const } : {}) }, closed.changes);
  const admitted = requireLogicalRelationalAdmission(admission, tx).pipe(Effect.mapError(projectCommerceRequestFailure));
  const replacements = yield* Effect.forEach(closed.changes.referenceReplacements, intent =>
    selectLogicalReferenceReplacement({ tx, ...intent, pendingChanges: contribution.changes, requireAdmission: admitted,
      error: logicalCommerceError }).pipe(Effect.map(selection => Object.freeze({ intent, selection }))));
  const pending = new Map(replacements.flatMap(({ selection }) => selection.pendingChanges.map(change => [change.documentId, change] as const)));
  const rootChanges = contribution.changes.map(change => pending.get(change.documentId) ?? change);
  const rootDependencies = contribution.dependencies.map(row => pending.get(row.documentId) ?? row);
  const rootPages: typeof rootChanges[] = [];
  let page: typeof rootChanges = [];
  let indexCost = 0;
  let uniqueCost = 0;
  for (const change of rootChanges) {
    const nextIndexCost = state.indexes.filter(index => index.access.kind === "developer" &&
      index.access.tableId === change.tableId).length;
    const nextUniqueCost = state.unique.filter(definition => definition.tableId === change.tableId).length;
    if (nextIndexCost > MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1 ||
      nextUniqueCost > MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1)
      return yield* Effect.fail(commerceError("limitExceeded"));
    if (page.length === MAX_POINT_COMMIT_MATERIAL_ROWS_V1 ||
      indexCost + nextIndexCost > MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1 ||
      uniqueCost + nextUniqueCost > MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1) {
      rootPages.push(page);
      page = [];
      indexCost = 0;
      uniqueCost = 0;
    }
    page.push(change);
    indexCost += nextIndexCost;
    uniqueCost += nextUniqueCost;
  }
  rootPages.push(page);
  const pagedRoot = rootPages.length > 1;
  if (rootPages.length > logicalMaterializationBatchBudget.pages)
    return yield* Effect.fail(commerceError("limitExceeded"));
  // Homogeneous creates or deletes have no cross-page key transfer. Mixed
  // transitions still need complete unique-key validation on one page.
  const allCreated = rootChanges.every(change => change.kind === "live" &&
    (change.dependency.kind === "generatedInsertion" || change.dependency.observed.kind === "missing" &&
    change.dependency.observed.basis.kind === "noVisibleRevision"));
  const allDeleted = rootChanges.every(change => change.kind === "deleted" &&
    change.dependency.kind === "appRowPoint" && change.dependency.observed.kind === "present");
  if (pagedRoot && (replacements.length !== 0 || !(allCreated || allDeleted)))
    return yield* Effect.fail(commerceError("limitExceeded"));
  const derivedIds = Object.freeze(replacements.flatMap(({ selection }) =>
    [...selection.detach, ...selection.associate].map(row => row.key)));
  const requireAdmission = admitted.pipe(Effect.asVoid);
  const core = yield* enterLogicalDocumentMaterialization({
    coverage: "sourceBound", ...(closed.changes.setNull.length === 0 && replacements.length === 0 && !pagedRoot
      ? {} : { batch: true as const }),
    command: { authorityPins: { deploymentId: TransactionGrantDeploymentIdV1Schema.make(state.authority.deploymentId),
      scopeId: scope.scopeId, schemaVersionId: state.schemaVersionId }, rowIntents: state.tables.map(table => ({ tableId: table.tableId })) },
    intrinsic: state.indexes.filter(index => index.access.kind === "by_creation_time"),
    developer: state.indexes.filter(index => index.access.kind === "developer"), unique: state.unique,
    search: state.search,
    relations: null, options: {}, requireAdmission,
    validateWrites: (_, changes) => Effect.forEach(changes, change => change.kind === "deleted" ? Effect.void :
      Effect.fromResult(state.values.validate(change.tableId, change.document)).pipe(Effect.mapError(cause => commerceError("invalidInput", cause))), { discard: true }),
  }, tx, state.authority, clock).pipe(Effect.mapError(projectCommerceRequestFailure));
  const materialize = Effect.fn("LogicalCommerce.materializeContribution")(function* (commitSeq: Parameters<
    Effect.Success<ReturnType<typeof core.prepareDelta>>["lower"]>[0],
    appendRows: (rows: readonly { readonly tableId: typeof contribution.changes[number]["tableId"];
      readonly rowId: typeof contribution.changes[number]["rowId"] }[]) => Effect.Effect<void, CommerceTransactionError>) {
    let rowCount = 0;
    const admitPage = Effect.fn("LogicalCommerce.admitFactPage")(function* (count: number) {
      if (rowCount + count > closed.maximumFacts) return yield* Effect.fail(commerceError("limitExceeded"));
      rowCount += count;
    });
    const adjacencyChanges: Array<Effect.Success<ReturnType<Effect.Success<ReturnType<typeof core.prepareDelta>>["lower"]>>[number]> = [];
    const lowerRoot = Effect.fn("LogicalCommerce.lowerRoot")(function* () {
      for (const [index, rootPage] of rootPages.entries()) {
        // Validate every original observation before lowering the first page.
        // Later pages repeat their own point check against the same transaction.
        const dependencies = index === 0 ? rootDependencies : rootPage;
        const root = yield* core.prepareDelta(rootPage, dependencies).pipe(Effect.mapError(projectCommerceRequestFailure));
        yield* admitPage(rootPage.length);
        adjacencyChanges.push(...yield* root.lower(commitSeq).pipe(Effect.mapError(projectCommerceRequestFailure)));
        yield* appendRows(rootPage.map(change => ({ tableId: change.tableId, rowId: change.rowId })));
      }
    });
    // Validate all original reads before any derived self-write; keep all native
    // changes together for their unique-key and foreign-key transitions.
    if (replacements.length !== 0) yield* lowerRoot();
    for (const intent of closed.changes.setNull) {
      yield* forEachLogicalSetNullPage({ tx, sourceTableId: intent.sourceTableId,
        sourceColumn: intent.sourceColumn, targetTableId: intent.targetTableId,
        targetColumn: intent.targetColumn, targetKey: intent.targetKey,
        requireAdmission: admitted, error: logicalCommerceError }, changes => Effect.gen(function* () {
          const delta = yield* core.prepareDelta(changes, changes).pipe(Effect.mapError(projectCommerceRequestFailure));
          yield* admitPage(changes.length);
          adjacencyChanges.push(...yield* delta.lower(commitSeq).pipe(Effect.mapError(projectCommerceRequestFailure)));
          yield* appendRows(changes.map(change => ({ tableId: change.tableId, rowId: change.rowId })));
        }));
    }
    for (const { intent, selection } of replacements) {
      const loweredIds: string[] = [];
      yield* forEachLogicalReferenceReplacementPage({ tx, ...intent, selection,
        requireAdmission: admitted, error: logicalCommerceError }, (changes, keys) => Effect.gen(function* () {
          const delta = yield* core.prepareDelta(changes, changes).pipe(Effect.mapError(projectCommerceRequestFailure));
          yield* admitPage(changes.length);
          adjacencyChanges.push(...yield* delta.lower(commitSeq).pipe(Effect.mapError(projectCommerceRequestFailure)));
          yield* appendRows(changes.map(change => ({ tableId: change.tableId, rowId: change.rowId })));
          loweredIds.push(...keys);
        }));
      const pendingRows = new Set(selection.pendingChanges.map(change => change.rowId));
      const streamedIds = [...selection.detach, ...selection.associate].filter(row => !pendingRows.has(row.rowId)).map(row => row.key);
      if (loweredIds.length !== streamedIds.length ||
        loweredIds.some((key, index) => key !== streamedIds[index]))
        return yield* Effect.fail(commerceError("invalidAuthority"));
    }
    if (replacements.length === 0) yield* lowerRoot();
    if (closed.changes.setNull.length > 0 || replacements.length > 0 || pagedRoot)
      yield* core.completeBatch().pipe(Effect.mapError(projectCommerceRequestFailure));
    return Object.freeze({ rowCount, adjacencyChanges: Object.freeze(adjacencyChanges) });
  });
  return Object.freeze({ changes: Object.freeze(rootChanges), derivedIds, hasReferenceReplacement: replacements.length > 0,
    materialize });
});
