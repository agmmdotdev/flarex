import { copyBytes } from "@flarex/utils/bytes";
import {
  admitDirectActionInvocationV1,
  confirmExternalEffectAttemptV1,
  prepareExternalEffectAttemptV1,
  settleDirectActionInvocationV1,
  type ApplicationActionAuthorityContextV1,
  type ApplicationActionAuthorityV1Error,
  type ApplicationActionInvocationProjectionV1,
  type DirectActionExecutionSubjectCapabilityV1,
  type ExternalEffectAttemptProjectionV1,
} from "@flarex/persistence-postgres/internal/application-action-authority-v1";
import {
  claimApplicationRevisionActionRuntimeTargetAuthorityV1,
  type ClaimApplicationRevisionActionRuntimeTargetAuthorityV1Error,
} from "@flarex/persistence-postgres/internal/application-revision-action-runtime-target-v1";
import type {
  AuthenticatedActiveApplicationRevisionSelectionV1,
} from "@flarex/persistence-postgres/internal/application-revision-activation-v1";
import type {
  ExecutionEvidenceBodyBudgetV1,
  ExecutionEvidenceBodyStoreV1,
  ExecutionEvidenceBodyStoreV1Error,
} from "flarex-backend/internal/execution-evidence-body-r2-v1";
import { Effect } from "effect";
import {
  encodeApplicationActionInvocationRequestV1,
  type ExecutionEvidenceProtocolV1Error,
} from "flarex-protocol/internal/execution-evidence-v1";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";

export interface AdmitActiveApplicationActionV1Input {
  readonly selection: AuthenticatedActiveApplicationRevisionSelectionV1;
  readonly functionPath: string;
  readonly requestKey: string;
  readonly invocationId: string;
  readonly arguments: CanonicalFlarexValueV1;
  readonly executionIdentitySha256: Uint8Array;
  readonly compatibilityDate: string;
  readonly hostPolicySha256: Uint8Array;
}

export interface ActiveApplicationActionAdmissionLiveV1<
  HashError,
  CanonicalError,
> {
  readonly bodyStore: ExecutionEvidenceBodyStoreV1<HashError, CanonicalError>;
  readonly argumentBudget: ExecutionEvidenceBodyBudgetV1;
  readonly authority: Omit<ApplicationActionAuthorityContextV1<HashError>, "authority">;
}

export type AdmitActiveApplicationActionV1Error<
  HashError,
  CanonicalError,
> =
  | ClaimApplicationRevisionActionRuntimeTargetAuthorityV1Error
  | ExecutionEvidenceProtocolV1Error
  | ExecutionEvidenceBodyStoreV1Error<HashError, CanonicalError>
  | ApplicationActionAuthorityV1Error<HashError>;

export interface AdmittedActiveApplicationActionV1 {
  readonly disposition: "inserted" | "replayed";
  readonly invocation: ApplicationActionInvocationProjectionV1;
}

export interface ActiveApplicationActionEvidenceLiveV1<
  HashError,
  CanonicalError,
> {
  readonly bodyStore: ExecutionEvidenceBodyStoreV1<HashError, CanonicalError>;
  readonly bodyBudget: ExecutionEvidenceBodyBudgetV1;
  readonly authority: ApplicationActionAuthorityContextV1<HashError>;
}

export type ActiveApplicationActionEvidenceV1Error<HashError, CanonicalError> =
  | ExecutionEvidenceBodyStoreV1Error<HashError, CanonicalError>
  | ApplicationActionAuthorityV1Error<HashError>;

/**
 * Private route-independent AAV-A1 admission composition. R2 publication and
 * canonical verification complete before the short PostgreSQL transaction.
 * It issues no runtime dispatch and cannot activate or route an application.
 */
