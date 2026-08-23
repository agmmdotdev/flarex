import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import {
  createApplicationMutationGrantVerificationKernelV1,
} from
  "@flarex/executor/internal/application-mutation-grant-verification-kernel";
import {
  createTransactionGrantVerificationKeyNamespaceV1,
  createTransactionGrantVerifierV1,
} from "@flarex/executor/transaction-grant";
import {
  createApplicationNativeMutationPGliteFixture,
  type ApplicationNativeMutationFixture,
  type ApplicationNativeMutationPersistence,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import {
  selectApplicationMutationAdmission,
  type SelectApplicationMutationAdmissionError,
} from
  "@flarex/persistence-postgres/internal/application-mutation-admission";
import {
  ApplicationMutationSystemConfigurationError,
  ApplicationMutationSystem,
  type ApplicationMutationSystemLive,
  makeApplicationMutationSystemLayer,
} from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import {
  invokeStandardApplicationPointMutationV1,
  type InvokeStandardApplicationPointMutationV1Error,
} from "@flarex/standard-application-invocation/v1";
import { Effect, Result, Scope } from "effect";
import {
  APPLICATION_RUNTIME_HOST_IDENTITY,
} from "flarex-backend/artifact-runtime";
import type { ApplicationAnalysisSourceBundle } from
  "flarex-backend/internal/application-analysis-source-reader";
import {
  makeApplicationExecutionHost,
} from "flarex-backend/internal/application-execution-host";
import {
  makeApplicationMutationGrantIssuer,
} from "flarex-backend/internal/application-mutation-grant-issuer";
import {
  APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
  type ApplicationMutationGrantVerificationKeyV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import {
  EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
  EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
  encodeEdgeActionHostPolicyV1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";
import {
  APPLICATION_WORKER_RESULT_FORMAT_V1,
  APPLICATION_WORKER_RESULT_VERSION_V1,
} from "flarex-protocol/internal/application-worker-v1";
import { makeGrantRetentionPolicyV1Result } from
  "flarex-protocol/grant-retention-policy";
import {
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAuthorizationGrantIdV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { runSystemTestEffectV1 } from "./systemTestEffectBoundaryV1";

const COMPATIBILITY_DATE = "2026-06-14";
const RETENTION = Result.getOrThrow(makeGrantRetentionPolicyV1Result({
  maximumGrantLifetimeMilliseconds: 120_000,
  maximumFutureIssuedAtSkewMilliseconds: 30_000,
  maximumLiveSnapshotRetentionMilliseconds: 600_000,
}));

export interface ApplicationNativeMutationProof {
  readonly initialCommit: ApplicationNativeMutationInitialCommitObservation;
  readonly validationCatch: ApplicationNativeMutationValidationCatchObservation;
  readonly concurrentDuplicate: ApplicationNativeMutationConcurrentDuplicateObservation;
  readonly occConflict: ApplicationNativeMutationOccConflictObservation;
  readonly headMovement: ApplicationNativeMutationHeadMovementObservation;
  readonly terminalization: ApplicationNativeMutationTerminalizationObservation;
  readonly candidateSchemaWriteGuard: ApplicationNativeMutationCandidateSchemaWriteGuardObservation;
  readonly freshWorkerLoads: number;
  readonly commitCount: number;
  readonly outcomeCount: number;
  readonly feedCount: number;
  readonly outboxCount: number;
}

export interface ApplicationNativeMutationPublishedObservation {
  readonly disposition: "published";
  readonly value: string;
  readonly commitSeq: bigint;
  readonly workerLoads: number;
}

export interface ApplicationNativeMutationReplayObservation {
  readonly disposition: "replayed";
  readonly commitSeq: bigint;
  readonly workerLoads: number;
}

type ApplicationNativeMutationRequestKeyReuseError = Extract<
  InvokeStandardApplicationPointMutationV1Error,
  { readonly _tag: "CommittedPointOutcomeRequestKeyReuseErrorV1" }
>;

export type ApplicationNativeMutationConflictingRequestKeyObservation =
  | {
    readonly disposition: "accepted";
    readonly outcomeDisposition: "published" | "replayed";
  }
  | {
    readonly disposition: "rejected";
    readonly errorTag: ApplicationNativeMutationRequestKeyReuseError["_tag"];
    readonly mismatches:
      ApplicationNativeMutationRequestKeyReuseError["mismatches"];
  };

export interface ApplicationNativeMutationInitialCommitObservation {
  readonly publication: ApplicationNativeMutationPublishedObservation;
  readonly replay: ApplicationNativeMutationReplayObservation;
  readonly conflictingRequestKey:
    ApplicationNativeMutationConflictingRequestKeyObservation;
}

export interface ApplicationNativeMutationValidationCatchObservation {
  readonly disposition: "published";
  readonly caughtValidationCount: number;
  readonly commitSeq: bigint;
  readonly workerLoads: number;
}

type ApplicationNativeMutationOutcomeUnavailableError = Extract<
  InvokeStandardApplicationPointMutationV1Error,
  { readonly _tag: "ApplicationMutationOutcomeUnavailableError" }
>;

export type ApplicationNativeMutationDuplicateContenderObservation =
  | {
    readonly disposition: "accepted";
    readonly outcomeDisposition: "published" | "replayed";
  }
  | {
    readonly disposition: "rejected";
    readonly errorTag: ApplicationNativeMutationOutcomeUnavailableError["_tag"];
    readonly reason: ApplicationNativeMutationOutcomeUnavailableError["reason"];
  };

export interface ApplicationNativeMutationDuplicateCommitObservation {
  readonly disposition: "published" | "replayed";
  readonly commitSeq: bigint;
  readonly workerLoads: number;
}

export interface ApplicationNativeMutationConcurrentDuplicateObservation {
  readonly contender: ApplicationNativeMutationDuplicateContenderObservation;
  readonly workerLoadsBeforeRelease: number;
  readonly publication: ApplicationNativeMutationDuplicateCommitObservation;
  readonly replay: ApplicationNativeMutationDuplicateCommitObservation;
}

export interface ApplicationNativeMutationOccExecutionObservation {
  readonly ordinal: number;
  readonly revisionId: string;
}

export interface ApplicationNativeMutationOccCommitObservation {
  readonly disposition: "published";
  readonly commitSeq: bigint;
  readonly workerLoads: number;
}

export interface ApplicationNativeMutationOccConflictObservation {
  readonly admittedRevisionId: string;
  readonly workerLoadsBeforeCompetitor: number;
  readonly competitor: ApplicationNativeMutationOccCommitObservation;
  readonly rerun: ApplicationNativeMutationOccCommitObservation;
  readonly conflictReadCount: number;
  readonly executions:
    ReadonlyArray<ApplicationNativeMutationOccExecutionObservation>;
}

type ApplicationNativeMutationActivationError = Extract<
  SelectApplicationMutationAdmissionError,
  { readonly _tag: "ApplicationActivationError" }
>;

export type ApplicationNativeMutationStaleAdmissionObservation =
  | {
    readonly disposition: "accepted";
    readonly revisionId: string;
  }
  | {
    readonly disposition: "rejected";
    readonly errorTag: ApplicationNativeMutationActivationError["_tag"];
    readonly operation: ApplicationNativeMutationActivationError["operation"];
    readonly reason: ApplicationNativeMutationActivationError["reason"];
    readonly revisionId: ApplicationNativeMutationActivationError["revisionId"];
    readonly retryable: ApplicationNativeMutationActivationError["retryable"];
  };

export interface ApplicationNativeMutationPinnedHeadPublicationObservation {
  readonly disposition: "published";
  readonly commitSeq: bigint;
  readonly workerLoads: number;
}

export interface ApplicationNativeMutationHeadMovementObservation {
  readonly pinnedRevisionId: string;
  readonly movedRevisionId: string;
  readonly staleAdmission: ApplicationNativeMutationStaleAdmissionObservation;
  readonly workerLoadsBeforeRelease: number;
  readonly publication: ApplicationNativeMutationPinnedHeadPublicationObservation;
  readonly executionRevisionIds: ReadonlyArray<string>;
}

export interface ApplicationNativeMutationDurableCountsObservation {
  readonly commits: number;
  readonly outcomes: number;
  readonly feed: number;
  readonly outbox: number;
}

type ApplicationNativeMutationJournalTerminalError = Extract<
  InvokeStandardApplicationPointMutationV1Error,
  { readonly _tag: "PinnedPointTableNotFoundV1Error" }
>;

export type ApplicationNativeMutationJournalTerminalOutcomeObservation =
  | {
    readonly disposition: "accepted";
    readonly outcomeDisposition: "published" | "replayed";
    readonly commitSeq: bigint;
  }
  | {
    readonly disposition: "rejected";
    readonly errorTag: ApplicationNativeMutationJournalTerminalError["_tag"];
    readonly deploymentId:
      ApplicationNativeMutationJournalTerminalError["deploymentId"];
    readonly schemaVersionId:
      ApplicationNativeMutationJournalTerminalError["schemaVersionId"];
    readonly tableName: ApplicationNativeMutationJournalTerminalError["tableName"];
  };

type ApplicationNativeMutationUserCodeTerminalError = Extract<
  InvokeStandardApplicationPointMutationV1Error,
  { readonly _tag: "PointMutationOccUserCodeV1Error" }
>;

export type ApplicationNativeMutationUserCodeCauseObservation =
  | {
    readonly kind: "error";
    readonly name: string;
    readonly message: string;
  }
  | {
    readonly kind: "nonError";
    readonly valueType: string;
  };

export type ApplicationNativeMutationUserCodeTerminalOutcomeObservation =
  | {
    readonly disposition: "accepted";
    readonly outcomeDisposition: "published" | "replayed";
    readonly commitSeq: bigint;
  }
  | {
    readonly disposition: "rejected";
    readonly errorTag: ApplicationNativeMutationUserCodeTerminalError["_tag"];
    readonly cause: ApplicationNativeMutationUserCodeCauseObservation;
  };

export interface ApplicationNativeMutationTerminalFailureObservation<Outcome> {
  readonly outcome: Outcome;
  readonly before: ApplicationNativeMutationDurableCountsObservation;
  readonly after: ApplicationNativeMutationDurableCountsObservation;
  readonly workerLoads: number;
}

export interface ApplicationNativeMutationTerminalizationObservation {
  readonly journal: ApplicationNativeMutationTerminalFailureObservation<
    ApplicationNativeMutationJournalTerminalOutcomeObservation
  >;
  readonly userCode: ApplicationNativeMutationTerminalFailureObservation<
    ApplicationNativeMutationUserCodeTerminalOutcomeObservation
  >;
}

export type ApplicationNativeMutationConfigurationObservation =
  | { readonly disposition: "accepted" }
  | {
    readonly disposition: "rejected";
    readonly errorTag: "ApplicationMutationSystemConfigurationError";
    readonly reason: ApplicationMutationSystemConfigurationError["reason"];
  };

export interface ApplicationNativeMutationCandidateSchemaWriteGuardObservation {
  readonly exact: ApplicationNativeMutationConfigurationObservation;
  readonly copied: ApplicationNativeMutationConfigurationObservation;
  readonly foreignAuthority: ApplicationNativeMutationConfigurationObservation;
  readonly missing: ApplicationNativeMutationConfigurationObservation;
}

export type ApplicationNativeMutationFixtureFactory = () => Promise<
  ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>
>;

export async function proveApplicationNativeMutation(
  createFixture: ApplicationNativeMutationFixtureFactory = () =>
    createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
    }),
): Promise<
  ApplicationNativeMutationProof
> {
  const fixture = await createFixture();
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    fixture.deploymentId,
  );
  const loader = new ApplicationNativeWorkerLoader();
  const live = await makeApplicationNativeMutationTestLive(fixture, loader);
  const layer = makeApplicationMutationSystemLayer(live);
  const candidateSchemaWriteGuard:
    ApplicationNativeMutationCandidateSchemaWriteGuardObservation = Object.freeze({
      exact: Object.freeze({ disposition: "accepted" }),
      copied: observeApplicationMutationConfiguration(() =>
        makeApplicationMutationSystemLayer(Object.freeze({
          ...live,
          candidateSchemaWriteGuard: Object.freeze({
            ...live.candidateSchemaWriteGuard,
          }),
        }))
      ),
      foreignAuthority: observeApplicationMutationConfiguration(() =>
        makeApplicationMutationSystemLayer(Object.freeze({
          ...live,
          sessionAuthority: Object.freeze({ ...live.sessionAuthority }),
        }))
      ),
      missing: observeApplicationMutationConfiguration(() => {
        const {
          candidateSchemaWriteGuard: _omittedCandidateSchemaWriteGuard,
          ...missingCandidateGuardLive
        } = live;
        // @ts-expect-error Deliberately exercise a missing required capability.
        makeApplicationMutationSystemLayer(missingCandidateGuardLive);
      }),
    });
  const invoke = <A, E>(effect: Effect.Effect<
    A,
    E,
    ApplicationMutationSystem | Scope.Scope
  >) => runSystemTestEffectV1(
    Effect.scoped(effect.pipe(Effect.provide(layer))),
  );
  const create = TransactionFunctionPathV1Schema.make("users:create");
  const firstKey = TransactionRequestKeyV1Schema.make(
    "application-native:create:1",
  );
  const published = await invoke(invokeStandardApplicationPointMutationV1(
    create,
    { name: "Ada" },
    firstKey,
  ));
  if (published.disposition !== "published" || typeof published.value !== "string") {
    throw new Error("Application-native mutation was not published.");
  }
  const loadsAfterPublish = loader.loads;
  const publication: ApplicationNativeMutationPublishedObservation = Object.freeze({
    disposition: published.disposition,
    value: published.value,
    commitSeq: published.commitSeq,
    workerLoads: loadsAfterPublish,
  });
  const replayed = await invoke(invokeStandardApplicationPointMutationV1(
    create,
    { name: "Ada" },
    firstKey,
  ));
  if (
    replayed.disposition !== "replayed" ||
    replayed.commitSeq !== published.commitSeq ||
    loader.loads !== loadsAfterPublish
  ) throw new Error("Application-native replay re-executed the Worker.");
  const replay: ApplicationNativeMutationReplayObservation = Object.freeze({
    disposition: replayed.disposition,
    commitSeq: replayed.commitSeq,
    workerLoads: loader.loads,
  });
  const conflictingRequestKey:
    ApplicationNativeMutationConflictingRequestKeyObservation = await invoke(
      invokeStandardApplicationPointMutationV1(
        create,
        { name: "Different" },
        firstKey,
      ).pipe(
        Effect.map(outcome => Object.freeze({
          disposition: "accepted",
          outcomeDisposition: outcome.disposition,
        })),
        Effect.catchTag(
          "CommittedPointOutcomeRequestKeyReuseErrorV1",
          error => Effect.succeed(Object.freeze({
            disposition: "rejected",
            errorTag: error._tag,
            mismatches: Object.freeze([...error.mismatches]),
          })),
        ),
      ),
    );
  if (conflictingRequestKey.disposition !== "rejected") {
    throw new Error("Application-native mutation accepted conflicting replay.");
  }
  const initialCommit: ApplicationNativeMutationInitialCommitObservation =
    Object.freeze({ publication, replay, conflictingRequestKey });
  loader.mode = "catchValidation";
  const caught = await invoke(invokeStandardApplicationPointMutationV1(
    create,
    { name: "Grace" },
    TransactionRequestKeyV1Schema.make("application-native:create:2"),
  ));
  if (caught.disposition !== "published" || loader.caughtValidation !== 1) {
    throw new Error("Application validation failure was not catchable.");
  }
  const validationCatch: ApplicationNativeMutationValidationCatchObservation =
    Object.freeze({
      disposition: caught.disposition,
      caughtValidationCount: loader.caughtValidation,
      commitSeq: caught.commitSeq,
      workerLoads: loader.loads,
    });

  const duplicateBlock = loader.blockNextInvocation();
  const duplicateKey = TransactionRequestKeyV1Schema.make(
    "application-native:create:duplicate",
  );
  const duplicateFirst = invoke(invokeStandardApplicationPointMutationV1(
    create,
    { name: "Concurrent" },
    duplicateKey,
  ));
  await duplicateBlock.started;
  let duplicateContender:
    ApplicationNativeMutationDuplicateContenderObservation;
  try {
    duplicateContender = await invoke(
      invokeStandardApplicationPointMutationV1(
        create,
        { name: "Concurrent" },
        duplicateKey,
      ).pipe(
        Effect.map(outcome => Object.freeze({
          disposition: "accepted",
          outcomeDisposition: outcome.disposition,
        })),
        Effect.catchTag(
          "ApplicationMutationOutcomeUnavailableError",
          error => Effect.succeed(Object.freeze({
            disposition: "rejected",
            errorTag: error._tag,
            reason: error.reason,
          })),
        ),
      ),
    );
  } catch (cause: unknown) {
    duplicateBlock.release();
    await Promise.allSettled([duplicateFirst]);
    throw cause;
  }
  const workerLoadsBeforeRelease = loader.loads;
  duplicateBlock.release();
  const duplicatePublished = await duplicateFirst;
  const workerLoadsAfterPublication = loader.loads;
  if (
    duplicateContender.disposition !== "rejected" ||
    duplicateContender.reason !== "inProgress"
  ) {
    const contenderDetail = duplicateContender.disposition === "rejected"
      ? `${duplicateContender.errorTag}/${duplicateContender.reason}`
      : `accepted/${duplicateContender.outcomeDisposition}`;
    throw new Error(
      `Concurrent Application duplicate was not in progress: ${contenderDetail}.`,
    );
  }
  const duplicateReplay = await invoke(
    invokeStandardApplicationPointMutationV1(
      create,
      { name: "Concurrent" },
      duplicateKey,
    ),
  );
  const concurrentDuplicateReplay =
    duplicatePublished.disposition === "published" &&
    duplicateReplay.disposition === "replayed" &&
    duplicateReplay.commitSeq === duplicatePublished.commitSeq &&
    workerLoadsAfterPublication === workerLoadsBeforeRelease &&
    loader.loads === workerLoadsAfterPublication;
  if (!concurrentDuplicateReplay) {
    throw new Error("Concurrent Application duplicate did not replay.");
  }
  const concurrentDuplicate: ApplicationNativeMutationConcurrentDuplicateObservation =
    Object.freeze({
      contender: duplicateContender,
      workerLoadsBeforeRelease,
      publication: Object.freeze({
        disposition: duplicatePublished.disposition,
        commitSeq: duplicatePublished.commitSeq,
        workerLoads: workerLoadsAfterPublication,
      }),
      replay: Object.freeze({
        disposition: duplicateReplay.disposition,
        commitSeq: duplicateReplay.commitSeq,
        workerLoads: loader.loads,
      }),
    });

  const conflictBlock = loader.blockNextInvocation();
  loader.conflictDocumentId = published.value;
  loader.persistentConflictArgumentName = "Conflict winner";
  const conflictReceiptStart = loader.requestReceipts.length;
  const conflictReadStart = loader.conflictReads;
  const conflictKey = TransactionRequestKeyV1Schema.make(
    "application-native:create:conflict",
  );
  const conflictAttempt = invoke(invokeStandardApplicationPointMutationV1(
    create,
    { name: "Conflict winner" },
    conflictKey,
  ));
  await conflictBlock.started;
  const loadsBeforeCompetitor = loader.loads;
  loader.mode = "patchDocument";
  let competitor: Awaited<typeof conflictAttempt>;
  try {
    competitor = await invoke(invokeStandardApplicationPointMutationV1(
      create,
      { name: "Competing commit" },
      TransactionRequestKeyV1Schema.make(
        "application-native:create:competitor",
      ),
    ));
  } catch (cause: unknown) {
    conflictBlock.release();
    await Promise.allSettled([conflictAttempt]);
    throw cause;
  }
  const workerLoadsAfterCompetitor = loader.loads;
  if (competitor.disposition !== "published") {
    conflictBlock.release();
    await Promise.allSettled([conflictAttempt]);
    throw new Error(
      `Application OCC competitor did not publish: ${competitor.disposition}.`,
    );
  }
  conflictBlock.release();
  const conflictPublished = await conflictAttempt;
  const workerLoadsAfterRerun = loader.loads;
  const conflictReadCount = loader.conflictReads - conflictReadStart;
  const conflictReceipts = loader.requestReceipts.slice(conflictReceiptStart)
    .filter(receipt => receipt.argumentName === "Conflict winner");
  const occConflictReran = conflictPublished.disposition === "published" &&
    workerLoadsAfterCompetitor === loadsBeforeCompetitor + 1 &&
    workerLoadsAfterRerun === workerLoadsAfterCompetitor + 1 &&
    conflictReadCount === 2 &&
    conflictReceipts.length === 2 &&
    conflictReceipts.every(receipt =>
      receipt.revisionId === fixture.active.basis.revisionId
    );
  if (!occConflictReran) {
    throw new Error("Application OCC conflict did not rerun in a fresh Worker.");
  }
  const occConflict: ApplicationNativeMutationOccConflictObservation =
    Object.freeze({
      admittedRevisionId: fixture.active.basis.revisionId,
      workerLoadsBeforeCompetitor: loadsBeforeCompetitor,
      competitor: Object.freeze({
        disposition: competitor.disposition,
        commitSeq: competitor.commitSeq,
        workerLoads: workerLoadsAfterCompetitor,
      }),
      rerun: Object.freeze({
        disposition: conflictPublished.disposition,
        commitSeq: conflictPublished.commitSeq,
        workerLoads: workerLoadsAfterRerun,
      }),
      conflictReadCount,
      executions: Object.freeze(conflictReceipts.map((receipt, index) =>
        Object.freeze({
          ordinal: index + 1,
          revisionId: receipt.revisionId,
        })
      )),
    });

  const headBlock = loader.blockNextInvocation();
  const headLoadStart = loader.loads;
  const pinnedRevisionId = fixture.active.basis.revisionId;
  const headAttempt = invoke(invokeStandardApplicationPointMutationV1(
    create,
    { name: "Pinned before head movement" },
    TransactionRequestKeyV1Schema.make(
      "application-native:create:pinned-head",
    ),
  ));
  await headBlock.started;
  let moved: Awaited<ReturnType<typeof fixture.moveHead>>;
  try {
    moved = await fixture.moveHead();
  } catch (cause: unknown) {
    headBlock.release();
    await Promise.allSettled([headAttempt]);
    throw cause;
  }
  if (moved.basis.revisionId === pinnedRevisionId) {
    headBlock.release();
    await Promise.allSettled([headAttempt]);
    throw new Error("Application-native fixture did not move the active head.");
  }
  let staleAdmission: ApplicationNativeMutationStaleAdmissionObservation;
  try {
    staleAdmission = await runSystemTestEffectV1(
      selectApplicationMutationAdmission(
        fixture.active.selection,
        create,
        {
          deploymentId,
          controlDb: fixture.control.drizzle,
          schema: fixture.schema,
          authority: fixture.authorityPorts,
        },
      ).pipe(
        Effect.map(admission => Object.freeze({
          disposition: "accepted" as const,
          revisionId: admission.basis.revisionId,
        })),
        Effect.catchTag(
          "ApplicationActivationError",
          error => Effect.succeed(Object.freeze({
            disposition: "rejected" as const,
            errorTag: error._tag,
            operation: error.operation,
            reason: error.reason,
            revisionId: error.revisionId,
            retryable: error.retryable,
          })),
        ),
      ),
    );
  } catch (cause: unknown) {
    headBlock.release();
    await Promise.allSettled([headAttempt]);
    throw cause;
  }
  if (
    staleAdmission.disposition !== "rejected" ||
    staleAdmission.operation !== "validateSelection" ||
    staleAdmission.reason !== "concurrentHead"
  ) {
    headBlock.release();
    await Promise.allSettled([headAttempt]);
    const staleAdmissionDetail = staleAdmission.disposition === "rejected"
      ? `${staleAdmission.errorTag}/${staleAdmission.operation}/${staleAdmission.reason}`
      : `accepted/${staleAdmission.revisionId}`;
    throw new Error(
      `Application admission accepted the stale active head: ${staleAdmissionDetail}.`,
    );
  }
  const workerLoadsBeforeHeadRelease = loader.loads;
  headBlock.release();
  const pinnedOutcome = await headAttempt;
  const workerLoadsAfterPinnedPublication = loader.loads;
  const headRevisionIds = loader.revisionIds.slice(headLoadStart);
  const admittedHeadStayedPinned = pinnedOutcome.disposition === "published" &&
    workerLoadsAfterPinnedPublication === workerLoadsBeforeHeadRelease &&
    headRevisionIds.length === 1 &&
    headRevisionIds.every(revisionId => revisionId === pinnedRevisionId);
  if (!admittedHeadStayedPinned) {
    throw new Error("Admitted Application execution followed the mutable head.");
  }
  const headMovement: ApplicationNativeMutationHeadMovementObservation =
    Object.freeze({
      pinnedRevisionId,
      movedRevisionId: moved.basis.revisionId,
      staleAdmission,
      workerLoadsBeforeRelease: workerLoadsBeforeHeadRelease,
      publication: Object.freeze({
        disposition: pinnedOutcome.disposition,
        commitSeq: pinnedOutcome.commitSeq,
        workerLoads: workerLoadsAfterPinnedPublication,
      }),
      executionRevisionIds: Object.freeze([...headRevisionIds]),
    });

  const beforeJournalFailure = await durableCounts(fixture.target);
  loader.mode = "catchTerminalJournalFailure";
  const terminalJournalOutcome = await invoke(
    invokeStandardApplicationPointMutationV1(
      create,
      { name: "Caught terminal journal failure" },
      TransactionRequestKeyV1Schema.make(
        "application-native:create:terminal-journal",
      ),
    ).pipe(
      Effect.map(outcome => Object.freeze({
        disposition: "accepted" as const,
        outcomeDisposition: outcome.disposition,
        commitSeq: outcome.commitSeq,
      })),
      Effect.catchTag(
        "PinnedPointTableNotFoundV1Error",
        error => Effect.succeed(Object.freeze({
          disposition: "rejected" as const,
          errorTag: error._tag,
          deploymentId: error.deploymentId,
          schemaVersionId: error.schemaVersionId,
          tableName: error.tableName,
        })),
      ),
    ),
  );
  const workerLoadsAfterJournalFailure = loader.loads;
  const afterJournalFailure = await durableCounts(fixture.target);
  const journalCountsStayedStable = sameApplicationNativeMutationDurableCounts(
    afterJournalFailure,
    beforeJournalFailure,
  );
  if (
    terminalJournalOutcome.disposition !== "rejected" ||
    terminalJournalOutcome.tableName !== "missing_table" ||
    !journalCountsStayedStable
  ) {
    const outcomeDetail = terminalJournalOutcome.disposition === "rejected"
      ? `${terminalJournalOutcome.errorTag}/${terminalJournalOutcome.tableName}`
      : `accepted/${terminalJournalOutcome.outcomeDisposition}`;
    throw new Error(
      `Caught terminal journal failure was not preserved: ${outcomeDetail}; durableCountsStable=${journalCountsStayedStable}.`,
    );
  }
  const terminalJournalFailure: ApplicationNativeMutationTerminalFailureObservation<
    ApplicationNativeMutationJournalTerminalOutcomeObservation
  > = Object.freeze({
    outcome: terminalJournalOutcome,
    before: beforeJournalFailure,
    after: afterJournalFailure,
    workerLoads: workerLoadsAfterJournalFailure,
  });

  const beforeFailure = afterJournalFailure;
  loader.mode = "terminalFailure";
  const terminalUserCodeOutcome = await invoke(
    invokeStandardApplicationPointMutationV1(
      create,
      { name: "Must not commit" },
      TransactionRequestKeyV1Schema.make("application-native:create:3"),
    ).pipe(
      Effect.map(outcome => Object.freeze({
        disposition: "accepted" as const,
        outcomeDisposition: outcome.disposition,
        commitSeq: outcome.commitSeq,
      })),
      Effect.catchTag(
        "PointMutationOccUserCodeV1Error",
        error => Effect.succeed(Object.freeze({
          disposition: "rejected" as const,
          errorTag: error._tag,
          cause: observeApplicationNativeMutationUserCodeCause(error.cause),
        })),
      ),
    ),
  );
  const workerLoadsAfterUserCodeFailure = loader.loads;
  const afterFailure = await durableCounts(fixture.target);
  const userCodeCountsStayedStable = sameApplicationNativeMutationDurableCounts(
    afterFailure,
    beforeFailure,
  );
  if (
    terminalUserCodeOutcome.disposition !== "rejected" ||
    terminalUserCodeOutcome.cause.kind !== "error" ||
    terminalUserCodeOutcome.cause.name !== "ApplicationWorkerUserCodeV1Error" ||
    terminalUserCodeOutcome.cause.message !== "application terminal failure" ||
    !userCodeCountsStayedStable
  ) {
    const outcomeDetail = terminalUserCodeOutcome.disposition === "rejected"
      ? `${terminalUserCodeOutcome.errorTag}/${terminalUserCodeOutcome.cause.kind}` +
        (terminalUserCodeOutcome.cause.kind === "error"
          ? `/${terminalUserCodeOutcome.cause.name}/${terminalUserCodeOutcome.cause.message}`
          : `/${terminalUserCodeOutcome.cause.valueType}`)
      : `accepted/${terminalUserCodeOutcome.outcomeDisposition}`;
    throw new Error(
      `Application terminal user-code failure was not preserved: ${outcomeDetail}; durableCountsStable=${userCodeCountsStayedStable}.`,
    );
  }
  const terminalUserCodeFailure: ApplicationNativeMutationTerminalFailureObservation<
    ApplicationNativeMutationUserCodeTerminalOutcomeObservation
  > = Object.freeze({
    outcome: terminalUserCodeOutcome,
    before: beforeFailure,
    after: afterFailure,
    workerLoads: workerLoadsAfterUserCodeFailure,
  });
  const terminalization: ApplicationNativeMutationTerminalizationObservation =
    Object.freeze({
      journal: terminalJournalFailure,
      userCode: terminalUserCodeFailure,
    });
  return Object.freeze({
    initialCommit,
    validationCatch,
    concurrentDuplicate,
    occConflict,
    headMovement,
    terminalization,
    candidateSchemaWriteGuard,
    freshWorkerLoads: loader.loads,
    commitCount: afterFailure.commits,
    outcomeCount: afterFailure.outcomes,
    feedCount: afterFailure.feed,
    outboxCount: afterFailure.outbox,
  });
}

function observeApplicationMutationConfiguration(
  configure: () => unknown,
): ApplicationNativeMutationConfigurationObservation {
  try {
    configure();
    return Object.freeze({ disposition: "accepted" });
  } catch (cause: unknown) {
    if (!(cause instanceof ApplicationMutationSystemConfigurationError)) {
      throw cause;
    }
    return Object.freeze({
      disposition: "rejected",
      errorTag: cause._tag,
      reason: cause.reason,
    });
  }
}

export async function makeApplicationNativeMutationTestLayer(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
  loader: WorkerLoader,
  options: Readonly<{
    readonly source?: ApplicationMutationSystemLive["applicationRunner"]["source"];
    readonly onExecution?: () => void;
    readonly afterRuntime?: () => Effect.Effect<void, never>;
  }> = {},
) {
  return makeApplicationMutationSystemLayer(
    await makeApplicationNativeMutationTestLive(fixture, loader, options),
  );
}

async function makeApplicationNativeMutationTestLive(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
  loader: WorkerLoader,
  options: Readonly<{
    readonly source?: ApplicationMutationSystemLive["applicationRunner"]["source"];
    readonly onExecution?: () => void;
    readonly afterRuntime?: () => Effect.Effect<void, never>;
  }> = {},
): Promise<ApplicationMutationSystemLive> {
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    fixture.deploymentId,
  );
  const keyPair = await crypto.subtle.generateKey(
    "Ed25519",
    false,
    ["sign", "verify"],
  );
  if (!("privateKey" in keyPair) || !("publicKey" in keyPair)) {
    throw new Error("Application-native proof requires an Ed25519 key pair.");
  }
  const now = Date.now();
  const applicationKeyId = TransactionGrantKeyIdV1Schema.make(
    "application-native-mutation-key",
  );
  const applicationKey = Object.freeze({
    kid: applicationKeyId,
    purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
    state: "active",
    issuedAtInclusiveEpochMilliseconds: now - 60_000,
    verificationEndsAtExclusiveEpochMilliseconds: now + 3_600_000,
    publicKey: keyPair.publicKey,
  }) satisfies ApplicationMutationGrantVerificationKeyV1;
  let grantSequence = 0;
  const grantIssuer = makeApplicationMutationGrantIssuer({
    deploymentId,
    grantRetentionPolicy: RETENTION,
    signer: {
      ...applicationKey,
      sign: bytes => Effect.promise(async () => new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          keyPair.privateKey,
          copyBytesToArrayBuffer(bytes),
        ),
      )),
    },
    runtime: {
      currentTimeMillis: Effect.sync(Date.now),
      nextGrantId: Effect.sync(() => {
        grantSequence += 1;
        return TransactionAuthorizationGrantIdV1Schema.make(
          `application-native-grant-${grantSequence}`,
        );
      }),
    },
  });
  const applicationGrantVerifier =
    createApplicationMutationGrantVerificationKernelV1({
      deploymentId,
      grantRetentionPolicy: RETENTION,
      keys: [applicationKey],
    });
  const legacyGrantVerifier = createTransactionGrantVerifierV1({
    clock: { now: () => new Date() },
    verificationKeyNamespace:
      createTransactionGrantVerificationKeyNamespaceV1({
        deploymentId,
        keys: [{
          state: "active",
          kid: TransactionGrantKeyIdV1Schema.make(
            "application-native-retained-legacy-key",
          ),
          purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
          issuedAtInclusiveEpochMilliseconds: now - 60_000,
          verificationEndsAtExclusiveEpochMilliseconds: now + 3_600_000,
          verify: async () => false,
        }],
      }),
    grantRetentionPolicy: RETENTION,
  });
  const hostPolicy = applicationHostPolicy();
  const policyBytes = Result.getOrThrow(encodeEdgeActionHostPolicyV1(
    hostPolicy,
    {
      maximumOrigins: 1_024,
      maximumOriginBytes: 8_192,
      maximumCanonicalBytes: 1_048_576,
    },
  )).canonicalBytes;
  const hostPolicySha256 = await sha256(policyBytes);
  const baseHost = makeApplicationExecutionHost(loader);
  const afterRuntime = options.afterRuntime;
  const host: ApplicationMutationSystemLive["applicationRunner"]["host"] =
    afterRuntime === undefined
      ? baseHost
      : Object.freeze({
        runTransaction: (
          input: Parameters<typeof baseHost.runTransaction>[0],
        ) => baseHost.runTransaction(input).pipe(
          Effect.ensuring(afterRuntime()),
        ),
        runAction: baseHost.runAction,
      });
  let uuidSequence = 0;
  let executionSequence = 0;
  return Object.freeze({
    deploymentId,
    activation: fixture.activation,
    admission: {
      deploymentId,
      controlDb: fixture.control.drizzle,
      schema: fixture.schema,
      authority: fixture.authorityPorts,
    },
    currentEpochAuthority: fixture.currentEpochAuthority,
    grantIssuer,
    applicationGrantVerifier,
    legacyGrantVerifier,
    legacyFunctionMetadata: {
      load: () => Effect.die("Application authority must not load legacy metadata."),
    },
    sessionAuthority: fixture.sessionAuthority,
    candidateSchemaWriteGuard: fixture.candidateSchemaWriteGuard,
    intrinsicCreationTimeIndexes: fixture.intrinsicCreationTimeIndexes,
    developerIndexes: fixture.developerIndexes,
    indexedQueries: fixture.indexedQueries,
    grantRetentionPolicy: RETENTION,
    applicationRunner: {
      source: options.source ?? Object.freeze({
        read: (rootSha256: string) => rootSha256 ===
            fixture.source.sourceArtifact.rootSha256
          ? Effect.succeed(
            fixture.source satisfies ApplicationAnalysisSourceBundle,
          )
          : Effect.die("Application-native proof requested the wrong source root."),
      }),
      host,
      hostPolicy,
      hostPolicySha256,
      sha256: (bytes: Uint8Array) => Effect.promise(() => sha256(bytes)),
    },
    randomUuid: () => {
      uuidSequence += 1;
      return `35000000-0000-4000-8000-${uuidSequence.toString().padStart(12, "0")}`;
    },
    executionContextFactory: {
      make: () => Effect.sync(() => {
        executionSequence += 1;
        options.onExecution?.();
        return Object.freeze({
          executionId: `application-native-execution-${executionSequence}`,
          logScopeId: `application-native-log-${executionSequence}`,
          randomSeed: new Uint8Array(32).fill(executionSequence),
        });
      }),
    },
    leaseDurationMilliseconds: 600_000,
    claimDurationMilliseconds: 600_000,
    leaseRenewalDurationMilliseconds: 600_000,
    heartbeatIntervalMilliseconds: 200_000,
  } satisfies ApplicationMutationSystemLive);
}

