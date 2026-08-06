import { Data } from "effect";
import {
  POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_ENTRYPOINT_V1,
  POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_PROFILE_V1,
  POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_SYSCALL_ABI_V1,
  POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_VERSION_V1,
  type PointMutationInternalCallExactRuntimeArtifactRefV1,
  type PointMutationInternalCallExactRuntimeFunctionV1,
} from "flarex-protocol/point-mutation-internal-call-exact-runtime";

import {
  executionArtifactWorkerModulesFromSources,
  type ExecutionArtifactWorkerDefinition,
} from "./HostKit";
import {
  APPLICATION_ERROR_PLATFORM_MODULE_V1,
  APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
  APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1,
} from "./ApplicationErrorExactRuntimeWorkerSource";
import {
  FUNCTION_API_CORE_MODULE_V1,
  FUNCTION_API_CORE_SHA256_V1,
  FUNCTION_API_CORE_SOURCE_V1,
} from "./FunctionApiCore.generated";
import {
  POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SHA256_V1,
  POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
} from "./PointMutationInternalCallExactRuntimeWorkerCore.generated";
import {
  POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_SHA256_V1,
  POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_SOURCE_V1,
} from "./PointMutationInternalCallRuntimeKernel.generated";
import {
  pointMutationInternalCallExactRuntimeExecutionBridgeSourceV1,
  pointMutationInternalCallExactRuntimePlatformSourceV1,
  pointMutationInternalCallExactRuntimeWorkerConfigurationSourceV1,
} from "./PointMutationInternalCallExactRuntimeWorkerSource";

export const POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_MAIN_MODULE_V1 =
  "flarex-point-mutation-internal-call-exact-runtime-v1.js";
export const POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_CONFIG_MODULE_V1 =
  "pointMutationInternalCallExactRuntimeWorker/flarex-point-mutation-internal-call-exact-runtime-config-v1.js";
export const POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1 =
  "pointMutationInternalCallExactRuntimeWorker/flarex-point-mutation-internal-call-exact-runtime-execution-v1.js";
export const POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_MODULE_V1 =
  "pointMutationInternalCallExactRuntimeWorker/flarex-point-mutation-internal-call-runtime-kernel-v1.js";
export const POINT_MUTATION_INTERNAL_CALL_PLATFORM_MODULE_V1 =
  APPLICATION_ERROR_PLATFORM_MODULE_V1;

export interface PointMutationInternalCallExactRuntimeWorkerDefinitionV1
  extends ExecutionArtifactWorkerDefinition {
  readonly compatibilityDate: string;
  readonly modules: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<PropertyKey, never>>;
  readonly globalOutbound: null;
  readonly entrypoint: typeof POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_ENTRYPOINT_V1;
}

export interface BuildPointMutationInternalCallExactRuntimeWorkerDefinitionV1Input {
  readonly artifact: PointMutationInternalCallExactRuntimeArtifactRefV1;
  readonly compatibilityDate: string;
  readonly runtimeTargetSha256Hex: string;
  readonly function: PointMutationInternalCallExactRuntimeFunctionV1;
  readonly functionPath: string;
  readonly rootFunctionOrdinal: bigint;
  readonly artifactExecutionModule: string;
  readonly exportName: string;
  readonly internalFunctionCatalog: ReadonlyArray<Readonly<{
    readonly functionOrdinal: bigint;
    readonly functionPath: string;
    readonly artifactExecutionModule: string;
    readonly exportName: string;
    readonly handlerKind: "query" | "mutation";
    readonly argsValidator: unknown;
    readonly returnsValidator: unknown;
  }>>;
  readonly sourceModules: ReadonlyArray<Readonly<{
    readonly path: string;
    readonly source: string;
  }>>;
}

export class PointMutationInternalCallExactRuntimeHostV1Error extends Data.TaggedError(
  "PointMutationInternalCallExactRuntimeHostV1Error",
)<{
  readonly reason: "workerDefinitionFailed";
  readonly cause: unknown;
}> {}

