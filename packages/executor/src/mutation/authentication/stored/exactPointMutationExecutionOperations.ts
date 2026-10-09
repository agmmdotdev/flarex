import {
  bytesEqualFullScan as bytesEqual,
  copyBytes,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Effect, Exit, Result, Schema } from "effect";

import type {
  PointCommitOutcomeResolutionV1Error,
} from "@flarex/persistence-postgres/point-commit-transaction";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import {
  CommitEnvelopeV1Schema,
  type CommitProtocolV1Error,
} from "flarex-protocol/commit-protocol";
import {
  canonicalizePointMutationRequestV1,
  type PointMutationTargetFunctionMetadataV1,
} from "flarex-protocol/point-mutation-start";
import type { SnapshotToken } from "flarex-protocol/storage-authority";
import {
  TransactionArgumentsSha256V1Schema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
  type TransactionAttemptFence,
} from "flarex-protocol/transaction-session";
import type {
  CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";

import type {
  PointMutationExecutionScopeV1,
} from "../../claims/pointMutationExecutionClaim";
import type {
  PointMutationExecutionLivenessV1Error,
} from "../../claims/pointMutationExecutionClaimLiveness";
import type {
  PointMutationJournalAttemptV1,
  PointMutationJournalBoundaryV1Error,
  PointMutationJournalRelationConflictError,
  PointMutationJournalTableV1,
  PointMutationJournalV1,
} from "../../journal/pointMutationJournal";
import type {
  PointMutationAdmittedFrameworkOperationV1Error,
  PointMutationJournalResultRejectedV1Error,
} from "../../journal/pointMutationJournalRpc";
import type {
  PointMutationExactRuntimeRunnerHostV1Error,
} from "../../runtime/pointMutationExactRuntimeRunner";
import type {
  LoadedPointMutationSessionAttemptV1,
  PointMutationSessionAttemptLoadingExecutionV1Error,
  PointMutationSessionAttemptLoadingV1,
  PointMutationSessionAttemptTerminalizationExecutionV1Error,
  PointMutationSessionAttemptTerminalizationV1,
} from "../../session/pointMutationSessionActivation";
import {
  getLoadedPointMutationSessionAttemptOccRerunInspectionV1,
} from "../../session/pointMutationSessionAttemptState";
import type {
  ApplicationPointMutationRunnerHostV1Error,
  CommitInputVerificationV1Error,
  PointCommitFinishingExecutionV1Error,
  PointCommitPlanningV1Error,
  PointCommitRecoveredPublicationExecutionV1Error,
  PointMutationOccBoundJournalV1,
  PointMutationOccExecutionContextFactoryV1,
  PointMutationOccExecutionContextV1,
  PointMutationOccRuntimeNeutralRunnerInputV1,
  PointMutationOccRuntimeNeutralRunnerV1,
  StoredAttemptAuthenticationV1,
  StoredAttemptAuthenticationV1Error,
  StoredCommitAuthorityAuthenticationV1Error,
  StoredPointCommitExecutorV1,
  StoredPointCommitFinishingTransitionV1,
  StoredPointCommitPlanningV1,
} from "../storedAttemptAuthentication";
import type {
  PinnedPointMutationFunctionMetadataReaderPortV1,
} from "./commitAuthorityModel";
import {
  capturePinnedFunctionSelector,
  isLegacyCommitAuthorityVerificationStateV1,
  verifyPinnedFunctionMetadataEffect,
  type VerifiedCommitAuthorityEvidenceV1,
} from "./commitAuthorityVerification";
import {
  PointMutationOccExecutionAuthorityCorruptionV1Error,
  type ExecuteExactPointMutationAttemptKernelV1,
  type ExecuteExactPointMutationAttemptInputV1,
  type PointMutationOccExecutionAuthorityMismatchV1Error,
  type PointMutationOccExecutionEvidencePersistenceV1Error,
  type PointMutationOccExecutionNotRunnableV1Error,
} from "./occRerunExecutionOperations";
import type {
  PointCommitOutcomeTicketCaptureOperationsV1,
} from "./occRerunAuthorizationOperations";
import {
  captureRunningRelationConflictReplacement,
} from "./pointCommitRuntimeModel";
import { detachVerifiedGrant } from "./verifiedGrantEvidence";

const encodeCommitEnvelopeV1 = Schema.encodeSync(CommitEnvelopeV1Schema);

export class PointMutationOccExecutionContextV1Error extends Data.TaggedError(
  "PointMutationOccExecutionContextV1Error",
)<{
  readonly reason:
    | "invalidExecutionId"
    | "invalidLogScopeId"
    | "invalidRandomSeed";
}> {}

export class PointMutationOccUserCodeV1Error extends Data.TaggedError(
  "PointMutationOccUserCodeV1Error",
)<{
  readonly cause: unknown;
}> {}


export class PointMutationOccApplicationErrorV1 extends Data.TaggedError(
  "PointMutationOccApplicationErrorV1",
)<{
  readonly code: string;
  readonly message: string;
  readonly data?: CanonicalFlarexRuntimeValueV1;
}> {}

export type PointMutationAuthenticatedAttemptExecutionV1Error =
  | PointMutationOccExecutionEvidencePersistenceV1Error
  | PointMutationOccExecutionNotRunnableV1Error
  | PointMutationOccExecutionAuthorityMismatchV1Error
  | PointMutationOccExecutionAuthorityCorruptionV1Error
  | PointMutationOccExecutionContextV1Error
  | PointMutationOccApplicationErrorV1
  | PointMutationOccUserCodeV1Error
  | PointMutationJournalBoundaryV1Error
  | PointMutationJournalResultRejectedV1Error
  | PointMutationAdmittedFrameworkOperationV1Error
  | PointMutationExactRuntimeRunnerHostV1Error
  | ApplicationPointMutationRunnerHostV1Error
  | CommitProtocolV1Error
  | PointMutationSessionAttemptLoadingExecutionV1Error
  | PointMutationSessionAttemptTerminalizationExecutionV1Error
  | StoredAttemptAuthenticationV1Error
  | StoredCommitAuthorityAuthenticationV1Error
  | CommitInputVerificationV1Error
  | PointCommitPlanningV1Error
  | PointCommitFinishingExecutionV1Error
  | PointCommitRecoveredPublicationExecutionV1Error
  | PointCommitOutcomeResolutionV1Error
  | PointMutationExecutionLivenessV1Error;

type PointMutationOccDetachedRunnerEvidenceV1 =
  PointMutationOccRuntimeNeutralRunnerInputV1 extends infer Input
    ? Input extends PointMutationOccRuntimeNeutralRunnerInputV1
      ? Omit<Input, "context" | "journal">
      : never
    : never;

type PointMutationOccRunnerOutcome =
  | Readonly<{
      readonly kind: "successfulResult";
      readonly successfulResult: unknown;
    }>
  | Readonly<{
      readonly kind: "runningRelationConflict";
      readonly error: PointMutationJournalRelationConflictError;
    }>;

export interface ExactPointMutationExecutionOperationDependenciesV1 {
  readonly functionMetadata?:
    PinnedPointMutationFunctionMetadataReaderPortV1 | undefined;
  readonly contextFactory: PointMutationOccExecutionContextFactoryV1;
  readonly attemptLoading: Pick<
    PointMutationSessionAttemptLoadingV1,
    "load"
  >;
  readonly journal: PointMutationJournalV1;
  readonly runner: PointMutationOccRuntimeNeutralRunnerV1;
  readonly terminalization: Pick<
    PointMutationSessionAttemptTerminalizationV1,
    "abort"
  >;
  readonly deriveAuthority: StoredAttemptAuthenticationV1["deriveAuthority"];
  readonly authenticate: StoredAttemptAuthenticationV1["authenticate"];
  readonly authenticateCommitAuthority:
    StoredPointCommitPlanningV1["authenticateCommitAuthority"];
  readonly verifyCommitInput: StoredPointCommitPlanningV1["verifyCommitInput"];
  readonly planPointCommit: StoredPointCommitPlanningV1["planPointCommit"];
  readonly enterPointCommitFinishing:
    StoredPointCommitFinishingTransitionV1["enterPointCommitFinishing"];
  readonly publishFinishingPointCommit:
    StoredPointCommitExecutorV1["publishPointCommit"];
  readonly captureRunningRelationConflictTicket:
    PointCommitOutcomeTicketCaptureOperationsV1[
      "captureRunningRelationConflictTicket"
    ];
}

export interface ExactPointMutationExecutionOperationsV1 {
  readonly executeExactPointMutationAttempt:
    ExecuteExactPointMutationAttemptKernelV1<
      PointMutationAuthenticatedAttemptExecutionV1Error
    >;
}

export function makeExactPointMutationExecutionOperationsV1(
  dependencies: ExactPointMutationExecutionOperationDependenciesV1,
): ExactPointMutationExecutionOperationsV1 {
  const {
    functionMetadata,
    contextFactory,
    attemptLoading,
    journal,
    runner,
    terminalization,
    deriveAuthority,
    authenticate,
    authenticateCommitAuthority,
    verifyCommitInput,
    planPointCommit,
    enterPointCommitFinishing,
    publishFinishingPointCommit,
    captureRunningRelationConflictTicket,
  } = dependencies;

  const prepareExecution = Effect.fn("StoredAttemptAuthentication.prepareExactExecution")(
    function* <InspectionUnavailableError, CurrentValidationError>(input: Readonly<
      ExecuteExactPointMutationAttemptInputV1<InspectionUnavailableError, CurrentValidationError>>) {
      const generation = input.verificationState.session
        .executionAuthorityGeneration;
      if (
        input.executionEvidence.session.executionAuthorityGeneration !==
          generation ||
        input.verifiedEvidence.executionAuthorityGeneration !== generation ||
        (generation === "legacy_dynamic_worker_v1" &&
          (input.executionEvidence.session.artifactRuntime !==
            "dynamic-worker" ||
            !isLegacyCommitAuthorityVerificationStateV1(
              input.verificationState,
            )))
      ) {
        return yield* Effect.fail(
          new PointMutationOccExecutionAuthorityCorruptionV1Error({
            reason: "runtimePinInvalid",
          }),
        );
      }
      const canonicalRequest = yield* Effect.tryPromise({
        try: () =>
        canonicalizePointMutationRequestV1({
          deploymentId: input.verificationState.authority.deploymentId,
          functionPath: TransactionFunctionPathV1Schema.make(
            input.verificationState.session.functionPath,
          ),
          validatedArgsSha256: TransactionArgumentsSha256V1Schema.make(
            copyBytes(input.verificationState.session.validatedArgsSha256),
          ),
          requestKey: TransactionRequestKeyV1Schema.make(
            input.verificationState.session.requestKey,
          ),
        }),
        catch: (cause) =>
          new PointMutationOccExecutionAuthorityCorruptionV1Error({
            reason: "requestEvidenceInvalid",
            cause,
          }),
      });
      if (
        !bytesEqual(
          canonicalRequest.sha256,
          input.verificationState.session.requestSha256,
        ) ||
        (input.expectedRequestSha256 !== undefined &&
          !bytesEqual(canonicalRequest.sha256, input.expectedRequestSha256))
      ) {
        return yield* Effect.fail(
          new PointMutationOccExecutionAuthorityCorruptionV1Error({
            reason: "requestEvidenceInvalid",
          }),
        );
      }
      let runnerEvidence: PointMutationOccDetachedRunnerEvidenceV1;
      if (isLegacyCommitAuthorityVerificationStateV1(
        input.verificationState,
      ) && input.verifiedEvidence.executionAuthorityGeneration ===
        "legacy_dynamic_worker_v1") {
        if (functionMetadata === undefined) {
          return yield* Effect.fail(new PointMutationOccExecutionAuthorityCorruptionV1Error({
            reason: "runtimePinInvalid",
          }));
        }
        const metadataUnknown = yield* functionMetadata.load(
          capturePinnedFunctionSelector(input.verificationState),
        );
        const pinnedFunctionMetadata = yield* verifyPinnedFunctionMetadataEffect(
          input.verificationState,
          metadataUnknown,
        );
        runnerEvidence = captureLegacyPointMutationOccRunnerEvidence(
          input.verifiedEvidence,
          pinnedFunctionMetadata,
        );
      } else if (
        input.verificationState.session.executionAuthorityGeneration ===
          "application_v1" &&
        input.verifiedEvidence.executionAuthorityGeneration === "application_v1"
      ) {
        runnerEvidence = captureApplicationPointMutationOccRunnerEvidence(
          input.verifiedEvidence,
        );
      } else {
        return yield* Effect.fail(
          new PointMutationOccExecutionAuthorityCorruptionV1Error({
            reason: "runtimePinInvalid",
          }),
        );
      }
      // Runtime-local entropy may be fresh. Persisted creation time remains the
      // exact attempt seed authenticated above.
      const entropy = yield* contextFactory.make();

      // The RR capture is closed. This is the last liveness/claim reload before
      // the journal admission and user-code boundary.
      const loadCurrentAttempt = attemptLoading.load({
        deploymentId: input.selector.deploymentId,
        scopeId: input.selector.scopeId,
        sessionId: input.selector.sessionId,
        attemptFence: input.selector.attemptFence.toString(),
      });
      const currentAttempt = yield* loadCurrentAttempt;
      const currentAuthority = currentAttempt;
      const currentInspection = getLoadedPointMutationSessionAttemptOccRerunInspectionV1(currentAttempt);
      if (currentInspection === undefined) return yield* Effect.fail(input.currentInspectionUnavailable());
      yield* input.validateCurrent(currentInspection);

      return { currentAuthority, currentAttempt, runnerEvidence, entropy, loadCurrentAttempt };
    });

  const prepareBody = Effect.fn("StoredAttemptAuthentication.prepareExactBody")(
    function* <InspectionUnavailableError, CurrentValidationError>(input: Readonly<
      ExecuteExactPointMutationAttemptInputV1<InspectionUnavailableError, CurrentValidationError>>,
      prepared: Effect.Success<ReturnType<typeof prepareExecution>>) {
      const context = yield* Effect.fromResult(capturePointMutationOccExecutionContext(
        prepared.entropy, input.executionEvidence.creationTimeSeed, input.attemptFence, input.snapshotToken));
      const journalAttempt = yield* journal.openAttempt(prepared.currentAttempt, input.executionScope);
      return Object.freeze({ journalAttempt, runnerInput: capturePointMutationOccRunnerInput(prepared.runnerEvidence,
        context, bindPointMutationOccJournal(journal, journalAttempt)) });
    });

  const executeExactPointMutationAttempt:
    ExactPointMutationExecutionOperationsV1[
      "executeExactPointMutationAttempt"
    ] = Effect.fn(
      "StoredAttemptAuthentication.executeExactPointMutationAttemptKernel",
    )(function* <InspectionUnavailableError, CurrentValidationError>(
      input: Readonly<
        ExecuteExactPointMutationAttemptInputV1<
          InspectionUnavailableError,
          CurrentValidationError
        >
      >,
    ) {
      const prepared = yield* prepareExecution(input);
      const { currentAuthority, currentAttempt, loadCurrentAttempt } = prepared;
      const prepareRunningPlan = Effect.gen(function* () {
        const { journalAttempt, runnerInput } = yield* prepareBody(input, prepared);
        const runnerOutcome: PointMutationOccRunnerOutcome = yield* runner.run(
          runnerInput,
        ).pipe(
          Effect.map((successfulResult): PointMutationOccRunnerOutcome =>
            Object.freeze({
              kind: "successfulResult" as const,
              successfulResult,
            })
          ),
          Effect.catchTag(
            "PointMutationJournalRelationConflictError",
            (runnerError) =>
              Effect.fromResult(
                journal.claimPersistedRelationConflictForRetry(runnerError),
              ).pipe(
                Effect.mapError(() => runnerError),
                Effect.flatMap((claimed) =>
                  Effect.fromResult(
                    captureRunningRelationConflictReplacement(
                      input.verificationState,
                      input.executionClaim,
                      claimed.request,
                      claimed.conflict,
                    ),
                  ).pipe(
                    Effect.mapError((cause) =>
                      new PointMutationOccExecutionAuthorityCorruptionV1Error({
                        reason: "runtimePinInvalid",
                        cause,
                      })
                    ),
                    Effect.map((captured): PointMutationOccRunnerOutcome => {
                      captureRunningRelationConflictTicket(
                        claimed.error,
                        captured,
                      );
                      return Object.freeze({
                        kind: "runningRelationConflict" as const,
                        error: claimed.error,
                      });
                    }),
                  )
                ),
              ),
          ),
          effect => discardTentativeRootOnFailure(effect, journal,
            journalAttempt),
        );
        if (runnerOutcome.kind === "runningRelationConflict") {
          yield* journal.discardTentativeRoot(journalAttempt);
          return runnerOutcome;
        }
        const envelope = yield* journal.sealSuccessfulResult(
          journalAttempt,
          runnerOutcome.successfulResult === undefined
            ? null
            : runnerOutcome.successfulResult,
        ).pipe(effect => discardTentativeRootOnFailure(effect, journal,
          journalAttempt));
        const encodedEnvelope = yield* Effect.sync(() =>
          encodeCommitEnvelopeV1(envelope)
        );
        const storedAuthority = yield* deriveAuthority(
          currentAuthority,
          input.executionScope,
        );
        const storedAttempt = yield* authenticate(
          storedAuthority,
          encodedEnvelope,
        );
        const authenticatedAuthority = yield* authenticateCommitAuthority(
          storedAttempt,
        );
        const verifiedInput = yield* verifyCommitInput(authenticatedAuthority);
        return Object.freeze({
          kind: "planned" as const,
          plan: yield* planPointCommit(verifiedInput),
        });
      });
      const runningPlan = yield* abortOnPreFinishingFailure(
        prepareRunningPlan,
        currentAttempt === undefined ? Effect.flatMap(loadCurrentAttempt, attempt => terminalization.abort(attempt, input.executionScope))
          : terminalization.abort(currentAttempt, input.executionScope),
      );

      if (runningPlan.kind === "runningRelationConflict") {
        return Object.freeze({
          kind: "conflict" as const,
          error: runningPlan.error,
        });
      }

      const finishingPlan = yield* input.liveness.enterFinishing(
        enterPointCommitFinishing(runningPlan.plan),
      );
      return yield* publishFinishingPointCommit(finishingPlan).pipe(
        Effect.map((result) => Object.freeze({
          kind: "completed" as const,
          result,
        })),
        Effect.catchTag("PointCommitConflictV1Error", (error) =>
          Effect.succeed(Object.freeze({
            kind: "conflict" as const,
            error,
          }))),
      );
    });

  return Object.freeze({
    executeExactPointMutationAttempt,
  } satisfies ExactPointMutationExecutionOperationsV1);
}

export type PointMutationOccBaseExecutionContext = Pick<PointMutationOccExecutionContextV1, "executionId" | "logScopeId" | "randomSeed">;

export function capturePointMutationOccBaseExecutionContext(entropy: Readonly<{
  executionId: unknown; logScopeId: unknown; randomSeed: unknown;
}>): Result.Result<PointMutationOccBaseExecutionContext, PointMutationOccExecutionContextV1Error> {
  if (!isNonBlankString(entropy.executionId)) {
    return Result.fail(
      new PointMutationOccExecutionContextV1Error({
        reason: "invalidExecutionId",
      }),
    );
  }
  if (!isNonBlankString(entropy.logScopeId)) {
    return Result.fail(
      new PointMutationOccExecutionContextV1Error({
        reason: "invalidLogScopeId",
      }),
    );
  }
  if (!isUint8ArrayWithByteLength(entropy.randomSeed, 32)) {
    return Result.fail(
      new PointMutationOccExecutionContextV1Error({
        reason: "invalidRandomSeed",
      }),
    );
  }
  return Result.succeed(Object.freeze({ executionId: entropy.executionId, logScopeId: entropy.logScopeId,
    randomSeed: copyBytes(entropy.randomSeed) }));
}

export function bindPointMutationOccExecutionContext(base: PointMutationOccBaseExecutionContext,
  creationTimeSeed: AppCreationTimeV1, attemptFence: TransactionAttemptFence,
  snapshotToken: SnapshotToken): PointMutationOccExecutionContextV1 {
  return Object.freeze({ ...base, randomSeed: copyBytes(base.randomSeed), executionTime: creationTimeSeed,
    initialCreationTimeCursor: creationTimeSeed, attemptFence, snapshotToken: Object.freeze({ ...snapshotToken }) });
}

export function capturePointMutationOccExecutionContext(entropy: Readonly<{
  executionId: unknown; logScopeId: unknown; randomSeed: unknown;
}>, creationTimeSeed: AppCreationTimeV1, attemptFence: TransactionAttemptFence,
  snapshotToken: SnapshotToken): Result.Result<PointMutationOccExecutionContextV1, PointMutationOccExecutionContextV1Error> {
  return capturePointMutationOccBaseExecutionContext(entropy).pipe(Result.map(base =>
    bindPointMutationOccExecutionContext(base, creationTimeSeed, attemptFence, snapshotToken)));
}

export function bindPointMutationOccJournal(
  journal: PointMutationJournalV1,
  attempt: PointMutationJournalAttemptV1,
): PointMutationOccBoundJournalV1 {
  const admitted = journal.runAdmittedOperation;
  return Object.freeze({
    ...(admitted === undefined ? {} : {
      runAdmittedOperation: (input: Parameters<NonNullable<PointMutationJournalV1["runAdmittedOperation"]>>[1]) =>
        admitted(attempt, input),
    }),
    resolvePointTable: (tableName: unknown) =>
      journal.resolvePointTable(attempt, tableName),
    runPointOperation: (
      table: PointMutationJournalTableV1,
      operation: unknown,
    ) => journal.runPointOperation(table, operation),
    resolveDeveloperIndex: (
      table: PointMutationJournalTableV1,
      indexDescriptor: unknown,
    ) => journal.resolveDeveloperIndex(table, indexDescriptor),
    runIndexedQuery: (
      index: Parameters<PointMutationJournalV1["runIndexedQuery"]>[0],
      operation: unknown,
    ) => journal.runIndexedQuery(index, operation),
    resolveApplicationRelationRead: (
      capability: Parameters<
        PointMutationJournalV1["resolveApplicationRelationRead"]
      >[1],
    ) => journal.resolveApplicationRelationRead(attempt, capability),
    runApplicationRelationIncomingRead: (
      relation: Parameters<
        PointMutationJournalV1["runApplicationRelationIncomingRead"]
      >[0],
      operation: unknown,
    ) => journal.runApplicationRelationIncomingRead(relation, operation),
  });
}

function captureLegacyPointMutationOccRunnerEvidence(
  evidence: Extract<VerifiedCommitAuthorityEvidenceV1, {
    readonly executionAuthorityGeneration: "legacy_dynamic_worker_v1";
  }>,
  functionMetadata: PointMutationTargetFunctionMetadataV1,
): PointMutationOccDetachedRunnerEvidenceV1 {
  return Object.freeze({
    executionAuthorityGeneration: "legacy_dynamic_worker_v1",
    argumentsJson: Object.freeze(structuredClone(evidence.argumentsJson)),
    argumentArraySemanticBytes: evidence.argumentArraySemanticBytes,
    verifiedGrant: detachVerifiedGrant(evidence.verifiedGrant),
    schemaManifest: Object.freeze(structuredClone(evidence.schemaManifest)),
    stableBindings: Object.freeze(structuredClone(evidence.stableBindings)),
    functionMetadata: Object.freeze(structuredClone(functionMetadata)),
  });
}

function captureApplicationPointMutationOccRunnerEvidence(
  evidence: Extract<VerifiedCommitAuthorityEvidenceV1, {
    readonly executionAuthorityGeneration: "application_v1";
  }>,
): PointMutationOccDetachedRunnerEvidenceV1 {
  return Object.freeze({
    executionAuthorityGeneration: "application_v1",
    argumentsJson: Object.freeze(structuredClone(evidence.argumentsJson)),
    argumentArraySemanticBytes: evidence.argumentArraySemanticBytes,
    verifiedGrant: evidence.verifiedGrant,
    schemaManifest: Object.freeze(structuredClone(evidence.schemaManifest)),
    stableBindings: Object.freeze(structuredClone(evidence.stableBindings)),
    application: Object.freeze(structuredClone(evidence.application)),
  });
}

function capturePointMutationOccRunnerInput(
  evidence: PointMutationOccDetachedRunnerEvidenceV1,
  context: PointMutationOccExecutionContextV1,
  journal: PointMutationOccBoundJournalV1,
): PointMutationOccRuntimeNeutralRunnerInputV1 {
  return Object.freeze({
    ...evidence,
    context: Object.freeze({
      ...context,
      randomSeed: copyBytes(context.randomSeed),
      snapshotToken: Object.freeze({ ...context.snapshotToken }),
    }),
    journal,
  });
}

function discardTentativeRootOnFailure<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  journal: Pick<PointMutationJournalV1, "discardTentativeRoot">,
  attempt: PointMutationJournalAttemptV1,
): Effect.Effect<A, E | PointMutationJournalBoundaryV1Error, R> {
  return Effect.onExit(effect, primaryExit => {
    if (Exit.isSuccess(primaryExit)) return Effect.void;
    return Effect.uninterruptible(journal.discardTentativeRoot(attempt));
  });
}

function abortOnPreFinishingFailure<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  abort: Effect.Effect<unknown, PointMutationSessionAttemptTerminalizationExecutionV1Error | PointMutationSessionAttemptLoadingExecutionV1Error>,
): Effect.Effect<
  A,
  E | PointMutationSessionAttemptTerminalizationExecutionV1Error | PointMutationSessionAttemptLoadingExecutionV1Error,
  R
> {
  return Effect.onExit(effect, (primaryExit) => {
    if (Exit.isSuccess(primaryExit)) return Effect.void;
    return Effect.uninterruptible(
      abort,
    );
  });
}
