import {
  calendarDateToEpochMilliseconds,
  isCanonicalCalendarDate,
} from "@flarex/time/calendar-date";
import { Data } from "effect";
import {
  POINT_QUERY_EXACT_RUNTIME_ENTRYPOINT_V1,
  POINT_QUERY_EXACT_RUNTIME_PROFILE_V1,
  POINT_QUERY_EXACT_RUNTIME_SYSCALL_ABI_V1,
  POINT_QUERY_EXACT_RUNTIME_VERSION_V1,
  type PointQueryExactRuntimeArtifactRefV1,
  type PointQueryExactRuntimeFunctionV1,
} from "flarex-protocol/point-query-exact-runtime";

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
  POINT_QUERY_EXACT_RUNTIME_WORKER_CORE_SHA256_V1,
  POINT_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
} from "./PointQueryExactRuntimeWorkerCore.generated";
import {
  POINT_QUERY_RUNTIME_KERNEL_SHA256_V1,
  POINT_QUERY_RUNTIME_KERNEL_SOURCE_V1,
} from "./PointQueryRuntimeKernel.generated";
import {
  pointQueryExactRuntimeExecutionBridgeSourceV1,
  pointQueryExactRuntimeWorkerConfigurationSourceV1,
} from "./PointQueryExactRuntimeWorkerSource";

export const POINT_QUERY_EXACT_RUNTIME_MAIN_MODULE_V1 =
  "flarex-point-query-exact-runtime-v1.js";
export const POINT_QUERY_EXACT_RUNTIME_CONFIG_MODULE_V1 =
  "pointQueryExactRuntimeWorker/flarex-point-query-exact-runtime-config-v1.js";
export const POINT_QUERY_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1 =
  "pointQueryExactRuntimeWorker/flarex-point-query-exact-runtime-execution-v1.js";
export const POINT_QUERY_RUNTIME_KERNEL_MODULE_V1 =
  "pointQueryExactRuntimeWorker/flarex-point-query-runtime-kernel-v1.js";

const pointQueryApplicationErrorPlatformSourceV1 = (): string =>
  applicationErrorPlatformSourceV1({
    runtimeKernelModulePath: `../${POINT_QUERY_RUNTIME_KERNEL_MODULE_V1}`,
    captureExportName: "capturePointQueryCoreApplicationErrorDataV1",
    invalid: { kind: "nativeError" },
  });

export interface PointQueryExactRuntimeWorkerDefinitionV1
  extends ExecutionArtifactWorkerDefinition {
  readonly compatibilityDate: string;
  readonly modules: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<PropertyKey, never>>;
  readonly globalOutbound: null;
  readonly entrypoint: typeof POINT_QUERY_EXACT_RUNTIME_ENTRYPOINT_V1;
}

export interface BuildPointQueryExactRuntimeWorkerDefinitionV1Input {
  readonly artifact: PointQueryExactRuntimeArtifactRefV1;
  readonly compatibilityDate: string;
  readonly runtimeTargetSha256Hex: string;
  readonly function: PointQueryExactRuntimeFunctionV1;
  readonly snapshotCommitSeq: bigint;
  readonly functionPath: string;
  readonly artifactExecutionModule: string;
  readonly exportName: string;
  readonly sourceModules: ReadonlyArray<Readonly<{
    readonly path: string;
    readonly source: string;
  }>>;
}

export class PointQueryExactRuntimeHostV1Error extends Data.TaggedError(
  "PointQueryExactRuntimeHostV1Error",
)<{
  readonly reason: "workerDefinitionFailed";
  readonly cause: unknown;
}> {}

