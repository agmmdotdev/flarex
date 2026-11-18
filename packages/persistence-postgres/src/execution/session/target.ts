import type { ApplicationActiveSelection } from "../../application/activation/contracts";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import { createCommittedPointOutcomeResolverV1 } from "../../commit/committedPointOutcome";
import { runPointCommitPromiseEffect } from "../../commit/point/promiseBoundary";
import { runLocatedReadCommittedEffect } from "../../database/locatedReadCommittedEffect";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "../../database/locatedReadCommittedRunner";
import {
  LOCATED_READ_COMMITTED_RUNNER_V1,
  RUN_LOCATED_READ_COMMITTED_V1,
  RUN_LOCATED_REPEATABLE_READ_V1,
  registerLocatedReadCommittedTargetDatabaseV1,
} from "../../database/locatedTransactionIdentity";
import {
  closeInstallationAdmission,
  lockInstallationForCurrentTransaction,
} from "../../installation/installationLifecycle";
import { ScopeExecutionAuthorityError } from "../../scope/execution/Errors";
import { liveScopeExecution } from "../../scope/execution/ScopeExecution";
import {
  ACCEPT_INSTALLED_ATTEMPT_SCOPE_AUTHORITY_IN_TRANSACTION,
  INSTALLED_SCOPE_AUTHORITY_TARGET,
  RUN_INSTALLED_ACCEPTING_READ_COMMITTED,
  prepareInstalledAttemptScopeAuthority,
} from "../../scope/scopeAuthorityControlRead";
import type { LocatedScopeClockReader } from "../../scope/scopeAuthorityResolution";
import { getScopeClock } from "../../scope/scopeClock";
import type { ScopePhysicalLocator } from "../../scope/scopeMetadataTypes";
import { captureScopePhysicalLocator } from "../../scope/scopePhysicalLocator";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import {
  resolvePinnedDeveloperIndexIdV1Effect,
  resolvePinnedPointTableIdV1Effect,
} from "../../storage/documents/pinnedPointTableResolution";
import { acquireLocatedPointMutationExecutionClaimEffect } from "../claims/acquisition";
import { renewLocatedPointMutationExecutionClaimEffect } from "../claims/renewal";
import {
  RENEW_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1,
} from "../claims/transactionExecutionClaimLiveness";
import {
  CAPTURE_FINITE_STORAGE,
  bindFiniteStorageCaptureOwner,
  type FiniteStorageCaptureProfile,
} from "../finiteStorageCapture";
import type { PreparedFiniteSessionJournalEntry } from "../journal/finiteEntry";
import { requireProtectedControlPreparation } from "../preparation/preparedMetadataEpoch";
import { LocatedReadCommittedTransactionFailureV1 } from "../readCommittedTransactionFailure";
import {
  DISCOVER_LOCATED_POINT_MUTATION_ATTEMPTS_V1,
  discoverLocatedPointMutationAttemptsEffectV1,
} from "../recovery/pointMutationAttemptDiscovery";
import {
  applicationActivationScopedOperation,
  legacyActivationScopedOperation,
  locatedActivationAuthority,
} from "./activation";
import { runExactRunningAttemptEffectTransaction } from "./attemptKernel";
import { loadAttemptInTransaction } from "./attemptLoad";
import {
  ACQUIRE_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1,
  ACTIVATE_APPLICATION_MUTATION_SESSION_EFFECT_V1,
  ACTIVATE_FINITE_APPLICATION_MUTATION_SESSION_EFFECT,
  ACTIVATE_PREPARED_POINT_MUTATION_SESSION_EFFECT_V1,
  FINITE_STORAGE_CAPTURE_AUTHORITY,
  FINITE_STORAGE_CAPTURE_DRIVER,
  LOAD_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1,
  TERMINALIZE_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1,
  type LocatedPointMutationSessionActivationInputV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
  type LocatedPointMutationSessionActivationTargetV1,
  type LocatedPointMutationSessionAttemptLoadInputV1,
  type LocatedPointMutationSessionAttemptTerminalizationInputV1,
  type LocatedPointMutationSessionTargetV1,
} from "./constructionContracts";
import type { PreparedFiniteApplicationMutationSessionActivation } from "./contracts";
import {
  mapActivationTransactionError,
  mapApplicationActivationTransactionError,
  mapAttemptLoadTransactionError,
} from "./errorProjections";
import type {
  ExactRunningAttemptTransactionV1Error,
} from "./errors";
import { finiteApplicationActivationOperation } from "./finiteActivation";
import {
  RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1,
  RESOLVE_PINNED_DEVELOPER_INDEX_ID_EFFECT_V1,
  RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1,
  RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1,
  RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1,
  type ExactRunningAttemptEffectWorkV1,
  type ExactRunningAttemptKernelInputV1,
} from "./kernelContracts";
import {
  mapAttemptTerminalizationTransactionError,
  terminalizeAttemptInTransaction,
} from "./terminalization";
import { Cause, Effect, Result } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";

