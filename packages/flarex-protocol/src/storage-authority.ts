import { Data, Schema } from "effect";

import { isCanonicalUuidTextV1 } from "./canonical-uuid";
import {
  CanonicalNonNegativePostgresBigIntFromString,
  CanonicalPositivePostgresBigIntFromString,
  POSTGRES_SIGNED_BIGINT_MAX,
} from "./postgres-bigint";
import { StrictStructOptions } from "./strict-schema-options";

export const MAX_PERSISTED_SIGNED_INT64_V1 = POSTGRES_SIGNED_BIGINT_MAX;

export const ScopeIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("FlarexDB/ScopeId"),
);
export type ScopeId = typeof ScopeIdSchema.Type;

export const ScopeEpochSchema = Schema.NonEmptyString.pipe(
  Schema.brand("FlarexDB/ScopeEpoch"),
);
export type ScopeEpoch = typeof ScopeEpochSchema.Type;

export const ReplacementScopeIdV1Schema = ScopeIdSchema.check(
  Schema.makeFilter((value) =>
    value.startsWith("scope_") && isCanonicalUuidTextV1(value.slice(6))
      ? undefined
      : "Expected scope_<canonical lowercase UUID>",
  ),
).pipe(Schema.brand("FlarexDB/ReplacementScopeIdV1"));
export type ReplacementScopeIdV1 = typeof ReplacementScopeIdV1Schema.Type;
export const decodeReplacementScopeIdV1 = Schema.decodeUnknownSync(
  ReplacementScopeIdV1Schema,
);

export const ReplacementScopeEpochV1Schema = ScopeEpochSchema.check(
  Schema.makeFilter((value) =>
    value.startsWith("epoch_") && isCanonicalUuidTextV1(value.slice(6))
      ? undefined
      : "Expected epoch_<canonical lowercase UUID>",
  ),
).pipe(Schema.brand("FlarexDB/ReplacementScopeEpochV1"));
export type ReplacementScopeEpochV1 =
  typeof ReplacementScopeEpochV1Schema.Type;
export const decodeReplacementScopeEpochV1 = Schema.decodeUnknownSync(
  ReplacementScopeEpochV1Schema,
);

export const ScopeUuidV1Schema = Schema.String.check(
  Schema.makeFilter((value) =>
    isCanonicalUuidTextV1(value)
      ? undefined
      : "Expected one canonical lowercase scope UUID",
  ),
).pipe(Schema.brand("FlarexDB/ScopeUuidV1"));
export type ScopeUuidV1 = typeof ScopeUuidV1Schema.Type;
export const decodeScopeUuidV1 = Schema.decodeUnknownSync(ScopeUuidV1Schema);

export const ScopeEpochUuidV1Schema = Schema.String.check(
  Schema.makeFilter((value) =>
    isCanonicalUuidTextV1(value)
      ? undefined
      : "Expected one canonical lowercase scope epoch UUID",
  ),
).pipe(Schema.brand("FlarexDB/ScopeEpochUuidV1"));
export type ScopeEpochUuidV1 = typeof ScopeEpochUuidV1Schema.Type;
export const decodeScopeEpochUuidV1 = Schema.decodeUnknownSync(
  ScopeEpochUuidV1Schema,
);

export interface ScopeIdUuidProjectionV1 {
  readonly scopeId: ReplacementScopeIdV1;
  readonly scopeUuid: ScopeUuidV1;
}

export interface ScopeEpochUuidProjectionV1 {
  readonly epoch: ReplacementScopeEpochV1;
  readonly epochUuid: ScopeEpochUuidV1;
}

export type ScopeAuthorityUuidProjectionV1Issue = {
  readonly field: "scopeId" | "epoch";
  readonly reason:
    | "invalidType"
    | "invalidPrefix"
    | "invalidUuid"
    | "nonCanonical";
  readonly value: unknown;
};

export class InvalidScopeAuthorityUuidProjectionV1Error extends Data.TaggedError(
  "InvalidScopeAuthorityUuidProjectionV1Error",
)<{
  readonly issue: ScopeAuthorityUuidProjectionV1Issue;
}> {}

export function projectScopeIdUuidV1(
  value: unknown,
): ScopeIdUuidProjectionV1 {
  const projected = requirePrefixedCanonicalUuidV1(
    value,
    "scopeId",
    "scope_",
  );
  return Object.freeze({
    scopeId: ReplacementScopeIdV1Schema.make(projected.value),
    scopeUuid: ScopeUuidV1Schema.make(projected.uuid),
  } satisfies ScopeIdUuidProjectionV1);
}

