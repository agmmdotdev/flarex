import {
  bytesEqual,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Effect, Encoding, Result, Schema } from "effect";

import type { Json, JsonObject } from "./json";
import { JsonValue } from "./json";
import { freezeOwnedProtocolProjection } from "./owned-protocol-projection";
import {
  UnpaddedBase64UrlTextSchema,
  canonicalBase64UrlEncodedLength,
  decodeCanonicalBase64Url,
  type CanonicalBase64UrlDecodeIssue,
} from "./canonical-base64url";
import { CatalogSchemaVersionIdSchema } from "./schema-manifest";
import { ReplacementScopeIdV1Schema } from "./storage-authority";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";
import {
  CanonicalTransactionAuthorizationGrantBytesV1Schema,
  TransactionArtifactIdV1Schema,
  TransactionArtifactRuntimeV1Schema,
  TransactionAuthorizationGrantIdV1Schema,
  TransactionAuthorizationGrantSha256V1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionArgumentsSha256V1Schema,
  TransactionExecutionModuleV1Schema,
  TransactionFunctionKindV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionPackageIdV1Schema,
  TransactionPolicyVersionV1Schema,
  TransactionRequestSha256V1Schema,
  TransactionRequestKeyV1Schema,
  TransactionSourcePackageSha256HexV1Schema,
  type CanonicalTransactionAuthorizationGrantBytesV1,
  type TransactionAuthorizationGrantIdV1,
  type TransactionAuthorizationGrantSha256V1,
  type TransactionAuthorizationRevocationEpoch,
  type TransactionArgumentsSha256V1,
  type TransactionIdentityAccessPolicySha256V1,
  type TransactionRequestSha256V1,
} from "./transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  FlarexValueEnvelopeV1Schema,
  FlarexValueCodecV1Error,
  FlarexValueCodecVersionSchema,
  canonicalizeFlarexValueJsonV1,
  canonicalizeFlarexValueV1,
  normalizeFlarexValueV1,
  type FlarexValueCodecVersion,
} from "./value";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const LOWERCASE_SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const CANONICAL_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TRANSACTION_GRANT_ID_PATTERN = /^grant_[A-Za-z0-9._:-]+$/;
const TRANSACTION_GRANT_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const TRANSACTION_GRANT_FORMAT_V1 = "flarex.transaction-grant";
export const TRANSACTION_GRANT_VERSION_V1 = 1;
export const TRANSACTION_GRANT_JWS_ALGORITHM_V1 = "Ed25519";
export const TRANSACTION_GRANT_JWS_TYPE_V1 =
  "flarex-transaction-grant+jws";
export const TRANSACTION_GRANT_KEY_PURPOSE_V1 = "transaction-grant-v1";
export const TRANSACTION_GRANT_IDENTITY_ACCESS_POLICY_FORMAT_V1 =
  "flarex.identity-access-policy";
export const TRANSACTION_GRANT_IDENTITY_ACCESS_POLICY_VERSION_V1 = 1;
export const TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1 =
  TransactionPolicyVersionV1Schema.make("policy_point_mutation_v1");
export const MAX_TRANSACTION_GRANT_CANONICAL_BYTES_V1 = 65_536;
export const MAX_TRANSACTION_GRANT_PAYLOAD_CANONICAL_BYTES_V1 = 48_000;
export const MAX_TRANSACTION_GRANT_PROTECTED_HEADER_BYTES_V1 = 512;
export const MAX_TRANSACTION_GRANT_KEY_ID_UTF8_BYTES_V1 = 128;
export const MAX_TRANSACTION_GRANT_TEXT_UTF8_BYTES_V1 = 1_024;
export const MAX_TRANSACTION_GRANT_CLAIM_FIELDS_V1 = 32;
export const MAX_TRANSACTION_GRANT_CLAIMS_JSON_UTF8_BYTES_V1 = 16_384;
export const TRANSACTION_GRANT_ED25519_SIGNATURE_BYTES_V1 = 64;
export const MIN_TRANSACTION_GRANT_EPOCH_MILLISECONDS_V1 =
  -62_167_219_200_000;
export const MAX_TRANSACTION_GRANT_EPOCH_MILLISECONDS_V1 =
  253_402_300_799_999;

export function isTransactionGrantEpochMillisecondsV1(
  value: number,
): boolean {
  return Number.isSafeInteger(value) &&
    value >= MIN_TRANSACTION_GRANT_EPOCH_MILLISECONDS_V1 &&
    value <= MAX_TRANSACTION_GRANT_EPOCH_MILLISECONDS_V1;
}

export function isPositiveTransactionGrantDurationMillisecondsV1(
  value: number,
): boolean {
  return isPositiveSafeInteger(value) &&
    value <= MAX_TRANSACTION_GRANT_EPOCH_MILLISECONDS_V1;
}

export function isNonNegativeTransactionGrantDurationMillisecondsV1(
  value: number,
): boolean {
  return isNonNegativeSafeInteger(value) &&
    value <= MAX_TRANSACTION_GRANT_EPOCH_MILLISECONDS_V1;
}

const MAX_TRANSACTION_GRANT_PROTECTED_HEADER_BASE64URL_CHARACTERS_V1 =
  canonicalBase64UrlEncodedLength(
    MAX_TRANSACTION_GRANT_PROTECTED_HEADER_BYTES_V1,
  );
const MAX_TRANSACTION_GRANT_PAYLOAD_BASE64URL_CHARACTERS_V1 =
  canonicalBase64UrlEncodedLength(
    MAX_TRANSACTION_GRANT_PAYLOAD_CANONICAL_BYTES_V1,
  );
const TRANSACTION_GRANT_ED25519_SIGNATURE_BASE64URL_CHARACTERS_V1 =
  canonicalBase64UrlEncodedLength(
    TRANSACTION_GRANT_ED25519_SIGNATURE_BYTES_V1,
  );

const BoundedGrantText = Schema.String.check(
  Schema.makeFilter((value) => validateBoundedGrantText(value)),
);