export const admitActiveApplicationActionV1 = Effect.fn(
  "ActiveApplicationActionAdmission.admitV1",
)(function* <HashError, CanonicalError>(
  input: AdmitActiveApplicationActionV1Input,
  live: ActiveApplicationActionAdmissionLiveV1<HashError, CanonicalError>,
): Effect.fn.Return<
  AdmittedActiveApplicationActionV1,
  AdmitActiveApplicationActionV1Error<HashError, CanonicalError>
> {
  const target = yield* claimApplicationRevisionActionRuntimeTargetAuthorityV1(
    input.selection,
    input.functionPath,
  );
  const argumentReference = yield* live.bodyStore.putImmutable(
    "action_arguments",
    copyBytes(input.arguments.canonicalBytes),
    live.argumentBudget,
  );
  const request = yield* Effect.fromResult(
    encodeApplicationActionInvocationRequestV1({
      scopeId: target.scopeAuthority.scopeId,
      requestKey: input.requestKey,
      applicationRevisionId: target.metadata.applicationRevisionId,
      candidateSha256: copyBytes(target.candidateSha256),
      actionFunctionPath: target.function.functionPath,
      actionBindingSha256: copyBytes(target.function.entryReference.sha256),
      executionIdentitySha256: copyBytes(input.executionIdentitySha256),
      compatibilityDate: input.compatibilityDate,
      hostPolicySha256: copyBytes(input.hostPolicySha256),
      arguments: argumentReference,
    }),
  );
  return yield* admitDirectActionInvocationV1(
    { request, invocationId: input.invocationId },
    {
      ...live.authority,
      authority: target.scopeAuthority,
    },
  );
});

/**
 * Publishes and cold-verifies the exact canonical HTTP request in R2 before
 * the short effect-attempt transaction can reference it.
 */
export const prepareActiveApplicationOutboundHttpEffectV1 = Effect.fn(
  "ActiveApplicationActionEvidence.prepareOutboundHttpV1",
)(function* <HashError, CanonicalError>(
  subject: DirectActionExecutionSubjectCapabilityV1,
  input: Readonly<{
    readonly stableEffectKey: string;
    readonly canonicalRequestBytes: Uint8Array;
  }>,
  live: ActiveApplicationActionEvidenceLiveV1<HashError, CanonicalError>,
): Effect.fn.Return<
  ExternalEffectAttemptProjectionV1,
  ActiveApplicationActionEvidenceV1Error<HashError, CanonicalError>
> {
  const bytes = copyBytes(input.canonicalRequestBytes);
  const request = yield* live.bodyStore.putImmutable(
    "outbound_http_request",
    bytes,
    live.bodyBudget,
  );
  const requestIdentitySha256 = yield* live.authority.sha256.hash(bytes);
  return yield* prepareExternalEffectAttemptV1(subject, {
    effectKind: "outbound_http",
    stableEffectKey: input.stableEffectKey,
    requestIdentitySha256,
    request,
  }, live.authority);
});

/** Publishes a verified canonical response before recording confirmation. */
export const confirmActiveApplicationOutboundHttpEffectV1 = Effect.fn(
  "ActiveApplicationActionEvidence.confirmOutboundHttpV1",
)(function* <HashError, CanonicalError>(
  subject: DirectActionExecutionSubjectCapabilityV1,
  effectOrdinal: bigint,
  canonicalResponseBytes: Uint8Array,
  live: ActiveApplicationActionEvidenceLiveV1<HashError, CanonicalError>,
): Effect.fn.Return<
  ExternalEffectAttemptProjectionV1,
  ActiveApplicationActionEvidenceV1Error<HashError, CanonicalError>
> {
  const response = yield* live.bodyStore.putImmutable(
    "outbound_http_response",
    copyBytes(canonicalResponseBytes),
    live.bodyBudget,
  );
  return yield* confirmExternalEffectAttemptV1(subject, effectOrdinal, {
    effectKind: "outbound_http",
    response,
  }, live.authority);
});

/** Publishes a canonical validated result before terminal completion. */
export const completeActiveApplicationActionV1 = Effect.fn(
  "ActiveApplicationActionEvidence.completeV1",
)(function* <HashError, CanonicalError>(
  subject: DirectActionExecutionSubjectCapabilityV1,
  resultValue: CanonicalFlarexValueV1,
  live: ActiveApplicationActionEvidenceLiveV1<HashError, CanonicalError>,
): Effect.fn.Return<
  ApplicationActionInvocationProjectionV1,
  ActiveApplicationActionEvidenceV1Error<HashError, CanonicalError>
> {
  const result = yield* live.bodyStore.putImmutable(
    "action_result",
    copyBytes(resultValue.canonicalBytes),
    live.bodyBudget,
  );
  return yield* settleDirectActionInvocationV1(
    subject,
    { lifecycle: "completed", result },
    live.authority,
  );
});