type ApplicationJournalCapability = Readonly<{
  readPointDocument: (table: string, documentId: string) => Promise<unknown>;
  insertPointDocument: (table: string, value: unknown) => Promise<unknown>;
  patchPointDocument: (documentId: string, value: unknown) => Promise<void>;
}>;

class ApplicationNativeWorkerLoader implements WorkerLoader {
  loads = 0;
  caughtValidation = 0;
  mode:
    | "success"
    | "catchValidation"
    | "catchTerminalJournalFailure"
    | "terminalFailure"
    | "readThenInsert"
    | "patchDocument" = "success";
  conflictDocumentId: string | undefined;
  persistentConflictArgumentName: string | undefined;
  conflictReads = 0;
  readonly revisionIds: string[] = [];
  readonly requestReceipts: Array<Readonly<{
    readonly argumentName: string;
    readonly revisionId: string;
  }>> = [];
  private nextBlock: InvocationBlock | undefined;

  blockNextInvocation(): Readonly<{
    readonly started: Promise<void>;
    readonly release: () => void;
  }> {
    if (this.nextBlock !== undefined) {
      throw new Error("Application-native Worker block is already armed.");
    }
    const started = deferred<void>();
    const released = deferred<void>();
    this.nextBlock = Object.freeze({ started, released });
    return Object.freeze({
      started: started.promise,
      release: () => released.resolve(undefined),
    });
  }

