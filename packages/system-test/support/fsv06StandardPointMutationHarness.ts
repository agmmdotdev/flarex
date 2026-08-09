import { isNonArrayRecord } from "@flarex/utils/records";
import { Miniflare } from "miniflare";
import { Cause, Effect, Exit, Fiber, Layer, Result, Scope } from "effect";
import {
  claimCandidateBoundPointMutationInternalCallRuntimeTargetV1,
} from "flarex-backend/internal/candidate-bound-point-mutation-internal-call-runtime-target-v1";
import {
  POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_MAIN_MODULE_V1,
} from "flarex-backend/internal/point-mutation-internal-call-exact-runtime-host-v1";
import {
  makePointMutationTransactionGrantIssuerV1,
} from "flarex-backend/internal/point-mutation-transaction-grant-issuer-v1";
import {
  createTransactionGrantVerificationKeyNamespaceV1,
  createTransactionGrantVerifierV1,
} from "@flarex/executor/transaction-grant";
import type { PointMutationJournalRpcParentTargetV1 } from
  "@flarex/executor/point-mutation-journal-rpc";
import {
  type PointMutationExactRuntimeRequestV1,
} from "flarex-protocol/point-mutation-exact-runtime";
import {
  POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
  POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2,
  type PointMutationExactRuntimeHostResponseV2,
} from "flarex-protocol/point-mutation-exact-runtime-host";
import {
  makeGrantRetentionPolicyV1Result,
} from "flarex-protocol/grant-retention-policy";
import {
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TransactionGrantKeyIdV1Schema,
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAuthorizationGrantIdV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type RunLocatedReadCommittedTransactionV1,
} from "@flarex/persistence-postgres/internal/system-test/transactionSessionAttemptKernel";
import type { LocatedScopeClockReader } from
  "@flarex/persistence-postgres/internal/system-test/scopeAuthorityResolution";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from
  "@flarex/persistence-postgres/internal/system-test/intrinsicCreationTimeIndexBuildV1";
import { createAppDeveloperIndexDefinitionPortV1 } from
  "@flarex/persistence-postgres/internal/system-test/appDeveloperIndexCommitV1";
import type { PGliteFlarexPersistence } from "@flarex/persistence-postgres/internal/system-test/pglite";
import type { PostgresFlarexPersistence } from "@flarex/persistence-postgres/internal/system-test/postgres";
import type { PointCommitTransactionProofStepV1 } from
  "@flarex/persistence-postgres/internal/system-test/pointCommitTransaction";
import {
  activateApplicationRevisionV1,
  claimActiveApplicationRevisionInvocationBasisV1,
  readActiveApplicationRevisionV1,
} from "@flarex/persistence-postgres/internal/system-test/applicationRevisionActivationV1";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from
  "@flarex/persistence-postgres/internal/system-test/transactionSessionActivation";
import {
  ApplicationPointMutationRouteIndependentDispatcherV1Error,
  invokeApplicationPointMutationV1,
  makeApplicationPointMutationSystemV1Layer,
  ApplicationPointMutationSystemV1,
  type ApplicationPointMutationSystemLiveV1,
} from "@flarex/standard-application-invocation/internal/system-v1";
import {
  invokeStandardApplicationPointMutationV1,
  makeStandardApplicationActiveRevisionReaderV1Layer,
  StandardApplicationActiveRevisionReaderV1,
} from "@flarex/standard-application-invocation/v1";
import {
  FSV05_SUPPORTED_LOCATOR,
  prepareFsv05ReadyRevisionFixtureV1,
  type Fsv05ApplicationRevisionActivationLaneV1,
} from "./fsv05ApplicationRevisionActivationHarness";
import { makeMemoryRuntimeArtifactStoreV1 } from
  "./memoryRuntimeArtifactStoreV1";

type Persistence = PGliteFlarexPersistence | PostgresFlarexPersistence;
type PointMutationSuccessV1 = Extract<
  PointMutationExactRuntimeHostResponseV2,
  Readonly<{ readonly kind: "success" }>
>;
type PointMutationFailureV1 = Extract<
  PointMutationExactRuntimeHostResponseV2,
  Readonly<{ readonly kind: "failure" }>
>;
type PointMutationApplicationErrorV2 = Extract<
  PointMutationExactRuntimeHostResponseV2,
  Readonly<{ readonly kind: "applicationError" }>
>;

const NOW = Date.now();
const COMPATIBILITY_DATE = "2026-06-14";
const RUNTIME_BUDGET = Object.freeze({
  maximumModules: 64,
  maximumObjects: 128,
  maximumObjectBytes: 8 * 1_048_576,
  maximumRawBytes: 4 * 1_048_576,
  maximumHashBytes: 64 * 1_048_576,
});
const RETENTION = Result.getOrThrow(makeGrantRetentionPolicyV1Result({
  maximumGrantLifetimeMilliseconds: 600_000,
  maximumFutureIssuedAtSkewMilliseconds: 0,
  maximumLiveSnapshotRetentionMilliseconds: 600_000,
}));

export interface Fsv06StandardPointMutationLaneV1
  extends Fsv05ApplicationRevisionActivationLaneV1 {
  readonly persistence: Persistence;
  readonly makeSessionTarget: () => LocatedScopeClockReader;
  readonly makeEpochTarget: () => LocatedScopeClockReader;
}

export interface Fsv06StandardPointMutationProofV1 {
  readonly lane: "pglite" | "postgres";
  readonly insertCommitted: true;
  readonly updateCommitted: true;
  readonly exactReplay: true;
  readonly conflictingReuseRejected: true;
  readonly validationCaught: true;
  readonly invalidWriteNotAccepted: true;
  readonly coldSelectionReplay: true;
  readonly closedSelectionRejected: true;
  readonly clonedSelectionRejected: true;
  readonly deploymentMismatchRejected: true;
  readonly confirmedRollbackPreserved: true;
  readonly occConflictReran: true;
  readonly interruptionRecovered: true;
  readonly decisionUncertaintyRecovered: true;
  readonly runtimeExecutions: number;
  readonly currentRowCount: number;
  readonly commitCount: number;
  readonly outcomeCount: number;
  readonly feedCount: number;
  readonly outboxCount: number;
  readonly postgresVersion: string | null;
}

interface Fsv06CompositionProofControllerV1 {
  afterRuntimeOnce?: () => Promise<void>;
  confirmedRollbackStep?: "beforeCommit";
  loseCommitResponseAtBeforeCommit: boolean;
  loseCommitResponseAfterSettlement: boolean;
  beforeCommitBlock?: TransactionBlockV1;
  observedOperations?: Array<string>;
}

interface TransactionBlockV1 {
  readonly reached: Promise<void>;
  readonly markReached: () => void;
  readonly released: Promise<void>;
  readonly release: () => void;
}

