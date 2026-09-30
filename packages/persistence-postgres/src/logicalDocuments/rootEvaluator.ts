import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { CommitSeq, ScopeId } from "flarex-protocol/storage-authority";
import { Effect } from "effect";
import type { ApplicationDocumentObservation } from "../applicationDocumentMaterialization/model";
import type { SessionJournalAttempt } from "../sessionJournalStore";
import type { LogicalIndexRead, LogicalIndexPageRead } from "./indexReads";
import type { LogicalSearchRead } from "./searchReads";
import type { LogicalPendingDocumentSeed } from "./model";
import { appDocumentIdV1FromRowIdentity } from "flarex-protocol/app-document-id";
import { isJsonObject } from "flarex-protocol/json";
import { detachLogicalDocumentChanges } from "./detachChanges";
import type { LogicalDocumentAttempt, LogicalDocumentChanges, LogicalDocumentObservedRow,
  LogicalRelationalLifecycleObservation, LogicalReferenceReplacementIntent, LogicalSetNullIntent,
  LogicalUniqueRead, PendingDocument } from "./workingSet";

export interface LogicalDocumentRootEvaluator {
  readonly snapshot: () => LogicalDocumentChanges;
  /** Journal-owned Application point awaiting first native facade access. */
  readonly stageAppPoint: (seed: LogicalPendingDocumentSeed) => boolean;
  readonly close: () => void;
}

export interface LogicalDocumentRootPins {
  readonly attempt: SessionJournalAttempt;
  readonly scopeId: ScopeId;
  readonly snapshotCommitSeq: CommitSeq;
  readonly attemptFence: string;
}

export interface LogicalDocumentRootLimits {
  readonly identities: number;
  readonly workingBytes: number;
}

export interface LogicalDocumentRootState {
  readonly pins: LogicalDocumentRootPins;
  readonly limits: LogicalDocumentRootLimits;
  readonly rows: Map<AppDocumentIdV1, PendingDocument>;
  readonly scanned: Map<CatalogTableId, CommitSeq>;
  readonly dependencies: Map<AppDocumentIdV1, ApplicationDocumentObservation>;
  readonly scans: Map<CatalogTableId, CommitSeq | null>;
  readonly uniqueReads: Map<string, LogicalUniqueRead>;
  readonly indexReads: Map<string, LogicalIndexRead>;
  readonly pageReads: LogicalIndexPageRead[];
  readonly searchReads: LogicalSearchRead[];
  readonly attempts: LogicalDocumentAttempt[];
  readonly lifecycle: LogicalRelationalLifecycleObservation[];
  readonly setNull: LogicalSetNullIntent[];
  readonly referenceReplacements: LogicalReferenceReplacementIntent[];
  readonly appPoints: Map<AppDocumentIdV1, LogicalPendingDocumentSeed>;
  readonly hydratedAppPoints: Set<AppDocumentIdV1>;
  workingBytes: number;
  inserted: number;
  closed: boolean;
}

const roots = new WeakMap<LogicalDocumentRootEvaluator, LogicalDocumentRootState>();

/** Issued only by the trusted finite-attempt owner. No SQL resource is held. */
export const makeLogicalDocumentRootEvaluator = (pins: LogicalDocumentRootPins,
  limits: LogicalDocumentRootLimits): LogicalDocumentRootEvaluator => {
  const state: LogicalDocumentRootState = {
    pins: Object.freeze({ ...pins }), limits: Object.freeze({ ...limits }), rows: new Map(), scanned: new Map(),
    dependencies: new Map(), scans: new Map(), uniqueReads: new Map(), indexReads: new Map(),
    pageReads: [], searchReads: [], attempts: [], lifecycle: [], setNull: [], referenceReplacements: [],
    appPoints: new Map(), hydratedAppPoints: new Set(),
    workingBytes: 0, inserted: 0, closed: false,
  };
  const snapshot = (): LogicalDocumentChanges => {
    if (state.closed) throw new Error("Logical document root evaluator is closed");
    const changes: LogicalDocumentChanges["changes"][number][] = [];
    const observedRows: LogicalDocumentObservedRow[] = [];
    const noFinalRows: AppDocumentIdV1[] = [];
    for (const row of state.rows.values()) {
      if (row.current !== null) {
        if (!isJsonObject(row.current.valueJson)) throw new Error("Logical document root value is invalid");
        observedRows.push(Object.freeze({ documentId: row.documentId, tableId: row.tableId,
          tableName: row.tableName, value: structuredClone(row.current.valueJson) }));
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
    return detachLogicalDocumentChanges(Object.freeze({ changes: Object.freeze(changes), observedRows: Object.freeze(observedRows),
      noFinalRows: Object.freeze(noFinalRows), attempts: Object.freeze([...state.attempts]),
      lifecycle: Object.freeze([...state.lifecycle]),
      dependencies: Object.freeze([...state.dependencies.values()].toSorted((a, b) => a.tableId - b.tableId || a.rowId.localeCompare(b.rowId))),
      scans: Object.freeze([...state.scans].map(([tableId, frontier]) => Object.freeze({ tableId, frontier }))),
      uniqueReads: Object.freeze([...state.uniqueReads.values()]), indexReads: Object.freeze([...state.indexReads.values()]),
      pageReads: Object.freeze([...state.pageReads]), searchReads: Object.freeze([...state.searchReads]),
      setNull: Object.freeze([...state.setNull]), referenceReplacements: Object.freeze([...state.referenceReplacements]),
    }));
  };
  const stageAppPoint = (seed: LogicalPendingDocumentSeed): boolean => {
    if (state.closed) return false;
    const documentId = appDocumentIdV1FromRowIdentity(seed);
    // Native writes to this identity cannot be overwritten by a later App
    // overlay. The journal owner must settle such overlap in one domain first.
    if (state.rows.get(documentId)?.attempts.length) return false;
    const prior = state.appPoints.get(documentId);
    if (prior !== undefined && (prior.observed.kind !== seed.observed.kind ||
      (prior.observed.kind === "present" && seed.observed.kind === "present"
        ? prior.observed.revisionCommitSeq !== seed.observed.revisionCommitSeq
        : prior.observed.kind === "missing" && seed.observed.kind === "missing" &&
          (prior.observed.basis.kind !== seed.observed.basis.kind ||
            prior.observed.basis.kind === "tombstone" && seed.observed.basis.kind === "tombstone" &&
              prior.observed.basis.revisionCommitSeq !== seed.observed.basis.revisionCommitSeq)))) return false;
    state.appPoints.set(documentId, structuredClone(seed));
    state.hydratedAppPoints.delete(documentId);
    return true;
  };
  const close = () => {
    if (state.closed) return;
    state.closed = true;
    state.rows.clear();
    state.scanned.clear();
    state.dependencies.clear();
    state.scans.clear();
    state.uniqueReads.clear();
    state.indexReads.clear();
    state.pageReads.length = 0;
    state.searchReads.length = 0;
    state.attempts.length = 0;
    state.lifecycle.length = 0;
    state.setNull.length = 0;
    state.referenceReplacements.length = 0;
    state.appPoints.clear();
    state.hydratedAppPoints.clear();
    state.workingBytes = 0;
  };
  const evaluator = Object.freeze({ snapshot, stageAppPoint, close });
  roots.set(evaluator, state);
  return evaluator;
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
