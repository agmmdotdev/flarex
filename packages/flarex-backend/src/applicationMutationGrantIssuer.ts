import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Data, Effect } from "effect";
import type { GrantRetentionPolicyV1 } from
  "flarex-protocol/grant-retention-policy";
import {
  APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
  assembleApplicationMutationGrantJwsV1,
  createApplicationMutationGrantVerifierNamespaceV1,
  prepareApplicationMutationGrantV1,
  verifyApplicationMutationGrantV1,
  type ApplicationMutationGrantVerificationKeyV1,
  type PrepareApplicationMutationGrantV1Input,
  type VerifiedApplicationMutationGrantV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import {
  isTransactionGrantEpochMillisecondsV1,
  TransactionGrantTimestampV1Schema,
} from "flarex-protocol/transaction-grant";
import type {
  TransactionAuthorizationGrantIdV1,
} from "flarex-protocol/transaction-session";

export type ApplicationMutationGrantIssuerLogicalInput = Omit<
  PrepareApplicationMutationGrantV1Input,
  "kid" | "grantId" | "issuedAt" | "expiresAt"
>;

export interface ApplicationMutationGrantSigner {
  readonly kid: PrepareApplicationMutationGrantV1Input["kid"];
  readonly publicKey: CryptoKey;
  readonly issuedAtInclusiveEpochMilliseconds: number;
  readonly issuedAtExclusiveEpochMilliseconds?: number;
  readonly verificationEndsAtExclusiveEpochMilliseconds?: number;
  readonly sign: (
    bytes: Uint8Array,
  ) => Effect.Effect<Uint8Array, ApplicationMutationGrantIssuerSourceError>;
}

export interface ApplicationMutationGrantIssuerRuntime {
  readonly currentTimeMillis: Effect.Effect<
    number,
    ApplicationMutationGrantIssuerSourceError
  >;
  readonly nextGrantId: Effect.Effect<
    TransactionAuthorizationGrantIdV1,
    ApplicationMutationGrantIssuerSourceError
  >;
}

export interface ApplicationMutationGrantIssuerConfig {
  readonly deploymentId: PrepareApplicationMutationGrantV1Input["deploymentId"];
  readonly grantRetentionPolicy: GrantRetentionPolicyV1;
  readonly signer: ApplicationMutationGrantSigner;
  readonly runtime: ApplicationMutationGrantIssuerRuntime;
}

export class ApplicationMutationGrantIssuerSourceError extends Data.TaggedError(
  "ApplicationMutationGrantIssuerSourceError",
)<{ readonly source: "clock" | "grantId" | "signing" }> {}

export class ApplicationMutationGrantIssuanceError extends Data.TaggedError(
  "ApplicationMutationGrantIssuanceError",
)<{
  readonly reason:
    | "invalidConfiguration"
    | "invalidClock"
    | "signerUnavailable"
    | "lifetimeExhausted"
    | "invalidSignature";
}> {}

export interface ApplicationMutationGrantIssuer {
  readonly issue: (
    input: ApplicationMutationGrantIssuerLogicalInput,
  ) => Effect.Effect<
    VerifiedApplicationMutationGrantV1,
    | ApplicationMutationGrantIssuerSourceError
    | ApplicationMutationGrantIssuanceError
    | Effect.Error<ReturnType<typeof prepareApplicationMutationGrantV1>>
    | Effect.Error<ReturnType<typeof verifyApplicationMutationGrantV1>>
  >;
}

/**
 * This remains a deployment/key-namespace capability rather than a singleton
 * Context service: one host composition can retain several deployment signing
 * namespaces with different key lifecycles. The owning Application service
 * captures the selected capability in its Layer.
 */
export function makeApplicationMutationGrantIssuer(
  config: ApplicationMutationGrantIssuerConfig,
): ApplicationMutationGrantIssuer {
  const signer = Object.freeze({
    kid: config.signer.kid,
    publicKey: config.signer.publicKey,
    issuedAtInclusiveEpochMilliseconds:
      config.signer.issuedAtInclusiveEpochMilliseconds,
    ...(config.signer.issuedAtExclusiveEpochMilliseconds === undefined
      ? {}
      : {
          issuedAtExclusiveEpochMilliseconds:
            config.signer.issuedAtExclusiveEpochMilliseconds,
        }),
    ...(config.signer.verificationEndsAtExclusiveEpochMilliseconds === undefined
      ? {}
      : {
          verificationEndsAtExclusiveEpochMilliseconds:
            config.signer.verificationEndsAtExclusiveEpochMilliseconds,
        }),
    sign: config.signer.sign,
  });
  const verificationKey: ApplicationMutationGrantVerificationKeyV1 =
    Object.freeze({
      kid: signer.kid,
      purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
      state: "active" as const,
      issuedAtInclusiveEpochMilliseconds:
        signer.issuedAtInclusiveEpochMilliseconds,
      ...(signer.issuedAtExclusiveEpochMilliseconds === undefined
        ? {}
        : {
          issuedAtExclusiveEpochMilliseconds:
            signer.issuedAtExclusiveEpochMilliseconds,
        }),
      ...(signer.verificationEndsAtExclusiveEpochMilliseconds === undefined
        ? {}
        : {
          verificationEndsAtExclusiveEpochMilliseconds:
            signer.verificationEndsAtExclusiveEpochMilliseconds,
        }),
      publicKey: signer.publicKey,
    });
  // Validate the static key algorithm, usage, and lifetime window before the
  // issuer can consume a grant ID or call an external signer.
  createApplicationMutationGrantVerifierNamespaceV1({
    deploymentId: config.deploymentId,
    grantRetentionPolicy: config.grantRetentionPolicy,
    trustedNowEpochMilliseconds: Effect.succeed(
      signer.issuedAtInclusiveEpochMilliseconds,
    ),
    keys: [verificationKey],
  });
  const captured = Object.freeze({
    deploymentId: config.deploymentId,
    grantRetentionPolicy: Object.freeze({ ...config.grantRetentionPolicy }),
    signer,
    verificationKey,
    runtime: Object.freeze({
      currentTimeMillis: config.runtime.currentTimeMillis,
      nextGrantId: config.runtime.nextGrantId,
    }),
  });

  const issue: ApplicationMutationGrantIssuer["issue"] = Effect.fn(
    "ApplicationMutationGrantIssuer.issue",
  )(function* (input) {
    if (input.deploymentId !== captured.deploymentId) {
      return yield* new ApplicationMutationGrantIssuanceError({
        reason: "invalidConfiguration",
      });
    }
    const now = yield* captured.runtime.currentTimeMillis;
    if (!isTransactionGrantEpochMillisecondsV1(now)) {
      return yield* new ApplicationMutationGrantIssuanceError({
        reason: "invalidClock",
      });
    }
    if (
      now < captured.signer.issuedAtInclusiveEpochMilliseconds ||
      (captured.signer.issuedAtExclusiveEpochMilliseconds !== undefined &&
        now >= captured.signer.issuedAtExclusiveEpochMilliseconds)
    ) return yield* new ApplicationMutationGrantIssuanceError({
      reason: "signerUnavailable",
    });
    const configuredExpiry = now +
      captured.grantRetentionPolicy.maximumGrantLifetimeMilliseconds;
    if (!isTransactionGrantEpochMillisecondsV1(configuredExpiry)) {
      return yield* new ApplicationMutationGrantIssuanceError({
        reason: "invalidClock",
      });
    }
    const expiresAtMilliseconds = Math.min(
      configuredExpiry,
      captured.signer.verificationEndsAtExclusiveEpochMilliseconds ??
        configuredExpiry,
    );
    if (expiresAtMilliseconds <= now) {
      return yield* new ApplicationMutationGrantIssuanceError({
        reason: "lifetimeExhausted",
      });
    }
    const segments = yield* prepareApplicationMutationGrantV1({
      ...input,
      kid: captured.signer.kid,
      grantId: yield* captured.runtime.nextGrantId,
      issuedAt: TransactionGrantTimestampV1Schema.make(
        new Date(now).toISOString(),
      ),
      expiresAt: TransactionGrantTimestampV1Schema.make(
        new Date(expiresAtMilliseconds).toISOString(),
      ),
    });
    const signature = yield* captured.signer.sign(
      new Uint8Array(copyBytesToArrayBuffer(segments.signingInput)),
    );
    if (signature.byteLength !== 64) {
      return yield* new ApplicationMutationGrantIssuanceError({
        reason: "invalidSignature",
      });
    }
    const jws = assembleApplicationMutationGrantJwsV1(segments, signature);
    return yield* verifyApplicationMutationGrantV1(
      jws,
      createApplicationMutationGrantVerifierNamespaceV1({
        deploymentId: captured.deploymentId,
        grantRetentionPolicy: captured.grantRetentionPolicy,
        trustedNowEpochMilliseconds: Effect.succeed(now),
        keys: [captured.verificationKey],
      }),
    );
  });
  return Object.freeze({ issue });
}
