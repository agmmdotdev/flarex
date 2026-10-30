import { Data, Schema, type Effect, type Option } from "effect";
import type { DocumentObject, DocumentValue } from "flarex-protocol/document-value";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import type {
  CoreIndexCursor, CoreIndexRef, CoreInterval, CoreOrder, CorePersistenceError, CoreTimestamp,
} from "./contracts";

export interface CoreIndexDefinition {
  readonly name: string;
  readonly ref: CoreIndexRef;
  /** Fully normalized installed fields; producers add their suffixes. Engine appends only the developer-ID tie. */
  readonly fields: readonly string[];
  readonly enabled: boolean;
}

export interface CoreTableDefinition {
  readonly name: string;
  readonly number: number;
  readonly tabletId: Uint8Array;
  readonly validator: ValidatorJsonV1;
  readonly indexes: readonly CoreIndexDefinition[];
}

export const CoreProgramIdentitySchema = Schema.Struct({ functionPath: Schema.NonEmptyString,
  programHash: Schema.NonEmptyString, schemaHash: Schema.NonEmptyString });
export type CoreProgramIdentity = typeof CoreProgramIdentitySchema.Type;

export interface CoreProgramDefinition {
  readonly identity: CoreProgramIdentity;
  /** Source/runtime manifests and immutable artifact references, never DB capabilities. */
  readonly metadata: DocumentObject;
}

export interface CoreInstallation {
  readonly tables: readonly CoreTableDefinition[];
  readonly programs: readonly CoreProgramDefinition[];
  readonly authorityEpoch?: bigint;
}

export interface CoreRequestIdentity {
  readonly key: string;
  /** Canonical profile correlation of request, arguments and authenticated identity. */
  readonly requestHash: string;
  readonly program: CoreProgramIdentity;
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
    | "missingDocument" | "invalidDocumentId" | "programUnavailable"
    | "requestMismatch" | "foreignClaim" | "capacity" | "unavailable" | "authorityRevoked" | "admissionExpired";
  readonly cause?: unknown;
}> {}

/** Source query/cursor refusals are catchable; capacity, authority and corruption retain their owners. */
export class CoreQueryInputError extends Data.TaggedError("CoreQueryInputError")<{
  readonly reason: "invalidQuery" | "invalidCursor";
  readonly cause?: unknown;
}> {}

export type CoreError = CoreTransactionError | CorePersistenceError | CoreQueryInputError;

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
  readonly normalizeId: (table: string, id: unknown) => Effect.Effect<Option.Option<string>, CoreError>;
  readonly usage: Effect.Effect<CoreTransactionUsage>;
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

export interface CoreDatabase {
  readonly install: (installation: CoreInstallation) => Effect.Effect<void, CoreError>;
  readonly selectProgram: (functionPath: string) => Effect.Effect<CoreProgramDefinition, CoreError>;
  readonly lookupProgram: (identity: CoreProgramIdentity) => Effect.Effect<CoreProgramDefinition, CoreError>;
  readonly resolveRequest: (identity: CoreRequestIdentity) => Effect.Effect<CoreRequestResolution, CoreError>;
  /** Fenced predecessor recovery; never executes another body or abandons a current-owner claim. */
  readonly recoverRequest: (identity: CoreRequestIdentity) => Effect.Effect<CoreRequestResolution, CoreError>;
  readonly claimRequest: (identity: CoreRequestIdentity) => Effect.Effect<CoreRequestAcquisition, CoreError>;
  readonly abortRequest: (claim: CoreRequestClaim) => Effect.Effect<void, CoreError>;
  readonly begin: (options?: Readonly<{
    program?: CoreProgramIdentity; claim?: CoreRequestClaim; at?: CoreTimestamp; authorityEpoch?: bigint;
  }>) => Effect.Effect<CoreTransaction, CoreError>;
  readonly commit: (transaction: CoreFinalizedTransaction, options?: CoreCommitOptions) => Effect.Effect<CoreTimestamp, CoreError>;
  readonly publishedTimestamp: Effect.Effect<CoreTimestamp>;
  readonly readAuthorityEpoch: Effect.Effect<bigint, CoreError>;
  readonly advanceAuthorityEpoch: (epoch: bigint) => Effect.Effect<void, CoreError>;
}

export interface CoreDatabaseOptions {
  readonly now: Effect.Effect<CoreTimestamp>;
  readonly newInternalId: Effect.Effect<Uint8Array>;
  readonly maxInflight?: number;
  readonly maxConcurrentSaves?: number;
  readonly maxBatchDocuments?: number;
  readonly maxBatchBytes?: number;
  readonly maxBatchDelayMilliseconds?: number;
  readonly batchWriteThreshold?: number;
  readonly maxConcurrentPrevalidations?: number;
  readonly transactionLimits?: Partial<CoreTransactionLimits>;
}

/** Identity issuance stays internal; structural objects do not gain authority. */
export function issueCoreClaim(): CoreRequestClaim {
  return Object.freeze({ [requestClaimBrand]: true as const });
}

export function issueFinalizedTransaction(): CoreFinalizedTransaction {
  return Object.freeze({ [finalizedTransactionBrand]: true as const });
}
