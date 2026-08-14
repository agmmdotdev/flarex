import type {
  ApplicationAnalysisHostRequest,
  ApplicationAnalysisHostResult,
} from "./ApplicationAnalysisHost";
import {
  APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
  APPLICATION_ANALYSIS_POLICY_IDENTITY,
} from "./ApplicationAnalysisHost";
import type {
  ApplicationAnalysisAuthority,
  ApplicationAnalysisPersistenceError,
  ApplicationAnalysisProjection,
  ApplicationAnalysisRepository,
  ApplicationAnalysisTerminalInput,
} from "@flarex/persistence-postgres/internal/application-analysis-registration";
import type {
  StandardApplicationAnalysis,
  StandardApplicationAnalysisContext,
  StandardApplicationAnalysisInput,
} from "@flarex/standard-application-analysis/application";
import { Data, Effect, Result } from "effect";

export class ApplicationAnalysisCompositionError extends Data.TaggedError(
  "ApplicationAnalysisCompositionError",
)<{
  readonly reason:
    | "hostFailed"
    | "hostResultMismatch"
    | "invalidProjection";
  readonly cause?: unknown;
}> {}

export type ApplicationAnalysisCompositionFailure<HostFailure> =
  | ApplicationAnalysisPersistenceError
  | ApplicationAnalysisCompositionError
  | HostFailure;

export interface ApplicationAnalysisHostPort<HostFailure, Requirements = never> {
  readonly analyze: (
    request: ApplicationAnalysisHostRequest,
  ) => Effect.Effect<ApplicationAnalysisHostResult, HostFailure, Requirements>;
}

/**
 * Composes the trusted cold host with first-terminal durable registration.
 *
 * This is deliberately an injected private seam. It does not own a route,
 * binding, deployment, caller, fallback, or comparison execution.
 */
export function makeApplicationAnalysisContext<
  HostFailure,
  Requirements = never,
>(options: Readonly<{
  readonly authority: ApplicationAnalysisAuthority;
  readonly repository: ApplicationAnalysisRepository;
  readonly host: ApplicationAnalysisHostPort<HostFailure, Requirements>;
}>): StandardApplicationAnalysisContext<
  ApplicationAnalysisCompositionFailure<HostFailure>,
  Requirements
> {
  const authority = Object.freeze({ ...options.authority });
  const repository = options.repository;
  const host = options.host;

  const analyze = Effect.fn("ApplicationAnalysisComposition.analyze")(
    function* (input: StandardApplicationAnalysisInput) {
      const admitted = yield* repository.begin({
        authority,
        requestKey: input.requestKey,
        sourceArtifactRootSha256: input.sourceArtifactRootSha256,
        analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
        analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
      });
      const replay = yield* Effect.fromResult(projectTerminal(admitted));
      if (replay !== undefined) return replay;

      const request = Object.freeze({
        format: "flarex.application-analysis-host-request" as const,
        version: 1 as const,
        sourceArtifactRootSha256: admitted.sourceArtifactRootSha256,
        analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
        analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
      });
      const hostResult = yield* host.analyze(request);
      if (hostResult.kind === "failed") {
        return yield* new ApplicationAnalysisCompositionError({
          reason: "hostFailed",
          cause: hostResult.reason,
        });
      }
      if (
        hostResult.sourceArtifactRootSha256 !==
          admitted.sourceArtifactRootSha256 ||
        hostResult.analyzerIdentity !== APPLICATION_ANALYSIS_ANALYZER_IDENTITY ||
        hostResult.analyzerPolicyIdentity !==
          APPLICATION_ANALYSIS_POLICY_IDENTITY
      ) {
        return yield* new ApplicationAnalysisCompositionError({
          reason: "hostResultMismatch",
        });
      }

      const terminal: ApplicationAnalysisTerminalInput =
        hostResult.kind === "analyzed"
          ? Object.freeze({
            kind: "analyzed",
            candidateId: admitted.candidateId,
            sourceArtifactRootSha256: admitted.sourceArtifactRootSha256,
            analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
            analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
            canonicalManifest: hostResult.canonicalManifest,
          })
          : Object.freeze({
            kind: "rejected",
            candidateId: admitted.candidateId,
            sourceArtifactRootSha256: admitted.sourceArtifactRootSha256,
            analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
            analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
            failureCode: hostResult.failureCode,
            detail: hostResult.detail,
          });
      const settled = yield* repository.settle(authority, terminal);
      const result = yield* Effect.fromResult(projectTerminal(settled));
      if (result === undefined) {
        return yield* new ApplicationAnalysisCompositionError({
          reason: "invalidProjection",
        });
      }
      return result;
    },
  );

  return Object.freeze({ analyze });
}

function projectTerminal(
  projection: ApplicationAnalysisProjection,
): Result.Result<
  StandardApplicationAnalysis | undefined,
  ApplicationAnalysisCompositionError
> {
  switch (projection.status) {
    case "pending":
      return Result.succeed(undefined);
    case "analyzed":
      return projection.receipt.status === "analyzed"
        ? Result.succeed(Object.freeze({
          kind: "analyzed",
          receipt: projection.receipt,
          manifest: projection.manifest,
        }))
        : Result.fail(new ApplicationAnalysisCompositionError({
          reason: "invalidProjection",
        }));
    case "rejected":
      return projection.receipt.status === "rejected"
        ? Result.succeed(Object.freeze({
          kind: "rejected",
          receipt: projection.receipt,
        }))
        : Result.fail(new ApplicationAnalysisCompositionError({
          reason: "invalidProjection",
        }));
  }
}
