import { isNonArrayRecord } from "@flarex/utils/records";
import { Cause, Effect, Exit, Fiber, Layer, Result, Scope } from "effect";
import {
  executePointMutationV1,
  inspectPointMutationRuntimeFailureV1,
  type PointMutationRuntimeDatabaseV1,
} from "../../function-runtime/src/pointMutation";
import {
  claimCandidateBoundPointMutationRuntimeTargetV1,
} from "../../flarex-backend/src/artifactRuntime/CandidateBoundPointMutationRuntimeTargetV1";
import {
  POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
  type PointMutationExactRuntimeWorkerDefinitionV1,
} from "../../flarex-backend/src/artifactRuntime/PointMutationExactRuntimeHost";
import {
  makePointMutationTransactionGrantIssuerV1,
} from "../../flarex-backend/src/transactionGrantIssuer";
import {
  createTransactionGrantVerificationKeyNamespaceV1,
  createTransactionGrantVerifierV1,
} from "../../executor/src/transactionGrant";
import type { PointMutationJournalRpcParentTargetV1 } from
  "../../executor/src/pointMutationJournalRpc";
import {
  POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
  POINT_MUTATION_EXACT_RUNTIME_RESULT_VERSION_V1,
  type PointMutationExactRuntimeRequestV1,
} from "flarex-protocol/point-mutation-exact-runtime";
import {
  POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
  POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V1,
  type PointMutationExactRuntimeHostResponseV1,
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
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeValueV1,
  type CanonicalFlarexRuntimeObjectV1,
} from "flarex-protocol/value";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type RunLocatedReadCommittedTransactionV1,
} from "../src/transactionSessionAttemptKernel";
import type { LocatedScopeClockReader } from
  "../src/scopeAuthorityResolution";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from
  "../src/intrinsicCreationTimeIndexBuildV1";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { PointCommitTransactionProofStepV1 } from
  "../src/pointCommitTransaction";
import {
  activateApplicationRevisionV1,
  claimActiveApplicationRevisionInvocationBasisV1,
  readActiveApplicationRevisionV1,
} from "../src/applicationRevisionActivationV1";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from
  "../src/transactionSessionActivation";
import {
  ApplicationPointMutationRouteIndependentDispatcherV1Error,
  invokeApplicationPointMutationV1,
  makeApplicationPointMutationSystemV1Layer,
  ApplicationPointMutationSystemV1,
  type ApplicationPointMutationSystemLiveV1,
} from "../../standard-application-invocation/src/systemV1";
import {
  invokeStandardApplicationPointMutationV1,
  makeStandardApplicationActiveRevisionReaderV1Layer,
  StandardApplicationActiveRevisionReaderV1,
} from "../../standard-application-invocation/src/v1";
import {
  FSV05_SUPPORTED_LOCATOR,
  prepareFsv05ReadyRevisionFixtureV1,
  type Fsv05ApplicationRevisionActivationLaneV1,
} from "./fsv05ApplicationRevisionActivationHarness";
import { makeRuntimeArtifactPublisherFixtureV1 } from
  "./runtimeArtifactPublisherFixture";

type Persistence = PGliteFlarexPersistence | PostgresFlarexPersistence;

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
  const artifacts = makeRuntimeArtifactPublisherFixtureV1();
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

function systemLive(
  lane: Fsv06StandardPointMutationLaneV1,
  deploymentId: ApplicationPointMutationSystemLiveV1["deploymentId"],
  artifacts: ReturnType<typeof makeRuntimeArtifactPublisherFixtureV1>,
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
        claimCandidateBoundPointMutationRuntimeTargetV1(target),
      ).pipe(Effect.mapError(cause =>
        new ApplicationPointMutationRouteIndependentDispatcherV1Error({
          reason: "targetRejected",
          cause,
        })
      ));
      const source = yield* applicationSourceFromExactDefinition(
        claimed.definition,
      );
      const modulePromise = importSourceModule(source);
      return Object.freeze({
        run: async (
          request: PointMutationExactRuntimeRequestV1,
          journal: PointMutationJournalRpcParentTargetV1,
        ) => {
          onRuntimeExecution();
          const loaded = await modulePromise;
          const exportName = request.function.path.slice(
            request.function.path.lastIndexOf(":") + 1,
          );
          try {
            const invocation = invocationBinding(request, journal);
            const value = await loaded.withPlatform(
              invocation.platform,
              () => executePointMutationV1(
                {
                  function: request.function,
                  arguments: request.arguments,
                  tables: request.tables,
                },
                {
                  resolve: () => Object.freeze({
                    isMutation: true,
                    isPublic: true,
                    _handler: loaded.sourceModule[exportName],
                  }),
                },
                invocation.factory,
              ),
            );
            const afterRuntime = proofController.afterRuntimeOnce;
            if (afterRuntime !== undefined) {
              delete proofController.afterRuntimeOnce;
              await afterRuntime();
            }
            return disposableResponse({
              format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
              version: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V1,
              kind: "success",
              result: {
                format: POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
                version: POINT_MUTATION_EXACT_RUNTIME_RESULT_VERSION_V1,
                value,
              },
            });
          } catch (cause) {
            const failure = inspectPointMutationRuntimeFailureV1(cause);
            return disposableResponse({
              format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
              version: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V1,
              kind: "failure",
              reason: failure?.kind === "journalBoundary"
                ? "journalBoundaryFailed"
                : "userCodeFailed",
            });
          }
        },
      });
    }),
  });
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