const BoundedTransactionPackageIdV1Schema =
  TransactionPackageIdV1Schema.check(
    Schema.makeFilter((value) => validateBoundedGrantText(value)),
  );
const BoundedTransactionExecutionModuleV1Schema =
  TransactionExecutionModuleV1Schema.check(
    Schema.makeFilter((value) => validateBoundedGrantText(value)),
  );
const BoundedTransactionFunctionPathV1Schema =
  TransactionFunctionPathV1Schema.check(
    Schema.makeFilter((value) => validateBoundedGrantText(value)),
  );
const BoundedTransactionPolicyVersionV1Schema =
  TransactionPolicyVersionV1Schema.check(
    Schema.makeFilter((value) => validateBoundedGrantText(value)),
  );
const BoundedCatalogSchemaVersionIdSchema =
  CatalogSchemaVersionIdSchema.check(
    Schema.makeFilter((value) => validateBoundedGrantText(value)),
  );
const BoundedTransactionAuthorizationGrantIdV1Schema =
  TransactionAuthorizationGrantIdV1Schema.check(
    Schema.makeFilter((value) => {
      if (!TRANSACTION_GRANT_ID_PATTERN.test(value)) {
        return "Expected grant_<ASCII identifier>";
      }
      return validateBoundedGrantText(value);
    }),
  );

export const TransactionGrantDeploymentIdV1Schema = BoundedGrantText.pipe(
  Schema.brand("FlarexDB/TransactionGrantDeploymentIdV1"),
);
export type TransactionGrantDeploymentIdV1 =
  typeof TransactionGrantDeploymentIdV1Schema.Type;

export const TransactionGrantKeyIdV1Schema = Schema.String.check(
  Schema.makeFilter((value) => {
    if (!TRANSACTION_GRANT_KEY_ID_PATTERN.test(value)) {
      return "Expected an ASCII transaction-grant key identifier";
    }
    return TEXT_ENCODER.encode(value).byteLength <=
      MAX_TRANSACTION_GRANT_KEY_ID_UTF8_BYTES_V1
      ? undefined
      : `Expected a key ID no greater than ${
        MAX_TRANSACTION_GRANT_KEY_ID_UTF8_BYTES_V1
      } UTF-8 bytes`;
  }),
).pipe(Schema.brand("FlarexDB/TransactionGrantKeyIdV1"));
export type TransactionGrantKeyIdV1 =
  typeof TransactionGrantKeyIdV1Schema.Type;

export const TransactionGrantTimestampV1Schema = Schema.String.check(
  Schema.makeFilter((value) =>
    isCanonicalTransactionGrantTimestampV1(value)
      ? undefined
      : "Expected an exact YYYY-MM-DDTHH:mm:ss.sssZ UTC timestamp",
  ),
).pipe(Schema.brand("FlarexDB/TransactionGrantTimestampV1"));
export type TransactionGrantTimestampV1 =
  typeof TransactionGrantTimestampV1Schema.Type;

const TransactionGrantSha256HexV1Schema = Schema.String.check(
  Schema.isPattern(LOWERCASE_SHA256_HEX_PATTERN),
);

export const TransactionGrantIdentityAccessPolicySha256HexV1Schema =
  TransactionGrantSha256HexV1Schema.pipe(
    Schema.brand(
      "FlarexDB/TransactionGrantIdentityAccessPolicySha256HexV1",
    ),
  );
export type TransactionGrantIdentityAccessPolicySha256HexV1 =
  typeof TransactionGrantIdentityAccessPolicySha256HexV1Schema.Type;

export const TransactionGrantValidatedArgsSha256HexV1Schema =
  TransactionGrantSha256HexV1Schema.pipe(
    Schema.brand("FlarexDB/TransactionGrantValidatedArgsSha256HexV1"),
  );
export type TransactionGrantValidatedArgsSha256HexV1 =
  typeof TransactionGrantValidatedArgsSha256HexV1Schema.Type;

export const TransactionGrantRequestSha256HexV1Schema =
  TransactionGrantSha256HexV1Schema.pipe(
    Schema.brand("FlarexDB/TransactionGrantRequestSha256HexV1"),
  );
export type TransactionGrantRequestSha256HexV1 =
  typeof TransactionGrantRequestSha256HexV1Schema.Type;

export function transactionGrantIdentityAccessPolicySha256HexV1FromBytes(
  value: TransactionIdentityAccessPolicySha256V1,
): TransactionGrantIdentityAccessPolicySha256HexV1 {
  return TransactionGrantIdentityAccessPolicySha256HexV1Schema.make(
    encodeBytesToLowercaseHex(value),
  );
}

export function transactionGrantValidatedArgsSha256HexV1FromBytes(
  value: TransactionArgumentsSha256V1,
): TransactionGrantValidatedArgsSha256HexV1 {
  return TransactionGrantValidatedArgsSha256HexV1Schema.make(
    encodeBytesToLowercaseHex(value),
  );
}

export function transactionGrantRequestSha256HexV1FromBytes(
  value: TransactionRequestSha256V1,
): TransactionGrantRequestSha256HexV1 {
  return TransactionGrantRequestSha256HexV1Schema.make(
    encodeBytesToLowercaseHex(value),
  );
}

export function transactionGrantIdentityAccessPolicySha256BytesV1FromHex(
  value: TransactionGrantIdentityAccessPolicySha256HexV1,
): TransactionIdentityAccessPolicySha256V1 {
  return TransactionIdentityAccessPolicySha256V1Schema.make(
    decodeLowercaseHex(value),
  );
}

export function transactionGrantValidatedArgsSha256BytesV1FromHex(
  value: TransactionGrantValidatedArgsSha256HexV1,
): TransactionArgumentsSha256V1 {
  return TransactionArgumentsSha256V1Schema.make(
    decodeLowercaseHex(value),
  );
}

export function transactionGrantRequestSha256BytesV1FromHex(
  value: TransactionGrantRequestSha256HexV1,
): TransactionRequestSha256V1 {
  return TransactionRequestSha256V1Schema.make(decodeLowercaseHex(value));
}