export function pointMutationInternalCallExactRuntimeWorkerGraphBasisV1(input: Readonly<{
  readonly compatibilityDate: string;
  readonly artifactExecutionModule: string;
  readonly exportName: string;
  readonly functionPath: string;
  readonly internalFunctionCatalog: BuildPointMutationInternalCallExactRuntimeWorkerDefinitionV1Input[
    "internalFunctionCatalog"
  ];
}>): string {
  const moduleTime = compatibilityDateMilliseconds(input.compatibilityDate);
  const bridge = pointMutationInternalCallExactRuntimeExecutionBridgeSourceV1({
    root: {
      artifactExecutionModule: input.artifactExecutionModule,
      exportName: input.exportName,
      functionPath: input.functionPath,
    },
    internalFunctionCatalog: input.internalFunctionCatalog,
  });
  return JSON.stringify([
    POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_PROFILE_V1,
    POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_VERSION_V1,
    POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_SYSCALL_ABI_V1,
    [POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_MAIN_MODULE_V1,
      POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SHA256_V1],
    [POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_MODULE_V1,
      POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_SHA256_V1],
    [FUNCTION_API_CORE_MODULE_V1, FUNCTION_API_CORE_SHA256_V1],
    [POINT_MUTATION_INTERNAL_CALL_PLATFORM_MODULE_V1,
      pointMutationInternalCallExactRuntimePlatformSourceV1()],
    [APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
      APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1],
    [POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1, bridge],
    POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_ENTRYPOINT_V1,
    input.compatibilityDate,
  ]);
}

export function buildPointMutationInternalCallExactRuntimeWorkerDefinitionV1(
  input: BuildPointMutationInternalCallExactRuntimeWorkerDefinitionV1Input,
): PointMutationInternalCallExactRuntimeWorkerDefinitionV1 {
  const moduleTime = compatibilityDateMilliseconds(input.compatibilityDate);
  const modules = executionArtifactWorkerModulesFromSources({
    sourceModules: input.sourceModules,
    runtimeModulePath: POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_MAIN_MODULE_V1,
    runtimeWorkerSource: POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
    runtimeSupportModules: Object.freeze([
      Object.freeze({
        path: POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_CONFIG_MODULE_V1,
        source: pointMutationInternalCallExactRuntimeWorkerConfigurationSourceV1({
          moduleTime,
          runtimeTargetSha256Hex: input.runtimeTargetSha256Hex,
          artifact: input.artifact,
          function: input.function,
          rootFunctionOrdinal: input.rootFunctionOrdinal,
          internalFunctionCatalog: input.internalFunctionCatalog,
        }),
      }),
      Object.freeze({
        path: POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
        source: pointMutationInternalCallExactRuntimeExecutionBridgeSourceV1({
          root: {
            artifactExecutionModule: input.artifactExecutionModule,
            exportName: input.exportName,
            functionPath: input.functionPath,
          },
          internalFunctionCatalog: input.internalFunctionCatalog,
        }),
      }),
      Object.freeze({
        path: POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_MODULE_V1,
        source: POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_SOURCE_V1,
      }),
      Object.freeze({
        path: FUNCTION_API_CORE_MODULE_V1,
        source: FUNCTION_API_CORE_SOURCE_V1,
      }),
      Object.freeze({
        path: POINT_MUTATION_INTERNAL_CALL_PLATFORM_MODULE_V1,
        source: pointMutationInternalCallExactRuntimePlatformSourceV1(),
      }),
      Object.freeze({
        path: APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
        source: APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1,
      }),
    ]),
    reservedBy: "candidate-bound exact mutation/internal-call runtime",
  });
  return Object.freeze({
    compatibilityDate: input.compatibilityDate,
    mainModule: POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_MAIN_MODULE_V1,
    modules: Object.freeze(modules),
    env: Object.freeze({}),
    globalOutbound: null,
    entrypoint: POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_ENTRYPOINT_V1,
  });
}

function compatibilityDateMilliseconds(value: string): number {
  const milliseconds = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(`${value}T00:00:00.000Z`)
    : Number.NaN;
  if (!Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString().slice(0, 10) !== value) {
    throw new Error("Exact point-mutation runtime compatibility date is invalid.");
  }
  return milliseconds;
}