export function projectScopeEpochUuidV1(
  value: unknown,
): ScopeEpochUuidProjectionV1 {
  const projected = requirePrefixedCanonicalUuidV1(
    value,
    "epoch",
    "epoch_",
  );
  return Object.freeze({
    epoch: ReplacementScopeEpochV1Schema.make(projected.value),
    epochUuid: ScopeEpochUuidV1Schema.make(projected.uuid),
  } satisfies ScopeEpochUuidProjectionV1);
}

export function replacementScopeIdV1FromUuid(
  value: unknown,
): ReplacementScopeIdV1 {
  const uuid = requireCanonicalUuidV1(value, "scopeId");
  return ReplacementScopeIdV1Schema.make(`scope_${uuid}`);
}

export function replacementScopeEpochV1FromUuid(
  value: unknown,
): ReplacementScopeEpochV1 {
  const uuid = requireCanonicalUuidV1(value, "epoch");
  return ReplacementScopeEpochV1Schema.make(`epoch_${uuid}`);
}

export const CommitSeqSchema =
  CanonicalNonNegativePostgresBigIntFromString.pipe(
    Schema.brand("FlarexDB/CommitSeq"),
  );
export type CommitSeq = typeof CommitSeqSchema.Type;

export const OutboxSeqSchema =
  CanonicalNonNegativePostgresBigIntFromString.pipe(
    Schema.brand("FlarexDB/OutboxSeq"),
  );
export type OutboxSeq = typeof OutboxSeqSchema.Type;

export const StorageGenerationFenceSchema =
  CanonicalPositivePostgresBigIntFromString.pipe(
    Schema.brand("FlarexDB/StorageGenerationFence"),
  );
export type StorageGenerationFence =
  typeof StorageGenerationFenceSchema.Type;

export const LegacyV1StorageGenerationSchema = Schema.Literal("legacy_v1").pipe(
  Schema.brand("FlarexDB/StorageGeneration"),
);
export type LegacyV1StorageGeneration =
  typeof LegacyV1StorageGenerationSchema.Type;

export const FlarexDbV1StorageGenerationSchema = Schema.Literal(
  "flarexdb_v1",
).pipe(Schema.brand("FlarexDB/StorageGeneration"));
export type FlarexDbV1StorageGeneration =
  typeof FlarexDbV1StorageGenerationSchema.Type;

export const StorageGenerationSchema = Schema.Union([
  LegacyV1StorageGenerationSchema,
  FlarexDbV1StorageGenerationSchema,
]);
export type StorageGeneration = typeof StorageGenerationSchema.Type;

export const SnapshotTokenSchema = Schema.Struct({
  scopeId: ScopeIdSchema,
  epoch: ScopeEpochSchema,
  commitSeq: CommitSeqSchema,
}).annotate(StrictStructOptions).pipe(Schema.brand("FlarexDB/SnapshotToken"));
export type SnapshotToken = typeof SnapshotTokenSchema.Type;

function requirePrefixedCanonicalUuidV1(
  value: unknown,
  field: "scopeId" | "epoch",
  prefix: "scope_" | "epoch_",
): { readonly value: string; readonly uuid: string } {
  if (typeof value !== "string") {
    throw new InvalidScopeAuthorityUuidProjectionV1Error({
      issue: { field, reason: "invalidType", value },
    });
  }
  if (!value.startsWith(prefix)) {
    throw new InvalidScopeAuthorityUuidProjectionV1Error({
      issue: { field, reason: "invalidPrefix", value },
    });
  }
  return {
    value,
    uuid: requireCanonicalUuidV1(value.slice(prefix.length), field, value),
  };
}

function requireCanonicalUuidV1(
  value: unknown,
  field: "scopeId" | "epoch",
  reportedValue: unknown = value,
): string {
  if (typeof value !== "string") {
    throw new InvalidScopeAuthorityUuidProjectionV1Error({
      issue: { field, reason: "invalidType", value: reportedValue },
    });
  }
  if (isCanonicalUuidTextV1(value)) return value;
  if (isCanonicalUuidTextV1(value.toLowerCase())) {
    throw new InvalidScopeAuthorityUuidProjectionV1Error({
      issue: { field, reason: "nonCanonical", value: reportedValue },
    });
  }
  throw new InvalidScopeAuthorityUuidProjectionV1Error({
    issue: { field, reason: "invalidUuid", value: reportedValue },
  });
}
