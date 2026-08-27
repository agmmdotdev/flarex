import {
  TaskComputeDeliveryCandidateRunnerLive,
  makeTaskComputeDeliveryConnectedRunnerLayer,
  makeTaskComputeDeliveryTrustedDirectoryLayer,
  makeRoutedSupervisedWorkerLoaderTaskComputeProviderLayer,
  type TaskAttemptSupervisionObserver,
  type TaskAttemptSupervisor,
  type TaskComputeDeliveryConnectedRunnerOptions,
  type TaskComputeDeliveryTrustedDirectoryOptions,
  type ApplicationTaskMutationCallbackAuthority,
  type WorkerLoaderTaskComputeProviderOptions,
} from "flarex-backend/internal/task-compute-delivery";
import {
  makeTaskRuntimeLaunchAuthorityLayer,
  type TaskRuntimeLaunchAuthorityOptions,
  type TaskRuntimeLaunchDirectory,
} from "flarex-backend/internal/task-runtime-launch";
import { Layer } from "effect";
import type { ApplicationTaskQueryAuthority } from
  "./ApplicationTaskQueryAuthority";

export interface ApplicationTaskComputeDeliveryLive {
  readonly controlTarget: Parameters<
    typeof makeTaskComputeDeliveryTrustedDirectoryLayer
  >[0];
  readonly directory: Omit<
    TaskComputeDeliveryTrustedDirectoryOptions,
    "definitionGenerationPolicy"
  >;
  readonly launchDirectory: TaskRuntimeLaunchDirectory;
  readonly launchAuthority: TaskRuntimeLaunchAuthorityOptions;
  readonly workerLoader: WorkerLoader;
  readonly provider: Omit<
    WorkerLoaderTaskComputeProviderOptions,
    "applicationQueryAuthority" | "applicationMutationAuthority"
  >;
  readonly queryAuthority: ApplicationTaskQueryAuthority;
  readonly mutationAuthority: ApplicationTaskMutationCallbackAuthority;
  readonly supervision: Readonly<{
    readonly supervisor: TaskAttemptSupervisor;
    readonly observer: TaskAttemptSupervisionObserver;
  }>;
  readonly runner: TaskComputeDeliveryConnectedRunnerOptions;
}

/**
 * The only composition that admits new Application compute delivery. The
 * generation-neutral discovery policy is installed in the same expression as
 * the real Worker Loader provider, so a Legacy-only provider cannot
 * accidentally make Application rows reachable.
 */
export function makeApplicationTaskComputeDeliveryLayer(
  live: ApplicationTaskComputeDeliveryLive,
) {
  const launchAuthority = makeTaskRuntimeLaunchAuthorityLayer(
    live.launchDirectory,
    live.launchAuthority,
  );
  const provider = makeRoutedSupervisedWorkerLoaderTaskComputeProviderLayer(
    live.workerLoader,
    Object.freeze({
      ...live.provider,
      applicationQueryAuthority: live.queryAuthority,
      applicationMutationAuthority: live.mutationAuthority,
    }),
    live.supervision.supervisor,
    live.supervision.observer,
  ).pipe(Layer.provide(launchAuthority));
  const candidateRunner = TaskComputeDeliveryCandidateRunnerLive.pipe(
    Layer.provideMerge(provider),
  );
  const directory = makeTaskComputeDeliveryTrustedDirectoryLayer(
    live.controlTarget,
    {
      authority: live.directory.authority,
      repository: live.directory.repository,
      discoveryDeadline: live.directory.discoveryDeadline,
      definitionGenerationPolicy: "legacy_and_application",
      resolutionTimeoutMilliseconds:
        live.directory.resolutionTimeoutMilliseconds,
    },
  );
  return makeTaskComputeDeliveryConnectedRunnerLayer(live.runner).pipe(
    Layer.provideMerge(Layer.merge(directory, candidateRunner)),
  );
}
