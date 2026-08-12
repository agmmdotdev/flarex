import {
  bytesEqual,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Data, Effect, Encoding, Result, Schema } from "effect";

import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
  type CanonicalApplicationMutationExecutionAuthorityV1,
} from "./application-mutation-authority-v1";
import {
  UnpaddedBase64UrlTextSchema,
  canonicalBase64UrlEncodedLength,
  decodeCanonicalBase64Url,
} from "./canonical-base64url";
import { type Json, type JsonObject } from "./json";
import { freezeOwnedProtocolProjection } from "./owned-protocol-projection";
import { CatalogSchemaVersionIdSchema } from "./schema-manifest";
import { ReplacementScopeIdV1Schema } from "./storage-authority";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";
import {
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantCapabilitiesV1Schema,
  TransactionGrantInertAuthV1Schema,
  TransactionGrantKeyIdV1Schema,
  TransactionGrantTimestampV1Schema,
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  canonicalizeTransactionGrantIdentityAccessPolicyV1Effect,
  type CanonicalTransactionGrantIdentityAccessPolicyV1,
} from "./transaction-grant";
import {
  CanonicalTransactionAuthorizationGrantBytesV1Schema,
  TransactionAuthorizationGrantIdV1Schema,
  TransactionAuthorizationGrantSha256V1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionPolicyVersionV1Schema,
  TransactionRequestKeyV1Schema,
  type CanonicalTransactionAuthorizationGrantBytesV1,
  type TransactionAuthorizationGrantIdV1,
  type TransactionAuthorizationGrantSha256V1,
  type TransactionAuthorizationRevocationEpoch,
} from "./transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  FlarexValueEnvelopeV1Schema,
  FlarexValueCodecVersionSchema,
  canonicalizeFlarexValueJsonV1Effect,
  canonicalizeFlarexValueV1Effect,
  type FlarexValueCodecVersion,
} from "./value";

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_PROTECTED_BYTES = 512;
const MAX_PAYLOAD_BYTES = 65_536;
const MAX_GRANT_BYTES = 131_072;
const SIGNATURE_BYTES = 64;

export const APPLICATION_MUTATION_GRANT_FORMAT_V1 =
  "flarex.application-mutation-grant";
export const APPLICATION_MUTATION_GRANT_VERSION_V1 = 1;
export const APPLICATION_MUTATION_GRANT_JWS_TYPE_V1 =
  "flarex-application-mutation-grant+jws";
export const APPLICATION_MUTATION_GRANT_JWS_ALGORITHM_V1 = "Ed25519";
export const APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1 =
  "application-mutation-grant-v1";

const LowercaseSha256 = Schema.String.check(
  Schema.makeFilter(value => SHA256_HEX.test(value)
    ? undefined
    : "Expected 64 lowercase hexadecimal characters"),
);
const BoundedText = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1_024),
);
export const ApplicationMutationGrantProtectedHeaderV1Schema = Schema.Struct({
  alg: Schema.Literal(APPLICATION_MUTATION_GRANT_JWS_ALGORITHM_V1),
  kid: TransactionGrantKeyIdV1Schema,
  typ: Schema.Literal(APPLICATION_MUTATION_GRANT_JWS_TYPE_V1),
}).annotate(StrictStructOptions);
export type ApplicationMutationGrantProtectedHeaderV1 =
  typeof ApplicationMutationGrantProtectedHeaderV1Schema.Type;

