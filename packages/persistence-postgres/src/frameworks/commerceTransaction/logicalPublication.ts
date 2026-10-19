import { Effect } from "effect";
import { MAX_POINT_COMMIT_MATERIAL_ROWS_V1 } from "flarex-protocol/commit-protocol";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { projectScopeIdUuidV1Result, type CommitSeq } from "flarex-protocol/storage-authority";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import { sameBindingValue } from "../../installation/frameworkSchema/binding/canonical";
import { MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1, MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1 } from "../../storage/materialization/limits";
import { requireLogicalRelationalAdmission } from "../../storage/documents/logicalDocuments/relationalAdmission";
import { validateLogicalDocumentChanges } from "../../storage/documents/logicalDocuments/contribution";
import { enterLogicalDocumentMaterialization, logicalMaterializationBatchBudget } from "../../storage/documents/logicalDocuments/materialization";
import { forEachLogicalSetNullPage, forEachLogicalReferenceReplacementPage, selectLogicalReferenceReplacement } from "../../storage/documents/logicalDocuments/referencePages";
import type { LogicalDocumentChange } from "../../storage/documents/logicalDocuments/workingSet";
import type { consumeLogicalCommerceClosure } from "./logicalParticipant";
import { commerceError, logicalCommerceError, type CommerceTransactionError } from "./model";
import { projectCommerceRequestFailure } from "./request";
import { planLogicalCommercePublicationPages } from "./logicalPublicationPages";

type ClosedCommerceSource = Effect.Success<ReturnType<typeof consumeLogicalCommerceClosure>>;

const prepareClosedCommerceSource = Effect.fn("LogicalCommerce.prepareClosedSource")(function* (
  closed: ClosedCommerceSource, allowReferenceReplacement: boolean,
) {
  const { state, tx } = closed;
  const contribution = yield* validateLogicalDocumentChanges({ tx, scopeId: state.authority.scopeId,
    tables: new Set(state.tables.map(table => table.tableId)), maximumIndexEntries: closed.maximumIndexEntries,
    error: logicalCommerceError, ...(closed.detachDeletedReferences ? { detachDeletedReferences: true as const } : {}), ...(closed.setNullPolicy === undefined ? {} : { setNullPolicy: closed.setNullPolicy }),
    ...(allowReferenceReplacement ? { allowReferenceReplacement: true as const } : {}) }, closed.changes);
  const admitted = requireLogicalRelationalAdmission(closed.admission, tx).pipe(Effect.mapError(projectCommerceRequestFailure));
  const replacements = yield* Effect.forEach(closed.changes.referenceReplacements, intent =>
    selectLogicalReferenceReplacement({ tx, ...intent, pendingChanges: contribution.changes, requireAdmission: admitted,
      error: logicalCommerceError }).pipe(Effect.map(selection => Object.freeze({ intent, selection }))));
  const pending = new Map(replacements.flatMap(({ selection }) => selection.pendingChanges.map(change => [change.documentId, change] as const)));
  return Object.freeze({ closed, admitted, replacements,
    changes: contribution.changes.map(change => pending.get(change.documentId) ?? change),
    dependencies: contribution.dependencies.map(point => pending.get(point.documentId) ?? point) });
});

/** Closed, authenticated source contributions enter one bounded publication
 * program. Source ordinals remain visible for budgets, facts and policy; the
 * union borrows only the outer owner's transaction and fresh writer clock. */
