import { Data, Effect, Result } from "effect";

import {
  createApplicationMutationGrantVerifierNamespaceV1,
  inspectVerifiedApplicationMutationGrantV1,
  verifyApplicationMutationGrantV1,
  type ApplicationMutationGrantPayloadV1,
  type ApplicationMutationGrantVerificationKeyV1,
  type InertApplicationMutationGrantEvidenceV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import {
  makeGrantRetentionPolicyV1Result,
  type GrantRetentionPolicyV1,
} from "flarex-protocol/grant-retention-policy";
import {
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  canonicalizeTransactionGrantIdentityAccessPolicyV1Effect,
  isTransactionGrantEpochMillisecondsV1,
  type TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";

export interface ExpectedApplicationMutationGrantLogicalPinsV1 {
  readonly deploymentId: ApplicationMutationGrantPayloadV1["deploymentId"];
  readonly scopeId: ApplicationMutationGrantPayloadV1["scopeId"];
  readonly executionAuthoritySha256:
    ApplicationMutationGrantPayloadV1["executionAuthoritySha256"];
  readonly activationSequence:
    ApplicationMutationGrantPayloadV1["activationSequence"];
  readonly activeHeadSha256:
    ApplicationMutationGrantPayloadV1["activeHeadSha256"];
  readonly schemaVersionId:
    ApplicationMutationGrantPayloadV1["schemaVersionId"];
  readonly functionPath: ApplicationMutationGrantPayloadV1["functionPath"];
  readonly functionKind: "mutation";
  readonly policyVersion: ApplicationMutationGrantPayloadV1["policyVersion"];
  readonly identityAccessPolicySha256:
    ApplicationMutationGrantPayloadV1["identityAccessPolicySha256"];
  readonly validatedArgsValueCodecVersion:
    ApplicationMutationGrantPayloadV1["validatedArgsValueCodecVersion"];
  readonly validatedArgsSha256:
    ApplicationMutationGrantPayloadV1["validatedArgsSha256"];
  readonly requestKey: ApplicationMutationGrantPayloadV1["requestKey"];
  readonly requestSha256: ApplicationMutationGrantPayloadV1["requestSha256"];
  readonly authorizationRevocationEpoch:
    ApplicationMutationGrantPayloadV1["authorizationRevocationEpoch"];
}

export type ExpectedApplicationMutationGrantLogicalPinFieldV1 =
  keyof ExpectedApplicationMutationGrantLogicalPinsV1;

export type ApplicationMutationGrantVerificationKernelV1Issue =
  | { readonly reason: "malformedEvidence" }
  | { readonly reason: "verificationFailed" }
  | { readonly reason: "invalidClockReading" }
  | { readonly reason: "policyMismatch" }
  | { readonly reason: "policyDigestMismatch" }
  | {
      readonly reason: "pinMismatch";
      readonly field: ExpectedApplicationMutationGrantLogicalPinFieldV1;
    };

export class ApplicationMutationGrantVerificationKernelV1Error
  extends Data.TaggedError("ApplicationMutationGrantVerificationKernelV1Error")<{
    readonly issue: ApplicationMutationGrantVerificationKernelV1Issue;
  }> {}

export interface VerifiedApplicationMutationGrantInspectionV1 {
  readonly evidence: InertApplicationMutationGrantEvidenceV1;
  readonly verifiedAtEpochMilliseconds: number;
}

export interface ApplicationMutationGrantVerificationKernelV1Config {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly keys: ReadonlyArray<ApplicationMutationGrantVerificationKeyV1>;
  readonly grantRetentionPolicy: GrantRetentionPolicyV1;
}

export interface VerifyApplicationMutationGrantKernelV1Input {
  readonly jws: unknown;
  readonly expectedLogicalPins: ExpectedApplicationMutationGrantLogicalPinsV1;
  readonly trustedNowEpochMilliseconds: number;
}

export interface ApplicationMutationGrantVerificationKernelV1 {
  readonly verify: (
    input: VerifyApplicationMutationGrantKernelV1Input,
  ) => Effect.Effect<
    VerifiedApplicationMutationGrantInspectionV1,
    ApplicationMutationGrantVerificationKernelV1Error
  >;
}

export function createApplicationMutationGrantVerificationKernelV1(
  config: ApplicationMutationGrantVerificationKernelV1Config,
): ApplicationMutationGrantVerificationKernelV1 {
  const deploymentId = config.deploymentId;
  const grantRetentionPolicy = Result.getOrThrow(
    makeGrantRetentionPolicyV1Result({
      maximumGrantLifetimeMilliseconds:
        config.grantRetentionPolicy.maximumGrantLifetimeMilliseconds,
      maximumFutureIssuedAtSkewMilliseconds:
        config.grantRetentionPolicy.maximumFutureIssuedAtSkewMilliseconds,
      maximumLiveSnapshotRetentionMilliseconds:
        config.grantRetentionPolicy.maximumLiveSnapshotRetentionMilliseconds,
    }),
  );
  const keys = Object.freeze(config.keys.map(snapshotVerificationKey));
  // Validate immutable verifier configuration once. Per-call namespaces below
  // differ only by their database-authoritative clock Effect.
  createApplicationMutationGrantVerifierNamespaceV1({
    deploymentId,
    grantRetentionPolicy,
    trustedNowEpochMilliseconds: Effect.succeed(0),
    keys,
  });

  const verify = Effect.fn("ApplicationMutationGrantVerification.verify")(
    function* (input: VerifyApplicationMutationGrantKernelV1Input) {
      if (!isTransactionGrantEpochMillisecondsV1(
        input.trustedNowEpochMilliseconds,
      )) {
        return yield* Effect.fail(kernelFailure("invalidClockReading"));
      }
      if (input.expectedLogicalPins.deploymentId !== deploymentId) {
        return yield* Effect.fail(pinMismatch("deploymentId"));
      }

      const namespace = createApplicationMutationGrantVerifierNamespaceV1({
        deploymentId,
        grantRetentionPolicy,
        trustedNowEpochMilliseconds: Effect.succeed(
          input.trustedNowEpochMilliseconds,
        ),
        keys,
      });
      const verified = yield* verifyApplicationMutationGrantV1(
        input.jws,
        namespace,
      ).pipe(
        Effect.mapError(error => kernelFailure(
          error.reason === "invalidInput" ||
              error.reason === "invalidBase64Url" ||
              error.reason === "invalidUtf8" ||
              error.reason === "invalidJson" ||
              error.reason === "nonCanonical"
            ? "malformedEvidence"
            : "verificationFailed",
        )),
      );
      const evidence = yield* Effect.try({
        try: () => inspectVerifiedApplicationMutationGrantV1(verified),
        catch: () => kernelFailure("verificationFailed"),
      });
      yield* enforceApplicationMutationPolicyEffect(evidence.payload);
      const mismatch = compareExpectedPins(
        evidence.payload,
        input.expectedLogicalPins,
      );
      if (mismatch !== undefined) return yield* Effect.fail(mismatch);

      return Object.freeze({
        evidence,
        verifiedAtEpochMilliseconds: input.trustedNowEpochMilliseconds,
      } satisfies VerifiedApplicationMutationGrantInspectionV1);
    },
  );
  return Object.freeze({ verify });
}

function snapshotVerificationKey(
  key: ApplicationMutationGrantVerificationKeyV1,
): ApplicationMutationGrantVerificationKeyV1 {
  const common = Object.freeze({ kid: key.kid, purpose: key.purpose });
  if (key.state === "disabled") {
    return Object.freeze({ ...common, state: key.state });
  }
  if (key.state === "verifyOnly" && key.phase === "prepublished") {
    return Object.freeze({
      ...common,
      state: key.state,
      phase: key.phase,
      publicKey: key.publicKey,
    });
  }
  if (key.state === "verifyOnly") {
    return Object.freeze({
      ...common,
      state: key.state,
      phase: key.phase,
      issuedAtInclusiveEpochMilliseconds:
        key.issuedAtInclusiveEpochMilliseconds,
      issuedAtExclusiveEpochMilliseconds:
        key.issuedAtExclusiveEpochMilliseconds,
      verificationEndsAtExclusiveEpochMilliseconds:
        key.verificationEndsAtExclusiveEpochMilliseconds,
      publicKey: key.publicKey,
    });
  }
  return Object.freeze({
    ...common,
    state: key.state,
    issuedAtInclusiveEpochMilliseconds:
      key.issuedAtInclusiveEpochMilliseconds,
    ...(key.issuedAtExclusiveEpochMilliseconds === undefined ? {} : {
      issuedAtExclusiveEpochMilliseconds:
        key.issuedAtExclusiveEpochMilliseconds,
    }),
    ...(key.verificationEndsAtExclusiveEpochMilliseconds === undefined
      ? {}
      : {
          verificationEndsAtExclusiveEpochMilliseconds:
            key.verificationEndsAtExclusiveEpochMilliseconds,
        }),
    publicKey: key.publicKey,
  });
}

const enforceApplicationMutationPolicyEffect = Effect.fn(
  "ApplicationMutationGrantVerification.enforcePolicy",
)(function* (payload: ApplicationMutationGrantPayloadV1) {
  if (
    payload.policyVersion !==
      TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1 ||
    !sameCapabilities(
      payload.capabilities,
      TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    ) ||
    payload.auth.kind === "trustedDev" ||
    (payload.auth.kind === "verifiedBearer" &&
      Object.keys(payload.auth.claims).length !== 0)
  ) {
    return yield* Effect.fail(kernelFailure("policyMismatch"));
  }
  const policy = yield* canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({
    policyVersion: payload.policyVersion,
    auth: payload.auth,
    capabilities: payload.capabilities,
  }).pipe(Effect.mapError(() => kernelFailure("policyMismatch")));
  if (policy.sha256Hex !== payload.identityAccessPolicySha256) {
    return yield* Effect.fail(kernelFailure("policyDigestMismatch"));
  }
});

function compareExpectedPins(
  payload: ApplicationMutationGrantPayloadV1,
  expected: ExpectedApplicationMutationGrantLogicalPinsV1,
): ApplicationMutationGrantVerificationKernelV1Error | undefined {
  const fields = [
    "deploymentId",
    "scopeId",
    "executionAuthoritySha256",
    "activationSequence",
    "activeHeadSha256",
    "schemaVersionId",
    "functionPath",
    "functionKind",
    "policyVersion",
    "identityAccessPolicySha256",
    "validatedArgsValueCodecVersion",
    "validatedArgsSha256",
    "requestKey",
    "requestSha256",
    "authorizationRevocationEpoch",
  ] as const satisfies ReadonlyArray<
    ExpectedApplicationMutationGrantLogicalPinFieldV1
  >;
  for (const field of fields) {
    if (payload[field] !== expected[field]) return pinMismatch(field);
  }
  return undefined;
}

function sameCapabilities(
  actual: ReadonlyArray<string>,
  expected: ReadonlyArray<string>,
): boolean {
  return actual.length === expected.length &&
    actual.every((capability, index) => capability === expected[index]);
}

function kernelFailure(
  reason: Exclude<
    ApplicationMutationGrantVerificationKernelV1Issue,
    { readonly reason: "pinMismatch" }
  >["reason"],
): ApplicationMutationGrantVerificationKernelV1Error {
  return new ApplicationMutationGrantVerificationKernelV1Error({
    issue: { reason },
  });
}

function pinMismatch(
  field: ExpectedApplicationMutationGrantLogicalPinFieldV1,
): ApplicationMutationGrantVerificationKernelV1Error {
  return new ApplicationMutationGrantVerificationKernelV1Error({
    issue: { reason: "pinMismatch", field },
  });
}
