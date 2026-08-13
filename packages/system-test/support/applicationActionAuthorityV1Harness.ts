import { createHash } from "node:crypto";

import { Effect, Exit, Fiber, Result } from "effect";
import {
  encodeApplicationActionInvocationRequestV1,
  makeExecutionEvidenceBodyReferenceV1,
  type CanonicalExecutionEvidenceFrameV1,
  type ApplicationActionInvocationRequestFrameV1,
} from "flarex-protocol/internal/execution-evidence-v1";

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
  requestDirectActionCancellationV1,
  settleDirectActionInvocationV1,
  type ApplicationActionAuthorityContextV1,
  type ApplicationActionAuthorityTransactionStepV1,
  type LocatedApplicationActionAuthorityTargetV1,
} from "@flarex/persistence-postgres/internal/application-action-authority-v1";
import {
  activateApplicationRevisionV1,
  readActiveApplicationRevisionV1,
  type LocatedApplicationRevisionActivationTargetV1,
} from "@flarex/persistence-postgres/internal/application-revision-activation-v1";
import {
  claimApplicationRevisionActionRuntimeTargetAuthorityV1,
} from "@flarex/persistence-postgres/internal/application-revision-action-runtime-target-v1";
import type { LocatedApplicationRevisionRegistrationTargetV1 } from
  "@flarex/persistence-postgres/application-revision-registration-v1";
import type { PGliteFlarexPersistence } from "@flarex/persistence-postgres/pglite";
import type { PostgresFlarexPersistence } from "@flarex/persistence-postgres/postgres";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
} from "@flarex/persistence-postgres/internal/system-test/scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "@flarex/persistence-postgres/internal/system-test/scopeMetadataTypes";
import { prepareFsv05ReadyRevisionFixtureV1 } from
  "./fsv05ApplicationRevisionActivationHarness";
import { makeMemoryRuntimeArtifactStoreV1 } from
  "./memoryRuntimeArtifactStoreV1";

type Persistence = PGliteFlarexPersistence | PostgresFlarexPersistence;

export const AAV_A1_LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const satisfies ScopePhysicalLocator);

export interface ApplicationActionAuthorityLaneV1 {
  readonly name: "pglite" | "postgres";
  readonly persistence: Persistence;
  readonly registrationTarget: LocatedApplicationRevisionRegistrationTargetV1;
  readonly activationTarget: LocatedApplicationRevisionActivationTargetV1;
  readonly actionTarget: LocatedApplicationActionAuthorityTargetV1;
  readonly makeLostResponseTarget: () =>
    LocatedApplicationActionAuthorityTargetV1;
  readonly makeBlockedTransactionTarget: (
    onBlocked: () => void,
    onFinished: () => void,
    release: Promise<void>,
  ) => LocatedApplicationActionAuthorityTargetV1;
}

export interface ApplicationActionAuthorityProofV1 {
  readonly lane: "pglite" | "postgres";
  readonly concurrentAdmission: readonly ["inserted", "replayed"];
  readonly contradictoryReuseRejected: true;
  readonly singularClaim: true;
  readonly effectOrdinals: readonly [1n, 2n];
  readonly completedReplay: true;
  readonly cancellationBeforeExecution: true;
  readonly cancellationRecoveryTerminal: true;
  readonly safeRecoveryGeneration: 2n;
  readonly dispatchRecoveryUncertain: true;
  readonly terminalEffectEvidence: true;
  readonly malformedReferenceRejected: true;
  readonly staleAuthorityRejected: true;
  readonly lostResponseReplayed: true;
  readonly rollbackProof: true;
  readonly interruptionWaitsForTransaction: true;
  readonly mutableDigestCaptured: true;
  readonly storedBodyColumnCount: 0;
  readonly invocationCount: number;
  readonly effectCount: number;
  readonly postgresVersion: string | null;
}