const TransactionGrantClaimNameV1Schema = Schema.String.check(
  Schema.makeFilter((value) => {
    if (!isNonBlankString(value) || value.includes("\u0000")) {
      return "Expected a nonblank claim name without null bytes";
    }
    return TEXT_ENCODER.encode(value).byteLength <= 128
      ? undefined
      : "Expected a claim name no greater than 128 UTF-8 bytes";
  }),
);

export const TransactionGrantClaimsV1Schema = Schema.Record(
  TransactionGrantClaimNameV1Schema,
  JsonValue,
).check(
  Schema.makeFilter((claims) => {
    const claimNames = Object.keys(claims);
    if (claimNames.length > MAX_TRANSACTION_GRANT_CLAIM_FIELDS_V1) {
      return `Expected no more than ${MAX_TRANSACTION_GRANT_CLAIM_FIELDS_V1} claims`;
    }
    try {
      normalizeFlarexValueV1(claims);
      const bytes = TEXT_ENCODER.encode(JSON.stringify(claims)).byteLength;
      return bytes <= MAX_TRANSACTION_GRANT_CLAIMS_JSON_UTF8_BYTES_V1
        ? undefined
        : `Expected claims no greater than ${
          MAX_TRANSACTION_GRANT_CLAIMS_JSON_UTF8_BYTES_V1
        } JSON UTF-8 bytes`;
    } catch {
      return "Expected claims encodable by Flarex Value Codec V1";
    }
  }),
);
export type TransactionGrantClaimsV1 =
  typeof TransactionGrantClaimsV1Schema.Type;

const TransactionGrantAnonymousAuthV1Schema = Schema.Struct({
  kind: Schema.Literal("anonymous"),
}).annotate(StrictStructOptions);

const TransactionGrantTrustedDevAuthV1Schema = Schema.Struct({
  kind: Schema.Literal("trustedDev"),
  principal: BoundedGrantText,
}).annotate(StrictStructOptions);

const TransactionGrantVerifiedBearerAuthV1Schema = Schema.Struct({
  kind: Schema.Literal("verifiedBearer"),
  issuer: BoundedGrantText,
  subject: BoundedGrantText,
  claims: TransactionGrantClaimsV1Schema,
}).annotate(StrictStructOptions);

export const TransactionGrantInertAuthV1Schema = Schema.Union([
  TransactionGrantAnonymousAuthV1Schema,
  TransactionGrantTrustedDevAuthV1Schema,
  TransactionGrantVerifiedBearerAuthV1Schema,
]);
export type TransactionGrantInertAuthV1 =
  typeof TransactionGrantInertAuthV1Schema.Type;

export const TRANSACTION_GRANT_CAPABILITIES_V1 = Object.freeze([
  "db:get",
  "db:insert",
  "db:patch",
  "db:replace",
  "db:delete",
] as const);

export const TransactionGrantCapabilityV1Schema = Schema.Literals(
  TRANSACTION_GRANT_CAPABILITIES_V1,
);
export type TransactionGrantCapabilityV1 =
  typeof TransactionGrantCapabilityV1Schema.Type;

export const TransactionGrantCapabilitiesV1Schema = Schema.Array(
  TransactionGrantCapabilityV1Schema,
).check(
  Schema.isMaxLength(TRANSACTION_GRANT_CAPABILITIES_V1.length),
  Schema.makeFilter((capabilities) => {
    let priorIndex = -1;
    for (const capability of capabilities) {
      const currentIndex = TRANSACTION_GRANT_CAPABILITIES_V1.indexOf(capability);
      if (currentIndex <= priorIndex) {
        return "Expected unique capabilities in canonical V1 order";
      }
      priorIndex = currentIndex;
    }
    return undefined;
  }),
);
export type TransactionGrantCapabilitiesV1 =
  typeof TransactionGrantCapabilitiesV1Schema.Type;

export const TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1 = Object.freeze(
  TransactionGrantCapabilitiesV1Schema.make([
    "db:get",
    "db:insert",
    "db:patch",
    "db:replace",
    "db:delete",
  ]),
);

const TransactionGrantIdentityAccessPolicyV1Schema = Schema.Struct({
  format: Schema.Literal(
    TRANSACTION_GRANT_IDENTITY_ACCESS_POLICY_FORMAT_V1,
  ),
  version: Schema.Literal(
    TRANSACTION_GRANT_IDENTITY_ACCESS_POLICY_VERSION_V1,
  ),
  policyVersion: BoundedTransactionPolicyVersionV1Schema,
  auth: TransactionGrantInertAuthV1Schema,
  capabilities: TransactionGrantCapabilitiesV1Schema,
}).annotate(StrictStructOptions);

export type TransactionGrantIdentityAccessPolicyV1 =
  typeof TransactionGrantIdentityAccessPolicyV1Schema.Type;

export interface TransactionGrantIdentityAccessPolicyInputV1 {
  readonly policyVersion: TransactionGrantIdentityAccessPolicyV1["policyVersion"];
  readonly auth: TransactionGrantInertAuthV1;
  readonly capabilities: TransactionGrantCapabilitiesV1;
}

export interface CanonicalTransactionGrantIdentityAccessPolicyV1 {
  readonly policy: TransactionGrantIdentityAccessPolicyV1;
  readonly canonicalBytes: Uint8Array;
  readonly sha256Hex: TransactionGrantIdentityAccessPolicySha256HexV1;
}

export class TransactionGrantIdentityAccessPolicyV1Error extends Data.TaggedError(
  "TransactionGrantIdentityAccessPolicyV1Error",
)<{
  readonly issue: "invalidSchema" | "canonicalizationFailed";
}> {}

/**
 * Domain-separated matching evidence only. The digest never creates execution
 * authority; the issuer and verifier each derive it from independently trusted
 * inputs and the signed payload respectively.
 */
