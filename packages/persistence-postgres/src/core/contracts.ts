import { Data, type Effect, type Option } from "effect";

/** Pinned source: convex-backend db914cf06, common/src/persistence/mod.rs. */
export type CoreTimestamp = bigint;
export type CoreInternalId = Uint8Array;

export interface CoreIndexRef {
  readonly id: CoreInternalId;
  readonly persistenceIndexId?: bigint;
}

export type CoreIndexWriteMode = "scanning" | "scanComplete";

export interface CoreDocumentLogEntry {
  readonly ts: CoreTimestamp;
  readonly tableId: CoreInternalId;
  readonly id: CoreInternalId;
  /** Full document in Convex internal JSON, or empty bytes for a tombstone. */
  readonly jsonValue: Uint8Array;
  readonly deleted: boolean;
  readonly prevTs: CoreTimestamp | null;
}

export interface CoreIndexTarget {
  readonly tableId: CoreInternalId;
  readonly documentId: CoreInternalId;
}

export interface CorePrevIndexEntry {
  readonly ts: CoreTimestamp;
  readonly documentId: CoreInternalId;
}

export interface CorePersistenceIndexEntry {
  readonly mode: CoreIndexWriteMode;
  readonly ts: CoreTimestamp;
  readonly index: CoreIndexRef;
  /** Complete ordered key, including the developer-ID string tie breaker. */
  readonly key: Uint8Array;
  readonly value: CoreIndexTarget | null;
  readonly prev: CorePrevIndexEntry | null;
}

export interface CoreWriteBatch {
  readonly documents: readonly CoreDocumentLogEntry[];
  readonly indexes: readonly CorePersistenceIndexEntry[];
}

/** Start is inclusive; end is exclusive. Null denotes the unbounded side. */
export interface CoreInterval {
  readonly start: Uint8Array | null;
  readonly end: Uint8Array | null;
}

export type CoreOrder = "asc" | "desc";

export type CoreIndexCursor =
  | Readonly<{ kind: "end" }>
  | Readonly<{ kind: "after"; key: Uint8Array }>;

export interface CoreHydratedIndexEntry {
  readonly key: Uint8Array;
  /** Exact document revision at the selected index entry's timestamp. */
  readonly document: CoreDocumentLogEntry;
}

export interface CoreIndexPage {
  readonly entries: readonly CoreHydratedIndexEntry[];
  /** Exclusive cursor in the requested order; it bounds consumed coverage. */
  readonly cursor: CoreIndexCursor;
}

export interface CoreIndexScan {
  readonly index: CoreIndexRef;
  readonly tableId: CoreInternalId;
  readonly interval: CoreInterval;
  readonly order: CoreOrder;
  readonly maxResults: number;
}

export class CorePersistenceError extends Data.TaggedError("CorePersistenceError")<{
  readonly reason: "leaseLost" | "readOnly" | "outOfRetention" | "corruptData"
    | "unavailable" | "uncertainWrite" | "invalidTarget";
  readonly cause?: unknown;
}> {}

/** The adapter must also bind identity to its own captured target, not just token equality. */
export interface CorePersistenceLease {
  readonly token: bigint;
}

export interface CorePersistenceSnapshot {
  readonly timestamp: CoreTimestamp;
  readonly get: (
    tableId: CoreInternalId,
    id: CoreInternalId,
  ) => Effect.Effect<Option.Option<CoreDocumentLogEntry>, CorePersistenceError>;
  readonly scan: (request: CoreIndexScan) => Effect.Effect<CoreIndexPage, CorePersistenceError>;
}

/** Trusted, instance-bound port; never lent to user code or framework callbacks. */
export interface CorePersistence {
  readonly acquireLease: () => Effect.Effect<CorePersistenceLease, CorePersistenceError>;
  /** Must be read after acquiring the owner lease, before admitting snapshots. */
  readonly latestTimestamp: (
    lease: CorePersistenceLease,
  ) => Effect.Effect<CoreTimestamp, CorePersistenceError>;
  /** Fresh document/index namespace under this lease; bootstrap-global remnants alone are harmless. */
  readonly isFresh: (lease: CorePersistenceLease) => Effect.Effect<boolean, CorePersistenceError>;
  readonly readSnapshot: (
    at: CoreTimestamp,
  ) => Effect.Effect<CorePersistenceSnapshot, CorePersistenceError>;
  /** One fenced SQL transaction; a logical member is never split across writes. */
  readonly write: (
    lease: CorePersistenceLease,
    batch: CoreWriteBatch,
  ) => Effect.Effect<void, CorePersistenceError>;
  readonly writeIndexBackfill: (
    lease: CorePersistenceLease,
    indexes: readonly CorePersistenceIndexEntry[],
  ) => Effect.Effect<void, CorePersistenceError>;
  readonly reconcileIndexBackfill: (
    lease: CorePersistenceLease,
    index: CoreIndexRef,
  ) => Effect.Effect<void, CorePersistenceError>;
  readonly getGlobal: (key: string) => Effect.Effect<Option.Option<Uint8Array>, CorePersistenceError>;
  readonly putGlobal: (
    lease: CorePersistenceLease,
    key: string,
    value: Uint8Array,
  ) => Effect.Effect<void, CorePersistenceError>;
}