export async function proveFsv06StandardPointMutationV1(
  lane: Fsv06StandardPointMutationLaneV1,
): Promise<Fsv06StandardPointMutationProofV1> {
  const artifacts = makeMemoryRuntimeArtifactStoreV1();
  const insertReady = await prepareFsv05ReadyRevisionFixtureV1(
    lane,
    artifacts,
    "fsv06-insert",
    true,
  );
  await Effect.runPromise(Effect.scoped(
    activateApplicationRevisionV1(
      insertReady.revisionId,
      null,
      insertReady.context,
    ),
  ));

  let runtimeExecutions = 0;
  const proofController: Fsv06CompositionProofControllerV1 = {
    loseCommitResponseAtBeforeCommit: false,
    loseCommitResponseAfterSettlement: false,
  };
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    insertReady.deploymentId,
  );
  const system = systemLive(lane, deploymentId, artifacts, proofController, () => {
    runtimeExecutions += 1;
  });
  const applicationLayer = Layer.merge(
    makeApplicationPointMutationSystemV1Layer(system),
    makeStandardApplicationActiveRevisionReaderV1Layer(insertReady.context),
  );
  const provideApplication = <A, E>(effect: Effect.Effect<
    A,
    E,
    | ApplicationPointMutationSystemV1
    | StandardApplicationActiveRevisionReaderV1
    | Scope.Scope
  >) => effect.pipe(Effect.provide(applicationLayer));
  const invoke = <A, E>(effect: Effect.Effect<
    A,
    E,
    | ApplicationPointMutationSystemV1
    | StandardApplicationActiveRevisionReaderV1
    | Scope.Scope
  >) => Effect.runPromise(Effect.scoped(provideApplication(effect)));

  const insertKey = TransactionRequestKeyV1Schema.make(
    `fsv06:${lane.name}:insert`,
  );
  const create = TransactionFunctionPathV1Schema.make("o:c");
  const inserted = await invoke(invokeStandardApplicationPointMutationV1(
    create,
    { status: "new" },
    insertKey,
  ));
  if (inserted.status !== "committed" || inserted.disposition !== "published") {
    throw new Error("FSV06 did not publish the Standard insert.");
  }
  const documentId = inserted.value;
  if (typeof documentId !== "string") {
    throw new Error("FSV06 insert did not return its authoritative document id.");
  }
  const executionsAfterInsert = runtimeExecutions;
  const replayed = await invoke(invokeStandardApplicationPointMutationV1(
    create,
    { status: "new" },
    insertKey,
  ));
  if (
    replayed.disposition !== "replayed" ||
    replayed.commitSeq !== inserted.commitSeq ||
    runtimeExecutions !== executionsAfterInsert
  ) throw new Error("FSV06 exact replay re-executed user code.");

  let conflictingReuseRejected = false;
  try {
    await invoke(invokeStandardApplicationPointMutationV1(
      create,
      { status: "different" },
      insertKey,
    ));
  } catch (cause) {
    conflictingReuseRejected = failureTag(cause) ===
      "CommittedPointOutcomeRequestKeyReuseErrorV1";
  }
  if (!conflictingReuseRejected) {
    throw new Error("FSV06 accepted contradictory request-key reuse.");
  }

  const wrongDeploymentLive = systemLive(
    lane,
    TransactionGrantDeploymentIdV1Schema.make("deployment_fsv06_wrong"),
    artifacts,
    proofController,
    () => undefined,
  );
  let deploymentMismatchRejected = false;
  try {
    await Effect.runPromise(Effect.scoped(
      readActiveApplicationRevisionV1(insertReady.context).pipe(
        Effect.flatMap(active => invokeApplicationPointMutationV1(
          active.selection,
          create,
          { status: "wrong-deployment" },
          TransactionRequestKeyV1Schema.make(
            `fsv06:${lane.name}:wrong-deployment`,
          ),
        )),
        Effect.provide(makeApplicationPointMutationSystemV1Layer(
          wrongDeploymentLive,
        )),
      ),
    ));
  } catch (cause) {
    deploymentMismatchRejected = failureTag(cause) ===
      "ApplicationPointMutationActiveSelectionMismatchV1Error";
  }
  if (!deploymentMismatchRejected) {
    throw new Error("FSV06 accepted an active selection from another deployment.");
  }

  const beforeInvalid = await durableCounts(lane.persistence);
  const invalid = await invoke(invokeStandardApplicationPointMutationV1(
    create,
    { status: 42 },
    TransactionRequestKeyV1Schema.make(`fsv06:${lane.name}:invalid`),
  ));
  if (invalid.value !== null) {
    throw new Error("FSV06 user code could not catch syscall validation.");
  }
  const afterInvalid = await durableCounts(lane.persistence);
  if (afterInvalid.currentRows !== beforeInvalid.currentRows) {
    throw new Error("FSV06 accepted a write after document validation failed.");
  }

  const previous = await Effect.runPromise(Effect.scoped(
    readActiveApplicationRevisionV1(insertReady.context),
  ));
  if (
    Result.isSuccess(
      claimActiveApplicationRevisionInvocationBasisV1(previous.selection),
    )
  ) {
    throw new Error("FSV06 retained active selection authority after Scope close.");
  }
  if (
    Result.isSuccess(
      claimActiveApplicationRevisionInvocationBasisV1(Object.freeze({
        ...previous.selection,
      })),
    )
  ) {
    throw new Error("FSV06 accepted a cloned active-selection authority.");
  }
  const updateReady = await prepareFsv05ReadyRevisionFixtureV1(
    lane,
    artifacts,
    "fsv06-update",
    false,
  );
  await Effect.runPromise(Effect.scoped(
    activateApplicationRevisionV1(
      updateReady.revisionId,
      previous.expectedActiveRevision,
      updateReady.context,
    ),
  ));
  const update = TransactionFunctionPathV1Schema.make("o:u");

  proofController.confirmedRollbackStep = "beforeCommit";
  const beforeRollback = await durableCounts(lane.persistence);
  const beforeRollbackAgreement = await durableAgreement(
    lane.persistence,
    inserted.scopeUuid,
  );
  const rollbackKey = TransactionRequestKeyV1Schema.make(
    `fsv06:${lane.name}:confirmed-rollback`,
  );
  let confirmedRollbackPreserved = false;
  try {
    await invoke(invokeStandardApplicationPointMutationV1(
      update,
      { id: documentId, d: { status: "rollback-rejected" } },
      rollbackKey,
    ));
  } catch (cause) {
    confirmedRollbackPreserved = failureTag(cause) === "PointCommitSqlErrorV1" &&
      isNonArrayRecord(cause) && cause.sqlState === "40001";
  }
  const afterRollback = await durableCounts(lane.persistence);
  const afterRollbackAgreement = await durableAgreement(
    lane.persistence,
    inserted.scopeUuid,
  );
  if (
    !confirmedRollbackPreserved ||
    proofController.confirmedRollbackStep !== undefined ||
    JSON.stringify(afterRollback) !== JSON.stringify(beforeRollback) ||
    JSON.stringify(afterRollbackAgreement) !==
      JSON.stringify(beforeRollbackAgreement)
  ) {
    throw new Error("FSV06 exposed state after a confirmed rollback.");
  }

  let occCompetitorCommitted = false;
  proofController.afterRuntimeOnce = async () => {
    const competitor = await invoke(invokeStandardApplicationPointMutationV1(
      update,
      { id: documentId, d: { status: "occ-competitor" } },
      TransactionRequestKeyV1Schema.make(
        `fsv06:${lane.name}:occ-competitor`,
      ),
    ));
    occCompetitorCommitted = competitor.disposition === "published";
  };
  const executionsBeforeOcc = runtimeExecutions;
  const updated = await invoke(invokeStandardApplicationPointMutationV1(
    update,
    { id: documentId, d: { status: "updated" } },
    TransactionRequestKeyV1Schema.make(`fsv06:${lane.name}:occ-primary`),
  ));
  if (
    updated.disposition !== "published" ||
    !occCompetitorCommitted ||
    runtimeExecutions - executionsBeforeOcc !== 3
  ) {
    throw new Error("FSV06 did not rerun the Standard update after OCC conflict.");
  }

  proofController.loseCommitResponseAtBeforeCommit = true;
  const uncertain = await invoke(invokeStandardApplicationPointMutationV1(
    update,
    { id: documentId, d: { status: "uncertainty-recovered" } },
    TransactionRequestKeyV1Schema.make(`fsv06:${lane.name}:uncertain`),
  ));
  if (
    uncertain.disposition !== "replayed" ||
    proofController.loseCommitResponseAfterSettlement
  ) {
    throw new Error("FSV06 did not observe the committed outcome after uncertainty.");
  }

  const interruption = transactionBlock();
  proofController.beforeCommitBlock = interruption;
  const interruptionKey = TransactionRequestKeyV1Schema.make(
    `fsv06:${lane.name}:interrupted`,
  );
  const interruptedFiber = Effect.runFork(Effect.scoped(provideApplication(
    invokeStandardApplicationPointMutationV1(
      update,
      { id: documentId, d: { status: "interrupted-commit" } },
      interruptionKey,
    ),
  )));
  await interruption.reached;
  const interruptionRequest = Effect.runPromise(Fiber.interrupt(
    interruptedFiber,
  ));
  await Promise.resolve();
  interruption.release();
  await interruptionRequest;
  const interruptedExit = await Effect.runPromise(Fiber.await(interruptedFiber));
  if (
    !Exit.isFailure(interruptedExit) ||
    !interruptedExit.cause.reasons.some(Cause.isInterruptReason)
  ) {
    throw new Error("FSV06 interruption did not remain terminal to the caller.");
  }
  const interruptedReplay = await invoke(
    invokeStandardApplicationPointMutationV1(
      update,
      { id: documentId, d: { status: "interrupted-commit" } },
      interruptionKey,
    ),
  );
  if (interruptedReplay.disposition !== "replayed") {
    throw new Error("FSV06 interruption did not recover the committed outcome.");
  }

  const cold = await invoke(invokeStandardApplicationPointMutationV1(
    update,
    { id: documentId, d: { status: "cold" } },
    TransactionRequestKeyV1Schema.make(`fsv06:${lane.name}:cold`),
  ));
  if (cold.disposition !== "published") {
    throw new Error("FSV06 cold active-selection reconstruction failed.");
  }
  const durable = await durableCounts(lane.persistence);
  const agreement = await durableAgreement(
    lane.persistence,
    cold.scopeUuid,
  );
  if (
    durable.currentRows !== 1 ||
    durable.commits !== 7 ||
    durable.outcomes !== 7 ||
    durable.feed !== 6 ||
    durable.outbox !== 7
  ) {
    throw new Error(`FSV06 durable agreement drifted: ${JSON.stringify(durable)}.`);
  }
  if (
    agreement.currentCommitSeq !== cold.commitSeq.toString() ||
    !isNonArrayRecord(agreement.currentValue) ||
    agreement.currentValue.status !== "cold" ||
    agreement.commitSeqs.length !== 7 ||
    agreement.outcomeCommitSeqs.join(",") !==
      agreement.commitSeqs.join(",") ||
    agreement.outboxCommitSeqs.join(",") !==
      agreement.commitSeqs.join(",") ||
    agreement.changeCommitSeqs.length !== 6
  ) {
    throw new Error("FSV06 row, result, feed, and outbox evidence disagreed.");
  }
  const version = lane.name === "postgres"
    ? (await lane.persistence.query<{ version: string }>(
      "select version() as version",
    )).rows[0]?.version ?? null
    : null;
  return Object.freeze({
    lane: lane.name,
    insertCommitted: true,
    updateCommitted: true,
    exactReplay: true,
    conflictingReuseRejected: true,
    validationCaught: true,
    invalidWriteNotAccepted: true,
    coldSelectionReplay: true,
    closedSelectionRejected: true,
    clonedSelectionRejected: true,
    deploymentMismatchRejected: true,
    confirmedRollbackPreserved: true,
    occConflictReran: true,
    interruptionRecovered: true,
    decisionUncertaintyRecovered: true,
    runtimeExecutions,
    currentRowCount: durable.currentRows,
    commitCount: durable.commits,
    outcomeCount: durable.outcomes,
    feedCount: durable.feed,
    outboxCount: durable.outbox,
    postgresVersion: version,
  });
}

