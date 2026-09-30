import type { Effect } from "effect";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { BoundedRequestContext, BoundedRequestLifetime } from "../boundedRequestLifetime";
import type { JsonObject } from "flarex-protocol/json";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { ScopeClockRecord } from "../scopeClock";
import type { RelationalPersistenceCapability, RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import type { LogicalSearchDefinition } from "./searchEntries";
import type { ApplicationDocumentObservation } from "../applicationDocumentMaterialization/model";
import type { SessionJournalAttempt } from "../sessionJournalStore";
import type { LogicalDocumentRootEvaluator } from "./rootEvaluator";

export type LogicalDocumentFailureReason = "invalidInput" | "invalidAuthority" | "closed" | "limitExceeded"
  | "documentMissing" | "documentInvalid" | "uniqueConflict" | "writeConflict" | "storedCorruption"
  | "statementFailure" | "resourceFailure";
export type LogicalDocumentFailure<Failure> = (reason: LogicalDocumentFailureReason, cause?: unknown) => Failure;

/** Native row operations borrow one request lifetime; no settlement capability. */
export interface LogicalRelationalStore<Failure> {
  /** Complete bounded selection before projection/windowing; overflow refuses. */
  readonly find: (context: BoundedRequestContext, query: unknown) => Effect.Effect<readonly JsonObject[], Failure>;
  /** Ordered bounded work. No total or reusable physical cursor is implied. */
  readonly findPage: (context: BoundedRequestContext, query: unknown) => Effect.Effect<Readonly<{ rows: readonly JsonObject[]; hasMore: boolean }>, Failure>;
  readonly count: (context: BoundedRequestContext, query: unknown) => Effect.Effect<number, Failure>;
  /** Finite indexed complete selection; exact decimal SUM, without grouping. */
  readonly aggregate: (context: BoundedRequestContext, query: unknown) => Effect.Effect<Readonly<{ count: number; sum?: string | null }>, Failure>;
  readonly write: (context: BoundedRequestContext, mode: "insert" | "upsert" | "update", rows: unknown) => Effect.Effect<readonly JsonObject[], Failure>;
  readonly delete: (context: BoundedRequestContext, keys: unknown) => Effect.Effect<readonly JsonObject[], Failure>;
  readonly lifecycle: (context: BoundedRequestContext, operation: "softDelete" | "restore", keys: unknown) => Effect.Effect<readonly JsonObject[], Failure>;
}

export interface LogicalDocumentWrite {
  readonly operation: "insert" | "patch" | "replace";
  readonly tableName: string;
  readonly tableId: CatalogTableId;
  readonly documentId: AppDocumentIdV1;
  readonly creationTime: AppCreationTimeV1;
  readonly document: CanonicalFlarexValueV1;
}

/** Trusted borrowed profile construction only. Each invocation must acquire a
 * fresh short SQL transaction, authenticate the exact source/attempt/fence in
 * that transaction before calling work, and keep the authentication lock until
 * work finishes. The working set does not separately open an empty admission
 * transaction before these checked reads. State-only operations still use
 * requireAdmission and its existing first-failure latch. */
export type LogicalDocumentReadTransaction<Failure> = <A, E>(
  work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>,
) => Effect.Effect<A, E | Failure>;

/** Immutable decoded rows from the same journal point table that serves App
 * syscalls. This is evaluator hydration; the journal remains the pending owner. */
export type LogicalPendingDocumentSeed = Readonly<{
  tableId: CatalogTableId;
  rowId: AppRowIdHexV1;
  observed: ApplicationDocumentObservation["dependency"]["observed"];
  overlay: Readonly<{ kind: "live"; creationTime: AppCreationTimeV1; document: CanonicalFlarexValueV1 }> |
    Readonly<{ kind: "deleted" }>;
}>;

/** The admitted journal supplies exactly one pending-view authority to each
 * borrowed native call. The finite branch binds the caller's exact attempt. */
export type LogicalDocumentBorrowView =
  | Readonly<{ pendingRows: readonly LogicalPendingDocumentSeed[];
      rootEvaluator?: never; rootAttemptFence?: never }>
  | Readonly<{ pendingRows?: never;
      rootEvaluator: LogicalDocumentRootEvaluator; rootAttemptFence: string }>;

type LogicalDocumentWorkingSetRoot =
  | Readonly<{ pendingRows?: readonly LogicalPendingDocumentSeed[];
      rootEvaluator?: never; rootAttempt?: never; rootAttemptFence?: never }>
  | Readonly<{ pendingRows?: never; rootEvaluator: LogicalDocumentRootEvaluator;
      rootAttempt: SessionJournalAttempt; rootAttemptFence: string }>;

export type LogicalDocumentWorkingSetInput<Failure> = Readonly<{
  readonly scopeId: ScopeId;
  readonly clock: ScopeClockRecord;
  /** Fixed historical view for a logical attempt. Unsupported candidate paths refuse. */
  readonly snapshotCommitSeq?: CommitSeq;
  readonly tables: readonly Readonly<{ tableId: CatalogTableId; logicalName: string; relational?: RelationalTableDefinition }>[];
  readonly relationalCapabilities?: readonly RelationalPersistenceCapability[];
  readonly searchDefinitions?: readonly LogicalSearchDefinition[];
  readonly lifetime: BoundedRequestLifetime<Failure>;
  /** Durable operations check live admission here. A finite root supplies a
   * tentative local gate; every readTransaction still checks live authority. */
  readonly requireAdmission: Effect.Effect<void, Failure>;
  readonly validateDocument: (write: LogicalDocumentWrite) => Effect.Effect<void, Failure>;
  readonly error: LogicalDocumentFailure<Failure>;
  readonly uniqueConflict: (constraint: Readonly<{ tableName: string; orderedFields: readonly string[] }>) => Failure;
  readonly limits: Readonly<{ pageRows: number; identities: number; documentBytes: number }>;
}> & LogicalDocumentWorkingSetRoot & (
  | Readonly<{ readonly tx: FlarexMetadataTransaction; readonly readTransaction?: never }>
  | Readonly<{ readonly tx?: never; readonly readTransaction: LogicalDocumentReadTransaction<Failure> }>
);
