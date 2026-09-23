import type { Effect } from "effect";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { BoundedRequestContext, BoundedRequestLifetime } from "../boundedRequestLifetime";
import type { JsonObject } from "flarex-protocol/json";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { ScopeClockRecord } from "../scopeClock";
import type { RelationalPersistenceCapability, RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";

export type LogicalDocumentFailureReason = "invalidInput" | "invalidAuthority" | "closed" | "limitExceeded"
  | "documentMissing" | "documentInvalid" | "uniqueConflict" | "writeConflict" | "storedCorruption"
  | "statementFailure" | "resourceFailure";
export type LogicalDocumentFailure<Failure> = (reason: LogicalDocumentFailureReason, cause?: unknown) => Failure;

/** Native row operations borrow one request lifetime; no settlement capability. */
export interface LogicalRelationalStore<Failure> {
  readonly find: (context: BoundedRequestContext, query: unknown) => Effect.Effect<readonly JsonObject[], Failure>;
  readonly count: (context: BoundedRequestContext, query: unknown) => Effect.Effect<number, Failure>;
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

/** Trusted profile construction only. Framework admission supplies exact table
 * bindings and a validator; this owner cannot acquire or settle a transaction.
 * The guard rechecks the captured admission/transaction pair on each entry.
 * Failure projection shares the existing lifetime and its first-failure latch. */
export interface LogicalDocumentWorkingSetInput<Failure> {
  readonly tx: FlarexMetadataTransaction;
  readonly scopeId: ScopeId;
  readonly clock: ScopeClockRecord;
  readonly tables: readonly Readonly<{ tableId: CatalogTableId; logicalName: string; relational?: RelationalTableDefinition }>[];
  readonly relationalCapabilities?: readonly RelationalPersistenceCapability[];
  readonly lifetime: BoundedRequestLifetime<Failure>;
  readonly requireAdmission: Effect.Effect<void, Failure>;
  readonly validateDocument: (write: LogicalDocumentWrite) => Effect.Effect<void, Failure>;
  readonly error: LogicalDocumentFailure<Failure>;
  readonly uniqueConflict: (constraint: Readonly<{ tableName: string; orderedFields: readonly string[] }>) => Failure;
  readonly limits: Readonly<{ pageRows: number; identities: number; documentBytes: number }>;
}
