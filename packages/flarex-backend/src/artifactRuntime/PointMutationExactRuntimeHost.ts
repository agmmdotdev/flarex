import { Data, Effect } from "effect";
import {
  assertExecutionArtifactRefMatchesMaterializedSourcePackage,
  SOURCE_MODULE_DIGEST_FORMAT_V1,
  type ExecutionArtifactRef,
} from "flarex/artifacts";
import {
  POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1,
  POINT_MUTATION_EXACT_RUNTIME_PROFILE_V1,
  POINT_MUTATION_EXACT_RUNTIME_VERSION_V1,
  type PointMutationExactRuntimeArtifactRefV1,
} from "flarex-protocol/point-mutation-exact-runtime";

import {
  BackendExecutionArtifactIntegrityError,
  type BackendExecutionArtifactStore,
} from "../artifactStore.ts";
import type { PushSourcePackage } from "../types.ts";
import {
  executionArtifactWorkerModules,
  executionArtifactWorkerModulesFromSources,
  type ExecutionArtifactWorkerDefinition,
} from "./HostKit.ts";
import {
  APPLICATION_ERROR_PLATFORM_MODULE_V1,
  APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
  APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1,
  applicationErrorPlatformSourceV1,
} from "./ApplicationErrorExactRuntimeWorkerSource.ts";
import {
  FUNCTION_API_CORE_MODULE_V1,
  FUNCTION_API_CORE_SOURCE_V1,
} from "./FunctionApiCore.generated.ts";
import {
  pointMutationExactRuntimeWorkerConfigurationSource,
  pointMutationExactRuntimeWorkerExecutionBridgeSource,
} from "./PointMutationExactRuntimeWorkerSource.ts";
import {
  POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SHA256_V1,
  POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
} from "./PointMutationExactRuntimeWorkerCore.generated.ts";
import {
  POINT_MUTATION_RUNTIME_KERNEL_SHA256_V1,
  POINT_MUTATION_RUNTIME_KERNEL_SOURCE_V1,
} from "./PointMutationRuntimeKernel.generated.ts";

export const POINT_MUTATION_EXACT_RUNTIME_MAIN_MODULE_V1 =
  "flarex-point-mutation-exact-runtime-v1.js";
export const POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1 =
  "pointMutationExactRuntimeWorker/flarex-point-mutation-exact-runtime-config-v1.js";
export const POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1 =
  "pointMutationExactRuntimeWorker/flarex-point-mutation-exact-runtime-execution-v1.js";
export const POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1 =
  "pointMutationExactRuntimeWorker/flarex-point-mutation-runtime-kernel-v1.js";

const pointMutationApplicationErrorPlatformSourceV1 = (): string =>
  applicationErrorPlatformSourceV1({
    runtimeKernelModulePath: `../${POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1}`,
    captureExportName: "capturePointMutationCoreApplicationErrorDataV1",
    invalid: { kind: "nativeError" },
  });

export type PointMutationExactRuntimeWorkerEnvV1 = Readonly<
  Record<PropertyKey, never>
>;

export interface PointMutationExactRuntimeWorkerDefinitionV1
  extends ExecutionArtifactWorkerDefinition {
  readonly compatibilityDate: string;
  readonly modules: Readonly<Record<string, string>>;
  readonly env: PointMutationExactRuntimeWorkerEnvV1;
  readonly globalOutbound: null;
  readonly entrypoint: typeof POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1;
}

export interface PointMutationExactRuntimeWorkerCodeIdentityV1Input {
  readonly artifact: PointMutationExactRuntimeArtifactRefV1;
  readonly compatibilityDate: string;
}

export interface LoadPointMutationExactRuntimeWorkerDefinitionV1Input
  extends PointMutationExactRuntimeWorkerCodeIdentityV1Input {
  readonly store: Pick<BackendExecutionArtifactStore, "get">;
}

export interface BuildPointMutationExactRuntimeWorkerDefinitionV1Input
  extends PointMutationExactRuntimeWorkerCodeIdentityV1Input {
  readonly sourceModules: ReadonlyArray<Readonly<{
    readonly path: string;
    readonly source: string;
  }>>;
  readonly executionBridgeSource: string;
}

export interface PointMutationExactRuntimeWorkerGraphBasisV1Input {
  readonly compatibilityDate: string;
  readonly executionModule: string;
  readonly executionBridgeSource: string;
}

export type PointMutationExactRuntimeHostV1Issue =
  | Readonly<{
      readonly reason: "sourcePackageLoadFailed";
      readonly cause: unknown;
    }>
  | Readonly<{
      readonly reason: "sourcePackagePinMismatch";
      readonly cause: unknown;
    }>
  | Readonly<{
      readonly reason: "workerDefinitionFailed";
      readonly cause: unknown;
    }>;

