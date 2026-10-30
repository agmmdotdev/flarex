import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
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
  createApplicationNativeMutationSourceBundle,
  type ApplicationNativeMutationFixture,
  type ApplicationNativeMutationPersistence,
  type ApplicationNativeMutationSourceBundle,
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
  type ApplicationSelectionMutationPort,
  type ApplicationMutationSystemLive,
  type ApplicationCoreMutationSystemLive,
  invokeApplicationMutation,
  type InvokeApplicationMutationError,
  makeApplicationMutationSystemLayer,
} from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import { Effect, Result, Scope, Clock, Context, Option, Schema } from "effect";
import type { ApplicationCoreMutationDefinition, ApplicationCoreMutationFixture } from "@flarex/persistence-postgres/internal/system-test/core-application-mutation-fixture";
import { APPLICATION_ANALYSIS_ANALYZER_IDENTITY, APPLICATION_ANALYSIS_POLICY_IDENTITY,
  applicationAnalysisHostEffectWithCapabilities } from "@flarex/source-analyzer-v2/internal/application-analysis-host";
import { MiniflareApplicationAnalysisWorkerLoader } from "./standardApplicationCurrentAnalysisHarness";
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

import { MiniflareApplicationWorkerLoader } from "./applicationNativeQueryHarness";

const COMPATIBILITY_DATE = "2026-06-14";
export const APPLICATION_NESTED_MUTATION_FIXTURE_OPTIONS = Object.freeze({
  runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
  compatibilityDate: COMPATIBILITY_DATE,
});
const RETENTION = Result.getOrThrow(makeGrantRetentionPolicyV1Result({
  maximumGrantLifetimeMilliseconds: 120_000,
  maximumFutureIssuedAtSkewMilliseconds: 30_000,
  maximumLiveSnapshotRetentionMilliseconds: 600_000,
}));

