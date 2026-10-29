import {
  decodeAppDocumentIdentityV1,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import { decodeCanonicalAppDocumentEvidenceV1 } from "flarex-protocol/app-document";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import type { fxAppRowRevisions } from
  "@flarex/persistence-postgres/internal/system-test/schema";
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
  invokeApplicationMutation,
  type InvokeApplicationMutationError,
  makeApplicationMutationSystemLayer,
} from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
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

import { MiniflareApplicationWorkerLoader } from "./applicationNativeQueryHarness";

const COMPATIBILITY_DATE = "2026-06-14";
const NESTED_USER_DOCUMENT_ID = "1:00000000-0000-0000-0000-000000000011";
export const APPLICATION_NESTED_MUTATION_FIXTURE_OPTIONS = Object.freeze({
  runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
  compatibilityDate: COMPATIBILITY_DATE,
  includeInternalCalls: true,
  includeUserNameIndex: true,
  // Build the initial row into intrinsic indexes before activation.
  initialUserDocuments: [{ name: "Ada", rowId: decodeAppRowIdHexV1("00".repeat(15) + "11") }],
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

export async function proveApplicationNestedMutation(fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>) {
  const before = await durableCounts(fixture.target);
  const loader = new MiniflareApplicationWorkerLoader();
  try {
    const layer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const invoke = () => runSystemTestEffectV1(Effect.scoped(invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("users:deleteThroughInternal"),
      { id: NESTED_USER_DOCUMENT_ID },
      TransactionRequestKeyV1Schema.make("application-native:nested-delete"),
    ).pipe(Effect.provide(layer))));
    const published = await invoke();
    const replayed = await invoke();
    const after = await durableCounts(fixture.target);
    const tombstones = await fixture.target.query<{ count: number }>(`
      select count(*)::int as count from fx_app_row_current as current_row
      join fx_app_row_rev as revision using (scope_uuid, table_id, row_id, commit_seq)
      where revision.is_tombstone
    `);
    return { published, replayed, before, after, workerLoads: loader.loads,
      tombstones: tombstones.rows[0]?.count };
  } finally {
    await loader.dispose();
  }
}

export async function proveApplicationNestedMutationFailure(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
) {
  const calls: Array<Readonly<{ method: string; arguments: readonly unknown[] }>> = [];
  const loader = new MiniflareApplicationWorkerLoader((method, argumentsValue) => {
    calls.push(Object.freeze({ method, arguments: structuredClone(argumentsValue) }));
  });
  try {
    const failureRequestKey = "application-native:nested-patch-failure";
    let failureReceipts: Awaited<ReturnType<
      typeof readApplicationNestedMutationReceipts
    >> | undefined;
    const layer = await makeApplicationNativeMutationTestLayer(fixture, loader, {
      // Abort terminalization removes journals. Observe genuine stored receipts
      // after the Worker has finished, while the actual runner still owns them.
      afterRuntime: () => failureReceipts === undefined
        ? Effect.promise(async () => {
          failureReceipts = await readApplicationNestedMutationReceipts(
            fixture, failureRequestKey,
          );
        })
        : Effect.void,
    });
    const invoke = (fail: boolean, requestKey: string) => invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("users:patchThroughInternal"),
      { id: NESTED_USER_DOCUMENT_ID, fail },
      TransactionRequestKeyV1Schema.make(requestKey),
    );
    const before = await readApplicationNestedMutationState(fixture);
    const failureOutcome = await runSystemTestEffectV1(Effect.scoped(
      invoke(true, failureRequestKey).pipe(
        Effect.map(outcome => Object.freeze({
          disposition: "accepted" as const,
          outcomeDisposition: outcome.disposition,
          value: outcome.value,
        })),
        Effect.catchTag("PointMutationOccApplicationErrorV1", error =>
          Effect.succeed(Object.freeze({
            disposition: "rejected" as const,
            errorTag: error._tag,
            code: error.code,
            message: error.message,
            data: error.data,
          }))),
        Effect.provide(layer),
      ),
    ));
    const afterFailure = await readApplicationNestedMutationState(fixture);
    if (failureReceipts === undefined) {
      throw new Error("Nested Application Worker did not reach its observation boundary.");
    }
    const failureCalls = calls.splice(0);
    const failureWorkerLoads = loader.loads;
    const successful = await runSystemTestEffectV1(Effect.scoped(
      invoke(false, "application-native:nested-patch-success").pipe(
        Effect.provide(layer),
      ),
    ));
    const afterSuccess = await readApplicationNestedMutationState(fixture);
    const successWorkerLoads = loader.loads;
    const subsequent = await runSystemTestEffectV1(Effect.scoped(
      invokeApplicationMutation(
        TransactionFunctionPathV1Schema.make("users:create"),
        { name: "Independent after nested failure" },
        TransactionRequestKeyV1Schema.make("application-native:after-nested-failure"),
      ).pipe(Effect.provide(layer)),
    ));
    const afterSubsequent = await readApplicationNestedMutationState(fixture);
    return Object.freeze({
      documentId: NESTED_USER_DOCUMENT_ID,
      before,
      failure: Object.freeze({
        outcome: failureOutcome,
        state: afterFailure,
        receipts: failureReceipts,
        calls: failureCalls,
        workerLoads: failureWorkerLoads,
      }),
      success: Object.freeze({
        outcome: successful,
        state: afterSuccess,
        workerLoads: successWorkerLoads - failureWorkerLoads,
      }),
      subsequent: Object.freeze({
        outcome: subsequent,
        state: afterSubsequent,
        workerLoads: loader.loads - successWorkerLoads,
      }),
    });
  } finally {
    await loader.dispose();
  }
}