export async function proveSap06A2MutationInternalQueryV1(
  lane: Fsv06StandardPointMutationLaneV1,
): Promise<Readonly<{
  readonly lane: "pglite" | "postgres";
  readonly inlineInternalQuery: true;
  readonly realWorkerdExecution: true;
  readonly stagedDeleteObservedByChild: true;
  readonly oneParentPublication: true;
  readonly runtimeExecutions: number;
  readonly currentRowPointerCount: 1;
  readonly liveRowCount: 0;
  readonly commitCount: 2;
  readonly outcomeCount: 2;
  readonly feedCount: 2;
  readonly outboxCount: 2;
  readonly postgresVersion: string | null;
}>> {
  const artifacts = makeMemoryRuntimeArtifactStoreV1();
  const insertReady = await prepareFsv05ReadyRevisionFixtureV1(
    lane,
    artifacts,
    "fsv06-insert",
    true,
  );
  await Effect.runPromise(Effect.scoped(
    activateApplicationRevisionV1(
      insertReady.revisionId,
      null,
      insertReady.context,
    ),
  ));
  let runtimeExecutions = 0;
  const proofController: Fsv06CompositionProofControllerV1 = {
    loseCommitResponseAtBeforeCommit: false,
    loseCommitResponseAfterSettlement: false,
    observedOperations: [],
  };
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    insertReady.deploymentId,
  );
  const applicationLayer = Layer.merge(
    makeApplicationPointMutationSystemV1Layer(systemLive(
      lane,
      deploymentId,
      artifacts,
      proofController,
      () => { runtimeExecutions += 1; },
    )),
    makeStandardApplicationActiveRevisionReaderV1Layer(insertReady.context),
  );
  const invoke = <A, E>(effect: Effect.Effect<
    A,
    E,
    | ApplicationPointMutationSystemV1
    | StandardApplicationActiveRevisionReaderV1
    | Scope.Scope
  >) => Effect.runPromise(Effect.scoped(effect.pipe(
    Effect.provide(applicationLayer),
  )));
  const inserted = await invoke(invokeStandardApplicationPointMutationV1(
    TransactionFunctionPathV1Schema.make("o:c"),
    { status: "staged" },
    TransactionRequestKeyV1Schema.make(`sap06-a2:${lane.name}:insert`),
  ));
  if (
    inserted.status !== "committed" ||
    inserted.disposition !== "published" ||
    typeof inserted.value !== "string"
  ) {
    throw new Error("SAP06-A2 setup insert was not authoritative.");
  }
  const previous = await Effect.runPromise(Effect.scoped(
    readActiveApplicationRevisionV1(insertReady.context),
  ));
  const internalReady = await prepareFsv05ReadyRevisionFixtureV1(
    lane,
    artifacts,
    "sap06-a2-mutation-internal-query",
    false,
  );
  await Effect.runPromise(Effect.scoped(
    activateApplicationRevisionV1(
      internalReady.revisionId,
      previous.expectedActiveRevision,
      internalReady.context,
    ),
  ));
  proofController.observedOperations = [];
  const before = await durableCounts(lane.persistence);
  const deleted = await invoke(invokeStandardApplicationPointMutationV1(
    TransactionFunctionPathV1Schema.make("o:u"),
    { i: inserted.value },
    TransactionRequestKeyV1Schema.make(`sap06-a2:${lane.name}:delete-read`),
  ));
  const after = await durableCounts(lane.persistence);
  if (
    deleted.status !== "committed" ||
    deleted.disposition !== "published" ||
    deleted.value !== null ||
    proofController.observedOperations?.join(",") !== "delete:1,get:2"
  ) {
    throw new Error("SAP06-A2 did not serialize delete then child read.");
  }
  if (
    before.currentRows !== 1 || after.currentRows !== 1 ||
    before.liveRows !== 1 || after.liveRows !== 0 ||
    after.commits !== before.commits + 1 ||
    after.outcomes !== before.outcomes + 1 ||
    after.feed !== before.feed + 1 ||
    after.outbox !== before.outbox + 1
  ) {
    throw new Error(
      `SAP06-A2 publication mismatch: ${JSON.stringify({ before, after })}`,
    );
  }
  const postgresVersion = lane.name === "postgres"
    ? (await lane.persistence.query<{ version: string }>(
      "select version() as version",
    )).rows[0]?.version ?? null
    : null;
  return Object.freeze({
    lane: lane.name,
    inlineInternalQuery: true as const,
    realWorkerdExecution: true as const,
    stagedDeleteObservedByChild: true as const,
    oneParentPublication: true as const,
    runtimeExecutions,
    currentRowPointerCount: 1 as const,
    liveRowCount: 0 as const,
    commitCount: 2 as const,
    outcomeCount: 2 as const,
    feedCount: 2 as const,
    outboxCount: 2 as const,
    postgresVersion,
  });
}

