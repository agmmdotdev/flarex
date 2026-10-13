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
import { Effect, Result, Schema } from "effect";
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
import { detachLogicalCanonicalDocument, detachLogicalCanonicalRevision, forgetLogicalCanonicalDerivedKeys } from "./relationalRows";
import { captureFiniteMetadataDependency, matchesFiniteMetadataDependencyObservation, finiteMetadataDependencyIdentity,
  type PreparedFiniteMetadataProjection, type FiniteMetadataError } from "../../../execution/finiteMetadataDependencies";
import type { LogicalDocumentAttempt, LogicalDocumentChanges, LogicalDocumentObservedRow,
  LogicalRelationalLifecycleObservation, LogicalReferenceReplacementIntent, LogicalSetNullIntent,
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

export type LogicalDocumentRootPointFailure = "closed" | "limitExceeded" | "observationMismatch" | "invalidDocument";
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

/** Private finite evidence stays on the existing pending entry. Missing and
 * tombstone originals need only their exact dependency for current-head OCC. */
interface RootPendingDocument extends PendingDocument {
  readonly originalRevision?: LiveAppRowRevisionV1;
}

export interface LogicalDocumentRootState {
  readonly derivedKeyDocuments: Set<CanonicalFlarexValueV1>;
  readonly pins: LogicalDocumentRootPins;
  readonly limits: LogicalDocumentRootLimits;
  readonly rows: Map<AppDocumentIdV1, RootPendingDocument>;
  readonly scanned: Map<CatalogTableId, CommitSeq>;
  readonly dependencies: Map<AppDocumentIdV1, LogicalDocumentPointEvidence>;
  readonly metadataDependencies: Map<string, LogicalMetadataReadDependency>;
  readonly metadataConsumptions: Map<PreparedFiniteMetadataProjection, Map<string, LogicalMetadataReadDependency>>;
  readonly scans: Map<CatalogTableId, CommitSeq | null>;
  readonly uniqueReads: Map<string, LogicalUniqueRead>;
  readonly indexReads: Map<string, LogicalIndexRead>;
  readonly pageReads: LogicalIndexPageRead[];
  readonly searchReads: LogicalSearchRead[];
  readonly attempts: LogicalDocumentAttempt[];
  readonly lifecycle: LogicalRelationalLifecycleObservation[];
  readonly setNull: LogicalSetNullIntent[];
  readonly referenceReplacements: LogicalReferenceReplacementIntent[];
  /** Accepted Application overlays, independent of native hydration/activity. */
  readonly overlayWriteGenerations: Map<CatalogTableId, number>;
  workingBytes: number;
  inserted: number;
  activityGeneration: number;
  ownedSnapshot?: (() => LogicalDocumentChanges) | undefined;
  closed: boolean;
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
  const state: LogicalDocumentRootState = {
    pins: Object.freeze({ ...pins }), limits: Object.freeze({ ...limits }), rows: new Map(), scanned: new Map(), derivedKeyDocuments: new Set(),
    dependencies: new Map(), metadataDependencies: new Map(), metadataConsumptions: new Map(), scans: new Map(), uniqueReads: new Map(), indexReads: new Map(),
    pageReads: [], searchReads: [], attempts: [], lifecycle: [], setNull: [], referenceReplacements: [],
    overlayWriteGenerations: new Map(), workingBytes: 0, inserted: 0, activityGeneration: 0, closed: false,
  };
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
      changes.push(Object.freeze(row.current === null ? { ...dependency, kind: "deleted" } :
        { ...dependency, kind: "live", creationTime: row.creationTime, document: row.current }));
    }
    changes.sort((left, right) => left.tableId - right.tableId || left.rowId.localeCompare(right.rowId));
    observedRows.sort((left, right) => left.tableId - right.tableId || left.documentId.localeCompare(right.documentId));
    noFinalRows.sort();
    return Object.freeze({ changes: Object.freeze(changes), observedRows: Object.freeze(observedRows),
      noFinalRows: Object.freeze(noFinalRows), attempts: Object.freeze([...state.attempts]),
      lifecycle: Object.freeze([...state.lifecycle]),
      dependencies: Object.freeze([...state.dependencies.values()].toSorted((a, b) => a.tableId - b.tableId || a.rowId.localeCompare(b.rowId))),
      ...(state.pins.metadataWatermark === undefined ? {} : {
        metadataWatermark: state.pins.metadataWatermark,
        metadataDependencies: Object.freeze([...state.metadataDependencies.values()].toSorted((a, b) =>
          compareUtf16Strings(finiteMetadataDependencyIdentity(a), finiteMetadataDependencyIdentity(b)))) }),
      scans: Object.freeze([...state.scans].map(([tableId, frontier]) => Object.freeze({ tableId, frontier }))),
      uniqueReads: Object.freeze([...state.uniqueReads.values()]), indexReads: Object.freeze([...state.indexReads.values()]),
      pageReads: Object.freeze([...state.pageReads]), searchReads: Object.freeze([...state.searchReads]),
      setNull: Object.freeze([...state.setNull]), referenceReplacements: Object.freeze([...state.referenceReplacements]),
    });
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
      if (state.dependencies.size >= state.limits.identities || bytes > state.limits.workingBytes - state.workingBytes)
        return yield* Result.fail<LogicalDocumentRootPointFailure>("limitExceeded");
      const ownedObservation = structuredClone(observation), ownedRevision = detachLogicalCanonicalRevision(revision, document);
      state.dependencies.set(observation.documentId, ownedObservation);
      if (ownedRevision.kind === "live" && observed.kind === "present" && creationTime !== undefined) {
        state.rows.set(observation.documentId, { tableId: observation.tableId, tableName, rowId: observation.rowId,
          documentId: observation.documentId, base: ownedRevision, originalRevision: ownedRevision, creationTime,
          current: ownedRevision.document, attempts: [] });
      }
      state.workingBytes += bytes;
      state.activityGeneration++;
    });
  };
  const writePoint: LogicalDocumentRootEvaluator["writePoint"] = (tableName, observation, overlay, operation) => {
    if (state.closed) return Result.fail("closed");
    const prior = state.dependencies.get(observation.documentId);
    if (prior === undefined || !sameObservation(prior, observation)) return Result.fail("observationMismatch");
    let row = state.rows.get(observation.documentId);
    if (overlay.kind === "live" && (!isJsonObject(overlay.document.valueJson) ||
      overlay.document.valueJson._id !== observation.documentId || overlay.document.valueJson._creationTime !== overlay.creationTime ||
      row !== undefined && row.creationTime !== overlay.creationTime)) return Result.fail("invalidDocument");
    if (row === undefined) {
      if (overlay.kind !== "live") return Result.fail("invalidDocument");
      row = { tableId: observation.tableId, tableName, rowId: observation.rowId, documentId: observation.documentId,
        base: null, creationTime: overlay.creationTime, current: null, attempts: [] };
    }
    const bytes = 128 + (overlay.kind === "live" ? overlay.document.canonicalBytes.byteLength : 0);
    if (bytes > state.limits.workingBytes - state.workingBytes) return Result.fail("limitExceeded");
    const after = overlay.kind === "live" ? detachLogicalCanonicalDocument(overlay.document) : null;
    const ordinal = state.attempts.length;
    state.attempts.push(Object.freeze({ ordinal, tableId: row.tableId, tableName, documentId: row.documentId,
      operation, before: row.current, after }));
    row.attempts.push(ordinal);
    if (row.current !== null && (row.base?.kind !== "live" || row.current !== row.base.document)) {
      forgetLogicalCanonicalDerivedKeys(row.current, state.derivedKeyDocuments);
      state.derivedKeyDocuments.delete(row.current);
    }
    row.current = after;
    state.rows.set(row.documentId, row);
    state.workingBytes += bytes;
    state.overlayWriteGenerations.set(row.tableId, (state.overlayWriteGenerations.get(row.tableId) ?? 0) + 1);
    state.activityGeneration++;
    return Result.succeed(undefined);
  };
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
    state.rows.delete(documentId);
    state.activityGeneration++;
  };
  const close = () => {
    if (state.closed) return;
    state.closed = true;
    for (const document of state.derivedKeyDocuments) forgetLogicalCanonicalDerivedKeys(document, state.derivedKeyDocuments);
    state.derivedKeyDocuments.clear();
    state.ownedSnapshot = undefined;
    state.rows.clear();
    state.scanned.clear();
    state.dependencies.clear();
    state.metadataDependencies.clear();
    state.metadataConsumptions.clear();
    state.scans.clear();
    state.uniqueReads.clear();
    state.indexReads.clear();
    state.pageReads.length = 0;
    state.searchReads.length = 0;
    state.attempts.length = 0;
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
    const detached = detachLogicalDocumentRootChanges(graph, originalRows, "immutable");
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

/** A finite local step checks the exact root's mutable closure state without
 * borrowing SQL authority. Checked database boundaries still authenticate live. */
export const requireLogicalDocumentRootEvaluatorOpen = <Failure>(evaluator: LogicalDocumentRootEvaluator,
  pins: LogicalDocumentRootPins, closed: () => Failure): Effect.Effect<void, Failure> => Effect.suspend(() =>
    attachLogicalDocumentRootEvaluator(evaluator, pins) === null ? Effect.fail(closed()) : Effect.void);
