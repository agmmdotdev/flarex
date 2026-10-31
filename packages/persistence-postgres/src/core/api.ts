import { Data, Schema, type Effect, type Option } from "effect";
import type { DocumentObject, DocumentValue } from "flarex-protocol/document-value";
import type { CoreTableNamespace } from "./namespace";
import type { CoreSchemaError } from "./schemaTypes";
import type {
  CoreIndexCursor, CoreIndexRef, CoreInterval, CoreOrder, CorePersistenceError, CoreTimestamp,
} from "./contracts";
import type { CoreReadSet } from "./writeLog";
import type { JsonObject } from "flarex-protocol/json";
import { CoreTableIteratorResourceBudgetSchema, CoreIteratorPositiveBudgetSchema } from "./iteratorBudget";
import type { CoreNativeDefinition, CoreNativeIdentity, CoreNativeTablePolicy } from "./nativePolicy";
import type { CoreSchemaBundle } from "./schemaBundle";

export interface CoreIndexDefinition {
  readonly name: string;
  readonly ref: CoreIndexRef;
  /** Fully normalized installed fields; producers add their suffixes. Engine appends only the developer-ID tie. */
  readonly fields: readonly string[];
}

export interface CoreTableDefinition {
  readonly name: string;
  readonly number: number;
  readonly tabletId: Uint8Array;
  readonly namespace: CoreTableNamespace;
  readonly state: "active" | "hidden" | "deleting";
  readonly indexes: readonly CoreIndexDefinition[];
  readonly nativePolicy?: CoreNativeTablePolicy;
}

export const CoreProgramIdentitySchema = Schema.Struct({ functionPath: Schema.NonEmptyString,
  programHash: Schema.NonEmptyString, schemaHash: Schema.NonEmptyString });
export type CoreProgramIdentity = typeof CoreProgramIdentitySchema.Type;

export interface CoreProgramDefinition {
  readonly identity: CoreProgramIdentity;
  /** Source/runtime manifests and immutable artifact references, never DB capabilities. */
  readonly metadata: DocumentObject;
}

export interface CoreProgramPublication {
  readonly programs: readonly CoreProgramDefinition[];
  readonly authorityEpoch?: bigint;
  readonly namespace?: CoreTableNamespace;
  readonly native?: CoreNativeDefinition;
  readonly bundle?: CoreSchemaBundle;
}
export interface CoreSchemaProposal { readonly namespace: CoreTableNamespace; readonly id: string }
export interface CoreSchemaStatus {
  readonly proposal: CoreSchemaProposal;
  readonly state: "pending" | "validated" | "active" | "failed" | "overwritten";
  readonly indexesReady: boolean;
  readonly error?: string;
  readonly tableName?: string;
}
export interface CoreSchemaActivation {
  readonly timestamp: CoreTimestamp;
  readonly tables: readonly CoreTableDefinition[];
}

interface CoreRequestCorrelation {
  readonly key: string;
  /** Canonical profile correlation of request, arguments and authenticated identity. */
  readonly requestHash: string;
}
export interface CoreNativeCommandIdentity { readonly source: CoreNativeIdentity; readonly name: string; readonly mode: "read" | "write" }
export interface CoreNativeCommandDefinition { readonly name: string; readonly mode: "read" | "write"; readonly identity: CoreNativeCommandIdentity }
/** Digest of the complete stable selected root contract, issued with a confined binding. */
export const CoreNativeRootIdentitySchema = Schema.Struct({ definitionHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)) })
  .annotate({ parseOptions: { onExcessProperty: "error" } });
export type CoreNativeRootIdentity = typeof CoreNativeRootIdentitySchema.Type;
export type CoreRequestIdentity = CoreRequestCorrelation & (
  | Readonly<{ kind?: "application"; program: CoreProgramIdentity }>
  | Readonly<{ kind: "native"; native: CoreNativeCommandIdentity }>
  | Readonly<{ kind: "nativeRoot"; root: CoreNativeRootIdentity }>
);

