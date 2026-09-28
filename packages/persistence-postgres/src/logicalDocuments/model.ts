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

export type LogicalDocumentWorkingSetInput<Failure> = Readonly<{
  readonly scopeId: ScopeId;
  readonly clock: ScopeClockRecord;
  /** Fixed historical view for a logical attempt. Unsupported candidate paths refuse. */
  readonly snapshotCommitSeq?: CommitSeq;
  readonly pendingRows?: readonly LogicalPendingDocumentSeed[];
  readonly tables: readonly Readonly<{ tableId: CatalogTableId; logicalName: string; relational?: RelationalTableDefinition }>[];
  readonly relationalCapabilities?: readonly RelationalPersistenceCapability[];
  readonly searchDefinitions?: readonly LogicalSearchDefinition[];
  readonly lifetime: BoundedRequestLifetime<Failure>;
  readonly requireAdmission: Effect.Effect<void, Failure>;
  readonly validateDocument: (write: LogicalDocumentWrite) => Effect.Effect<void, Failure>;
  readonly error: LogicalDocumentFailure<Failure>;
  readonly uniqueConflict: (constraint: Readonly<{ tableName: string; orderedFields: readonly string[] }>) => Failure;
  readonly limits: Readonly<{ pageRows: number; identities: number; documentBytes: number }>;
}> & (
  | Readonly<{ readonly tx: FlarexMetadataTransaction; readonly readTransaction?: never }>
  | Readonly<{ readonly tx?: never; readonly readTransaction: LogicalDocumentReadTransaction<Failure> }>
);
