import { Data, Effect, Schema } from "effect";
import { bytesEqual } from "@flarex/utils/bytes";
import { readFiniteRecoveryAttempt, type FiniteRecoveryAttempt } from "@flarex/persistence-postgres/transaction-session-activation";
import { canonicalizeApplicationMutationExecutionAuthorityV1 } from "flarex-protocol/internal/application-mutation-authority-v1";
import { deriveInertApplicationMutationGrantEvidenceV1 } from "flarex-protocol/internal/application-mutation-grant-v1";
import { TransactionExecutionClaimFenceV1Schema } from "@flarex/persistence-postgres/transaction-execution-claim";
import type { ActivatedApplicationMutationSessionPreparationV1 } from "./pointMutationSessionActivationState";
import { captureInitialSessionScalars } from "./storedAttemptAuthentication/initialPointMutationExecutionOperations";
import { captureCommitInputAuthorityPins } from "./storedAttemptAuthentication/commitInputVerification";
import { capturePointCommitAuthorityPins, capturePointCommitSessionScalars } from "./storedAttemptAuthentication/pointCommitRuntimeModel";
import type { CommitAuthorityVerificationStateV1 } from "./storedAttemptAuthentication/commitAuthorityVerification";
import { verifyStoredMutationArguments } from "./storedAttemptAuthentication/commitAuthorityVerification";

const decodeClaimFenceResult = Schema.decodeUnknownResult(TransactionExecutionClaimFenceV1Schema);

export class FiniteRecoveryEvidenceError extends Data.TaggedError("FiniteRecoveryEvidenceError")<{
  readonly reason: "invalidStoredEvidence";
  readonly cause?: unknown;
}> {}

/** Decode the admitted request for correlation. Signature verification and
 * fresh replacement admission still precede any callback execution. */
export const captureFiniteRecoveryEvidence = Effect.fn("FinitePointMutationRecovery.capture")(
  function* (capture: FiniteRecoveryAttempt) {
    const context = yield* Effect.fromResult(readFiniteRecoveryAttempt(capture));
    const row = context.session;
    if (row.executionAuthorityGeneration !== "application_v1" || row.functionKind !== "mutation" || row.validatedArgsJson === null ||
      row.validatedArgsCanonicalBytes === null || row.authorizationGrantJson === null || row.authorizationGrantCanonicalBytes === null || row.applicationExecutionAuthorityJson === null ||
      row.applicationExecutionAuthorityCanonicalBytes === null || row.applicationExecutionAuthoritySha256 === null)
      return yield* Effect.fail(new FiniteRecoveryEvidenceError({ reason: "invalidStoredEvidence" }));
    const executionAuthority = yield* canonicalizeApplicationMutationExecutionAuthorityV1(row.applicationExecutionAuthorityJson)
      .pipe(Effect.mapError(cause => new FiniteRecoveryEvidenceError({ reason: "invalidStoredEvidence", cause })));
    if (!bytesEqual(executionAuthority.canonicalBytes, row.applicationExecutionAuthorityCanonicalBytes) ||
      !bytesEqual(executionAuthority.sha256, row.applicationExecutionAuthoritySha256) ||
      executionAuthority.authority.runtimeTarget.scopeId !== context.anchor.scopeId ||
      executionAuthority.authority.runtimeTarget.function.path !== row.functionPath ||
      executionAuthority.authority.schemaVersionId !== context.executionPin.schemaVersionId)
      return yield* Effect.fail(new FiniteRecoveryEvidenceError({ reason: "invalidStoredEvidence" }));
    const grant = yield* deriveInertApplicationMutationGrantEvidenceV1(row.authorizationGrantJson)
      .pipe(Effect.mapError(cause => new FiniteRecoveryEvidenceError({ reason: "invalidStoredEvidence", cause })));
    yield* verifyStoredMutationArguments({ validatedArgsJson: row.validatedArgsJson,
      validatedArgsValueCodecVersion: row.validatedArgsValueCodecVersion, validatedArgsCanonicalBytes: row.validatedArgsCanonicalBytes,
      validatedArgsCanonicalByteLength: row.validatedArgsCanonicalBytes.byteLength, validatedArgsSha256: row.validatedArgsSha256 });
    const prepared = Object.freeze({ executionAuthorityGeneration: "application_v1", deploymentId: context.anchor.deploymentId,
      scopeId: context.anchor.scopeId, evidence: { functionPath: row.functionPath, functionKind: row.functionKind,
        schemaVersionId: context.executionPin.schemaVersionId, policyVersion: row.policyVersion,
        identityAccessPolicySha256: row.identityAccessPolicySha256, validatedArgsJson: row.validatedArgsJson,
        validatedArgsValueCodecVersion: row.validatedArgsValueCodecVersion, validatedArgsCanonicalBytes: row.validatedArgsCanonicalBytes,
        validatedArgsSha256: row.validatedArgsSha256, requestKey: row.requestKey, requestSha256: row.requestSha256,
        executionAuthority, grant } } satisfies ActivatedApplicationMutationSessionPreparationV1);
    const session = yield* Effect.fromResult(captureInitialSessionScalars(context.anchor, prepared.evidence));
    const verification = Object.freeze({ authority: { deploymentId: context.anchor.deploymentId, scopeId: context.anchor.scopeId,
      sessionId: context.anchor.sessionId, attemptFence: context.anchor.attemptFence, storageGeneration: context.anchor.storageGeneration,
      storageGenerationFence: context.anchor.storageGenerationFence, snapshotToken: context.anchor.snapshotToken,
      schemaVersionId: context.executionPin.schemaVersionId }, session } satisfies CommitAuthorityVerificationStateV1);
    // The retrying row records the resolver's one-step fence of the original
    // execution owner. Resolution authenticates that predecessor against the
    // same stable anchor before it reconstructs a nonacceptance proof.
    const claimFence = context.session.lifecycle === "retrying"
      ? yield* Effect.fromResult(decodeClaimFenceResult(context.executionClaim.claimFence - 1n)).pipe(
        Effect.mapError(cause => new FiniteRecoveryEvidenceError({ reason: "invalidStoredEvidence", cause })))
      : context.executionClaim.claimFence;
    return Object.freeze({ context, prepared, verification,
      command: { authorityPins: capturePointCommitAuthorityPins(captureCommitInputAuthorityPins(verification.authority, session)),
        session: capturePointCommitSessionScalars(session), executionClaim: { ...context.executionClaim, claimFence } } });
  });
