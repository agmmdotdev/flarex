import { Data } from "effect";
import {
  POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_ENTRYPOINT_V1,
  POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_PROFILE_V1,
  POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_SYSCALL_ABI_V1,
  POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_VERSION_V1,
  type PointQueryInternalCallExactRuntimeArtifactRefV1,
  type PointQueryInternalCallExactRuntimeFunctionV1,
} from "flarex-protocol/point-query-internal-call-exact-runtime";

import {
  executionArtifactWorkerModulesFromSources,
  type ExecutionArtifactWorkerDefinition,
} from "./HostKit";
import {
  APPLICATION_ERROR_PLATFORM_MODULE_V1,
  APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
  APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1,
  applicationErrorPlatformSourceV1,
} from "./ApplicationErrorExactRuntimeWorkerSource";
import {
  FUNCTION_API_CORE_MODULE_V1,
  FUNCTION_API_CORE_SHA256_V1,
  FUNCTION_API_CORE_SOURCE_V1,
} from "./FunctionApiCore.generated";
import {
  POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SHA256_V1,
  POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
} from "./PointQueryInternalCallExactRuntimeWorkerCore.generated";
import {
  POINT_QUERY_INTERNAL_CALL_RUNTIME_KERNEL_SHA256_V1,
  POINT_QUERY_INTERNAL_CALL_RUNTIME_KERNEL_SOURCE_V1,
} from "./PointQueryInternalCallRuntimeKernel.generated";
import {
  pointQueryInternalCallExactRuntimeExecutionBridgeSourceV1,
  pointQueryInternalCallExactRuntimeWorkerConfigurationSourceV1,
} from "./PointQueryInternalCallExactRuntimeWorkerSource";

export const POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_MAIN_MODULE_V1 =
  "flarex-point-query-internal-call-exact-runtime-v1.js";
export const POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_CONFIG_MODULE_V1 =
  "pointQueryInternalCallExactRuntimeWorker/flarex-point-query-internal-call-exact-runtime-config-v1.js";
export const POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1 =
  "pointQueryInternalCallExactRuntimeWorker/flarex-point-query-internal-call-exact-runtime-execution-v1.js";
export const POINT_QUERY_INTERNAL_CALL_RUNTIME_KERNEL_MODULE_V1 =
  "pointQueryInternalCallExactRuntimeWorker/flarex-point-query-internal-call-runtime-kernel-v1.js";

const pointQueryInternalCallApplicationErrorPlatformSourceV1 = (): string =>
  applicationErrorPlatformSourceV1({
    runtimeKernelModulePath: `../${POINT_QUERY_INTERNAL_CALL_RUNTIME_KERNEL_MODULE_V1}`,
    captureExportName:
      "capturePointQueryInternalCallCoreApplicationErrorDataV1",
    invalid: { kind: "nativeError" },
  });

export interface PointQueryInternalCallExactRuntimeWorkerDefinitionV1
  extends ExecutionArtifactWorkerDefinition {
  readonly compatibilityDate: string;
  readonly modules: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<PropertyKey, never>>;
  readonly globalOutbound: null;
  readonly entrypoint: typeof POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_ENTRYPOINT_V1;
}

export interface BuildPointQueryInternalCallExactRuntimeWorkerDefinitionV1Input {
  readonly artifact: PointQueryInternalCallExactRuntimeArtifactRefV1;
  readonly compatibilityDate: string;
  readonly runtimeTargetSha256Hex: string;
  readonly function: PointQueryInternalCallExactRuntimeFunctionV1;
  readonly snapshotCommitSeq: bigint;
  readonly functionPath: string;
  readonly rootFunctionOrdinal: bigint;
  readonly artifactExecutionModule: string;
  readonly exportName: string;
  readonly internalQueryCatalog: ReadonlyArray<Readonly<{
    readonly functionOrdinal: bigint;
    readonly functionPath: string;
    readonly artifactExecutionModule: string;
    readonly exportName: string;
    readonly argsValidator: unknown;
    readonly returnsValidator: unknown;
  }>>;
  readonly sourceModules: ReadonlyArray<Readonly<{
    readonly path: string;
    readonly source: string;
  }>>;
}

export class PointQueryInternalCallExactRuntimeHostV1Error extends Data.TaggedError(
  "PointQueryInternalCallExactRuntimeHostV1Error",
)<{
  readonly reason: "workerDefinitionFailed";
  readonly cause: unknown;
}> {}