export const ApplicationMutationGrantPayloadV1Schema = Schema.Struct({
  format: Schema.Literal(APPLICATION_MUTATION_GRANT_FORMAT_V1),
  version: Schema.Literal(APPLICATION_MUTATION_GRANT_VERSION_V1),
  grantId: TransactionAuthorizationGrantIdV1Schema,
  deploymentId: TransactionGrantDeploymentIdV1Schema,
  scopeId: ReplacementScopeIdV1Schema,
  executionAuthoritySha256: LowercaseSha256,
  activationSequence: Schema.String.check(
    Schema.isPattern(/^[1-9][0-9]*$/),
  ),
  activeHeadSha256: LowercaseSha256,
  schemaVersionId: CatalogSchemaVersionIdSchema,
  functionPath: BoundedText,
  functionKind: Schema.Literal("mutation"),
  policyVersion: TransactionPolicyVersionV1Schema,
  identityAccessPolicySha256: LowercaseSha256,
  validatedArgsValueCodecVersion: FlarexValueCodecVersionSchema,
  validatedArgsSha256: LowercaseSha256,
  requestKey: TransactionRequestKeyV1Schema,
  requestSha256: LowercaseSha256,
  capabilities: TransactionGrantCapabilitiesV1Schema,
  auth: TransactionGrantInertAuthV1Schema,
  issuedAt: TransactionGrantTimestampV1Schema,
  expiresAt: TransactionGrantTimestampV1Schema,
  authorizationRevocationEpoch:
    TransactionAuthorizationRevocationEpochSchema,
}).annotate(StrictStructOptions).check(
  Schema.makeFilter(payload =>
    Date.parse(payload.expiresAt) > Date.parse(payload.issuedAt)
      ? undefined
      : "Expected grant expiry after issue time"
  ),
);
export type ApplicationMutationGrantPayloadV1 =
  typeof ApplicationMutationGrantPayloadV1Schema.Type;

const ProtectedSegment = UnpaddedBase64UrlTextSchema.check(
  Schema.isMaxLength(canonicalBase64UrlEncodedLength(MAX_PROTECTED_BYTES)),
);
const PayloadSegment = UnpaddedBase64UrlTextSchema.check(
  Schema.isMaxLength(canonicalBase64UrlEncodedLength(MAX_PAYLOAD_BYTES)),
);
const SignatureSegment = UnpaddedBase64UrlTextSchema.check(
  Schema.isMinLength(canonicalBase64UrlEncodedLength(SIGNATURE_BYTES)),
  Schema.isMaxLength(canonicalBase64UrlEncodedLength(SIGNATURE_BYTES)),
);

export const ApplicationMutationGrantJwsWireV1Schema = Schema.Struct({
  protected: ProtectedSegment,
  payload: PayloadSegment,
  signature: SignatureSegment,
}).annotate(StrictStructOptions);
export type ApplicationMutationGrantJwsWireV1 =
  typeof ApplicationMutationGrantJwsWireV1Schema.Type;

export interface CanonicalApplicationMutationGrantSegmentsV1 {
  readonly protectedHeader: ApplicationMutationGrantProtectedHeaderV1;
  readonly protectedBase64Url: string;
  readonly payload: ApplicationMutationGrantPayloadV1;
  readonly payloadJson: Json;
  readonly payloadBase64Url: string;
  readonly signingInput: Uint8Array;
}

export interface PrepareApplicationMutationGrantV1Input {
  readonly kid: ApplicationMutationGrantProtectedHeaderV1["kid"];
  readonly grantId: TransactionAuthorizationGrantIdV1;
  readonly deploymentId: ApplicationMutationGrantPayloadV1["deploymentId"];
  readonly executionAuthority:
    CanonicalApplicationMutationExecutionAuthorityV1;
  readonly policyVersion: ApplicationMutationGrantPayloadV1["policyVersion"];
  readonly identityAccessPolicy:
    CanonicalTransactionGrantIdentityAccessPolicyV1;
  readonly validatedArgsValueCodecVersion: FlarexValueCodecVersion;
  readonly validatedArgsSha256: string;
  readonly requestKey: ApplicationMutationGrantPayloadV1["requestKey"];
  readonly requestSha256: string;
  readonly issuedAt: ApplicationMutationGrantPayloadV1["issuedAt"];
  readonly expiresAt: ApplicationMutationGrantPayloadV1["expiresAt"];
  readonly authorizationRevocationEpoch:
    TransactionAuthorizationRevocationEpoch;
}