export async function proveSap06A3MutationInternalCallV1(
  lane: Fsv06StandardPointMutationLaneV1,
): Promise<Readonly<{
  readonly lane: "pglite" | "postgres";
  readonly inlineInternalMutation: true;
  readonly nestedInternalQuery: true;
  readonly caughtFailurePreservedWrite: true;
  readonly oneParentPublication: true;
  readonly exactReplay: true;
  readonly confirmedRollbackPreserved: true;
  readonly occConflictReran: true;
  readonly interruptionRecovered: true;
  readonly decisionUncertaintyRecovered: true;
  readonly coldSelectionReplay: true;
  readonly runtimeExecutions: number;
  readonly currentRowPointerCount: 6;
  readonly liveRowCount: 0;
  readonly commitCount: number;
  readonly outcomeCount: number;
  readonly feedCount: number;
  readonly outboxCount: number;
  readonly postgresVersion: string | null;
}>> {
  const artifacts = makeMemoryRuntimeArtifactStoreV1();
  const insertReady = await prepareFsv05ReadyRevisionFixtureV1(
    lane,
    artifacts,
    "fsv06-insert",
    true,
  );
  await Effect.runPromise(Effect.scoped(
    activateApplicationRevisionV1(
      insertReady.revisionId,
      null,
      insertReady.context,
    ),
  ));
  let runtimeExecutions = 0;
  const proofController: Fsv06CompositionProofControllerV1 = {
    loseCommitResponseAtBeforeCommit: false,
    loseCommitResponseAfterSettlement: false,
    observedOperations: [],
  };
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    insertReady.deploymentId,
  );
  const applicationLayer = Layer.merge(
    makeApplicationPointMutationSystemV1Layer(systemLive(
      lane,
      deploymentId,
      artifacts,
      proofController,
      () => { runtimeExecutions += 1; },
    )),
    makeStandardApplicationActiveRevisionReaderV1Layer(insertReady.context),
  );
  const invoke = <A, E>(effect: Effect.Effect<
    A,
    E,
    | ApplicationPointMutationSystemV1
    | StandardApplicationActiveRevisionReaderV1
    | Scope.Scope
  >) => Effect.runPromise(Effect.scoped(effect.pipe(
    Effect.provide(applicationLayer),
  )));
  const inserted = await invoke(invokeStandardApplicationPointMutationV1(
    TransactionFunctionPathV1Schema.make("o:c"),
    { status: "staged" },
    TransactionRequestKeyV1Schema.make(`sap06-a3:${lane.name}:insert`),
  ));
  if (
    inserted.status !== "committed" ||
    inserted.disposition !== "published" ||
    typeof inserted.value !== "string"
  ) {
    throw new Error("SAP06-A3 setup insert was not authoritative.");
  }
  const documentIds = [inserted.value];
  for (let index = 1; index < 6; index += 1) {
    const setup = await invoke(invokeStandardApplicationPointMutationV1(
      TransactionFunctionPathV1Schema.make("o:c"),
      { status: `staged-${index}` },
      TransactionRequestKeyV1Schema.make(
        `sap06-a3:${lane.name}:insert-${index}`,
      ),
    ));
    if (
      setup.status !== "committed" ||
      setup.disposition !== "published" ||
      typeof setup.value !== "string"
    ) {
      throw new Error("SAP06-A3 recovery setup insert was not authoritative.");
    }
    documentIds.push(setup.value);
  }
  const previous = await Effect.runPromise(Effect.scoped(
    readActiveApplicationRevisionV1(insertReady.context),
  ));
  const internalReady = await prepareFsv05ReadyRevisionFixtureV1(
    lane,
    artifacts,
    "sap06-a3-mutation-internal-call",
    false,
  );
  await Effect.runPromise(Effect.scoped(
    activateApplicationRevisionV1(
      internalReady.revisionId,
      previous.expectedActiveRevision,
      internalReady.context,
    ),
  ));
  proofController.observedOperations = [];
  const before = await durableCounts(lane.persistence);
  const mainKey = TransactionRequestKeyV1Schema.make(
    `sap06-a3:${lane.name}:delete-read`,
  );
  const deleted = await invoke(invokeStandardApplicationPointMutationV1(
    TransactionFunctionPathV1Schema.make("o:u"),
    { i: inserted.value },
    mainKey,
  ));
  const after = await durableCounts(lane.persistence);
  if (
    deleted.status !== "committed" ||
    deleted.disposition !== "published" ||
    deleted.value !== null ||
    proofController.observedOperations?.join(",") !== "delete:1,get:2"
  ) {
    throw new Error(
      "SAP06-A3 did not preserve the caught child write for its nested read.",
    );
  }
  if (
    before.currentRows !== 6 || after.currentRows !== 6 ||
    before.liveRows !== 6 || after.liveRows !== 5 ||
    after.commits !== before.commits + 1 ||
    after.outcomes !== before.outcomes + 1 ||
    after.feed !== before.feed + 1 ||
    after.outbox !== before.outbox + 1
  ) {
    throw new Error(
      `SAP06-A3 publication mismatch: ${JSON.stringify({ before, after })}`,
    );
  }
  const executionsAfterMain = runtimeExecutions;
  const replayed = await invoke(invokeStandardApplicationPointMutationV1(
    TransactionFunctionPathV1Schema.make("o:u"),
    { i: inserted.value },
    mainKey,
  ));
  if (
    replayed.disposition !== "replayed" ||
    replayed.commitSeq !== deleted.commitSeq ||
    runtimeExecutions !== executionsAfterMain
  ) {
    throw new Error("SAP06-A3 exact replay re-executed the nested call.");
  }

  proofController.confirmedRollbackStep = "beforeCommit";
  const beforeRollback = await durableCounts(lane.persistence);
  const rollbackKey = TransactionRequestKeyV1Schema.make(
    `sap06-a3:${lane.name}:confirmed-rollback`,
  );
  let confirmedRollbackPreserved = false;
  try {
    await invoke(invokeStandardApplicationPointMutationV1(
      TransactionFunctionPathV1Schema.make("o:u"),
      { i: documentIds[1]! },
      rollbackKey,
    ));
  } catch (cause) {
    confirmedRollbackPreserved = failureTag(cause) === "PointCommitSqlErrorV1" &&
      isNonArrayRecord(cause) && cause.sqlState === "40001";
  }
  const afterRollback = await durableCounts(lane.persistence);
  if (
    !confirmedRollbackPreserved ||
    proofController.confirmedRollbackStep !== undefined ||
    JSON.stringify(afterRollback) !== JSON.stringify(beforeRollback)
  ) {
    throw new Error("SAP06-A3 exposed child state after confirmed rollback.");
  }
  const rollbackRecovery = await invoke(
    invokeStandardApplicationPointMutationV1(
      TransactionFunctionPathV1Schema.make("o:u"),
      { i: documentIds[1]! },
      TransactionRequestKeyV1Schema.make(
        `sap06-a3:${lane.name}:rollback-recovery`,
      ),
    ),
  );
  if (rollbackRecovery.disposition !== "published") {
    throw new Error("SAP06-A3 did not continue after confirmed rollback.");
  }

  let occCompetitorCommitted = false;
  proofController.afterRuntimeOnce = async () => {
    const competitor = await invoke(invokeStandardApplicationPointMutationV1(
      TransactionFunctionPathV1Schema.make("o:u"),
      { i: documentIds[2]! },
      TransactionRequestKeyV1Schema.make(
        `sap06-a3:${lane.name}:occ-competitor`,
      ),
    ));
    occCompetitorCommitted = competitor.disposition === "published";
  };
  const executionsBeforeOcc = runtimeExecutions;
  let occPrimaryRejectedAtReplacement = false;
  try {
    await invoke(invokeStandardApplicationPointMutationV1(
      TransactionFunctionPathV1Schema.make("o:u"),
      { i: documentIds[2]! },
      TransactionRequestKeyV1Schema.make(`sap06-a3:${lane.name}:occ-primary`),
    ));
  } catch (cause) {
    occPrimaryRejectedAtReplacement = failureTag(cause) ===
      "PointMutationJournalResultRejectedV1Error";
  }
  if (
    !occPrimaryRejectedAtReplacement ||
    !occCompetitorCommitted ||
    runtimeExecutions - executionsBeforeOcc !== 3
  ) {
    throw new Error("SAP06-A3 did not rerun its parent after OCC conflict.");
  }

  proofController.loseCommitResponseAtBeforeCommit = true;
  const uncertain = await invoke(invokeStandardApplicationPointMutationV1(
    TransactionFunctionPathV1Schema.make("o:u"),
    { i: documentIds[3]! },
    TransactionRequestKeyV1Schema.make(`sap06-a3:${lane.name}:uncertain`),
  ));
  if (
    uncertain.disposition !== "replayed" ||
    proofController.loseCommitResponseAfterSettlement
  ) {
    throw new Error("SAP06-A3 did not recover its parent decision uncertainty.");
  }

  const interruption = transactionBlock();
  proofController.beforeCommitBlock = interruption;
  const interruptionKey = TransactionRequestKeyV1Schema.make(
    `sap06-a3:${lane.name}:interrupted`,
  );
  const interruptedFiber = Effect.runFork(Effect.scoped(
    invokeStandardApplicationPointMutationV1(
      TransactionFunctionPathV1Schema.make("o:u"),
      { i: documentIds[4]! },
      interruptionKey,
    ).pipe(Effect.provide(applicationLayer)),
  ));
  await interruption.reached;
  const interruptRequest = Effect.runPromise(Fiber.interrupt(interruptedFiber));
  interruption.release();
  await interruptRequest;
  const interruptedExit = await Effect.runPromise(Fiber.await(interruptedFiber));
  if (
    !Exit.isFailure(interruptedExit) ||
    !interruptedExit.cause.reasons.some(Cause.isInterruptReason)
  ) {
    throw new Error("SAP06-A3 interruption was not terminal to its caller.");
  }
  const interruptedReplay = await invoke(
    invokeStandardApplicationPointMutationV1(
      TransactionFunctionPathV1Schema.make("o:u"),
      { i: documentIds[4]! },
      interruptionKey,
    ),
  );
  if (interruptedReplay.disposition !== "replayed") {
    throw new Error("SAP06-A3 interruption did not settle through parent replay.");
  }

  const cold = await invoke(invokeStandardApplicationPointMutationV1(
    TransactionFunctionPathV1Schema.make("o:u"),
    { i: documentIds[5]! },
    TransactionRequestKeyV1Schema.make(`sap06-a3:${lane.name}:cold`),
  ));
  if (cold.disposition !== "published") {
    throw new Error("SAP06-A3 cold active-selection reconstruction failed.");
  }
  const durable = await durableCounts(lane.persistence);
  if (
    durable.currentRows !== 6 || durable.liveRows !== 0 ||
    durable.commits !== 12 || durable.outcomes !== 12 ||
    durable.feed !== 12 || durable.outbox !== 12
  ) {
    throw new Error(
      `SAP06-A3 recovery publication drifted: ${JSON.stringify(durable)}.`,
    );
  }
  const postgresVersion = lane.name === "postgres"
    ? (await lane.persistence.query<{ version: string }>(
      "select version() as version",
    )).rows[0]?.version ?? null
    : null;
  return Object.freeze({
    lane: lane.name,
    inlineInternalMutation: true as const,
    nestedInternalQuery: true as const,
    caughtFailurePreservedWrite: true as const,
    oneParentPublication: true as const,
    exactReplay: true as const,
    confirmedRollbackPreserved: true as const,
    occConflictReran: true as const,
    interruptionRecovered: true as const,
    decisionUncertaintyRecovered: true as const,
    coldSelectionReplay: true as const,
    runtimeExecutions,
    currentRowPointerCount: 6 as const,
    liveRowCount: 0 as const,
    commitCount: durable.commits,
    outcomeCount: durable.outcomes,
    feedCount: durable.feed,
    outboxCount: durable.outbox,
    postgresVersion,
  });
}

