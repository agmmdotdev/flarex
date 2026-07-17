import { Data, Effect } from "effect";
import {
  AuthProtocolValidationError,
  decodeAuthConfigEffect,
  type AuthProvider,
  type CustomJwtAuthProvider,
  type OidcAuthProvider,
} from "flarex-protocol/auth";
import {
  TRANSACTION_GRANT_JWS_ALGORITHM_V1,
  TRANSACTION_GRANT_JWS_TYPE_V1,
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantIdentityAccessPolicyV1Error,
  TransactionGrantProtocolV1Error,
  canonicalizeTransactionGrantIdentityAccessPolicyV1Effect,
  canonicalizeTransactionGrantPayloadV1,
  canonicalizeTransactionGrantProtectedHeaderV1,
  createTransactionGrantSigningInputV1,
  deriveInertTransactionGrantEvidenceV1Effect,
  encodeTransactionGrantEd25519SignatureV1,
  isPositiveTransactionGrantDurationMillisecondsV1,
  isTransactionGrantEpochMillisecondsV1,
  type InertTransactionGrantEvidenceV1,
  type TransactionGrantDeploymentIdV1,
  type TransactionGrantInertAuthV1,
  type TransactionGrantKeyIdV1,
  type TransactionGrantSigningInputBytesV1,
} from "flarex-protocol/transaction-grant";
import {
  type TransactionAuthorizationGrantIdV1,
} from "flarex-protocol/transaction-session";

import {
  InvalidVerifiedAuthContextError,
  TransactionGrantAuthProjectionError,
  inspectVerifiedAuthContext,
  transactionGrantAuthFromVerifiedAuthContextV1,
  type ResolvedBearerAuthentication,
  type VerifiedAuthContext,
  type VerifiedAuthProviderEvidence,
} from "./authJwt";
import {
  InvalidIssuerPreparedPointMutationStartV1Error,
  inspectIssuerPreparedPointMutationStartV1,
  type IssuerPreparedPointMutationStartV1,
} from "./pointMutationGrantPreparation";

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
  readonly preparedStart: IssuerPreparedPointMutationStartV1;
}

export type IssuePointMutationTransactionGrantV1Error =
  | AuthProtocolValidationError
  | InvalidVerifiedAuthContextError
  | TransactionGrantAuthProjectionError
  | TransactionGrantIdentityAccessPolicyV1Error
  | TransactionGrantProtocolV1Error
  | InvalidIssuerPreparedPointMutationStartV1Error
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
  if (!isPositiveTransactionGrantDurationMillisecondsV1(
    input.maximumGrantLifetimeMilliseconds,
  )) {
    return Effect.fail(
      new TransactionGrantIssuerConfigurationV1Error({
        issue: "invalidMaximumGrantLifetime",
      }),
    );
  }

  const maximumGrantLifetimeMilliseconds =
    input.maximumGrantLifetimeMilliseconds;
  const runtime = input.runtime;

  const issue = Effect.fn("TransactionGrantIssuer.issue")(function* (
    request: IssuePointMutationTransactionGrantV1Input,
  ): Effect.fn.Return<
    InertTransactionGrantEvidenceV1,
    IssuePointMutationTransactionGrantV1Error
  > {
      const preparedStart = yield* Effect.try({
        try: () => inspectIssuerPreparedPointMutationStartV1(
          request.preparedStart,
        ),
        catch: (cause) =>
          cause instanceof InvalidIssuerPreparedPointMutationStartV1Error
            ? cause
            : new InvalidIssuerPreparedPointMutationStartV1Error(),
      });
      const facts = preparedStart.logicalPins;
      const authenticationInput = yield* snapshotAuthentication(
        request.authentication,
      );
      const nowEpochMilliseconds = yield* runtime.currentTimeMillis;
      if (!isTransactionGrantEpochMillisecondsV1(nowEpochMilliseconds)) {
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
      if (!isTransactionGrantEpochMillisecondsV1(configuredExpiry)) {
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
      const policyEvidence = yield*
        canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({
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
          artifactRuntime: facts.artifactRuntime,
          artifactId: facts.artifactId,
          sourcePackageHash: facts.sourcePackageHash,
          executionModule: facts.executionModule,
          functionPath: facts.functionPath,
          functionKind: facts.functionKind,
          schemaVersionId: facts.schemaVersionId,
          policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
          identityAccessPolicySha256: policyEvidence.sha256Hex,
          validatedArgsValueCodecVersion:
            facts.validatedArgsValueCodecVersion,
          validatedArgsSha256: facts.validatedArgsSha256,
          requestKey: facts.requestKey,
          requestSha256: facts.requestSha256,
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
      return yield* deriveInertTransactionGrantEvidenceV1Effect({
        protected: header.base64url,
        payload: payload.base64url,
        signature,
      });
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

const resolveGrantAuthentication = Effect.fn(
  "TransactionGrantIssuer.resolveAuthentication",
)(function* (
  runtime: TransactionGrantIssuerRuntimeV1,
  deploymentId: TransactionGrantDeploymentIdV1,
  authentication: SnapshotGrantAuthenticationV1,
  nowEpochMilliseconds: number,
): Effect.fn.Return<
  ResolvedGrantAuthenticationV1,
  | AuthProtocolValidationError
  | InvalidVerifiedAuthContextError
  | TransactionGrantAuthProjectionError
  | TransactionGrantIssuerSourceV1Error
  | TransactionGrantIssuanceV1Error
> {
  if (authentication.kind === "anonymous") {
    return Object.freeze({
      auth: ANONYMOUS_GRANT_AUTH_V1,
    });
  }

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
    !isTransactionGrantEpochMillisecondsV1(
      credentialExpiresAtEpochMilliseconds,
    ) ||
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
  return isTransactionGrantEpochMillisecondsV1(start) &&
    (issuanceEnd === undefined ||
      (isTransactionGrantEpochMillisecondsV1(issuanceEnd) &&
        issuanceEnd > start)) &&
    (verificationEnd === undefined ||
      (isTransactionGrantEpochMillisecondsV1(verificationEnd) &&
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

function protocolPromise<T>(
  operation: () => Promise<T>,
): Effect.Effect<T, TransactionGrantProtocolV1Error> {
  return Effect.tryPromise({
    try: operation,
    catch: (cause): unknown => cause,
  }).pipe(Effect.catch(protocolFailureOrDefect));
}

function protocolSync<T>(
  operation: () => T,
): Effect.Effect<T, TransactionGrantProtocolV1Error> {
  return Effect.try({
    try: operation,
    catch: (cause): unknown => cause,
  }).pipe(Effect.catch(protocolFailureOrDefect));
}

function protocolFailureOrDefect(
  cause: unknown,
): Effect.Effect<never, TransactionGrantProtocolV1Error> {
  return cause instanceof TransactionGrantProtocolV1Error
    ? Effect.fail(cause)
    : Effect.die(cause);
}
