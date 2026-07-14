import { Data, Effect } from "effect";
import {
  AuthProtocolValidationError,
  decodeAuthConfigEffect,
  type AuthProvider,
  type CustomJwtAuthProvider,
  type OidcAuthProvider,
} from "flarex-protocol/auth";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import {
  TRANSACTION_GRANT_JWS_ALGORITHM_V1,
  TRANSACTION_GRANT_JWS_TYPE_V1,
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantIdentityAccessPolicyV1Error,
  TransactionGrantProtocolV1Error,
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
  canonicalizeTransactionGrantPayloadV1,
  canonicalizeTransactionGrantProtectedHeaderV1,
  createTransactionGrantSigningInputV1,
  deriveInertTransactionGrantEvidenceV1,
  encodeTransactionGrantEd25519SignatureV1,
  transactionGrantRequestSha256HexV1FromBytes,
  transactionGrantValidatedArgsSha256HexV1FromBytes,
  type InertTransactionGrantEvidenceV1,
  type TransactionGrantDeploymentIdV1,
  type TransactionGrantInertAuthV1,
  type TransactionGrantKeyIdV1,
  type TransactionGrantSigningInputBytesV1,
} from "flarex-protocol/transaction-grant";
import {
  TransactionArgumentsSha256V1Schema,
  TransactionRequestSha256V1Schema,
  type TransactionArgumentsSha256V1,
  type TransactionAuthorizationGrantIdV1,
  type TransactionAuthorizationRevocationEpoch,
  type TransactionExecutionModuleV1,
  type TransactionFunctionPathV1,
  type TransactionPackageIdV1,
  type TransactionRequestKeyV1,
  type TransactionRequestSha256V1,
  type TransactionSourcePackageSha256HexV1,
} from "flarex-protocol/transaction-session";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "flarex-protocol/value";

import {
  InvalidVerifiedAuthContextError,
  TransactionGrantAuthProjectionError,
  inspectVerifiedAuthContext,
  transactionGrantAuthFromVerifiedAuthContextV1,
  type ResolvedBearerAuthentication,
  type VerifiedAuthContext,
  type VerifiedAuthProviderEvidence,
} from "./authJwt";

const MAX_ECMASCRIPT_DATE_EPOCH_MILLISECONDS = 8_640_000_000_000_000;

/*
 * These facts are deliberately structural until A2c supplies their
 * authoritative preparation source. Hash bytes are copied on entry so an
 * asynchronous caller cannot mutate the signed request after issuance starts.
 */
export interface HostPreparedPointMutationGrantFactsV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly packageId: TransactionPackageIdV1;
  readonly sourcePackageHash: TransactionSourcePackageSha256HexV1;
  readonly executionModule: TransactionExecutionModuleV1;
  readonly functionPath: TransactionFunctionPathV1;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly validatedArgsSha256: TransactionArgumentsSha256V1;
  readonly requestKey: TransactionRequestKeyV1;
  readonly requestSha256: TransactionRequestSha256V1;
  readonly authorizationRevocationEpoch:
    TransactionAuthorizationRevocationEpoch;
}

export type TransactionGrantSigningKeyStateV1 =
  | "activeSigner"
  | "verifyOnly"
  | "disabled";

interface TransactionGrantSigningKeyMetadataV1 {
  readonly kid: TransactionGrantKeyIdV1;
  readonly purpose: string;
  readonly issuedAtInclusiveEpochMilliseconds: number;
  readonly issuedAtExclusiveEpochMilliseconds?: number;
  readonly verificationEndsAtExclusiveEpochMilliseconds?: number;
}

export interface ActiveTransactionGrantSigningKeyV1
  extends TransactionGrantSigningKeyMetadataV1 {
  readonly state: "activeSigner";
  readonly sign: (
    input: TransactionGrantSigningInputBytesV1,
  ) => Effect.Effect<Uint8Array, TransactionGrantIssuerSourceV1Error>;
}

export interface VerificationOnlyTransactionGrantSigningKeyV1
  extends TransactionGrantSigningKeyMetadataV1 {
  readonly state: "verifyOnly";
}

export interface DisabledTransactionGrantSigningKeyV1 {
  readonly state: "disabled";
  readonly kid: TransactionGrantKeyIdV1;
  readonly purpose: string;
}

export type TransactionGrantSigningKeyV1 =
  | ActiveTransactionGrantSigningKeyV1
  | VerificationOnlyTransactionGrantSigningKeyV1
  | DisabledTransactionGrantSigningKeyV1;

