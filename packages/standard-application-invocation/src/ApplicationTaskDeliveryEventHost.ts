import {
  makeTaskComputeDeliveryEventHost,
  type TaskAttemptSupervisionObserver,
  type TaskComputeDeliveryEventHostConfigurationError,
  type TaskComputeDeliveryEventHostPolicy,
  type TaskComputeDeliveryEventHostShape,
} from "flarex-backend/internal/task-compute-delivery";
import { Data, Layer, Result } from "effect";

import {
  makeApplicationTaskComputeDeliveryLayer,
  type ApplicationTaskComputeDeliveryLive,
} from "./ApplicationTaskComputeDelivery.js";

export interface ApplicationTaskDeliveryEventHostLive
  extends Omit<ApplicationTaskComputeDeliveryLive, "supervision"> {
  readonly supervision: Readonly<{
    readonly supervisor:
      ApplicationTaskComputeDeliveryLive["supervision"]["supervisor"];
  }>;
}

export type ApplicationTaskDeliveryEventHostLayerError = Layer.Error<
  ReturnType<typeof makeApplicationTaskComputeDeliveryLayer>
>;

export type ApplicationTaskDeliveryEventHost =
  TaskComputeDeliveryEventHostShape<
    ApplicationTaskDeliveryEventHostLayerError
  >;

export class ApplicationTaskDeliveryEventHostConfigurationError
  extends Data.TaggedError(
    "ApplicationTaskDeliveryEventHostConfigurationError",
  )<{
    readonly reason: "invalid_live_configuration";
    readonly cause?: unknown;
  }> {}

/**
 * Private production-compatible composition. It creates a fresh Application
 * delivery Layer for each event while the backend host owns scope and drain.
 */
export function makeApplicationTaskDeliveryEventHost(
  live: ApplicationTaskDeliveryEventHostLive,
  policy: TaskComputeDeliveryEventHostPolicy,
): Result.Result<
  ApplicationTaskDeliveryEventHost,
  | TaskComputeDeliveryEventHostConfigurationError
  | ApplicationTaskDeliveryEventHostConfigurationError
> {
  return Result.try({
    try: () => captureLive(live),
    catch: cause => new ApplicationTaskDeliveryEventHostConfigurationError({
      reason: "invalid_live_configuration",
      cause,
    }),
  }).pipe(Result.flatMap(capturedLive =>
    makeTaskComputeDeliveryEventHost({
      makeLayer(observer) {
        const observe: TaskAttemptSupervisionObserver["observe"] =
          (_observation, exit) => observer.observe(exit);
        return makeApplicationTaskComputeDeliveryLayer({
          controlTarget: capturedLive.controlTarget,
          directory: capturedLive.directory,
          launchDirectory: capturedLive.launchDirectory,
          launchAuthority: capturedLive.launchAuthority,
          workerLoader: capturedLive.workerLoader,
          provider: capturedLive.provider,
          queryAuthority: capturedLive.queryAuthority,
          mutationAuthority: capturedLive.mutationAuthority,
          runner: capturedLive.runner,
          supervision: Object.freeze({
            supervisor: capturedLive.supervisor,
            observer: Object.freeze({
              admit: observer.admit,
              observe,
            }),
          }),
        });
      },
    }, policy)
  ));
}