export interface Fsv06StandardPointMutationSystemTestCompositionV1 {
  readonly system: ApplicationPointMutationSystemLiveV1;
  readonly armAfterNextRuntime: (operation: Effect.Effect<void, never>) => void;
  readonly requireNoPendingInterleaving: () => void;
  readonly clearPendingInterleaving: () => void;
}

/** Test-only composition used by representative multi-function apps. */
export function makeFsv06StandardPointMutationSystemTestCompositionV1(
  lane: Fsv06StandardPointMutationLaneV1,
  deploymentId: string,
  artifacts: ReturnType<typeof makeMemoryRuntimeArtifactStoreV1>,
  onRuntimeExecution: () => void,
): Fsv06StandardPointMutationSystemTestCompositionV1 {
  const proofController: Fsv06CompositionProofControllerV1 = {
    loseCommitResponseAtBeforeCommit: false,
    loseCommitResponseAfterSettlement: false,
  };
  const system = systemLive(
    lane,
    TransactionGrantDeploymentIdV1Schema.make(deploymentId),
    artifacts,
    proofController,
    onRuntimeExecution,
  );
  return Object.freeze({
    system,
    armAfterNextRuntime: (operation: Effect.Effect<void, never>) => {
      if (proofController.afterRuntimeOnce !== undefined) {
        throw new Error(
          "The Standard mutation test interleaver already has pending work.",
        );
      }
      proofController.afterRuntimeOnce = () => Effect.runPromise(operation);
    },
    requireNoPendingInterleaving: () => {
      if (proofController.afterRuntimeOnce !== undefined) {
        throw new Error(
          "The Standard mutation test interleaving was not consumed.",
        );
      }
    },
    clearPendingInterleaving: () => {
      delete proofController.afterRuntimeOnce;
    },
  });
}

