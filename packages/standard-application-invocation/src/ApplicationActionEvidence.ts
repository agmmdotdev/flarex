import { copyBytes } from "@flarex/utils/bytes";
import {
  confirmExternalEffectAttemptV1,
  declareExternalEffectDispatchV1,
  failExternalEffectBeforeDispatchV1,
  markExternalEffectUncertainV1,
  prepareExternalEffectAttemptV1,
  type ApplicationActionAuthorityContextV1,
  type ApplicationActionAuthorityV1Error,
  type DirectActionExecutionSubjectCapabilityV1,
  type ExternalEffectAttemptProjectionV1,
} from "@flarex/persistence-postgres/internal/application-action-authority-v1";
import type {
  ExecutionEvidenceBodyBudgetV1,
  ExecutionEvidenceBodyStoreV1,
  ExecutionEvidenceBodyStoreV1Error,
} from "flarex-backend/internal/execution-evidence-body-r2-v1";
import { Effect } from "effect";

export interface ApplicationActionEvidenceLive<
  HashError,
  CanonicalError,
> {
  readonly bodyStore: ExecutionEvidenceBodyStoreV1<HashError, CanonicalError>;
  readonly bodyBudget: ExecutionEvidenceBodyBudgetV1;
  readonly authority: ApplicationActionAuthorityContextV1<HashError>;
}

export interface ApplicationActionEffectRunner {
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
}

export type ApplicationActionEvidenceError<HashError, CanonicalError> =
  | ExecutionEvidenceBodyStoreV1Error<HashError, CanonicalError>
  | ApplicationActionAuthorityV1Error<HashError>;

export const prepareApplicationOutboundHttpEffect = Effect.fn(
  "ApplicationActionEvidence.prepareOutboundHttp",
)(function* <HashError, CanonicalError>(
  subject: DirectActionExecutionSubjectCapabilityV1,
  input: Readonly<{
    readonly stableEffectKey: string;
    readonly canonicalRequestBytes: Uint8Array;
  }>,
  live: ApplicationActionEvidenceLive<HashError, CanonicalError>,
): Effect.fn.Return<
  ExternalEffectAttemptProjectionV1,
  ApplicationActionEvidenceError<HashError, CanonicalError>
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

export const confirmApplicationOutboundHttpEffect = Effect.fn(
  "ApplicationActionEvidence.confirmOutboundHttp",
)(function* <HashError, CanonicalError>(
  subject: DirectActionExecutionSubjectCapabilityV1,
  effectOrdinal: bigint,
  canonicalResponseBytes: Uint8Array,
  live: ApplicationActionEvidenceLive<HashError, CanonicalError>,
): Effect.fn.Return<
  ExternalEffectAttemptProjectionV1,
  ApplicationActionEvidenceError<HashError, CanonicalError>
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

export const declareApplicationExternalEffectDispatch = Effect.fn(
  "ApplicationActionEvidence.declareExternalEffectDispatch",
)(function* <HashError>(
  subject: DirectActionExecutionSubjectCapabilityV1,
  effectOrdinal: bigint,
  authority: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ExternalEffectAttemptProjectionV1,
  ApplicationActionAuthorityV1Error<HashError>
> {
  return yield* declareExternalEffectDispatchV1(
    subject,
    effectOrdinal,
    authority,
  );
});

export const failApplicationExternalEffectBeforeDispatch = Effect.fn(
  "ApplicationActionEvidence.failExternalEffectBeforeDispatch",
)(function* <HashError>(
  subject: DirectActionExecutionSubjectCapabilityV1,
  effectOrdinal: bigint,
  terminalCode: string,
  authority: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ExternalEffectAttemptProjectionV1,
  ApplicationActionAuthorityV1Error<HashError>
> {
  return yield* failExternalEffectBeforeDispatchV1(
    subject,
    effectOrdinal,
    terminalCode,
    authority,
  );
});

export const markApplicationExternalEffectUncertain = Effect.fn(
  "ApplicationActionEvidence.markExternalEffectUncertain",
)(function* <HashError>(
  subject: DirectActionExecutionSubjectCapabilityV1,
  effectOrdinal: bigint,
  terminalCode: string,
  authority: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ExternalEffectAttemptProjectionV1,
  ApplicationActionAuthorityV1Error<HashError>
> {
  return yield* markExternalEffectUncertainV1(
    subject,
    effectOrdinal,
    terminalCode,
    authority,
  );
});

export const prepareApplicationChildMutationEffect = Effect.fn(
  "ApplicationActionEvidence.prepareChildMutation",
)(function* <HashError>(
  subject: DirectActionExecutionSubjectCapabilityV1,
  input: Readonly<{
    readonly stableEffectKey: string;
    readonly requestIdentitySha256: Uint8Array;
    readonly childMutationRequestKey: string;
    readonly childMutationFunctionPath: string;
    readonly childMutationArgumentsSha256: Uint8Array;
  }>,
  authority: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ExternalEffectAttemptProjectionV1,
  ApplicationActionAuthorityV1Error<HashError>
> {
  return yield* prepareExternalEffectAttemptV1(subject, {
    effectKind: "child_mutation",
    stableEffectKey: input.stableEffectKey,
    requestIdentitySha256: copyBytes(input.requestIdentitySha256),
    childMutationRequestKey: input.childMutationRequestKey,
    childMutationFunctionPath: input.childMutationFunctionPath,
    childMutationArgumentsSha256: copyBytes(
      input.childMutationArgumentsSha256,
    ),
  }, authority);
});

export const confirmApplicationChildMutationEffect = Effect.fn(
  "ApplicationActionEvidence.confirmChildMutation",
)(function* <HashError>(
  subject: DirectActionExecutionSubjectCapabilityV1,
  effectOrdinal: bigint,
  childMutationOutcomeSha256: Uint8Array,
  authority: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ExternalEffectAttemptProjectionV1,
  ApplicationActionAuthorityV1Error<HashError>
> {
  return yield* confirmExternalEffectAttemptV1(subject, effectOrdinal, {
    effectKind: "child_mutation",
    childMutationOutcomeSha256: copyBytes(childMutationOutcomeSha256),
  }, authority);
});
