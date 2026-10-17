import { hasLogicalInsertionEvidence, hasLogicalInsertionGraph, logicalInsertionGraphRoot } from "./insertionOrder";
import { Effect, Option } from "effect";
import {
  consumeAppTableWriteFrontiersInTransactionEffect,
  AppRowReadPersistenceError,
} from "../appRows";
import {
  consumeAppUniqueKeySlotsInTransactionEffect,
} from "../../unique/appUniqueKeys";
import {
  AppUniqueKeyPersistenceError,
  AppUniqueKeyHashError,
} from "../../unique/appUniqueKeyErrors";
import type { LogicalDocumentChanges } from "./workingSet";
import type { LogicalDocumentFailure } from "./model";
import type { FlarexMetadataTransaction } from "../../../database/metadataTransaction";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { CatalogTableId, CatalogIndexDefinitionId, CatalogIndexId } from "flarex-protocol/catalog";
import { isJsonObject } from "flarex-protocol/json";
import { consumeLogicalIndexRanges, consumeLogicalIndexPages, sameLogicalIndexMembership } from "./indexReads";
import { readLogicalSearchRange, sameLogicalSearchMembership } from "./searchReads";
import { readLogicalJsonContainsRange } from "./jsonContains";

export type LogicalDocumentConflictObservation =
  | Readonly<{ readKind: "tableScan"; dependencyOrdinal: number; tableId: CatalogTableId }>
  | Readonly<{ readKind: "unique"; dependencyOrdinal: number; constraintId: LogicalDocumentChanges["uniqueReads"][number]["constraintId"] }>
  | Readonly<{ readKind: "indexRange" | "indexPage"; dependencyOrdinal: number;
    tableId: CatalogTableId; indexDefinitionId: CatalogIndexDefinitionId }>
  | Readonly<{ readKind: "search" | "jsonContainment"; dependencyOrdinal: number;
    tableId: CatalogTableId; logicalIndexId: CatalogIndexId }>;

interface LogicalDocumentReadDependencyValidationInput<Failure> {
  readonly tx: FlarexMetadataTransaction;
  readonly scopeId: ScopeId;
  readonly tables: ReadonlySet<CatalogTableId>;
  readonly maximumIndexEntries: number;
  readonly error: LogicalDocumentFailure<Failure>;
  readonly conflict?: (observation: LogicalDocumentConflictObservation) => Failure;
}

/** Storage-only read-dependency validation. This grants no closed-graph or
 * write authority; the contribution owner authenticates its graph first. */