export async function proveApplicationActionAuthorityV1(
  lane: ApplicationActionAuthorityLaneV1,
): Promise<ApplicationActionAuthorityProofV1> {
  const artifacts = makeMemoryRuntimeArtifactStoreV1();
  const ready = await prepareFsv05ReadyRevisionFixtureV1({
    name: lane.name,
    persistence: lane.persistence,
    registrationTarget: lane.registrationTarget,
    makeActivationTarget: () => lane.activationTarget,
    makeDecisionUncertainTarget: () => Object.freeze({
      target: lane.activationTarget,
      wasInjected: () => false,
    }),
  }, artifacts, `aav-a1-${lane.name}`, true);
  await run(Effect.scoped(activateApplicationRevisionV1(
    ready.revisionId,
    null,
    ready.context,
  )));
  const actionRuntimeTarget = await run(Effect.scoped(Effect.gen(function* () {
    const active = yield* readActiveApplicationRevisionV1(ready.context);
    return yield* claimApplicationRevisionActionRuntimeTargetAuthorityV1(
      active.selection,
      "actions:send",
    );
  })));
  const located = await Effect.runPromise(
    resolveLocatedTrustedScopeAuthorityEffect(
      actionRuntimeTarget.scopeAuthority.deploymentId,
      {
      scopeMetadata: lane.persistence,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("shared AAV-A1 scope must not read split receipts");
        },
      },
      scopeClockTargets: { resolve: async () => lane.actionTarget },
      },
    ),
  );
  const context: ApplicationActionAuthorityContextV1<never> = Object.freeze({
    target: located.target,
    authority: located.authority,
    sha256: SHA256,
  });
  const candidateSha256 = actionRuntimeTarget.candidateSha256;
  const applicationRevisionId = actionRuntimeTarget.metadata.applicationRevisionId;
  const actionBindingSha256 = actionRuntimeTarget.function.entryReference.sha256;
  const mainRequest = request(
    context.authority.scopeId,
    "aav-a1:concurrent",
    applicationRevisionId,
    candidateSha256,
    actionBindingSha256,
  );
  const admitted = await Promise.all([
    run(admitDirectActionInvocationV1(
      { request: mainRequest, invocationId: uuid(1) },
      context,
    )),
    run(admitDirectActionInvocationV1(
      { request: mainRequest, invocationId: uuid(2) },
      context,
    )),
  ]);
  const concurrentAdmission = admitted.map(item => item.disposition).sort() as
    ["inserted", "replayed"];
  if (
    concurrentAdmission[0] !== "inserted" ||
    concurrentAdmission[1] !== "replayed" ||
    admitted[0].invocation.invocationId !== admitted[1].invocation.invocationId
  ) throw new Error("AAV-A1 exact concurrent admission did not converge.");

  const contradictory = await failure(admitDirectActionInvocationV1(
    {
      request: request(
        context.authority.scopeId,
        "aav-a1:concurrent",
        applicationRevisionId,
        candidateSha256,
        digest("binding:contradictory"),
      ),
      invocationId: uuid(3),
    },
    context,
  ));
  requireTag(contradictory, "ApplicationActionRequestKeyConflictV1Error");

  const claims = await Promise.all([
    exit(claimDirectActionExecutionV1(
      mainRequest.frame.requestKey,
      60_000,
      digest("random:main"),
      context,
    )),
    exit(claimDirectActionExecutionV1(
      mainRequest.frame.requestKey,
      60_000,
      digest("random:other"),
      context,
    )),
  ]);
  const successfulClaims = claims.filter(Exit.isSuccess);
  if (successfulClaims.length !== 1) {
    throw new Error("AAV-A1 claim was not singular.");
  }
  const subject = successfulClaims[0].value.subject;
  const effects = await Promise.all([
    run(prepareExternalEffectAttemptV1(subject, {
      effectKind: "outbound_http",
      stableEffectKey: "http:main",
      requestIdentitySha256: digest("http:request:identity"),
      request: bodyReference("outbound_http_request", "http:request"),
    }, context)),
    run(prepareExternalEffectAttemptV1(subject, {
      effectKind: "child_mutation",
      stableEffectKey: "child:main",
      requestIdentitySha256: digest("child:request:identity"),
      childMutationRequestKey: "aav-a1:child:main",
      childMutationFunctionPath: "messages:send",
      childMutationArgumentsSha256: digest("child:arguments"),
    }, context)),
  ]);
  const ordinals = effects.map(effect => effect.effectOrdinal).sort(
    (left, right) => Number(left - right),
  ) as [1n, 2n];
  if (ordinals[0] !== 1n || ordinals[1] !== 2n) {
    throw new Error("AAV-A1 effect ordinals were not monotonic.");
  }
  const outbound = effects.find(effect => effect.effectKind === "outbound_http");
  const child = effects.find(effect => effect.effectKind === "child_mutation");
  if (outbound === undefined || child === undefined) {
    throw new Error("AAV-A1 effect kinds are missing.");
  }
  await run(failExternalEffectBeforeDispatchV1(
    subject,
    child.effectOrdinal,
    "child_not_dispatched",
    context,
  ));
  await run(declareExternalEffectDispatchV1(
    subject,
    outbound.effectOrdinal,
    context,
  ));
  await run(confirmExternalEffectAttemptV1(
    subject,
    outbound.effectOrdinal,
    {
      effectKind: "outbound_http",
      response: bodyReference("outbound_http_response", "http:response"),
    },
    context,
  ));
  const completed = await run(settleDirectActionInvocationV1(
    subject,
    {
      lifecycle: "completed",
      result: bodyReference("action_result", "result:main"),
    },
    context,
  ));
  if (completed.lifecycle !== "completed" || completed.result === null) {
    throw new Error("AAV-A1 completed result was not persisted.");
  }
  const replayed = await run(admitDirectActionInvocationV1(
    { request: mainRequest, invocationId: uuid(4) },
    context,
  ));
  if (
    replayed.disposition !== "replayed" ||
    replayed.invocation.lifecycle !== "completed" ||
    replayed.invocation.result === null
  ) throw new Error("AAV-A1 completed replay was not exact.");

  const cancellationKey = "aav-a1:cancel";
  await admit(context, cancellationKey, applicationRevisionId, candidateSha256, actionBindingSha256, 5);
  const cancelled = await run(requestDirectActionCancellationV1(
    cancellationKey,
    context,
  ));
  if (cancelled.lifecycle !== "cancelled") {
    throw new Error("AAV-A1 admitted cancellation did not settle.");
  }

  const cancellationRecoveryKey = "aav-a1:cancel-recovery";
  await admit(
    context,
    cancellationRecoveryKey,
    applicationRevisionId,
    candidateSha256,
    actionBindingSha256,
    12,
  );
  const cancellationRecoveryClaim = await run(claimDirectActionExecutionV1(
    cancellationRecoveryKey,
    60_000,
    digest("random:cancel-recovery"),
    context,
  ));
  await run(prepareExternalEffectAttemptV1(
    cancellationRecoveryClaim.subject,
    {
      effectKind: "child_mutation",
      stableEffectKey: "child:cancel-recovery",
      requestIdentitySha256: digest("child:cancel-recovery:identity"),
      childMutationRequestKey: "aav-a1:child:cancel-recovery",
      childMutationFunctionPath: "messages:send",
      childMutationArgumentsSha256: digest("child:cancel-recovery:args"),
    },
    context,
  ));
  await run(requestDirectActionCancellationV1(
    cancellationRecoveryKey,
    context,
  ));
  await expire(lane.persistence, cancellationRecoveryKey);
  const cancellationRecovered = await run(
    recoverExpiredDirectActionExecutionV1(cancellationRecoveryKey, context),
  );
  if (cancellationRecovered.lifecycle !== "cancelled") {
    throw new Error("AAV-A1 cancelled execution was resurrected by recovery.");
  }
  requireTag(await failure(claimDirectActionExecutionV1(
    cancellationRecoveryKey,
    60_000,
    digest("random:cancel-recovery:forbidden"),
    context,
  )), "ApplicationActionLifecycleConflictV1Error");
  await requireEffectState(
    lane.persistence,
    "child:cancel-recovery",
    "failed_before_dispatch",
  );

  const recoverKey = "aav-a1:recover";
  await admit(context, recoverKey, applicationRevisionId, candidateSha256, actionBindingSha256, 6);
  const recoverClaim = await run(claimDirectActionExecutionV1(
    recoverKey,
    60_000,
    digest("random:recover:1"),
    context,
  ));
  await run(prepareExternalEffectAttemptV1(recoverClaim.subject, {
    effectKind: "child_mutation",
    stableEffectKey: "child:recover",
    requestIdentitySha256: digest("child:recover:identity"),
    childMutationRequestKey: "aav-a1:child:recover",
    childMutationFunctionPath: "messages:send",
    childMutationArgumentsSha256: digest("child:recover:args"),
  }, context));
  await expire(lane.persistence, recoverKey);
  const recovered = await run(recoverExpiredDirectActionExecutionV1(
    recoverKey,
    context,
  ));
  if (recovered.lifecycle !== "admitted") {
    throw new Error("AAV-A1 safe recovery did not return to admitted.");
  }
  const secondGeneration = await run(claimDirectActionExecutionV1(
    recoverKey,
    60_000,
    digest("random:recover:2"),
    context,
  ));
  if (secondGeneration.invocation.executionGeneration !== 2n) {
    throw new Error("AAV-A1 safe recovery did not advance generation.");
  }

  const uncertainKey = "aav-a1:uncertain";
  await admit(context, uncertainKey, applicationRevisionId, candidateSha256, actionBindingSha256, 7);
  const uncertainClaim = await run(claimDirectActionExecutionV1(
    uncertainKey,
    60_000,
    digest("random:uncertain"),
    context,
  ));
  const uncertainEffect = await run(prepareExternalEffectAttemptV1(
    uncertainClaim.subject,
    {
      effectKind: "outbound_http",
      stableEffectKey: "http:uncertain",
      requestIdentitySha256: digest("http:uncertain:identity"),
      request: bodyReference("outbound_http_request", "http:uncertain"),
    },
    context,
  ));
  await run(declareExternalEffectDispatchV1(
    uncertainClaim.subject,
    uncertainEffect.effectOrdinal,
    context,
  ));
  await expire(lane.persistence, uncertainKey);
  const uncertain = await run(recoverExpiredDirectActionExecutionV1(
    uncertainKey,
    context,
  ));
  if (uncertain.lifecycle !== "uncertain") {
    throw new Error("AAV-A1 possible dispatch was not uncertain.");
  }
  await requireEffectState(
    lane.persistence,
    "http:uncertain",
    "uncertain",
  );

  const mixedDispatchKey = "aav-a1:mixed-dispatch-recovery";
  await admit(
    context,
    mixedDispatchKey,
    applicationRevisionId,
    candidateSha256,
    actionBindingSha256,
    15,
  );
  const mixedDispatchClaim = await run(claimDirectActionExecutionV1(
    mixedDispatchKey,
    60_000,
    digest("random:mixed-dispatch-recovery"),
    context,
  ));
  const mixedDispatched = await run(prepareExternalEffectAttemptV1(
    mixedDispatchClaim.subject,
    {
      effectKind: "outbound_http",
      stableEffectKey: "http:mixed-dispatch",
      requestIdentitySha256: digest("http:mixed-dispatch:identity"),
      request: bodyReference("outbound_http_request", "http:mixed-dispatch"),
    },
    context,
  ));
  await run(declareExternalEffectDispatchV1(
    mixedDispatchClaim.subject,
    mixedDispatched.effectOrdinal,
    context,
  ));
  await run(prepareExternalEffectAttemptV1(
    mixedDispatchClaim.subject,
    {
      effectKind: "child_mutation",
      stableEffectKey: "child:mixed-dispatch:prepared",
      requestIdentitySha256: digest("child:mixed-dispatch:identity"),
      childMutationRequestKey: "aav-a1:child:mixed-dispatch",
      childMutationFunctionPath: "messages:send",
      childMutationArgumentsSha256: digest("child:mixed-dispatch:arguments"),
    },
    context,
  ));
  await expire(lane.persistence, mixedDispatchKey);
  if (
    (await run(recoverExpiredDirectActionExecutionV1(
      mixedDispatchKey,
      context,
    ))).lifecycle !== "uncertain"
  ) throw new Error("AAV-A1 mixed dispatch recovery did not terminalize uncertain.");
  await requireEffectState(lane.persistence, "http:mixed-dispatch", "uncertain");
  await requireEffectState(
    lane.persistence,
    "child:mixed-dispatch:prepared",
    "failed_before_dispatch",
  );

  const mixedConfirmedKey = "aav-a1:mixed-confirmed-recovery";
  await admit(
    context,
    mixedConfirmedKey,
    applicationRevisionId,
    candidateSha256,
    actionBindingSha256,
    16,
  );
  const mixedConfirmedClaim = await run(claimDirectActionExecutionV1(
    mixedConfirmedKey,
    60_000,
    digest("random:mixed-confirmed-recovery"),
    context,
  ));
  const mixedConfirmed = await run(prepareExternalEffectAttemptV1(
    mixedConfirmedClaim.subject,
    {
      effectKind: "child_mutation",
      stableEffectKey: "child:mixed-confirmed",
      requestIdentitySha256: digest("child:mixed-confirmed:identity"),
      childMutationRequestKey: "aav-a1:child:mixed-confirmed",
      childMutationFunctionPath: "messages:send",
      childMutationArgumentsSha256: digest("child:mixed-confirmed:arguments"),
    },
    context,
  ));
  await run(declareExternalEffectDispatchV1(
    mixedConfirmedClaim.subject,
    mixedConfirmed.effectOrdinal,
    context,
  ));
  await run(confirmExternalEffectAttemptV1(
    mixedConfirmedClaim.subject,
    mixedConfirmed.effectOrdinal,
    {
      effectKind: "child_mutation",
      childMutationOutcomeSha256: digest("child:mixed-confirmed:outcome"),
    },
    context,
  ));
  await run(prepareExternalEffectAttemptV1(
    mixedConfirmedClaim.subject,
    {
      effectKind: "child_mutation",
      stableEffectKey: "child:mixed-confirmed:prepared",
      requestIdentitySha256: digest("child:mixed-confirmed:prepared:identity"),
      childMutationRequestKey: "aav-a1:child:mixed-confirmed:prepared",
      childMutationFunctionPath: "messages:send",
      childMutationArgumentsSha256: digest(
        "child:mixed-confirmed:prepared:arguments",
      ),
    },
    context,
  ));
  await expire(lane.persistence, mixedConfirmedKey);
  if (
    (await run(recoverExpiredDirectActionExecutionV1(
      mixedConfirmedKey,
      context,
    ))).lifecycle !== "uncertain"
  ) throw new Error("AAV-A1 mixed confirmed recovery did not terminalize uncertain.");
  await requireEffectState(lane.persistence, "child:mixed-confirmed", "confirmed");
  await requireEffectState(
    lane.persistence,
    "child:mixed-confirmed:prepared",
    "failed_before_dispatch",
  );

  const transitionKey = "aav-a1:mark-uncertain";
  await admit(context, transitionKey, applicationRevisionId, candidateSha256, actionBindingSha256, 8);
  const transitionClaim = await run(claimDirectActionExecutionV1(
    transitionKey,
    60_000,
    digest("random:mark-uncertain"),
    context,
  ));
  const transitionAttempt = await run(prepareExternalEffectAttemptV1(
    transitionClaim.subject,
    {
      effectKind: "outbound_http",
      stableEffectKey: "http:mark-uncertain",
      requestIdentitySha256: digest("http:mark-uncertain:identity"),
      request: bodyReference("outbound_http_request", "http:mark-uncertain"),
    },
    context,
  ));
  await run(declareExternalEffectDispatchV1(
    transitionClaim.subject,
    transitionAttempt.effectOrdinal,
    context,
  ));
  await run(markExternalEffectUncertainV1(
    transitionClaim.subject,
    transitionAttempt.effectOrdinal,
    "dispatch_response_lost",
    context,
  ));
  await run(settleDirectActionInvocationV1(
    transitionClaim.subject,
    { lifecycle: "uncertain", terminalCode: "dispatch_response_lost" },
    context,
  ));

  const settleUncertainKey = "aav-a1:settle-uncertain";
  await admit(
    context,
    settleUncertainKey,
    applicationRevisionId,
    candidateSha256,
    actionBindingSha256,
    13,
  );
  const settleUncertainClaim = await run(claimDirectActionExecutionV1(
    settleUncertainKey,
    60_000,
    digest("random:settle-uncertain"),
    context,
  ));
  const settleUncertainEffect = await run(prepareExternalEffectAttemptV1(
    settleUncertainClaim.subject,
    {
      effectKind: "outbound_http",
      stableEffectKey: "http:settle-uncertain",
      requestIdentitySha256: digest("http:settle-uncertain:identity"),
      request: bodyReference(
        "outbound_http_request",
        "http:settle-uncertain",
      ),
    },
    context,
  ));
  await run(declareExternalEffectDispatchV1(
    settleUncertainClaim.subject,
    settleUncertainEffect.effectOrdinal,
    context,
  ));
  await run(settleDirectActionInvocationV1(
    settleUncertainClaim.subject,
    { lifecycle: "uncertain", terminalCode: "host_response_lost" },
    context,
  ));
  await requireEffectState(
    lane.persistence,
    "http:settle-uncertain",
    "uncertain",
  );

  const malformedReferenceKey = "aav-a1:malformed-reference";
  await admit(
    context,
    malformedReferenceKey,
    applicationRevisionId,
    candidateSha256,
    actionBindingSha256,
    14,
  );
  const malformedReferenceClaim = await run(claimDirectActionExecutionV1(
    malformedReferenceKey,
    60_000,
    digest("random:malformed-reference"),
    context,
  ));
  const validReference = bodyReference(
    "outbound_http_request",
    "http:malformed-reference",
  );
  requireTag(await failure(prepareExternalEffectAttemptV1(
    malformedReferenceClaim.subject,
    {
      effectKind: "outbound_http",
      stableEffectKey: "http:malformed-reference",
      requestIdentitySha256: digest("http:malformed-reference:identity"),
      request: Object.freeze({
        ...validReference,
        objectKey: `${validReference.objectKey}:wrong`,
      }),
    },
    context,
  )), "ApplicationActionAuthorityInputV1Error");
  await requireInvocationOrdinal(lane.persistence, malformedReferenceKey, 0n);

  const rollbackKey = "aav-a1:rollback";
  const rollbackRequest = actionRequest(
    context,
    rollbackKey,
    applicationRevisionId,
    candidateSha256,
    actionBindingSha256,
  );
  const rollbackExit = await exit(admitDirectActionInvocationV1(
    { request: rollbackRequest, invocationId: uuid(9) },
    {
      ...context,
      proofAfterTransactionStep: step => {
        if (step === "afterAdmissionInsert") throw new Error("rollback:admit");
      },
    },
  ));
  if (Exit.isSuccess(rollbackExit)) throw new Error("AAV-A1 rollback fault escaped.");
  const missingAfterRollback = await failure(inspectDirectActionInvocationV1(
    rollbackKey,
    context,
  ));
  requireTag(missingAfterRollback, "ApplicationActionInvocationMissingV1Error");

  const lostKey = "aav-a1:lost-response";
  const lostRequest = actionRequest(
    context,
    lostKey,
    applicationRevisionId,
    candidateSha256,
    actionBindingSha256,
  );
  const lostContext = Object.freeze({ ...context, target: lane.makeLostResponseTarget() });
  const lost = await failure(admitDirectActionInvocationV1(
    { request: lostRequest, invocationId: uuid(10) },
    lostContext,
  ));
  requireTag(lost, "ApplicationActionAuthorityIntegrationV1Error");
  const lostReplay = await run(admitDirectActionInvocationV1(
    { request: lostRequest, invocationId: uuid(11) },
    context,
  ));
  if (lostReplay.disposition !== "replayed") {
    throw new Error("AAV-A1 lost response did not replay.");
  }

  await proveWriteBoundaryRollbacks(
    lane.persistence,
    context,
    applicationRevisionId,
    candidateSha256,
    actionBindingSha256,
  );
  await proveInterruptionAndDigestCapture(
    lane,
    context,
    applicationRevisionId,
    candidateSha256,
    actionBindingSha256,
  );

  await lane.persistence.query(
    `update fx_system_scope_clock set epoch = 'epoch_aav_a1_stale'
      where scope_id = $1`,
    [context.authority.scopeId],
  );
  const stale = await failure(inspectDirectActionInvocationV1(
    mainRequest.frame.requestKey,
    context,
  ));
  requireTag(stale, "ApplicationActionAuthorityStaleV1Error");

  const columns = await lane.persistence.query<{ count: string }>(`
    select count(*)::text as count
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'fx_system_application_action_invocation_v1',
        'fx_system_external_effect_attempt_v1'
      )
      and (
        column_name like '%bytes%'
        or data_type in ('json', 'jsonb')
      )
      and column_name not in (
        'application_execution_authority_json',
        'application_execution_authority_canonical_bytes'
      )
  `);
  const counts = await lane.persistence.query<{
    invocations: string;
    effects: string;
  }>(`select
    (select count(*)::text from fx_system_application_action_invocation_v1)
      as invocations,
    (select count(*)::text from fx_system_external_effect_attempt_v1)
      as effects`);
  const version = lane.name === "postgres"
    ? (await lane.persistence.query<{ version: string }>(
        "select version() as version",
      )).rows[0]?.version ?? null
    : null;
  const storedBodyColumnCount = Number(columns.rows[0]?.count ?? "-1");
  if (storedBodyColumnCount !== 0) {
    throw new Error("AAV-A1 PostgreSQL tables contain body-bearing columns.");
  }
  return Object.freeze({
    lane: lane.name,
    concurrentAdmission,
    contradictoryReuseRejected: true,
    singularClaim: true,
    effectOrdinals: ordinals,
    completedReplay: true,
    cancellationBeforeExecution: true,
    cancellationRecoveryTerminal: true,
    safeRecoveryGeneration: 2n,
    dispatchRecoveryUncertain: true,
    terminalEffectEvidence: true,
    malformedReferenceRejected: true,
    staleAuthorityRejected: true,
    lostResponseReplayed: true,
    rollbackProof: true,
    interruptionWaitsForTransaction: true,
    mutableDigestCaptured: true,
    storedBodyColumnCount: 0 as const,
    invocationCount: Number(counts.rows[0]?.invocations ?? "-1"),
    effectCount: Number(counts.rows[0]?.effects ?? "-1"),
    postgresVersion: version,
  });
}