function captureLive(live: ApplicationTaskDeliveryEventHostLive) {
  const directory = live.directory;
  const repositoryOwner = directory.repository;
  const repositoryRandomUuid = repositoryOwner.randomUuid;
  const launchAuthorityOwner = live.launchAuthority;
  const validateRuntimeObject = launchAuthorityOwner.validateRuntimeObject;
  const launchSha256 = launchAuthorityOwner.sha256;
  const providerOwner = live.provider;
  const providerRandomUuid = providerOwner.randomUuid;
  const providerSha256 = providerOwner.sha256;
  const applicationPolicy = providerOwner.applicationHostPolicy;
  const legacyPolicy = providerOwner.legacyHostPolicy;

  return Object.freeze({
    controlTarget: live.controlTarget,
    directory: Object.freeze({
      authority: directory.authority,
      repository: Object.freeze({
        claimDurationMilliseconds:
          repositoryOwner.claimDurationMilliseconds,
        retryDelayMilliseconds: Object.freeze([
          ...repositoryOwner.retryDelayMilliseconds,
        ]),
        maximumDeliveryAttempts: repositoryOwner.maximumDeliveryAttempts,
        randomUuid: () => Reflect.apply(
          repositoryRandomUuid,
          repositoryOwner,
          [],
        ),
      }),
      discoveryDeadline: Object.freeze({
        connectionTimeoutMilliseconds:
          directory.discoveryDeadline.connectionTimeoutMilliseconds,
        lockTimeoutMilliseconds:
          directory.discoveryDeadline.lockTimeoutMilliseconds,
        statementTimeoutMilliseconds:
          directory.discoveryDeadline.statementTimeoutMilliseconds,
        transactionTimeoutMilliseconds:
          directory.discoveryDeadline.transactionTimeoutMilliseconds,
        settlementReserveMilliseconds:
          directory.discoveryDeadline.settlementReserveMilliseconds,
      }),
      resolutionTimeoutMilliseconds: directory.resolutionTimeoutMilliseconds,
    }),
    launchDirectory: live.launchDirectory,
    launchAuthority: Object.freeze({
      maximumRuntimeObjectBytes:
        launchAuthorityOwner.maximumRuntimeObjectBytes,
      maximumTotalRuntimeObjectBytes:
        launchAuthorityOwner.maximumTotalRuntimeObjectBytes,
      validateRuntimeObject: (...argumentsValue: Parameters<
        typeof validateRuntimeObject
      >) => Reflect.apply(
        validateRuntimeObject,
        launchAuthorityOwner,
        argumentsValue,
      ),
      ...(launchSha256 === undefined ? {} : {
        sha256: (...argumentsValue: Parameters<typeof launchSha256>) =>
          Reflect.apply(launchSha256, launchAuthorityOwner, argumentsValue),
      }),
    }),
    workerLoader: live.workerLoader,
    provider: Object.freeze({
      applicationHostPolicy: Object.freeze({
        runtimeHostIdentity: applicationPolicy.runtimeHostIdentity,
        compatibilityDate: applicationPolicy.compatibilityDate,
        computeProfiles: Object.freeze(applicationPolicy.computeProfiles.map(
          profile => Object.freeze({
            computeProfile: profile.computeProfile,
            cpuMilliseconds: profile.cpuMilliseconds,
            maximumDurationMs: profile.maximumDurationMs,
          }),
        )),
      }),
      legacyHostPolicy: Object.freeze({
        runtimeImplementationVersion:
          legacyPolicy.runtimeImplementationVersion,
        admittedCompatibilityDate: legacyPolicy.admittedCompatibilityDate,
        computeProfiles: Object.freeze(legacyPolicy.computeProfiles.map(
          profile => Object.freeze({
            computeProfile: profile.computeProfile,
            cpuMilliseconds: profile.cpuMilliseconds,
            maximumDurationMs: profile.maximumDurationMs,
          }),
        )),
        admittedCompatibilityFlags: Object.freeze([
          ...legacyPolicy.admittedCompatibilityFlags,
        ]),
      }),
      ...(providerOwner.maximumScopedDispatches === undefined ? {} : {
        maximumScopedDispatches: providerOwner.maximumScopedDispatches,
      }),
      ...(providerOwner.handshakeMilliseconds === undefined ? {} : {
        handshakeMilliseconds: providerOwner.handshakeMilliseconds,
      }),
      ...(providerRandomUuid === undefined ? {} : {
        randomUuid: () => Reflect.apply(providerRandomUuid, providerOwner, []),
      }),
      ...(providerSha256 === undefined ? {} : {
        sha256: (...argumentsValue: Parameters<typeof providerSha256>) =>
          Reflect.apply(providerSha256, providerOwner, argumentsValue),
      }),
    }),
    queryAuthority: live.queryAuthority,
    mutationAuthority: live.mutationAuthority,
    supervisor: live.supervision.supervisor,
    runner: Object.freeze({
      maximumDirectoryPages: live.runner.maximumDirectoryPages,
      maximumScopeVisits: live.runner.maximumScopeVisits,
      maximumDispatchPages: live.runner.maximumDispatchPages,
      maximumCancellationPages: live.runner.maximumCancellationPages,
      maximumDispatchCandidates: live.runner.maximumDispatchCandidates,
      maximumCancellationCandidates:
        live.runner.maximumCancellationCandidates,
      maximumDispatchProviderCalls:
        live.runner.maximumDispatchProviderCalls,
      maximumCancellationProviderCalls:
        live.runner.maximumCancellationProviderCalls,
      maximumTotalOperations: live.runner.maximumTotalOperations,
      maximumDispatchPagesPerScope:
        live.runner.maximumDispatchPagesPerScope,
      maximumCancellationPagesPerScope:
        live.runner.maximumCancellationPagesPerScope,
      candidatesPerPage: live.runner.candidatesPerPage,
      maximumRunMilliseconds: live.runner.maximumRunMilliseconds,
      maximumOperationMilliseconds:
        live.runner.maximumOperationMilliseconds,
      settlementReserveMilliseconds:
        live.runner.settlementReserveMilliseconds,
    }),
  });
}
