import { copyBytes } from "@flarex/utils/bytes";
import { sourceArtifactV2DigestBytesFromLowerHex } from "../sourceArtifactV2/Digest";
import { Data, Effect, Result } from "effect";
import type {
  DeploymentProjectScopeAuthorizationInputV1,
  DeploymentProjectScopeAuthorizationV1Error,
  DeploymentProjectScopeAuthorizerV1,
} from "../deploymentProjectScopeAuthorization";
import type {
  SourceArtifactV2FinalizedAttemptReadComposerInputV1,
  SourceArtifactV2FinalizedAttemptReadComposerV1,
  SourceArtifactV2FinalizedAttemptReadComposerV1Error,
} from "../sourceArtifactV2/FinalizedAttemptReadComposer";

const PROOF_MARKER = Symbol("SemanticArtifactV1FinalizedSourceProof");

export interface SemanticArtifactV1FinalizedSourceProof {
  readonly [PROOF_MARKER]: true;
}

export interface SemanticArtifactV1ClaimedFinalizedSource {
  readonly projectId: string;
  readonly deploymentId: string;
  readonly deploymentCreatedAt: string;
  readonly sourceUploadId: string;
  readonly sourceGeneration: number;
  readonly sourceMutationFence: number;
  readonly sourceRootSha256: Uint8Array;
  readonly sourceSelectorSha256: Uint8Array;
}

export interface SemanticArtifactV1FinalizedSourceProofInput {
  readonly authorization: DeploymentProjectScopeAuthorizationInputV1;
  readonly source: SourceArtifactV2FinalizedAttemptReadComposerInputV1;
}

export type SemanticArtifactV1FinalizedSourceProofIssueError =
  | DeploymentProjectScopeAuthorizationV1Error
  | SourceArtifactV2FinalizedAttemptReadComposerV1Error;

export class SemanticArtifactV1FinalizedSourceProofClaimError extends Data.TaggedError(
  "SemanticArtifactV1FinalizedSourceProofClaimError",
)<{
  readonly reason:
    | "invalidProof"
    | "wrongRequest"
    | "wrongDeployment"
    | "alreadyClaimed"
    | "invalidStoredDigest";
}> {}

export interface SemanticArtifactV1FinalizedSourceProofFactory {
  readonly issue: (
    request: Request,
    input: SemanticArtifactV1FinalizedSourceProofInput,
  ) => Effect.Effect<
    SemanticArtifactV1FinalizedSourceProof,
    SemanticArtifactV1FinalizedSourceProofIssueError
  >;
  readonly claim: (
    proof: unknown,
    request: Request,
    deploymentId: string,
  ) => Result.Result<
    SemanticArtifactV1ClaimedFinalizedSource,
    SemanticArtifactV1FinalizedSourceProofClaimError
  >;
}

interface ProofEvidence {
  readonly issuer: object;
  readonly request: Request;
  readonly value: SemanticArtifactV1ClaimedFinalizedSource;
}

export function makeSemanticArtifactV1FinalizedSourceProofFactory(options: {
  readonly authorizer: DeploymentProjectScopeAuthorizerV1;
  readonly finalizedSourceReader: SourceArtifactV2FinalizedAttemptReadComposerV1;
}): SemanticArtifactV1FinalizedSourceProofFactory {
  const issuer = Object.freeze({});
  const evidenceByProof = new WeakMap<object, ProofEvidence>();
  const claimedProofs = new WeakSet<object>();

  const issue = Effect.fn("SemanticArtifactV1FinalizedSourceProof.issue")(
    function* (
      request: Request,
      input: SemanticArtifactV1FinalizedSourceProofInput,
    ): Effect.fn.Return<
      SemanticArtifactV1FinalizedSourceProof,
      SemanticArtifactV1FinalizedSourceProofIssueError
    > {
      const witness = yield* options.authorizer.authorize(request, input.authorization);
      const evidence = yield* options.finalizedSourceReader.read(
        request,
        witness,
        input.source,
      );
      const root = sourceArtifactV2DigestBytesFromLowerHex(evidence.completedRootDigest);
      const selector = sourceArtifactV2DigestBytesFromLowerHex(evidence.completedSelectorDigest);
      const proof = Object.freeze(Object.defineProperty({}, PROOF_MARKER, {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
      })) as SemanticArtifactV1FinalizedSourceProof;
      evidenceByProof.set(proof, Object.freeze({
        issuer,
        request,
        value: Object.freeze({
          projectId: evidence.projectId,
          deploymentId: evidence.deploymentId,
          deploymentCreatedAt: evidence.deploymentCreatedAt,
          sourceUploadId: evidence.uploadId,
          sourceGeneration: evidence.generation,
          sourceMutationFence: evidence.mutationFence,
          sourceRootSha256: copyBytes(root),
          sourceSelectorSha256: copyBytes(selector),
        }),
      }));
      return proof;
    },
  );

  const claim = (
    proof: unknown,
    request: Request,
    deploymentId: string,
  ): Result.Result<
    SemanticArtifactV1ClaimedFinalizedSource,
    SemanticArtifactV1FinalizedSourceProofClaimError
  > => {
    if (typeof proof !== "object" || proof === null) return claimFailure("invalidProof");
    const evidence = evidenceByProof.get(proof);
    if (evidence === undefined || evidence.issuer !== issuer) {
      return claimFailure("invalidProof");
    }
    if (claimedProofs.has(proof)) return claimFailure("alreadyClaimed");
    if (evidence.request !== request) return claimFailure("wrongRequest");
    if (evidence.value.deploymentId !== deploymentId) {
      return claimFailure("wrongDeployment");
    }
    claimedProofs.add(proof);
    return Result.succeed(Object.freeze({
      ...evidence.value,
      sourceRootSha256: copyBytes(evidence.value.sourceRootSha256),
      sourceSelectorSha256: copyBytes(evidence.value.sourceSelectorSha256),
    }));
  };

  return Object.freeze({ issue, claim });
}

function claimFailure(
  reason: SemanticArtifactV1FinalizedSourceProofClaimError["reason"],
): Result.Result<never, SemanticArtifactV1FinalizedSourceProofClaimError> {
  return Result.fail(new SemanticArtifactV1FinalizedSourceProofClaimError({ reason }));
}