export interface TransactionGrantSigningKeyringSnapshotV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly keys: ReadonlyArray<TransactionGrantSigningKeyV1>;
}

export type TransactionGrantIssuerSourceV1 =
  | "clock"
  | "authConfig"
  | "grantId"
  | "keyring"
  | "signing";

export class TransactionGrantIssuerSourceV1Error extends Data.TaggedError(
  "TransactionGrantIssuerSourceV1Error",
)<{
  readonly source: TransactionGrantIssuerSourceV1;
}> {}

export type TransactionGrantIssuerConfigurationV1Issue =
  | "invalidMaximumGrantLifetime";

export class TransactionGrantIssuerConfigurationV1Error extends Data.TaggedError(
  "TransactionGrantIssuerConfigurationV1Error",
)<{
  readonly issue: TransactionGrantIssuerConfigurationV1Issue;
}> {}

export type TransactionGrantIssuanceV1Issue =
  | "unsupportedAuthentication"
  | "invalidPreparedFacts"
  | "invalidClockReading"
  | "timestampOutOfRange"
  | "credentialExpired"
  | "authProviderInactive"
  | "authConfigMissing"
  | "keyNamespaceMismatch"
  | "duplicateKeyId"
  | "wrongKeyPurpose"
  | "invalidKeyWindow"
  | "noActiveSigner"
  | "multipleActiveSigners"
  | "activeSignerOutOfWindow"
  | "grantLifetimeExhausted"
  | "protocolOperationFailed";

export class TransactionGrantIssuanceV1Error extends Data.TaggedError(
  "TransactionGrantIssuanceV1Error",
)<{
  readonly issue: TransactionGrantIssuanceV1Issue;
}> {}

export interface TransactionGrantIssuerRuntimeV1 {
  readonly currentTimeMillis: Effect.Effect<
    number,
    TransactionGrantIssuerSourceV1Error
  >;
  readonly loadCurrentAuthConfig: (
    deploymentId: TransactionGrantDeploymentIdV1,
  ) => Effect.Effect<unknown | null, TransactionGrantIssuerSourceV1Error>;
  readonly nextGrantId: Effect.Effect<
    TransactionAuthorizationGrantIdV1,
    TransactionGrantIssuerSourceV1Error
  >;
  readonly loadSigningKeyring: (
    deploymentId: TransactionGrantDeploymentIdV1,
  ) => Effect.Effect<
    TransactionGrantSigningKeyringSnapshotV1,
    TransactionGrantIssuerSourceV1Error
  >;
}

export interface IssuePointMutationTransactionGrantV1Input {
  readonly authentication: ResolvedBearerAuthentication;
  readonly facts: HostPreparedPointMutationGrantFactsV1;
}

export type IssuePointMutationTransactionGrantV1Error =
  | AuthProtocolValidationError
  | InvalidVerifiedAuthContextError
  | TransactionGrantAuthProjectionError
  | TransactionGrantIdentityAccessPolicyV1Error
  | TransactionGrantProtocolV1Error
  | TransactionGrantIssuerSourceV1Error
  | TransactionGrantIssuanceV1Error;

export interface PointMutationTransactionGrantIssuerV1 {
  readonly issue: (
    input: IssuePointMutationTransactionGrantV1Input,
  ) => Effect.Effect<
    InertTransactionGrantEvidenceV1,
    IssuePointMutationTransactionGrantV1Error
  >;
}

export interface MakePointMutationTransactionGrantIssuerV1Input {
  readonly maximumGrantLifetimeMilliseconds: number;
  readonly runtime: TransactionGrantIssuerRuntimeV1;
}

export function makePointMutationTransactionGrantIssuerV1(
  input: MakePointMutationTransactionGrantIssuerV1Input,
): Effect.Effect<
  PointMutationTransactionGrantIssuerV1,
  TransactionGrantIssuerConfigurationV1Error