function applicationSourceFromExactDefinition(
  definition: PointMutationExactRuntimeWorkerDefinitionV1,
): Effect.Effect<
  string,
  ApplicationPointMutationRouteIndependentDispatcherV1Error
> {
  const bridge = definition.modules[
    POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1
  ];
  if (bridge === undefined) {
    return Effect.fail(
      new ApplicationPointMutationRouteIndependentDispatcherV1Error({
        reason: "unavailable",
        cause: new Error("The exact runtime definition omitted its execution bridge."),
      }),
    );
  }
  const match = /import \* as applicationModuleV1 from ("(?:[^"\\]|\\.)+");/.exec(
    bridge,
  );
  if (match?.[1] === undefined) {
    return Effect.fail(
      new ApplicationPointMutationRouteIndependentDispatcherV1Error({
        reason: "targetRejected",
        cause: new Error("The exact runtime execution bridge was not canonical."),
      }),
    );
  }
  return Effect.try({
    try: () => {
      const specifier = JSON.parse(match[1]) as unknown;
      if (typeof specifier !== "string") {
        throw new Error("The exact runtime execution bridge import was invalid.");
      }
      const resolved = new URL(
        specifier,
        `https://flarex-runtime.invalid/${POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1}`,
      ).pathname.slice(1);
      const source = definition.modules[resolved];
      if (source === undefined) {
        throw new Error(`The exact runtime definition omitted ${resolved}.`);
      }
      return source;
    },
    catch: cause =>
      new ApplicationPointMutationRouteIndependentDispatcherV1Error({
        reason: "targetRejected",
        cause,
      }),
  });
}

function invocationBinding(
  request: PointMutationExactRuntimeRequestV1,
  journal: PointMutationJournalRpcParentTargetV1,
) {
  let sequence = 0;
  const tableNameForDocument = (documentId: string): string => {
    const tableId = Number(documentId.slice(0, documentId.indexOf(":")));
    const table = request.tables.find(candidate => candidate.tableId === tableId);
    if (table === undefined) throw new Error("Unknown document table.");
    return table.logicalName;
  };
  const run = async (
    tableName: string,
    operation: (syscallSequence: string) => object,
  ) => {
    const table = await journal.resolvePointTable(tableName);
    const result = await table.runPointOperation(
      operation(String(sequence + 1)),
    );
    sequence += 1;
    return result;
  };
  const db = Object.freeze({
    get: async (
      documentId: string,
    ): Promise<CanonicalFlarexRuntimeObjectV1 | null> => {
      const result = await run(tableNameForDocument(documentId), sequence => ({
        kind: "get",
        syscallSequence: sequence,
        documentId,
      }));
      if (result.kind !== "present") return null;
      if (!isCanonicalFlarexRuntimeObjectV1(result.document)) {
        throw new Error("Point get returned a non-document value.");
      }
      return result.document;
    },
    insert: async (tableName: string, fields: unknown): Promise<string> => {
      const result = await run(tableName, sequence => ({
        kind: "insert",
        syscallSequence: sequence,
        fields,
      }));
      if (result.kind !== "inserted") throw new Error("Insert did not settle.");
      return result.documentId;
    },
    patch: async (documentId: string, patch: unknown): Promise<void> => {
      const result = await run(tableNameForDocument(documentId), sequence => ({
        kind: "patch",
        syscallSequence: sequence,
        documentId,
        patch,
      }));
      if (result.kind !== "unit") throw new Error("Patch did not settle.");
    },
    replace: async (documentId: string, fields: unknown): Promise<void> => {
      const result = await run(tableNameForDocument(documentId), sequence => ({
        kind: "replace",
        syscallSequence: sequence,
        documentId,
        fields,
      }));
      if (result.kind !== "unit") throw new Error("Replace did not settle.");
    },
    delete: async (documentId: string): Promise<void> => {
      const result = await run(tableNameForDocument(documentId), sequence => ({
        kind: "delete",
        syscallSequence: sequence,
        documentId,
      }));
      if (result.kind !== "unit") throw new Error("Delete did not settle.");
    },
    query: () => { throw new Error("Queries are outside FSV06."); },
    normalizeId: () => { throw new Error("normalizeId is outside FSV06."); },
    system: Object.freeze({}),
  }) satisfies PointMutationRuntimeDatabaseV1;
  return Object.freeze({
    factory: Object.freeze({
      open: () => Object.freeze({
        context: Object.freeze({
          auth: Object.freeze({ getUserIdentity: async () => null }),
          db,
        }),
        journal: Object.freeze({
          close: () => undefined,
          drain: async () => undefined,
        }),
      }),
    }),
    platform: Object.freeze({
      databaseInsert: db.insert,
      databasePatch: db.patch,
    }),
  });
}