export async function canonicalizeTransactionGrantIdentityAccessPolicyV1(
  input: TransactionGrantIdentityAccessPolicyInputV1,
): Promise<CanonicalTransactionGrantIdentityAccessPolicyV1> {
  let policy: TransactionGrantIdentityAccessPolicyV1;
  try {
    policy = Schema.decodeUnknownSync(
      TransactionGrantIdentityAccessPolicyV1Schema,
      StrictParseOptions,
    )({
      format: TRANSACTION_GRANT_IDENTITY_ACCESS_POLICY_FORMAT_V1,
      version: TRANSACTION_GRANT_IDENTITY_ACCESS_POLICY_VERSION_V1,
      policyVersion: input.policyVersion,
      auth: input.auth,
      capabilities: input.capabilities,
    });
  } catch (cause) {
    if (!Schema.isSchemaError(cause)) throw cause;
    throw new TransactionGrantIdentityAccessPolicyV1Error({
      issue: "invalidSchema",
    });
  }

  let canonical: Awaited<ReturnType<typeof canonicalizeFlarexValueV1>>;
  try {
    canonical = await canonicalizeFlarexValueV1(policy);
  } catch (cause) {
    if (
      !(cause instanceof FlarexValueCodecV1Error) &&
      !(typeof DOMException !== "undefined" && cause instanceof DOMException)
    ) {
      throw cause;
    }
    throw new TransactionGrantIdentityAccessPolicyV1Error({
      issue: "canonicalizationFailed",
    });
  }

  const stableCanonicalBytes = new Uint8Array(canonical.canonicalBytes);
  const immutablePolicy = freezeOwnedProtocolProjection(policy);
  return Object.freeze({
    policy: immutablePolicy,
    get canonicalBytes(): Uint8Array {
      return new Uint8Array(stableCanonicalBytes);
    },
    sha256Hex: TransactionGrantIdentityAccessPolicySha256HexV1Schema.make(
      encodeBytesToLowercaseHex(canonical.sha256),
    ),
  } satisfies CanonicalTransactionGrantIdentityAccessPolicyV1);
}

export const canonicalizeTransactionGrantIdentityAccessPolicyV1Effect =
  Effect.fn(
    "TransactionGrant.canonicalizeIdentityAccessPolicyV1",
  )(function* (
    input: TransactionGrantIdentityAccessPolicyInputV1,
  ): Effect.fn.Return<
    CanonicalTransactionGrantIdentityAccessPolicyV1,
    TransactionGrantIdentityAccessPolicyV1Error
  > {
    return yield* Effect.tryPromise({
      try: () => canonicalizeTransactionGrantIdentityAccessPolicyV1(input),
      catch: (cause): unknown => cause,
    }).pipe(
      Effect.catch((cause: unknown) =>
        cause instanceof TransactionGrantIdentityAccessPolicyV1Error
          ? Effect.fail(cause)
          : Effect.die(cause)
      ),
    );
  });

const TransactionGrantPayloadStructureV1Schema = Schema.Struct({
  format: Schema.Literal(TRANSACTION_GRANT_FORMAT_V1),
  version: Schema.Literal(TRANSACTION_GRANT_VERSION_V1),
  grantId: BoundedTransactionAuthorizationGrantIdV1Schema,
  deploymentId: TransactionGrantDeploymentIdV1Schema,
  scopeId: ReplacementScopeIdV1Schema,
  packageId: BoundedTransactionPackageIdV1Schema,
  artifactRuntime: TransactionArtifactRuntimeV1Schema,
  artifactId: TransactionArtifactIdV1Schema,
  sourcePackageHash: TransactionSourcePackageSha256HexV1Schema,
  executionModule: BoundedTransactionExecutionModuleV1Schema,
  functionPath: BoundedTransactionFunctionPathV1Schema,
  functionKind: TransactionFunctionKindV1Schema,
  schemaVersionId: BoundedCatalogSchemaVersionIdSchema,
  policyVersion: BoundedTransactionPolicyVersionV1Schema,
  identityAccessPolicySha256:
    TransactionGrantIdentityAccessPolicySha256HexV1Schema,
  validatedArgsValueCodecVersion: FlarexValueCodecVersionSchema,
  validatedArgsSha256: TransactionGrantValidatedArgsSha256HexV1Schema,
  requestKey: TransactionRequestKeyV1Schema,
  requestSha256: TransactionGrantRequestSha256HexV1Schema,
  capabilities: TransactionGrantCapabilitiesV1Schema,
  auth: TransactionGrantInertAuthV1Schema,
  issuedAt: TransactionGrantTimestampV1Schema,
  expiresAt: TransactionGrantTimestampV1Schema,
  authorizationRevocationEpoch: TransactionAuthorizationRevocationEpochSchema,
}).annotate(StrictStructOptions).check(
  Schema.makeFilter((payload) => {
    const expectedArtifactId = `artifact_${payload.sourcePackageHash.slice(0, 32)}`;
    if (payload.artifactId !== expectedArtifactId) {
      return "Expected artifact ID to match the source-package hash";
    }
    return Date.parse(payload.expiresAt) > Date.parse(payload.issuedAt)
      ? undefined
      : "Expected grant expiry after issue time";
  }),
);

export const TransactionGrantPayloadV1Schema =
  TransactionGrantPayloadStructureV1Schema.check(
    Schema.makeFilter((payload) => {
      try {
        const encoded = Schema.encodeSync(
          TransactionGrantPayloadStructureV1Schema,
        )(payload);
        normalizeFlarexValueV1(encoded);
        return undefined;
      } catch {
        return "Expected a payload encodable by Flarex Value Codec V1";
      }
    }),
  ).pipe(Schema.brand("FlarexDB/TransactionGrantPayloadV1"));
export type TransactionGrantPayloadV1 =
  typeof TransactionGrantPayloadV1Schema.Type;
export type TransactionGrantPayloadEncodedV1 =
  typeof TransactionGrantPayloadV1Schema.Encoded;

export const TransactionGrantProtectedHeaderV1Schema = Schema.Struct({
  alg: Schema.Literal(TRANSACTION_GRANT_JWS_ALGORITHM_V1),
  kid: TransactionGrantKeyIdV1Schema,
  typ: Schema.Literal(TRANSACTION_GRANT_JWS_TYPE_V1),
}).annotate(StrictStructOptions).pipe(
  Schema.brand("FlarexDB/TransactionGrantProtectedHeaderV1"),
);
export type TransactionGrantProtectedHeaderV1 =
  typeof TransactionGrantProtectedHeaderV1Schema.Type;