> {
  if (!isPositiveSafeInteger(input.maximumGrantLifetimeMilliseconds)) {
    return Effect.fail(
      new TransactionGrantIssuerConfigurationV1Error({
        issue: "invalidMaximumGrantLifetime",
      }),
    );
  }

  const maximumGrantLifetimeMilliseconds =
    input.maximumGrantLifetimeMilliseconds;
  const runtime = input.runtime;

  const issue: PointMutationTransactionGrantIssuerV1["issue"] = request =>
    Effect.gen(function* () {
      const facts = yield* snapshotPreparedFacts(request.facts);
      const authenticationInput = yield* snapshotAuthentication(
        request.authentication,
      );
      const nowEpochMilliseconds = yield* runtime.currentTimeMillis;
      if (!isValidEpochMilliseconds(nowEpochMilliseconds)) {
        return yield* Effect.fail(
          new TransactionGrantIssuanceV1Error({
            issue: "invalidClockReading",
          }),
        );
      }

      const authentication = yield* resolveGrantAuthentication(
        runtime,
        facts.deploymentId,
        authenticationInput,
        nowEpochMilliseconds,
      );
      const configuredExpiry =
        nowEpochMilliseconds + maximumGrantLifetimeMilliseconds;
      if (!isValidEpochMilliseconds(configuredExpiry)) {
        return yield* Effect.fail(
          new TransactionGrantIssuanceV1Error({
            issue: "timestampOutOfRange",
          }),
        );
      }
      let expiresAtEpochMilliseconds = Math.min(
        configuredExpiry,
        authentication.credentialExpiresAtEpochMilliseconds ??
          configuredExpiry,
      );

      const keyring = yield* runtime.loadSigningKeyring(
        facts.deploymentId,
      );
      const activeSigner = yield* selectActiveSigner(
        keyring,
        facts.deploymentId,
        nowEpochMilliseconds,
      );
      const verificationEnd =
        activeSigner.verificationEndsAtExclusiveEpochMilliseconds;
      if (verificationEnd !== undefined) {
        expiresAtEpochMilliseconds = Math.min(
          expiresAtEpochMilliseconds,
          verificationEnd,
        );
      }
      if (expiresAtEpochMilliseconds <= nowEpochMilliseconds) {
        return yield* Effect.fail(
          new TransactionGrantIssuanceV1Error({
            issue: "grantLifetimeExhausted",
          }),
        );
      }

      const issuedAt = yield* canonicalTimestamp(nowEpochMilliseconds);
      const expiresAt = yield* canonicalTimestamp(expiresAtEpochMilliseconds);
      const policyEvidence = yield* policyEvidenceEffect({
        policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
        auth: authentication.auth,
        capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
      });
      const grantId = yield* runtime.nextGrantId;
      const payload = yield* protocolPromise(() =>
        canonicalizeTransactionGrantPayloadV1({
          format: "flarex.transaction-grant",
          version: 1,
          grantId,
          deploymentId: facts.deploymentId,
          scopeId: facts.scopeId,
          packageId: facts.packageId,
          artifactRuntime: "dynamic-worker",
          artifactId: `artifact_${facts.sourcePackageHash.slice(0, 32)}`,
          sourcePackageHash: facts.sourcePackageHash,
          executionModule: facts.executionModule,
          functionPath: facts.functionPath,
          functionKind: "mutation",
          schemaVersionId: facts.schemaVersionId,
          policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
          identityAccessPolicySha256: policyEvidence.sha256Hex,
          validatedArgsValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
          validatedArgsSha256:
            transactionGrantValidatedArgsSha256HexV1FromBytes(
              facts.validatedArgsSha256,
            ),
          requestKey: facts.requestKey,
          requestSha256: transactionGrantRequestSha256HexV1FromBytes(
            facts.requestSha256,
          ),
          capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
          auth: authentication.auth,
          issuedAt,
          expiresAt,
          authorizationRevocationEpoch:
            facts.authorizationRevocationEpoch.toString(),
        }),
      );
      const header = yield* protocolSync(() =>
        canonicalizeTransactionGrantProtectedHeaderV1({
          alg: TRANSACTION_GRANT_JWS_ALGORITHM_V1,
          kid: activeSigner.kid,
          typ: TRANSACTION_GRANT_JWS_TYPE_V1,
        }),
      );
      const signingInput = createTransactionGrantSigningInputV1({
        protected: header.base64url,
        payload: payload.base64url,
      });
      const signatureBytes = yield* activeSigner.sign(signingInput);
      const signature = yield* protocolSync(() =>
        encodeTransactionGrantEd25519SignatureV1(signatureBytes),
      );
      return yield* protocolPromise(() =>
        deriveInertTransactionGrantEvidenceV1({
          protected: header.base64url,
          payload: payload.base64url,
          signature,
        }),
      );
    });

  return Effect.succeed(Object.freeze({ issue }));
}

