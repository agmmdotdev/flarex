import { copyBytes } from "@flarex/utils/bytes";
import { Data, Result, Schema } from "effect";
import { CatalogIndexDefinitionIdSchema, CatalogTableIdSchema, CatalogUniqueConstraintDefinitionIdSchema } from "flarex-protocol/catalog";
import { IndexBuildAttemptFenceSchema } from "flarex-protocol/index-build-state";
import { AppUniqueConstraintSetBuildAttemptFenceV1Schema } from "flarex-protocol/internal/app-unique-constraint-set-v1";
import { CommitSeqSchema, FlarexDbV1StorageGenerationSchema, ScopeEpochSchema, ScopeIdSchema,
  StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";

const positiveSequence = Schema.BigInt.check(Schema.makeFilter(value =>
  value > 0n && value <= 9_223_372_036_854_775_807n ? undefined : "Expected positive storage sequence"));
const digest = Schema.Uint8Array.check(Schema.makeFilter(value => value.byteLength === 32 ? undefined : "Expected SHA-256 bytes"));
const opening = {
  scopeId: Schema.toType(ScopeIdSchema),
  activationSequence: positiveSequence,
  storageGeneration: FlarexDbV1StorageGenerationSchema,
  storageGenerationFence: Schema.toType(StorageGenerationFenceSchema),
  epoch: Schema.toType(ScopeEpochSchema),
  openedCommitSeq: Schema.toType(CommitSeqSchema),
  tableId: CatalogTableIdSchema,
  physicalSpecSha256: digest,
  deploymentId: Schema.NonEmptyString,
  schemaVersionId: Schema.NonEmptyString,
  activationSha256: digest,
  headSha256: digest,
};

/** Typed storage binding only. Current requirement and head eligibility remain
 * the accepting domain's fresh comparison against genuine selected authority. */
export const IndexMaintenanceObligationSchema = Schema.Struct({
  ...opening,
  indexDefinitionId: CatalogIndexDefinitionIdSchema,
  attemptFence: Schema.toType(IndexBuildAttemptFenceSchema),
  firstReadableCommitSeq: Schema.toType(CommitSeqSchema),
  schemaManifestSha256: digest,
}).check(Schema.makeFilter(value => value.firstReadableCommitSeq <= value.openedCommitSeq
  ? undefined : "First-readable frontier exceeds opening frontier"));
export type IndexMaintenanceObligation = typeof IndexMaintenanceObligationSchema.Type;

export const UniqueMaintenanceObligationSchema = Schema.Struct({
  ...opening,
  uniqueConstraintDefinitionId: CatalogUniqueConstraintDefinitionIdSchema,
  attemptFence: Schema.toType(AppUniqueConstraintSetBuildAttemptFenceV1Schema),
  startCommitSeq: Schema.toType(CommitSeqSchema),
}).check(Schema.makeFilter(value => value.startCommitSeq <= value.openedCommitSeq
  ? undefined : "Unique build start exceeds opening frontier"));
export type UniqueMaintenanceObligation = typeof UniqueMaintenanceObligationSchema.Type;

export class IndexMaintenanceError extends Data.TaggedError("IndexMaintenanceError")<{
  readonly reason: "storedState" | "resourceFailure" | "unavailable";
  readonly cause?: unknown;
  readonly retryable?: boolean;
}> {}
export class UniqueMaintenanceError extends Data.TaggedError("UniqueMaintenanceError")<{
  readonly reason: "storedState" | "resourceFailure" | "unavailable";
  readonly cause?: unknown;
  readonly retryable?: boolean;
}> {}

const decodeIndex = Schema.decodeUnknownResult(IndexMaintenanceObligationSchema, { onExcessProperty: "error" });
const decodeUnique = Schema.decodeUnknownResult(UniqueMaintenanceObligationSchema, { onExcessProperty: "error" });

export function decodeIndexMaintenanceObligationResult(row: unknown): Result.Result<IndexMaintenanceObligation, IndexMaintenanceError> {
  return decodeIndex(row).pipe(
    Result.mapError(cause => new IndexMaintenanceError({ reason: "storedState", cause })),
    Result.map(value => Object.freeze({ ...value, physicalSpecSha256: copyBytes(value.physicalSpecSha256),
      schemaManifestSha256: copyBytes(value.schemaManifestSha256), activationSha256: copyBytes(value.activationSha256),
      headSha256: copyBytes(value.headSha256) })),
  );
}
export function decodeUniqueMaintenanceObligationResult(row: unknown): Result.Result<UniqueMaintenanceObligation, UniqueMaintenanceError> {
  return decodeUnique(row).pipe(
    Result.mapError(cause => new UniqueMaintenanceError({ reason: "storedState", cause })),
    Result.map(value => Object.freeze({ ...value, physicalSpecSha256: copyBytes(value.physicalSpecSha256),
      activationSha256: copyBytes(value.activationSha256), headSha256: copyBytes(value.headSha256) })),
  );
}
