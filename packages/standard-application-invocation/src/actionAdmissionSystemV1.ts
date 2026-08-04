import { bytesEqualFullScan, copyBytes, isUint8ArrayWithByteLength } from
  "@flarex/utils/bytes";
import {
  admitDirectActionInvocationV1,
  claimDirectActionExecutionV1,
  confirmExternalEffectAttemptV1,
  declareExternalEffectDispatchV1,
  failExternalEffectBeforeDispatchV1,
  inspectDirectActionInvocationV1,
  markExternalEffectUncertainV1,
  prepareExternalEffectAttemptV1,
  recoverExpiredDirectActionExecutionV1,
  revokeDirectActionExecutionSubjectV1,
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
import {
  prepareCandidateBoundEdgeActionRuntimeTargetV1,
  type CandidateBoundEdgeActionRuntimeTargetBudgetV1,
  type PrepareCandidateBoundEdgeActionRuntimeTargetV1Error,
  type PreparedCandidateBoundEdgeActionRuntimeTargetV1,
} from
  "flarex-backend/internal/candidate-bound-edge-action-runtime-target-v1";
import type { DeclarativeV2RuntimeArtifactR2StoreV1 } from
  "flarex-backend/internal/declarative-v2-runtime-artifact-r2-v1";
import { Data, Effect, Scope } from "effect";
import {
  encodeApplicationActionInvocationRequestV1,
  type ExecutionEvidenceProtocolV1Error,
} from "flarex-protocol/internal/execution-evidence-v1";
import {
  decodeEdgeActionExactRuntimeAuthV1Effect,
  decodeEdgeActionExactRuntimeRequestV1Effect,
  EDGE_ACTION_EXACT_RUNTIME_FORMAT_V1,
  EDGE_ACTION_EXACT_RUNTIME_VERSION_V1,
  type EdgeActionExactRuntimeAuthV1,
  type EdgeActionExactRuntimeProtocolV1Error,
} from "flarex-protocol/edge-action-exact-runtime";
import {
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";
import {
  canonicalizeFlarexValueV1,
  decodeCanonicalFlarexValueEvidenceV1,
  type CanonicalFlarexValueV1,
} from "flarex-protocol/value";
import {
  issuePreparedActiveApplicationEdgeActionDispatchV1,
  revokePreparedActiveApplicationEdgeActionDispatchV1,
  type PreparedActiveApplicationEdgeActionDispatchV1,
} from "./edgeActionPreparedDispatchStateV1";
import {
  inspectActiveApplicationEdgeActionSettlementV1,
  revokeActiveApplicationEdgeActionSettlementV1,
  type ActiveApplicationEdgeActionSettlementV1,
} from "./edgeActionSettlementCapabilityV1";

export type { ActiveApplicationEdgeActionSettlementV1 } from
  "./edgeActionSettlementCapabilityV1";

export type { PreparedActiveApplicationEdgeActionDispatchV1 } from
  "./edgeActionPreparedDispatchStateV1";

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

/** Reads the existing request-key owner without selecting a new revision. */
export const inspectActiveApplicationActionInvocationV1 = Effect.fn(
  "ActiveApplicationActionAdmission.inspectV1",
)(function* <HashError>(
  requestKey: string,
  authority: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ApplicationActionInvocationProjectionV1,
  ApplicationActionAuthorityV1Error<HashError>
> {
  return yield* inspectDirectActionInvocationV1(requestKey, authority);
});

/** Delegates expiry and dispatch-uncertainty decisions to the AAV-A1 owner. */
export const recoverExpiredActiveApplicationActionExecutionV1 = Effect.fn(
  "ActiveApplicationActionAdmission.recoverExpiredV1",
)(function* <HashError>(
  requestKey: string,
  authority: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ApplicationActionInvocationProjectionV1,
  ApplicationActionAuthorityV1Error<HashError>
> {
  return yield* recoverExpiredDirectActionExecutionV1(requestKey, authority);
});

/** Proves that a stored admitted request still names the current exact target. */
export const isActiveApplicationActionInvocationTargetCurrentV1 = Effect.fn(
  "ActiveApplicationActionAdmission.isTargetCurrentV1",
)(function* (
  invocation: ApplicationActionInvocationProjectionV1,
  selection: AuthenticatedActiveApplicationRevisionSelectionV1,
  functionPath: string,
  compatibilityDate: string,
  hostPolicySha256: Uint8Array,
): Effect.fn.Return<
  boolean,
  ClaimApplicationRevisionActionRuntimeTargetAuthorityV1Error
> {
  const target = yield* claimApplicationRevisionActionRuntimeTargetAuthorityV1(
    selection,
    functionPath,
  );
  return invocation.scopeId === target.scopeAuthority.scopeId &&
    invocation.applicationRevisionId ===
      target.metadata.applicationRevisionId &&
    bytesEqualFullScan(invocation.candidateSha256, target.candidateSha256) &&
    bytesEqualFullScan(
      invocation.actionBindingSha256,
      target.function.entryReference.sha256,
    ) && invocation.compatibilityDate === compatibilityDate &&
    bytesEqualFullScan(invocation.hostPolicySha256, hostPolicySha256);
});

export interface ActiveApplicationActionEffectRunnerV1 {
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
}

export interface PrepareActiveApplicationEdgeActionDispatchV1Input {
  readonly selection: AuthenticatedActiveApplicationRevisionSelectionV1;
  readonly requestKey: string;
  readonly executionDurationMilliseconds: number;
  readonly randomSeed: Uint8Array;
  readonly auth: EdgeActionExactRuntimeAuthV1;
}

export interface ActiveApplicationEdgeActionDispatchLiveV1<
  HashError,
  CanonicalError,
> {
  readonly authority: ApplicationActionAuthorityContextV1<HashError>;
  readonly bodyStore: ExecutionEvidenceBodyStoreV1<HashError, CanonicalError>;
  readonly argumentBudget: ExecutionEvidenceBodyBudgetV1;
  readonly runtimeArtifacts: DeclarativeV2RuntimeArtifactR2StoreV1;
  readonly runtimeBudget: CandidateBoundEdgeActionRuntimeTargetBudgetV1;
  readonly hostPolicy: unknown;
  readonly compatibilityDate: string;
}

export class ActiveApplicationEdgeActionDispatchV1Error extends Data.TaggedError(
  "ActiveApplicationEdgeActionDispatchV1Error",
)<{
  readonly reason: "invalidInput" | "authorityMismatch" | "invalidArguments";
  readonly cause?: unknown;
}> {}

export type PrepareActiveApplicationEdgeActionDispatchV1Error<
  HashError,
  CanonicalError,
> =
  | ApplicationActionAuthorityV1Error<HashError>
  | PrepareCandidateBoundEdgeActionRuntimeTargetV1Error<
      ClaimApplicationRevisionActionRuntimeTargetAuthorityV1Error
    >
  | ExecutionEvidenceBodyStoreV1Error<HashError, CanonicalError>
  | EdgeActionExactRuntimeProtocolV1Error
  | ActiveApplicationEdgeActionDispatchV1Error;

export type ActiveApplicationActionEvidenceV1Error<HashError, CanonicalError> =
  | ExecutionEvidenceBodyStoreV1Error<HashError, CanonicalError>
  | ApplicationActionAuthorityV1Error<HashError>;

export class InvalidActiveApplicationEdgeActionSettlementV1Error
  extends Data.TaggedError(
    "InvalidActiveApplicationEdgeActionSettlementV1Error",
  )<{ readonly reason: "notIssuedOrAlreadySettled" }> {}

export type SettleActiveApplicationEdgeActionV1Outcome =
  | Readonly<{
      readonly lifecycle: "completed";
      readonly resultValue: CanonicalFlarexValueV1;
    }>
  | Readonly<{
      readonly lifecycle: "failed" | "uncertain" | "cancelled";
      readonly terminalCode: string;
    }>;

export type SettleActiveApplicationEdgeActionV1Error<
  HashError,
  CanonicalError,
> =
  | InvalidActiveApplicationEdgeActionSettlementV1Error
  | ActiveApplicationActionEvidenceV1Error<HashError, CanonicalError>;

/**
 * Private AAV-A2 composition. It claims the existing AAV-A1 execution subject,
 * derives the candidate target from the active selection, cold-reads the exact
 * admitted argument body, and constructs the only request that the artifact
 * host dispatch authority may release. It owns no route or terminal outcome.
 */
export const prepareActiveApplicationEdgeActionDispatchV1 = Effect.fn(
  "ActiveApplicationEdgeActionDispatch.prepareV1",
)(function* <HashError, CanonicalError>(
  input: PrepareActiveApplicationEdgeActionDispatchV1Input,
  live: ActiveApplicationEdgeActionDispatchLiveV1<HashError, CanonicalError>,
): Effect.fn.Return<
  PreparedActiveApplicationEdgeActionDispatchV1,
  PrepareActiveApplicationEdgeActionDispatchV1Error<HashError, CanonicalError>,
  Scope.Scope
> {
  if (!isUint8ArrayWithByteLength(input.randomSeed, 32)) {
    return yield* new ActiveApplicationEdgeActionDispatchV1Error({
      reason: "invalidInput",
    });
  }
  const randomSeed = copyBytes(input.randomSeed);
  const randomSeedSha256 = yield* live.authority.sha256.hash(randomSeed);
  const execution = yield* Effect.acquireRelease(
    claimDirectActionExecutionV1(
      input.requestKey,
      input.executionDurationMilliseconds,
      randomSeedSha256,
      live.authority,
    ),
    claimed => Effect.sync(() =>
      revokeDirectActionExecutionSubjectV1(claimed.subject)
    ),
  );
  const invocation = execution.invocation;
  const auth = yield* decodeEdgeActionExactRuntimeAuthV1Effect(input.auth);
  const executionIdentity = yield* Effect.tryPromise({
    try: () => canonicalizeFlarexValueV1(auth),
    catch: cause => new ActiveApplicationEdgeActionDispatchV1Error({
      reason: "invalidInput",
      cause,
    }),
  });
  if (
    invocation.lifecycle !== "executing" ||
    invocation.invocationTime === null || invocation.executionDeadline === null ||
    invocation.randomSeedSha256 === null ||
    !bytesEqualFullScan(invocation.randomSeedSha256, randomSeedSha256) ||
    !bytesEqualFullScan(
      invocation.executionIdentitySha256,
      executionIdentity.sha256,
    )
  ) return yield* authorityMismatch();
  const runtimeTarget = yield* prepareCandidateBoundEdgeActionRuntimeTargetV1(
    input.selection,
    invocation.actionFunctionPath,
    Object.freeze({
      claim: claimApplicationRevisionActionRuntimeTargetAuthorityV1,
    }),
    live.runtimeArtifacts,
    live.runtimeBudget,
    live.hostPolicy,
    live.compatibilityDate,
  );
  if (!runtimeTargetMatchesInvocation(runtimeTarget, invocation)) {
    return yield* authorityMismatch();
  }
  const argumentObject = yield* live.bodyStore.readImmutable(
    invocation.arguments,
    live.argumentBudget,
  );
  const argumentsValue = yield* Effect.tryPromise({
    try: () => decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes: argumentObject.bytes,
      sha256: invocation.arguments.sha256,
    }),
    catch: cause => new ActiveApplicationEdgeActionDispatchV1Error({
      reason: "invalidArguments",
      cause,
    }),
  });
  const request = yield* decodeEdgeActionExactRuntimeRequestV1Effect({
    format: EDGE_ACTION_EXACT_RUNTIME_FORMAT_V1,
    version: EDGE_ACTION_EXACT_RUNTIME_VERSION_V1,
    exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
    syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
    artifact: runtimeTarget.artifact,
    function: runtimeTarget.function,
    auth,
    arguments: argumentsValue.value,
    argumentSemanticBytes: argumentsValue.semanticSizeBytes,
    context: {
      executionId: invocation.invocationId,
      invocationId: invocation.invocationId,
      executionGeneration: invocation.executionGeneration,
      executionTime: invocation.invocationTime.getTime(),
      executionDeadline: invocation.executionDeadline.getTime(),
      randomSeed,
      runtimeTargetSha256: runtimeTarget.runtimeTargetSha256,
      hostPolicySha256: runtimeTarget.hostPolicySha256,
    },
  });
  const state = Object.freeze({
    selection: input.selection,
    execution,
    runtimeTarget,
    request,
  });
  return yield* Effect.acquireRelease(
    Effect.sync(() => {
      return issuePreparedActiveApplicationEdgeActionDispatchV1(state);
    }),
    prepared => Effect.sync(() => {
      revokePreparedActiveApplicationEdgeActionDispatchV1(prepared);
    }),
  );
});

function runtimeTargetMatchesInvocation(
  target: PreparedCandidateBoundEdgeActionRuntimeTargetV1,
  invocation: ApplicationActionInvocationProjectionV1,
): boolean {
  return target.binding.scopeId === invocation.scopeId &&
    target.binding.applicationRevisionId === invocation.applicationRevisionId &&
    bytesEqualFullScan(
      target.binding.candidateSha256,
      invocation.candidateSha256,
    ) &&
    bytesEqualFullScan(
      target.binding.actionBindingSha256,
      invocation.actionBindingSha256,
    ) &&
    target.binding.functionPath === invocation.actionFunctionPath &&
    target.binding.compatibilityDate === invocation.compatibilityDate &&
    bytesEqualFullScan(target.hostPolicySha256, invocation.hostPolicySha256);
}

function authorityMismatch(): Effect.Effect<
  never,
  ActiveApplicationEdgeActionDispatchV1Error
> {
  return Effect.fail(new ActiveApplicationEdgeActionDispatchV1Error({
    reason: "authorityMismatch",
  }));
}

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

export const declareActiveApplicationExternalEffectDispatchV1 = Effect.fn(
  "ActiveApplicationActionEvidence.declareExternalEffectDispatchV1",
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

export const failActiveApplicationExternalEffectBeforeDispatchV1 = Effect.fn(
  "ActiveApplicationActionEvidence.failExternalEffectBeforeDispatchV1",
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

export const markActiveApplicationExternalEffectUncertainV1 = Effect.fn(
  "ActiveApplicationActionEvidence.markExternalEffectUncertainV1",
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

export const prepareActiveApplicationChildMutationEffectV1 = Effect.fn(
  "ActiveApplicationActionEvidence.prepareChildMutationV1",
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

export const confirmActiveApplicationChildMutationEffectV1 = Effect.fn(
  "ActiveApplicationActionEvidence.confirmChildMutationV1",
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

/**
 * SAP07's sole opaque terminalization bridge. Failed owner transitions leave
 * the capability usable for the narrow failed-to-uncertain fallback; success
 * consumes it exactly once.
 */
export const settleActiveApplicationEdgeActionV1 = Effect.fn(
  "ActiveApplicationEdgeActionSettlement.settleV1",
)(function* <HashError, CanonicalError>(
  settlement: ActiveApplicationEdgeActionSettlementV1,
  outcome: SettleActiveApplicationEdgeActionV1Outcome,
  live: ActiveApplicationActionEvidenceLiveV1<HashError, CanonicalError>,
): Effect.fn.Return<
  ApplicationActionInvocationProjectionV1,
  SettleActiveApplicationEdgeActionV1Error<HashError, CanonicalError>
> {
  const subject = inspectActiveApplicationEdgeActionSettlementV1(settlement);
  if (subject === undefined) {
    return yield* new InvalidActiveApplicationEdgeActionSettlementV1Error({
      reason: "notIssuedOrAlreadySettled",
    });
  }
  const projection = outcome.lifecycle === "completed"
    ? yield* completeActiveApplicationActionV1(
        subject,
        outcome.resultValue,
        live,
      )
    : yield* settleDirectActionInvocationV1(
        subject,
        Object.freeze({
          lifecycle: outcome.lifecycle,
          terminalCode: outcome.terminalCode,
        }),
        live.authority,
      );
  revokeActiveApplicationEdgeActionSettlementV1(settlement);
  return projection;
});