export function pointQueryInternalCallExactRuntimeWorkerGraphBasisV1(input: Readonly<{
  readonly compatibilityDate: string;
  readonly artifactExecutionModule: string;
  readonly exportName: string;
  readonly functionPath: string;
  readonly internalQueryCatalog: BuildPointQueryInternalCallExactRuntimeWorkerDefinitionV1Input[
    "internalQueryCatalog"
  ];
}>): string {
  const moduleTime = compatibilityDateMilliseconds(input.compatibilityDate);
  const bridge = pointQueryInternalCallExactRuntimeExecutionBridgeSourceV1({
    root: {
      artifactExecutionModule: input.artifactExecutionModule,
      exportName: input.exportName,
      functionPath: input.functionPath,
    },
    internalQueryCatalog: input.internalQueryCatalog,
  });
  return JSON.stringify([
    POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_PROFILE_V1,
    POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_VERSION_V1,
    POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_SYSCALL_ABI_V1,
    [POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_MAIN_MODULE_V1,
      POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SHA256_V1],
    [POINT_QUERY_INTERNAL_CALL_RUNTIME_KERNEL_MODULE_V1,
      POINT_QUERY_INTERNAL_CALL_RUNTIME_KERNEL_SHA256_V1],
    [FUNCTION_API_CORE_MODULE_V1, FUNCTION_API_CORE_SHA256_V1],
    [APPLICATION_ERROR_PLATFORM_MODULE_V1,
      pointQueryInternalCallApplicationErrorPlatformSourceV1()],
    [APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
      APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1],
    [POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1, bridge],
    POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_ENTRYPOINT_V1,
    input.compatibilityDate,
  ]);
}

export function buildPointQueryInternalCallExactRuntimeWorkerDefinitionV1(
  input: BuildPointQueryInternalCallExactRuntimeWorkerDefinitionV1Input,
): PointQueryInternalCallExactRuntimeWorkerDefinitionV1 {
  const moduleTime = compatibilityDateMilliseconds(input.compatibilityDate);
  const modules = executionArtifactWorkerModulesFromSources({
    sourceModules: input.sourceModules,
    runtimeModulePath: POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_MAIN_MODULE_V1,
    runtimeWorkerSource: POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
    runtimeSupportModules: Object.freeze([
      Object.freeze({
        path: POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_CONFIG_MODULE_V1,
        source: pointQueryInternalCallExactRuntimeWorkerConfigurationSourceV1({
          moduleTime,
          runtimeTargetSha256Hex: input.runtimeTargetSha256Hex,
          artifact: input.artifact,
          function: input.function,
          rootFunctionOrdinal: input.rootFunctionOrdinal,
          internalQueryCatalog: input.internalQueryCatalog,
          snapshotCommitSeq: input.snapshotCommitSeq,
        }),
      }),
      Object.freeze({
        path: POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
        source: pointQueryInternalCallExactRuntimeExecutionBridgeSourceV1({
          root: {
            artifactExecutionModule: input.artifactExecutionModule,
            exportName: input.exportName,
            functionPath: input.functionPath,
          },
          internalQueryCatalog: input.internalQueryCatalog,
        }),
      }),
      Object.freeze({
        path: POINT_QUERY_INTERNAL_CALL_RUNTIME_KERNEL_MODULE_V1,
        source: POINT_QUERY_INTERNAL_CALL_RUNTIME_KERNEL_SOURCE_V1,
      }),
      Object.freeze({
        path: FUNCTION_API_CORE_MODULE_V1,
        source: FUNCTION_API_CORE_SOURCE_V1,
      }),
      Object.freeze({
        path: APPLICATION_ERROR_PLATFORM_MODULE_V1,
        source: pointQueryInternalCallApplicationErrorPlatformSourceV1(),
      }),
      Object.freeze({
        path: APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
        source: APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1,
      }),
    ]),
    reservedBy: "candidate-bound exact internal-call point-query runtime",
  });
  return Object.freeze({
    compatibilityDate: input.compatibilityDate,
    mainModule: POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_MAIN_MODULE_V1,
    modules: Object.freeze(modules),
    env: Object.freeze({}),
    globalOutbound: null,
    entrypoint: POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_ENTRYPOINT_V1,
  });
}

function compatibilityDateMilliseconds(value: string): number {
  const milliseconds = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(`${value}T00:00:00.000Z`)
    : Number.NaN;
  if (!Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString().slice(0, 10) !== value) {
    throw new Error("Exact point-query runtime compatibility date is invalid.");
  }
  return milliseconds;
}