  takeBlock(): InvocationBlock | undefined {
    const block = this.nextBlock;
    this.nextBlock = undefined;
    return block;
  }

  get(): WorkerStub {
    throw new Error("Application-native proof forbids cached Worker loading.");
  }

  load(): WorkerStub {
    this.loads += 1;
    return new ApplicationNativeWorkerStub(this);
  }
}

class ApplicationNativeWorkerStub implements WorkerStub {
  constructor(private readonly owner: ApplicationNativeWorkerLoader) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(): Fetcher<T> {
    const owner = this.owner;
    return {
      run: async (request: unknown, capability: unknown) => {
        const argumentName = readArgumentName(request);
        const revisionId = readTargetRevisionId(request);
        const mode = argumentName === owner.persistentConflictArgumentName
          ? "readThenInsert"
          : owner.mode;
        if (argumentName !== owner.persistentConflictArgumentName) {
          owner.mode = "success";
        }
        owner.revisionIds.push(revisionId);
        owner.requestReceipts.push(Object.freeze({ argumentName, revisionId }));
        const journal = requireJournalCapability(capability);
        const conflictDocumentId = owner.conflictDocumentId;
        if (mode === "readThenInsert") {
          if (conflictDocumentId === undefined) {
            throw new Error("Application OCC proof has no conflict document.");
          }
          await journal.readPointDocument("users", conflictDocumentId);
          owner.conflictReads += 1;
        }
        const block = owner.takeBlock();
        if (block !== undefined) {
          block.started.resolve(undefined);
          await block.released.promise;
        }
        if (mode === "terminalFailure") {
          throw Object.assign(new Error("application terminal failure"), {
            name: "ApplicationWorkerUserCodeV1Error",
          });
        }
        const name = argumentName;
        if (mode === "catchValidation") {
          try {
            await journal.insertPointDocument("users", { name: 42 });
          } catch {
            owner.caughtValidation += 1;
          }
        }
        if (mode === "catchTerminalJournalFailure") {
          try {
            await journal.insertPointDocument("missing_table", { name });
          } catch {
            return rpcResult("application caught terminal journal failure");
          }
          throw new Error("Application journal unexpectedly accepted an unknown table.");
        }
        if (mode === "patchDocument") {
          if (conflictDocumentId === undefined) {
            throw new Error("Application OCC competitor has no document.");
          }
          await journal.patchPointDocument(conflictDocumentId, { name });
          return rpcResult(conflictDocumentId);
        }
        const documentId = await journal.insertPointDocument("users", { name });
        return rpcResult(documentId);
      },
    } as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Application-native proof does not load Durable Objects.");
  }
}