export const validateLogicalDocumentReadDependencies = Effect.fn("LogicalDocuments.validateReadDependencies")(
  function* <Failure>(input: LogicalDocumentReadDependencyValidationInput<Failure>,
    closed: Pick<LogicalDocumentChanges, "scans" | "uniqueReads" | "indexReads" | "searchReads" | "pageReads">) {
  const { tx, scopeId, tables: allowed, maximumIndexEntries, error } = input;
  const conflict = (observation: LogicalDocumentConflictObservation) =>
    input.conflict === undefined ? error("writeConflict") : input.conflict(Object.freeze(observation));
  // Broad/unindexed collection find reads the complete bounded table before filtering.
  // Its frontier includes tombstones, so empty results cannot lose insertions.
  const scans: (typeof closed.scans)[number][] = [];
  for (const scan of closed.scans) {
    if (!allowed.has(scan.tableId)) break;
    scans.push(scan);
  }
  yield* consumeAppTableWriteFrontiersInTransactionEffect(tx, scopeId, scans.map(scan => scan.tableId),
    cause => error(cause instanceof AppRowReadPersistenceError ? "statementFailure" : "storedCorruption", cause),
    (dependencyOrdinal, current) => Effect.gen(function* () {
    const scan = scans[dependencyOrdinal];
    if (scan === undefined) return yield* Effect.die(new Error("Logical frontier batch lost an ordinal"));
    if (current !== scan.frontier)
      return yield* Effect.fail(conflict({ readKind: "tableScan", dependencyOrdinal, tableId: scan.tableId }));
  }));
  if (scans.length !== closed.scans.length) return yield* Effect.fail(error("invalidAuthority"));
  // Retain unique lookup and eager uniqueness decisions even if a later operation removes the
  // final claim or coalesces the entire document away.
  yield* consumeAppUniqueKeySlotsInTransactionEffect(tx, closed.uniqueReads.map(read => ({
    scopeId, constraintId: read.constraintId, key: read.key,
  })), cause =>
        error(
          cause instanceof AppUniqueKeyPersistenceError
            ? "statementFailure"
            : cause instanceof AppUniqueKeyHashError
              ? "resourceFailure"
              : "storedCorruption",
          cause,
        ), (dependencyOrdinal, slot) => Effect.gen(function* () {
    const read = closed.uniqueReads[dependencyOrdinal];
    if (read === undefined) return yield* Effect.die(new Error("Logical unique batch lost an ordinal"));
    if (
      Option.isNone(slot)
        ? read.owner !== null
        : read.owner === null ||
          slot.value.tableId !== read.owner.tableId ||
          slot.value.rowId !== read.owner.rowId
    ) {
      return yield* Effect.fail(conflict({ readKind: "unique", dependencyOrdinal, constraintId: read.constraintId }));
    }
  }));
  const ranges: (typeof closed.indexReads)[number][] = [];
  for (const read of closed.indexReads) {
    if (read.definition.access.kind !== "developer" || !allowed.has(read.definition.access.tableId)) break;
    ranges.push(read);
  }
  yield* consumeLogicalIndexRanges(tx, scopeId, ranges, maximumIndexEntries, error, (dependencyOrdinal, current) => Effect.gen(function* () {
    const read = ranges[dependencyOrdinal];
    if (read === undefined) return yield* Effect.die(new Error("Logical range batch lost an ordinal"));
    if (!sameLogicalIndexMembership(read.entries, current)) return yield* Effect.fail(conflict({ readKind: "indexRange",
      dependencyOrdinal, tableId: read.definition.access.tableId, indexDefinitionId: read.definition.indexDefinitionId }));
  }));
  if (ranges.length !== closed.indexReads.length) return yield* Effect.fail(error("invalidAuthority"));
  for (const [dependencyOrdinal, read] of closed.searchReads.entries()) {
    if (!allowed.has(read.definition.tableId) || read.entries.length > 4096)
      return yield* Effect.fail(error("invalidAuthority"));
    const current = read.kind === "jsonContainment"
      ? yield* readLogicalJsonContainsRange(tx, scopeId, read.definition, read.column,
        read.value, maximumIndexEntries, error)
      : yield* readLogicalSearchRange(tx, scopeId, read.definition, read.patterns,
        maximumIndexEntries, error);
    if (!sameLogicalSearchMembership(read.entries, current)) return yield* Effect.fail(conflict({
      readKind: read.kind === "jsonContainment" ? "jsonContainment" : "search", dependencyOrdinal,
      tableId: read.definition.tableId, logicalIndexId: read.definition.logicalIndexId }));
  }
  const pages: (typeof closed.pageReads)[number][] = [];
  for (const read of closed.pageReads) {
    if (read.definition.access.kind !== "developer" || !allowed.has(read.definition.access.tableId) ||
      read.entries.length > maximumIndexEntries) break;
    pages.push(read);
  }
  yield* consumeLogicalIndexPages(tx, scopeId, pages, error, (dependencyOrdinal, current) => Effect.gen(function* () {
    const read = pages[dependencyOrdinal];
    if (read === undefined) return yield* Effect.die(new Error("Logical page batch lost an ordinal"));
    if (!sameLogicalIndexMembership(read.entries, current.entries) || read.isDone && !current.isDone)
      return yield* Effect.fail(conflict({ readKind: "indexPage", dependencyOrdinal,
        tableId: read.definition.access.tableId, indexDefinitionId: read.definition.indexDefinitionId }));
  }));
  if (pages.length !== closed.pageReads.length) return yield* Effect.fail(error("invalidAuthority"));
});

