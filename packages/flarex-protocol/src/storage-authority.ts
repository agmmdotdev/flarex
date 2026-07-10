import { Schema, SchemaTransformation } from "effect";

const CanonicalUnsignedDecimalString = Schema.String.check(
  Schema.isPattern(/^(?:0|[1-9][0-9]*)$/),
);

const NonNegativeBigInt = Schema.BigInt.check(
  Schema.isGreaterThanOrEqualToBigInt(0n),
);

const CanonicalUnsignedBigIntFromString = CanonicalUnsignedDecimalString.pipe(
  Schema.decodeTo(NonNegativeBigInt, SchemaTransformation.bigintFromString),
);

export const ScopeIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("FlarexDB/ScopeId"),
);
export type ScopeId = typeof ScopeIdSchema.Type;

export const ScopeEpochSchema = Schema.NonEmptyString.pipe(
  Schema.brand("FlarexDB/ScopeEpoch"),
);
export type ScopeEpoch = typeof ScopeEpochSchema.Type;

export const CommitSeqSchema = CanonicalUnsignedBigIntFromString.pipe(
  Schema.brand("FlarexDB/CommitSeq"),
);
export type CommitSeq = typeof CommitSeqSchema.Type;

export const OutboxSeqSchema = CanonicalUnsignedBigIntFromString.pipe(
  Schema.brand("FlarexDB/OutboxSeq"),
);
export type OutboxSeq = typeof OutboxSeqSchema.Type;

export const StorageGenerationSchema = Schema.Union([
  Schema.Literal("legacy_v1"),
  Schema.Literal("flarexdb_v1"),
]).pipe(Schema.brand("FlarexDB/StorageGeneration"));
export type StorageGeneration = typeof StorageGenerationSchema.Type;

export const SnapshotTokenSchema = Schema.Struct({
  scopeId: ScopeIdSchema,
  epoch: ScopeEpochSchema,
  commitSeq: CommitSeqSchema,
}).annotate({
  parseOptions: { onExcessProperty: "error" },
}).pipe(Schema.brand("FlarexDB/SnapshotToken"));
export type SnapshotToken = typeof SnapshotTokenSchema.Type;