export interface InertApplicationMutationGrantEvidenceV1 {
  readonly jws: ApplicationMutationGrantJwsWireV1;
  readonly protectedHeader: ApplicationMutationGrantProtectedHeaderV1;
  readonly payload: ApplicationMutationGrantPayloadV1;
  readonly signatureBytes: Uint8Array;
  readonly signingInput: Uint8Array;
  readonly authorizationGrantId: TransactionAuthorizationGrantIdV1;
  readonly authorizationGrantJson: JsonObject;
  readonly authorizationGrantValueCodecVersion: FlarexValueCodecVersion;
  readonly authorizationGrantCanonicalBytes:
    CanonicalTransactionAuthorizationGrantBytesV1;
  readonly authorizationGrantSha256: TransactionAuthorizationGrantSha256V1;
  readonly authorizationGrantExpiresAt:
    ApplicationMutationGrantPayloadV1["expiresAt"];
  readonly authorizationRevocationEpoch:
    TransactionAuthorizationRevocationEpoch;
}

const verifiedApplicationMutationGrantBrand: unique symbol = Symbol(
  "FlarexProtocol/VerifiedApplicationMutationGrantV1",
);

export interface VerifiedApplicationMutationGrantV1 {
  readonly [verifiedApplicationMutationGrantBrand]: true;
}

const applicationMutationGrantVerifierNamespaceBrand: unique symbol = Symbol(
  "FlarexProtocol/ApplicationMutationGrantVerifierNamespaceV1",
);

export interface ApplicationMutationGrantVerifierNamespaceV1 {
  readonly [applicationMutationGrantVerifierNamespaceBrand]: true;
}

interface ApplicationMutationGrantVerifierNamespaceStateV1 {
  readonly deploymentId: ApplicationMutationGrantPayloadV1["deploymentId"];
  readonly keysById: ReadonlyMap<
    string,
    StoredApplicationMutationGrantVerificationKeyV1
  >;
}

interface ApplicationMutationGrantVerificationKeyBaseV1 {
  readonly kid: ApplicationMutationGrantProtectedHeaderV1["kid"];
  readonly purpose: string;
}

export type ApplicationMutationGrantVerificationKeyV1 =
  | (ApplicationMutationGrantVerificationKeyBaseV1 & {
      readonly state: "active" | "verifyOnly";
      readonly publicKey: CryptoKey;
    })
  | (ApplicationMutationGrantVerificationKeyBaseV1 & {
      readonly state: "disabled";
    });

interface StoredApplicationMutationGrantVerificationKeyBaseV1 {
  readonly kid: ApplicationMutationGrantProtectedHeaderV1["kid"];
  readonly purpose: typeof APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1;
}

type StoredApplicationMutationGrantVerificationKeyV1 =
  | (StoredApplicationMutationGrantVerificationKeyBaseV1 & {
      readonly state: "active" | "verifyOnly";
      readonly publicKey: CryptoKey;
    })
  | (StoredApplicationMutationGrantVerificationKeyBaseV1 & {
      readonly state: "disabled";
    });

export interface CreateApplicationMutationGrantVerifierNamespaceV1Input {
  readonly deploymentId: ApplicationMutationGrantPayloadV1["deploymentId"];
  readonly keys: ReadonlyArray<ApplicationMutationGrantVerificationKeyV1>;
}

export type ApplicationMutationGrantVerifierConfigurationV1Issue =
  | "duplicateKeyId"
  | "wrongKeyPurpose"
  | "invalidPublicKey";

export class ApplicationMutationGrantVerifierConfigurationV1Error
  extends Error {
  readonly name = "ApplicationMutationGrantVerifierConfigurationV1Error";

  constructor(
    readonly issue: ApplicationMutationGrantVerifierConfigurationV1Issue,
  ) {
    super(`Invalid application-mutation grant verifier: ${issue}.`);
  }
}

const verifierNamespaceStateByHandle = new WeakMap<
  ApplicationMutationGrantVerifierNamespaceV1,
  ApplicationMutationGrantVerifierNamespaceStateV1
>();