function requireJournalCapability(value: unknown): ApplicationJournalCapability {
  if (value === null || typeof value !== "object") {
    throw new Error("Application-native Worker received no journal capability.");
  }
  const method = Reflect.get(value, "insertPointDocument");
  const read = Reflect.get(value, "readPointDocument");
  const patch = Reflect.get(value, "patchPointDocument");
  if (
    typeof method !== "function" ||
    typeof read !== "function" ||
    typeof patch !== "function"
  ) {
    throw new Error("Application-native Worker received an invalid journal capability.");
  }
  return Object.freeze({
    readPointDocument: (table, documentId) => Reflect.apply(
      read,
      value,
      [table, documentId],
    ) as Promise<unknown>,
    insertPointDocument: (table, document) => Reflect.apply(
      method,
      value,
      [table, document],
    ) as Promise<unknown>,
    patchPointDocument: (documentId, document) => Reflect.apply(
      patch,
      value,
      [documentId, document],
    ) as Promise<void>,
  });
}

function rpcResult(value: unknown): object {
  const result = {
    format: APPLICATION_WORKER_RESULT_FORMAT_V1,
    version: APPLICATION_WORKER_RESULT_VERSION_V1,
    value,
  };
  Object.defineProperty(result, Symbol.dispose, { value: () => undefined });
  return result;
}