const nativeBindingBrand: unique symbol = Symbol("CoreNativeBinding");
export interface CoreNativeBinding { readonly [nativeBindingBrand]: true }
const nativeInitializationBindingBrand: unique symbol = Symbol("CoreNativeInitializationBinding");
/** Exact native command role; only proven failed initialization can be reclaimed. */
export interface CoreNativeInitializationBinding { readonly [nativeInitializationBindingBrand]: true }
export interface CoreNativeBindingMetadata {
  readonly definition: CoreNativeDefinition;
  readonly namespace: CoreTableNamespace;
  readonly schemaId: string;
  readonly authorityEpoch: bigint;
  readonly tables: readonly CoreTableDefinition[];
  readonly commands: readonly CoreNativeCommandDefinition[];
}

const nativeRootBindingBrand: unique symbol = Symbol("CoreNativeRootBinding");
export interface CoreNativeRootBinding { readonly [nativeRootBindingBrand]: true }
const applicationInsertBindingBrand: unique symbol = Symbol("CoreApplicationInsertBinding");
export interface CoreApplicationInsertBinding { readonly [applicationInsertBindingBrand]: true }
export interface CoreNativeRootParticipant {
  readonly binding: CoreNativeBinding;
  readonly commands: readonly string[];
  readonly limits: CoreNativeLimits;
}
export interface CoreNativeRootBindingInput {
  readonly bundle: CoreSchemaBundle;
  readonly contract: JsonObject;
  readonly participants: readonly CoreNativeRootParticipant[];
  /** One insert into an authentic Application-owned table; no committed read grant. */
  readonly applicationInsert?: Readonly<{ table: string; maxDocumentBytes: number }>;
  readonly maxFinalUserDocuments: number;
}
export interface CoreNativeRootBindingMetadata {
  readonly identity: CoreNativeRootIdentity;
  readonly namespace: CoreTableNamespace;
  readonly schemaId: string;
  readonly authorityEpoch: bigint;
  readonly limits: CoreNativeLimits;
  readonly maxFinalUserDocuments: number;
  readonly participants: readonly Readonly<{ binding: CoreNativeBinding; commands: readonly CoreNativeCommandDefinition[];
    definition: CoreNativeDefinition; limits: CoreNativeLimits }>[];
  readonly applicationInsert?: Readonly<{ binding: CoreApplicationInsertBinding; table: CoreTableDefinition; limits: CoreNativeLimits }>;
}

const requestClaimBrand: unique symbol = Symbol("CoreRequestClaim");
export interface CoreRequestClaim { readonly [requestClaimBrand]: true }
const finalizedTransactionBrand: unique symbol = Symbol("CoreFinalizedTransaction");
export interface CoreFinalizedTransaction { readonly [finalizedTransactionBrand]: true }

export type CoreRequestResolution =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "busy" }>
  | Readonly<{ kind: "failed" }>
  | Readonly<{ kind: "committed"; timestamp: CoreTimestamp; result: DocumentValue }>;

export type CoreRequestAcquisition =
  | Exclude<CoreRequestResolution, Readonly<{ kind: "missing" }>>
  | Readonly<{ kind: "claimed"; claim: CoreRequestClaim }>;

export class CoreTransactionError extends Data.TaggedError("CoreTransactionError")<{
  readonly reason: "closed" | "inflight" | "foreignFinalization" | "conflict"
    | "invalidValue" | "documentValidation" | "missingTable" | "missingIndex" | "indexUnavailable"
    | "missingDocument" | "invalidDocumentId" | "documentExists" | "documentDeleted" | "programUnavailable"
    | "requestMismatch" | "foreignClaim" | "tooManyTables" | "capacity" | "unavailable" | "authorityRevoked" | "admissionExpired" | "readonly";
  readonly cause?: unknown;
}> {}