export function createApplicationMutationGrantVerifierNamespaceV1(
  input: CreateApplicationMutationGrantVerifierNamespaceV1Input,
): ApplicationMutationGrantVerifierNamespaceV1 {
  const keysById = new Map<
    string,
    StoredApplicationMutationGrantVerificationKeyV1
  >();
  for (const key of input.keys) {
    if (keysById.has(key.kid)) {
      throw new ApplicationMutationGrantVerifierConfigurationV1Error(
        "duplicateKeyId",
      );
    }
    if (key.purpose !== APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1) {
      throw new ApplicationMutationGrantVerifierConfigurationV1Error(
        "wrongKeyPurpose",
      );
    }
    if (key.state === "disabled") {
      keysById.set(key.kid, Object.freeze({
        kid: key.kid,
        purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
        state: "disabled" as const,
      }));
      continue;
    }
    if (!isEd25519VerificationKey(key.publicKey)) {
      throw new ApplicationMutationGrantVerifierConfigurationV1Error(
        "invalidPublicKey",
      );
    }
    keysById.set(key.kid, Object.freeze({
      kid: key.kid,
      purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
      state: key.state,
      publicKey: key.publicKey,
    }));
  }
  const handle = Object.freeze({
    [applicationMutationGrantVerifierNamespaceBrand]: true as const,
  });
  verifierNamespaceStateByHandle.set(handle, Object.freeze({
    deploymentId: input.deploymentId,
    keysById,
  }));
  return handle;
}

function isEd25519VerificationKey(key: CryptoKey): boolean {
  try {
    return key.type === "public" &&
      key.algorithm.name === APPLICATION_MUTATION_GRANT_JWS_ALGORITHM_V1 &&
      key.usages.includes("verify");
  } catch {
    return false;
  }
}

const verifiedGrantEvidenceByHandle = new WeakMap<
  VerifiedApplicationMutationGrantV1,
  InertApplicationMutationGrantEvidenceV1
>();

export class InvalidVerifiedApplicationMutationGrantV1Error extends Error {
  readonly name = "InvalidVerifiedApplicationMutationGrantV1Error";
}

export function inspectVerifiedApplicationMutationGrantV1(
  value: unknown,
): InertApplicationMutationGrantEvidenceV1 {
  if (typeof value !== "object" || value === null) {
    throw new InvalidVerifiedApplicationMutationGrantV1Error();
  }
  const evidence = verifiedGrantEvidenceByHandle.get(
    value as VerifiedApplicationMutationGrantV1,
  );
  if (evidence === undefined) {
    throw new InvalidVerifiedApplicationMutationGrantV1Error();
  }
  return evidence;
}

export class ApplicationMutationGrantV1Error extends Data.TaggedError(
  "ApplicationMutationGrantV1Error",
)<{
  readonly operation: "prepare" | "assemble" | "decode";
  readonly reason:
    | "invalidInput"
    | "invalidTimeRange"
    | "evidenceTooLarge"
    | "invalidBase64Url"
    | "invalidUtf8"
    | "invalidJson"
    | "nonCanonical"
    | "invalidSignature"
    | "signatureVerificationFailed";
  readonly field?: "jws" | "protected" | "payload" | "signature";
  readonly cause?: unknown;
}> {}