export const UnverifiedTransactionGrantProtectedHeaderBase64UrlV1Schema =
  UnpaddedBase64UrlTextSchema.check(
    Schema.isMaxLength(
      MAX_TRANSACTION_GRANT_PROTECTED_HEADER_BASE64URL_CHARACTERS_V1,
    ),
  ).pipe(
    Schema.brand(
      "FlarexDB/UnverifiedTransactionGrantProtectedHeaderBase64UrlV1",
    ),
  );
export type UnverifiedTransactionGrantProtectedHeaderBase64UrlV1 =
  typeof UnverifiedTransactionGrantProtectedHeaderBase64UrlV1Schema.Type;

export const UnverifiedTransactionGrantPayloadBase64UrlV1Schema =
  UnpaddedBase64UrlTextSchema.check(
    Schema.isMaxLength(
      MAX_TRANSACTION_GRANT_PAYLOAD_BASE64URL_CHARACTERS_V1,
    ),
  ).pipe(
    Schema.brand(
      "FlarexDB/UnverifiedTransactionGrantPayloadBase64UrlV1",
    ),
  );
export type UnverifiedTransactionGrantPayloadBase64UrlV1 =
  typeof UnverifiedTransactionGrantPayloadBase64UrlV1Schema.Type;

export const UnverifiedTransactionGrantEd25519SignatureBase64UrlV1Schema =
  UnpaddedBase64UrlTextSchema.check(
    Schema.isMinLength(
      TRANSACTION_GRANT_ED25519_SIGNATURE_BASE64URL_CHARACTERS_V1,
    ),
    Schema.isMaxLength(
      TRANSACTION_GRANT_ED25519_SIGNATURE_BASE64URL_CHARACTERS_V1,
    ),
  ).pipe(
    Schema.brand(
      "FlarexDB/UnverifiedTransactionGrantEd25519SignatureBase64UrlV1",
    ),
  );
export type UnverifiedTransactionGrantEd25519SignatureBase64UrlV1 =
  typeof UnverifiedTransactionGrantEd25519SignatureBase64UrlV1Schema.Type;

const TransactionGrantProtectedHeaderBase64UrlV1Schema =
  UnverifiedTransactionGrantProtectedHeaderBase64UrlV1Schema.pipe(
    Schema.brand("FlarexDB/TransactionGrantProtectedHeaderBase64UrlV1"),
  );
export type TransactionGrantProtectedHeaderBase64UrlV1 =
  typeof TransactionGrantProtectedHeaderBase64UrlV1Schema.Type;

const CanonicalTransactionGrantPayloadBase64UrlV1Schema =
  UnverifiedTransactionGrantPayloadBase64UrlV1Schema.pipe(
    Schema.brand("FlarexDB/CanonicalTransactionGrantPayloadBase64UrlV1"),
  );
export type CanonicalTransactionGrantPayloadBase64UrlV1 =
  typeof CanonicalTransactionGrantPayloadBase64UrlV1Schema.Type;

const TransactionGrantEd25519SignatureBase64UrlV1Schema =
  UnverifiedTransactionGrantEd25519SignatureBase64UrlV1Schema.pipe(
    Schema.brand("FlarexDB/TransactionGrantEd25519SignatureBase64UrlV1"),
  );
export type TransactionGrantEd25519SignatureBase64UrlV1 =
  typeof TransactionGrantEd25519SignatureBase64UrlV1Schema.Type;

export const CanonicalTransactionGrantPayloadBytesV1Schema =
  Schema.Uint8Array.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_TRANSACTION_GRANT_PAYLOAD_CANONICAL_BYTES_V1),
  ).pipe(Schema.brand("FlarexDB/CanonicalTransactionGrantPayloadBytesV1"));
export type CanonicalTransactionGrantPayloadBytesV1 =
  typeof CanonicalTransactionGrantPayloadBytesV1Schema.Type;

export const TransactionGrantSigningInputBytesV1Schema =
  Schema.Uint8Array.check(Schema.isMinLength(3)).pipe(
    Schema.brand("FlarexDB/TransactionGrantSigningInputBytesV1"),
  );
export type TransactionGrantSigningInputBytesV1 =
  typeof TransactionGrantSigningInputBytesV1Schema.Type;

export const TransactionGrantEd25519SignatureBytesV1Schema =
  Schema.Uint8Array.check(
    Schema.isMinLength(TRANSACTION_GRANT_ED25519_SIGNATURE_BYTES_V1),
    Schema.isMaxLength(TRANSACTION_GRANT_ED25519_SIGNATURE_BYTES_V1),
  ).pipe(Schema.brand("FlarexDB/TransactionGrantEd25519SignatureBytesV1"));
export type TransactionGrantEd25519SignatureBytesV1 =
  typeof TransactionGrantEd25519SignatureBytesV1Schema.Type;

export const TransactionGrantJwsWireV1Schema = Schema.Struct({
  protected: UnverifiedTransactionGrantProtectedHeaderBase64UrlV1Schema,
  payload: UnverifiedTransactionGrantPayloadBase64UrlV1Schema,
  signature: UnverifiedTransactionGrantEd25519SignatureBase64UrlV1Schema,
}).annotate(StrictStructOptions).pipe(
  Schema.brand("FlarexDB/TransactionGrantJwsWireV1"),
);
export type TransactionGrantJwsWireV1 =
  typeof TransactionGrantJwsWireV1Schema.Type;

const TransactionGrantJwsV1Schema = Schema.Struct({
  protected: TransactionGrantProtectedHeaderBase64UrlV1Schema,
  payload: CanonicalTransactionGrantPayloadBase64UrlV1Schema,
  signature: TransactionGrantEd25519SignatureBase64UrlV1Schema,
}).annotate(StrictStructOptions).pipe(
  Schema.brand("FlarexDB/TransactionGrantJwsV1"),
);
export type TransactionGrantJwsV1 = typeof TransactionGrantJwsV1Schema.Type;