export function createLocatedPointMutationSessionActivationTargetV1(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  options: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
): LocatedScopeClockReader {
  const configuredManaged = options.managedInstallation;
  const managedInstallation = configuredManaged === undefined ? undefined : Object.freeze({
    installation: configuredManaged.installation, controlProtection: configuredManaged.controlProtection });
  if (managedInstallation !== undefined)
    Result.getOrThrowWith(requireProtectedControlPreparation(managedInstallation.controlProtection,
      db, managedInstallation.installation), cause => cause);
  const capturedLocator = captureScopePhysicalLocator(physicalLocator);
  const installedAuthority = managedInstallation === undefined ? undefined :
    Result.getOrThrowWith(prepareInstalledAttemptScopeAuthority(managedInstallation.installation, db, capturedLocator), cause => cause);
  const finiteCaptureDriver = options[FINITE_STORAGE_CAPTURE_DRIVER];
  const finiteCaptureAuthority = options[FINITE_STORAGE_CAPTURE_AUTHORITY];
  const finiteCaptureProfile: FiniteStorageCaptureProfile = managedInstallation === undefined
    ? { kind: "fullArtifact", ...(finiteCaptureAuthority === undefined ? {} : { authority: finiteCaptureAuthority }) }
    : finiteCaptureDriver === undefined
      ? (() => { throw new Error("Installed finite storage capture requires its implicit-read driver"); })()
      : { kind: "installed", installation: managedInstallation.installation, driver: finiteCaptureDriver };
  const finiteStorage = Result.getOrThrowWith(bindFiniteStorageCaptureOwner(db, capturedLocator, finiteCaptureProfile), cause => cause);
  const afterWrite = options.afterWrite;
  const afterLoadLock = options.afterLoadLock;
  const afterTerminalizationEvent = options.afterTerminalizationEvent;
  const afterExecutionClaimLivenessEvent =
    options.afterExecutionClaimLivenessEvent;
  if (managedInstallation !== undefined && options.directInstallation !== undefined)
    throw new Error("A located target requires one installation admission profile");
  const installationAdmission = options.directInstallation === undefined
    ? managedInstallation === undefined ? undefined : { kind: "coLocated" as const, installation: managedInstallation.installation }
    : { kind: "direct" as const, installation: options.directInstallation };
  const runReadCommitted = options[LOCATED_READ_COMMITTED_RUNNER_V1] ??
    createDefaultLocatedReadCommittedTransactionRunnerV1(db, installationAdmission);
  const runInstalledReadCommitted = installedAuthority === undefined ? undefined :
    <Value>(selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>, work: (tx: AppRowTransaction) => Promise<Value>) =>
      createDefaultLocatedReadCommittedTransactionRunnerV1(db, installationAdmission,
        { owner: installedAuthority, selection, protection: "attempt" })(work);
  const committedOutcomeResolver = createCommittedPointOutcomeResolverV1(db);
  const getCurrentClockAtTarget = (scopeId: ScopeId) =>
    getScopeClock(db, scopeId);
  const scopeExecutionTarget = Object.freeze({
    physicalLocator: capturedLocator,
    getCurrentClock: getCurrentClockAtTarget,
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
  });
  const target = Object.freeze({
    ...(installedAuthority === undefined ? {} : { [INSTALLED_SCOPE_AUTHORITY_TARGET]: true as const }),
    ...(installedAuthority === undefined ? {} : { [ACCEPT_INSTALLED_ATTEMPT_SCOPE_AUTHORITY_IN_TRANSACTION]:
      (tx: AppRowTransaction, selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>) =>
        installedAuthority.lock(tx, selection, "attempt") }),
    ...(runInstalledReadCommitted === undefined ? {} : { [RUN_INSTALLED_ACCEPTING_READ_COMMITTED]: runInstalledReadCommitted }),
    physicalLocator: capturedLocator,
    getCurrentClock: getCurrentClockAtTarget,
    [ACTIVATE_PREPARED_POINT_MUTATION_SESSION_EFFECT_V1]: (
      input: LocatedPointMutationSessionActivationInputV1,
    ) => liveScopeExecution.runWrite(
      locatedActivationAuthority(
        scopeExecutionTarget,
        input.preliminaryAuthority,
      ),
      {
        clockProtection: "ordinaryWrite",
        rollbackMessage: "Point-mutation session activation rolled back.",
        cleanupDefect: mapActivationTransactionError,
      },
      legacyActivationScopedOperation,
      Object.freeze({
        input,
        ...(afterWrite === undefined ? {} : { afterWrite }),
      }),
    ).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, mapActivationTransactionError)))),
    [ACTIVATE_APPLICATION_MUTATION_SESSION_EFFECT_V1]: (
      input: LocatedPointMutationSessionActivationInputV1,
      selection: ApplicationActiveSelection,
    ) => liveScopeExecution.runWrite(
      locatedActivationAuthority(
        scopeExecutionTarget,
        input.preliminaryAuthority,
      ),
      {
        clockProtection: "ordinaryWrite",
        rollbackMessage: "Application mutation session activation rolled back.",
        cleanupDefect: mapApplicationActivationTransactionError,
      },
      applicationActivationScopedOperation,
      Object.freeze({ input, selection }),
    ).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, mapApplicationActivationTransactionError)))),
    [ACTIVATE_FINITE_APPLICATION_MUTATION_SESSION_EFFECT]: (
      input: LocatedPointMutationSessionActivationInputV1,
      prepared: PreparedFiniteApplicationMutationSessionActivation,
      entry: PreparedFiniteSessionJournalEntry,
    ): ReturnType<LocatedPointMutationSessionActivationTargetV1[typeof ACTIVATE_FINITE_APPLICATION_MUTATION_SESSION_EFFECT]> => runLocatedReadCommittedEffect(
      runInstalledReadCommitted === undefined ? scopeExecutionTarget : Object.freeze({ ...scopeExecutionTarget,
        [RUN_LOCATED_READ_COMMITTED_V1]: <Value>(work: (tx: AppRowTransaction) => Promise<Value>) =>
          runInstalledReadCommitted({ deploymentId: input.prepared.deploymentId, scopeId: input.prepared.scopeId }, work) }), {
      rollbackMessage: "Finite Application entry rolled back.", cleanupDefect: mapActivationTransactionError,
    }, tx => finiteApplicationActivationOperation(tx, {
        input, prepared, entry, target, afterWrite, database: db,
        ...(installedAuthority === undefined ? {} : { installedAuthority }),
        ...(managedInstallation === undefined ? {} : { managedControlProtection: managedInstallation.controlProtection }) })).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
        failure => failure instanceof ScopeExecutionAuthorityError || failure instanceof LocatedReadCommittedTransactionFailureV1
          ? mapApplicationActivationTransactionError(failure) : failure))),
    ),
    [LOAD_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1]: (
      input: LocatedPointMutationSessionAttemptLoadInputV1,
    ) => Effect.uninterruptible(runPointCommitPromiseEffect(() =>
        db.transaction(async tx => {
          await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
          try {
            return await loadAttemptInTransaction(tx, input, afterLoadLock);
          } finally {
            closeInstallationAdmission(tx);
          }
        }), mapAttemptLoadTransactionError)),
    [RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1]: <Result, Failure>(
      input: ExactRunningAttemptKernelInputV1,
      work: ExactRunningAttemptEffectWorkV1<Result, Failure>,
    ): Effect.Effect<
      Result,
      Failure | ExactRunningAttemptTransactionV1Error
    > => runExactRunningAttemptEffectTransaction(
      db,
      input,
      work,
      afterLoadLock,
      "attempt",
      installedAuthority, managedInstallation?.controlProtection,
    ),
    [CAPTURE_FINITE_STORAGE]: finiteStorage.capture,
    [RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1]: <
      Result,
      Failure,
    >(
      input: ExactRunningAttemptKernelInputV1,
      work: ExactRunningAttemptEffectWorkV1<Result, Failure>,
    ): Effect.Effect<
      Result,
      Failure | ExactRunningAttemptTransactionV1Error
    > => runExactRunningAttemptEffectTransaction(
      db,
      input,
      work,
      afterLoadLock,
      "share",
      installedAuthority, managedInstallation?.controlProtection,
    ),
    [RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1]:
      resolvePinnedPointTableIdV1Effect.bind(
        undefined,
        db,
      ),
    [RESOLVE_PINNED_DEVELOPER_INDEX_ID_EFFECT_V1]:
      resolvePinnedDeveloperIndexIdV1Effect.bind(
        undefined,
        db,
      ),
    [RUN_LOCATED_REPEATABLE_READ_V1]: <Result>(
      work: (tx: AppRowTransaction) => Promise<Result>,
    ): Promise<Result> => db.transaction(async (tx) => {
      await tx.setTransaction({
        isolationLevel: "repeatable read",
      });
      // The installation row SHARE latch requires a read-write SQL session;
      // the private detached loader still exposes only its read operation.
      await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
      try {
        return await work(tx);
      } finally {
        closeInstallationAdmission(tx);
      }
    }),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
    [RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1]:
      committedOutcomeResolver.resolve,
    [ACQUIRE_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1]: (input) =>
      acquireLocatedPointMutationExecutionClaimEffect(
        db,
        runReadCommitted,
        committedOutcomeResolver,
        input,
      ),
    [RENEW_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1]: (input) =>
      renewLocatedPointMutationExecutionClaimEffect(
        input.installedFinite === true && runInstalledReadCommitted !== undefined ?
          work => runInstalledReadCommitted(input.selector, work) : runReadCommitted,
        input,
        afterExecutionClaimLivenessEvent,
        installedAuthority,
      ),
    [DISCOVER_LOCATED_POINT_MUTATION_ATTEMPTS_V1]: (input) =>
      discoverLocatedPointMutationAttemptsEffectV1(db, input),
    [TERMINALIZE_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1]: (
      input: LocatedPointMutationSessionAttemptTerminalizationInputV1,
    ) => Effect.uninterruptible(runPointCommitPromiseEffect(() =>
        db.transaction(async tx => {
          await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
          try {
            return await terminalizeAttemptInTransaction(
              tx,
              input,
              afterTerminalizationEvent,
            );
          } finally {
            closeInstallationAdmission(tx);
          }
        }), cause => mapAttemptTerminalizationTransactionError(input.operation, cause))),
  } satisfies LocatedPointMutationSessionTargetV1);
  registerLocatedReadCommittedTargetDatabaseV1(target, db);
  return target;
}