interface ResolvedGrantAuthenticationV1 {
  readonly auth: TransactionGrantInertAuthV1;
  readonly credentialExpiresAtEpochMilliseconds?: number;
}

type SnapshotGrantAuthenticationV1 =
  | { readonly kind: "anonymous" }
  | {
      readonly kind: "verifiedBearer";
      readonly verifiedAuthContext: VerifiedAuthContext;
    };

const ANONYMOUS_GRANT_AUTH_V1 = Object.freeze({
  kind: "anonymous",
}) satisfies TransactionGrantInertAuthV1;

function snapshotAuthentication(
  authentication: ResolvedBearerAuthentication,
): Effect.Effect<
  SnapshotGrantAuthenticationV1,
  TransactionGrantIssuanceV1Error
> {
  if (authentication.kind === "anonymous") {
    return Effect.succeed(Object.freeze({ kind: "anonymous" as const }));
  }
  if (authentication.kind === "verifiedBearer") {
    return Effect.succeed(Object.freeze({
      kind: "verifiedBearer" as const,
      verifiedAuthContext: authentication.verifiedAuthContext,
    }));
  }
  return Effect.fail(
    new TransactionGrantIssuanceV1Error({
      issue: "unsupportedAuthentication",
    }),
  );
}

function snapshotPreparedFacts(
  facts: HostPreparedPointMutationGrantFactsV1,
): Effect.Effect<
  HostPreparedPointMutationGrantFactsV1,
  TransactionGrantIssuanceV1Error
> {
  return Effect.try({
    try: () => Object.freeze({
      deploymentId: facts.deploymentId,
      scopeId: facts.scopeId,
      packageId: facts.packageId,
      sourcePackageHash: facts.sourcePackageHash,
      executionModule: facts.executionModule,
      functionPath: facts.functionPath,
      schemaVersionId: facts.schemaVersionId,
      validatedArgsSha256: TransactionArgumentsSha256V1Schema.make(
        new Uint8Array(facts.validatedArgsSha256),
      ),
      requestKey: facts.requestKey,
      requestSha256: TransactionRequestSha256V1Schema.make(
        new Uint8Array(facts.requestSha256),
      ),
      authorizationRevocationEpoch: facts.authorizationRevocationEpoch,
    }),
    catch: () =>
      new TransactionGrantIssuanceV1Error({
        issue: "invalidPreparedFacts",
      }),
  });
}

function resolveGrantAuthentication(
  runtime: TransactionGrantIssuerRuntimeV1,
  deploymentId: TransactionGrantDeploymentIdV1,
  authentication: SnapshotGrantAuthenticationV1,
  nowEpochMilliseconds: number,
): Effect.Effect<
  ResolvedGrantAuthenticationV1,
  | AuthProtocolValidationError
  | InvalidVerifiedAuthContextError
  | TransactionGrantAuthProjectionError
  | TransactionGrantIssuerSourceV1Error
  | TransactionGrantIssuanceV1Error
> {
  if (authentication.kind === "anonymous") {
    return Effect.succeed(Object.freeze({
      auth: ANONYMOUS_GRANT_AUTH_V1,
    }));
  }

  return Effect.gen(function* () {
    const evidence = yield* Effect.try({
      try: () => inspectVerifiedAuthContext(authentication.verifiedAuthContext),
      catch: cause =>
        cause instanceof InvalidVerifiedAuthContextError
          ? cause
          : new InvalidVerifiedAuthContextError({
              message: "Verified auth context is not process-local evidence.",
            }),
    });
    const credentialExpiresAtEpochMilliseconds = Math.floor(
      evidence.credentialExpiresAtEpochSeconds * 1_000,
    );
    if (
      !isValidEpochMilliseconds(credentialExpiresAtEpochMilliseconds) ||
      credentialExpiresAtEpochMilliseconds <= nowEpochMilliseconds
    ) {
      return yield* Effect.fail(
        new TransactionGrantIssuanceV1Error({
          issue: "credentialExpired",
        }),
      );
    }

    const currentConfigInput = yield* runtime.loadCurrentAuthConfig(
      deploymentId,
    );
    if (currentConfigInput === null) {
      return yield* Effect.fail(
        new TransactionGrantIssuanceV1Error({
          issue: "authConfigMissing",
        }),
      );
    }
    const currentConfig = yield* decodeAuthConfigEffect(currentConfigInput);
    if (!currentConfig.providers.some(provider =>
      sameProviderConfiguration(provider, evidence.matchedProvider)
    )) {
      return yield* Effect.fail(
        new TransactionGrantIssuanceV1Error({
          issue: "authProviderInactive",
        }),
      );
    }

    const auth = yield* Effect.try({
      try: () => transactionGrantAuthFromVerifiedAuthContextV1(
        authentication.verifiedAuthContext,
      ),
      catch: cause =>
        cause instanceof TransactionGrantAuthProjectionError
          ? cause
          : cause instanceof InvalidVerifiedAuthContextError
            ? cause
            : new TransactionGrantAuthProjectionError({
                message:
                  "Verified authentication cannot be projected into grant auth.",
                cause,
              }),
    });
    return Object.freeze({
      auth,
      credentialExpiresAtEpochMilliseconds,
    });
  });
}