function systemLive(
  lane: Fsv06StandardPointMutationLaneV1,
  deploymentId: ApplicationPointMutationSystemLiveV1["deploymentId"],
  artifacts: ReturnType<typeof makeMemoryRuntimeArtifactStoreV1>,
  proofController: Fsv06CompositionProofControllerV1,
  onRuntimeExecution: () => void,
): ApplicationPointMutationSystemLiveV1 {
  const sessionAuthority: PointMutationSessionAuthorityResolutionPortsV1 = {
    scopeMetadata: lane.persistence,
    provisioningReceipts: unavailableSplitReceipt(),
    scopeSessionTargets: {
      resolve: async () => sessionTargetWithProofFaults(
        lane.makeSessionTarget(),
        proofController,
      ),
    },
  };
  const currentEpochAuthority = {
    scopeMetadata: lane.persistence,
    provisioningReceipts: unavailableSplitReceipt(),
    scopeEpochTargets: { resolve: async () => lane.makeEpochTarget() },
  };
  const kid = TransactionGrantKeyIdV1Schema.make(`key_fsv06_${lane.name}`);
  let grantSequence = 0;
  const issuer = makePointMutationTransactionGrantIssuerV1({
    grantRetentionPolicy: RETENTION,
    runtime: {
      currentTimeMillis: Effect.succeed(NOW),
      loadCurrentAuthConfig: () => Effect.succeed(null),
      nextGrantId: Effect.sync(() => {
        grantSequence += 1;
        return TransactionAuthorizationGrantIdV1Schema.make(
          `grant_fsv06_${lane.name}_${grantSequence}`,
        );
      }),
      loadSigningKeyring: () => Effect.succeed({
        deploymentId,
        keys: [{
          state: "activeSigner" as const,
          kid,
          purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
          issuedAtInclusiveEpochMilliseconds: NOW - 60_000,
          verificationEndsAtExclusiveEpochMilliseconds: NOW + 1_200_000,
          sign: () => Effect.succeed(new Uint8Array(64).fill(0x5a)),
        }],
      }),
    },
  });
  const verifier = createTransactionGrantVerifierV1({
    clock: { now: () => new Date(NOW) },
    verificationKeyNamespace: createTransactionGrantVerificationKeyNamespaceV1({
      deploymentId,
      keys: [{
        state: "active",
        kid,
        purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
        issuedAtInclusiveEpochMilliseconds: NOW - 60_000,
        verificationEndsAtExclusiveEpochMilliseconds: NOW + 1_200_000,
        verify: async (_input, signature) =>
          signature.byteLength === 64 && signature.every(byte => byte === 0x5a),
      }],
    }),
    grantRetentionPolicy: RETENTION,
  });
  let executionSequence = 0;
  return Object.freeze({
    deploymentId,
    intrinsicCreationTimeIndexes:
      createIntrinsicCreationTimeIndexDefinitionPortV1(
        lane.persistence.drizzle,
      ),
    developerIndexes: createAppDeveloperIndexDefinitionPortV1(
      lane.persistence.drizzle,
    ),
    sessionAuthority,
    currentEpochAuthority,
    grantRetentionPolicy: RETENTION,
    grantIssuer: issuer,
    grantVerifier: verifier,
    runtimeArtifacts: artifacts.store,
    runtimeBudget: RUNTIME_BUDGET,
    compatibilityDate: COMPATIBILITY_DATE,
    dispatcher: testRuntimeDispatcher(proofController, onRuntimeExecution),
    randomUuid: uuidFactory(lane.name === "pglite" ? "f6060000" : "f6160000"),
    executionContextFactory: {
      make: () => Effect.sync(() => {
        executionSequence += 1;
        return Object.freeze({
          executionId: `fsv06-execution-${executionSequence}`,
          logScopeId: `fsv06-log-${executionSequence}`,
          randomSeed: new Uint8Array(32).fill(executionSequence),
        });
      }),
    },
    leaseDurationMilliseconds: 600_000,
    claimDurationMilliseconds: 600_000,
    leaseRenewalDurationMilliseconds: 600_000,
    heartbeatIntervalMilliseconds: 200_000,
    pointCommitProofAfterTransactionStep: async ({ step }: Readonly<{
      readonly step: PointCommitTransactionProofStepV1;
    }>) => {
      if (
        proofController.confirmedRollbackStep === step
      ) {
        delete proofController.confirmedRollbackStep;
        throw Object.assign(new Error("injected confirmed rollback"), {
          code: "40001",
        });
      }
      if (
        step === "beforeCommit" &&
        proofController.loseCommitResponseAtBeforeCommit
      ) {
        proofController.loseCommitResponseAtBeforeCommit = false;
        proofController.loseCommitResponseAfterSettlement = true;
      }
      if (step === "beforeCommit" && proofController.beforeCommitBlock) {
        const block = proofController.beforeCommitBlock;
        delete proofController.beforeCommitBlock;
        block.markReached();
        await block.released;
      }
    },
  });
}

