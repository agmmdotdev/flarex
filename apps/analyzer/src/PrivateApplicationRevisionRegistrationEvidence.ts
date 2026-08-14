import {
  ApplicationRevisionRegistrationEvidenceV1Error,
  type ApplicationRevisionCandidateEvidenceProjectionV1,
  type ApplicationRevisionRegistrationCommandReceiptV1,
  type ApplicationRevisionRegistrationEvidenceAuthorityV1,
  type PrivateApplicationRevisionAnalysisPreparationV1,
} from
  "@flarex/persistence-postgres/internal/system-test/applicationRevisionRegistrationV1";
import type {
  PreparedStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/v1";
import { Effect, Result } from "effect";

export interface PrivateApplicationRevisionRegistrationEvidenceFailureV1 {
  readonly reason: string;
  readonly path?: string;
}

export interface PrivateApplicationRevisionRegistrationEvidencePortV1<
  Evidence extends object,
  Failure extends PrivateApplicationRevisionRegistrationEvidenceFailureV1,
> {
  readonly issueRegistrationEvidence: (
    request: Request,
    preparation: unknown,
    definition: PreparedStandardApplicationDefinitionV1,
  ) => Effect.Effect<Evidence, Failure, never>;
  readonly bindRegistrationEvidence: (
    evidence: Evidence,
    request: Request,
    result: unknown,
    registrationPreparation: object,
  ) => Result.Result<Evidence, Failure>;
  readonly claimRegistrationCandidate: (
    definition: PreparedStandardApplicationDefinitionV1,
    evidence: unknown,
  ) => Result.Result<ApplicationRevisionCandidateEvidenceProjectionV1, Failure>;
  readonly claimRegistrationCommand: (
    registrationPreparation: object,
    evidence: unknown,
  ) => Result.Result<ApplicationRevisionRegistrationCommandReceiptV1, Failure>;
}

export interface PrivateApplicationRevisionRegistrationEvidenceBridgeV1<
  Evidence extends object,
  Failure extends PrivateApplicationRevisionRegistrationEvidenceFailureV1,
> {
  readonly authority: ApplicationRevisionRegistrationEvidenceAuthorityV1;
  readonly issue: (
    request: Request,
    producerPreparation: unknown,
    definition: PreparedStandardApplicationDefinitionV1,
  ) => Effect.Effect<
    Evidence,
    Failure,
    never
  >;
  readonly bindCommand: (
    evidence: Evidence,
    request: Request,
    producerResult: unknown,
    registrationPreparation: PrivateApplicationRevisionAnalysisPreparationV1,
  ) => Effect.Effect<
    Evidence,
    Failure,
    never
  >;
}

/**
 * Adapts the backend-owned opaque evidence capability to FSV02's existing
 * persistence-owned claim port. Structural callers never receive the claimed
 * projection or either owner's raw session/repository authority.
 */
export function makePrivateApplicationRevisionRegistrationEvidenceBridgeV1<
  Evidence extends object,
  Failure extends PrivateApplicationRevisionRegistrationEvidenceFailureV1,
>(
  backend:
    PrivateApplicationRevisionRegistrationEvidencePortV1<Evidence, Failure>,
): PrivateApplicationRevisionRegistrationEvidenceBridgeV1<
  Evidence,
  Failure
> {
  type Bridge =
    PrivateApplicationRevisionRegistrationEvidenceBridgeV1<Evidence, Failure>;
  const authority: ApplicationRevisionRegistrationEvidenceAuthorityV1 =
    Object.freeze({
      claimCandidate: (
        definition: PreparedStandardApplicationDefinitionV1,
        evidence: unknown,
      ) =>
        backend.claimRegistrationCandidate(definition, evidence).pipe(
          Result.mapError(error =>
            registrationEvidenceClaimError(error, "candidateAuthority")
          ),
        ),
      claimCommand: (
        preparation: PrivateApplicationRevisionAnalysisPreparationV1,
        evidence: unknown,
      ) =>
        backend.claimRegistrationCommand(preparation, evidence).pipe(
          Result.mapError(error =>
            registrationEvidenceClaimError(error, "commandAuthority")
          ),
        ),
    });

  const issue:
    Bridge["issue"] =
      Effect.fn(
        "PrivateApplicationRevisionRegistrationEvidence.issue",
      )((request, producerPreparation, definition) =>
        backend.issueRegistrationEvidence(
          request,
          producerPreparation,
          definition,
        )
      );

  const bindCommand:
    Bridge["bindCommand"] =
      Effect.fn(
        "PrivateApplicationRevisionRegistrationEvidence.bindCommand",
      )((evidence, request, producerResult, registrationPreparation) =>
        Effect.fromResult(backend.bindRegistrationEvidence(
          evidence,
          request,
          producerResult,
          registrationPreparation,
        ))
      );

  return Object.freeze({ authority, issue, bindCommand });
}

function registrationEvidenceClaimError(
  error: PrivateApplicationRevisionRegistrationEvidenceFailureV1,
  fallbackPath: "candidateAuthority" | "commandAuthority",
): ApplicationRevisionRegistrationEvidenceV1Error {
  return new ApplicationRevisionRegistrationEvidenceV1Error({
    reason:
      error.reason === "contentMismatch" ||
        error.reason === "commitmentMismatch"
        ? "authenticatedCorrelationMismatch"
        : "authorityChanged",
    path: error.path ?? fallbackPath,
  });
}