export type TransactionGrantProtocolV1Field =
  | "jws"
  | "protected"
  | "payload"
  | "signature";

export type TransactionGrantProtocolV1Issue =
  | {
      readonly reason: "invalidSchema";
      readonly field: TransactionGrantProtocolV1Field;
    }
  | {
      readonly reason: "invalidBase64Url";
      readonly field: Exclude<TransactionGrantProtocolV1Field, "jws">;
      readonly detail: string;
    }
  | {
      readonly reason: "invalidUtf8" | "invalidJson" | "nonCanonical";
      readonly field: "protected" | "payload";
    }
  | {
      readonly reason: "evidenceTooLarge";
      readonly field: TransactionGrantProtocolV1Field;
      readonly observedBytes: number;
      readonly maximumBytes: number;
    };

export class TransactionGrantProtocolV1Error extends Data.TaggedError(
  "TransactionGrantProtocolV1Error",
)<{
  readonly issue: TransactionGrantProtocolV1Issue;
}> {}

export interface CanonicalTransactionGrantProtectedHeaderV1 {
  readonly header: TransactionGrantProtectedHeaderV1;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
  readonly base64url: TransactionGrantProtectedHeaderBase64UrlV1;
}

export interface CanonicalTransactionGrantPayloadV1 {
  readonly payload: TransactionGrantPayloadV1;
  readonly payloadJson: Json;
  readonly canonicalBytes: CanonicalTransactionGrantPayloadBytesV1;
  readonly base64url: CanonicalTransactionGrantPayloadBase64UrlV1;
}

export interface TransactionGrantCanonicalSigningSegmentsV1 {
  readonly protected: TransactionGrantProtectedHeaderBase64UrlV1;
  readonly payload: CanonicalTransactionGrantPayloadBase64UrlV1;
}

/**
 * Canonical persisted evidence only. Signature verification is deliberately
 * absent from O03-A1, so this object never authorizes execution.
 */
export interface InertTransactionGrantEvidenceV1 {
  readonly jws: TransactionGrantJwsV1;
  readonly protectedHeader: TransactionGrantProtectedHeaderV1;
  readonly payload: TransactionGrantPayloadV1;
  readonly signatureBytes: TransactionGrantEd25519SignatureBytesV1;
  readonly signingInput: TransactionGrantSigningInputBytesV1;
  readonly authorizationGrantId: TransactionAuthorizationGrantIdV1;
  readonly authorizationGrantJson: JsonObject;
  readonly authorizationGrantValueCodecVersion: FlarexValueCodecVersion;
  readonly authorizationGrantCanonicalBytes:
    CanonicalTransactionAuthorizationGrantBytesV1;
  readonly authorizationGrantSha256: TransactionAuthorizationGrantSha256V1;
  readonly authorizationGrantExpiresAt: TransactionGrantTimestampV1;
  readonly authorizationRevocationEpoch:
    TransactionAuthorizationRevocationEpoch;
}

export function canonicalizeTransactionGrantProtectedHeaderV1(
  input: unknown,
): CanonicalTransactionGrantProtectedHeaderV1 {
  const header = decodeSchemaOrProtocolError(
    TransactionGrantProtectedHeaderV1Schema,
    input,
    "protected",
  );
  const canonicalText =
    `{"alg":"${TRANSACTION_GRANT_JWS_ALGORITHM_V1}",` +
    `"kid":${JSON.stringify(header.kid)},` +
    `"typ":"${TRANSACTION_GRANT_JWS_TYPE_V1}"}`;
  const canonicalBytes = TEXT_ENCODER.encode(canonicalText);
  if (
    canonicalBytes.byteLength >
    MAX_TRANSACTION_GRANT_PROTECTED_HEADER_BYTES_V1
  ) {
    throw new TransactionGrantProtocolV1Error({
      issue: {
        reason: "evidenceTooLarge",
        field: "protected",
        observedBytes: canonicalBytes.byteLength,
        maximumBytes: MAX_TRANSACTION_GRANT_PROTECTED_HEADER_BYTES_V1,
      },
    });
  }
  const immutableHeader = freezeOwnedProtocolProjection(header);
  const stableCanonicalBytes = new Uint8Array(canonicalBytes);
  const base64url = TransactionGrantProtectedHeaderBase64UrlV1Schema.make(
    Encoding.encodeBase64Url(stableCanonicalBytes),
  );
  return Object.freeze({
    header: immutableHeader,
    canonicalText,
    get canonicalBytes(): Uint8Array {
      return new Uint8Array(stableCanonicalBytes);
    },
    base64url,
  } satisfies CanonicalTransactionGrantProtectedHeaderV1);
}

export async function canonicalizeTransactionGrantPayloadV1(
  input: unknown,
): Promise<CanonicalTransactionGrantPayloadV1> {
  const payload = decodeSchemaOrProtocolError(
    TransactionGrantPayloadV1Schema,
    input,
    "payload",
  );
  let encoded: TransactionGrantPayloadEncodedV1;
  try {
    encoded = Schema.encodeSync(TransactionGrantPayloadV1Schema)(payload);
  } catch {
    throw invalidSchema("payload");
  }
  let canonical;
  try {
    canonical = await canonicalizeFlarexValueV1(encoded);
  } catch (cause) {
    throw valueCodecFailureOrDefect(cause, "payload");
  }
  assertEvidenceSize(
    "payload",
    canonical.canonicalBytes.byteLength,
    MAX_TRANSACTION_GRANT_PAYLOAD_CANONICAL_BYTES_V1,
  );
  const detachedPayload = decodeSchemaOrProtocolError(
    TransactionGrantPayloadV1Schema,
    canonical.value,
    "payload",
  );
  const stableCanonicalBytes = CanonicalTransactionGrantPayloadBytesV1Schema.make(
    new Uint8Array(canonical.canonicalBytes),
  );
  const immutablePayload = freezeOwnedProtocolProjection(
    detachedPayload,
  );
  const immutablePayloadJson = freezeOwnedProtocolProjection(
    canonical.valueJson,
  );
  const base64url = CanonicalTransactionGrantPayloadBase64UrlV1Schema.make(
    Encoding.encodeBase64Url(stableCanonicalBytes),
  );
  return Object.freeze({
    payload: immutablePayload,
    payloadJson: immutablePayloadJson,
    get canonicalBytes(): CanonicalTransactionGrantPayloadBytesV1 {
      return CanonicalTransactionGrantPayloadBytesV1Schema.make(
        new Uint8Array(stableCanonicalBytes),
      );
    },
    base64url,
  } satisfies CanonicalTransactionGrantPayloadV1);
}