export const prepareApplicationMutationGrantV1 = Effect.fn(
  "ApplicationMutationGrant.prepareV1",
)(function* (input: PrepareApplicationMutationGrantV1Input) {
  const executionAuthority = yield*
    canonicalizeApplicationMutationExecutionAuthorityV1(
      input.executionAuthority.authority,
    ).pipe(Effect.mapError(cause => invalid("prepare", cause)));
  const policy = yield* canonicalizeTransactionGrantIdentityAccessPolicyV1Effect(
    input.identityAccessPolicy.policy,
  ).pipe(Effect.mapError(cause => invalid("prepare", cause)));
  if (
    Date.parse(input.expiresAt) <= Date.parse(input.issuedAt) ||
    input.policyVersion !== policy.policy.policyVersion ||
    input.policyVersion !==
      TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1 ||
    policy.policy.capabilities.length !==
      TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1.length ||
    policy.policy.capabilities.some((capability, index) =>
      capability !== TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1[index]
    ) ||
    !SHA256_HEX.test(input.validatedArgsSha256) ||
    !SHA256_HEX.test(input.requestSha256)
  ) return yield* Effect.fail(new ApplicationMutationGrantV1Error({
    operation: "prepare",
    reason: Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)
      ? "invalidTimeRange"
      : "invalidInput",
  }));

  const protectedHeader = yield* decodeEffect(
    ApplicationMutationGrantProtectedHeaderV1Schema,
    {
      alg: APPLICATION_MUTATION_GRANT_JWS_ALGORITHM_V1,
      kid: input.kid,
      typ: APPLICATION_MUTATION_GRANT_JWS_TYPE_V1,
    },
    "prepare",
  );
  const authority = executionAuthority.authority;
  const payload = yield* decodeEffect(Schema.toType(
    ApplicationMutationGrantPayloadV1Schema,
  ), {
    format: APPLICATION_MUTATION_GRANT_FORMAT_V1,
    version: APPLICATION_MUTATION_GRANT_VERSION_V1,
    grantId: input.grantId,
    deploymentId: input.deploymentId,
    scopeId: authority.runtimeTarget.scopeId,
    executionAuthoritySha256:
      encodeBytesToLowercaseHex(executionAuthority.sha256),
    activationSequence: authority.activationSequence,
    activeHeadSha256: authority.activeHeadSha256,
    schemaVersionId: authority.schemaVersionId,
    functionPath: authority.runtimeTarget.function.path,
    functionKind: "mutation",
    policyVersion: input.policyVersion,
    identityAccessPolicySha256: policy.sha256Hex,
    validatedArgsValueCodecVersion: input.validatedArgsValueCodecVersion,
    validatedArgsSha256: input.validatedArgsSha256,
    requestKey: input.requestKey,
    requestSha256: input.requestSha256,
    capabilities: policy.policy.capabilities,
    auth: policy.policy.auth,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    authorizationRevocationEpoch: input.authorizationRevocationEpoch,
  }, "prepare");
  const canonicalHeader = yield* Effect.fromResult(
    canonicalizeProtectedHeaderResult(protectedHeader, "prepare"),
  );
  const encodedPayload = yield* encodeEffect(
    ApplicationMutationGrantPayloadV1Schema,
    payload,
    "prepare",
    "payload",
  );
  const canonicalPayload = yield* canonicalizeValue(
    encodedPayload,
    "prepare",
    "payload",
    MAX_PAYLOAD_BYTES,
  );
  const protectedBase64Url = Encoding.encodeBase64Url(
    canonicalHeader,
  );
  const payloadBase64Url = Encoding.encodeBase64Url(
    canonicalPayload.canonicalBytes,
  );
  const signingInput = UTF8.encode(
    `${protectedBase64Url}.${payloadBase64Url}`,
  );
  const stableSigningInput = copyBytes(signingInput);
  return Object.freeze({
    protectedHeader: freezeOwnedProtocolProjection(protectedHeader),
    protectedBase64Url,
    payload: freezeOwnedProtocolProjection(payload),
    payloadJson: freezeOwnedProtocolProjection(canonicalPayload.valueJson),
    payloadBase64Url,
    get signingInput(): Uint8Array {
      return copyBytes(stableSigningInput);
    },
  } satisfies CanonicalApplicationMutationGrantSegmentsV1);
});

export function assembleApplicationMutationGrantJwsV1(
  segments: CanonicalApplicationMutationGrantSegmentsV1,
  signatureBytes: Uint8Array,
): ApplicationMutationGrantJwsWireV1 {
  if (signatureBytes.byteLength !== SIGNATURE_BYTES) {
    throw new ApplicationMutationGrantV1Error({
      operation: "assemble",
      reason: "invalidSignature",
      field: "signature",
    });
  }
  return freezeOwnedProtocolProjection(
    ApplicationMutationGrantJwsWireV1Schema.make({
      protected: segments.protectedBase64Url,
      payload: segments.payloadBase64Url,
      signature: Encoding.encodeBase64Url(signatureBytes),
    }),
  );
}