async function readApplicationNestedMutationState(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
) {
  const scopeUuid = projectScopeIdUuidV1(fixture.authority.scopeId).scopeUuid;
  const identity = decodeAppDocumentIdentityV1(NESTED_USER_DOCUMENT_ID);
  const parameters = [scopeUuid, identity.tableId, identity.rowId];
  const rows = await fixture.target.query<Pick<
    typeof fxAppRowRevisions.$inferSelect,
    "creationTime" | "valueCodecVersion" | "valueBytes" | "valueSha256"
  > & { commitSeq: string; revision: unknown }>(`
    select current_row.commit_seq::text as "commitSeq",
      revision.creation_time as "creationTime",
      revision.value_codec_version as "valueCodecVersion",
      revision.value_bytes as "valueBytes", revision.value_sha256 as "valueSha256",
      to_jsonb(revision) as revision
    from fx_app_row_current as current_row
    join fx_app_row_rev as revision using (scope_uuid, table_id, row_id, commit_seq)
    where current_row.scope_uuid = $1 and current_row.table_id = $2
      and current_row.row_id = decode($3, 'hex')`, parameters);
  const row = rows.rows[0];
  if (rows.rows.length !== 1 || row === undefined) {
    throw new Error("Nested Application witness requires its exact current row.");
  }
  const document = await decodeCanonicalAppDocumentEvidenceV1({
    tableId: identity.tableId, rowId: identity.rowId,
    creationTime: row.creationTime, codecVersion: row.valueCodecVersion,
    canonicalBytes: row.valueBytes, sha256: row.valueSha256,
  });
  // Detached database projections are compared verbatim; they grant no capability.
  const history = await fixture.target.query<{ revision: unknown }>(`
    select to_jsonb(revision) as revision from fx_app_row_rev as revision
    where scope_uuid = $1 and table_id = $2 and row_id = decode($3, 'hex')
    order by commit_seq`, parameters);
  const membership = await fixture.target.query<{ membership: unknown }>(`
    select to_jsonb(current_entry) as membership
    from fx_app_index_entry_current as current_entry
    join fx_app_index_entry_rev as revision
      using (scope_uuid, index_definition_id, encoded_key, row_id, commit_seq)
    where current_entry.scope_uuid = $1 and revision.table_id = $2
      and current_entry.row_id = decode($3, 'hex')
    order by current_entry.index_definition_id, current_entry.encoded_key`, parameters);
  const membershipHistory = await fixture.target.query<{ revision: unknown }>(`
    select to_jsonb(revision) as revision from fx_app_index_entry_rev as revision
    where scope_uuid = $1 and table_id = $2 and row_id = decode($3, 'hex')
    order by index_definition_id, encoded_key, commit_seq`, parameters);
  const counts = await fixture.target.query<{
    commits: number; successfulOutcomes: number; feed: number; outbox: number;
  }>(`select
    (select count(*)::int from fx_system_commit where scope_uuid = $1) as commits,
    (select count(*)::int from fx_system_idempotency where scope_uuid = $1) as "successfulOutcomes",
    (select count(*)::int from fx_system_commit_app_row_change where scope_uuid = $1) as feed,
    (select count(*)::int from fx_system_commit_wake where scope_uuid = $1) as outbox`,
  [scopeUuid]);
  const publication = counts.rows[0];
  if (publication === undefined) throw new Error("Nested Application counts are missing.");
  return Object.freeze({
    scopeUuid,
    tableId: identity.tableId,
    rowId: identity.rowId,
    document: document.valueJson,
    commitSeq: BigInt(row.commitSeq),
    currentRevision: row.revision,
    history: history.rows.map(item => item.revision),
    membership: membership.rows.map(item => item.membership),
    membershipHistory: membershipHistory.rows.map(item => item.revision),
    publication,
  });
}