interface TestPlatformBindingV1 {
  readonly databaseInsert: PointMutationRuntimeDatabaseV1["insert"];
  readonly databasePatch: PointMutationRuntimeDatabaseV1["patch"];
}

interface ImportedSourceModuleV1 {
  readonly sourceModule: Readonly<Record<string, unknown>>;
  readonly withPlatform: (
    platform: TestPlatformBindingV1,
    effect: () => Promise<CanonicalFlarexRuntimeValueV1>,
  ) => Promise<CanonicalFlarexRuntimeValueV1>;
}

async function importSourceModule(source: string): Promise<ImportedSourceModuleV1> {
  const platformSource = [
    "import{AsyncLocalStorage as A}from'node:async_hooks';",
    "const s=new A;",
    "export function databaseInsert(...a){const p=s.getStore();if(!p)throw Error();return p.databaseInsert(...a)}",
    "export function databasePatch(...a){const p=s.getStore();if(!p)throw Error();return p.databasePatch(...a)}",
    "export function withPlatform(p,f){return s.run(p,f)}",
  ].join("");
  const platformUrl = `data:text/javascript;base64,${
    Buffer.from(platformSource, "utf8").toString("base64")
  }`;
  const resolvedSource = source.replace(
    /(['"])flarex:platform\1/,
    JSON.stringify(platformUrl),
  );
  if (resolvedSource === source) {
    throw new Error("FSV06 source omitted its authenticated platform import.");
  }
  const encoded = Buffer.from(resolvedSource, "utf8").toString("base64");
  const sourceModule: unknown = await import(
    /* @vite-ignore */ `data:text/javascript;base64,${encoded}`
  );
  const platformModule: unknown = await import(
    /* @vite-ignore */ platformUrl
  );
  if (
    !isNonArrayRecord(sourceModule) ||
    !isNonArrayRecord(platformModule) ||
    typeof platformModule.withPlatform !== "function"
  ) {
    throw new Error("FSV06 source module namespace was invalid.");
  }
  const withPlatform = platformModule.withPlatform;
  return Object.freeze({
    sourceModule: Object.freeze(Object.fromEntries(Object.entries(sourceModule))),
    withPlatform: async (
      platform: TestPlatformBindingV1,
      effect: () => Promise<CanonicalFlarexRuntimeValueV1>,
    ) => normalizeFlarexValueV1(
      await Promise.resolve(
        Reflect.apply(withPlatform, undefined, [platform, effect]),
      ),
    ).value,
  });
}

function disposableResponse(
  response: PointMutationExactRuntimeHostResponseV1,
): PointMutationExactRuntimeHostResponseV1 & Disposable {
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
    commits: string;
    outcomes: string;
    feed: string;
    outbox: string;
  }>(`select
    (select count(*)::text from fx_app_row_current) as current_rows,
    (select count(*)::text from fx_system_commit) as commits,
    (select count(*)::text from fx_system_idempotency) as outcomes,
    (select count(*)::text from fx_system_commit_app_row_change) as feed,
    (select count(*)::text from fx_system_outbox) as outbox`);
  const row = rows.rows[0];
  if (row === undefined) throw new Error("FSV06 durable counts are missing.");
  return Object.freeze({
    currentRows: Number(row.current_rows),
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
