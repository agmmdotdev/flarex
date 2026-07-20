import { copyBytes } from "@flarex/utils/bytes";
import { Data, Effect } from "effect";
import type {
  GrantRetentionPolicyV1,
} from "flarex-protocol/grant-retention-policy";

import type {
  PointMutationGrantLogicalPinsV1,
} from "flarex-protocol/point-mutation-start";
import {
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantTimestampV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1Effect,
  deriveInertTransactionGrantEvidenceV1Effect,
  isTransactionGrantEpochMillisecondsV1,
  type InertTransactionGrantEvidenceV1,
  type TransactionGrantDeploymentIdV1,
  type TransactionGrantKeyIdV1,
  type TransactionGrantPayloadV1,
} from "flarex-protocol/transaction-grant";

export type ExpectedTransactionGrantLogicalPinsV1 =
  PointMutationGrantLogicalPinsV1;
export type ExpectedTransactionGrantLogicalPinFieldV1 =
  keyof ExpectedTransactionGrantLogicalPinsV1;

export type TransactionGrantVerificationV1Issue =
  | { readonly reason: "malformedEvidence" }
  | { readonly reason: "invalidPreparedStart" }
  | { readonly reason: "unknownKey" }
  | { readonly reason: "disabledKey" }
  | { readonly reason: "unissuableKey" }
  | { readonly reason: "signatureInvalid" }
  | { readonly reason: "cryptographicVerificationFailed" }
  | { readonly reason: "invalidClockReading" }
  | { readonly reason: "issuedInFuture" }
  | { readonly reason: "expired" }
  | { readonly reason: "lifetimeExceeded" }
  | { readonly reason: "keyWindowMismatch" }
  | { readonly reason: "keyRetentionExpired" }
  | { readonly reason: "policyMismatch" }
  | { readonly reason: "policyDigestMismatch" }
  | {
      readonly reason: "pinMismatch";
      readonly field: ExpectedTransactionGrantLogicalPinFieldV1;
    };

export class TransactionGrantVerificationV1Error extends Data.TaggedError(
  "TransactionGrantVerificationV1Error",
)<{
  readonly issue: TransactionGrantVerificationV1Issue;
}> {}

export interface VerifiedTransactionGrantInspectionV1 {
  readonly evidence: InertTransactionGrantEvidenceV1;
  readonly verificationKeyId: TransactionGrantKeyIdV1;
  readonly verifiedAt: TransactionGrantPayloadV1["issuedAt"];
}

interface VerificationKeyBaseV1 {
  readonly kid: TransactionGrantKeyIdV1;
}

export type TransactionGrantVerificationKernelKeyV1 =
  | (VerificationKeyBaseV1 & {
      readonly state: "active";
      readonly issuedAtInclusiveEpochMilliseconds: number;
      readonly issuedAtExclusiveEpochMilliseconds?: number;
      readonly verificationEndsAtExclusiveEpochMilliseconds?: number;
      readonly verify: (
        signingInput: Uint8Array,
        signature: Uint8Array,
      ) => Promise<boolean>;
    })
  | (VerificationKeyBaseV1 & {
      readonly state: "verifyOnly";
      readonly phase: "prepublished";
      readonly verify: (
        signingInput: Uint8Array,
        signature: Uint8Array,
      ) => Promise<boolean>;
    })
  | (VerificationKeyBaseV1 & {
      readonly state: "verifyOnly";
      readonly phase: "retired";
      readonly issuedAtInclusiveEpochMilliseconds: number;
      readonly issuedAtExclusiveEpochMilliseconds: number;
      readonly verificationEndsAtExclusiveEpochMilliseconds: number;
      readonly verify: (
        signingInput: Uint8Array,
        signature: Uint8Array,
      ) => Promise<boolean>;
    })
  | (VerificationKeyBaseV1 & {
      readonly state: "disabled";
    });

export interface TransactionGrantVerificationKernelV1Config {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly keysById: ReadonlyMap<string, TransactionGrantVerificationKernelKeyV1>;
  readonly grantRetentionPolicy: GrantRetentionPolicyV1;
}