export const deriveInertApplicationMutationGrantEvidenceV1 = Effect.fn(
  "ApplicationMutationGrant.deriveInertEvidenceV1",
)(function* (input: unknown) {
  const wire = yield* decodeEffect(
    ApplicationMutationGrantJwsWireV1Schema,
    input,
    "decode",
    "jws",
  );
  const header = yield* decodeCanonicalProtectedHeader(
    wire.protected,
  );
  const payload = yield* decodeCanonicalSegment(
    wire.payload,
    ApplicationMutationGrantPayloadV1Schema,
    "payload",
    MAX_PAYLOAD_BYTES,
  );
  const policy = yield* canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({
    policyVersion: payload.policyVersion,
    auth: payload.auth,
    capabilities: payload.capabilities,
  }).pipe(Effect.mapError(cause => invalid("decode", cause, "payload")));
  if (
    payload.policyVersion !==
      TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1 ||
    payload.identityAccessPolicySha256 !== policy.sha256Hex ||
    payload.capabilities.length !==
      TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1.length ||
    payload.capabilities.some((capability: string, index: number) =>
      capability !== TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1[index]
    )
  ) return yield* Effect.fail(invalid("decode", undefined, "payload"));
  const signatureBytes = yield* decodeSegment(
    wire.signature,
    "signature",
    SIGNATURE_BYTES,
  );
  const authorizationGrantJson = freezeOwnedProtocolProjection({
    protected: wire.protected,
    payload: wire.payload,
    signature: wire.signature,
  } satisfies JsonObject);
  const envelope = yield* canonicalizeValue(
    authorizationGrantJson,
    "decode",
    "jws",
    MAX_GRANT_BYTES,
  );
  const signingInput = UTF8.encode(`${wire.protected}.${wire.payload}`);
  const stableSignature = copyBytes(signatureBytes);
  const stableSigningInput = copyBytes(signingInput);
  const stableGrantBytes = CanonicalTransactionAuthorizationGrantBytesV1Schema
    .make(copyBytes(envelope.canonicalBytes));
  const stableGrantSha = TransactionAuthorizationGrantSha256V1Schema.make(
    copyBytes(envelope.sha256),
  );
  return Object.freeze({
    jws: freezeOwnedProtocolProjection(wire),
    protectedHeader: header,
    payload,
    get signatureBytes(): Uint8Array {
      return copyBytes(stableSignature);
    },
    get signingInput(): Uint8Array {
      return copyBytes(stableSigningInput);
    },
    authorizationGrantId: payload.grantId,
    authorizationGrantJson,
    authorizationGrantValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    get authorizationGrantCanonicalBytes():
      CanonicalTransactionAuthorizationGrantBytesV1 {
      return CanonicalTransactionAuthorizationGrantBytesV1Schema.make(
        copyBytes(stableGrantBytes),
      );
    },
    get authorizationGrantSha256(): TransactionAuthorizationGrantSha256V1 {
      return TransactionAuthorizationGrantSha256V1Schema.make(
        copyBytes(stableGrantSha),
      );
    },
    authorizationGrantExpiresAt: payload.expiresAt,
    authorizationRevocationEpoch: payload.authorizationRevocationEpoch,
  } satisfies InertApplicationMutationGrantEvidenceV1);
});

