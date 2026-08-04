import { Data } from "effect";
import {
  EDGE_ACTION_EXACT_RUNTIME_ENTRYPOINT_V1,
  EDGE_ACTION_EXACT_RUNTIME_VERSION_V1,
  type EdgeActionExactRuntimeArtifactRefV1,
  type EdgeActionExactRuntimeFunctionV1,
} from "flarex-protocol/edge-action-exact-runtime";
import {
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  type EdgeActionHostPolicyFrameV1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";

import {
  executionArtifactWorkerModulesFromSources,
  type ExecutionArtifactWorkerDefinition,
} from "./HostKit";
import {
  EDGE_ACTION_EXACT_RUNTIME_WORKER_CORE_SHA256_V1,
  EDGE_ACTION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
} from "./EdgeActionExactRuntimeWorkerCore.generated";
import {
  EDGE_ACTION_RUNTIME_KERNEL_SHA256_V1,
  EDGE_ACTION_RUNTIME_KERNEL_SOURCE_V1,
} from "./EdgeActionRuntimeKernel.generated";
import {
  edgeActionExactRuntimeExecutionBridgeSourceV1,
  edgeActionExactRuntimeWorkerConfigurationSourceV1,
} from "./EdgeActionExactRuntimeWorkerSource";

export const EDGE_ACTION_EXACT_RUNTIME_MAIN_MODULE_V1 =
  "flarex-edge-action-exact-runtime-v1.js";
export const EDGE_ACTION_EXACT_RUNTIME_CONFIG_MODULE_V1 =
  "edgeActionExactRuntimeWorker/flarex-edge-action-exact-runtime-config-v1.js";
export const EDGE_ACTION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1 =
  "edgeActionExactRuntimeWorker/flarex-edge-action-exact-runtime-execution-v1.js";
export const EDGE_ACTION_RUNTIME_KERNEL_MODULE_V1 =
  "edgeActionExactRuntimeWorker/flarex-edge-action-runtime-kernel-v1.js";

export interface EdgeActionExactRuntimeWorkerDefinitionV1
  extends ExecutionArtifactWorkerDefinition {
  readonly compatibilityDate: string;
  readonly modules: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<PropertyKey, never>>;
  readonly limits: Readonly<{ readonly cpuMs: number; readonly subRequests: number }>;
  readonly runtimeTargetSha256Hex: string;
  readonly hostPolicySha256Hex: string;
  readonly artifact: EdgeActionExactRuntimeArtifactRefV1;
  readonly function: EdgeActionExactRuntimeFunctionV1;
  readonly wallMilliseconds: number;
  readonly cleanupDrainMilliseconds: number;
  readonly entrypoint: typeof EDGE_ACTION_EXACT_RUNTIME_ENTRYPOINT_V1;
}

export interface BuildEdgeActionExactRuntimeWorkerDefinitionV1Input {
  readonly artifact: EdgeActionExactRuntimeArtifactRefV1;
  readonly compatibilityDate: string;
  readonly runtimeTargetSha256Hex: string;
  readonly hostPolicySha256Hex: string;
  readonly hostPolicy: EdgeActionHostPolicyFrameV1;
  readonly function: EdgeActionExactRuntimeFunctionV1;
  readonly functionPath: string;
  readonly artifactExecutionModule: string;
  readonly exportName: string;
  readonly sourceModules: ReadonlyArray<Readonly<{
    readonly path: string;
    readonly source: string;
  }>>;
}

export class EdgeActionExactRuntimeHostV1Error extends Data.TaggedError(
  "EdgeActionExactRuntimeHostV1Error",
)<{
  readonly reason: "workerDefinitionFailed";
  readonly cause: unknown;
}> {}

export function edgeActionExactRuntimeWorkerGraphBasisV1(
  input: Readonly<{
    readonly compatibilityDate: string;
    readonly hostPolicySha256Hex: string;
    readonly artifactExecutionModule: string;
    readonly exportName: string;
    readonly functionPath: string;
  }>,
): string {
  compatibilityDateMilliseconds(input.compatibilityDate);
  const bridge = edgeActionExactRuntimeExecutionBridgeSourceV1(
    input.artifactExecutionModule,
    input.exportName,
    input.functionPath,
  );
  return JSON.stringify([
    EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
    EDGE_ACTION_EXACT_RUNTIME_VERSION_V1,
    EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
    input.hostPolicySha256Hex,
    [EDGE_ACTION_EXACT_RUNTIME_MAIN_MODULE_V1,
      EDGE_ACTION_EXACT_RUNTIME_WORKER_CORE_SHA256_V1],
    [EDGE_ACTION_RUNTIME_KERNEL_MODULE_V1,
      EDGE_ACTION_RUNTIME_KERNEL_SHA256_V1],
    [EDGE_ACTION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1, bridge],
    EDGE_ACTION_EXACT_RUNTIME_ENTRYPOINT_V1,
    input.compatibilityDate,
  ]);
}

export function buildEdgeActionExactRuntimeWorkerDefinitionV1(
  input: BuildEdgeActionExactRuntimeWorkerDefinitionV1Input,
): EdgeActionExactRuntimeWorkerDefinitionV1 {
  const moduleTime = compatibilityDateMilliseconds(input.compatibilityDate);
  const modules = executionArtifactWorkerModulesFromSources({
    sourceModules: input.sourceModules,
    runtimeModulePath: EDGE_ACTION_EXACT_RUNTIME_MAIN_MODULE_V1,
    runtimeWorkerSource: EDGE_ACTION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
    runtimeSupportModules: Object.freeze([
      Object.freeze({
        path: EDGE_ACTION_EXACT_RUNTIME_CONFIG_MODULE_V1,
        source: edgeActionExactRuntimeWorkerConfigurationSourceV1({
          runtimeTargetSha256Hex: input.runtimeTargetSha256Hex,
          hostPolicySha256Hex: input.hostPolicySha256Hex,
          artifact: input.artifact,
          function: input.function,
          moduleTime,
          maximumArgumentBytes: input.hostPolicy.maximumArgumentBytes,
          maximumResultBytes: input.hostPolicy.maximumResultBytes,
          maximumSyscalls: input.hostPolicy.maximumSyscalls,
          maximumCallbackArgumentBytes:
            input.hostPolicy.maximumCallbackArgumentBytes,
          maximumCallbackResultBytes:
            input.hostPolicy.maximumCallbackResultBytes,
        }),
      }),
      Object.freeze({
        path: EDGE_ACTION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
        source: edgeActionExactRuntimeExecutionBridgeSourceV1(
          input.artifactExecutionModule,
          input.exportName,
          input.functionPath,
        ),
      }),
      Object.freeze({
        path: EDGE_ACTION_RUNTIME_KERNEL_MODULE_V1,
        source: EDGE_ACTION_RUNTIME_KERNEL_SOURCE_V1,
      }),
    ]),
    reservedBy: "candidate-bound exact edge-action runtime",
  });
  return Object.freeze({
    compatibilityDate: input.compatibilityDate,
    mainModule: EDGE_ACTION_EXACT_RUNTIME_MAIN_MODULE_V1,
    modules: Object.freeze(modules),
    env: Object.freeze({}),
    limits: Object.freeze({
      cpuMs: input.hostPolicy.cpuMilliseconds,
      subRequests: input.hostPolicy.maximumWorkerSubrequests,
    }),
    runtimeTargetSha256Hex: input.runtimeTargetSha256Hex,
    hostPolicySha256Hex: input.hostPolicySha256Hex,
    artifact: input.artifact,
    function: input.function,
    wallMilliseconds: input.hostPolicy.wallMilliseconds,
    cleanupDrainMilliseconds: input.hostPolicy.cleanupDrainMilliseconds,
    entrypoint: EDGE_ACTION_EXACT_RUNTIME_ENTRYPOINT_V1,
  });
}

function compatibilityDateMilliseconds(value: string): number {
  const milliseconds = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(`${value}T00:00:00.000Z`)
    : Number.NaN;
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString().slice(0, 10) !== value
  ) throw new Error("Exact edge-action runtime compatibility date is invalid.");
  return milliseconds;
}