export interface VerifyTransactionGrantKernelV1Input {
  readonly jws: unknown;
  readonly expectedLogicalPins: ExpectedTransactionGrantLogicalPinsV1;
  readonly trustedNowEpochMilliseconds: Effect.Effect<
    number,
    TransactionGrantVerificationV1Error
  >;
}

export interface TransactionGrantVerificationKernelV1 {
  readonly verify: (
    input: VerifyTransactionGrantKernelV1Input,
  ) => Effect.Effect<
    VerifiedTransactionGrantInspectionV1,
    TransactionGrantVerificationV1Error
  >;
}

const kernelByPublicVerifier = new WeakMap<
  object,
  TransactionGrantVerificationKernelV1
>();

export function createTransactionGrantVerificationKernelV1(
  config: TransactionGrantVerificationKernelV1Config,
): TransactionGrantVerificationKernelV1 {
  const verify = Effect.fn("TransactionGrantVerification.verify")(
    function* (input: VerifyTransactionGrantKernelV1Input) {
      if (input.expectedLogicalPins.deploymentId !== config.deploymentId) {
        return yield* Effect.fail(pinMismatch("deploymentId"));
      }

      const evidence = yield* deriveInertTransactionGrantEvidenceV1Effect(
        input.jws,
      ).pipe(
        Effect.mapError(() => verificationFailure("malformedEvidence")),
      );
      const key = config.keysById.get(evidence.protectedHeader.kid);
      if (key === undefined) {
        return yield* Effect.fail(verificationFailure("unknownKey"));
      }
      if (key.state === "disabled") {
        return yield* Effect.fail(verificationFailure("disabledKey"));
      }
      if (key.state === "verifyOnly" && key.phase === "prepublished") {
        return yield* Effect.fail(verificationFailure("unissuableKey"));
      }

      const signatureValid = yield* Effect.tryPromise({
        try: () => key.verify(
          copyBytes(evidence.signingInput),
          copyBytes(evidence.signatureBytes),
        ),
        catch: () => verificationFailure("cryptographicVerificationFailed"),
      });
      if (!signatureValid) {
        return yield* Effect.fail(verificationFailure("signatureInvalid"));
      }

      const nowEpochMilliseconds = yield* input.trustedNowEpochMilliseconds;
      if (!isTransactionGrantEpochMillisecondsV1(nowEpochMilliseconds)) {
        return yield* Effect.fail(verificationFailure("invalidClockReading"));
      }
      const verifiedAt = yield* Effect.try({
        try: () => TransactionGrantTimestampV1Schema.make(
          new Date(nowEpochMilliseconds).toISOString(),
        ),
        catch: () => verificationFailure("invalidClockReading"),
      });
      const issuedAtEpochMilliseconds = Date.parse(evidence.payload.issuedAt);
      const expiresAtEpochMilliseconds = Date.parse(evidence.payload.expiresAt);
      if (
        issuedAtEpochMilliseconds >
          nowEpochMilliseconds +
            config.grantRetentionPolicy.maximumFutureIssuedAtSkewMilliseconds
      ) {
        return yield* Effect.fail(verificationFailure("issuedInFuture"));
      }
      if (expiresAtEpochMilliseconds <= nowEpochMilliseconds) {
        return yield* Effect.fail(verificationFailure("expired"));
      }
      if (
        expiresAtEpochMilliseconds - issuedAtEpochMilliseconds >
          config.grantRetentionPolicy.maximumGrantLifetimeMilliseconds
      ) {
        return yield* Effect.fail(verificationFailure("lifetimeExceeded"));
      }
      const keyWindowFailure = keyWindowIssue(
        key,
        issuedAtEpochMilliseconds,
        expiresAtEpochMilliseconds,
        nowEpochMilliseconds,
      );
      if (keyWindowFailure !== undefined) {
        return yield* Effect.fail(keyWindowFailure);
      }
      yield* enforcePointMutationPolicyEffect(evidence.payload);
      const pinsFailure = compareExpectedPins(
        evidence.payload,
        input.expectedLogicalPins,
      );
      if (pinsFailure !== undefined) {
        return yield* Effect.fail(pinsFailure);
      }

      return Object.freeze({
        evidence,
        verificationKeyId: key.kid,
        verifiedAt,
      } satisfies VerifiedTransactionGrantInspectionV1);
    },
  );
  return Object.freeze({ verify });
}