/** Source query/cursor refusals are catchable; capacity, authority and corruption retain their owners. */
export class CoreQueryInputError extends Data.TaggedError("CoreQueryInputError")<{
  readonly reason: "invalidQuery" | "invalidCursor";
  readonly cause?: unknown;
}> {}
export class CoreNativeQueryError extends Data.TaggedError("CoreNativeQueryError")<{
  readonly reason: "invalidInput";
  readonly cause?: unknown;
}> {}
export class CoreNativeBudgetError extends Data.TaggedError("CoreNativeBudgetError")<{
  readonly reason: "limitExceeded" | "closed" | "rollbackOnly" | "unexpectedFailure";
  readonly cause?: unknown;
}> {}
export class CoreNativeUniqueConflict extends Data.TaggedError("CoreNativeUniqueConflict")<{
  readonly tableName: string;
  readonly descriptor: string;
  readonly fields: readonly string[];
}> { readonly reason = "uniqueConflict"; }

export type CoreError = CoreTransactionError | CorePersistenceError | CoreQueryInputError | CoreSchemaError | CoreNativeUniqueConflict | CoreNativeQueryError | CoreNativeBudgetError;

export interface CoreQueryRequest {
  /** Captured once by the protocol query owner, then resolved against this transaction's registry. */
  readonly query: unknown;
  readonly cursor?: Readonly<{ position: CoreIndexCursor; queryFingerprint: Uint8Array }>;
}

export interface CoreQueryPage {
  readonly documents: readonly DocumentObject[];
  /** Null means no source position has been consumed, for example Limit(0). */
  readonly position: CoreIndexCursor | null;
  /** Logical limit or observed source exhaustion; a full page alone does not establish exhaustion. */
  readonly done: boolean;
}

/** Trusted operation-owned capability. No SQL lifetime or operation lock spans page calls. */
export interface CoreQuery {
  readonly queryFingerprint: Uint8Array;
  readonly nextPage: (options: Readonly<{
    /** maxBytes independently bounds encoded JSON and normalized semantic bytes. */
    maxResults: number; maxBytes: number;
    /** Pure trusted projection of both transport envelope and protected cursor overhead measures. */
    positionSize?: (position: CoreIndexCursor | null) => Readonly<{ encodedBytes: number; semanticBytes: number }>;
  }>) => Effect.Effect<CoreQueryPage, CoreError>;
  readonly close: () => Effect.Effect<void, CoreError>;
}

const NonnegativeLimit = Schema.Int.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0
  ? undefined : "Expected a nonnegative safe resource limit"));
export const CoreTransactionLimitsSchema = Schema.Struct({ documentsRead: NonnegativeLimit, bytesRead: NonnegativeLimit,
  databaseQueries: NonnegativeLimit, documentsWritten: NonnegativeLimit, bytesWritten: NonnegativeLimit,
  systemDocumentsWritten: NonnegativeLimit, systemBytesWritten: NonnegativeLimit });
export type CoreTransactionLimits = typeof CoreTransactionLimitsSchema.Type;
export interface CoreDocumentUsage {
  readonly documentsRead: number;
  readonly bytesRead: number;
  readonly documentsWritten: number;
  readonly bytesWritten: number;
}
export interface CoreTransactionUsage {
  readonly user: CoreDocumentUsage;
  readonly system: CoreDocumentUsage;
  readonly databaseQueries: number;
}

export interface CoreCommitOptions {
  readonly claim?: CoreRequestClaim;
  readonly result?: DocumentValue;
  /** Trusted profile deadline in epoch milliseconds; pending acceptance requires Clock time strictly below it. */
  readonly admissionDeadlineUnixMilliseconds?: number;
}

