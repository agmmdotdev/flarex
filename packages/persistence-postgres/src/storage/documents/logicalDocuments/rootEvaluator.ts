import { captureLogicalInsertionGraph, registerLogicalInsertionRoot, issueLogicalInsertionAttempt, committedLogicalInsertionOrder } from "./insertionOrder";
import type { LogicalDocumentPointEvidence } from "./pointEvidence";
import type { AppDocumentIdV1, AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { AppCreationTimeV1Schema, type AppCreationTimeV1 } from "flarex-protocol/app-document";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import { compareUtf16Strings } from "@flarex/utils/strings";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { CommitSeq, ScopeId } from "flarex-protocol/storage-authority";
import { MAX_COMMIT_METADATA_READ_DEPENDENCIES,
  LogicalMetadataReadDependencySchema,
  type LogicalMetadataKey, type LogicalMetadataReadDependency, type MetadataSequence } from "flarex-protocol/commit-protocol";
import { Data, Effect, Option, Result, Schema } from "effect";
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import type { OrderedIndexBoundsV1, OrderedIndexKeyHexV1 } from "flarex-protocol/ordered-index";
import { isLocatedAppIndexDefinitionV1, sameLocatedAppIndexDefinition,
  type LocatedAppIndexDefinitionV1 } from "../../indexes/locatedAppIndexDefinition";
import type { CatalogIndexDefinitionId } from "flarex-protocol/catalog";
import type { ApplicationDocumentObservation } from "../../materialization/model";
import type { AppRowReadResultV1, LiveAppRowRevisionV1 } from "../appRows";
import type {
  SessionJournalAttempt,
} from "../../../execution/journal/contracts";
import type { LogicalIndexRead, LogicalIndexPageRead } from "./indexReads";
import type { LogicalSearchRead } from "./searchReads";
import { appDocumentIdV1FromRowIdentity } from "flarex-protocol/app-document-id";
import { isJsonObject } from "flarex-protocol/json";
import { detachLogicalDocumentChanges, detachLogicalDocumentRootChanges } from "./detachChanges";
import { protectLogicalCanonicalDocument, detachLogicalCanonicalRevision, forgetLogicalCanonicalDerivedKeys,
  hasRetainedLogicalCanonicalIndexKey } from "./relationalRows";
import { retainDetachedLogicalRealWriteAttempt } from "./realWriteEvidence";
import { captureFiniteMetadataDependency, matchesFiniteMetadataDependencyObservation, finiteMetadataDependencyIdentity,
  type PreparedFiniteMetadataProjection, type FiniteMetadataError } from "../../../execution/finiteMetadataDependencies";
import type { LogicalDocumentAttempt, LogicalDocumentChanges, LogicalDocumentObservedRow,
  LogicalRelationalLifecycleObservation, LogicalRelationalReadObservation, LogicalReferenceReplacementIntent, LogicalSetNullIntent,
  LogicalUniqueRead, PendingDocument } from "./workingSet";

export interface LogicalDocumentRootEvaluator {
  readonly snapshot: () => LogicalDocumentChanges;
  readonly snapshotOriginalRows: () => Result.Result<readonly LiveAppRowRevisionV1[], LogicalDocumentRootPointFailure>;
  readonly attemptCount: () => number;
  readonly point: (tableId: CatalogTableId, rowId: AppRowIdHexV1) => LogicalDocumentRootPoint | undefined;
  readonly points: (tableId?: CatalogTableId) => readonly LogicalDocumentRootPoint[];
  readonly observePoint: (tableName: string, observation: ApplicationDocumentObservation,
    revision: AppRowReadResultV1) => Result.Result<void, LogicalDocumentRootPointFailure>;
  readonly writePoint: (tableName: string, observation: LogicalDocumentPointEvidence,
    overlay: Readonly<{ kind: "live"; creationTime: AppCreationTimeV1; document: CanonicalFlarexValueV1 }> |
      Readonly<{ kind: "deleted" }>, operation: LogicalDocumentAttempt["operation"]) => Result.Result<void, LogicalDocumentRootPointFailure>;
  readonly forgetUnwrittenPoint: (tableId: CatalogTableId, rowId: AppRowIdHexV1) => void;
  readonly close: () => void;
}

export class LogicalDocumentRootLimitError extends Data.TaggedError("LogicalDocumentRootLimitError")<{
  readonly resource: "workingBytes" | "identities";
  readonly observed: number;
  readonly maximum: number;
}> {}
export type LogicalDocumentRootPointFailure = "closed" | "limitExceeded" | "observationMismatch" | "invalidDocument" | LogicalDocumentRootLimitError;
/** Restricted projection of the one original observation and current pending value. */
export interface LogicalDocumentRootPoint {
  readonly observation: LogicalDocumentPointEvidence;
  readonly originalDocument: CanonicalFlarexValueV1 | null;
  readonly document: CanonicalFlarexValueV1 | null;
  readonly creationTime: AppCreationTimeV1 | undefined;
  readonly written: boolean;
}

export interface LogicalDocumentRootPins {
  readonly attempt: SessionJournalAttempt;
  readonly scopeId: ScopeId;
  readonly snapshotCommitSeq: CommitSeq;
  readonly attemptFence: string;
  readonly metadataWatermark?: MetadataSequence;
}

export interface LogicalDocumentRootLimits {
  readonly identities: number;
  readonly workingBytes: number;
}

/** First accepted-write retention, separate from document/attempt envelopes. */
export const LOGICAL_DOCUMENT_ROOT_WRITTEN_IDENTITY_BYTES = 128;
export const LOGICAL_DOCUMENT_ROOT_WRITTEN_TABLE_BYTES = 64;

/** Private finite evidence stays on the existing pending entry. Missing and
 * tombstone originals need only their exact dependency for current-head OCC. */
interface RootPendingDocument extends PendingDocument {
  readonly originalRevision?: LiveAppRowRevisionV1;
}

export interface LogicalDocumentRootState {
  readonly derivedKeyDocuments: Set<CanonicalFlarexValueV1>;
  readonly pins: LogicalDocumentRootPins;
  readonly limits: LogicalDocumentRootLimits;
  readonly rows: ReadonlyMap<AppDocumentIdV1, RootPendingDocument>;
  readonly scanned: Map<CatalogTableId, CommitSeq>;
  readonly dependencies: Map<AppDocumentIdV1, LogicalDocumentPointEvidence>;
  readonly metadataDependencies: Map<string, LogicalMetadataReadDependency>;
  readonly metadataConsumptions: Map<PreparedFiniteMetadataProjection, Map<string, LogicalMetadataReadDependency>>;
  readonly scans: Map<CatalogTableId, CommitSeq | null>;
  readonly uniqueReads: Map<string, LogicalUniqueRead>;
  readonly indexReads: Map<string, LogicalIndexRead>;
  readonly pageReads: LogicalIndexPageRead[];
  readonly searchReads: LogicalSearchRead[];
  readonly attempts: readonly LogicalDocumentAttempt[];
  readonly lifecycle: LogicalRelationalLifecycleObservation[];
  readonly relationalReads: LogicalRelationalReadObservation[];
  readonly setNull: LogicalSetNullIntent[];
  readonly referenceReplacements: LogicalReferenceReplacementIntent[];
  /** Accepted shared-root writes, independent of hydration/read activity. */
  readonly overlayWriteGenerations: Map<CatalogTableId, number>;
  workingBytes: number;
  inserted: number;
  activityGeneration: number;
  ownedSnapshot?: (() => LogicalDocumentChanges) | undefined;
  closed: boolean;
}

type MutableRootPendingDocument = Omit<{ -readonly [Key in keyof RootPendingDocument]: RootPendingDocument[Key] }, "attempts"> & {
  readonly attempts: number[];
};

/** The original collection order is observable when two keys fail lowering. */
class RootEncounterMap<Key, Value> extends Map<Key, Value> {
  readonly #ordinals = new Map<Key, number>();
  #next = 0;
  override set(key: Key, value: Value): this {
    if (!this.has(key)) this.#ordinals.set(key, this.#next++);
    return super.set(key, value);
  }
  override delete(key: Key): boolean { this.#ordinals.delete(key); return super.delete(key); }
  override clear(): void { this.#ordinals.clear(); this.#next = 0; super.clear(); }
  ordinal(key: Key): number | undefined { return this.#ordinals.get(key); }
}

interface RootOwnedState {
  readonly rows: RootEncounterMap<AppDocumentIdV1, MutableRootPendingDocument>;
  readonly rowViews: WeakMap<MutableRootPendingDocument, RootPendingDocument>;
  readonly dependencies: RootEncounterMap<AppDocumentIdV1, LogicalDocumentPointEvidence>;
  readonly attempts: LogicalDocumentAttempt[];
  readonly written: Map<CatalogTableId, RootWrittenTable>;
  readonly indexes: Map<CatalogIndexDefinitionId, RootPendingIndexState>;
  currentDocuments: WeakMap<CanonicalFlarexValueV1, MutableRootPendingDocument>;
}
interface RootPendingIndexState {
  readonly definition: LocatedAppIndexDefinitionV1;
  tree: BTree<RootPendingPositionKey, LogicalDocumentRootPendingPosition>;
  readonly locators: Map<AppDocumentIdV1, RootPendingIndexLocator>;
  applied: number;
  retainedBytes: number;
}
interface RootPendingIndexLocator {
  readonly key: OrderedIndexKeyHexV1 | null;
  readonly document: CanonicalFlarexValueV1 | null;
  readonly creationTime: AppCreationTimeV1;
  readonly ordinal: number;
}
interface RootPendingPositionKey { readonly encodedKey: string; readonly rowId: string }
interface RootWrittenTable {
  readonly identities: BTree<AppRowIdHexV1, true>;
  readonly nativeOrder: BTree<number, AppDocumentIdV1>;
}
const ownedRoots = new WeakMap<LogicalDocumentRootState, RootOwnedState>();

/** One ingestion owns one protected body identity across base/current/original.
 * Mutable caller originals are deduplicated only within this capture. */
const protectRootPendingRow = (pending: PendingDocument & Readonly<{ originalRevision?: LiveAppRowRevisionV1 }>): MutableRootPendingDocument => {
  const documents = new Map<CanonicalFlarexValueV1, CanonicalFlarexValueV1>();
  const protect = (document: CanonicalFlarexValueV1) => {
    const previous = documents.get(document);
    if (previous !== undefined) return previous;
    const captured = protectLogicalCanonicalDocument(document);
    documents.set(document, captured);
    return captured;
  };
  const base = pending.base?.kind === "live" ? Object.freeze({ ...pending.base, document: protect(pending.base.document) }) : pending.base;
  const original = pending.originalRevision;
  return { ...pending, base, current: pending.current === null ? null : protect(pending.current), attempts: [...pending.attempts],
    ...(pending.deletedValue === undefined ? {} : { deletedValue: protect(pending.deletedValue) }),
    ...(original === undefined ? {} : { originalRevision: Object.freeze({ ...original, document: protect(original.document) }) }),
  };
};

const readonlyRootAttempts = <Value>(attempts: Value[]): readonly Value[] => new Proxy(attempts, {
  set: () => false, deleteProperty: () => false, defineProperty: () => false,
  setPrototypeOf: () => false, preventExtensions: () => false,
});

const rootRowView = (owned: RootOwnedState, row: MutableRootPendingDocument): RootPendingDocument => {
  const previous = owned.rowViews.get(row);
  if (previous !== undefined) return previous;
  const attempts = readonlyRootAttempts(row.attempts);
  const view: RootPendingDocument = Object.freeze({ ...row,
    get current() { return row.current; }, get attempts() { return attempts; },
    get deletedValue() { return row.deletedValue; },
    get insertionOrder() { return row.insertionOrder; },
    get borrowedOverlay() { return row.borrowedOverlay; },
  });
  owned.rowViews.set(row, view);
  return view;
};

/** No mutable Map or retained row setter crosses the native borrowing boundary. */
const rootRowsView = (owned: RootOwnedState): ReadonlyMap<AppDocumentIdV1, RootPendingDocument> => {
  const entries = function* (): Generator<[AppDocumentIdV1, RootPendingDocument], undefined, unknown> {
    for (const [id, row] of owned.rows) yield [id, rootRowView(owned, row)];
  };
  const view: ReadonlyMap<AppDocumentIdV1, RootPendingDocument> = Object.freeze({
    get size() { return owned.rows.size; },
    get: (id: AppDocumentIdV1) => { const row = owned.rows.get(id); return row === undefined ? undefined : rootRowView(owned, row); },
    has: (id: AppDocumentIdV1) => owned.rows.has(id),
    keys: () => owned.rows.keys(), entries, [Symbol.iterator]: entries,
    values: function* (): Generator<RootPendingDocument, undefined, unknown> {
      for (const row of owned.rows.values()) yield rootRowView(owned, row);
    },
    forEach: (callback: (value: RootPendingDocument, key: AppDocumentIdV1, map: ReadonlyMap<AppDocumentIdV1, RootPendingDocument>) => void, thisArg?: unknown) => {
      for (const [id, row] of entries()) callback.call(thisArg, row, id, view);
    },
  });
  return view;
};

export interface LogicalDocumentRootPendingPosition {
  readonly encodedKey: OrderedIndexKeyHexV1;
  readonly rowId: AppRowIdHexV1;
  readonly documentId: AppDocumentIdV1;
  readonly document: CanonicalFlarexValueV1;
  readonly creationTime: AppCreationTimeV1;
}
export interface LogicalDocumentRootPendingIndex {
  readonly positions: readonly LogicalDocumentRootPendingPosition[];
  readonly writtenCount: number;
  readonly hasWritten: (rowId: AppRowIdHexV1) => boolean;
}
export interface LogicalDocumentRootPendingIndexInput<Failure> {
  readonly error: (failure: LogicalDocumentRootPointFailure) => Failure;
  readonly order: "application" | "native";
  readonly lower: (row: PendingDocument) => Result.Result<OrderedIndexKeyHexV1 | null, Failure>;
  /** Additional borrower-lifetime charge only; this owner always reserves root
   * bytes itself. Application supplies a no-op when there is no native lifetime. */
  readonly charge: (bytes: number) => Result.Result<void, Failure>;
  readonly bounds?: OrderedIndexBoundsV1;
  readonly after?: Readonly<{ encodedKey: string; rowId: AppRowIdHexV1 }>;
  readonly limit?: number;
}

const roots = new WeakMap<LogicalDocumentRootEvaluator, LogicalDocumentRootState>();
const closedRootBrand: unique symbol = Symbol("Flarex/ClosedLogicalDocumentRoot");
export interface ClosedLogicalDocumentRoot { readonly [closedRootBrand]: true }
interface ClosedRootData {
  readonly evaluator: LogicalDocumentRootEvaluator;
  readonly pins: LogicalDocumentRootPins;
  readonly graph: LogicalDocumentChanges;
  readonly originalRows: readonly LiveAppRowRevisionV1[];
}
const closedRoots = new WeakMap<ClosedLogicalDocumentRoot, ClosedRootData>();
const decodeAppCreationTimeResult = Schema.decodeUnknownResult(AppCreationTimeV1Schema);

/** Native hydration lends an already observed row; it never records a write. */
export function observeLogicalDocumentRootRow(state: LogicalDocumentRootState,
  pending: PendingDocument & Readonly<{ originalRevision?: LiveAppRowRevisionV1 }>):
  Result.Result<PendingDocument, LogicalDocumentRootPointFailure> {
  const owned = ownedRoots.get(state);
  if (state.closed || owned === undefined) return Result.fail("closed");
  const existing = owned.rows.get(pending.documentId);
  if (existing !== undefined) return Result.succeed(rootRowView(owned, existing));
  const observation = state.dependencies.get(pending.documentId);
  if (pending.attempts.length !== 0 || observation === undefined || observation.tableId !== pending.tableId ||
    observation.rowId !== pending.rowId || observation.readAt !== state.pins.snapshotCommitSeq ||
    pending.documentId !== appDocumentIdV1FromRowIdentity(pending)) return Result.fail("observationMismatch");
  const row = protectRootPendingRow(pending);
  owned.rows.set(row.documentId, row);
  if (row.current !== null) owned.currentDocuments.set(row.current, row);
  return Result.succeed(rootRowView(owned, row));
}

/** All admitted Application/native transitions reach this single synchronous
 * publication. The optional charge covers the borrower's lifetime only. */
export function acceptLogicalDocumentRootWrite<Failure>(state: LogicalDocumentRootState,
  pending: PendingDocument, attempt: LogicalDocumentAttempt,
  error: (failure: LogicalDocumentRootPointFailure) => Failure,
  charge?: (bytes: number) => Result.Result<void, Failure>): Result.Result<void, Failure> {
  return Result.gen(function* () {
    const owned = ownedRoots.get(state);
    if (state.closed || owned === undefined) return yield* Result.fail(error("closed"));
    const original = owned.rows.get(pending.documentId);
    const observation = state.dependencies.get(pending.documentId);
    const sourceBefore = original === undefined ? pending.current : original.current;
    const capturedAttempt = Object.isFrozen(attempt) ? attempt : Object.freeze({ ...attempt });
    if (observation === undefined || observation.tableId !== pending.tableId || observation.rowId !== pending.rowId ||
      pending.documentId !== appDocumentIdV1FromRowIdentity(pending) || capturedAttempt.ordinal !== owned.attempts.length ||
      capturedAttempt.documentId !== pending.documentId || capturedAttempt.tableId !== pending.tableId || capturedAttempt.before !== sourceBefore ||
      original !== undefined && pending !== rootRowView(owned, original) || original === undefined && pending.attempts.length !== 0)
      return yield* Result.fail(error("observationMismatch"));
    const sourceAfter = capturedAttempt.after;
    if (sourceAfter !== null && (!isJsonObject(sourceAfter.valueJson) || sourceAfter.valueJson._id !== pending.documentId ||
      sourceAfter.valueJson._creationTime !== pending.creationTime) || capturedAttempt.operation === "insert" && sourceAfter === null)
      return yield* Result.fail(error("invalidDocument"));
    const previousWritten = owned.written.get(pending.tableId);
    const firstWrite = previousWritten?.identities.has(pending.rowId) !== true;
    const bytes = firstWrite ? LOGICAL_DOCUMENT_ROOT_WRITTEN_IDENTITY_BYTES +
      (previousWritten === undefined ? LOGICAL_DOCUMENT_ROOT_WRITTEN_TABLE_BYTES : 0) : 0;
    if (bytes > state.limits.workingBytes - state.workingBytes)
      return yield* Result.fail(error(new LogicalDocumentRootLimitError({ resource: "workingBytes",
        observed: state.workingBytes + bytes, maximum: state.limits.workingBytes })));
    const generation = state.activityGeneration, attemptEnd = owned.attempts.length;
    if (charge !== undefined && bytes > 0) yield* charge(bytes);
    if (state.closed || state.activityGeneration !== generation || owned.attempts.length !== attemptEnd ||
      original !== undefined && original.current !== sourceBefore)
      return yield* Result.fail(error(state.closed ? "closed" : "observationMismatch"));
    if (bytes > state.limits.workingBytes - state.workingBytes)
      return yield* Result.fail(error(new LogicalDocumentRootLimitError({ resource: "workingBytes",
        observed: state.workingBytes + bytes, maximum: state.limits.workingBytes })));
    const row = original ?? protectRootPendingRow(pending);
    const after = sourceAfter === null ? null : protectLogicalCanonicalDocument(sourceAfter);
    const retainedAttempt = Object.isFrozen(attempt) && attempt.before === row.current && attempt.after === after
      ? attempt : Object.freeze({ ...capturedAttempt, before: row.current, after });
    if (retainedAttempt !== attempt) retainDetachedLogicalRealWriteAttempt(attempt, retainedAttempt);
    if (state.closed || state.activityGeneration !== generation || owned.attempts.length !== attemptEnd ||
      original !== undefined && original.current !== sourceBefore)
      return yield* Result.fail(error(state.closed ? "closed" : "observationMismatch"));
    if (row.current !== null && row.current !== after && (row.base?.kind !== "live" || row.current !== row.base.document)) {
      forgetLogicalCanonicalDerivedKeys(row.current, state.derivedKeyDocuments);
      state.derivedKeyDocuments.delete(row.current);
    }
    if (retainedAttempt.operation === "delete" && row.current !== null) row.deletedValue = row.current;
    if (retainedAttempt.insertionAttemptOrdinal !== undefined)
      row.insertionOrder = Object.freeze({ kind: "pending", attemptOrdinal: retainedAttempt.insertionAttemptOrdinal });
    row.attempts.push(retainedAttempt.ordinal);
    row.current = after;
    owned.rows.set(row.documentId, row);
    if (after !== null) owned.currentDocuments.set(after, row);
    owned.attempts.push(retainedAttempt);
    if (firstWrite) {
      const written = previousWritten ?? { identities: new BTree<AppRowIdHexV1, true>(undefined, compareUtf16Strings),
        nativeOrder: new BTree<number, AppDocumentIdV1>(undefined, (left, right) => left - right) };
      const ordinal = owned.rows.ordinal(row.documentId);
      if (ordinal === undefined) throw new Error("Accepted logical root row lost its encounter order");
      written.identities.set(row.rowId, true);
      written.nativeOrder.set(ordinal, row.documentId);
      if (previousWritten === undefined) owned.written.set(row.tableId, written);
    }
    state.workingBytes += bytes;
    state.overlayWriteGenerations.set(row.tableId, (state.overlayWriteGenerations.get(row.tableId) ?? 0) + 1);
    state.activityGeneration++;
  });
}

export function logicalDocumentRootWrittenCount(state: LogicalDocumentRootState, tableId: CatalogTableId):
  Result.Result<number, LogicalDocumentRootPointFailure> {
  const owned = ownedRoots.get(state);
  return state.closed || owned === undefined ? Result.fail("closed") : Result.succeed(owned.written.get(tableId)?.identities.size ?? 0);
}

/** Native candidate checks still run in their original row encounter order. */
export function logicalDocumentRootWrittenRows(state: LogicalDocumentRootState, tableId: CatalogTableId):
  Result.Result<readonly PendingDocument[], LogicalDocumentRootPointFailure> {
  const owned = ownedRoots.get(state);
  if (state.closed || owned === undefined) return Result.fail("closed");
  const rows: PendingDocument[] = [];
  for (const [, id] of owned.written.get(tableId)?.nativeOrder.entries() ?? []) {
    const row = owned.rows.get(id);
    if (row === undefined) return Result.fail("observationMismatch");
    rows.push(rootRowView(owned, row));
  }
  return Result.succeed(Object.freeze(rows));
}

const comparePendingPosition = (left: RootPendingPositionKey, right: RootPendingPositionKey): number =>
  compareUtf16Strings(left.encodedKey, right.encodedKey) || compareUtf16Strings(left.rowId, right.rowId);

/** Register only already admitted immutable catalogue mechanics. This grants
 * neither index readiness nor permission to read their committed membership. */
export function registerLogicalDocumentRootIndexes<Failure>(state: LogicalDocumentRootState,
  definitions: readonly LocatedAppIndexDefinitionV1[], options: Readonly<{
    error: (failure: LogicalDocumentRootPointFailure) => Failure;
    charge?: (bytes: number) => Result.Result<void, Failure>;
  }>): Result.Result<void, Failure> {
  return Result.gen(function* () {
    const owned = ownedRoots.get(state);
    if (state.closed || owned === undefined) return yield* Result.fail(options.error("closed"));
    const additions = new Map<CatalogIndexDefinitionId, RootPendingIndexState>();
    let bytes = 0;
    for (const definition of definitions) {
      if (!isLocatedAppIndexDefinitionV1(definition) || definition.scopeId !== state.pins.scopeId)
        return yield* Result.fail(options.error("observationMismatch"));
      const existing = owned.indexes.get(definition.indexDefinitionId) ?? additions.get(definition.indexDefinitionId);
      if (existing !== undefined) {
        if (!sameLocatedAppIndexDefinition(existing.definition, definition)) return yield* Result.fail(options.error("observationMismatch"));
        continue;
      }
      additions.set(definition.indexDefinitionId, { definition,
        tree: new BTree<RootPendingPositionKey, LogicalDocumentRootPendingPosition>(undefined, comparePendingPosition),
        locators: new Map(), applied: 0, retainedBytes: 0 });
      // The admitted source already owns the immutable definition payload.
      // Retain only this root's registry/tree-header references and metadata.
      bytes += 256;
    }
    if (bytes > state.limits.workingBytes - state.workingBytes)
      return yield* Result.fail(options.error(new LogicalDocumentRootLimitError({ resource: "workingBytes",
        observed: state.workingBytes + bytes, maximum: state.limits.workingBytes })));
    const generation = state.activityGeneration, registrySize = owned.indexes.size;
    if (options.charge !== undefined && bytes > 0) yield* options.charge(bytes);
    if (state.closed || state.activityGeneration !== generation || owned.indexes.size !== registrySize)
      return yield* Result.fail(options.error(state.closed ? "closed" : "observationMismatch"));
    if (bytes > state.limits.workingBytes - state.workingBytes)
      return yield* Result.fail(options.error(new LogicalDocumentRootLimitError({ resource: "workingBytes",
        observed: state.workingBytes + bytes, maximum: state.limits.workingBytes })));
    for (const [id, index] of additions) {
      const existing = owned.indexes.get(id);
      if (existing !== undefined && !sameLocatedAppIndexDefinition(existing.definition, index.definition))
        return yield* Result.fail(options.error("observationMismatch"));
    }
    for (const [id, index] of additions) if (!owned.indexes.has(id)) owned.indexes.set(id, index);
    state.workingBytes += bytes;
  });
}

const registeredRootIndex = (state: LogicalDocumentRootState, definition: LocatedAppIndexDefinitionV1):
  Result.Result<Readonly<{ owned: RootOwnedState; index: RootPendingIndexState | undefined }>, LogicalDocumentRootPointFailure> => {
  const owned = ownedRoots.get(state);
  if (state.closed || owned === undefined) return Result.fail("closed");
  if (!isLocatedAppIndexDefinitionV1(definition) || definition.scopeId !== state.pins.scopeId)
    return Result.fail("observationMismatch");
  const index = owned.indexes.get(definition.indexDefinitionId);
  return index !== undefined && !sameLocatedAppIndexDefinition(index.definition, definition)
    ? Result.fail("observationMismatch") : Result.succeed({ owned, index });
};

/** A current-body hint only; callers still own integrity, native retention and
 * error mapping. Absence is distinct from a qualified sparse null key. */
export function lookupLogicalDocumentRootPendingKey(state: LogicalDocumentRootState, definition: LocatedAppIndexDefinitionV1,
  document: CanonicalFlarexValueV1, creationTime: AppCreationTimeV1):
  Result.Result<Option.Option<OrderedIndexKeyHexV1 | null>, LogicalDocumentRootPointFailure> {
  return registeredRootIndex(state, definition).pipe(Result.flatMap(({ owned, index }) => {
    const row = owned.currentDocuments.get(document);
    if (index === undefined || row === undefined || row.current !== document) return Result.succeed(Option.none());
    if (row.creationTime !== creationTime || row.tableId !== definition.access.tableId) return Result.fail("observationMismatch" as const);
    const retained = index.locators.get(row.documentId), last = row.attempts.at(-1);
    return Result.succeed(retained !== undefined && last !== undefined && retained.ordinal === last &&
      retained.document === document && retained.creationTime === creationTime && index.applied > last ? Option.some(retained.key) : Option.none());
  }));
}

/** Preserve the complete native lifetime charge. An already retained exact root
 * key owns its string payload once; this new canonical cache owns its metadata. */
export function retainLogicalDocumentRootIndexKey<Failure>(state: LogicalDocumentRootState, definition: LocatedAppIndexDefinitionV1,
  document: CanonicalFlarexValueV1, creationTime: AppCreationTimeV1, key: OrderedIndexKeyHexV1 | null, bytes: number,
  options: Readonly<{ error: (failure: LogicalDocumentRootPointFailure) => Failure;
    charge: (bytes: number) => Result.Result<void, Failure> }>): Result.Result<void, Failure> {
  return Result.gen(function* () {
    const retained = yield* lookupLogicalDocumentRootPendingKey(state, definition, document, creationTime).pipe(Result.mapError(options.error));
    const retainedPayload = Option.match(retained, { onNone: () => false, onSome: value => value === key });
    const owned = ownedRoots.get(state), row = owned?.currentDocuments.get(document);
    const index = owned?.indexes.get(definition.indexDefinitionId);
    // This is resource ownership after genuine interpretation, not a hint that
    // the previous body's key is valid for a newly accepted body. Keep the
    // stricter body/write-ordinal qualification in lookup above unchanged.
    const previousPayload = key !== null && row?.current === document && row.creationTime === creationTime &&
      row.tableId === definition.access.tableId && index?.locators.get(row.documentId)?.key === key &&
      index.tree.has({ encodedKey: key, rowId: row.rowId });
    const rootBytes = bytes - (key !== null && (retainedPayload || previousPayload) ? key.length * 2 : 0);
    if (!Number.isSafeInteger(rootBytes) || rootBytes < 0) return yield* Result.fail(options.error("observationMismatch"));
    if (rootBytes > state.limits.workingBytes - state.workingBytes)
      return yield* Result.fail(options.error(new LogicalDocumentRootLimitError({ resource: "workingBytes",
        observed: state.workingBytes + rootBytes, maximum: state.limits.workingBytes })));
    const generation = state.activityGeneration;
    yield* options.charge(bytes);
    if (state.closed || state.activityGeneration !== generation)
      return yield* Result.fail(options.error(state.closed ? "closed" : "observationMismatch"));
    if (rootBytes > state.limits.workingBytes - state.workingBytes)
      return yield* Result.fail(options.error(new LogicalDocumentRootLimitError({ resource: "workingBytes",
        observed: state.workingBytes + rootBytes, maximum: state.limits.workingBytes })));
    state.workingBytes += rootBytes;
  });
}

/** Coalesce only the accepted suffix, prepare a COW tree, then publish every
 * locator/tree/watermark change together. No iterator escapes this operation. */
export function readLogicalDocumentRootPendingIndex<Failure>(state: LogicalDocumentRootState,
  definition: LocatedAppIndexDefinitionV1, input: LogicalDocumentRootPendingIndexInput<Failure>):
  Result.Result<LogicalDocumentRootPendingIndex, Failure> {
  return Result.gen(function* () {
    const { owned, index } = yield* registeredRootIndex(state, definition).pipe(Result.mapError(input.error));
    if (index === undefined || input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 0))
      return yield* Result.fail(input.error("observationMismatch"));
    const end = owned.attempts.length, applied = index.applied, oldTree = index.tree;
    const generation = state.activityGeneration, affected = new Set<AppDocumentIdV1>();
    for (let ordinal = applied; ordinal < end; ordinal++) {
      const attempt = owned.attempts[ordinal];
      if (attempt === undefined || attempt.ordinal !== ordinal) return yield* Result.fail(input.error("observationMismatch"));
      if (attempt.tableId === definition.access.tableId) affected.add(attempt.documentId);
    }
    const order = input.order === "application" ? owned.dependencies : owned.rows;
    const rows: Readonly<{ row: MutableRootPendingDocument; encounter: number }>[] = [];
    for (const id of affected) {
      const row = owned.rows.get(id);
      const encounter = order.ordinal(id);
      if (row === undefined || encounter === undefined) return yield* Result.fail(input.error("observationMismatch"));
      rows.push({ row, encounter });
    }
    rows.sort((left, right) => left.encounter - right.encounter);
    const tree = oldTree.clone(), updates: Readonly<{ id: AppDocumentIdV1; locator: RootPendingIndexLocator }>[] = [];
    let retainedBytes = index.retainedBytes;
    for (const { row } of rows) {
      if (state.closed || state.activityGeneration !== generation || owned.attempts.length !== end)
        return yield* Result.fail(input.error(state.closed ? "closed" : "observationMismatch"));
      const previous = index.locators.get(row.documentId);
      const interpreted = row.current === null ? null : yield* input.lower(rootRowView(owned, row));
      const key = previous !== undefined && interpreted === previous.key ? previous.key : interpreted;
      const ordinal = row.attempts.at(-1);
      if (ordinal === undefined) return yield* Result.fail(input.error("observationMismatch"));
      if (previous?.key != null) tree.delete({ encodedKey: previous.key, rowId: row.rowId });
      if (key !== null && row.current !== null) tree.set({ encodedKey: key, rowId: row.rowId }, Object.freeze({
        encodedKey: key, rowId: row.rowId, documentId: row.documentId, document: row.current, creationTime: row.creationTime,
      }));
      if (previous === undefined) retainedBytes += 160;
      const payload = key === null || key === previous?.key || row.current === null || hasRetainedLogicalCanonicalIndexKey(definition,
        row.current, row.creationTime, state.derivedKeyDocuments, key) ? 0 : key.length * 2;
      // Charges already spent on earlier key versions are not refunded.
      retainedBytes += payload;
      updates.push({ id: row.documentId, locator: Object.freeze({ key, document: row.current, creationTime: row.creationTime, ordinal }) });
    }
    const bytes = Math.max(0, retainedBytes - index.retainedBytes);
    if (bytes > state.limits.workingBytes - state.workingBytes)
      return yield* Result.fail(input.error(new LogicalDocumentRootLimitError({ resource: "workingBytes",
        observed: state.workingBytes + bytes, maximum: state.limits.workingBytes })));
    if (bytes > 0) yield* input.charge(bytes);
    if (state.closed || state.activityGeneration !== generation || owned.attempts.length !== end || index.applied !== applied || index.tree !== oldTree)
      return yield* Result.fail(input.error(state.closed ? "closed" : "observationMismatch"));
    if (bytes > state.limits.workingBytes - state.workingBytes)
      return yield* Result.fail(input.error(new LogicalDocumentRootLimitError({ resource: "workingBytes",
        observed: state.workingBytes + bytes, maximum: state.limits.workingBytes })));
    const positions: LogicalDocumentRootPendingPosition[] = [];
    const start = input.after ?? (input.bounds?.startInclusive === undefined ? undefined :
      { encodedKey: input.bounds.startInclusive, rowId: "" });
    for (const [position, value] of tree.entries(start)) {
      if (input.bounds?.endExclusive !== undefined && compareUtf16Strings(position.encodedKey, input.bounds.endExclusive) >= 0) break;
      if (input.bounds?.startInclusive !== undefined && compareUtf16Strings(position.encodedKey, input.bounds.startInclusive) < 0 ||
        input.after !== undefined && comparePendingPosition(position, input.after) <= 0) continue;
      if (input.limit !== undefined && positions.length >= input.limit) break;
      positions.push(value);
    }
    const written = owned.written.get(definition.access.tableId)?.identities.clone();
    if (state.closed || state.activityGeneration !== generation || owned.attempts.length !== end || index.applied !== applied || index.tree !== oldTree)
      return yield* Result.fail(input.error(state.closed ? "closed" : "observationMismatch"));
    // All user callbacks have completed; only infallible private installs remain.
    index.tree = tree;
    for (const update of updates) index.locators.set(update.id, update.locator);
    index.applied = end;
    index.retainedBytes = retainedBytes;
    state.workingBytes += bytes;
    return Object.freeze({ positions: Object.freeze(positions), writtenCount: written?.size ?? 0,
      hasWritten: (rowId: AppRowIdHexV1) => written?.has(rowId) ?? false });
  });
}

const sameObservation = (left: LogicalDocumentPointEvidence, right: LogicalDocumentPointEvidence): boolean => {
  if (left.dependency.kind === "generatedInsertion" || right.dependency.kind === "generatedInsertion")
    return left.dependency.kind === "generatedInsertion" && right.dependency.kind === "generatedInsertion" &&
      left.documentId === right.documentId && left.tableId === right.tableId && left.rowId === right.rowId &&
      left.readAt === right.readAt && left.dependency.effectOrdinal === right.dependency.effectOrdinal;
  const a = left.dependency.observed, b = right.dependency.observed;
  return left.documentId === right.documentId && left.tableId === right.tableId && left.rowId === right.rowId &&
    left.dependency.documentId === right.dependency.documentId && left.readAt === right.readAt && a.kind === b.kind && (a.kind === "present" && b.kind === "present"
    ? a.revisionCommitSeq === b.revisionCommitSeq : a.kind === "missing" && b.kind === "missing" &&
      a.basis.kind === b.basis.kind && (a.basis.kind !== "tombstone" || b.basis.kind === "tombstone" &&
        a.basis.revisionCommitSeq === b.basis.revisionCommitSeq));
};

const originalRowsResult = (state: LogicalDocumentRootState):
  Result.Result<readonly LiveAppRowRevisionV1[], LogicalDocumentRootPointFailure> => {
    if (state.closed) return Result.fail("closed");
    const originals: LiveAppRowRevisionV1[] = [];
    for (const row of state.rows.values()) {
      if (row.attempts.length === 0) continue;
      const point = state.dependencies.get(row.documentId);
      const observed = point?.dependency.kind === "appRowPoint" ? point.dependency.observed : undefined;
      if (observed?.kind !== "present") continue;
      const revision = row.originalRevision;
      if (revision === undefined || revision.scopeId !== state.pins.scopeId || revision.tableId !== row.tableId ||
        revision.rowId !== row.rowId || revision.commitSeq !== observed.revisionCommitSeq ||
        row.base?.kind !== "live" || row.base.document !== revision.document ||
        row.base.commitSeq !== revision.commitSeq || row.creationTime !== revision.creationTime)
        return Result.fail("observationMismatch");
      originals.push(revision);
    }
    return Result.succeed(Object.freeze(originals.toSorted((a, b) =>
      a.tableId - b.tableId || a.rowId.localeCompare(b.rowId))));
};

/** Issued only by the trusted finite-attempt owner. No SQL resource is held. */
export const makeLogicalDocumentRootEvaluator = (pins: LogicalDocumentRootPins,
  limits: LogicalDocumentRootLimits): LogicalDocumentRootEvaluator => {
  const owned: RootOwnedState = { rows: new RootEncounterMap(), rowViews: new WeakMap(),
    dependencies: new RootEncounterMap(), attempts: [], written: new Map(), indexes: new Map(), currentDocuments: new WeakMap() };
  const state: LogicalDocumentRootState = {
    pins: Object.freeze({ ...pins }), limits: Object.freeze({ ...limits }), rows: rootRowsView(owned), scanned: new Map(), derivedKeyDocuments: new Set(),
    dependencies: owned.dependencies, metadataDependencies: new Map(), metadataConsumptions: new Map(), scans: new Map(), uniqueReads: new Map(), indexReads: new Map(),
    pageReads: [], searchReads: [], attempts: readonlyRootAttempts(owned.attempts), lifecycle: [], relationalReads: [], setNull: [], referenceReplacements: [],
    overlayWriteGenerations: new Map(), workingBytes: 0, inserted: 0, activityGeneration: 0, closed: false,
  };
  ownedRoots.set(state, owned);
  const insertionRoot = registerLogicalInsertionRoot(state, pins.scopeId);
  const snapshotOriginalRows: LogicalDocumentRootEvaluator["snapshotOriginalRows"] = () =>
    originalRowsResult(state).pipe(Result.map(rows => Object.freeze(structuredClone(rows))));
  const ownedSnapshot = (): LogicalDocumentChanges => {
    if (state.closed) throw new Error("Logical document root evaluator is closed");
    const changes: LogicalDocumentChanges["changes"][number][] = [];
    const observedRows: LogicalDocumentObservedRow[] = [];
    const noFinalRows: AppDocumentIdV1[] = [];
    for (const row of state.rows.values()) {
      if (row.current !== null) {
        if (!isJsonObject(row.current.valueJson)) throw new Error("Logical document root value is invalid");
        observedRows.push(Object.freeze({ documentId: row.documentId, tableId: row.tableId,
          tableName: row.tableName, value: row.current.valueJson }));
      }
      if (row.attempts.length === 0) continue;
      if (row.base === null && row.current === null) { noFinalRows.push(row.documentId); continue; }
      const dependency = state.dependencies.get(row.documentId);
      if (dependency === undefined) throw new Error("Logical document root dependency is missing");
      const insertionOrder = row.current === null ? committedLogicalInsertionOrder(row.base?.insertionOrder) : row.insertionOrder;
      changes.push(Object.freeze(row.current === null ? { ...dependency, kind: "deleted",
        ...(insertionOrder === undefined ? {} : { insertionOrder }) } :
        { ...dependency, kind: "live", creationTime: row.creationTime, document: row.current,
          ...(insertionOrder === undefined ? {} : { insertionOrder }) }));
    }
    changes.sort((left, right) => left.tableId - right.tableId || left.rowId.localeCompare(right.rowId));
    observedRows.sort((left, right) => left.tableId - right.tableId || left.documentId.localeCompare(right.documentId));
    noFinalRows.sort();
    return captureLogicalInsertionGraph(Object.freeze({ insertionRoot, changes: Object.freeze(changes), observedRows: Object.freeze(observedRows),
      noFinalRows: Object.freeze(noFinalRows), attempts: Object.freeze([...state.attempts]),
      lifecycle: Object.freeze([...state.lifecycle]),
      relationalReads: Object.freeze([...state.relationalReads]),
      dependencies: Object.freeze([...state.dependencies.values()].toSorted((a, b) => a.tableId - b.tableId || a.rowId.localeCompare(b.rowId))),
      ...(state.pins.metadataWatermark === undefined ? {} : {
        metadataWatermark: state.pins.metadataWatermark,
        metadataDependencies: Object.freeze([...state.metadataDependencies.values()].toSorted((a, b) =>
          compareUtf16Strings(finiteMetadataDependencyIdentity(a), finiteMetadataDependencyIdentity(b)))) }),
      scans: Object.freeze([...state.scans].map(([tableId, frontier]) => Object.freeze({ tableId, frontier }))),
      uniqueReads: Object.freeze([...state.uniqueReads.values()]), indexReads: Object.freeze([...state.indexReads.values()]),
      pageReads: Object.freeze([...state.pageReads]), searchReads: Object.freeze([...state.searchReads]),
      setNull: Object.freeze([...state.setNull]), referenceReplacements: Object.freeze([...state.referenceReplacements]),
    }), insertionRoot);
  };
  const snapshot = (): LogicalDocumentChanges => detachLogicalDocumentChanges(ownedSnapshot());
  const point = (tableId: CatalogTableId, rowId: AppRowIdHexV1): LogicalDocumentRootPoint | undefined => {
    if (state.closed) return undefined;
    const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
    const observation = state.dependencies.get(documentId);
    if (observation === undefined) return undefined;
    const row = state.rows.get(documentId);
    return Object.freeze({ observation: structuredClone(observation), originalDocument: row?.base?.kind === "live" ? structuredClone(row.base.document) : null,
      document: row?.current == null ? null : structuredClone(row.current), creationTime: row?.creationTime, written: (row?.attempts.length ?? 0) > 0 });
  };
  const points = (tableId?: CatalogTableId): readonly LogicalDocumentRootPoint[] => {
    if (state.closed) return [];
    return [...state.dependencies.values()].filter(observation => tableId === undefined || observation.tableId === tableId)
      .map(observation => point(observation.tableId, observation.rowId)!);
  };
  const observePoint: LogicalDocumentRootEvaluator["observePoint"] = (tableName, observation, revision) => {
    if (state.closed) return Result.fail("closed");
    if (observation.readAt !== state.pins.snapshotCommitSeq || observation.documentId !== appDocumentIdV1FromRowIdentity(observation) ||
      observation.dependency.documentId !== observation.documentId)
      return Result.fail("observationMismatch");
    const prior = state.dependencies.get(observation.documentId);
    if (prior !== undefined) return sameObservation(prior, observation) ? Result.succeed(undefined) : Result.fail("observationMismatch");
    const observed = observation.dependency.observed;
    const document = revision.kind === "live" ? revision.document : null;
    if ((observed.kind === "present") !== (document !== null)) return Result.fail("invalidDocument");
    if (revision.kind !== "missing" && (revision.scopeId !== state.pins.scopeId || revision.tableId !== observation.tableId ||
      revision.rowId !== observation.rowId || revision.commitSeq > state.pins.snapshotCommitSeq ||
      (observed.kind === "present" ? revision.kind !== "live" || revision.commitSeq !== observed.revisionCommitSeq :
        observed.basis.kind !== "tombstone" || revision.kind !== "tombstone" || revision.commitSeq !== observed.basis.revisionCommitSeq)))
      return Result.fail("observationMismatch");
    if (revision.kind === "missing" && (observed.kind !== "missing" || observed.basis.kind !== "noVisibleRevision"))
      return Result.fail("observationMismatch");
    return Result.gen(function* () {
      let creationTime: AppCreationTimeV1 | undefined;
      if (document !== null) {
        if (!isJsonObject(document.valueJson)) return yield* Result.fail<LogicalDocumentRootPointFailure>("invalidDocument");
        creationTime = yield* decodeAppCreationTimeResult(document.valueJson._creationTime).pipe(
          Result.mapError((): LogicalDocumentRootPointFailure => "invalidDocument"));
        if (document.valueJson._id !== observation.documentId) return yield* Result.fail<LogicalDocumentRootPointFailure>("invalidDocument");
      }
      // The existing fixed observation/row envelope charge owns the revision
      // scalars. Its canonical document is shared by original/base/current.
      const bytes = 256 + (document?.canonicalBytes.byteLength ?? 0);
      if (state.dependencies.size >= state.limits.identities)
        return yield* Result.fail(new LogicalDocumentRootLimitError({ resource: "identities",
          observed: state.dependencies.size + 1, maximum: state.limits.identities }));
      if (bytes > state.limits.workingBytes - state.workingBytes)
        return yield* Result.fail(new LogicalDocumentRootLimitError({ resource: "workingBytes",
          observed: state.workingBytes + bytes, maximum: state.limits.workingBytes }));
      const ownedObservation = structuredClone(observation), detachedRevision = detachLogicalCanonicalRevision(revision, document);
      const ownedRevision = detachedRevision.kind === "live" ? Object.freeze({ ...detachedRevision,
        document: protectLogicalCanonicalDocument(detachedRevision.document) }) : detachedRevision;
      state.dependencies.set(observation.documentId, ownedObservation);
      if (ownedRevision.kind === "live" && observed.kind === "present" && creationTime !== undefined) {
        owned.rows.set(observation.documentId, { tableId: observation.tableId, tableName, rowId: observation.rowId,
          documentId: observation.documentId, base: ownedRevision, originalRevision: ownedRevision, creationTime,
          current: ownedRevision.document, attempts: [],
          ...(ownedRevision.insertionOrder === undefined ? {} : { insertionOrder: committedLogicalInsertionOrder(ownedRevision.insertionOrder) }) });
      }
      state.workingBytes += bytes;
      const current = owned.rows.get(observation.documentId);
      if (current?.current != null) owned.currentDocuments.set(current.current, current);
      state.activityGeneration++;
    });
  };
  const writePoint: LogicalDocumentRootEvaluator["writePoint"] = (tableName, observation, overlay, operation) => Result.gen(function* () {
    if (state.closed) return yield* Result.fail<LogicalDocumentRootPointFailure>("closed");
    const prior = state.dependencies.get(observation.documentId);
    if (prior === undefined || !sameObservation(prior, observation)) return yield* Result.fail<LogicalDocumentRootPointFailure>("observationMismatch");
    let row = owned.rows.get(observation.documentId);
    if (overlay.kind === "live" && (!isJsonObject(overlay.document.valueJson) ||
      overlay.document.valueJson._id !== observation.documentId || overlay.document.valueJson._creationTime !== overlay.creationTime ||
      row !== undefined && row.creationTime !== overlay.creationTime)) return yield* Result.fail<LogicalDocumentRootPointFailure>("invalidDocument");
    if (row === undefined) {
      if (overlay.kind !== "live") return yield* Result.fail<LogicalDocumentRootPointFailure>("invalidDocument");
      row = { tableId: observation.tableId, tableName, rowId: observation.rowId, documentId: observation.documentId,
        base: null, creationTime: overlay.creationTime, current: null, attempts: [] };
    }
    const bytes = 128 + (overlay.kind === "live" ? overlay.document.canonicalBytes.byteLength : 0);
    const written = owned.written.get(row.tableId);
    const bookkeeping = written?.identities.has(row.rowId) === true ? 0 : LOGICAL_DOCUMENT_ROOT_WRITTEN_IDENTITY_BYTES +
      (written === undefined ? LOGICAL_DOCUMENT_ROOT_WRITTEN_TABLE_BYTES : 0);
    if (bytes + bookkeeping > state.limits.workingBytes - state.workingBytes)
      return yield* Result.fail(new LogicalDocumentRootLimitError({ resource: "workingBytes",
        observed: state.workingBytes + bytes + bookkeeping, maximum: state.limits.workingBytes }));
    const after = overlay.kind === "live" ? protectLogicalCanonicalDocument(overlay.document) : null;
    if (operation === "insert" && after === null) return yield* Result.fail<LogicalDocumentRootPointFailure>("invalidDocument");
    const issued = operation === "insert" && after !== null
      ? yield* issueLogicalInsertionAttempt(insertionRoot, state.pins.scopeId, row.tableId, row.documentId, after).pipe(
        Result.mapError((): LogicalDocumentRootPointFailure => "limitExceeded")) : undefined;
    const ordinal = state.attempts.length;
    yield* acceptLogicalDocumentRootWrite(state, rootRowView(owned, row), Object.freeze({
      ordinal, tableId: row.tableId, tableName, documentId: row.documentId, operation, before: row.current, after,
      ...(issued === undefined ? {} : { insertionAttemptOrdinal: issued.ordinal, insertionEvidence: issued.evidence }),
    }), failure => failure);
    state.workingBytes += bytes;
  });
  const forgetUnwrittenPoint = (tableId: CatalogTableId, rowId: AppRowIdHexV1) => {
    const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
    const pending = state.rows.get(documentId);
    if (pending?.attempts.length) return;
    for (const document of [pending?.current, pending?.base?.kind === "live" ? pending.base.document : undefined]) {
      if (document == null) continue;
      forgetLogicalCanonicalDerivedKeys(document, state.derivedKeyDocuments);
      state.derivedKeyDocuments.delete(document);
    }
    state.dependencies.delete(documentId);
    owned.rows.delete(documentId);
    state.activityGeneration++;
  };
  const close = () => {
    if (state.closed) return;
    state.closed = true;
    for (const document of state.derivedKeyDocuments) forgetLogicalCanonicalDerivedKeys(document, state.derivedKeyDocuments);
    state.derivedKeyDocuments.clear();
    state.ownedSnapshot = undefined;
    owned.rows.clear();
    state.scanned.clear();
    state.dependencies.clear();
    state.metadataDependencies.clear();
    state.metadataConsumptions.clear();
    state.scans.clear();
    state.uniqueReads.clear();
    state.indexReads.clear();
    state.pageReads.length = 0;
    state.searchReads.length = 0;
    state.relationalReads.length = 0;
    owned.attempts.length = 0;
    owned.written.clear();
    owned.indexes.clear();
    owned.currentDocuments = new WeakMap();
    state.lifecycle.length = 0;
    state.setNull.length = 0;
    state.referenceReplacements.length = 0;
    state.overlayWriteGenerations.clear();
    state.workingBytes = 0;
  };
  const evaluator = Object.freeze({ snapshot, snapshotOriginalRows, attemptCount: () => state.attempts.length,
    point, points, observePoint, writePoint, forgetUnwrittenPoint, close });
  roots.set(evaluator, state);
  state.ownedSnapshot = ownedSnapshot;
  return evaluator;
};

// The selected evaluator, rather than a structural graph or another root for
// the same attempt, issues this single-use transfer. Detach the owned graph once;
// inspection projections never expose that retained canonical evidence.
export const takeLogicalDocumentRootSnapshot = (evaluator: LogicalDocumentRootEvaluator):
  Result.Result<ClosedLogicalDocumentRoot, LogicalDocumentRootPointFailure> => {
  const state = roots.get(evaluator), snapshot = state?.ownedSnapshot;
  if (snapshot === undefined || state?.closed !== false)
    throw new Error("Logical document root evaluator is closed or foreign");
  const graph = snapshot();
  // Preserve graph-before-original verification and revoke only after both
  // succeeded. The caller retains the existing failure cleanup owner.
  return originalRowsResult(state).pipe(Result.map(originalRows => {
    const detached = detachLogicalDocumentRootChanges(graph, originalRows);
    evaluator.close();
    const handle = Object.freeze({ [closedRootBrand]: true as const });
    closedRoots.set(handle, { evaluator, pins: state.pins, ...detached });
    return handle;
  }));
};

/** Trusted freeze checks its exact private evaluator before any promotion. */
export const borrowClosedLogicalDocumentRoot = (handle: ClosedLogicalDocumentRoot,
  evaluator: LogicalDocumentRootEvaluator, attempt: SessionJournalAttempt): ClosedRootData | undefined => {
  const data = typeof handle === "object" && handle !== null ? closedRoots.get(handle) : undefined;
  return data?.evaluator === evaluator && data.pins.attempt === attempt ? data : undefined;
};

/** Successful adoption revokes the transfer; replay retains the frozen handle. */
export const consumeClosedLogicalDocumentRoot = (handle: ClosedLogicalDocumentRoot,
  evaluator: LogicalDocumentRootEvaluator, attempt: SessionJournalAttempt): ClosedRootData | undefined => {
  const data = borrowClosedLogicalDocumentRoot(handle, evaluator, attempt);
  if (data !== undefined) closedRoots.delete(handle);
  return data;
};

/** The trusted entry owner fixes this watermark before any native selection.
 * Callers cannot replace it by sampling a newer activation's observation. */
const decodeMetadataDependencyResult = Schema.decodeUnknownResult(Schema.toType(LogicalMetadataReadDependencySchema));
export const recordLogicalDocumentRootMetadataDependency = (state: LogicalDocumentRootState,
  dependency: LogicalMetadataReadDependency): boolean => {
  if (state.closed || state.pins.metadataWatermark === undefined) return false;
  const decoded = decodeMetadataDependencyResult(dependency);
  return Result.isSuccess(decoded) && recordDecodedMetadataDependency(state, decoded.success);
};

/** Only the supplied-dependency decoder or the projection capture consumed
 * inside this root operation reaches this already-decoded data channel. */
const recordDecodedMetadataDependency = (state: LogicalDocumentRootState,
  dependency: LogicalMetadataReadDependency): boolean => {
  if (state.closed || state.pins.metadataWatermark === undefined || dependency.capturedWatermark !== state.pins.metadataWatermark)
    return false;
  const key = finiteMetadataDependencyIdentity(dependency);
  const previous = state.metadataDependencies.get(key);
  if (previous !== undefined) return previous.observed.kind === dependency.observed.kind &&
    (previous.observed.kind === "missing" || dependency.observed.kind === "present" &&
      previous.observed.semanticSha256Hex === dependency.observed.semanticSha256Hex);
  if (state.metadataDependencies.size >= MAX_COMMIT_METADATA_READ_DEPENDENCIES) return false;
  const bytes = 256 + 2 * (dependency.ownerKey.length + dependency.contractKey.length);
  if (bytes > state.limits.workingBytes - state.workingBytes) return false;
  state.metadataDependencies.set(key, Object.freeze({ ...dependency, observed: Object.freeze({ ...dependency.observed }) }));
  state.workingBytes += bytes;
  return true;
};

/** The original root owns first consumption across its borrowed native views.
 * Exact issuer observation checks remain live; no serving verdict is retained. */
export const consumeLogicalDocumentRootMetadataDependency = (state: LogicalDocumentRootState,
  projection: PreparedFiniteMetadataProjection,
  key: LogicalMetadataKey,
  requirePresent = false,
): Result.Result<void, FiniteMetadataError | LogicalDocumentRootPointFailure> => {
  if (state.closed) return Result.fail("closed");
  if (state.pins.metadataWatermark === undefined) return Result.fail("observationMismatch");
  const identity = finiteMetadataDependencyIdentity(key);
  const consumed = state.metadataConsumptions.get(projection);
  const previous = consumed?.get(identity);
  if (previous !== undefined && matchesFiniteMetadataDependencyObservation(projection, key,
    state.pins.metadataWatermark, previous)) return (!requirePresent || previous.observed.kind === "present") && recordDecodedMetadataDependency(state, previous)
      ? Result.succeed(undefined) : Result.fail("observationMismatch");
  return captureFiniteMetadataDependency(projection, key, state.pins.metadataWatermark).pipe(Result.flatMap(dependency => {
    if (requirePresent && dependency.observed.kind !== "present") return Result.fail("observationMismatch" as const);
    if (!recordDecodedMetadataDependency(state, dependency)) return Result.fail("observationMismatch" as const);
    const observations = consumed ?? new Map<string, LogicalMetadataReadDependency>();
    if (previous === undefined) observations.set(identity, dependency);
    if (consumed === undefined) state.metadataConsumptions.set(projection, observations);
    return Result.succeed(undefined);
  }));
};

export const attachLogicalDocumentRootEvaluator = (evaluator: LogicalDocumentRootEvaluator,
  pins: LogicalDocumentRootPins): LogicalDocumentRootState | null => {
  const state = roots.get(evaluator);
  return state !== undefined && !state.closed && state.pins.attempt === pins.attempt &&
    state.pins.scopeId === pins.scopeId && state.pins.snapshotCommitSeq === pins.snapshotCommitSeq &&
    state.pins.attemptFence === pins.attemptFence ? state : null;
};

/** Retained private capability data consumes the same root memory budget. */
export function reserveLogicalDocumentRootBytes(evaluator: LogicalDocumentRootEvaluator, pins: LogicalDocumentRootPins, bytes: number):
  Result.Result<void, LogicalDocumentRootPointFailure> {
  const state = attachLogicalDocumentRootEvaluator(evaluator, pins);
  if (state === null) return Result.fail("closed" as const);
  if (!Number.isSafeInteger(bytes) || bytes < 0) return Result.fail("invalidDocument" as const);
  if (state.workingBytes + bytes > state.limits.workingBytes)
    return Result.fail(new LogicalDocumentRootLimitError({ resource: "workingBytes",
      observed: state.workingBytes + bytes, maximum: state.limits.workingBytes }));
  state.workingBytes += bytes;
  return Result.succeed(undefined);
}

/** A finite local step checks the exact root's mutable closure state without
 * borrowing SQL authority. Checked database boundaries still authenticate live. */
export const requireLogicalDocumentRootEvaluatorOpen = <Failure>(evaluator: LogicalDocumentRootEvaluator,
  pins: LogicalDocumentRootPins, closed: () => Failure): Effect.Effect<void, Failure> => Effect.suspend(() =>
    attachLogicalDocumentRootEvaluator(evaluator, pins) === null ? Effect.fail(closed()) : Effect.void);
