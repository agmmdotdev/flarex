import {
  bytesEqualFullScan as bytesEqual,
  copyBytes,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";
import { Cause, Data, Effect, Exit, Result, Schema } from "effect";

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
  PointMutationExecutionScopeV1,
} from "../pointMutationExecutionClaim";
import type {
  PointMutationExecutionLivenessV1Error,
} from "../pointMutationExecutionClaimLiveness";
import type {
  PointMutationJournalAttemptV1,
  PointMutationJournalBoundaryV1Error,
  PointMutationJournalTableV1,
  PointMutationJournalV1,
} from "../pointMutationJournal";
import type {
  LoadedPointMutationSessionAttemptV1,
  PointMutationSessionAttemptLoadingExecutionV1Error,
  PointMutationSessionAttemptLoadingV1,
  PointMutationSessionAttemptTerminalizationExecutionV1Error,
  PointMutationSessionAttemptTerminalizationV1,
} from "../pointMutationSessionActivation";
import {
  getLoadedPointMutationSessionAttemptOccRerunInspectionV1,
} from "../pointMutationSessionAttemptState";
import type {
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

export type PointMutationAuthenticatedAttemptExecutionV1Error =
  | PointMutationOccExecutionEvidencePersistenceV1Error
  | PointMutationOccExecutionNotRunnableV1Error
  | PointMutationOccExecutionAuthorityMismatchV1Error
  | PointMutationOccExecutionAuthorityCorruptionV1Error
  | PointMutationOccExecutionContextV1Error
  | PointMutationOccUserCodeV1Error
  | PointMutationJournalBoundaryV1Error
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

type PointMutationOccDetachedRunnerEvidenceV1 = Omit<
  PointMutationOccRuntimeNeutralRunnerInputV1,
  "context" | "journal"
>;

export interface ExactPointMutationExecutionOperationDependenciesV1 {
  readonly functionMetadata:
    PinnedPointMutationFunctionMetadataReaderPortV1;
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
  } = dependencies;

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
      if (input.executionEvidence.session.artifactRuntime !== "dynamic-worker") {
        return yield* Effect.fail(
          new PointMutationOccExecutionAuthorityCorruptionV1Error({
            reason: "runtimePinInvalid",
          }),
        );
      }
      const canonicalRequest = yield* Effect.promise(() =>
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
        })
      );
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
      const metadataUnknown = yield* functionMetadata.load(
        capturePinnedFunctionSelector(input.verificationState),
      );
      const pinnedFunctionMetadata = yield* verifyPinnedFunctionMetadataEffect(
        input.verificationState,
        metadataUnknown,
      );
      const runnerEvidence = capturePointMutationOccRunnerEvidence(
        input.verifiedEvidence,
        pinnedFunctionMetadata,
      );
      // Runtime-local entropy may be fresh. Persisted creation time remains the
      // exact attempt seed authenticated above.
      const entropy = yield* contextFactory.make();

      // The RR capture is closed. This is the last liveness/claim reload before
      // the journal admission and user-code boundary.
      const currentAttempt = yield* attemptLoading.load({
        deploymentId: input.selector.deploymentId,
        scopeId: input.selector.scopeId,
        sessionId: input.selector.sessionId,
        attemptFence: input.selector.attemptFence.toString(),
      });
      const currentInspection =
        getLoadedPointMutationSessionAttemptOccRerunInspectionV1(
          currentAttempt,
        );
      if (currentInspection === undefined) {
        return yield* Effect.fail(input.currentInspectionUnavailable());
      }
      yield* input.validateCurrent(currentInspection);

      const prepareRunningPlan = Effect.gen(function* () {
        const context = yield* Effect.fromResult(
          capturePointMutationOccExecutionContext(
            entropy,
            input.executionEvidence.creationTimeSeed,
            input.attemptFence,
            input.snapshotToken,
          ),
        );
        const journalAttempt = yield* journal.openAttempt(
          currentAttempt,
          input.executionScope,
        );
        const successfulResult = yield* runner.run(
          capturePointMutationOccRunnerInput(
            runnerEvidence,
            context,
            bindPointMutationOccJournal(journal, journalAttempt),
          ),
        );
        const envelope = yield* journal.sealSuccessfulResult(
          journalAttempt,
          successfulResult === undefined ? null : successfulResult,
        );
        const encodedEnvelope = yield* Effect.sync(() =>
          encodeCommitEnvelopeV1(envelope)
        );
        const storedAuthority = yield* deriveAuthority(
          currentAttempt,
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
        return yield* planPointCommit(verifiedInput);
      });
      const runningPlan = yield* abortOnPreFinishingFailure(
        prepareRunningPlan,
        currentAttempt,
        input.executionScope,
        terminalization,
      );

      const finishingPlan = yield* input.liveness.enterFinishing(
        enterPointCommitFinishing(runningPlan),
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

function capturePointMutationOccExecutionContext(
  entropy: Readonly<{
    readonly executionId: unknown;
    readonly logScopeId: unknown;
    readonly randomSeed: unknown;
  }>,
  creationTimeSeed: AppCreationTimeV1,
  attemptFence: TransactionAttemptFence,
  snapshotToken: SnapshotToken,
): Result.Result<
  PointMutationOccExecutionContextV1,
  PointMutationOccExecutionContextV1Error
> {
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
  return Result.succeed(
    Object.freeze({
      executionId: entropy.executionId,
      logScopeId: entropy.logScopeId,
      randomSeed: copyBytes(entropy.randomSeed),
      executionTime: creationTimeSeed,
      initialCreationTimeCursor: creationTimeSeed,
      attemptFence,
      snapshotToken: Object.freeze({ ...snapshotToken }),
    }),
  );
}

function bindPointMutationOccJournal(
  journal: PointMutationJournalV1,
  attempt: PointMutationJournalAttemptV1,
): PointMutationOccBoundJournalV1 {
  return Object.freeze({
    resolvePointTable: (tableName: unknown) =>
      journal.resolvePointTable(attempt, tableName),
    runPointOperation: (
      table: PointMutationJournalTableV1,
      operation: unknown,
    ) => journal.runPointOperation(table, operation),
  });
}

function capturePointMutationOccRunnerEvidence(
  evidence: VerifiedCommitAuthorityEvidenceV1,
  functionMetadata: PointMutationTargetFunctionMetadataV1,
): PointMutationOccDetachedRunnerEvidenceV1 {
  return Object.freeze({
    argumentsJson: Object.freeze(structuredClone(evidence.argumentsJson)),
    argumentArraySemanticBytes: evidence.argumentArraySemanticBytes,
    verifiedGrant: detachVerifiedGrant(evidence.verifiedGrant),
    schemaManifest: Object.freeze(structuredClone(evidence.schemaManifest)),
    stableBindings: Object.freeze(structuredClone(evidence.stableBindings)),
    functionMetadata: Object.freeze(structuredClone(functionMetadata)),
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

function abortOnPreFinishingFailure<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  attempt: LoadedPointMutationSessionAttemptV1,
  executionClaim: PointMutationExecutionScopeV1,
  terminalization: Pick<
    PointMutationSessionAttemptTerminalizationV1,
    "abort"
  >,
): Effect.Effect<
  A,
  E | PointMutationSessionAttemptTerminalizationExecutionV1Error,
  R
> {
  return Effect.onExit(effect, (primaryExit) => {
    if (Exit.isSuccess(primaryExit)) return Effect.void;
    return Effect.uninterruptible(
      terminalization.abort(attempt, executionClaim),
    ).pipe(
      Effect.exit,
      Effect.flatMap((cleanupExit) =>
        Exit.isFailure(cleanupExit)
          ? Effect.failCause(
              Cause.combine(primaryExit.cause, cleanupExit.cause),
            )
          : Effect.void,
      ),
    );
  });
}