export interface CoreTransaction {
  readonly timestamp: CoreTimestamp;
  /** Fixed epoch milliseconds for the operation, from max(wall time, ceil(snapshot ns / 1e6)). */
  readonly unixTime: number;
  readonly tableNumber: (name: string) => Effect.Effect<number, CoreError>;
  readonly tableMappings: Effect.Effect<readonly Readonly<{ tableId: number; logicalName: string }>[], CoreError>;
  readonly normalizeId: (table: string, id: unknown) => Effect.Effect<Option.Option<string>, CoreError>;
  readonly usage: Effect.Effect<CoreTransactionUsage>;
  /** Resolve and track metadata in this operation's captured registry, including nested calls. */
  readonly selectProgram: (functionPath: string) => Effect.Effect<CoreProgramDefinition, CoreError>;
  readonly get: (id: string) => Effect.Effect<Option.Option<DocumentObject>, CoreError>;
  readonly insert: (table: string, value: unknown) => Effect.Effect<string, CoreError>;
  readonly patch: (id: string, value: unknown) => Effect.Effect<void, CoreError>;
  readonly replace: (id: string, value: unknown) => Effect.Effect<void, CoreError>;
  readonly delete: (id: string) => Effect.Effect<void, CoreError>;
  readonly startQuery: (request: CoreQueryRequest) => Effect.Effect<CoreQuery, CoreError>;
  readonly scan: (table: string, index: string, options?: Readonly<{
    interval?: CoreInterval; order?: CoreOrder; limit?: number;
  }>) => Effect.Effect<readonly DocumentObject[], CoreError>;
  /** Refuses in-flight work, closes the operation, and issues a single-use transfer. */
  readonly finalize: () => Effect.Effect<CoreFinalizedTransaction, CoreError>;
  readonly abort: () => Effect.Effect<void>;
}

/** Borrowed reads have neither write methods nor a mutation finalizer. */
export type CoreReadTransaction = Pick<CoreTransaction, "timestamp" | "unixTime" | "usage" | "selectProgram"
  | "tableNumber" | "tableMappings" | "normalizeId" | "get" | "startQuery" | "scan">;

export type CoreNativeOperations = Pick<CoreTransaction, "get" | "insert" | "patch" | "replace" | "delete" | "normalizeId"> & {
  /** Relational metadata owns full-batch preflight and native mutation phases. */
  readonly writeRows: (table: string, mode: "insert" | "upsert" | "update", rows: unknown) =>
    Effect.Effect<readonly DocumentObject[], CoreError>;
  readonly deleteRows: (table: string, keys: unknown) => Effect.Effect<readonly DocumentObject[], CoreError>;
  /** Bounded key-presence proof; empty source observes the complete absence interval. */
  readonly isEmpty: (table: string) => Effect.Effect<boolean, CoreError>;
  readonly find: (table: string, where: JsonObject) => Effect.Effect<readonly DocumentObject[], CoreError>;
  /** Native examined-window semantics, distinct from complete-range find and Source queries. */
  readonly findPage: (table: string, where: JsonObject, options: Readonly<{
    indexName: string; offset: number; limit: number; order?: "asc";
  }>) => Effect.Effect<Readonly<{ documents: readonly DocumentObject[]; hasMore: boolean }>, CoreError>;
};
export interface CoreNativeLimits { readonly maxIdentities: number; readonly maxDocumentBytes: number }
/** Trusted outer host owns this operation; only operations may enter a framework facade. */
export interface CoreNativeOperation {
  readonly unixTime: number;
  readonly command: CoreNativeCommandDefinition;
  readonly operations: CoreNativeOperations;
  readonly finishRead: () => Effect.Effect<CoreReadToken, CoreError>;
  readonly finalize: () => Effect.Effect<CoreFinalizedTransaction, CoreError>;
  readonly abort: () => Effect.Effect<void>;
}
export interface CoreApplicationInsertOperations {
  readonly insert: (value: unknown) => Effect.Effect<string, CoreError>;
  readonly readPending: (id: string) => Effect.Effect<Option.Option<DocumentObject>, CoreError>;
}
export interface CoreNativeRootOperation {
  readonly unixTime: number;
  readonly native: (binding: CoreNativeBinding) => Effect.Effect<CoreNativeOperations, CoreError>;
  readonly applicationInsert: (binding: CoreApplicationInsertBinding) => Effect.Effect<CoreApplicationInsertOperations, CoreError>;
  readonly finalize: () => Effect.Effect<CoreFinalizedTransaction, CoreError>;
  readonly abort: () => Effect.Effect<void>;
}