async function proveWriteBoundaryRollbacks(
  persistence: Persistence,
  context: ApplicationActionAuthorityContextV1<never>,
  revisionId: string,
  candidateSha256: Uint8Array,
  actionBindingSha256: Uint8Array,
) {
  const hashFailureKey = "aav-a1:rollback:claim-hash";
  await admit(
    context,
    hashFailureKey,
    revisionId,
    candidateSha256,
    actionBindingSha256,
    19,
  );
  const hashFailure = await failure(claimDirectActionExecutionV1(
    hashFailureKey,
    60_000,
    digest("rollback:claim-hash"),
    Object.freeze({
      ...context,
      sha256: Object.freeze({
        hash: () => Effect.fail("expected-claim-hash-failure" as const),
      }),
    }),
  ));
  if (hashFailure !== "expected-claim-hash-failure") {
    throw new Error("AAV-A1 claim did not preserve its typed hash failure.");
  }
  if (
    (await run(inspectDirectActionInvocationV1(hashFailureKey, context)))
      .lifecycle !== "admitted"
  ) throw new Error("AAV-A1 claim hash failure exposed a transition.");

  const lifecycleKey = "aav-a1:rollback:lifecycle";
  await admit(
    context,
    lifecycleKey,
    revisionId,
    candidateSha256,
    actionBindingSha256,
    20,
  );
  await requireRollback(claimDirectActionExecutionV1(
    lifecycleKey,
    60_000,
    digest("rollback:claim"),
    faultContext(context, "afterClaimUpdate"),
  ));
  if ((await run(inspectDirectActionInvocationV1(lifecycleKey, context))).lifecycle !== "admitted") {
    throw new Error("AAV-A1 claim rollback exposed a transition.");
  }
  const claimed = await run(claimDirectActionExecutionV1(
    lifecycleKey,
    60_000,
    digest("rollback:claim:success"),
    context,
  ));
  const preparedInput = Object.freeze({
    effectKind: "child_mutation" as const,
    stableEffectKey: "rollback:child",
    requestIdentitySha256: digest("rollback:child:identity"),
    childMutationRequestKey: "aav-a1:rollback:child",
    childMutationFunctionPath: "messages:send",
    childMutationArgumentsSha256: digest("rollback:child:arguments"),
  });
  await requireRollback(prepareExternalEffectAttemptV1(
    claimed.subject,
    preparedInput,
    faultContext(context, "afterEffectOrdinalUpdate"),
  ));
  await requireInvocationOrdinal(persistence, lifecycleKey, 0n);
  await requireRollback(prepareExternalEffectAttemptV1(
    claimed.subject,
    preparedInput,
    faultContext(context, "afterEffectInsert"),
  ));
  await requireInvocationOrdinal(persistence, lifecycleKey, 0n);
  const effect = await run(prepareExternalEffectAttemptV1(
    claimed.subject,
    preparedInput,
    context,
  ));
  await requireRollback(declareExternalEffectDispatchV1(
    claimed.subject,
    effect.effectOrdinal,
    faultContext(context, "afterEffectTransitionUpdate"),
  ));
  await requireEffectState(persistence, "rollback:child", "prepared");
  await run(declareExternalEffectDispatchV1(
    claimed.subject,
    effect.effectOrdinal,
    context,
  ));
  await requireRollback(confirmExternalEffectAttemptV1(
    claimed.subject,
    effect.effectOrdinal,
    {
      effectKind: "child_mutation",
      childMutationOutcomeSha256: digest("rollback:child:outcome"),
    },
    faultContext(context, "afterEffectConfirmationUpdate"),
  ));
  await requireEffectState(persistence, "rollback:child", "dispatching");
  await run(confirmExternalEffectAttemptV1(
    claimed.subject,
    effect.effectOrdinal,
    {
      effectKind: "child_mutation",
      childMutationOutcomeSha256: digest("rollback:child:outcome"),
    },
    context,
  ));
  await requireRollback(settleDirectActionInvocationV1(
    claimed.subject,
    {
      lifecycle: "completed",
      result: bodyReference("action_result", "rollback:result"),
    },
    faultContext(context, "afterSettlementUpdate"),
  ));
  if ((await run(inspectDirectActionInvocationV1(lifecycleKey, context))).lifecycle !== "executing") {
    throw new Error("AAV-A1 settlement rollback exposed a terminal state.");
  }
  await run(settleDirectActionInvocationV1(
    claimed.subject,
    {
      lifecycle: "completed",
      result: bodyReference("action_result", "rollback:result"),
    },
    context,
  ));

  const cancellationKey = "aav-a1:rollback:cancellation";
  await admit(
    context,
    cancellationKey,
    revisionId,
    candidateSha256,
    actionBindingSha256,
    21,
  );
  await requireRollback(requestDirectActionCancellationV1(
    cancellationKey,
    faultContext(context, "afterCancellationUpdate"),
  ));
  if ((await run(inspectDirectActionInvocationV1(cancellationKey, context))).lifecycle !== "admitted") {
    throw new Error("AAV-A1 cancellation rollback exposed a terminal state.");
  }

  const recoveryKey = "aav-a1:rollback:recovery";
  await admit(
    context,
    recoveryKey,
    revisionId,
    candidateSha256,
    actionBindingSha256,
    22,
  );
  const recoveryClaim = await run(claimDirectActionExecutionV1(
    recoveryKey,
    60_000,
    digest("rollback:recovery:claim"),
    context,
  ));
  await run(prepareExternalEffectAttemptV1(
    recoveryClaim.subject,
    {
      ...preparedInput,
      stableEffectKey: "rollback:recovery:child",
      requestIdentitySha256: digest("rollback:recovery:identity"),
      childMutationRequestKey: "aav-a1:rollback:recovery:child",
    },
    context,
  ));
  await expire(persistence, recoveryKey);
  await requireRollback(recoverExpiredDirectActionExecutionV1(
    recoveryKey,
    faultContext(context, "afterRecoveryPreparedEffectUpdate"),
  ));
  await requireEffectState(persistence, "rollback:recovery:child", "prepared");
  await requireRollback(recoverExpiredDirectActionExecutionV1(
    recoveryKey,
    faultContext(context, "afterRecoveryParentUpdate"),
  ));
  await requireEffectState(persistence, "rollback:recovery:child", "prepared");
  if ((await run(inspectDirectActionInvocationV1(recoveryKey, context))).lifecycle !== "executing") {
    throw new Error("AAV-A1 recovery rollback exposed a parent transition.");
  }
  await run(recoverExpiredDirectActionExecutionV1(recoveryKey, context));

  const settlementEffectKey = "aav-a1:rollback:settlement-effect";
  await admit(
    context,
    settlementEffectKey,
    revisionId,
    candidateSha256,
    actionBindingSha256,
    23,
  );
  const settlementEffectClaim = await run(claimDirectActionExecutionV1(
    settlementEffectKey,
    60_000,
    digest("rollback:settlement-effect:claim"),
    context,
  ));
  const settlementEffect = await run(prepareExternalEffectAttemptV1(
    settlementEffectClaim.subject,
    {
      effectKind: "outbound_http",
      stableEffectKey: "rollback:settlement-effect:http",
      requestIdentitySha256: digest("rollback:settlement-effect:identity"),
      request: bodyReference(
        "outbound_http_request",
        "rollback:settlement-effect:http",
      ),
    },
    context,
  ));
  await run(declareExternalEffectDispatchV1(
    settlementEffectClaim.subject,
    settlementEffect.effectOrdinal,
    context,
  ));
  await requireRollback(settleDirectActionInvocationV1(
    settlementEffectClaim.subject,
    { lifecycle: "uncertain", terminalCode: "rollback:settlement-effect" },
    faultContext(context, "afterSettlementEffectUpdate"),
  ));
  await requireEffectState(
    persistence,
    "rollback:settlement-effect:http",
    "dispatching",
  );
  if (
    (await run(inspectDirectActionInvocationV1(settlementEffectKey, context)))
      .lifecycle !== "executing"
  ) throw new Error("AAV-A1 effect settlement rollback exposed a parent transition.");
  await run(settleDirectActionInvocationV1(
    settlementEffectClaim.subject,
    { lifecycle: "uncertain", terminalCode: "settlement-effect-uncertain" },
    context,
  ));

  const recoveryDispatchKey = "aav-a1:rollback:recovery-dispatch";
  await admit(
    context,
    recoveryDispatchKey,
    revisionId,
    candidateSha256,
    actionBindingSha256,
    24,
  );
  const recoveryDispatchClaim = await run(claimDirectActionExecutionV1(
    recoveryDispatchKey,
    60_000,
    digest("rollback:recovery-dispatch:claim"),
    context,
  ));
  const recoveryDispatchEffect = await run(prepareExternalEffectAttemptV1(
    recoveryDispatchClaim.subject,
    {
      effectKind: "outbound_http",
      stableEffectKey: "rollback:recovery-dispatch:http",
      requestIdentitySha256: digest("rollback:recovery-dispatch:identity"),
      request: bodyReference(
        "outbound_http_request",
        "rollback:recovery-dispatch:http",
      ),
    },
    context,
  ));
  await run(declareExternalEffectDispatchV1(
    recoveryDispatchClaim.subject,
    recoveryDispatchEffect.effectOrdinal,
    context,
  ));
  await run(prepareExternalEffectAttemptV1(
    recoveryDispatchClaim.subject,
    {
      ...preparedInput,
      stableEffectKey: "rollback:recovery-dispatch:prepared",
      requestIdentitySha256: digest(
        "rollback:recovery-dispatch:prepared:identity",
      ),
      childMutationRequestKey:
        "aav-a1:rollback:recovery-dispatch:prepared",
    },
    context,
  ));
  await expire(persistence, recoveryDispatchKey);
  await requireRollback(recoverExpiredDirectActionExecutionV1(
    recoveryDispatchKey,
    faultContext(context, "afterRecoveryDispatchingEffectUpdate"),
  ));
  await requireEffectState(
    persistence,
    "rollback:recovery-dispatch:http",
    "dispatching",
  );
  await requireEffectState(
    persistence,
    "rollback:recovery-dispatch:prepared",
    "prepared",
  );
  if (
    (await run(inspectDirectActionInvocationV1(recoveryDispatchKey, context)))
      .lifecycle !== "executing"
  ) throw new Error("AAV-A1 dispatch recovery rollback exposed a parent transition.");
  await run(recoverExpiredDirectActionExecutionV1(
    recoveryDispatchKey,
    context,
  ));
  await requireEffectState(
    persistence,
    "rollback:recovery-dispatch:http",
    "uncertain",
  );
  await requireEffectState(
    persistence,
    "rollback:recovery-dispatch:prepared",
    "failed_before_dispatch",
  );

  const recoveryConfirmedKey = "aav-a1:rollback:recovery-confirmed";
  await admit(
    context,
    recoveryConfirmedKey,
    revisionId,
    candidateSha256,
    actionBindingSha256,
    25,
  );
  const recoveryConfirmedClaim = await run(claimDirectActionExecutionV1(
    recoveryConfirmedKey,
    60_000,
    digest("rollback:recovery-confirmed:claim"),
    context,
  ));
  const recoveryConfirmedEffect = await run(prepareExternalEffectAttemptV1(
    recoveryConfirmedClaim.subject,
    {
      ...preparedInput,
      stableEffectKey: "rollback:recovery-confirmed:confirmed",
      requestIdentitySha256: digest(
        "rollback:recovery-confirmed:confirmed:identity",
      ),
      childMutationRequestKey:
        "aav-a1:rollback:recovery-confirmed:confirmed",
    },
    context,
  ));
  await run(declareExternalEffectDispatchV1(
    recoveryConfirmedClaim.subject,
    recoveryConfirmedEffect.effectOrdinal,
    context,
  ));
  await run(confirmExternalEffectAttemptV1(
    recoveryConfirmedClaim.subject,
    recoveryConfirmedEffect.effectOrdinal,
    {
      effectKind: "child_mutation",
      childMutationOutcomeSha256: digest(
        "rollback:recovery-confirmed:outcome",
      ),
    },
    context,
  ));
  await run(prepareExternalEffectAttemptV1(
    recoveryConfirmedClaim.subject,
    {
      ...preparedInput,
      stableEffectKey: "rollback:recovery-confirmed:prepared",
      requestIdentitySha256: digest(
        "rollback:recovery-confirmed:prepared:identity",
      ),
      childMutationRequestKey:
        "aav-a1:rollback:recovery-confirmed:prepared",
    },
    context,
  ));
  await expire(persistence, recoveryConfirmedKey);
  await requireRollback(recoverExpiredDirectActionExecutionV1(
    recoveryConfirmedKey,
    faultContext(context, "afterRecoveryPreparedEffectUpdate"),
  ));
  await requireEffectState(
    persistence,
    "rollback:recovery-confirmed:confirmed",
    "confirmed",
  );
  await requireEffectState(
    persistence,
    "rollback:recovery-confirmed:prepared",
    "prepared",
  );
  if (
    (await run(inspectDirectActionInvocationV1(recoveryConfirmedKey, context)))
      .lifecycle !== "executing"
  ) throw new Error("AAV-A1 confirmed recovery rollback exposed a parent transition.");
  await run(recoverExpiredDirectActionExecutionV1(
    recoveryConfirmedKey,
    context,
  ));
  await requireEffectState(
    persistence,
    "rollback:recovery-confirmed:confirmed",
    "confirmed",
  );
  await requireEffectState(
    persistence,
    "rollback:recovery-confirmed:prepared",
    "failed_before_dispatch",
  );
}