export class PointMutationExactRuntimeHostV1Error extends Data.TaggedError(
  "PointMutationExactRuntimeHostV1Error",
)<{
  readonly issue: PointMutationExactRuntimeHostV1Issue;
}> {}

export function pointMutationExactRuntimeWorkerCodeIdentityV1(
  input: PointMutationExactRuntimeWorkerCodeIdentityV1Input,
): string {
  const runtimeSupportModules = pointMutationExactRuntimeSupportModulesV1({
    executionModule: input.artifact.executionModule,
    moduleTime: Date.parse(`${input.compatibilityDate}T00:00:00.000Z`),
    moduleRandomSeedHex: input.artifact.sourcePackageHash,
  });
  return JSON.stringify([
    POINT_MUTATION_EXACT_RUNTIME_PROFILE_V1,
    POINT_MUTATION_EXACT_RUNTIME_VERSION_V1,
    [
      POINT_MUTATION_EXACT_RUNTIME_MAIN_MODULE_V1,
      POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SHA256_V1,
    ],
    [
      POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1,
      POINT_MUTATION_RUNTIME_KERNEL_SHA256_V1,
    ],
    POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1,
    ...runtimeSupportModules.map((module) => [module.path, module.source]),
    input.compatibilityDate,
    input.artifact.runtime,
    input.artifact.artifactId,
    input.artifact.sourcePackageHash,
    input.artifact.executionModule,
  ]);
}

/**
 * Seed-independent basis for every backend-owned value that can change the
 * exact Worker graph. The eventual source-package hash is deliberately
 * represented by one canonical placeholder: the candidate-bound target digest
 * supplies that dynamic seed after this basis has been committed.
 */
export function pointMutationExactRuntimeWorkerGraphBasisV1(
  input: PointMutationExactRuntimeWorkerGraphBasisV1Input,
): string {
  const moduleTime = compatibilityDateMilliseconds(input.compatibilityDate);
  const supportModules = pointMutationExactRuntimeSupportModulesV1({
    executionModule: input.executionModule,
    executionBridgeSource: input.executionBridgeSource,
    moduleTime,
    moduleRandomSeedHex: "0".repeat(64),
  });
  return JSON.stringify([
    POINT_MUTATION_EXACT_RUNTIME_PROFILE_V1,
    POINT_MUTATION_EXACT_RUNTIME_VERSION_V1,
    [
      POINT_MUTATION_EXACT_RUNTIME_MAIN_MODULE_V1,
      POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SHA256_V1,
    ],
    ...supportModules.map(module => [module.path, module.source]),
    POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1,
    input.compatibilityDate,
    input.executionModule,
  ]);
}

function pointMutationExactRuntimeWorkerDefinitionV1(input: {
  readonly sourcePackage: PushSourcePackage;
  readonly artifact: PointMutationExactRuntimeArtifactRefV1;
  readonly compatibilityDate: string;
}): PointMutationExactRuntimeWorkerDefinitionV1 {
  const moduleTime = compatibilityDateMilliseconds(input.compatibilityDate);
  return Object.freeze({
    compatibilityDate: input.compatibilityDate,
    mainModule: POINT_MUTATION_EXACT_RUNTIME_MAIN_MODULE_V1,
    modules: Object.freeze(executionArtifactWorkerModules({
      sourcePackage: input.sourcePackage,
      runtimeModulePath: POINT_MUTATION_EXACT_RUNTIME_MAIN_MODULE_V1,
      runtimeWorkerSource:
        POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
      runtimeSupportModules: pointMutationExactRuntimeSupportModulesV1({
        executionModule: input.sourcePackage.execution,
        moduleTime,
        moduleRandomSeedHex: input.artifact.sourcePackageHash,
      }),
      reservedBy: "exact point-mutation runtime",
    })),
    env: Object.freeze({}),
    globalOutbound: null,
    entrypoint: POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1,
  });
}

export function buildPointMutationExactRuntimeWorkerDefinitionV1(
  input: BuildPointMutationExactRuntimeWorkerDefinitionV1Input,
): PointMutationExactRuntimeWorkerDefinitionV1 {
  const moduleTime = compatibilityDateMilliseconds(input.compatibilityDate);
  return Object.freeze({
    compatibilityDate: input.compatibilityDate,
    mainModule: POINT_MUTATION_EXACT_RUNTIME_MAIN_MODULE_V1,
    modules: Object.freeze(executionArtifactWorkerModulesFromSources({
      sourceModules: input.sourceModules,
      runtimeModulePath: POINT_MUTATION_EXACT_RUNTIME_MAIN_MODULE_V1,
      runtimeWorkerSource: POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
      runtimeSupportModules: pointMutationExactRuntimeSupportModulesV1({
        executionModule: input.artifact.executionModule,
        executionBridgeSource: input.executionBridgeSource,
        moduleTime,
        moduleRandomSeedHex: input.artifact.sourcePackageHash,
      }),
      reservedBy: "candidate-bound exact point-mutation runtime",
    })),
    env: Object.freeze({}),
    globalOutbound: null,
    entrypoint: POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1,
  });
}