/** Validate the complete command, including decisions that did not produce writes. */
export const validateLogicalDocumentChanges = Effect.fn(
  "LogicalDocuments.validateContribution",
)(function* <Failure>(input: LogicalDocumentReadDependencyValidationInput<Failure> & Readonly<{
  allowSetNull?: true; allowReferenceReplacement?: true;
}>, closed: LogicalDocumentChanges) {
  const { scopeId, tables: allowed, error } = input;
  if (!hasLogicalInsertionGraph(scopeId, closed)) return yield* Effect.fail(error("invalidAuthority"));
  if ((closed.setNull.length !== 0 && input.allowSetNull !== true) ||
    (closed.referenceReplacements.length !== 0 && input.allowReferenceReplacement !== true))
    return yield* Effect.fail(error("invalidAuthority"));
  const reads = new Map(
    closed.dependencies.map((row) => [row.documentId, row]),
  );
  const changes = new Map(closed.changes.map((row) => [row.documentId, row]));
  const attempted = new Set([...changes.keys(), ...closed.noFinalRows]);
  if (
    reads.size !== closed.dependencies.length ||
    changes.size !== closed.changes.length ||
    attempted.size !== closed.changes.length + closed.noFinalRows.length ||
    closed.dependencies.some((row) => !allowed.has(row.tableId)) ||
    closed.changes.some(
      (row) => reads.get(row.documentId)?.dependency !== row.dependency,
    ) ||
    closed.noFinalRows.some((id) => {
      const point = reads.get(id);
      if (point?.dependency.kind === "generatedInsertion") return false;
      const observed = point?.dependency.observed;
      return (
        observed?.kind !== "missing" ||
        observed.basis.kind !== "noVisibleRevision"
      );
    }) ||
    closed.setNull.some(intent => !allowed.has(intent.sourceTableId) || !allowed.has(intent.targetTableId) ||
      !closed.changes.some(change => change.kind === "deleted" && change.tableId === intent.targetTableId)) ||
    closed.referenceReplacements.length > 1 ||
    closed.referenceReplacements.some(intent => !allowed.has(intent.sourceTableId) ||
      !allowed.has(intent.targetTableId) || intent.desiredKeys.length > 256 ||
      new Set(intent.desiredKeys).size !== intent.desiredKeys.length ||
      closed.setNull.length !== 0 ||
      !closed.changes.some(change => change.kind === "live" && change.tableId === intent.targetTableId &&
        isJsonObject(change.document.valueJson) && change.document.valueJson[intent.targetColumn] === intent.targetKey)) ||
    new Set(closed.setNull.map(intent => JSON.stringify([intent.sourceTableId, intent.sourceColumn,
      intent.targetTableId, intent.targetColumn, intent.targetKey]))).size !== closed.setNull.length ||
    closed.attempts.some(
      (attempt, index) =>
        attempt.ordinal !== index || !attempted.has(attempt.documentId),
    )
  ) {
    return yield* Effect.fail(error("invalidAuthority"));
  }
  const insertionRoot = logicalInsertionGraphRoot(closed);
  const insertionOrdinals = new Set<number>();
  for (const attempt of closed.attempts) {
    if (attempt.insertionAttemptOrdinal !== undefined && closed.insertionRoot !== insertionRoot ||
      !hasLogicalInsertionEvidence(scopeId, insertionRoot, attempt)) return yield* Effect.fail(error("invalidAuthority"));
    const ordinal = attempt.insertionAttemptOrdinal;
    if (ordinal === undefined) continue;
    if (attempt.operation !== "insert" || !Number.isSafeInteger(ordinal) || ordinal < 0 || insertionOrdinals.has(ordinal))
      return yield* Effect.fail(error("invalidAuthority"));
    insertionOrdinals.add(ordinal);
  }
  for (const change of closed.changes) {
    const generation = change.insertionOrder;
    const latestInsert = closed.attempts.findLast(attempt => attempt.documentId === change.documentId && attempt.operation === "insert");
    if (generation?.kind === "pending") {
      if (change.kind !== "live" || latestInsert?.insertionAttemptOrdinal !== generation.attemptOrdinal)
        return yield* Effect.fail(error("invalidAuthority"));
    } else if (change.kind === "live" && latestInsert?.insertionAttemptOrdinal !== undefined) return yield* Effect.fail(error("invalidAuthority"));
    if (generation !== undefined && (!Number.isSafeInteger(generation.attemptOrdinal) || generation.attemptOrdinal < 0))
      return yield* Effect.fail(error("invalidAuthority"));
  }
  const attemptedIds = new Set(closed.attempts.map(attempt => attempt.documentId));
  if ([...attempted].some(id => !attemptedIds.has(id))) return yield* Effect.fail(error("invalidAuthority"));
  for (const point of closed.dependencies) {
    if (point.dependency.kind !== "generatedInsertion") continue;
    if (point.dependency.origin !== undefined) continue;
    const first = closed.attempts.find(attempt => attempt.documentId === point.documentId);
    if (first?.ordinal !== point.dependency.effectOrdinal || first.operation !== "insert" || first.before !== null ||
      first.after === null || first.tableId !== point.tableId || point.dependency.documentId !== point.documentId)
      return yield* Effect.fail(error("invalidAuthority"));
  }
  yield* validateLogicalDocumentReadDependencies(input, closed);
  // Materialization requires the actual final-change objects in its dependency
  // set. Preserve every other observation instead of equating reads with writes.
  const dependencies = Object.freeze(
    closed.dependencies.map((row) => changes.get(row.documentId) ?? row),
  );
  return Object.freeze({ changes: closed.changes, dependencies });
});