async function readApplicationNestedMutationReceipts(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
  requestKey: string,
) {
  const scopeUuid = projectScopeIdUuidV1(fixture.authority.scopeId).scopeUuid;
  const receipts = await fixture.target.query<{
    sequence: string; operationKind: string; outcomeKind: string;
    requestBytes: Uint8Array; requestSha256: Uint8Array;
    outcomeBytes: Uint8Array; outcomeSha256: Uint8Array;
  }>(`select receipt.last_syscall_sequence::text as sequence,
      receipt.operation_kind as "operationKind", receipt.outcome_kind as "outcomeKind",
      receipt.request_bytes as "requestBytes", receipt.request_sha256 as "requestSha256",
      receipt.outcome_bytes as "outcomeBytes", receipt.outcome_sha256 as "outcomeSha256"
    from fx_system_tx_journal_receipt as receipt
    join fx_system_tx_session as session using (scope_uuid, session_id, attempt_fence)
    where session.scope_uuid = $1 and session.request_key = $2
    order by receipt.last_syscall_sequence`, [scopeUuid, requestKey]);
  const observations = [];
  for (const receipt of receipts.rows) {
    const request = await decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes: receipt.requestBytes, sha256: receipt.requestSha256,
    });
    const outcome = await decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes: receipt.outcomeBytes, sha256: receipt.outcomeSha256,
    });
    observations.push(Object.freeze({
      sequence: BigInt(receipt.sequence),
      operationKind: receipt.operationKind,
      outcomeKind: receipt.outcomeKind,
      request: request.valueJson,
      outcome: outcome.valueJson,
    }));
  }
  return observations;
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
  fixture: ApplicationMutationTestLiveFixture,
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

export async function makeApplicationMutationTestLive(
  fixture: ApplicationMutationTestLiveFixture,
  loader: WorkerLoader,
  options: Readonly<{
    readonly source?: ApplicationMutationSystemLive["applicationRunner"]["source"];
    readonly onExecution?: () => void;
    readonly afterRuntime?: () => Effect.Effect<void, never>;
    readonly uuidSequenceStart?: number;
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
  let uuidSequence = options.uuidSequenceStart ?? 0;
  let executionSequence = 0;
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