/** Trusted completion evidence only; it cannot enter CoreDatabase.commit. */
export interface CoreReadToken {
  readonly timestamp: CoreTimestamp;
  readonly reads: CoreReadSet;
}

export interface CoreQueryOperation {
  readonly program: CoreProgramDefinition;
  readonly transaction: CoreReadTransaction;
  /** Consumes the read operation after every terminal and stream has drained. */
  readonly finish: () => Effect.Effect<CoreReadToken, CoreError>;
  readonly abort: () => Effect.Effect<void>;
}

export interface CoreDatabase {
  readonly assertOpen: Effect.Effect<void, CoreError>;
  /** Blocks admission and results, then closes and drains every borrowed operation. */
  readonly close: () => Effect.Effect<void>;
  readonly beginQuery: (functionPath: string) => Effect.Effect<CoreQueryOperation, CoreError>;
  readonly prepareSchema: (input: Readonly<{ namespace?: CoreTableNamespace; schema?: unknown; native?: CoreNativeDefinition;
    bundle?: CoreSchemaBundle }>) => Effect.Effect<CoreSchemaProposal, CoreError>;
  readonly schemaStatus: (proposal: CoreSchemaProposal) => Effect.Effect<CoreSchemaStatus, CoreError>;
  readonly advanceSchemaWork: (work:CoreSchemaWorkBudget)=>Effect.Effect<Readonly<{hasMore:boolean}>,CoreError>;
  readonly advanceSchema: (proposal: CoreSchemaProposal, work: Readonly<{ pageSize: number; maxPages: number }>) => Effect.Effect<CoreSchemaStatus, CoreError>;
  readonly activateSchema: (proposal: CoreSchemaProposal, publication: CoreProgramPublication) => Effect.Effect<CoreSchemaActivation, CoreError>;
  readonly publishPrograms: (publication: CoreProgramPublication) => Effect.Effect<CoreSchemaActivation, CoreError>;
  readonly selectProgram: (functionPath: string) => Effect.Effect<CoreProgramDefinition, CoreError>;
  readonly lookupProgram: (identity: CoreProgramIdentity) => Effect.Effect<CoreProgramDefinition, CoreError>;
  readonly bindNative: (input: Readonly<{ definition: CoreNativeDefinition; namespace?: CoreTableNamespace;
    commands?: readonly Readonly<{ name: string; mode: "read" | "write" }>[] }>) => Effect.Effect<CoreNativeBinding, CoreError>;
  readonly readNativeBinding: (binding: CoreNativeBinding) => Effect.Effect<CoreNativeBindingMetadata, CoreError>;
  readonly bindNativeInitialization: (input: Readonly<{ binding: CoreNativeBinding; commandName: string }>) =>
    Effect.Effect<CoreNativeInitializationBinding, CoreError>;
  readonly beginNative: (binding: CoreNativeBinding, options: Readonly<{ commandName: string; claim?: CoreRequestClaim;
    limits: CoreNativeLimits; chargeRetained: (bytes: number) => Effect.Effect<void, CoreError> }>) => Effect.Effect<CoreNativeOperation, CoreError>;
  readonly bindNativeRoot: (input: CoreNativeRootBindingInput) => Effect.Effect<CoreNativeRootBinding, CoreError>;
  readonly readNativeRootBinding: (binding: CoreNativeRootBinding) => Effect.Effect<CoreNativeRootBindingMetadata, CoreError>;
  readonly beginNativeRoot: (binding: CoreNativeRootBinding, options: Readonly<{ claim: CoreRequestClaim;
    chargeRetained: (bytes: number) => Effect.Effect<void, CoreError> }>) => Effect.Effect<CoreNativeRootOperation, CoreError>;
  readonly resolveRequest: (identity: CoreRequestIdentity) => Effect.Effect<CoreRequestResolution, CoreError>;
  /** Fenced predecessor recovery; never executes another body or abandons a current-owner claim. */
  readonly recoverRequest: (identity: CoreRequestIdentity) => Effect.Effect<CoreRequestResolution, CoreError>;
  readonly claimRequest: (identity: CoreRequestIdentity, nativeBinding?: CoreNativeBinding | CoreNativeRootBinding | CoreNativeInitializationBinding) => Effect.Effect<CoreRequestAcquisition, CoreError>;
  readonly abortRequest: (claim: CoreRequestClaim) => Effect.Effect<void, CoreError>;
  readonly begin: (options?: Readonly<{
    program?: CoreProgramIdentity; claim?: CoreRequestClaim; at?: CoreTimestamp; authorityEpoch?: bigint; namespace?: CoreTableNamespace;
  }>) => Effect.Effect<CoreTransaction, CoreError>;
  readonly commit: (transaction: CoreFinalizedTransaction, options?: CoreCommitOptions) => Effect.Effect<CoreTimestamp, CoreError>;
  readonly publishedTimestamp: Effect.Effect<CoreTimestamp>;
  readonly readAuthorityEpoch: Effect.Effect<bigint, CoreError>;
  readonly advanceAuthorityEpoch: (epoch: bigint) => Effect.Effect<void, CoreError>;
}