function readArgumentName(request: unknown): string {
  if (request === null || typeof request !== "object") {
    throw new Error("Application-native Worker received an invalid request.");
  }
  const argumentsValue = Reflect.get(request, "arguments");
  if (argumentsValue === null || typeof argumentsValue !== "object") {
    throw new Error("Application-native Worker received invalid arguments.");
  }
  const name = Reflect.get(argumentsValue, "name");
  if (typeof name !== "string") {
    throw new Error("Application-native Worker received no name.");
  }
  return name;
}

function readTargetRevisionId(request: unknown): string {
  if (request === null || typeof request !== "object") {
    throw new Error("Application-native Worker received an invalid request.");
  }
  const target = Reflect.get(request, "target");
  if (target === null || typeof target !== "object") {
    throw new Error("Application-native Worker received no runtime target.");
  }
  const revisionId = Reflect.get(target, "revisionId");
  if (typeof revisionId !== "string") {
    throw new Error("Application-native Worker received no revision identity.");
  }
  return revisionId;
}

function applicationHostPolicy() {
  return Object.freeze({
    identity: EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
    exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
    syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
    outboundGatewayIdentity: EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
    callbackBridgeIdentity: EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
    allowedOrigins: Object.freeze([]),
    cpuMilliseconds: 1_000,
    wallMilliseconds: 30_000,
    maximumSyscalls: 64,
    maximumOutboundRequests: 16,
    maximumConcurrentOutboundRequests: 4,
    maximumWorkerSubrequests: 64,
    maximumArgumentBytes: 1_048_576,
    maximumResultBytes: 1_048_576,
    maximumCallbackArgumentBytes: 1_048_576,
    maximumCallbackResultBytes: 1_048_576,
    maximumUrlBytes: 8_192,
    maximumMethodBytes: 32,
    maximumHeaderCount: 128,
    maximumHeaderBytes: 65_536,
    maximumStatusTextBytes: 1_024,
    maximumOutboundRequestBodyBytes: 1_048_576,
    maximumOutboundResponseBodyBytes: 8_388_608,
    maximumCumulativeOutboundBodyBytes: 16_777_216,
    cleanupDrainMilliseconds: 5_000,
    allowRunQuery: true,
    allowRunMutation: true,
    allowRunAction: false,
    allowRedirects: false,
    allowStreaming: false,
    allowAmbientCredentials: false,
    fixedInvocationTime: true,
    deterministicRandom: true,
    allowNondeterministicCrypto: false,
  });
}