export interface ApplicationNativeMutationProof {
  readonly invalidInputRejectedBeforeActiveRead: true;
  readonly externalInternalMutationRejected: true;
  readonly selectionMutation: ApplicationNativeSelectionMutationObservation;
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

export interface ApplicationNativeSelectionMutationObservation {
  readonly publicPublication: ApplicationNativeMutationPublishedObservation;
  readonly internalPublication: ApplicationNativeMutationPublishedObservation;
  readonly internalReplay: ApplicationNativeMutationReplayObservation;
  readonly staleSelection: ApplicationNativeMutationStaleAdmissionObservation;
  readonly staleSelectionWorkerLoads: number;
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
  InvokeApplicationMutationError,
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
  InvokeApplicationMutationError,
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
  InvokeApplicationMutationError,
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
  InvokeApplicationMutationError,
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

export interface ApplicationMutationTestLiveFixture {
  readonly deploymentId: string;
  readonly control: Readonly<{ readonly drizzle: ApplicationMutationSystemLive[
    "admission"
  ]["controlDb"] }>;
  readonly activation: ApplicationMutationSystemLive["activation"];
  readonly schema: ApplicationMutationSystemLive["admission"]["schema"];
  readonly relationSchema?: ApplicationMutationSystemLive["admission"][
    "relationSchema"
  ];
  readonly authorityPorts: ApplicationMutationSystemLive["admission"][
    "authority"
  ];
  readonly currentEpochAuthority:
    ApplicationMutationSystemLive["currentEpochAuthority"];
  readonly sessionAuthority: ApplicationMutationSystemLive["sessionAuthority"];
  readonly candidateSchemaWriteGuard:
    ApplicationMutationSystemLive["candidateSchemaWriteGuard"];
  readonly intrinsicCreationTimeIndexes:
    ApplicationMutationSystemLive["intrinsicCreationTimeIndexes"];
  readonly developerIndexes: ApplicationMutationSystemLive["developerIndexes"];
  readonly applicationRelations?:
    ApplicationMutationSystemLive["applicationRelations"];
  readonly indexedQueries: ApplicationMutationSystemLive["indexedQueries"];
  readonly source: ApplicationNativeMutationSourceBundle;
}

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
  const baseLive = await makeApplicationMutationTestLive(fixture, loader);
  let activationReads = 0;
  const activationOwner = baseLive.activation;
  const readActive = activationOwner.readActive;
  const live = Object.freeze({
    ...baseLive,
    activation: Object.freeze({
      readActive: () => Effect.sync(() => { activationReads += 1; }).pipe(
        Effect.flatMap(() => readActive.call(activationOwner)),
      ),
    }),
  });
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
  const internalCreate = TransactionFunctionPathV1Schema.make(
    "users:createInternal",
  );
  const activationReadsBeforeInvalidInput = activationReads;
  const invalidInputRejectedBeforeActiveRead = await invoke(Effect.gen(
    function* () {
      const system = yield* ApplicationMutationSystem;
      return yield* system.invoke(
        // @ts-expect-error Deliberately exercise the unknown runtime boundary.
        null,
        {},
        TransactionRequestKeyV1Schema.make(
          "application-native:create:invalid-function",
        ),
      );
    },
  ).pipe(
    Effect.as(false as const),
    Effect.catchTag(
      "ApplicationMutationInputError",
      error => error.field === "functionRef"
        ? Effect.succeed(true as const)
        : Effect.die(error),
    ),
  ));
  if (
    !invalidInputRejectedBeforeActiveRead ||
    activationReads !== activationReadsBeforeInvalidInput
  ) {
    throw new Error(
      "Invalid Application mutation input reached active-head resolution.",
    );
  }
  const workerLoadsBeforeExternalInternalMutation = loader.loads;
  const externalInternalMutationRejected = await invoke(
    invokeApplicationMutation(
      internalCreate,
      { name: "External internal mutation" },
      TransactionRequestKeyV1Schema.make(
        "application-native:create:external-internal",
      ),
    ).pipe(
      Effect.as(false as const),
      Effect.catchTag(
        "ApplicationMutationAdmissionError",
        error => error.reason === "functionUnsupported"
          ? Effect.succeed(true as const)
          : Effect.die(error),
      ),
    ),
  );
  if (
    !externalInternalMutationRejected ||
    loader.loads !== workerLoadsBeforeExternalInternalMutation
  ) {
    throw new Error("External mutation root admitted an internal function.");
  }
  const publicSelectionKey = TransactionRequestKeyV1Schema.make(
    "application-native:create:selection-bound-public",
  );
  const internalSelectionKey = TransactionRequestKeyV1Schema.make(
    "application-native:create:selection-bound-internal",
  );
  const selectionIdentity = Object.freeze({
    kind: "user" as const,
    user: Object.freeze({
      tokenIdentifier: "application-native-selection-user",
      issuer: "https://system-test.flarex.invalid",
      subject: "selection-user",
    }),
  });
  const selectionMutationEffect = Effect.fn(
    "SystemTest.ApplicationNativeMutation.invokeSelection",
  )(function* (
    selection: Parameters<
      ApplicationSelectionMutationPort["runMutation"]
    >[0],
    functionRef: Parameters<
      ApplicationSelectionMutationPort["runMutation"]
    >[1],
    args: Parameters<
      ApplicationSelectionMutationPort["runMutation"]
    >[2],
    requestKey: Parameters<
      ApplicationSelectionMutationPort["runMutation"]
    >[3],
  ) {
    const system = yield* ApplicationMutationSystem;
    return yield* system.selectionMutation.runMutation(
      selection,
      functionRef,
      args,
      requestKey,
      selectionIdentity,
    );
  });
  const publicSelectionPublished = await invoke(selectionMutationEffect(
    fixture.active.selection,
    create,
    { name: "Selection-bound public" },
    publicSelectionKey,
  ));
  if (
    publicSelectionPublished.disposition !== "published" ||
    typeof publicSelectionPublished.value !== "string"
  ) {
    throw new Error(
      "Selection-bound public Application mutation was not published.",
    );
  }
  const publicSelectionPublication: ApplicationNativeMutationPublishedObservation =
    Object.freeze({
      disposition: publicSelectionPublished.disposition,
      value: publicSelectionPublished.value,
      commitSeq: publicSelectionPublished.commitSeq,
      workerLoads: loader.loads,
    });
  const internalSelectionPublished = await invoke(selectionMutationEffect(
    fixture.active.selection,
    internalCreate,
    { name: "Selection-bound internal" },
    internalSelectionKey,
  ));
  if (
    internalSelectionPublished.disposition !== "published" ||
    typeof internalSelectionPublished.value !== "string"
  ) {
    throw new Error(
      "Selection-bound internal Application mutation was not published.",
    );
  }
  const internalSelectionLoadsAfterPublish = loader.loads;
  const internalSelectionPublication: ApplicationNativeMutationPublishedObservation =
    Object.freeze({
      disposition: internalSelectionPublished.disposition,
      value: internalSelectionPublished.value,
      commitSeq: internalSelectionPublished.commitSeq,
      workerLoads: internalSelectionLoadsAfterPublish,
    });
  const internalSelectionReplayed = await invoke(selectionMutationEffect(
    fixture.active.selection,
    internalCreate,
    { name: "Selection-bound internal" },
    internalSelectionKey,
  ));
  if (
    internalSelectionReplayed.disposition !== "replayed" ||
    internalSelectionReplayed.commitSeq !== internalSelectionPublished.commitSeq ||
    loader.loads !== internalSelectionLoadsAfterPublish
  ) {
    throw new Error(
      "Selection-bound internal Application replay re-executed the Worker.",
    );
  }
  const internalSelectionReplay: ApplicationNativeMutationReplayObservation =
    Object.freeze({
      disposition: internalSelectionReplayed.disposition,
      commitSeq: internalSelectionReplayed.commitSeq,
      workerLoads: loader.loads,
    });
  const firstKey = TransactionRequestKeyV1Schema.make(
    "application-native:create:1",
  );
  const published = await invoke(invokeApplicationMutation(
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
  const replayed = await invoke(invokeApplicationMutation(
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
      invokeApplicationMutation(
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
  const caught = await invoke(invokeApplicationMutation(
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
  const duplicateFirst = invoke(invokeApplicationMutation(
    create,
    { name: "Concurrent" },
    duplicateKey,
  ));
  await duplicateBlock.started;
  let duplicateContender:
    ApplicationNativeMutationDuplicateContenderObservation;
  try {
    duplicateContender = await invoke(
      invokeApplicationMutation(
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
    invokeApplicationMutation(
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
  const conflictAttempt = invoke(invokeApplicationMutation(
    create,
    { name: "Conflict winner" },
    conflictKey,
  ));
  await conflictBlock.started;
  const loadsBeforeCompetitor = loader.loads;
  loader.mode = "patchDocument";
  let competitor: Awaited<typeof conflictAttempt>;
  try {
    competitor = await invoke(invokeApplicationMutation(
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
  const headAttempt = invoke(invokeApplicationMutation(
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
  const workerLoadsBeforeStaleSelection = loader.loads;
  const staleSelection = await invoke(selectionMutationEffect(
    fixture.active.selection,
    internalCreate,
    { name: "Must not retarget" },
    TransactionRequestKeyV1Schema.make(
      "application-native:create:stale-selection",
    ),
  ).pipe(
    Effect.map(() => Object.freeze({
      disposition: "accepted" as const,
      revisionId: moved.basis.revisionId,
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
  ));
  if (
    staleSelection.disposition !== "rejected" ||
    staleSelection.operation !== "validateSelection" ||
    staleSelection.reason !== "concurrentHead" ||
    loader.loads !== workerLoadsBeforeStaleSelection
  ) {
    throw new Error(
      "Selection-bound Application mutation retargeted after head movement.",
    );
  }
  const selectionMutation: ApplicationNativeSelectionMutationObservation =
    Object.freeze({
      publicPublication: publicSelectionPublication,
      internalPublication: internalSelectionPublication,
      internalReplay: internalSelectionReplay,
      staleSelection,
      staleSelectionWorkerLoads: loader.loads,
    });
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
    invokeApplicationMutation(
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
    invokeApplicationMutation(
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
    invalidInputRejectedBeforeActiveRead,
    externalInternalMutationRejected,
    selectionMutation,
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

/** Genuine current cold registration supplies the exact executing schema/catalog. */
export async function createCoreApplicationMutationDefinition(): Promise<ApplicationCoreMutationDefinition> {
  const source = await createApplicationNativeMutationSourceBundle(false, 0, 0, true, false, false, true, true);
  const loader = new MiniflareApplicationAnalysisWorkerLoader();
  try {
    const analysis = await runSystemTestEffectV1(applicationAnalysisHostEffectWithCapabilities({
      source: { read: rootSha256 => rootSha256 === source.sourceArtifact.rootSha256
        ? Effect.succeed(source) : Effect.die("Core query analysis requested a foreign source artifact.") },
      loader,
    }, { format: "flarex.application-analysis-host-request", version: 1,
      sourceArtifactRootSha256: source.sourceArtifact.rootSha256,
      analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
      analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
    }));
    if (analysis.kind !== "analyzed") throw new Error("Core Application cold registration was rejected.", { cause: analysis });
    if (analysis.manifest.version !== 1)
      throw new Error("The core query fixture requires a relation-free Application Manifest V1.");
    return Object.freeze({ source, manifest: analysis.manifest, coldAnalysisLoads: loader.loads });
  } finally { await loader.dispose(); }
}

export async function proveApplicationNestedMutation(fixture: ApplicationCoreMutationFixture) {
  const before = await readApplicationCoreMutationState(fixture);
  const loader = new MiniflareApplicationWorkerLoader();
  try {
    const layer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const invoke = (selectedLayer = layer) => runSystemTestEffectV1(Effect.scoped(invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("users:deleteThroughInternal"),
      { id: fixture.documentId }, TransactionRequestKeyV1Schema.make("application-native:nested-delete"),
    ).pipe(Effect.provide(selectedLayer))));
    const published = await invoke();
    const replayed = await invoke();
    const after = await readApplicationCoreMutationState(fixture);
    const cold = await fixture.reopen();
    const coldFixture = Object.freeze({ ...fixture, database: cold });
    const coldReplay = await invoke(await makeApplicationNativeMutationTestLayer(coldFixture, loader));
    const coldCurrent = await readApplicationCoreMutationState(coldFixture);
    const old = await runSystemTestEffectV1(cold.begin({ at: fixture.initialTimestamp }));
    let historical;
    try { historical = { document: Option.getOrNull(await runSystemTestEffectV1(old.get(fixture.documentId))),
      indexed: await runSystemTestEffectV1(old.scan("users", "by_name")) }; }
    finally { await runSystemTestEffectV1(old.abort()); }
    return { published, replayed, coldReplay, before, after, coldCurrent, historical,
      workerLoads: loader.loads, storageTables: await fixture.storageTables() };
  } finally { await loader.dispose(); }
}

export async function proveApplicationNestedMutationFailure(fixture: ApplicationCoreMutationFixture) {
  const calls: Array<Readonly<{ method: string; arguments: readonly unknown[] }>> = [];
  const completed: Array<Readonly<{ method: string; arguments: readonly unknown[]; result: unknown }>> = [];
  const loader = new MiniflareApplicationWorkerLoader((method, argumentsValue) => {
    calls.push(Object.freeze({ method, arguments: structuredClone(argumentsValue) }));
  }, (method, argumentsValue, result) => {
    if (method === "patchPointDocument" || method === "readPointDocument") completed.push(Object.freeze({
      method, arguments: structuredClone(argumentsValue), result: structuredClone(result),
    }));
  });
  try {
    const layer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const invoke = (fail: boolean, requestKey: string) => invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("users:patchThroughInternal"),
      { id: fixture.documentId, fail }, TransactionRequestKeyV1Schema.make(requestKey),
    );
    const before = await readApplicationCoreMutationState(fixture);
    const failureOutcome = await runSystemTestEffectV1(Effect.scoped(invoke(true, "application-native:nested-patch-failure").pipe(
      Effect.map(outcome => ({ disposition: "accepted" as const, value: outcome.value })),
      Effect.catchTag("PointMutationOccApplicationErrorV1", error => Effect.succeed({
        disposition: "rejected" as const, errorTag: error._tag, code: error.code, message: error.message, data: error.data,
      })), Effect.provide(layer),
    )));
    const afterFailure = await readApplicationCoreMutationState(fixture);
    const failureCalls = calls.splice(0), failureResults = completed.splice(0), failureWorkerLoads = loader.loads;
    const successful = await runSystemTestEffectV1(Effect.scoped(invoke(false, "application-native:nested-patch-success")
      .pipe(Effect.provide(layer))));
    const afterSuccess = await readApplicationCoreMutationState(fixture), successWorkerLoads = loader.loads;
    const subsequent = await runSystemTestEffectV1(Effect.scoped(invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("users:create"), { name: "Independent after nested failure" },
      TransactionRequestKeyV1Schema.make("application-native:after-nested-failure"),
    ).pipe(Effect.provide(layer))));
    const afterSubsequent = await readApplicationCoreMutationState(fixture);
    return { documentId: fixture.documentId, before,
      failure: { outcome: failureOutcome, state: afterFailure, results: failureResults, calls: failureCalls, workerLoads: failureWorkerLoads },
      success: { outcome: successful, state: afterSuccess, workerLoads: successWorkerLoads - failureWorkerLoads },
      subsequent: { outcome: subsequent, state: afterSubsequent, workerLoads: loader.loads - successWorkerLoads },
      storageTables: await fixture.storageTables(),
    };
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationIndexOrder(fixture: ApplicationCoreMutationFixture) {
  // Keep creation order opposite public ID order without manufacturing rows or
  // index bytes: control only the trusted allocator at the actual insert syscall.
  const internalIds = [new Uint8Array(16).fill(0xf0), new Uint8Array(16).fill(0x10)];
  let inserted = 0;
  const loader = new MiniflareApplicationWorkerLoader(method => {
    if (method !== "insertPointDocument") return;
    const id = internalIds[inserted++];
    if (id === undefined) throw new Error("Unexpected Application ordering insert.");
    fixture.useNextInternalId(id);
  });
  try {
    const layer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const ids: string[] = [];
    for (const ordinal of [0, 1]) {
      const outcome = await runSystemTestEffectV1(Effect.scoped(invokeApplicationMutation(
        TransactionFunctionPathV1Schema.make("users:create"), { name: "Equal name" },
        TransactionRequestKeyV1Schema.make("core-index-order:" + ordinal),
      ).pipe(Effect.provide(layer))));
      ids.push(Schema.decodeUnknownSync(Schema.String)(outcome.value));
    }
    const read = async (database: ApplicationCoreMutationFixture["database"]) => {
      const transaction = await runSystemTestEffectV1(database.begin());
      try {
        const asc = await runSystemTestEffectV1(transaction.scan("users", "by_name"));
        const desc = await runSystemTestEffectV1(transaction.scan("users", "by_name", { order: "desc" }));
        return { asc: asc.filter(row => row.name === "Equal name"), desc: desc.filter(row => row.name === "Equal name") };
      } finally { await runSystemTestEffectV1(transaction.abort()); }
    };
    const warm = await read(fixture.database);
    const cold = await read(await fixture.reopen());
    return { ids, warm, cold, workerLoads: loader.loads, inserts: inserted };
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationDocumentValidation(fixture: ApplicationCoreMutationFixture) {
  const calls: Array<Readonly<{ method: string; arguments: readonly unknown[] }>> = [];
  const loader = new MiniflareApplicationWorkerLoader((method, argumentsValue) => {
    calls.push({ method, arguments: structuredClone(argumentsValue) });
  });
  try {
    const layer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const outcome = await runSystemTestEffectV1(Effect.scoped(invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("users:validationRecovery"), { id: fixture.documentId },
      TransactionRequestKeyV1Schema.make("core-document-validation:recover"),
    ).pipe(Effect.provide(layer))));
    return { outcome, calls, documentId: fixture.documentId, workerLoads: loader.loads,
      after: await readApplicationCoreMutationState(fixture) };
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationArgumentProfile(fixture: ApplicationCoreMutationFixture) {
  const loader = new MiniflareApplicationWorkerLoader();
  try {
    const layer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const argumentsValues = [
      { name: "large unused arguments", padding: "x".repeat(1_048_576 + 1_024) },
      { name: "deep unused arguments", ignored: nestedApplicationArgument(20) },
    ];
    const outcomes = [];
    for (const [ordinal, args] of argumentsValues.entries()) outcomes.push(await runSystemTestEffectV1(Effect.scoped(
      invokeApplicationMutation(TransactionFunctionPathV1Schema.make("users:create"), args,
        TransactionRequestKeyV1Schema.make("core-arguments:general-profile:" + ordinal)).pipe(Effect.provide(layer)),
    )));
    const read = await runSystemTestEffectV1(fixture.database.begin());
    try {
      const documents = [];
      for (const outcome of outcomes) documents.push(Option.getOrThrow(await runSystemTestEffectV1(
        read.get(Schema.decodeUnknownSync(Schema.String)(outcome.value)),
      )));
      return { outcomes, documents, workerLoads: loader.loads };
    } finally { await runSystemTestEffectV1(read.abort()); }
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationArgumentRefusal(fixture: ApplicationCoreMutationFixture) {
  let claims = 0;
  const observed = Object.freeze({ ...fixture.database,
    claimRequest: (identity: Parameters<typeof fixture.database.claimRequest>[0]) => Effect.sync(() => { claims += 1; })
      .pipe(Effect.andThen(() => fixture.database.claimRequest(identity))),
  });
  const loader = new MiniflareApplicationWorkerLoader();
  const before = await readApplicationCoreMutationState(fixture);
  const beforeTimestamp = await runSystemTestEffectV1(fixture.database.publishedTimestamp);
  try {
    const layer = await makeApplicationNativeMutationTestLayer({ ...fixture, database: observed }, loader);
    const invalidArguments = [
      { name: "over argument budget", padding: "x".repeat(16 * 1_048_576) },
      { name: "over general nesting", ignored: nestedApplicationArgument(64) },
      [], null,
    ];
    const outcomes = [];
    for (const [ordinal, args] of invalidArguments.entries()) outcomes.push(await runSystemTestEffectV1(Effect.scoped(
      Effect.exit(invokeApplicationMutation(TransactionFunctionPathV1Schema.make("users:create"), args,
        TransactionRequestKeyV1Schema.make("core-arguments:refusal:" + ordinal)).pipe(Effect.provide(layer))),
    )));
    return { outcomes, claims, workerLoads: loader.loads, before, after: await readApplicationCoreMutationState(fixture),
      beforeTimestamp, afterTimestamp: await runSystemTestEffectV1(fixture.database.publishedTimestamp) };
  } finally { await loader.dispose(); }
}

function nestedApplicationArgument(depth: number): unknown {
  let value: unknown = null;
  for (let level = 0; level < depth; level += 1) value = { next: value };
  return value;
}

export async function proveCoreApplicationClock(fixture: ApplicationCoreMutationFixture) {
  const loader = new MiniflareApplicationWorkerLoader();
  let clockReads = 0;
  const epochReadTimes: number[] = [];
  const observedDatabase = Object.freeze({ ...fixture.database, readAuthorityEpoch: Clock.currentTimeMillis.pipe(
    Effect.tap(time => Effect.sync(() => { epochReadTimes.push(time); })),
    Effect.andThen(fixture.database.readAuthorityEpoch),
  ) });
  const clock = applicationMutationTestClock(() => { clockReads += 1; return 1234; });
  try {
    const layer = await makeApplicationNativeMutationTestLayer({ ...fixture, database: observedDatabase }, loader);
    const outcome = await runSystemTestEffectV1(Effect.scoped(invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("users:patchThroughInternal"), { id: fixture.documentId, fail: false },
      TransactionRequestKeyV1Schema.make("core-clock:operation-owned-rpc"),
    ).pipe(Effect.provide(layer), Effect.provideService(Clock.Clock, clock))));
    return { outcome, clockReads, epochReadTimes, pointReads: loader.pointDocumentReads, workerLoads: loader.loads,
      after: await readApplicationCoreMutationState(fixture) };
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationAdmissionExpiry(fixture: ApplicationCoreMutationFixture) {
  let now = 1234;
  let deadline: number | undefined;
  const clock = applicationMutationTestClock(() => now);
  const observedDatabase = Object.freeze({ ...fixture.database,
    commit: (handle: Parameters<typeof fixture.database.commit>[0], options?: Parameters<typeof fixture.database.commit>[1]) =>
      Effect.sync(() => {
        deadline = options?.admissionDeadlineUnixMilliseconds;
        if (deadline === undefined) throw new Error("Application commit omitted its signed grant deadline.");
        now = deadline;
      }).pipe(Effect.andThen(() => fixture.database.commit(handle, options))),
  });
  const before = await readApplicationCoreMutationState(fixture);
  const loader = new MiniflareApplicationWorkerLoader();
  try {
    const layer = await makeApplicationNativeMutationTestLayer({ ...fixture, database: observedDatabase }, loader);
    const invoke = () => invokeApplicationMutation(TransactionFunctionPathV1Schema.make("users:patchThroughInternal"),
      { id: fixture.documentId, fail: false }, TransactionRequestKeyV1Schema.make("core-clock:admission-expiry"))
      .pipe(Effect.provide(layer), Effect.provideService(Clock.Clock, clock));
    const outcome = await runSystemTestEffectV1(Effect.scoped(Effect.exit(invoke())));
    const replay = await runSystemTestEffectV1(Effect.scoped(Effect.exit(invoke())));
    return { outcome, replay, before, after: await readApplicationCoreMutationState(fixture),
      workerLoads: loader.loads, deadline, admissionTime: now };
  } finally { await loader.dispose(); }
}

function applicationMutationTestClock(currentTimeMillis: () => number): Clock.Clock {
  const live = Context.get(Context.empty(), Clock.Clock);
  return {
    currentTimeMillis: Effect.sync(currentTimeMillis), currentTimeMillisUnsafe: currentTimeMillis,
    currentTimeNanos: Effect.sync(() => BigInt(currentTimeMillis()) * 1_000_000n),
    currentTimeNanosUnsafe: () => BigInt(currentTimeMillis()) * 1_000_000n,
    monotonicTimeNanos: live.monotonicTimeNanos,
    monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(), sleep: duration => live.sleep(duration),
  };
}

export async function proveCoreApplicationAuthority(fixture: ApplicationCoreMutationFixture,
  mode: "beforeBody" | "duringBody" | "benignHead") {
  const before = await readApplicationCoreMutationState(fixture);
  const loader = new MiniflareApplicationWorkerLoader();
  try {
    const original = await makeApplicationMutationTestLive(fixture, loader);
    const live = mode === "beforeBody" ? Object.freeze({ ...original,
      grantIssuer: { issue: (input: Parameters<typeof original.grantIssuer.issue>[0]) => original.grantIssuer.issue(input)
        .pipe(Effect.tap(() => fixture.database.advanceAuthorityEpoch(2n).pipe(Effect.orDie))) },
    }) : original;
    const layer = makeApplicationMutationSystemLayer(live);
    const key = TransactionRequestKeyV1Schema.make('core-authority:' + mode);
    const invoke = () => invokeApplicationMutation(TransactionFunctionPathV1Schema.make("users:patchThroughInternal"),
      { id: fixture.documentId, fail: false }, key).pipe(Effect.provide(layer));
    const originalProgram = await runSystemTestEffectV1(fixture.database.selectProgram("users:patchThroughInternal"));
    if (mode === "beforeBody") {
      const outcome = await runSystemTestEffectV1(Effect.scoped(Effect.exit(invoke())));
      return { outcome, before, after: await readApplicationCoreMutationState(fixture), workerLoads: loader.loads,
        pointReads: loader.pointDocumentReads, originalProgramHash: originalProgram.identity.programHash,
        currentProgramHash: originalProgram.identity.programHash };
    }
    const block = loader.blockNextInvocation();
    const pending = runSystemTestEffectV1(Effect.scoped(Effect.exit(invoke())));
    await block.started;
    try {
      if (mode === "duringBody") await runSystemTestEffectV1(fixture.database.advanceAuthorityEpoch(2n));
      else await fixture.advanceProgramHead();
    } finally { block.release(); }
    const outcome = await pending;
    const currentProgram = await runSystemTestEffectV1(fixture.database.selectProgram("users:patchThroughInternal"));
    return { outcome, before, after: await readApplicationCoreMutationState(fixture), workerLoads: loader.loads,
      pointReads: loader.pointDocumentReads, originalProgramHash: originalProgram.identity.programHash,
      currentProgramHash: currentProgram.identity.programHash };
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationColdClaim(fixture: ApplicationCoreMutationFixture) {
  const loader = new MiniflareApplicationWorkerLoader();
  const before = await readApplicationCoreMutationState(fixture);
  try {
    const firstLayer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const key = TransactionRequestKeyV1Schema.make("core-claim:lost-acknowledgement");
    const invoke = (layer: typeof firstLayer) => invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("users:patchThroughInternal"), { id: fixture.documentId, fail: false }, key,
    ).pipe(Effect.provide(layer));
    fixture.loseNextWriteAcknowledgement();
    const lost = await runSystemTestEffectV1(Effect.scoped(Effect.exit(invoke(firstLayer))));
    const cold = await fixture.reopen();
    await fixture.advanceProgramHead();
    const coldFixture = Object.freeze({ ...fixture, database: cold });
    const coldLayer = await makeApplicationNativeMutationTestLayer(coldFixture, loader);
    const recovered = await runSystemTestEffectV1(Effect.scoped(Effect.exit(invoke(coldLayer))));
    const replayed = await runSystemTestEffectV1(Effect.scoped(Effect.exit(invoke(coldLayer))));
    return { lost, recovered, replayed, before, after: await readApplicationCoreMutationState(coldFixture), workerLoads: loader.loads };
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationBusyClaim(fixture: ApplicationCoreMutationFixture) {
  const loader = new MiniflareApplicationWorkerLoader();
  try {
    const layer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const key = TransactionRequestKeyV1Schema.make("core-claim:same-owner");
    const invoke = () => invokeApplicationMutation(TransactionFunctionPathV1Schema.make("users:patchThroughInternal"),
      { id: fixture.documentId, fail: false }, key).pipe(Effect.provide(layer));
    const block = loader.blockNextInvocation();
    const pending = runSystemTestEffectV1(Effect.scoped(Effect.exit(invoke())));
    await block.started;
    let contender;
    try { contender = await runSystemTestEffectV1(Effect.scoped(Effect.exit(invoke()))); }
    finally { block.release(); }
    const first = await pending;
    const replay = await runSystemTestEffectV1(Effect.scoped(invoke()));
    return { contender, first, replay, after: await readApplicationCoreMutationState(fixture), workerLoads: loader.loads };
  } finally { await loader.dispose(); }
}

async function readApplicationCoreMutationState(fixture: ApplicationCoreMutationFixture) {
  const transaction = await runSystemTestEffectV1(fixture.database.begin());
  try { return Object.freeze({ document: Option.getOrNull(await runSystemTestEffectV1(transaction.get(fixture.documentId))),
    indexed: await runSystemTestEffectV1(transaction.scan("users", "by_name")), history: await fixture.history() }); }
  finally { await runSystemTestEffectV1(transaction.abort()); }
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
  fixture: ApplicationMutationTestLiveFixture | ApplicationCoreMutationFixture,
  loader: WorkerLoader,
  options: Readonly<{
    readonly source?: ApplicationMutationSystemLive["applicationRunner"]["source"];
    readonly onExecution?: () => void;
    readonly afterRuntime?: () => Effect.Effect<void, never>;
    readonly uuidSequenceStart?: number;
  }> = {},
) {
  return makeApplicationMutationSystemLayer(
    await makeApplicationMutationTestLive(fixture, loader, options),
  );
}

export function makeApplicationMutationTestLive(fixture: ApplicationCoreMutationFixture, loader: WorkerLoader, options?: Readonly<{
    readonly source?: ApplicationMutationSystemLive["applicationRunner"]["source"];
    readonly onExecution?: () => void;
    readonly afterRuntime?: () => Effect.Effect<void, never>;
    readonly uuidSequenceStart?: number;
  }>): Promise<ApplicationCoreMutationSystemLive>;
export function makeApplicationMutationTestLive(fixture: ApplicationMutationTestLiveFixture, loader: WorkerLoader, options?: Readonly<{
    readonly source?: ApplicationMutationSystemLive["applicationRunner"]["source"];
    readonly onExecution?: () => void;
    readonly afterRuntime?: () => Effect.Effect<void, never>;
    readonly uuidSequenceStart?: number;
  }>): Promise<ApplicationMutationSystemLive>;
export function makeApplicationMutationTestLive(fixture: ApplicationMutationTestLiveFixture | ApplicationCoreMutationFixture, loader: WorkerLoader, options?: Readonly<{
    readonly source?: ApplicationMutationSystemLive["applicationRunner"]["source"];
    readonly onExecution?: () => void;
    readonly afterRuntime?: () => Effect.Effect<void, never>;
    readonly uuidSequenceStart?: number;
  }>): Promise<ApplicationMutationSystemLive | ApplicationCoreMutationSystemLive>;
export async function makeApplicationMutationTestLive(
  fixture: ApplicationMutationTestLiveFixture | ApplicationCoreMutationFixture,
  loader: WorkerLoader,
  options: Readonly<{
    readonly source?: ApplicationMutationSystemLive["applicationRunner"]["source"];
    readonly onExecution?: () => void;
    readonly afterRuntime?: () => Effect.Effect<void, never>;
    readonly uuidSequenceStart?: number;
  }> = {},
): Promise<ApplicationMutationSystemLive | ApplicationCoreMutationSystemLive> {
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
  let uuidSequence = options.uuidSequenceStart ?? 0;
  let executionSequence = 0;
  const applicationRunner = Object.freeze({
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
  });
  const executionContextFactory = Object.freeze({
      make: () => Effect.sync(() => {
        executionSequence += 1;
        options.onExecution?.();
        return Object.freeze({
          executionId: `application-native-execution-${executionSequence}`,
          logScopeId: `application-native-log-${executionSequence}`,
          randomSeed: new Uint8Array(32).fill(executionSequence),
        });
      }),
  });
  if ("database" in fixture) return Object.freeze({ coreDatabase: fixture.database, deploymentId, grantIssuer,
    applicationRunner, executionContextFactory, maximumAttempts: 3, queryCursor: fixture.queryCursor }) satisfies ApplicationCoreMutationSystemLive;
  return Object.freeze({
    deploymentId,
    activation: fixture.activation,
    admission: {
      deploymentId,
      controlDb: fixture.control.drizzle,
      schema: fixture.schema,
      ...(fixture.relationSchema === undefined
        ? {}
        : { relationSchema: fixture.relationSchema }),
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
    ...(fixture.applicationRelations === undefined
      ? {}
      : { applicationRelations: fixture.applicationRelations }),
    indexedQueries: fixture.indexedQueries,
    grantRetentionPolicy: RETENTION,
    applicationRunner,
    randomUuid: () => {
      uuidSequence += 1;
      return `35000000-0000-4000-8000-${uuidSequence.toString().padStart(12, "0")}`;
    },
    executionContextFactory,
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

export class ApplicationNativeWorkerLoader implements WorkerLoader {
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

export async function durableCounts(persistence: ApplicationNativeMutationPersistence) {
  const result = await persistence.query<{
    commits: string;
    outcomes: string;
    feed: string;
    outbox: string;
  }>(`select
    (select count(*)::text from fx_system_commit) as commits,
    (select count(*)::text from fx_system_idempotency) as outcomes,
    (select count(*)::text from fx_system_commit_app_row_change) as feed,
    (select count(*)::text from fx_system_commit_wake) as outbox`);
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