export function createTransactionGrantSigningInputV1(
  input: TransactionGrantCanonicalSigningSegmentsV1,
): TransactionGrantSigningInputBytesV1 {
  return TransactionGrantSigningInputBytesV1Schema.make(
    TEXT_ENCODER.encode(`${input.protected}.${input.payload}`),
  );
}

export function encodeTransactionGrantEd25519SignatureV1(
  input: unknown,
): TransactionGrantEd25519SignatureBase64UrlV1 {
  const bytes = decodeSchemaOrProtocolError(
    TransactionGrantEd25519SignatureBytesV1Schema,
    input,
    "signature",
  );
  return TransactionGrantEd25519SignatureBase64UrlV1Schema.make(
    Encoding.encodeBase64Url(bytes),
  );
}

export async function deriveInertTransactionGrantEvidenceV1(
  input: unknown,
): Promise<InertTransactionGrantEvidenceV1> {
  const wireJws = decodeSchemaOrProtocolError(
    TransactionGrantJwsWireV1Schema,
    input,
    "jws",
  );
  const canonicalHeader = decodeCanonicalProtectedHeader(wireJws.protected);
  const canonicalPayload = await decodeCanonicalPayload(wireJws.payload);
  const stableSignatureBytes = TransactionGrantEd25519SignatureBytesV1Schema.make(
    decodeBase64Url(
      wireJws.signature,
      "signature",
      TRANSACTION_GRANT_ED25519_SIGNATURE_BYTES_V1,
    ),
  );
  const signature = TransactionGrantEd25519SignatureBase64UrlV1Schema.make(
    wireJws.signature,
  );
  const jws = freezeOwnedProtocolProjection(
    TransactionGrantJwsV1Schema.make({
      protected: canonicalHeader.base64url,
      payload: canonicalPayload.base64url,
      signature,
    }),
  );
  const stableSigningInput = createTransactionGrantSigningInputV1({
    protected: canonicalHeader.base64url,
    payload: canonicalPayload.base64url,
  });
  const authorizationGrantJson = freezeOwnedProtocolProjection({
    protected: jws.protected,
    payload: jws.payload,
    signature: jws.signature,
  } satisfies JsonObject);
  let canonicalEnvelope;
  try {
    canonicalEnvelope = await canonicalizeFlarexValueV1(
      authorizationGrantJson,
    );
  } catch (cause) {
    throw valueCodecFailureOrDefect(cause, "jws");
  }
  assertEvidenceSize(
    "jws",
    canonicalEnvelope.canonicalBytes.byteLength,
    MAX_TRANSACTION_GRANT_CANONICAL_BYTES_V1,
  );

  const stableAuthorizationGrantCanonicalBytes =
    CanonicalTransactionAuthorizationGrantBytesV1Schema.make(
      new Uint8Array(canonicalEnvelope.canonicalBytes),
    );
  const stableAuthorizationGrantSha256 =
    TransactionAuthorizationGrantSha256V1Schema.make(
      new Uint8Array(canonicalEnvelope.sha256),
    );

  return Object.freeze({
    jws,
    protectedHeader: canonicalHeader.header,
    payload: canonicalPayload.payload,
    get signatureBytes(): TransactionGrantEd25519SignatureBytesV1 {
      return TransactionGrantEd25519SignatureBytesV1Schema.make(
        new Uint8Array(stableSignatureBytes),
      );
    },
    get signingInput(): TransactionGrantSigningInputBytesV1 {
      return TransactionGrantSigningInputBytesV1Schema.make(
        new Uint8Array(stableSigningInput),
      );
    },
    authorizationGrantId: canonicalPayload.payload.grantId,
    authorizationGrantJson,
    authorizationGrantValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    get authorizationGrantCanonicalBytes():
      CanonicalTransactionAuthorizationGrantBytesV1 {
      return CanonicalTransactionAuthorizationGrantBytesV1Schema.make(
        new Uint8Array(stableAuthorizationGrantCanonicalBytes),
      );
    },
    get authorizationGrantSha256(): TransactionAuthorizationGrantSha256V1 {
      return TransactionAuthorizationGrantSha256V1Schema.make(
        new Uint8Array(stableAuthorizationGrantSha256),
      );
    },
    authorizationGrantExpiresAt: canonicalPayload.payload.expiresAt,
    authorizationRevocationEpoch:
      canonicalPayload.payload.authorizationRevocationEpoch,
  } satisfies InertTransactionGrantEvidenceV1);
}

export const deriveInertTransactionGrantEvidenceV1Effect = Effect.fn(
  "TransactionGrant.deriveInertEvidenceV1",
)((
  input: unknown,
): Effect.Effect<
  InertTransactionGrantEvidenceV1,
  TransactionGrantProtocolV1Error
> =>
  Effect.tryPromise({
    try: () => deriveInertTransactionGrantEvidenceV1(input),
    catch: (cause): unknown => cause,
  }).pipe(
    Effect.catch((cause: unknown) =>
      cause instanceof TransactionGrantProtocolV1Error
        ? Effect.fail(cause)
        : Effect.die(cause)
    ),
  ));

function decodeCanonicalProtectedHeader(
  value: UnverifiedTransactionGrantProtectedHeaderBase64UrlV1,
): CanonicalTransactionGrantProtectedHeaderV1 {
  const bytes = decodeBase64Url(
    value,
    "protected",
    MAX_TRANSACTION_GRANT_PROTECTED_HEADER_BYTES_V1,
  );
  const parsed = parseJson(bytes, "protected");
  const canonical = canonicalizeTransactionGrantProtectedHeaderV1(parsed);
  if (canonical.base64url !== value) {
    throw new TransactionGrantProtocolV1Error({
      issue: { reason: "nonCanonical", field: "protected" },
    });
  }
  return canonical;
}