function pointMutationExactRuntimeSupportModulesV1(
  options: {
    readonly executionModule: string;
    readonly executionBridgeSource?: string;
    readonly moduleTime: number;
    readonly moduleRandomSeedHex: string;
  },
): ReadonlyArray<Readonly<{ readonly path: string; readonly source: string }>> {
  return Object.freeze([
    Object.freeze({
      path: POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1,
      source: pointMutationExactRuntimeWorkerConfigurationSource(options),
    }),
    Object.freeze({
      path: POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
      source: options.executionBridgeSource ??
        pointMutationExactRuntimeWorkerExecutionBridgeSource(
          options.executionModule,
        ),
    }),
    Object.freeze({
      path: POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1,
      source: POINT_MUTATION_RUNTIME_KERNEL_SOURCE_V1,
    }),
    Object.freeze({
      path: FUNCTION_API_CORE_MODULE_V1,
      source: FUNCTION_API_CORE_SOURCE_V1,
    }),
    Object.freeze({
      path: APPLICATION_ERROR_PLATFORM_MODULE_V1,
      source: pointMutationApplicationErrorPlatformSourceV1(),
    }),
    Object.freeze({
      path: APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
      source: APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1,
    }),
  ]);
}

function compatibilityDateMilliseconds(compatibilityDate: string): number {
  const hasDateShape = /^\d{4}-\d{2}-\d{2}$/.test(compatibilityDate);
  const moduleTime = hasDateShape
    ? Date.parse(`${compatibilityDate}T00:00:00.000Z`)
    : Number.NaN;
  if (
    !Number.isFinite(moduleTime) ||
    new Date(moduleTime).toISOString().slice(0, 10) !== compatibilityDate
  ) {
    throw new Error("Exact point-mutation runtime compatibility date is invalid.");
  }
  return moduleTime;
}

export const loadPointMutationExactRuntimeWorkerDefinitionV1Effect = Effect.fn(
  "PointMutationExactRuntimeHost.loadWorkerDefinition",
)(function* (
  input: LoadPointMutationExactRuntimeWorkerDefinitionV1Input,
): Effect.fn.Return<
  Readonly<{
    readonly codeIdentity: string;
    readonly definition: PointMutationExactRuntimeWorkerDefinitionV1;
    readonly loadMode: "fresh";
  }>,
  PointMutationExactRuntimeHostV1Error
> {
  const artifact = exactRuntimeArtifactRef(input.artifact);
  const sourcePackage = yield* Effect.tryPromise({
    try: () => input.store.get(artifact),
    catch: (cause) =>
      new PointMutationExactRuntimeHostV1Error({
        issue: {
          reason: cause instanceof BackendExecutionArtifactIntegrityError
            ? "sourcePackagePinMismatch"
            : "sourcePackageLoadFailed",
          cause,
        },
      }),
  });
  yield* Effect.tryPromise({
    try: async () => {
      await assertExecutionArtifactRefMatchesMaterializedSourcePackage(
        artifact,
        sourcePackage,
      );
      if (
        sourcePackage.sourceModuleDigestFormat !==
          SOURCE_MODULE_DIGEST_FORMAT_V1
      ) {
        throw new Error(
          "Exact point-mutation runtime requires framed V1 source-module digests.",
        );
      }
    },
    catch: (cause) =>
      new PointMutationExactRuntimeHostV1Error({
        issue: { reason: "sourcePackagePinMismatch", cause },
      }),
  });
  const definition = yield* Effect.try({
    try: () =>
      pointMutationExactRuntimeWorkerDefinitionV1({
        sourcePackage,
        artifact: input.artifact,
        compatibilityDate: input.compatibilityDate,
      }),
    catch: (cause) =>
      new PointMutationExactRuntimeHostV1Error({
        issue: { reason: "workerDefinitionFailed", cause },
      }),
  });
  return Object.freeze({
    codeIdentity: pointMutationExactRuntimeWorkerCodeIdentityV1(input),
    definition,
    loadMode: "fresh",
  });
});

function exactRuntimeArtifactRef(
  artifact: PointMutationExactRuntimeArtifactRefV1,
): ExecutionArtifactRef {
  return Object.freeze({
    runtime: artifact.runtime,
    artifactId: artifact.artifactId,
    sourcePackageHash: artifact.sourcePackageHash,
    executionModule: artifact.executionModule,
  });
}
