import type {
  FiniteStorageCaptureOperation,
  FiniteStorageCaptureEnvelopes,
  FiniteStorageCaptureError,
} from "../../../execution/finiteStorageCapture";
import { Schema, type Effect } from "effect";

import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type {
  CatalogIndexId,
  CatalogIndexDefinitionId,
  CatalogTableId,
  CatalogUniqueConstraintDefinitionId,
} from "flarex-protocol/catalog";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type {
  BoundedRequestContext,
  BoundedRequestLifetime,
} from "../../../execution/preparation/boundedRequestLifetime";
import type { JsonObject } from "flarex-protocol/json";
import type { FlarexMetadataTransaction } from "../../../database/metadataTransaction";
import type { ScopeClockRecord } from "../../../scope/scopeClock";
import type {
  RelationalPersistenceCapability,
  RelationalTableDefinition,
} from "flarex-protocol/internal/relational-schema";
import type { LogicalSearchDefinition } from "./searchEntries";
import type { ApplicationDocumentObservation } from "../../materialization/model";
import type {
  SessionJournalAttempt,
} from "../../../execution/journal/contracts";
import type { LogicalDocumentRootEvaluator } from "./rootEvaluator";
import type { PreparedLogicalRelationalTableMechanics } from "./relationalRows";
import type { LocatedAppIndexDefinitionV1 } from "../../indexes/appIndexDefinitions";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../../unique/appUniqueConstraintDefinitions";

/** Trusted terminal reference maintenance; native profiles choose timestamp semantics. */
export const LogicalSetNullPolicy = Schema.Struct({ managedUpdate: Schema.Literals(["advance", "preserve"]) });
/** Exact same-root deleted-row reuse selects its managed update-time behavior. */
export const LogicalReconstitutionPolicy = Schema.Literals(["advanceUpdatedAt", "preserveTimestamps"]);
export type LogicalReconstitutionPolicy = typeof LogicalReconstitutionPolicy.Type;
/** Conflict merges choose native managed-field behavior explicitly. */
export const LogicalPreservingDeletionUpsertPolicy = Schema.Union([Schema.Literal(true), Schema.Literal("preserveTimestamps")]);
export type LogicalPreservingDeletionUpsertPolicy = typeof LogicalPreservingDeletionUpsertPolicy.Type;
export type LogicalSetNullPolicy = typeof LogicalSetNullPolicy.Type;

export type LogicalDocumentFailureReason = "invalidInput" | "invalidAuthority" | "closed" | "limitExceeded"
  | "documentMissing" | "documentInvalid" | "uniqueConflict" | "writeConflict" | "storedCorruption"
  | "statementFailure" | "resourceFailure";
export type LogicalDocumentFailure<Failure> = (reason: LogicalDocumentFailureReason, cause?: unknown) => Failure;

/** Native row operations borrow one request lifetime; no settlement capability. */
export interface LogicalRelationalReadProgram<Failure> {
  readonly find: (context: BoundedRequestContext) => Effect.Effect<readonly JsonObject[], Failure>;
  readonly findPage: (context: BoundedRequestContext) => Effect.Effect<Readonly<{ rows: readonly JsonObject[]; hasMore: boolean }>, Failure>;
  readonly count: (context: BoundedRequestContext) => Effect.Effect<number, Failure>;
}

