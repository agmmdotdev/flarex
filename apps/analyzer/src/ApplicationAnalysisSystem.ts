import {
  type ApplicationAnalysisProjection,
  type ApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
  ApplicationAnalysisPersistenceError,
} from "@flarex/persistence-postgres/internal/application-analysis-registration";
import {
  type StandardApplicationAnalysis,
  type StandardApplicationAnalysisContext,
} from "@flarex/standard-application-analysis/application";
import { Data, Effect, Result } from "effect";

import {
  APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
  APPLICATION_ANALYSIS_POLICY_IDENTITY,
  applicationAnalysisHostEffectWithCapabilities,
  type ApplicationAnalysisHostCapabilities,
  type ApplicationAnalysisHostError,
  type ApplicationAnalysisHostResult,
} from "./ApplicationAnalysisHost";

export class ApplicationAnalysisSystemError extends Data.TaggedError(
  "ApplicationAnalysisSystemError",
)<{
  readonly reason: "hostFailed" | "settlementInvalid";
  readonly hostReason?: Extract<
    ApplicationAnalysisHostResult,
    { readonly kind: "failed" }
  >["reason"];
}> {}

export type ApplicationAnalysisSystemFailure =
  | ApplicationAnalysisPersistenceError
  | ApplicationAnalysisHostError
  | ApplicationAnalysisSystemError;

/**
 * Private, production-inert composition of durable Application Analysis with
 * the trusted cold-load host. Terminal durable state always wins replay; the
 * host runs only while the exact admitted candidate remains pending.
 */
export function makeApplicationAnalysisSystem(options: Readonly<{
  readonly authority: ApplicationAnalysisAuthority;
  readonly repository: ApplicationAnalysisRepository;
  readonly host: ApplicationAnalysisHostCapabilities;
}>): StandardApplicationAnalysisContext<ApplicationAnalysisSystemFailure> {
  const authority = Object.freeze({ ...options.authority });
  const repository = options.repository;
  const host = options.host;

  const analyze = Effect.fn("ApplicationAnalysisSystem.analyze")(function* (
    input,
  ): Effect.fn.Return<
    StandardApplicationAnalysis,
    ApplicationAnalysisSystemFailure
  > {
    const admitted = yield* repository.begin({
      authority,
      requestKey: input.requestKey,
      sourceArtifactRootSha256: input.sourceArtifactRootSha256,
      analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
      analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
    });
    if (admitted.status !== "pending") {
      return yield* Effect.fromResult(projectTerminal(admitted));
    }

    const hosted = yield* applicationAnalysisHostEffectWithCapabilities(host, {
      format: "flarex.application-analysis-host-request",
      version: 1,
      sourceArtifactRootSha256: admitted.sourceArtifactRootSha256,
      analyzerIdentity: admitted.analyzerIdentity,
      analyzerPolicyIdentity: admitted.analyzerPolicyIdentity,
    });
    if (hosted.kind === "failed") {
      return yield* new ApplicationAnalysisSystemError({
        reason: "hostFailed",
        hostReason: hosted.reason,
      });
    }
    const settled = yield* repository.settle(authority, hosted.kind === "analyzed"
      ? {
          kind: "analyzed",
          candidateId: admitted.candidateId,
          sourceArtifactRootSha256: hosted.sourceArtifactRootSha256,
          analyzerIdentity: hosted.analyzerIdentity,
          analyzerPolicyIdentity: hosted.analyzerPolicyIdentity,
          canonicalManifest: hosted.canonicalManifest,
        }
      : {
          kind: "rejected",
          candidateId: admitted.candidateId,
          sourceArtifactRootSha256: hosted.sourceArtifactRootSha256,
          analyzerIdentity: hosted.analyzerIdentity,
          analyzerPolicyIdentity: hosted.analyzerPolicyIdentity,
          failureCode: hosted.failureCode,
          detail: hosted.detail,
        });
    return yield* settled.status === "pending"
      ? new ApplicationAnalysisSystemError({ reason: "settlementInvalid" })
      : Effect.fromResult(projectTerminal(settled));
  });

  return Object.freeze({ analyze });
}

function projectTerminal(
  projection: Exclude<ApplicationAnalysisProjection, { readonly status: "pending" }>,
): Result.Result<StandardApplicationAnalysis, ApplicationAnalysisSystemError> {
  if (projection.status === "analyzed") {
    return projection.receipt.status === "analyzed"
      ? Result.succeed(Object.freeze({
        kind: "analyzed",
        receipt: projection.receipt,
        manifest: projection.manifest,
      }))
      : invalidSettlement();
  }
  return projection.receipt.status === "rejected"
    ? Result.succeed(Object.freeze({
        kind: "rejected",
        receipt: projection.receipt,
      }))
    : invalidSettlement();
}

function invalidSettlement(): Result.Result<
  never,
  ApplicationAnalysisSystemError
> {
  return Result.fail(new ApplicationAnalysisSystemError({
    reason: "settlementInvalid",
  }));
}