async function proveInterruptionAndDigestCapture(
  lane: ApplicationActionAuthorityLaneV1,
  context: ApplicationActionAuthorityContextV1<never>,
  revisionId: string,
  candidateSha256: Uint8Array,
  actionBindingSha256: Uint8Array,
) {
  const requestKey = "aav-a1:captured-digests";
  await admit(
    context,
    requestKey,
    revisionId,
    candidateSha256,
    actionBindingSha256,
    26,
  );

  const randomSeedSha256 = digest("captured-digests:random-seed");
  const expectedRandomSeedSha256 = randomSeedSha256.slice();
  const claimGate = transactionGate();
  const claimPromise = run(claimDirectActionExecutionV1(
    requestKey,
    60_000,
    randomSeedSha256,
    Object.freeze({
      ...context,
      target: lane.makeBlockedTransactionTarget(
        claimGate.onBlocked,
        claimGate.onFinished,
        claimGate.waitForRelease,
      ),
    }),
  ));
  await claimGate.blocked;
  randomSeedSha256.fill(0);
  claimGate.release();
  const claimed = await claimPromise;
  const invocationDigest = await lane.persistence.query<{
    readonly randomSeedSha256: Uint8Array;
  }>(`
    select random_seed_sha256 as "randomSeedSha256"
    from fx_system_application_action_invocation_v1
    where request_key = $1
  `, [requestKey]);
  requireCapturedDigest(
    invocationDigest.rows[0]?.randomSeedSha256,
    expectedRandomSeedSha256,
    "random seed",
  );

  const requestIdentitySha256 = digest("captured-digests:request-identity");
  const childMutationArgumentsSha256 = digest(
    "captured-digests:child-arguments",
  );
  const expectedRequestIdentitySha256 = requestIdentitySha256.slice();
  const expectedChildMutationArgumentsSha256 =
    childMutationArgumentsSha256.slice();
  const prepareGate = transactionGate();
  const preparedPromise = run(prepareExternalEffectAttemptV1(
    claimed.subject,
    {
      effectKind: "child_mutation",
      stableEffectKey: "child:captured-digests",
      requestIdentitySha256,
      childMutationRequestKey: "aav-a1:child:captured-digests",
      childMutationFunctionPath: "messages:send",
      childMutationArgumentsSha256,
    },
    Object.freeze({
      ...context,
      target: lane.makeBlockedTransactionTarget(
        prepareGate.onBlocked,
        prepareGate.onFinished,
        prepareGate.waitForRelease,
      ),
    }),
  ));
  await prepareGate.blocked;
  requestIdentitySha256.fill(0);
  childMutationArgumentsSha256.fill(0);
  prepareGate.release();
  const prepared = await preparedPromise;
  await run(declareExternalEffectDispatchV1(
    claimed.subject,
    prepared.effectOrdinal,
    context,
  ));

  const childMutationOutcomeSha256 = digest("captured-digests:child-outcome");
  const expectedChildMutationOutcomeSha256 = childMutationOutcomeSha256.slice();
  const confirmGate = transactionGate();
  const confirmedPromise = run(confirmExternalEffectAttemptV1(
    claimed.subject,
    prepared.effectOrdinal,
    {
      effectKind: "child_mutation",
      childMutationOutcomeSha256,
    },
    Object.freeze({
      ...context,
      target: lane.makeBlockedTransactionTarget(
        confirmGate.onBlocked,
        confirmGate.onFinished,
        confirmGate.waitForRelease,
      ),
    }),
  ));
  await confirmGate.blocked;
  childMutationOutcomeSha256.fill(0);
  confirmGate.release();
  await confirmedPromise;

  const effectDigests = await lane.persistence.query<{
    readonly requestIdentitySha256: Uint8Array;
    readonly childMutationArgumentsSha256: Uint8Array;
    readonly childMutationOutcomeSha256: Uint8Array;
  }>(`
    select
      request_identity_sha256 as "requestIdentitySha256",
      child_mutation_arguments_sha256 as "childMutationArgumentsSha256",
      child_mutation_outcome_sha256 as "childMutationOutcomeSha256"
    from fx_system_external_effect_attempt_v1
    where stable_effect_key = $1
  `, ["child:captured-digests"]);
  const effectDigest = effectDigests.rows[0];
  requireCapturedDigest(
    effectDigest?.requestIdentitySha256,
    expectedRequestIdentitySha256,
    "effect request identity",
  );
  requireCapturedDigest(
    effectDigest?.childMutationArgumentsSha256,
    expectedChildMutationArgumentsSha256,
    "child arguments",
  );
  requireCapturedDigest(
    effectDigest?.childMutationOutcomeSha256,
    expectedChildMutationOutcomeSha256,
    "child outcome",
  );

  const interruptionGate = transactionGate();
  const interruptedFiber = Effect.runFork(inspectDirectActionInvocationV1(
    requestKey,
    Object.freeze({
      ...context,
      target: lane.makeBlockedTransactionTarget(
        interruptionGate.onBlocked,
        interruptionGate.onFinished,
        interruptionGate.waitForRelease,
      ),
    }),
  ));
  await interruptionGate.blocked;
  let interruptionReturned = false;
  const interruption = Effect.runPromise(Fiber.interrupt(interruptedFiber))
    .then(() => {
      interruptionReturned = true;
    });
  let returnedBeforeSettlement = false;
  try {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    returnedBeforeSettlement = interruptionReturned;
  } finally {
    interruptionGate.release();
    await interruptionGate.finished;
    await interruption;
  }
  if (returnedBeforeSettlement) {
    throw new Error(
      "AAV-A1 interruption returned while its transaction was still running.",
    );
  }
}