function sameProviderConfiguration(
  current: AuthProvider,
  expected: VerifiedAuthProviderEvidence,
): boolean {
  if (expected.type === "customJwt") {
    return isCustomJwtProvider(current) &&
      sameCustomJwtProvider(current, expected.configuration);
  }
  return !isCustomJwtProvider(current) &&
    sameOidcProvider(current, expected.configuration);
}

function sameCustomJwtProvider(
  current: CustomJwtAuthProvider,
  expected: CustomJwtAuthProvider,
): boolean {
  return current.type === expected.type &&
    current.issuer === expected.issuer &&
    current.jwks === expected.jwks &&
    current.algorithm === expected.algorithm &&
    current.applicationID === expected.applicationID;
}

function sameOidcProvider(
  current: OidcAuthProvider,
  expected: OidcAuthProvider,
): boolean {
  return current.domain === expected.domain &&
    current.applicationID === expected.applicationID;
}

function isCustomJwtProvider(
  provider: AuthProvider,
): provider is CustomJwtAuthProvider {
  return "type" in provider && provider.type === "customJwt";
}

function selectActiveSigner(
  keyring: TransactionGrantSigningKeyringSnapshotV1,
  expectedDeploymentId: TransactionGrantDeploymentIdV1,
  issuedAtEpochMilliseconds: number,
): Effect.Effect<
  ActiveTransactionGrantSigningKeyV1,
  TransactionGrantIssuanceV1Error
> {
  if (keyring.deploymentId !== expectedDeploymentId) {
    return Effect.fail(
      new TransactionGrantIssuanceV1Error({
        issue: "keyNamespaceMismatch",
      }),
    );
  }
  const seenKeyIds = new Set<string>();
  const activeSigners: ActiveTransactionGrantSigningKeyV1[] = [];
  for (const key of [...keyring.keys]) {
    if (seenKeyIds.has(key.kid)) {
      return Effect.fail(
        new TransactionGrantIssuanceV1Error({ issue: "duplicateKeyId" }),
      );
    }
    seenKeyIds.add(key.kid);
    if (key.purpose !== TRANSACTION_GRANT_KEY_PURPOSE_V1) {
      return Effect.fail(
        new TransactionGrantIssuanceV1Error({ issue: "wrongKeyPurpose" }),
      );
    }
    if (key.state === "disabled") continue;
    if (!isValidKeyWindow(key)) {
      return Effect.fail(
        new TransactionGrantIssuanceV1Error({ issue: "invalidKeyWindow" }),
      );
    }
    if (key.state === "activeSigner") activeSigners.push(key);
  }
  if (activeSigners.length === 0) {
    return Effect.fail(
      new TransactionGrantIssuanceV1Error({ issue: "noActiveSigner" }),
    );
  }
  if (activeSigners.length !== 1) {
    return Effect.fail(
      new TransactionGrantIssuanceV1Error({ issue: "multipleActiveSigners" }),
    );
  }
  const activeSigner = activeSigners[0];
  if (activeSigner === undefined) {
    return Effect.fail(
      new TransactionGrantIssuanceV1Error({ issue: "noActiveSigner" }),
    );
  }
  if (
    issuedAtEpochMilliseconds <
      activeSigner.issuedAtInclusiveEpochMilliseconds ||
    (activeSigner.issuedAtExclusiveEpochMilliseconds !== undefined &&
      issuedAtEpochMilliseconds >=
        activeSigner.issuedAtExclusiveEpochMilliseconds) ||
    (activeSigner.verificationEndsAtExclusiveEpochMilliseconds !== undefined &&
      issuedAtEpochMilliseconds >=
        activeSigner.verificationEndsAtExclusiveEpochMilliseconds)
  ) {
    return Effect.fail(
      new TransactionGrantIssuanceV1Error({
        issue: "activeSignerOutOfWindow",
      }),
    );
  }
  return Effect.succeed(Object.freeze({
    state: activeSigner.state,
    kid: activeSigner.kid,
    purpose: activeSigner.purpose,
    issuedAtInclusiveEpochMilliseconds:
      activeSigner.issuedAtInclusiveEpochMilliseconds,
    ...(activeSigner.issuedAtExclusiveEpochMilliseconds === undefined
      ? {}
      : {
          issuedAtExclusiveEpochMilliseconds:
            activeSigner.issuedAtExclusiveEpochMilliseconds,
        }),
    ...(activeSigner.verificationEndsAtExclusiveEpochMilliseconds === undefined
      ? {}
      : {
          verificationEndsAtExclusiveEpochMilliseconds:
            activeSigner.verificationEndsAtExclusiveEpochMilliseconds,
        }),
    sign: activeSigner.sign,
  } satisfies ActiveTransactionGrantSigningKeyV1));
}