export const prepareLogicalCommercePublication = Effect.fn("LogicalCommerce.preparePublication")(function* (
  closedSources: readonly ClosedCommerceSource[], clock: ScopeClockRecord, allowReferenceReplacement = false,
) {
  const first = closedSources[0];
  if (first === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const { state, tx } = first;
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(state.authority.scopeId))
    .pipe(Effect.mapError(projectCommerceRequestFailure));
  const byTable = new Map<CatalogTableId, number>();
  const sourceSchemaVersionByTable = new Map<CatalogTableId, CatalogSchemaVersionId>();
  const sources: Effect.Success<ReturnType<typeof prepareClosedCommerceSource>>[] = [];
  for (const [ordinal, closed] of closedSources.entries()) {
    const selected = closed.state;
    if (closed.tx !== tx || selected.authority !== state.authority || selected.clock !== state.clock ||
      selected.head === null || state.head === null || !sameBindingValue(selected.head, state.head))
      return yield* Effect.fail(commerceError("invalidAuthority"));
    for (const table of selected.tables) {
      if (byTable.has(table.tableId)) return yield* Effect.fail(commerceError("invalidAuthority"));
      byTable.set(table.tableId, ordinal);
      sourceSchemaVersionByTable.set(table.tableId, selected.schemaVersionId);
    }
    // The original source keeps its refusal order and bounded read policy.
    sources.push(yield* prepareClosedCommerceSource(closed, allowReferenceReplacement));
  }
  const replacements = sources.flatMap(source => source.replacements);
  if (replacements.length > 1) return yield* Effect.fail(commerceError("invalidAuthority"));
  const changes = Object.freeze(sources.flatMap(source => source.changes));
  const dependencies = Object.freeze(sources.flatMap(source => source.dependencies));
  if (new Set(changes.map(row => row.documentId)).size !== changes.length ||
    new Set(dependencies.map(row => row.documentId)).size !== dependencies.length)
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const indexes = closedSources.flatMap(source => source.state.indexes);
  const unique = closedSources.flatMap(source => source.state.unique);
  const search = closedSources.flatMap(source => source.state.search);
  if (new Set(indexes.map(index => index.indexDefinitionId)).size !== indexes.length ||
    new Set(unique.map(constraint => constraint.uniqueConstraintDefinitionId)).size !== unique.length)
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const pages: LogicalDocumentChange[][] = [];
  const costs = new Map([...byTable.keys()].map(tableId => [tableId, {
    indexes: indexes.filter(index => index.access.kind === "developer" && index.access.tableId === tableId).length,
    unique: unique.filter(definition => definition.tableId === tableId).length,
  }]));
  for (const source of sources) {
    const sourcePages = yield* Effect.fromResult(planLogicalCommercePublicationPages(source.changes, source.closed.changes.attempts,
      source.closed.state.unique, costs, source.closed.maximumIdentities, source.closed.logicalPublication));
    if (sourcePages.length > 1 && source.replacements.length !== 0)
      return yield* Effect.fail(commerceError("limitExceeded"));
    for (const sourcePage of sourcePages) {
      const previous = pages.at(-1);
      const joined = previous === undefined ? sourcePage : [...previous, ...sourcePage];
      const joinedIndexes = joined.reduce((sum, row) => sum + (costs.get(row.tableId)?.indexes ?? 0), 0);
      const joinedUnique = joined.reduce((sum, row) => sum + (costs.get(row.tableId)?.unique ?? 0), 0);
      if (previous !== undefined && joined.length <= MAX_POINT_COMMIT_MATERIAL_ROWS_V1 &&
        joinedIndexes <= MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1 && joinedUnique <= MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1)
        previous.push(...sourcePage);
      else pages.push(sourcePage);
    }
  }
  const pagedRoot = pages.length > 1;
  if (pages.length > logicalMaterializationBatchBudget.pages)
    return yield* Effect.fail(commerceError("limitExceeded"));
  const hasDerived = sources.some(source => source.closed.changes.setNull.length !== 0) || replacements.length !== 0;
  const batch = hasDerived || pagedRoot;
  const requireAdmission = Effect.forEach(sources, source => source.admitted, { discard: true });
  const core = yield* enterLogicalDocumentMaterialization({ coverage: "sourceBound", ...(batch ? { batch: true as const } : {}),
    command: { authorityPins: { deploymentId: TransactionGrantDeploymentIdV1Schema.make(state.authority.deploymentId),
      scopeId: scope.scopeId, schemaVersionId: state.schemaVersionId }, rowIntents: [...byTable.keys()].map(tableId => ({ tableId })) },
    sourceSchemaVersionByTable, sourceOrdinalByTable: byTable,
    // Retain the full selected build union, including unchanged source tables.
    intrinsic: indexes.filter(index => index.access.kind === "by_creation_time"), developer: indexes.filter(index => index.access.kind === "developer"),
    unique, search, relations: null, options: {}, requireAdmission,
    validateWrites: (_, rows) => Effect.forEach(rows, row => {
      const ordinal = byTable.get(row.tableId);
      const source = ordinal === undefined ? undefined : closedSources[ordinal];
      if (source === undefined) return Effect.fail(commerceError("invalidAuthority"));
      return row.kind === "deleted" ? Effect.void : Effect.fromResult(source.state.values.validate(row.tableId, row.document))
        .pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    }, { discard: true }),
  }, tx, state.authority, clock).pipe(Effect.mapError(projectCommerceRequestFailure));
  const firstPage = pages[0];
  if (firstPage === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  // All original points, including coalesced and read-only observations from
  // later sources, are accepted before the root creates its publication prefix.
  const firstDelta = yield* core.prepareDelta(firstPage, dependencies).pipe(Effect.mapError(projectCommerceRequestFailure));
  // Accept every page before any write. Connected unique-key transfers remain
  // in one packet, whose unique owner releases all old claims before claiming.
  const remainingDeltas = yield* Effect.forEach(pages.slice(1), rows => core.prepareDelta(rows, rows)
    .pipe(Effect.mapError(projectCommerceRequestFailure), Effect.map(delta => ({ rows, delta }))));
  const derivedIds = Object.freeze(replacements.flatMap(({ selection }) => [...selection.detach, ...selection.associate].map(row => row.key)));
  const materialize = Effect.fn("LogicalCommerce.materializePublication")(function* (
    commitSeq: CommitSeq, appendRows: (rows: readonly Pick<LogicalDocumentChange, "tableId" | "rowId">[]) => Effect.Effect<void, CommerceTransactionError>,
  ) {
    const sourceRows = closedSources.map(() => 0);
    // Feed ordinals are source-owned. The physical union has no row ordinal;
    // retain only bounded identities to emit the former source/derived order.
    const derivedFacts = closedSources.map((): Pick<LogicalDocumentChange, "tableId" | "rowId">[] => []);
    let rowCount = 0;
    const adjacencyChanges: Array<Effect.Success<ReturnType<typeof firstDelta.lower>>[number]> = [];
    const lower = Effect.fn("LogicalCommerce.lowerPublicationPage")(function* (
      rows: readonly LogicalDocumentChange[], delta: typeof firstDelta,
    ) {
      for (const row of rows) {
        const ordinal = byTable.get(row.tableId);
        const source = ordinal === undefined ? undefined : closedSources[ordinal];
        if (source === undefined || ordinal === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
        const count = (sourceRows[ordinal] ?? 0) + 1;
        if (count > source.maximumFacts) return yield* Effect.fail(commerceError("limitExceeded"));
        sourceRows[ordinal] = count;
      }
      adjacencyChanges.push(...yield* delta.lower(commitSeq).pipe(Effect.mapError(projectCommerceRequestFailure)));
      rowCount += rows.length;
    });
    yield* lower(firstPage, firstDelta);
    for (const { rows, delta } of remainingDeltas) yield* lower(rows, delta);
    // Native rows precede derived writes, so no original read can accidentally
    // validate against this root's own set-null or relationship replacement.
    for (const [ordinal, source] of sources.entries()) {
      const facts = derivedFacts[ordinal];
      if (facts === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
      for (const intent of source.closed.changes.setNull) yield* forEachLogicalSetNullPage({ tx, ...intent,
        requireAdmission: source.admitted, error: logicalCommerceError }, rows => Effect.gen(function* () {
          const delta = yield* core.prepareDelta(rows, rows).pipe(Effect.mapError(projectCommerceRequestFailure));
          yield* lower(rows, delta);
          facts.push(...rows.map(row => ({ tableId: row.tableId, rowId: row.rowId })));
        }));
      for (const { intent, selection } of source.replacements) {
        const loweredIds: string[] = [];
        yield* forEachLogicalReferenceReplacementPage({ tx, ...intent, selection, requireAdmission: source.admitted,
          error: logicalCommerceError }, (rows, keys) => Effect.gen(function* () {
            const delta = yield* core.prepareDelta(rows, rows).pipe(Effect.mapError(projectCommerceRequestFailure));
            yield* lower(rows, delta); loweredIds.push(...keys);
            facts.push(...rows.map(row => ({ tableId: row.tableId, rowId: row.rowId })));
          }));
        const pendingRows = new Set(selection.pendingChanges.map(change => change.rowId));
        const streamedIds = [...selection.detach, ...selection.associate].filter(row => !pendingRows.has(row.rowId)).map(row => row.key);
        if (loweredIds.length !== streamedIds.length || loweredIds.some((key, index) => key !== streamedIds[index]))
          return yield* Effect.fail(commerceError("invalidAuthority"));
      }
    }
    if (batch) yield* core.completeBatch().pipe(Effect.mapError(projectCommerceRequestFailure));
    for (const [ordinal, source] of sources.entries()) {
      const derived = derivedFacts[ordinal];
      if (derived === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
      const native = source.changes.map(row => ({ tableId: row.tableId, rowId: row.rowId }));
      const ordered = source.replacements.length === 0 ? [...derived, ...native] : [...native, ...derived];
      for (let offset = 0; offset < ordered.length; offset += MAX_POINT_COMMIT_MATERIAL_ROWS_V1)
        yield* appendRows(ordered.slice(offset, offset + MAX_POINT_COMMIT_MATERIAL_ROWS_V1));
    }
    return Object.freeze({ rowCount, adjacencyChanges: Object.freeze(adjacencyChanges) });
  });
  return Object.freeze({ changes, derivedIds, hasReferenceReplacement: replacements.length !== 0, materialize });
});