export const CoreSchemaWorkBudgetSchema=Schema.Struct({pageSize:CoreIteratorPositiveBudgetSchema,maxPages:CoreIteratorPositiveBudgetSchema});
export type CoreSchemaWorkBudget=typeof CoreSchemaWorkBudgetSchema.Type;
export const CoreSchemaWorkerOptionsSchema=Schema.Struct({...CoreTableIteratorResourceBudgetSchema.fields,
  physicalChunkSize:CoreIteratorPositiveBudgetSchema,physicalConcurrency:CoreIteratorPositiveBudgetSchema});
export type CoreSchemaWorkerOptions=typeof CoreSchemaWorkerOptionsSchema.Type;

export interface CoreDatabaseOptions {
  /** Trusted construction proofs are available before cold metadata authentication. */
  readonly schemaBundles?: readonly CoreSchemaBundle[];
  readonly schemaWorker:CoreSchemaWorkerOptions;
  readonly now: Effect.Effect<CoreTimestamp>;
  /** Trusted host entropy; the portable Core owns transaction-local ID generation. */
  readonly randomBytes: (length: 16 | 32) => Effect.Effect<Uint8Array>;
  readonly maxInflight?: number;
  readonly maxConcurrentSaves?: number;
  readonly maxBatchDocuments?: number;
  readonly maxBatchBytes?: number;
  readonly maxBatchDelayMilliseconds?: number;
  readonly batchWriteThreshold?: number;
  readonly maxConcurrentPrevalidations?: number;
  /** Application call ceilings; trusted lifecycle work starts with the source system defaults. */
  readonly transactionLimits?: Partial<CoreTransactionLimits>;
  /** Source defaults: 512 MiB shared pages and 100 percent verification. */
  readonly indexCache?: Readonly<{ maxBytes?: number; verifyPercent?: number }>;
  /** Source operation cache default is 16 MiB, separate from user read limits. */
  readonly operationCacheMaxBytes?: number;
}

/** Identity issuance stays internal; structural objects do not gain authority. */
export function issueCoreClaim(): CoreRequestClaim {
  return Object.freeze({ [requestClaimBrand]: true as const });
}
export function issueCoreNativeBinding(): CoreNativeBinding {
  return Object.freeze({ [nativeBindingBrand]: true as const });
}
export function issueCoreNativeInitializationBinding(): CoreNativeInitializationBinding {
  return Object.freeze({ [nativeInitializationBindingBrand]: true as const });
}
export function issueCoreNativeRootBinding(): CoreNativeRootBinding {
  return Object.freeze({ [nativeRootBindingBrand]: true as const });
}
export function issueCoreApplicationInsertBinding(): CoreApplicationInsertBinding {
  return Object.freeze({ [applicationInsertBindingBrand]: true as const });
}

export function issueFinalizedTransaction(): CoreFinalizedTransaction {
  return Object.freeze({ [finalizedTransactionBrand]: true as const });
}