export function registerTransactionGrantVerificationKernelV1(
  publicVerifier: object,
  kernel: TransactionGrantVerificationKernelV1,
): void {
  kernelByPublicVerifier.set(publicVerifier, kernel);
}

export function findTransactionGrantVerificationKernelV1(
  publicVerifier: object,
): TransactionGrantVerificationKernelV1 | undefined {
  return kernelByPublicVerifier.get(publicVerifier);
}

const enforcePointMutationPolicyEffect = Effect.fn(
  "TransactionGrantVerification.enforcePointMutationPolicy",
)(function* (payload: TransactionGrantPayloadV1) {
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
    return yield* Effect.fail(verificationFailure("policyMismatch"));
  }

  const policyEvidence = yield*
    canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({
      policyVersion: payload.policyVersion,
      auth: payload.auth,
      capabilities: payload.capabilities,
    }).pipe(Effect.mapError(() => verificationFailure("policyMismatch")));
  if (policyEvidence.sha256Hex !== payload.identityAccessPolicySha256) {
    return yield* Effect.fail(verificationFailure("policyDigestMismatch"));
  }
});

function keyWindowIssue(
  key: Exclude<
    TransactionGrantVerificationKernelKeyV1,
    | { readonly state: "disabled" }
    | { readonly state: "verifyOnly"; readonly phase: "prepublished" }
  >,
  issuedAtEpochMilliseconds: number,
  expiresAtEpochMilliseconds: number,
  nowEpochMilliseconds: number,
): TransactionGrantVerificationV1Error | undefined {
  if (
    issuedAtEpochMilliseconds < key.issuedAtInclusiveEpochMilliseconds ||
    (key.issuedAtExclusiveEpochMilliseconds !== undefined &&
      issuedAtEpochMilliseconds >= key.issuedAtExclusiveEpochMilliseconds)
  ) {
    return verificationFailure("keyWindowMismatch");
  }
  const verificationEnd = key.verificationEndsAtExclusiveEpochMilliseconds;
  if (
    verificationEnd !== undefined &&
    (expiresAtEpochMilliseconds > verificationEnd ||
      nowEpochMilliseconds >= verificationEnd)
  ) {
    return verificationFailure("keyRetentionExpired");
  }
  return undefined;
}

function compareExpectedPins(
  payload: TransactionGrantPayloadV1,
  expected: ExpectedTransactionGrantLogicalPinsV1,
): TransactionGrantVerificationV1Error | undefined {
  const fields = [
    "deploymentId",
    "scopeId",
    "packageId",
    "artifactRuntime",
    "artifactId",
    "sourcePackageHash",
    "executionModule",
    "functionPath",
    "functionKind",
    "schemaVersionId",
    "validatedArgsValueCodecVersion",
    "validatedArgsSha256",
    "requestKey",
    "requestSha256",
    "authorizationRevocationEpoch",
  ] as const satisfies ReadonlyArray<ExpectedTransactionGrantLogicalPinFieldV1>;
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

export function verificationFailure(
  reason: Exclude<
    TransactionGrantVerificationV1Issue,
    { readonly reason: "pinMismatch" }
  >["reason"],
): TransactionGrantVerificationV1Error {
  return new TransactionGrantVerificationV1Error({ issue: { reason } });
}

function pinMismatch(
  field: ExpectedTransactionGrantLogicalPinFieldV1,
): TransactionGrantVerificationV1Error {
  return new TransactionGrantVerificationV1Error({
    issue: { reason: "pinMismatch", field },
  });
}