function testRuntimeDispatcher(
  proofController: Fsv06CompositionProofControllerV1,
  onRuntimeExecution: () => void,
) {
  return Object.freeze({
    bind: (target: unknown) => Effect.gen(function* () {
      const claimed = yield* Effect.fromResult(
        claimCandidateBoundPointMutationInternalCallRuntimeTargetV1(target),
      ).pipe(Effect.mapError(cause =>
        new ApplicationPointMutationRouteIndependentDispatcherV1Error({
          reason: "targetRejected",
          cause,
        })
      ));
      return Object.freeze({
        run: async (
          request: PointMutationExactRuntimeRequestV1,
          journal: PointMutationJournalRpcParentTargetV1,
        ) => {
          onRuntimeExecution();
          const runtime = new Miniflare({
            compatibilityDate: claimed.definition.compatibilityDate,
            modules: [
              {
                type: "ESModule" as const,
                path: "fsv06-dispatch.js",
                contents: pointMutationWorkerdDispatchModuleSourceForTest(),
              },
              ...Object.entries(claimed.definition.modules).map(
                ([path, contents]) => ({
                  type: "ESModule" as const,
                  path,
                  contents,
                }),
              ),
            ],
            serviceBindings: {
              JOURNAL: async (input: Request) => {
                const body = JSON.parse(await input.text()) as Readonly<{
                  readonly tableName: string;
                  readonly operation: object;
                }>;
                try {
                  if (
                    proofController.observedOperations !== undefined &&
                    isNonArrayRecord(body.operation) &&
                    typeof body.operation.kind === "string" &&
                    typeof body.operation.syscallSequence === "string"
                  ) {
                    proofController.observedOperations.push(
                      `${body.operation.kind}:${body.operation.syscallSequence}`,
                    );
                  }
                  const table = await journal.resolvePointTable(body.tableName);
                  const result = await table.runPointOperation(
                    body.operation as never,
                  );
                  return pointMutationRpcResponse({ ok: true, result });
                } catch (cause) {
                  return pointMutationRpcResponse({
                    ok: false,
                    name: errorName(cause),
                    message: errorMessage(cause),
                  });
                }
              },
            },
          });
          try {
            const response = await runtime.dispatchFetch("https://fsv06.test/", {
              method: "POST",
              body: JSON.stringify(serializePointMutationRequest(request)),
            });
            const envelope = await response.json() as Readonly<{
              readonly ok: boolean;
              readonly result?: PointMutationSuccessV1["result"];
              readonly applicationError?: PointMutationApplicationErrorV2["error"];
              readonly reason?: PointMutationFailureV1["reason"];
              readonly name?: string;
              readonly message?: string;
              readonly causeName?: string;
              readonly causeMessage?: string;
            }>;
            const afterRuntime = proofController.afterRuntimeOnce;
            if (afterRuntime !== undefined) {
              delete proofController.afterRuntimeOnce;
              await afterRuntime();
            }
            if (envelope.ok && envelope.result !== undefined) {
              return disposableResponse({
                  format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
                  version: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2,
                  kind: "success",
                  result: envelope.result,
                });
            }
            if (envelope.applicationError !== undefined) {
              return disposableResponse({
                format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
                version: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2,
                kind: "applicationError",
                error: envelope.applicationError,
              });
            }
            return disposableResponse({
                  format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
                  version: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2,
                  kind: "failure",
                  reason: envelope.reason ?? "userCodeFailed",
                });
          } catch (cause) {
            return disposableResponse({
              format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
              version: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2,
              kind: "failure",
              reason: "userCodeFailed",
            });
          } finally {
            await runtime.dispose();
          }
        },
      });
    }),
  });
}

export function pointMutationWorkerdDispatchModuleSourceForTest(): string {
  return `import { FlarexPointMutationInternalCallExactRuntimeV1 } from "./${POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_MAIN_MODULE_V1}";
import { captureCoreApplicationErrorV1 } from "./_flarex/application-error-platform-v1.js";
const encode = value => JSON.stringify(value, (_key, member) =>
  typeof member === "bigint" ? member.toString() : member);
export default {
  async fetch(request, env) {
    const input = await request.json();
    input.context.randomSeed = new Uint8Array(input.context.randomSeed);
    const journal = {
      resolvePointTable(tableName) {
        return {
          async runPointOperation(operation) {
            const response = await env.JOURNAL.fetch("https://journal/point", {
              method: "POST",
              body: encode({ tableName, operation }),
            });
            const envelope = JSON.parse(await response.text());
            if (!envelope.ok) {
              const error = new Error(envelope.message);
              Object.defineProperty(error, "name", {
                value: envelope.name,
                enumerable: false,
                configurable: false,
                writable: false,
              });
              throw error;
            }
            return envelope.result;
          },
        };
      },
    };
    try {
      const result = await Reflect.apply(
        FlarexPointMutationInternalCallExactRuntimeV1.prototype.run,
        {},
        [input, journal],
      );
      return Response.json({ ok: true, result });
    } catch (error) {
      const applicationError = captureCoreApplicationErrorV1(error);
      if (applicationError !== null) {
        return Response.json({ ok: false, applicationError });
      }
      const reason = error?.name === "PointMutationInternalCallExactRuntimeJournalBoundaryV1Error"
        ? "journalBoundaryFailed"
        : "userCodeFailed";
      return Response.json({
        ok: false,
        reason,
        name: error?.name,
        message: error?.message,
        causeName: error?.cause?.name,
        causeMessage: error?.cause?.message,
      });
    }
  },
};`;
}