async function durableCounts(persistence: ApplicationNativeMutationPersistence) {
  const result = await persistence.query<{
    commits: string;
    outcomes: string;
    feed: string;
    outbox: string;
  }>(`select
    (select count(*)::text from fx_system_commit) as commits,
    (select count(*)::text from fx_system_idempotency) as outcomes,
    (select count(*)::text from fx_system_commit_app_row_change) as feed,
    (select count(*)::text from fx_system_outbox) as outbox`);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Application-native counts are missing.");
  return Object.freeze({
    commits: Number(row.commits),
    outcomes: Number(row.outcomes),
    feed: Number(row.feed),
    outbox: Number(row.outbox),
  });
}

function sameApplicationNativeMutationDurableCounts(
  left: ApplicationNativeMutationDurableCountsObservation,
  right: ApplicationNativeMutationDurableCountsObservation,
): boolean {
  return left.commits === right.commits &&
    left.outcomes === right.outcomes &&
    left.feed === right.feed &&
    left.outbox === right.outbox;
}

function observeApplicationNativeMutationUserCodeCause(
  cause: ApplicationNativeMutationUserCodeTerminalError["cause"],
): ApplicationNativeMutationUserCodeCauseObservation {
  return cause instanceof Error
    ? Object.freeze({
      kind: "error",
      name: cause.name,
      message: cause.message,
    })
    : Object.freeze({
      kind: "nonError",
      valueType: typeof cause,
    });
}

interface Deferred<A> {
  readonly promise: Promise<A>;
  readonly resolve: (value: A) => void;
}

interface InvocationBlock {
  readonly started: Deferred<void>;
  readonly released: Deferred<void>;
}

function deferred<A>(): Deferred<A> {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>(accept => { resolve = accept; });
  return Object.freeze({ promise, resolve });
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(bytes),
  ));
}
