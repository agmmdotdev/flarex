import { Schema } from "effect";

import { isCanonicalUuidTextV1 } from "./canonical-uuid";
import {
  CanonicalNonNegativePostgresBigIntFromString,
  CanonicalPositivePostgresBigIntFromString,
  POSTGRES_SIGNED_BIGINT_MAX,
} from "./postgres-bigint";

const NonBlankPostgresText = Schema.String.check(
  Schema.makeFilter((value) => {
    if (value.trim().length === 0) return "Expected non-blank text";
    if (value.includes("\u0000")) {
      return "PostgreSQL text cannot contain a null byte";
    }
    return undefined;
  }),
);

const CanonicalUuidText = Schema.String.check(
  Schema.makeFilter((value) =>
    isCanonicalUuidTextV1(value)
      ? undefined
      : "Expected one canonical lowercase UUID",
  ),
);

const Sha256Bytes = Schema.Uint8Array.check(
  Schema.isMinLength(32),
  Schema.isMaxLength(32),
);

const CanonicalEvidenceBytes = Schema.Uint8Array.check(
  Schema.isMinLength(1),
);

const TEXT_ENCODER = new TextEncoder();

export const MAX_TRANSACTION_ATTEMPT_FENCE = POSTGRES_SIGNED_BIGINT_MAX;
export const MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH =
  POSTGRES_SIGNED_BIGINT_MAX;
/** Conservative bound for the composite PostgreSQL B-tree lookup key. */
export const MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1 = 1_024;

export const TransactionSessionIdV1Schema = CanonicalUuidText.pipe(
  Schema.brand("FlarexDB/TransactionSessionIdV1"),
);
export type TransactionSessionIdV1 =
  typeof TransactionSessionIdV1Schema.Type;
export const decodeTransactionSessionIdV1 = Schema.decodeUnknownSync(
  TransactionSessionIdV1Schema,
);

export const TransactionSessionLifecycleV1Schema = Schema.Literals([
  "created",
  "running",
  "finishing",
  "committing",
  "retrying",
  "committed",
  "aborted",
  "expired",
]);
export type TransactionSessionLifecycleV1 =
  typeof TransactionSessionLifecycleV1Schema.Type;
export const decodeTransactionSessionLifecycleV1 = Schema.decodeUnknownSync(
  TransactionSessionLifecycleV1Schema,
);

export const TransactionSessionProtocolVersionV1Schema = Schema.Literal(
  1,
).pipe(Schema.brand("FlarexDB/TransactionSessionProtocolVersionV1"));
export type TransactionSessionProtocolVersionV1 =
  typeof TransactionSessionProtocolVersionV1Schema.Type;
export const TRANSACTION_SESSION_PROTOCOL_VERSION_V1 =
  TransactionSessionProtocolVersionV1Schema.make(1);
export const decodeTransactionSessionProtocolVersionV1 =
  Schema.decodeUnknownSync(TransactionSessionProtocolVersionV1Schema);

export const TransactionAttemptFenceSchema =
  CanonicalPositivePostgresBigIntFromString.pipe(
    Schema.brand("FlarexDB/TransactionAttemptFence"),
  );
export type TransactionAttemptFence =
  typeof TransactionAttemptFenceSchema.Type;
export const decodeTransactionAttemptFence = Schema.decodeUnknownSync(
  TransactionAttemptFenceSchema,
);

export const TransactionAuthorizationRevocationEpochSchema =
  CanonicalNonNegativePostgresBigIntFromString.pipe(
    Schema.brand("FlarexDB/TransactionAuthorizationRevocationEpoch"),
  );
export type TransactionAuthorizationRevocationEpoch =
  typeof TransactionAuthorizationRevocationEpochSchema.Type;
export const decodeTransactionAuthorizationRevocationEpoch =
  Schema.decodeUnknownSync(TransactionAuthorizationRevocationEpochSchema);

/** S07 defines only the bounded point-mutation session authority. */
export const TransactionFunctionKindV1Schema = Schema.Literal("mutation");
export type TransactionFunctionKindV1 =
  typeof TransactionFunctionKindV1Schema.Type;
export const decodeTransactionFunctionKindV1 = Schema.decodeUnknownSync(
  TransactionFunctionKindV1Schema,
);

export const TransactionPackageIdV1Schema = NonBlankPostgresText.pipe(
  Schema.brand("FlarexDB/TransactionPackageIdV1"),
);
export type TransactionPackageIdV1 =
  typeof TransactionPackageIdV1Schema.Type;

