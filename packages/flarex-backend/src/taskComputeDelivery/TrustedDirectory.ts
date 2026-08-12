import type { TrustedScopeAuthorityResolutionPorts } from
  "@flarex/persistence-postgres";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
} from "@flarex/persistence-postgres";
import type {
  ReplacementScopeDirectoryCandidateV1,
  ReplacementScopeDirectoryContinuationV1,
} from "@flarex/persistence-postgres/internal/replacement-scope-directory-discovery-v1";
import {
  makeTaskComputeDeliveryControlDirectory,
  type TaskComputeDeliveryControlDirectory,
  type TaskComputeDeliveryControlDirectoryTarget,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-control-directory";
import {
  makeTaskComputeDeliveryCandidateDiscovery,
  type TaskComputeDeliveryCandidateDiscovery,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-discovery";
import {
  makeTaskComputeDeliveryRepositoryV1,
  type LocatedTaskComputeDeliveryTargetV1,
  type TaskComputeDeliveryRepositoryOptionsV1,
  type TaskComputeDeliveryRepositoryV1,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-repository-v1";
import type {
  TaskRepairPostgresDeadlinePolicyInputV1,
} from "@flarex/persistence-postgres/internal/task-repair-postgres-deadline-policy-v1";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonBlankString } from "@flarex/utils/strings";
import { Context, Data, Effect, Layer, Result, Schema } from "effect";
import {
  ReplacementScopeIdV1Schema,
  type ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";

export type TaskComputeDeliveryTrustedDirectoryCandidateFailureReason =
  | "authority_unavailable"
  | "candidate_scope_mismatch"
  | "repository_configuration_invalid"
  | "discovery_configuration_invalid";

export interface TaskComputeDeliveryTrustedDirectoryReadyItem {
  readonly kind: "ready";
  readonly deploymentId: string;
  readonly scopeId: ReplacementScopeIdV1;
  readonly discovery: TaskComputeDeliveryCandidateDiscovery;
  readonly repository: TaskComputeDeliveryRepositoryV1;
}

export interface TaskComputeDeliveryTrustedDirectoryFailedItem {
  readonly kind: "failed";
  readonly deploymentId: string;
  readonly scopeId: ReplacementScopeIdV1;
  readonly reason: TaskComputeDeliveryTrustedDirectoryCandidateFailureReason;
}

export type TaskComputeDeliveryTrustedDirectoryItem =
  | TaskComputeDeliveryTrustedDirectoryReadyItem
  | TaskComputeDeliveryTrustedDirectoryFailedItem;

export interface TaskComputeDeliveryTrustedDirectoryPage {
  readonly items: ReadonlyArray<TaskComputeDeliveryTrustedDirectoryItem>;
  readonly continuation: ReplacementScopeDirectoryContinuationV1 | null;
}

export class TaskComputeDeliveryTrustedDirectoryConfigurationError
  extends Data.TaggedError(
    "TaskComputeDeliveryTrustedDirectoryConfigurationError",
  )<{
    readonly reason: "invalid_options";
    readonly cause?: unknown;
  }> {}

export class TaskComputeDeliveryTrustedDirectoryInputError
  extends Data.TaggedError("TaskComputeDeliveryTrustedDirectoryInputError")<{
    readonly operation: "discover" | "resolve";
    readonly reason:
      | "invalid_input"
      | "continuation_ordering_invalid"
      | "invalid_candidate";
    readonly cause?: unknown;
  }> {}

export class TaskComputeDeliveryTrustedDirectoryCorruptionError
  extends Data.TaggedError(
    "TaskComputeDeliveryTrustedDirectoryCorruptionError",
  )<{
    readonly reason:
      | "driver_result_invalid"
      | "metadata_invalid"
      | "candidate_overflow"
      | "candidate_ordering_invalid";
    readonly cause?: unknown;
  }> {}

export class TaskComputeDeliveryTrustedDirectorySqlError
  extends Data.TaggedError("TaskComputeDeliveryTrustedDirectorySqlError")<{
    readonly operation: "discover";
    readonly cause: unknown;
  }> {}

export type TaskComputeDeliveryTrustedDirectoryError =
  | TaskComputeDeliveryTrustedDirectoryInputError
  | TaskComputeDeliveryTrustedDirectoryCorruptionError
  | TaskComputeDeliveryTrustedDirectorySqlError;

export interface TaskComputeDeliveryTrustedDirectoryShape {
  readonly singleCandidateDiscoverSettlementBudgetMilliseconds: number;
  readonly resolveSettlementBudgetMilliseconds: number;
  readonly discover: (
    input: unknown,
  ) => Effect.Effect<
    TaskComputeDeliveryTrustedDirectoryPage,
    TaskComputeDeliveryTrustedDirectoryError
  >;
  readonly resolve: (
    candidate: unknown,
  ) => Effect.Effect<
    TaskComputeDeliveryTrustedDirectoryItem,
    TaskComputeDeliveryTrustedDirectoryInputError
  >;
}

export class TaskComputeDeliveryTrustedDirectory
  extends Context.Service<
    TaskComputeDeliveryTrustedDirectory,
    TaskComputeDeliveryTrustedDirectoryShape
  >()("flarex-backend/taskComputeDelivery/TrustedDirectory") {}

export interface TaskComputeDeliveryTrustedDirectoryOptions {
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedTaskComputeDeliveryTargetV1
  >;
  readonly repository: TaskComputeDeliveryRepositoryOptionsV1;
  readonly discoveryDeadline: TaskRepairPostgresDeadlinePolicyInputV1;
  readonly resolutionTimeoutMilliseconds: number;
}

interface CapturedDirectoryOptions
  extends TaskComputeDeliveryTrustedDirectoryOptions {
  readonly resolveSettlementBudgetMilliseconds: number;
}

const decodeReplacementScopeId = Schema.decodeUnknownResult(
  ReplacementScopeIdV1Schema,
);
const INVALID_CONFIGURATION = Symbol(
  "invalid task compute delivery trusted directory configuration",
);

export function makeTaskComputeDeliveryTrustedDirectoryLayer(
  controlTarget: TaskComputeDeliveryControlDirectoryTarget,
  options: TaskComputeDeliveryTrustedDirectoryOptions,
): Layer.Layer<
  TaskComputeDeliveryTrustedDirectory,
  TaskComputeDeliveryTrustedDirectoryConfigurationError
> {
  return Layer.effect(
    TaskComputeDeliveryTrustedDirectory,
    Effect.fromResult(captureDirectoryOptions(options)).pipe(
      Effect.flatMap((captured) =>
        Effect.fromResult(
          makeControlDirectory(controlTarget).pipe(
            Result.mapError((cause) =>
              new TaskComputeDeliveryTrustedDirectoryConfigurationError({
                reason: "invalid_options",
                cause,
              })
            ),
            Result.flatMap((directory) =>
              captureSingleCandidateDiscoverSettlementBudget(
                directory,
                captured.resolutionTimeoutMilliseconds,
              ).pipe(
                Result.map((singleCandidateDiscoverSettlementBudgetMilliseconds) =>
                  TaskComputeDeliveryTrustedDirectory.of(
                    makeTaskComputeDeliveryTrustedDirectory(
                      directory,
                      captured,
                      singleCandidateDiscoverSettlementBudgetMilliseconds,
                    ),
                  )
                ),
              )
            ),
          ),
        )
      ),
    ),
  );
}

function makeTaskComputeDeliveryTrustedDirectory(
  directory: TaskComputeDeliveryControlDirectory<
    string,
    TaskComputeDeliveryTrustedDirectoryError
  >,
  options: CapturedDirectoryOptions,
  singleCandidateDiscoverSettlementBudgetMilliseconds: number,
): TaskComputeDeliveryTrustedDirectoryShape {
  const resolveCandidate = Effect.fn(
    "TaskComputeDeliveryTrustedDirectory.resolveCandidate",
  )(function* (candidate: ReplacementScopeDirectoryCandidateV1<string>) {
    return yield* resolveLocatedTrustedScopeAuthorityEffect(
      candidate.deploymentId,
      options.authority,
    ).pipe(Effect.match({
      onFailure: () => failedItem(candidate, "authority_unavailable"),
      onSuccess: (located) => {
        if (located.authority.scopeId !== candidate.scopeId) {
          return failedItem(candidate, "candidate_scope_mismatch");
        }
        return makeTaskComputeDeliveryRepositoryV1(
          located,
          options.repository,
        ).pipe(
          Result.mapError(() =>
            "repository_configuration_invalid" as const
          ),
          Result.flatMap((repository) =>
            makeTaskComputeDeliveryCandidateDiscovery(
              located,
              options.discoveryDeadline,
            ).pipe(
              Result.mapError(() =>
                "discovery_configuration_invalid" as const
              ),
              Result.map((discovery) => readyItem(
                candidate,
                captureDiscovery(discovery),
                captureRepository(repository),
              )),
            )
          ),
          Result.match({
            onFailure: (reason) => failedItem(candidate, reason),
            onSuccess: (item) => item,
          }),
        );
      },
    }));
  });

  const resolveCandidateWithinBudget = (
    candidate: ReplacementScopeDirectoryCandidateV1<string>,
  ) => resolveCandidate(candidate).pipe(Effect.timeoutOrElse({
    duration: `${options.resolutionTimeoutMilliseconds} millis`,
    orElse: () => Effect.succeed(
      failedItem(candidate, "authority_unavailable"),
    ),
  }));

  const discover: TaskComputeDeliveryTrustedDirectoryShape["discover"] =
    Effect.fn("TaskComputeDeliveryTrustedDirectory.discover")(
      function* (input) {
        const page = yield* directory.discoverEffect(input);
        const items: TaskComputeDeliveryTrustedDirectoryItem[] = [];
        for (const candidate of page.candidates) {
          items.push(yield* resolveCandidateWithinBudget(candidate));
        }
        return Object.freeze({
          items: Object.freeze(items),
          continuation: page.continuation,
        });
      },
    );

  const resolve: TaskComputeDeliveryTrustedDirectoryShape["resolve"] =
    Effect.fn("TaskComputeDeliveryTrustedDirectory.resolve")(
      function* (input) {
        const candidate = yield* Effect.fromResult(captureCandidate(input));
        return yield* resolveCandidateWithinBudget(candidate);
      },
    );

  return Object.freeze({
    singleCandidateDiscoverSettlementBudgetMilliseconds:
      singleCandidateDiscoverSettlementBudgetMilliseconds,
    resolveSettlementBudgetMilliseconds:
      options.resolveSettlementBudgetMilliseconds,
    discover,
    resolve,
  });
}

function makeControlDirectory(
  target: TaskComputeDeliveryControlDirectoryTarget,
) {
  return makeTaskComputeDeliveryControlDirectory<
    string,
    TaskComputeDeliveryTrustedDirectoryError
  >(target, {
    operationName: "TaskComputeDeliveryTrustedDirectory.discoverScopes",
    input: (reason, cause) =>
      new TaskComputeDeliveryTrustedDirectoryInputError({
        operation: "discover",
        reason: reason === "continuationOrderingInvalid"
          ? "continuation_ordering_invalid"
          : "invalid_input",
        ...(cause === undefined ? {} : { cause }),
      }),
    corruption: (reason, cause) =>
      new TaskComputeDeliveryTrustedDirectoryCorruptionError({
        reason: directoryCorruptionReason(reason),
        ...(cause === undefined ? {} : { cause }),
      }),
    sql: (cause) => new TaskComputeDeliveryTrustedDirectorySqlError({
      operation: "discover",
      cause,
    }),
    decodeDeploymentId: (value) =>
      isNonBlankString(value)
        ? Result.succeed(value)
        : Result.fail(
          new TaskComputeDeliveryTrustedDirectoryCorruptionError({
            reason: "metadata_invalid",
          }),
        ),
  });
}

function captureDirectoryOptions(
  input: TaskComputeDeliveryTrustedDirectoryOptions,
): Result.Result<
  CapturedDirectoryOptions,
  TaskComputeDeliveryTrustedDirectoryConfigurationError
> {
  return Result.try({
    try: () => {
      const authority = input.authority;
      const scopeMetadataOwner = authority.scopeMetadata;
      const scopeMetadataRead = scopeMetadataOwner.getScopeMetadataByDeploymentId;
      const provisioningOwner = authority.provisioningReceipts;
      const provisioningRead =
        provisioningOwner.getScopeAuthorityProvisioningReceipt;
      const targetOwner = authority.scopeClockTargets;
      const targetResolve = targetOwner.resolve;
      if (
        typeof scopeMetadataRead !== "function" ||
        typeof provisioningRead !== "function" ||
        typeof targetResolve !== "function"
      ) {
        throw INVALID_CONFIGURATION;
      }

      const repositoryOwner = input.repository;
      const retryDelayMilliseconds = Array.from(
        repositoryOwner.retryDelayMilliseconds,
      );
      const randomUuid = repositoryOwner.randomUuid;
      if (typeof randomUuid !== "function") throw INVALID_CONFIGURATION;

      const deadlineOwner = input.discoveryDeadline;
      const resolutionTimeoutMilliseconds =
        input.resolutionTimeoutMilliseconds;
      const settlementReserveMilliseconds =
        deadlineOwner.settlementReserveMilliseconds;
      if (
        !isPositiveSafeInteger(resolutionTimeoutMilliseconds)
        || !isPositiveSafeInteger(settlementReserveMilliseconds)
      ) {
        throw INVALID_CONFIGURATION;
      }
      return Object.freeze({
        authority: Object.freeze({
          scopeMetadata: Object.freeze({
            getScopeMetadataByDeploymentId: (deploymentId: string) =>
              scopeMetadataRead.call(scopeMetadataOwner, deploymentId),
          }),
          provisioningReceipts: Object.freeze({
            getScopeAuthorityProvisioningReceipt: (
              scopeId: Parameters<typeof provisioningRead>[0],
            ) => provisioningRead.call(provisioningOwner, scopeId),
          }),
          scopeClockTargets: Object.freeze({
            resolve: (physicalLocator: Parameters<typeof targetResolve>[0]) =>
              targetResolve.call(targetOwner, physicalLocator),
          }),
        }),
        repository: Object.freeze({
          claimDurationMilliseconds:
            repositoryOwner.claimDurationMilliseconds,
          retryDelayMilliseconds: Object.freeze(retryDelayMilliseconds),
          maximumDeliveryAttempts: repositoryOwner.maximumDeliveryAttempts,
          randomUuid: () => randomUuid.call(repositoryOwner),
        }),
        discoveryDeadline: Object.freeze({
          connectionTimeoutMilliseconds:
            deadlineOwner.connectionTimeoutMilliseconds,
          lockTimeoutMilliseconds: deadlineOwner.lockTimeoutMilliseconds,
          statementTimeoutMilliseconds:
            deadlineOwner.statementTimeoutMilliseconds,
          transactionTimeoutMilliseconds:
            deadlineOwner.transactionTimeoutMilliseconds,
          settlementReserveMilliseconds,
        }),
        resolutionTimeoutMilliseconds,
        resolveSettlementBudgetMilliseconds:
          resolutionTimeoutMilliseconds + 1,
      });
    },
    catch: (cause) =>
      new TaskComputeDeliveryTrustedDirectoryConfigurationError({
        reason: "invalid_options",
        ...(cause === INVALID_CONFIGURATION ? {} : { cause }),
      }),
  });
}

function captureSingleCandidateDiscoverSettlementBudget(
  directory: TaskComputeDeliveryControlDirectory<
    string,
    TaskComputeDeliveryTrustedDirectoryError
  >,
  resolutionTimeoutMilliseconds: number,
): Result.Result<
  number,
  TaskComputeDeliveryTrustedDirectoryConfigurationError
> {
  return Result.try({
    try: () => {
      const controlDirectorySettlementBudgetMilliseconds =
        directory.settlementBudgetMilliseconds;
      const budget = controlDirectorySettlementBudgetMilliseconds +
        resolutionTimeoutMilliseconds + 1;
      if (
        !isPositiveSafeInteger(controlDirectorySettlementBudgetMilliseconds) ||
        !Number.isSafeInteger(budget)
      ) {
        throw INVALID_CONFIGURATION;
      }
      return budget;
    },
    catch: (cause) =>
      new TaskComputeDeliveryTrustedDirectoryConfigurationError({
        reason: "invalid_options",
        ...(cause === INVALID_CONFIGURATION ? {} : { cause }),
      }),
  });
}

function captureCandidate(
  input: unknown,
): Result.Result<
  ReplacementScopeDirectoryCandidateV1<string>,
  TaskComputeDeliveryTrustedDirectoryInputError
> {
  return Result.gen(function* () {
    const fields = yield* Result.try({
      try: () => {
        if (typeof input !== "object" || input === null) {
          throw INVALID_CONFIGURATION;
        }
        const keys = Reflect.ownKeys(input);
        if (
          keys.length !== 2 ||
          !keys.includes("deploymentId") ||
          !keys.includes("scopeId")
        ) {
          throw INVALID_CONFIGURATION;
        }
        const deployment = Object.getOwnPropertyDescriptor(
          input,
          "deploymentId",
        );
        const scope = Object.getOwnPropertyDescriptor(input, "scopeId");
        if (
          deployment === undefined || !("value" in deployment) ||
          scope === undefined || !("value" in scope)
        ) {
          throw INVALID_CONFIGURATION;
        }
        return Object.freeze({
          deploymentId: deployment.value as unknown,
          scopeId: scope.value as unknown,
        });
      },
      catch: (cause) =>
        new TaskComputeDeliveryTrustedDirectoryInputError({
          operation: "resolve",
          reason: "invalid_candidate",
          ...(cause === INVALID_CONFIGURATION ? {} : { cause }),
        }),
    });
    if (!isNonBlankString(fields.deploymentId)) {
      return yield* Result.fail(
        new TaskComputeDeliveryTrustedDirectoryInputError({
          operation: "resolve",
          reason: "invalid_candidate",
        }),
      );
    }
    const scopeId = yield* decodeReplacementScopeId(fields.scopeId).pipe(
      Result.mapError((cause) =>
        new TaskComputeDeliveryTrustedDirectoryInputError({
          operation: "resolve",
          reason: "invalid_candidate",
          cause,
        })
      ),
    );
    return Object.freeze({ deploymentId: fields.deploymentId, scopeId });
  });
}

function captureDiscovery(
  input: TaskComputeDeliveryCandidateDiscovery,
): TaskComputeDeliveryCandidateDiscovery {
  const owner = input;
  const discoverDispatchCandidates = input.discoverDispatchCandidates;
  const discoverCancellationCandidates = input.discoverCancellationCandidates;
  const capturedDispatch:
    TaskComputeDeliveryCandidateDiscovery["discoverDispatchCandidates"] =
      (request) => discoverDispatchCandidates.call(owner, request);
  const capturedCancellation:
    TaskComputeDeliveryCandidateDiscovery[
      "discoverCancellationCandidates"
    ] = (request) => discoverCancellationCandidates.call(owner, request);
  const captured: TaskComputeDeliveryCandidateDiscovery = Object.freeze({
    discoverDispatchCandidates: capturedDispatch,
    discoverCancellationCandidates: capturedCancellation,
  });
  return captured;
}

function captureRepository(
  input: TaskComputeDeliveryRepositoryV1,
): TaskComputeDeliveryRepositoryV1 {
  const owner = input;
  const acquireDispatch = input.acquireDispatch;
  const verifyDispatchRecovery = input.verifyDispatchRecovery;
  const markDispatchDeliveryStarted = input.markDispatchDeliveryStarted;
  const renewDispatchClaim = input.renewDispatchClaim;
  const releaseDispatchBeforeDelivery = input.releaseDispatchBeforeDelivery;
  const recordDispatchAcceptance = input.recordDispatchAcceptance;
  const recordDispatchKnownFailure = input.recordDispatchKnownFailure;
  const acquireCancellation = input.acquireCancellation;
  const verifyCancellationRecovery = input.verifyCancellationRecovery;
  const markCancellationDeliveryStarted = input.markCancellationDeliveryStarted;
  const renewCancellationClaim = input.renewCancellationClaim;
  const releaseCancellationBeforeDelivery =
    input.releaseCancellationBeforeDelivery;
  const recordCancellationReceipt = input.recordCancellationReceipt;
  const recordCancellationKnownFailure = input.recordCancellationKnownFailure;
  const capturedAcquireDispatch: TaskComputeDeliveryRepositoryV1[
    "acquireDispatch"
  ] = (request) => acquireDispatch.call(owner, request);
  const capturedVerifyDispatchRecovery: TaskComputeDeliveryRepositoryV1[
    "verifyDispatchRecovery"
  ] = (handle) => verifyDispatchRecovery.call(owner, handle);
  const capturedMarkDispatch: TaskComputeDeliveryRepositoryV1[
    "markDispatchDeliveryStarted"
  ] = (handle) => markDispatchDeliveryStarted.call(owner, handle);
  const capturedRenewDispatch: TaskComputeDeliveryRepositoryV1[
    "renewDispatchClaim"
  ] = (handle) => renewDispatchClaim.call(owner, handle);
  const capturedReleaseDispatch: TaskComputeDeliveryRepositoryV1[
    "releaseDispatchBeforeDelivery"
  ] = (handle) => releaseDispatchBeforeDelivery.call(owner, handle);
  const capturedRecordDispatchAcceptance: TaskComputeDeliveryRepositoryV1[
    "recordDispatchAcceptance"
  ] = (handle, acceptance) =>
    recordDispatchAcceptance.call(owner, handle, acceptance);
  const capturedRecordDispatchFailure: TaskComputeDeliveryRepositoryV1[
    "recordDispatchKnownFailure"
  ] = (handle, failure) =>
    recordDispatchKnownFailure.call(owner, handle, failure);
  const capturedAcquireCancellation: TaskComputeDeliveryRepositoryV1[
    "acquireCancellation"
  ] = (request) => acquireCancellation.call(owner, request);
  const capturedVerifyCancellationRecovery: TaskComputeDeliveryRepositoryV1[
    "verifyCancellationRecovery"
  ] = (handle) => verifyCancellationRecovery.call(owner, handle);
  const capturedMarkCancellation: TaskComputeDeliveryRepositoryV1[
    "markCancellationDeliveryStarted"
  ] = (handle) => markCancellationDeliveryStarted.call(owner, handle);
  const capturedRenewCancellation: TaskComputeDeliveryRepositoryV1[
    "renewCancellationClaim"
  ] = (handle) => renewCancellationClaim.call(owner, handle);
  const capturedReleaseCancellation: TaskComputeDeliveryRepositoryV1[
    "releaseCancellationBeforeDelivery"
  ] = (handle) => releaseCancellationBeforeDelivery.call(owner, handle);
  const capturedRecordCancellationReceipt: TaskComputeDeliveryRepositoryV1[
    "recordCancellationReceipt"
  ] = (handle, receipt) =>
    recordCancellationReceipt.call(owner, handle, receipt);
  const capturedRecordCancellationFailure: TaskComputeDeliveryRepositoryV1[
    "recordCancellationKnownFailure"
  ] = (handle, failure) =>
    recordCancellationKnownFailure.call(owner, handle, failure);
  const captured: TaskComputeDeliveryRepositoryV1 = Object.freeze({
    acquireDispatch: capturedAcquireDispatch,
    verifyDispatchRecovery: capturedVerifyDispatchRecovery,
    markDispatchDeliveryStarted: capturedMarkDispatch,
    renewDispatchClaim: capturedRenewDispatch,
    releaseDispatchBeforeDelivery: capturedReleaseDispatch,
    recordDispatchAcceptance: capturedRecordDispatchAcceptance,
    recordDispatchKnownFailure: capturedRecordDispatchFailure,
    acquireCancellation: capturedAcquireCancellation,
    verifyCancellationRecovery: capturedVerifyCancellationRecovery,
    markCancellationDeliveryStarted: capturedMarkCancellation,
    renewCancellationClaim: capturedRenewCancellation,
    releaseCancellationBeforeDelivery: capturedReleaseCancellation,
    recordCancellationReceipt: capturedRecordCancellationReceipt,
    recordCancellationKnownFailure: capturedRecordCancellationFailure,
  });
  return captured;
}

function readyItem(
  candidate: ReplacementScopeDirectoryCandidateV1<string>,
  discovery: TaskComputeDeliveryCandidateDiscovery,
  repository: TaskComputeDeliveryRepositoryV1,
): TaskComputeDeliveryTrustedDirectoryReadyItem {
  return Object.freeze({
    kind: "ready",
    deploymentId: candidate.deploymentId,
    scopeId: candidate.scopeId,
    discovery,
    repository,
  });
}

function failedItem(
  candidate: ReplacementScopeDirectoryCandidateV1<string>,
  reason: TaskComputeDeliveryTrustedDirectoryCandidateFailureReason,
): TaskComputeDeliveryTrustedDirectoryFailedItem {
  return Object.freeze({
    kind: "failed",
    deploymentId: candidate.deploymentId,
    scopeId: candidate.scopeId,
    reason,
  });
}

function directoryCorruptionReason(
  reason:
    | "driverResultInvalid"
    | "metadataInvalid"
    | "candidateOverflow"
    | "candidateOrderingInvalid",
): TaskComputeDeliveryTrustedDirectoryCorruptionError["reason"] {
  switch (reason) {
    case "driverResultInvalid":
      return "driver_result_invalid";
    case "metadataInvalid":
      return "metadata_invalid";
    case "candidateOverflow":
      return "candidate_overflow";
    case "candidateOrderingInvalid":
      return "candidate_ordering_invalid";
  }
}