function isValidKeyWindow(
  key: ActiveTransactionGrantSigningKeyV1 |
    VerificationOnlyTransactionGrantSigningKeyV1,
): boolean {
  const start = key.issuedAtInclusiveEpochMilliseconds;
  const issuanceEnd = key.issuedAtExclusiveEpochMilliseconds;
  const verificationEnd =
    key.verificationEndsAtExclusiveEpochMilliseconds;
  return isValidEpochMilliseconds(start) &&
    (issuanceEnd === undefined ||
      (isValidEpochMilliseconds(issuanceEnd) && issuanceEnd > start)) &&
    (verificationEnd === undefined ||
      (isValidEpochMilliseconds(verificationEnd) &&
        verificationEnd > start &&
        (issuanceEnd === undefined || verificationEnd >= issuanceEnd)));
}

function canonicalTimestamp(
  epochMilliseconds: number,
): Effect.Effect<string, TransactionGrantIssuanceV1Error> {
  return Effect.try({
    try: () => new Date(epochMilliseconds).toISOString(),
    catch: () =>
      new TransactionGrantIssuanceV1Error({
        issue: "timestampOutOfRange",
      }),
  });
}

function policyEvidenceEffect(
  input: Parameters<
    typeof canonicalizeTransactionGrantIdentityAccessPolicyV1
  >[0],
): Effect.Effect<
  Awaited<
    ReturnType<typeof canonicalizeTransactionGrantIdentityAccessPolicyV1>
  >,
  TransactionGrantIdentityAccessPolicyV1Error
> {
  return Effect.tryPromise({
    try: () => canonicalizeTransactionGrantIdentityAccessPolicyV1(input),
    catch: cause =>
      cause instanceof TransactionGrantIdentityAccessPolicyV1Error
        ? cause
        : new TransactionGrantIdentityAccessPolicyV1Error({
            issue: "canonicalizationFailed",
          }),
  });
}

function protocolPromise<T>(
  operation: () => Promise<T>,
): Effect.Effect<
  T,
  TransactionGrantProtocolV1Error | TransactionGrantIssuanceV1Error
> {
  return Effect.tryPromise({
    try: operation,
    catch: cause =>
      cause instanceof TransactionGrantProtocolV1Error
        ? cause
        : new TransactionGrantIssuanceV1Error({
            issue: "protocolOperationFailed",
          }),
  });
}

function protocolSync<T>(
  operation: () => T,
): Effect.Effect<
  T,
  TransactionGrantProtocolV1Error | TransactionGrantIssuanceV1Error
> {
  return Effect.try({
    try: operation,
    catch: cause =>
      cause instanceof TransactionGrantProtocolV1Error
        ? cause
        : new TransactionGrantIssuanceV1Error({
            issue: "protocolOperationFailed",
          }),
  });
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 &&
    value <= MAX_ECMASCRIPT_DATE_EPOCH_MILLISECONDS;
}

function isValidEpochMilliseconds(value: number): boolean {
  return Number.isSafeInteger(value) &&
    Math.abs(value) <= MAX_ECMASCRIPT_DATE_EPOCH_MILLISECONDS;
}