export const TransactionArtifactRuntimeV1Schema = Schema.Literal(
  "dynamic-worker",
);
export type TransactionArtifactRuntimeV1 =
  typeof TransactionArtifactRuntimeV1Schema.Type;

export const TransactionArtifactIdV1Schema = Schema.String.check(
  Schema.isPattern(/^artifact_[0-9a-f]{32}$/),
).pipe(Schema.brand("FlarexDB/TransactionArtifactIdV1"));
export type TransactionArtifactIdV1 =
  typeof TransactionArtifactIdV1Schema.Type;

export const TransactionSourcePackageSha256HexV1Schema = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/),
).pipe(Schema.brand("FlarexDB/TransactionSourcePackageSha256HexV1"));
export type TransactionSourcePackageSha256HexV1 =
  typeof TransactionSourcePackageSha256HexV1Schema.Type;

export const TransactionExecutionModuleV1Schema =
  NonBlankPostgresText.pipe(
    Schema.brand("FlarexDB/TransactionExecutionModuleV1"),
  );
export type TransactionExecutionModuleV1 =
  typeof TransactionExecutionModuleV1Schema.Type;

export const TransactionFunctionPathV1Schema = NonBlankPostgresText.pipe(
  Schema.brand("FlarexDB/TransactionFunctionPathV1"),
);
export type TransactionFunctionPathV1 =
  typeof TransactionFunctionPathV1Schema.Type;

export const TransactionPolicyVersionV1Schema = NonBlankPostgresText.pipe(
  Schema.brand("FlarexDB/TransactionPolicyVersionV1"),
);
export type TransactionPolicyVersionV1 =
  typeof TransactionPolicyVersionV1Schema.Type;

export const TransactionAuthorizationGrantIdV1Schema =
  NonBlankPostgresText.pipe(
    Schema.brand("FlarexDB/TransactionAuthorizationGrantIdV1"),
  );
export type TransactionAuthorizationGrantIdV1 =
  typeof TransactionAuthorizationGrantIdV1Schema.Type;

/** Internal request identity; this is not S09's optional public idempotency key. */
export const TransactionRequestKeyV1Schema = NonBlankPostgresText.check(
  Schema.makeFilter((value) =>
    TEXT_ENCODER.encode(value).byteLength <=
    MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1
      ? undefined
      : `Expected an internal request key no greater than ${MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1} UTF-8 bytes`,
  ),
).pipe(Schema.brand("FlarexDB/TransactionRequestKeyV1"));
export type TransactionRequestKeyV1 =
  typeof TransactionRequestKeyV1Schema.Type;

export const CanonicalTransactionArgumentsBytesV1Schema =
  CanonicalEvidenceBytes.pipe(
    Schema.brand("FlarexDB/CanonicalTransactionArgumentsBytesV1"),
  );
export type CanonicalTransactionArgumentsBytesV1 =
  typeof CanonicalTransactionArgumentsBytesV1Schema.Type;

export const TransactionArgumentsSha256V1Schema = Sha256Bytes.pipe(
  Schema.brand("FlarexDB/TransactionArgumentsSha256V1"),
);
export type TransactionArgumentsSha256V1 =
  typeof TransactionArgumentsSha256V1Schema.Type;

export const CanonicalTransactionAuthorizationGrantBytesV1Schema =
  CanonicalEvidenceBytes.pipe(
    Schema.brand("FlarexDB/CanonicalTransactionAuthorizationGrantBytesV1"),
  );
export type CanonicalTransactionAuthorizationGrantBytesV1 =
  typeof CanonicalTransactionAuthorizationGrantBytesV1Schema.Type;

export const TransactionAuthorizationGrantSha256V1Schema = Sha256Bytes.pipe(
  Schema.brand("FlarexDB/TransactionAuthorizationGrantSha256V1"),
);
export type TransactionAuthorizationGrantSha256V1 =
  typeof TransactionAuthorizationGrantSha256V1Schema.Type;

/** Matching/cache identity only; authorization always resolves grant evidence. */
export const TransactionIdentityAccessPolicySha256V1Schema = Sha256Bytes.pipe(
  Schema.brand("FlarexDB/TransactionIdentityAccessPolicySha256V1"),
);
export type TransactionIdentityAccessPolicySha256V1 =
  typeof TransactionIdentityAccessPolicySha256V1Schema.Type;

export const TransactionRequestSha256V1Schema = Sha256Bytes.pipe(
  Schema.brand("FlarexDB/TransactionRequestSha256V1"),
);
export type TransactionRequestSha256V1 =
  typeof TransactionRequestSha256V1Schema.Type;