export interface LogicalRelationalStore<Failure> {
  /** Inert source-bound construction. Capture and validation remain inside the
   * first actual guarded operation; each execution charges the complete query. */
  readonly prepareRead: (query: unknown) => LogicalRelationalReadProgram<Failure>;
  /** Complete bounded selection before projection/windowing; overflow refuses. */
  readonly find: (context: BoundedRequestContext, query: unknown) => Effect.Effect<readonly JsonObject[], Failure>;
  /** Ordered bounded work. No total or reusable physical cursor is implied. */
  readonly findPage: (context: BoundedRequestContext, query: unknown) => Effect.Effect<Readonly<{ rows: readonly JsonObject[]; hasMore: boolean }>, Failure>;
  readonly count: (context: BoundedRequestContext, query: unknown) => Effect.Effect<number, Failure>;
  /** Finite indexed complete selection; exact decimal SUM, without grouping. */
  readonly aggregate: (context: BoundedRequestContext, query: unknown) => Effect.Effect<Readonly<{ count: number; sum?: string | null }>, Failure>;
  /** The preserving-deletion upsert requires a trusted explicit profile; omitted
   * deletion fields retain their prior value and conflicts advance update time. */
  readonly write: (context: BoundedRequestContext, mode: "insert" | "upsert" | "update" | "upsertPreservingDeletion", rows: unknown) => Effect.Effect<readonly JsonObject[], Failure>;
  readonly delete: (context: BoundedRequestContext, keys: unknown) => Effect.Effect<readonly JsonObject[], Failure>;
  readonly lifecycle: (context: BoundedRequestContext, operation: "softDelete" | "restore", keys: unknown) => Effect.Effect<readonly JsonObject[], Failure>;
  /** Explicit trusted admission only. Exact complete preimages must have been
   * physically deleted in this live root; no persisted-history reconstruction. */
  readonly reconstitute?: (context: BoundedRequestContext, rows: unknown) => Effect.Effect<readonly JsonObject[], Failure>;
  /** Trusted framework compensation only. Complete rows must match recorded
   * preimages in this exact source; supplied managed values alone grant no authority. */
  readonly replay?: (context: BoundedRequestContext, rows: unknown) => Effect.Effect<readonly JsonObject[], Failure>;
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
  demand?: LogicalStorageReadDemand,
) => Effect.Effect<A, E | Failure>;

/** A trusted storage owner selects these mechanics after compiling the actual
 * query. Parameters, user projections and a method name grant no readiness. */
export type LogicalStorageReadDemand =
  | Readonly<{ kind: "clock" }>
  | Readonly<{ kind: "rows"; tableId: CatalogTableId }>
  | Readonly<{ kind: "index"; tableId: CatalogTableId; indexDefinitionId: CatalogIndexDefinitionId }>
  | Readonly<{ kind: "unique"; tableId: CatalogTableId; uniqueConstraintDefinitionId: CatalogUniqueConstraintDefinitionId }>
  | Readonly<{ kind: "search"; tableId: CatalogTableId; logicalIndexId: CatalogIndexId }>;

export type LogicalDocumentTable = Readonly<{ tableId: CatalogTableId; logicalName: string;
  relational?: RelationalTableDefinition; relationalMechanics?: PreparedLogicalRelationalTableMechanics }>;

declare const readMechanicsBrand: unique symbol;
/** Immutable table mechanics issued and bounded by the existing host lease. */
export interface PreparedLogicalDocumentReadMechanics {
  readonly [readMechanicsBrand]: true;
  readonly tables: readonly LogicalDocumentTable[];
  readonly relationalCapabilities: readonly RelationalPersistenceCapability[] | undefined;
  readonly searchDefinitions: readonly LogicalSearchDefinition[];
}

declare const writeMechanicsBrand: unique symbol;
/** Complete writable metadata retained by its authenticated source host. All
 * mutable lookup maps stay private to the issuing mechanics owner. */
export interface PreparedLogicalDocumentWriteMechanics {
  readonly [writeMechanicsBrand]: true;
  /** Scalar projections borrow the issuer's private lookups without exposing
   * its maps or constructing a source catalog in each native invocation. */
  readonly tableName: (tableId: CatalogTableId) => string | undefined;
  readonly tableId: (logicalName: string) => CatalogTableId | undefined;
  readonly tables: readonly LogicalDocumentTable[];
  readonly relationalCapabilities: readonly RelationalPersistenceCapability[] | undefined;
  readonly searchDefinitions: readonly LogicalSearchDefinition[];
  readonly indexes: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
}

export type LogicalFiniteStorageCapture<Failure> = <K extends FiniteStorageCaptureOperation["kind"]>(
  operation: Extract<FiniteStorageCaptureOperation, { kind: K }>, demand: LogicalStorageReadDemand,
) => Effect.Effect<FiniteStorageCaptureEnvelopes[K], Failure>;

