import { TaskComputeDeliveryCandidateRunnerLive } from
  "flarex-backend/internal/task-compute-delivery";
import {
  makeTaskComputeDeliveryConnectedRunnerLayer,
  makeTaskComputeDeliveryTrustedDirectoryLayer,
  makeWorkerLoaderTaskComputeProviderLayer,
  type TaskComputeDeliveryConnectedRunnerOptions,
  type TaskComputeDeliveryTrustedDirectoryOptions,
  type WorkerLoaderTaskComputeProviderOptions,
} from "flarex-backend/internal/task-compute-delivery";
import {
  makeTaskRuntimeLaunchAuthorityLayer,
  type TaskRuntimeLaunchAuthorityOptions,
  type TaskRuntimeLaunchDirectory,
} from "flarex-backend/internal/task-runtime-launch";
import { Layer } from "effect";

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
  readonly provider: WorkerLoaderTaskComputeProviderOptions;
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
  const provider = makeWorkerLoaderTaskComputeProviderLayer(
    live.workerLoader,
    live.provider,
  ).pipe(Layer.provide(launchAuthority));
  const candidateRunner = TaskComputeDeliveryCandidateRunnerLive.pipe(
    Layer.provide(provider),
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
    Layer.provide(Layer.merge(directory, candidateRunner)),
  );
}