function serializePointMutationRequest(request: PointMutationExactRuntimeRequestV1) {
  return Object.freeze({
    ...request,
    context: Object.freeze({
      ...request.context,
      randomSeed: Array.from(request.context.randomSeed),
    }),
  });
}

function pointMutationRpcResponse(value: unknown): Response {
  return new Response(
    JSON.stringify(value, (_key, member: unknown) =>
      typeof member === "bigint" ? member.toString() : member
    ),
    { headers: { "content-type": "application/json" } },
  );
}

function sessionTargetWithProofFaults(
  target: LocatedScopeClockReader,
  proofController: Fsv06CompositionProofControllerV1,
): LocatedScopeClockReader {
  const runner = Reflect.get(target, RUN_LOCATED_READ_COMMITTED_V1);
  if (typeof runner !== "function") return target;
  return Object.freeze({
    ...target,
    [RUN_LOCATED_READ_COMMITTED_V1]: async <Result>(
      work: Parameters<RunLocatedReadCommittedTransactionV1>[0],
    ): Promise<Result> => {
      let result: Result;
      try {
        result = await Reflect.apply(runner, target, [work]) as Result;
      } catch (cause) {
        if (isNonArrayRecord(cause) && cause.code === "40001") {
          throw new LocatedReadCommittedTransactionFailureV1({
            kind: "callbackRolledBack",
            callbackCause: cause,
          });
        }
        throw cause;
      }
      if (proofController.loseCommitResponseAfterSettlement) {
        proofController.loseCommitResponseAfterSettlement = false;
        throw new LocatedReadCommittedTransactionFailureV1({
          kind: "decisionUncertain",
          settlementCause: new Error("injected lost commit response"),
        });
      }
      return result;
    },
  });
}

function transactionBlock(): TransactionBlockV1 {
  let markReached: () => void = () => undefined;
  let release: () => void = () => undefined;
  const reached = new Promise<void>(resolve => {
    markReached = resolve;
  });
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  return Object.freeze({ reached, markReached, released, release });
}

function disposableResponse(
  response: PointMutationExactRuntimeHostResponseV2,
): PointMutationExactRuntimeHostResponseV2 & Disposable {
  return Object.freeze({ ...response, [Symbol.dispose]: () => undefined });
}

function unavailableSplitReceipt() {
  return Object.freeze({
    getScopeAuthorityProvisioningReceipt: async () => {
      throw new Error("FSV06 shared placement must not read split receipts.");
    },
  });
}

function uuidFactory(prefix: "f6060000" | "f6160000"): () => string {
  let sequence = 1;
  return () => `${prefix}-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;
}

async function durableCounts(persistence: Persistence) {
  const rows = await persistence.query<{
    current_rows: string;
    live_rows: string;
    commits: string;
    outcomes: string;
    feed: string;
    outbox: string;
  }>(`select
    (select count(*)::text from fx_app_row_current) as current_rows,
    (select count(*)::text
       from fx_app_row_current as current_row
       join fx_app_row_rev as revision
         on revision.scope_uuid = current_row.scope_uuid
        and revision.table_id = current_row.table_id
        and revision.row_id = current_row.row_id
        and revision.commit_seq = current_row.commit_seq
      where revision.value_json is not null) as live_rows,
    (select count(*)::text from fx_system_commit) as commits,
    (select count(*)::text from fx_system_idempotency) as outcomes,
    (select count(*)::text from fx_system_commit_app_row_change) as feed,
    (select count(*)::text from fx_system_outbox) as outbox`);
  const row = rows.rows[0];
  if (row === undefined) throw new Error("FSV06 durable counts are missing.");
  return Object.freeze({
    currentRows: Number(row.current_rows),
    liveRows: Number(row.live_rows),
    commits: Number(row.commits),
    outcomes: Number(row.outcomes),
    feed: Number(row.feed),
    outbox: Number(row.outbox),
  });
}

async function durableAgreement(
  persistence: Persistence,
  scopeUuid: string,
) {
  const current = await persistence.query<{
    commit_seq: string;
    value_json: unknown;
  }>(`select current_row.commit_seq::text, revision.value_json
      from fx_app_row_current as current_row
      join fx_app_row_rev as revision
        on revision.scope_uuid = current_row.scope_uuid
        and revision.table_id = current_row.table_id
        and revision.row_id = current_row.row_id
        and revision.commit_seq = current_row.commit_seq
      where current_row.scope_uuid = $1`, [scopeUuid]);
  const row = current.rows[0];
  if (row === undefined || current.rows.length !== 1) {
    throw new Error("FSV06 authoritative current row was not unique.");
  }
  const commits = await persistence.query<{ commit_seq: string }>(
    `select commit_seq::text from fx_system_commit
      where scope_uuid = $1 order by commit_seq`,
    [scopeUuid],
  );
  const changes = await persistence.query<{ commit_seq: string }>(
    `select commit_seq::text from fx_system_commit_app_row_change
      where scope_uuid = $1 order by commit_seq, change_ordinal`,
    [scopeUuid],
  );
  const outcomes = await persistence.query<{ commit_seq: string }>(
    `select commit_seq::text from fx_system_idempotency
      where scope_uuid = $1 order by commit_seq`,
    [scopeUuid],
  );
  const outbox = await persistence.query<{ commit_seq: string }>(
    `select commit_seq::text from fx_system_outbox
      where scope_uuid = $1 order by outbox_seq`,
    [scopeUuid],
  );
  return Object.freeze({
    currentCommitSeq: row.commit_seq,
    currentValue: structuredClone(row.value_json),
    commitSeqs: Object.freeze(commits.rows.map(item => item.commit_seq)),
    changeCommitSeqs: Object.freeze(changes.rows.map(item => item.commit_seq)),
    outcomeCommitSeqs: Object.freeze(outcomes.rows.map(item => item.commit_seq)),
    outboxCommitSeqs: Object.freeze(outbox.rows.map(item => item.commit_seq)),
  });
}

function failureTag(value: unknown): string | undefined {
  return value !== null && typeof value === "object" && "_tag" in value &&
      typeof value._tag === "string"
    ? value._tag
    : value instanceof Error ? value.name : undefined;
}

function errorName(value: unknown): string {
  return value instanceof Error ? value.name : failureTag(value) ?? "Error";
}

function errorMessage(value: unknown): string {
  return value instanceof Error
    ? value.message
    : isNonArrayRecord(value) && typeof value.message === "string"
      ? value.message
      : String(value);
}