export type LogicalStorageReadReadiness<Failure> =
  | Readonly<{ kind: "full" }>
  | Readonly<{ kind: "queryRequired";
      mechanics: PreparedLogicalDocumentReadMechanics;
      requireDemand: (tx: FlarexMetadataTransaction, demand: LogicalStorageReadDemand) => Effect.Effect<void, Failure> }>
  | Readonly<{ kind: "finiteQueryRequired";
      mechanics: PreparedLogicalDocumentWriteMechanics;
      captureStorage: LogicalFiniteStorageCapture<Failure> }>;

/** Only the independently durable borrowed profile decodes journal overlays.
 * Finite execution shares the root evaluator directly. */
export type LogicalPendingDocumentSeed = Readonly<{
  tableId: CatalogTableId;
  rowId: AppRowIdHexV1;
  evidence: ApplicationDocumentObservation["dependency"]["observed"] |
    Readonly<{ kind: "generatedInsertion"; effectOrdinal: number;
      origin: Readonly<{ syscallSequence: bigint; sourceBindingSha256Hex: string }> }>;
  overlay: Readonly<{ kind: "live"; creationTime: AppCreationTimeV1; document: CanonicalFlarexValueV1 }> |
    Readonly<{ kind: "deleted" }>;
}>;

/** The admitted journal supplies exactly one pending-view authority to each
 * borrowed native call. The finite branch binds the caller's exact attempt. */
export type LogicalDocumentBorrowView =
  | Readonly<{ pendingRows: readonly LogicalPendingDocumentSeed[];
      rootEvaluator?: never; rootAttemptFence?: never; captureStorage?: never }>
  | Readonly<{ pendingRows?: never;
      rootEvaluator: LogicalDocumentRootEvaluator; rootAttemptFence: string;
      captureStorage: LogicalFiniteStorageCapture<FiniteStorageCaptureError> }>;

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
  readonly tables: readonly LogicalDocumentTable[];
  readonly relationalCapabilities?: readonly RelationalPersistenceCapability[];
  readonly reconstitution?: LogicalReconstitutionPolicy;
  readonly allowPreservingDeletionUpsert?: LogicalPreservingDeletionUpsertPolicy;
  readonly allowActiveRestoreUpdate?: true;
  readonly allowStorageInsertionOrder?: true;
  readonly recordedRowReplay?: Readonly<{ schemaVersionId: CatalogSchemaVersionId }>;
  readonly detachDeletedReferences?: true;
  readonly searchDefinitions?: readonly LogicalSearchDefinition[];
  readonly lifetime: BoundedRequestLifetime<Failure>;
  /** Durable operations check live admission here. A finite root supplies a
   * tentative local gate; every readTransaction still checks live authority. */
  readonly requireAdmission: Effect.Effect<void, Failure>;
  /** Existing full-admission profiles retain their complete source proof.
   * Selected read profiles must supply their transaction-owned demand guard. */
  readonly readReadiness?: LogicalStorageReadReadiness<Failure>;
  /** Authentic immutable source mechanics; fresh admission and storage readiness
   * remain owned by the selected execution profile. */
  readonly writeMechanics?: PreparedLogicalDocumentWriteMechanics;
  readonly validateDocument: (write: LogicalDocumentWrite) => Effect.Effect<void, Failure>;
  readonly error: LogicalDocumentFailure<Failure>;
  readonly uniqueConflict: (constraint: Readonly<{ tableName: string; orderedFields: readonly string[] }>) => Failure;
  readonly limits: Readonly<{ pageRows: number; identities: number; documentBytes: number }>;
}> & LogicalDocumentWorkingSetRoot & (
  | Readonly<{ readonly tx: FlarexMetadataTransaction; readonly readTransaction?: never }>
  | Readonly<{ readonly tx?: never; readonly readTransaction: LogicalDocumentReadTransaction<Failure> }>
);