export const verifyApplicationMutationGrantV1 = Effect.fn(
  "ApplicationMutationGrant.verifyV1",
)(function* (
  input: unknown,
  namespace: ApplicationMutationGrantVerifierNamespaceV1,
) {
  const evidence = yield* deriveInertApplicationMutationGrantEvidenceV1(input);
  const verifier = verifierNamespaceStateByHandle.get(namespace);
  if (
    verifier === undefined ||
    verifier.deploymentId !== evidence.payload.deploymentId
  ) return yield* Effect.fail(new ApplicationMutationGrantV1Error({
    operation: "decode",
    reason: "signatureVerificationFailed",
    field: "signature",
  }));
  const key = verifier.keysById.get(evidence.protectedHeader.kid);
  if (key === undefined || key.state === "disabled") {
    return yield* Effect.fail(new ApplicationMutationGrantV1Error({
      operation: "decode",
      reason: "invalidSignature",
      field: "signature",
    }));
  }
  const signatureValid = yield* Effect.tryPromise({
    try: () => globalThis.crypto.subtle.verify(
      APPLICATION_MUTATION_GRANT_JWS_ALGORITHM_V1,
      key.publicKey,
      copyBytesToArrayBuffer(evidence.signatureBytes),
      copyBytesToArrayBuffer(evidence.signingInput),
    ),
    catch: (cause) => new ApplicationMutationGrantV1Error({
      operation: "decode",
      reason: "signatureVerificationFailed",
      field: "signature",
      cause,
    }),
  });
  if (!signatureValid) {
    return yield* Effect.fail(new ApplicationMutationGrantV1Error({
      operation: "decode",
      reason: "invalidSignature",
      field: "signature",
    }));
  }
  const handle = Object.freeze({
    [verifiedApplicationMutationGrantBrand]: true as const,
  });
  verifiedGrantEvidenceByHandle.set(handle, evidence);
  return handle;
});

function decodeEffect<A>(
  schema: Schema.ConstraintDecoder<A, never>,
  input: unknown,
  operation: ApplicationMutationGrantV1Error["operation"],
  field?: ApplicationMutationGrantV1Error["field"],
): Effect.Effect<A, ApplicationMutationGrantV1Error> {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(schema, StrictParseOptions)(input),
    catch: (cause): unknown => cause,
  }).pipe(Effect.catch((cause: unknown) =>
    Schema.isSchemaError(cause)
      ? Effect.fail(invalid(operation, cause, field))
      : Effect.die(cause)
  ));
}

function encodeEffect<A, I>(
  schema: Schema.Codec<A, I, never, never>,
  input: A,
  operation: ApplicationMutationGrantV1Error["operation"],
  field?: ApplicationMutationGrantV1Error["field"],
): Effect.Effect<I, ApplicationMutationGrantV1Error> {
  return Effect.try({
    try: () => Schema.encodeSync(schema)(input),
    catch: (cause): unknown => cause,
  }).pipe(Effect.catch((cause: unknown) =>
    Schema.isSchemaError(cause)
      ? Effect.fail(invalid(operation, cause, field))
      : Effect.die(cause)
  ));
}

function canonicalizeProtectedHeaderResult(
  header: ApplicationMutationGrantProtectedHeaderV1,
  operation: ApplicationMutationGrantV1Error["operation"],
): Result.Result<Uint8Array, ApplicationMutationGrantV1Error> {
  return Result.gen(function* () {
    const bytes = yield* Result.try({
      try: () => UTF8.encode(
        `{"alg":"${APPLICATION_MUTATION_GRANT_JWS_ALGORITHM_V1}",` +
          `"kid":${JSON.stringify(header.kid)},` +
          `"typ":"${APPLICATION_MUTATION_GRANT_JWS_TYPE_V1}"}`,
      ),
      catch: cause => invalid(operation, cause, "protected"),
    });
    return yield* bytes.byteLength > MAX_PROTECTED_BYTES
      ? Result.fail(new ApplicationMutationGrantV1Error({
          operation,
          reason: "evidenceTooLarge",
          field: "protected",
        }))
      : Result.succeed(bytes);
  });
}

