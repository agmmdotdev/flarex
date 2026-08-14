import { bytesEqualFullScan, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result } from "effect";
import {
  decodeTaskRuntimeEntryPreimageV1,
  decodeTaskDefinitionRuntimeBindingV1,
  decodeTaskRuntimeGroupManifestPreimageV1,
  decodeTaskRuntimeMaterializationSpecPreimageV1,
  decodeTaskRuntimeProjectionModulePreimageV1,
  decodeTaskRuntimeProjectionPreimageV1,
  hashTaskRuntimeEntryFrameV1,
  hashCanonicalTaskManifestV1,
  hashTaskRuntimeGroupManifestFrameV1,
  hashTaskRuntimeMaterializationSpecV1,
  MAX_TASK_RUNTIME_COMPATIBILITY_FLAGS_V1,
  MAX_TASK_RUNTIME_COMPUTE_PROFILES_V1,
  verifyTaskRuntimeProjectionV1,
  type StandardApplicationTaskSha256V1,
  type TaskRuntimeProjectionModuleFrameV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";

import type { TaskRuntimeLaunchSubject } from "../taskRuntimeLaunch/Model";
import {
  APPLICATION_WORKER_CORE_SOURCE,
  APPLICATION_WORKER_SERVER_EXPORTS,
  APPLICATION_WORKER_VALUES_EXPORTS,
} from "./ApplicationWorkerCore.generated";
import { makeLegacyTaskRuntimeModuleGraph } from "./ApplicationRuntimeModuleGraph";

export const LEGACY_TASK_WORKER_ENTRYPOINT = "FlarexLegacyTaskWorker" as const;

export interface LegacyTaskWorkerComputeProfilePolicy {
  readonly computeProfile: string;
  readonly cpuMilliseconds: number;
  readonly maximumDurationMs: number;
}

export interface LegacyTaskWorkerHostPolicy {
  readonly runtimeImplementationVersion: string;
  readonly admittedCompatibilityDate: string;
  readonly computeProfiles: ReadonlyArray<LegacyTaskWorkerComputeProfilePolicy>;
  readonly admittedCompatibilityFlags: ReadonlyArray<string>;
}

export class LegacyTaskWorkerDefinitionError extends Data.TaggedError(
  "LegacyTaskWorkerDefinitionError",
)<{
  readonly reason:
    | "invalidLaunchSubject"
    | "invalidRuntimeObject"
    | "authorityMismatch"
    | "hostPolicyMismatch"
    | "unsupportedComputeProfile"
    | "unsupportedDuration"
    | "resourceFailure";
  readonly cause?: unknown;
}> {}

export interface LegacyTaskWorkerDefinition {
  readonly taskDefinitionRevisionId: string;
  readonly computeProfile: string;
  readonly compatibilityDate: string;
  readonly compatibilityFlags: ReadonlyArray<string>;
  readonly wallMilliseconds: number;
  readonly limits: Readonly<{ readonly cpuMs: number; readonly subRequests: 0 }>;
  readonly mainModule: string;
  readonly modules: Readonly<Record<string, WorkerLoaderModule | string>>;
  readonly env: Readonly<Record<PropertyKey, never>>;
  readonly entrypoint: typeof LEGACY_TASK_WORKER_ENTRYPOINT;
}

export const makeLegacyTaskWorkerDefinition = Effect.fn(
  "LegacyTaskWorkerDefinition.make",
)(function* (input: {
  readonly subject: TaskRuntimeLaunchSubject;
  readonly hostPolicy: LegacyTaskWorkerHostPolicy;
  readonly sha256: StandardApplicationTaskSha256V1;
}) {
  const hostPolicy = yield* Effect.fromResult(captureHostPolicy(input.hostPolicy));
  const sha256 = input.sha256;
  const captured = yield* Effect.fromResult(Result.try({
    try: () => Object.freeze({
      taskDefinitionRevisionId: input.subject.request.taskDefinitionRevisionId,
      runtimeBinding: input.subject.runtimeBinding,
      runtimeObjects: Object.freeze(input.subject.runtimeObjects.map(item =>
        Object.freeze({
          role: item.reference.role,
          storeIdentity: item.reference.storeIdentity,
          objectKey: item.reference.objectKey,
          byteLength: item.reference.byteLength,
          sha256: new Uint8Array(item.reference.sha256),
          bytes: new Uint8Array(item.bytes),
        })
      )),
    }),
    catch: cause => definitionError("invalidLaunchSubject", cause),
  }));
  const binding = yield* Effect.fromResult(
    decodeTaskDefinitionRuntimeBindingV1(captured.runtimeBinding).pipe(
      Result.mapError(cause => definitionError("invalidLaunchSubject", cause)),
    ),
  );
  if (binding.runtimeObjects.length !== captured.runtimeObjects.length ||
    binding.runtimeObjects.some((reference, index) => {
      const supplied = captured.runtimeObjects[index];
      return supplied === undefined ||
        reference.role !== supplied.role ||
        reference.storeIdentity !== supplied.storeIdentity ||
        reference.objectKey !== supplied.objectKey ||
        reference.byteLength !== supplied.byteLength ||
        !bytesEqualFullScan(reference.sha256, supplied.sha256);
    })) return yield* definitionError("authorityMismatch");
  const singletonObjects = new Map<string, Uint8Array>();
  const moduleBodies = captured.runtimeObjects.filter(
    item => item.role === "runtime_projection_module",
  );
  for (const item of captured.runtimeObjects) {
    if (item.byteLength !== BigInt(item.bytes.byteLength)) {
      return yield* definitionError("authorityMismatch");
    }
    const bodySha256 = yield* sha256(item.bytes, {
      maximumInputBytes: item.bytes.byteLength,
    }).pipe(Effect.mapError(cause => definitionError("resourceFailure", cause)));
    if (!bytesEqualFullScan(bodySha256, item.sha256)) {
      return yield* definitionError("authorityMismatch");
    }
    if (item.role === "runtime_projection_module") continue;
    if (singletonObjects.has(item.role)) {
      return yield* definitionError("invalidLaunchSubject");
    }
    singletonObjects.set(item.role, item.bytes);
  }
  const projectionBytes = singletonObjects.get("task_runtime_projection");
  const entryBytes = singletonObjects.get("task_runtime_entry");
  const groupBytes = singletonObjects.get("task_runtime_group_manifest");
  const specBytes = singletonObjects.get("task_runtime_materialization_spec");
  if (
    moduleBodies.length === 0 || projectionBytes === undefined ||
    entryBytes === undefined || groupBytes === undefined || specBytes === undefined ||
    singletonObjects.size !== 4
  ) return yield* definitionError("invalidLaunchSubject");

  const modules: TaskRuntimeProjectionModuleFrameV1[] = [];
  for (const item of moduleBodies) {
    modules.push(yield* Effect.fromResult(
      decodeTaskRuntimeProjectionModulePreimageV1(item.bytes).pipe(
        Result.mapError(cause => definitionError("invalidRuntimeObject", cause)),
      ),
    ));
  }
  const projection = yield* Effect.fromResult(
    decodeTaskRuntimeProjectionPreimageV1(projectionBytes).pipe(
      Result.mapError(cause => definitionError("invalidRuntimeObject", cause)),
    ),
  );
  const verifiedProjection = yield* verifyTaskRuntimeProjectionV1(
    projection,
    modules,
    sha256,
  ).pipe(Effect.mapError(cause => definitionError(
    cause._tag === "StandardApplicationTaskSha256ResourceV1Error"
      ? "resourceFailure"
      : "authorityMismatch",
    cause,
  )));
  const entry = yield* Effect.fromResult(
    decodeTaskRuntimeEntryPreimageV1(entryBytes).pipe(
      Result.mapError(cause => definitionError("invalidRuntimeObject", cause)),
    ),
  );
  const group = yield* Effect.fromResult(
    decodeTaskRuntimeGroupManifestPreimageV1(groupBytes).pipe(
      Result.mapError(cause => definitionError("invalidRuntimeObject", cause)),
    ),
  );
  const spec = yield* Effect.fromResult(
    decodeTaskRuntimeMaterializationSpecPreimageV1(specBytes).pipe(
      Result.mapError(cause => definitionError("invalidRuntimeObject", cause)),
    ),
  );
  const [manifestSha256, embeddedEntrySha256, entrySha256, groupSha256, specSha256] =
    yield* Effect.all([
    hashCanonicalTaskManifestV1(binding.manifest, sha256),
    hashTaskRuntimeEntryFrameV1(binding.taskRuntimeEntry, sha256),
    hashTaskRuntimeEntryFrameV1(entry, sha256),
    hashTaskRuntimeGroupManifestFrameV1(group, sha256),
    hashTaskRuntimeMaterializationSpecV1(spec, sha256),
  ], { concurrency: 1 }).pipe(Effect.mapError(cause => definitionError(
    cause._tag === "StandardApplicationTaskSha256ResourceV1Error"
      ? "resourceFailure"
      : "authorityMismatch",
    cause,
  )));
  if (
    binding.taskId !== binding.manifest.taskId ||
    !bytesEqualFullScan(manifestSha256, binding.canonicalTaskManifestSha256) ||
    !bytesEqualFullScan(embeddedEntrySha256, binding.taskRuntimeEntrySha256) ||
    entry.taskId !== binding.taskId || entry.exportName !== binding.manifest.handler.exportName ||
    entry.artifactExecutionModule !== binding.manifest.handler.artifactModulePath ||
    entry.logicalExecutionModule !== binding.manifest.handler.logicalModulePath ||
    projection.executionModule !== entry.artifactExecutionModule ||
    !bytesEqualFullScan(entry.canonicalTaskManifestSha256, binding.canonicalTaskManifestSha256) ||
    !bytesEqualFullScan(entry.projectionSha256, binding.taskRuntimeProjectionSha256) ||
    !bytesEqualFullScan(entrySha256, binding.taskRuntimeEntrySha256) ||
    !bytesEqualFullScan(verifiedProjection.projectionSha256, binding.taskRuntimeProjectionSha256) ||
    !bytesEqualFullScan(groupSha256, binding.taskRuntimeGroupManifestSha256) ||
    !bytesEqualFullScan(specSha256, binding.taskRuntimeMaterializationSpecSha256) ||
    !bytesEqualFullScan(group.taskRuntimeProjectionSha256, binding.taskRuntimeProjectionSha256) ||
    !bytesEqualFullScan(group.taskRuntimeMaterializationSpecSha256, binding.taskRuntimeMaterializationSpecSha256) ||
    !bytesEqualFullScan(group.taskCatalogSha256, binding.taskCatalogSha256) ||
    !bytesEqualFullScan(group.taskEntryRootSha256, binding.taskEntryRootSha256) ||
    group.taskCount < 1n ||
    !spec.supportedComputeProfiles.includes(binding.manifest.computeProfile)
  ) return yield* definitionError("authorityMismatch");

  if (!arraysEqual(spec.compatibilityFlags, hostPolicy.admittedCompatibilityFlags)) {
    return yield* definitionError("hostPolicyMismatch");
  }
  if (spec.compatibilityDate !== hostPolicy.admittedCompatibilityDate) {
    return yield* definitionError("hostPolicyMismatch");
  }
  if (spec.runtimeImplementationVersion !== hostPolicy.runtimeImplementationVersion) {
    return yield* definitionError("hostPolicyMismatch");
  }
  const profile = hostPolicy.computeProfiles.find(
    value => value.computeProfile === binding.manifest.computeProfile,
  );
  if (profile === undefined) return yield* definitionError("unsupportedComputeProfile");
  const wallMilliseconds = binding.manifest.maximumDurationInSeconds * 1_000;
  if (!Number.isSafeInteger(wallMilliseconds) || wallMilliseconds < 1 ||
    wallMilliseconds > profile.maximumDurationMs) {
    return yield* definitionError("unsupportedDuration");
  }

  const projectedModules = yield* Effect.forEach(
    verifiedProjection.modules,
    module => Effect.try({
      try: () => Object.freeze({
        path: module.artifactModulePath,
        source: new TextDecoder("utf-8", { fatal: true }).decode(module.sourceBytes),
      }),
      catch: cause => definitionError("invalidRuntimeObject", cause),
    }),
    { concurrency: 1 },
  );
  const graph = yield* Effect.try({
    try: () => makeLegacyTaskRuntimeModuleGraph({
      projectionSha256Hex: encodeBytesToLowercaseHex(
        verifiedProjection.projectionSha256,
      ),
      modules: projectedModules,
      coreSource: APPLICATION_WORKER_CORE_SOURCE,
      executionModulePath: entry.artifactExecutionModule,
      serverExports: APPLICATION_WORKER_SERVER_EXPORTS,
      valuesExports: APPLICATION_WORKER_VALUES_EXPORTS,
      entrypointSource: imports => entrypointSource(imports.core, imports.execution, {
        taskDefinitionRevisionId: captured.taskDefinitionRevisionId,
        handlerExportName: entry.exportName,
        manifest: binding.manifest,
      }),
    }),
    catch: cause => definitionError("authorityMismatch", cause),
  });
  return Object.freeze({
    taskDefinitionRevisionId: captured.taskDefinitionRevisionId,
    computeProfile: binding.manifest.computeProfile,
    compatibilityDate: spec.compatibilityDate,
    compatibilityFlags: spec.compatibilityFlags,
    wallMilliseconds,
    limits: Object.freeze({ cpuMs: profile.cpuMilliseconds, subRequests: 0 as const }),
    mainModule: graph.mainModule,
    modules: graph.modules,
    env: Object.freeze({}),
    entrypoint: LEGACY_TASK_WORKER_ENTRYPOINT,
  }) satisfies LegacyTaskWorkerDefinition;
});

function entrypointSource(
  coreImport: string,
  executionImport: string,
  definition: Readonly<{
    readonly taskDefinitionRevisionId: string;
    readonly handlerExportName: string;
    readonly manifest: TaskRuntimeLaunchSubject["runtimeBinding"]["manifest"];
  }>,
): string {
  return [
    'import { RpcTarget, WorkerEntrypoint } from "cloudflare:workers";',
    `import { executeLegacyTaskWorkerV1, startLegacyTaskWorkerSessionV1 } from ${JSON.stringify(coreImport)};`,
    `const definition = Object.freeze(JSON.parse(${JSON.stringify(JSON.stringify(definition))}));`,
    `const loadExecution = () => import(${JSON.stringify(executionImport)});`,
    "class FlarexTaskWorkerSession extends RpcTarget {",
    "  #execution;",
    "  constructor(execution) { super(); this.#execution = execution; }",
    "  acceptance() { return this.#execution.acceptance; }",
    "  requestInterruption(request) { return this.#execution.requestInterruption(request); }",
    "  settlement() { return this.#execution.settlement(); }",
    "}",
    `export class ${LEGACY_TASK_WORKER_ENTRYPOINT} extends WorkerEntrypoint {`,
    "  async start(startRequest, capability) {",
    "    const ownedCapability = capability.dup();",
    "    const execution = await startLegacyTaskWorkerSessionV1({",
    "      startRequest, capability: ownedCapability, definition, loadExecution,",
    "    });",
    "    this.ctx.waitUntil(execution.terminal.then(() => undefined, () => undefined));",
    "    return new FlarexTaskWorkerSession(execution);",
    "  }",
    "  run(request, capability) {",
    "    return executeLegacyTaskWorkerV1({ request, capability, definition, loadExecution });",
    "  }",
    "}",
    "",
  ].join("\n");
}

function captureHostPolicy(
  input: unknown,
): Result.Result<LegacyTaskWorkerHostPolicy, LegacyTaskWorkerDefinitionError> {
  return Result.gen(function* () {
    const outer = yield* Result.try({
      try: () => {
        if (!isNonArrayRecord(input)) throw new Error("invalid host policy");
        return Object.freeze({
          runtimeImplementationVersion: input.runtimeImplementationVersion,
          admittedCompatibilityDate: input.admittedCompatibilityDate,
          computeProfiles: input.computeProfiles,
          admittedCompatibilityFlags: input.admittedCompatibilityFlags,
        });
      },
      catch: cause => definitionError("hostPolicyMismatch", cause),
    });
    return yield* Result.try({
      try: () => {
        const profileValues = captureDenseDataArray(
          outer.computeProfiles,
          MAX_TASK_RUNTIME_COMPUTE_PROFILES_V1,
        );
        const flagValues = captureDenseDataArray(
          outer.admittedCompatibilityFlags,
          MAX_TASK_RUNTIME_COMPATIBILITY_FLAGS_V1,
        );
        if (typeof outer.runtimeImplementationVersion !== "string" ||
          outer.runtimeImplementationVersion.length === 0 ||
          typeof outer.admittedCompatibilityDate !== "string" ||
          outer.admittedCompatibilityDate.length === 0 ||
          profileValues === undefined || flagValues === undefined) {
          throw new Error("invalid host policy");
        }
        const profiles: LegacyTaskWorkerComputeProfilePolicy[] =
          profileValues.map(value => {
          if (!isNonArrayRecord(value)) throw new Error("invalid compute profile");
          const computeProfile = value.computeProfile;
          const cpuMilliseconds = value.cpuMilliseconds;
          const maximumDurationMs = value.maximumDurationMs;
          if (typeof computeProfile !== "string" || computeProfile.length === 0 ||
            typeof cpuMilliseconds !== "number" ||
            !Number.isSafeInteger(cpuMilliseconds) || cpuMilliseconds < 1 ||
            typeof maximumDurationMs !== "number" ||
            !Number.isSafeInteger(maximumDurationMs) || maximumDurationMs < 1) {
            throw new Error("invalid compute profile");
          }
          return Object.freeze({
            computeProfile,
            cpuMilliseconds,
            maximumDurationMs,
          });
        });
        if (new Set(profiles.map(value => value.computeProfile)).size !==
          profiles.length) throw new Error("duplicate compute profile");
        const flags = flagValues.map(value => {
        if (typeof value !== "string" || value.length === 0) {
          throw new Error("invalid compatibility flag");
        }
        return value;
      });
        return Object.freeze({
          runtimeImplementationVersion: outer.runtimeImplementationVersion,
          admittedCompatibilityDate: outer.admittedCompatibilityDate,
          computeProfiles: Object.freeze(profiles),
          admittedCompatibilityFlags: Object.freeze(flags),
        });
      },
      catch: cause => definitionError("hostPolicyMismatch", cause),
    });
  });
}

function captureDenseDataArray(
  input: unknown,
  maximumLength: number,
): ReadonlyArray<unknown> | undefined {
  try {
    if (!Array.isArray(input)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(input, "length");
    if (descriptor === undefined || "get" in descriptor ||
      typeof descriptor.value !== "number" ||
      descriptor.value > maximumLength) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== descriptor.value + 1) return undefined;
    const values: unknown[] = [];
    for (let index = 0; index < descriptor.value; index += 1) {
      const item = Object.getOwnPropertyDescriptor(input, String(index));
      if (item === undefined || "get" in item || item.enumerable !== true) {
        return undefined;
      }
      values.push(item.value);
    }
    return Object.freeze(values);
  } catch {
    return undefined;
  }
}

function arraysEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function definitionError(
  reason: LegacyTaskWorkerDefinitionError["reason"],
  cause?: unknown,
): LegacyTaskWorkerDefinitionError {
  return new LegacyTaskWorkerDefinitionError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