export function pointQueryExactRuntimeWorkerGraphBasisV1(input: Readonly<{
  readonly compatibilityDate: string;
  readonly artifactExecutionModule: string;
  readonly exportName: string;
  readonly functionPath: string;
}>): string {
  const moduleTime = compatibilityDateMilliseconds(input.compatibilityDate);
  const bridge = pointQueryExactRuntimeExecutionBridgeSourceV1(
    input.artifactExecutionModule,
    input.exportName,
    input.functionPath,
  );
  return JSON.stringify([
    POINT_QUERY_EXACT_RUNTIME_PROFILE_V1,
    POINT_QUERY_EXACT_RUNTIME_VERSION_V1,
    POINT_QUERY_EXACT_RUNTIME_SYSCALL_ABI_V1,
    [POINT_QUERY_EXACT_RUNTIME_MAIN_MODULE_V1,
      POINT_QUERY_EXACT_RUNTIME_WORKER_CORE_SHA256_V1],
    [POINT_QUERY_RUNTIME_KERNEL_MODULE_V1,
      POINT_QUERY_RUNTIME_KERNEL_SHA256_V1],
    [FUNCTION_API_CORE_MODULE_V1, FUNCTION_API_CORE_SHA256_V1],
    [APPLICATION_ERROR_PLATFORM_MODULE_V1,
      pointQueryApplicationErrorPlatformSourceV1()],
    [APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
      APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1],
    [POINT_QUERY_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1, bridge],
    POINT_QUERY_EXACT_RUNTIME_ENTRYPOINT_V1,
    input.compatibilityDate,
  ]);
}

export function buildPointQueryExactRuntimeWorkerDefinitionV1(
  input: BuildPointQueryExactRuntimeWorkerDefinitionV1Input,
): PointQueryExactRuntimeWorkerDefinitionV1 {
  const moduleTime = compatibilityDateMilliseconds(input.compatibilityDate);
  const modules = executionArtifactWorkerModulesFromSources({
    sourceModules: input.sourceModules,
    runtimeModulePath: POINT_QUERY_EXACT_RUNTIME_MAIN_MODULE_V1,
    runtimeWorkerSource: POINT_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
    runtimeSupportModules: Object.freeze([
      Object.freeze({
        path: POINT_QUERY_EXACT_RUNTIME_CONFIG_MODULE_V1,
        source: pointQueryExactRuntimeWorkerConfigurationSourceV1({
          moduleTime,
          runtimeTargetSha256Hex: input.runtimeTargetSha256Hex,
          artifact: input.artifact,
          function: input.function,
          snapshotCommitSeq: input.snapshotCommitSeq,
        }),
      }),
      Object.freeze({
        path: POINT_QUERY_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
        source: pointQueryExactRuntimeExecutionBridgeSourceV1(
          input.artifactExecutionModule,
          input.exportName,
          input.functionPath,
        ),
      }),
      Object.freeze({
        path: POINT_QUERY_RUNTIME_KERNEL_MODULE_V1,
        source: POINT_QUERY_RUNTIME_KERNEL_SOURCE_V1,
      }),
      Object.freeze({
        path: FUNCTION_API_CORE_MODULE_V1,
        source: FUNCTION_API_CORE_SOURCE_V1,
      }),
      Object.freeze({
        path: APPLICATION_ERROR_PLATFORM_MODULE_V1,
        source: pointQueryApplicationErrorPlatformSourceV1(),
      }),
      Object.freeze({
        path: APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
        source: APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1,
      }),
    ]),
    reservedBy: "candidate-bound exact point-query runtime",
  });
  return Object.freeze({
    compatibilityDate: input.compatibilityDate,
    mainModule: POINT_QUERY_EXACT_RUNTIME_MAIN_MODULE_V1,
    modules: Object.freeze(modules),
    env: Object.freeze({}),
    globalOutbound: null,
    entrypoint: POINT_QUERY_EXACT_RUNTIME_ENTRYPOINT_V1,
  });
}

function compatibilityDateMilliseconds(value: string): number {
  if (!isCanonicalCalendarDate(value)) {
    throw new Error("Exact point-query runtime compatibility date is invalid.");
  }
  return calendarDateToEpochMilliseconds(value);
}