function transactionGate() {
  let onBlocked!: () => void;
  let onFinished!: () => void;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => {
    onBlocked = resolve;
  });
  const waitForRelease = new Promise<void>(resolve => {
    release = resolve;
  });
  const finished = new Promise<void>(resolve => {
    onFinished = resolve;
  });
  return Object.freeze({
    blocked,
    onBlocked,
    finished,
    onFinished,
    waitForRelease,
    release,
  });
}

function requireCapturedDigest(
  actual: Uint8Array | undefined,
  expected: Uint8Array,
  label: string,
) {
  if (
    actual === undefined ||
    Buffer.from(actual).toString("hex") !== Buffer.from(expected).toString("hex")
  ) throw new Error(`AAV-A1 did not capture the validated ${label} digest.`);
}

function faultContext(
  context: ApplicationActionAuthorityContextV1<never>,
  expected: ApplicationActionAuthorityTransactionStepV1,
): ApplicationActionAuthorityContextV1<never> {
  return Object.freeze({
    ...context,
    proofAfterTransactionStep: (step: ApplicationActionAuthorityTransactionStepV1) => {
      if (step === expected) throw new Error(`rollback:${step}`);
    },
  });
}

async function requireRollback(effect: Effect.Effect<unknown, unknown>) {
  if (Exit.isSuccess(await exit(effect))) {
    throw new Error("AAV-A1 transaction fault did not roll back.");
  }
}