const decodeCanonicalProtectedHeader = Effect.fn(
  "ApplicationMutationGrant.decodeProtectedHeaderV1",
)(function* (segment: string) {
  const bytes = yield* decodeSegment(
    segment,
    "protected",
    MAX_PROTECTED_BYTES,
  );
  const parsed = yield* parseJsonBytes(bytes, "protected");
  const header = yield* decodeEffect(
    ApplicationMutationGrantProtectedHeaderV1Schema,
    parsed,
    "decode",
    "protected",
  );
  const canonical = yield* Effect.fromResult(
    canonicalizeProtectedHeaderResult(header, "decode"),
  );
  if (!bytesEqual(bytes, canonical)) {
    return yield* Effect.fail(new ApplicationMutationGrantV1Error({
      operation: "decode",
      reason: "nonCanonical",
      field: "protected",
    }));
  }
  return freezeOwnedProtocolProjection(header);
});

function parseJsonBytes(
  bytes: Uint8Array,
  field: "protected" | "payload",
): Effect.Effect<unknown, ApplicationMutationGrantV1Error> {
  return Effect.gen(function* () {
    const text = yield* Effect.try({
      try: () => UTF8_FATAL.decode(bytes),
      catch: cause => new ApplicationMutationGrantV1Error({
        operation: "decode",
        reason: "invalidUtf8",
        field,
        cause,
      }),
    });
    return yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: cause => new ApplicationMutationGrantV1Error({
        operation: "decode",
        reason: "invalidJson",
        field,
        cause,
      }),
    });
  });
}

function canonicalizeValue(
  input: unknown,
  operation: ApplicationMutationGrantV1Error["operation"],
  field: ApplicationMutationGrantV1Error["field"],
  maximumBytes: number,
) {
  return canonicalizeFlarexValueV1Effect(input).pipe(
    Effect.mapError(cause => invalid(operation, cause, field)),
    Effect.flatMap(canonical =>
      canonical.canonicalBytes.byteLength > maximumBytes
        ? Effect.fail(new ApplicationMutationGrantV1Error({
            operation,
            reason: "evidenceTooLarge",
            ...(field === undefined ? {} : { field }),
          }))
        : Effect.succeed(canonical)
    ),
  );
}

function decodeCanonicalSegment<A>(
  segment: string,
  schema: Schema.ConstraintDecoder<A, never>,
  field: "protected" | "payload",
  maximumBytes: number,
) {
  return Effect.gen(function* () {
    const bytes = yield* decodeSegment(segment, field, maximumBytes);
    const parsed = yield* parseJsonBytes(bytes, field);
    let decodedEnvelope;
    try {
      decodedEnvelope = Schema.decodeUnknownSync(
        FlarexValueEnvelopeV1Schema,
        StrictParseOptions,
      )(parsed);
    } catch (cause) {
      if (!Schema.isSchemaError(cause)) return yield* Effect.die(cause);
      return yield* Effect.fail(invalid("decode", cause, field));
    }
    const canonical = yield* canonicalizeFlarexValueJsonV1Effect(
      decodedEnvelope.value,
    ).pipe(Effect.mapError(cause => invalid("decode", cause, field)));
    if (!bytesEqual(bytes, canonical.canonicalBytes)) {
      return yield* Effect.fail(new ApplicationMutationGrantV1Error({
        operation: "decode",
        reason: "nonCanonical",
        field,
      }));
    }
    return freezeOwnedProtocolProjection(yield* decodeEffect(
      schema,
      canonical.value,
      "decode",
      field,
    ));
  });
}

function decodeSegment(
  segment: string,
  field: "protected" | "payload" | "signature",
  maximumBytes: number,
) {
  return Effect.fromResult(decodeCanonicalBase64Url(segment, maximumBytes)).pipe(
    Effect.mapError(cause => new ApplicationMutationGrantV1Error({
      operation: "decode",
      reason: "invalidBase64Url",
      field,
      cause,
    })),
  );
}

function invalid(
  operation: ApplicationMutationGrantV1Error["operation"],
  cause: unknown,
  field?: ApplicationMutationGrantV1Error["field"],
): ApplicationMutationGrantV1Error {
  return new ApplicationMutationGrantV1Error({
    operation,
    reason: "invalidInput",
    ...(field === undefined ? {} : { field }),
    cause,
  });
}