async function decodeCanonicalPayload(
  value: UnverifiedTransactionGrantPayloadBase64UrlV1,
): Promise<CanonicalTransactionGrantPayloadV1> {
  const bytes = decodeBase64Url(
    value,
    "payload",
    MAX_TRANSACTION_GRANT_PAYLOAD_CANONICAL_BYTES_V1,
  );
  const parsed = parseJson(bytes, "payload");
  const envelope = {
    ...decodeSchemaOrProtocolError(
      FlarexValueEnvelopeV1Schema,
      parsed,
      "payload",
    ),
  };
  let canonical;
  try {
    canonical = await canonicalizeFlarexValueJsonV1(envelope.value);
  } catch (cause) {
    throw valueCodecFailureOrDefect(cause, "payload");
  }
  if (!bytesEqual(canonical.canonicalBytes, bytes)) {
    throw new TransactionGrantProtocolV1Error({
      issue: { reason: "nonCanonical", field: "payload" },
    });
  }
  const payload = decodeSchemaOrProtocolError(
    TransactionGrantPayloadV1Schema,
    canonical.value,
    "payload",
  );
  const immutablePayload = freezeOwnedProtocolProjection(payload);
  const immutablePayloadJson = freezeOwnedProtocolProjection(
    canonical.valueJson,
  );
  const stableCanonicalBytes = CanonicalTransactionGrantPayloadBytesV1Schema.make(
    new Uint8Array(canonical.canonicalBytes),
  );
  const base64url = CanonicalTransactionGrantPayloadBase64UrlV1Schema.make(
    value,
  );
  return Object.freeze({
    payload: immutablePayload,
    payloadJson: immutablePayloadJson,
    get canonicalBytes(): CanonicalTransactionGrantPayloadBytesV1 {
      return CanonicalTransactionGrantPayloadBytesV1Schema.make(
        new Uint8Array(stableCanonicalBytes),
      );
    },
    base64url,
  } satisfies CanonicalTransactionGrantPayloadV1);
}

function parseJson(
  bytes: Uint8Array,
  field: "protected" | "payload",
): unknown {
  let text: string;
  try {
    text = TEXT_DECODER.decode(bytes);
  } catch {
    throw new TransactionGrantProtocolV1Error({
      issue: { reason: "invalidUtf8", field },
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TransactionGrantProtocolV1Error({
      issue: { reason: "invalidJson", field },
    });
  }
}

function decodeBase64Url(
  value: string,
  field: "protected" | "payload" | "signature",
  maximumBytes: number,
): Uint8Array {
  return Result.getOrThrow(
    decodeCanonicalBase64Url(value, maximumBytes).pipe(
      Result.mapError((issue) =>
        transactionGrantBase64UrlDecodeError(field, issue)
      ),
    ),
  );
}

function transactionGrantBase64UrlDecodeError(
  field: "protected" | "payload" | "signature",
  issue: CanonicalBase64UrlDecodeIssue,
): TransactionGrantProtocolV1Error {
  if (issue.reason === "tooLarge") {
    return new TransactionGrantProtocolV1Error({
      issue: {
        reason: "evidenceTooLarge",
        field,
        observedBytes: issue.observedBytes,
        maximumBytes: issue.maximumBytes,
      },
    });
  }
  const detail = {
    invalidSyntax: "Expected canonical unpadded Base64url",
    decodingFailed: "Base64url decoding failed",
    nonCanonical: "Expected one canonical Base64url spelling",
  }[issue.reason];
  return invalidBase64Url(field, detail);
}

function validateBoundedGrantText(value: string): string | undefined {
  if (!isNonBlankString(value)) return "Expected nonblank grant text";
  if (value.includes("\u0000")) return "Grant text cannot contain a null byte";
  return TEXT_ENCODER.encode(value).byteLength <=
    MAX_TRANSACTION_GRANT_TEXT_UTF8_BYTES_V1
    ? undefined
    : `Expected grant text no greater than ${MAX_TRANSACTION_GRANT_TEXT_UTF8_BYTES_V1} UTF-8 bytes`;
}

function isCanonicalTransactionGrantTimestampV1(value: string): boolean {
  if (!CANONICAL_TIMESTAMP_PATTERN.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  try {
    return new Date(milliseconds).toISOString() === value;
  } catch {
    return false;
  }
}

function decodeSchemaOrProtocolError<
  S extends Schema.ConstraintDecoder<unknown>,
>(
  schema: S,
  input: unknown,
  field: TransactionGrantProtocolV1Field,
): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema, StrictParseOptions)(input);
  } catch {
    throw invalidSchema(field);
  }
}

function invalidSchema(
  field: TransactionGrantProtocolV1Field,
): TransactionGrantProtocolV1Error {
  return new TransactionGrantProtocolV1Error({
    issue: {
      reason: "invalidSchema",
      field,
    },
  });
}

function valueCodecFailureOrDefect(
  cause: unknown,
  field: TransactionGrantProtocolV1Field,
): TransactionGrantProtocolV1Error {
  if (cause instanceof FlarexValueCodecV1Error) return invalidSchema(field);
  throw cause;
}

function invalidBase64Url(
  field: "protected" | "payload" | "signature",
  detail: string,
): TransactionGrantProtocolV1Error {
  return new TransactionGrantProtocolV1Error({
    issue: { reason: "invalidBase64Url", field, detail },
  });
}

function assertEvidenceSize(
  field: "jws" | "payload",
  observedBytes: number,
  maximumBytes: number,
): void {
  if (observedBytes <= maximumBytes) return;
  throw new TransactionGrantProtocolV1Error({
    issue: {
      reason: "evidenceTooLarge",
      field,
      observedBytes,
      maximumBytes,
    },
  });
}

function decodeLowercaseHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(
      value.slice(index * 2, index * 2 + 2),
      16,
    );
  }
  return bytes;
}