async function requireInvocationOrdinal(
  persistence: Persistence,
  requestKey: string,
  expected: bigint,
) {
  const result = await persistence.query<{ ordinal: string }>(`
    select last_effect_ordinal::text as ordinal
    from fx_system_application_action_invocation_v1
    where request_key = $1
  `, [requestKey]);
  if (BigInt(result.rows[0]?.ordinal ?? "-1") !== expected) {
    throw new Error("AAV-A1 rolled-back effect ordinal was visible.");
  }
}

async function requireEffectState(
  persistence: Persistence,
  stableEffectKey: string,
  expected: string,
) {
  const result = await persistence.query<{ state: string }>(`
    select state
    from fx_system_external_effect_attempt_v1
    where stable_effect_key = $1
    limit 1
  `, [stableEffectKey]);
  if (result.rows[0]?.state !== expected) {
    throw new Error(`Expected rolled-back effect state ${expected}.`);
  }
}

async function admit(
  context: ApplicationActionAuthorityContextV1<never>,
  requestKey: string,
  revisionId: string,
  candidateSha256: Uint8Array,
  actionBindingSha256: Uint8Array,
  id: number,
) {
  return run(admitDirectActionInvocationV1({
    request: actionRequest(
      context,
      requestKey,
      revisionId,
      candidateSha256,
      actionBindingSha256,
    ),
    invocationId: uuid(id),
  }, context));
}

function actionRequest(
  context: ApplicationActionAuthorityContextV1<never>,
  requestKey: string,
  revisionId: string,
  candidateSha256: Uint8Array,
  actionBindingSha256: Uint8Array,
) {
  return request(
    context.authority.scopeId,
    requestKey,
    revisionId,
    candidateSha256,
    actionBindingSha256,
  );
}

function request(
  scopeId: string,
  requestKey: string,
  applicationRevisionId: string,
  candidateSha256: Uint8Array,
  actionBindingSha256: Uint8Array,
): CanonicalExecutionEvidenceFrameV1<ApplicationActionInvocationRequestFrameV1> {
  return Result.getOrThrow(encodeApplicationActionInvocationRequestV1({
    scopeId,
    requestKey,
    applicationRevisionId,
    candidateSha256,
    actionFunctionPath: "actions:send",
    actionBindingSha256,
    executionIdentitySha256: digest("execution-identity"),
    compatibilityDate: "2026-08-04",
    hostPolicySha256: digest("host-policy"),
    arguments: bodyReference("action_arguments", `args:${requestKey}`),
  }));
}

function bodyReference(
  kind:
    | "action_arguments"
    | "action_result"
    | "outbound_http_request"
    | "outbound_http_response",
  label: string,
) {
  return Result.getOrThrow(makeExecutionEvidenceBodyReferenceV1(
    kind,
    digest(label),
    32,
  ));
}

async function expire(persistence: Persistence, requestKey: string) {
  await persistence.query(
    `update fx_system_application_action_invocation_v1
      set invocation_time = current_timestamp - interval '2 seconds',
          execution_deadline = current_timestamp - interval '1 second'
      where request_key = $1`,
    [requestKey],
  );
}

const SHA256 = Object.freeze({
  hash: (bytes: Uint8Array) => Effect.sync(() => digestBytes(bytes)),
});

function digest(label: string): Uint8Array {
  return digestBytes(new TextEncoder().encode(label));
}

function digestBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function uuid(id: number): string {
  return `00000000-0000-4000-8000-${id.toString().padStart(12, "0")}`;
}

function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

function exit<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(Effect.exit(effect));
}

async function failure<E>(effect: Effect.Effect<unknown, E>): Promise<E> {
  return Effect.runPromise(Effect.flip(effect));
}

function requireTag(error: unknown, tag: string): void {
  if (
    typeof error !== "object" || error === null ||
    !("_tag" in error) || error._tag !== tag
  ) {
    const actual = typeof error === "object" && error !== null && "_tag" in error
      ? String(error._tag)
      : String(error);
    throw new Error(`Expected ${tag}, received ${actual}.`);
  }
}
