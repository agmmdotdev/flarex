import {
  bytesEqualFullScan,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result } from "effect";
import {
  decodeApplicationTaskRuntimeTargetV1,
  hashApplicationTaskRuntimeTargetV1,
  type ApplicationTaskRuntimeTargetV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import {
  decodeCanonicalTaskManifestV1,
  hashCanonicalTaskManifestV1,
  MAX_TASK_RUNTIME_COMPUTE_PROFILES_V1,
  type CanonicalTaskManifestV1,
  type StandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";

import type { ApplicationAnalysisSourceBundle } from
  "../sourceArtifactV2/ApplicationAnalysisReader";
import {
  APPLICATION_WORKER_CORE_SOURCE,
  APPLICATION_WORKER_SERVER_EXPORTS,
  APPLICATION_WORKER_VALUES_EXPORTS,
} from "./ApplicationWorkerCore.generated";
import { makeApplicationRuntimeModuleGraph } from
  "./ApplicationRuntimeModuleGraph";

export const APPLICATION_TASK_WORKER_ENTRYPOINT =
  "FlarexApplicationTaskWorker" as const;

export interface ApplicationTaskWorkerComputeProfilePolicy {
  readonly computeProfile: string;
  readonly cpuMilliseconds: number;
  readonly maximumDurationMs: number;
}

export interface ApplicationTaskWorkerHostPolicy {
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly computeProfiles: ReadonlyArray<
    ApplicationTaskWorkerComputeProfilePolicy
  >;
}

export class ApplicationTaskWorkerDefinitionError extends Data.TaggedError(
  "ApplicationTaskWorkerDefinitionError",
)<{
  readonly reason:
    | "invalidTarget"
    | "invalidManifest"
    | "invalidDigest"
    | "authorityMismatch"
    | "hostPolicyMismatch"
    | "unsupportedComputeProfile"
    | "unsupportedDuration"
    | "resourceFailure";
  readonly cause?: unknown;
}> {}

export interface ApplicationTaskWorkerDefinition {
  readonly runtimeTargetSha256Hex: string;
  readonly computeProfile: string;
  readonly compatibilityDate: string;
  readonly wallMilliseconds: number;
  readonly limits: Readonly<{ readonly cpuMs: number; readonly subRequests: 0 }>;
  readonly mainModule: string;
  readonly modules: Readonly<Record<string, WorkerLoaderModule | string>>;
  readonly env: Readonly<Record<PropertyKey, never>>;
  readonly entrypoint: typeof APPLICATION_TASK_WORKER_ENTRYPOINT;
}

export const makeApplicationTaskWorkerDefinition = Effect.fn(
  "ApplicationTaskWorkerDefinition.make",
)(function* (input: {
  readonly source: ApplicationAnalysisSourceBundle;
  readonly target: unknown;
  readonly runtimeTargetSha256: Uint8Array;
  readonly manifest: unknown;
  readonly hostPolicy: ApplicationTaskWorkerHostPolicy;
  readonly sha256: StandardApplicationTaskSha256V1;
}) {
  const captured = yield* Effect.fromResult(Result.gen(function* () {
    const direct = yield* Result.try({
      try: () => Object.freeze({
        source: snapshotSource(input.source),
        target: input.target,
        runtimeTargetSha256: new Uint8Array(input.runtimeTargetSha256),
        manifest: input.manifest,
        hostPolicy: input.hostPolicy,
        sha256: input.sha256,
      }),
      catch: cause => definitionError("invalidTarget", cause),
    });
    const hostPolicy = yield* captureHostPolicy(direct.hostPolicy);
    return Object.freeze({ ...direct, hostPolicy });
  }));
  const target = yield* Effect.fromResult(
    decodeApplicationTaskRuntimeTargetV1(captured.target).pipe(
      Result.mapError(cause => definitionError("invalidTarget", cause)),
    ),
  );
  const manifest = yield* Effect.fromResult(
    decodeCanonicalTaskManifestV1(captured.manifest).pipe(
      Result.mapError(cause => definitionError("invalidManifest", cause)),
    ),
  );
  if (!isUint8ArrayWithByteLength(captured.runtimeTargetSha256, 32)) {
    return yield* definitionError("invalidDigest");
  }
  const runtimeTargetSha256 = captured.runtimeTargetSha256;
  const hostPolicy = captured.hostPolicy;
  const expectedManifestSha256 = yield* hashCanonicalTaskManifestV1(
    manifest,
    captured.sha256,
  ).pipe(Effect.mapError(cause => definitionError(
    cause._tag === "StandardApplicationTaskSha256ResourceV1Error"
      ? "resourceFailure"
      : "invalidManifest",
    cause,
  )));
  const expectedRuntimeTargetSha256 = yield* hashApplicationTaskRuntimeTargetV1(
    target,
    captured.sha256,
  ).pipe(Effect.mapError(cause => definitionError(
    cause._tag === "StandardApplicationTaskSha256ResourceV1Error"
      ? "resourceFailure"
      : "invalidTarget",
    cause,
  )));
  if (
    !bytesEqualFullScan(
      expectedManifestSha256,
      target.canonicalTaskManifestSha256,
    ) ||
    !bytesEqualFullScan(
      expectedRuntimeTargetSha256,
      runtimeTargetSha256,
    )
  ) return yield* definitionError("authorityMismatch");
  if (!authorityMatches(captured.source, target, manifest)) {
    return yield* definitionError("authorityMismatch");
  }
  if (
    target.runtimeHostIdentity !== hostPolicy.runtimeHostIdentity ||
    target.compatibilityDate !== hostPolicy.compatibilityDate
  ) return yield* definitionError("hostPolicyMismatch");
  const profile = yield* Effect.fromResult(selectComputeProfile(
    hostPolicy.computeProfiles,
    manifest.computeProfile,
  ));
  const manifestDurationMs = manifest.maximumDurationInSeconds * 1_000;
  if (
    !Number.isSafeInteger(manifestDurationMs) || manifestDurationMs < 1 ||
    manifestDurationMs > profile.maximumDurationMs
  ) return yield* definitionError("unsupportedDuration");

  const runtimeTargetSha256Hex = hex(runtimeTargetSha256);
  const embedded = Object.freeze({
    handlerExportName: target.handler.exportName,
    manifest,
    runtimeTargetSha256Hex,
  });
  const graph = yield* Effect.try({
    try: () => makeApplicationRuntimeModuleGraph({
      source: captured.source,
      coreSource: APPLICATION_WORKER_CORE_SOURCE,
      executionModulePath: target.handler.sourceModulePath,
      serverExports: APPLICATION_WORKER_SERVER_EXPORTS,
      valuesExports: APPLICATION_WORKER_VALUES_EXPORTS,
      entrypointSource: imports => entrypointSource(
        imports.core,
        imports.execution,
        embedded,
      ),
    }),
    catch: cause => definitionError("authorityMismatch", cause),
  });
  return Object.freeze({
    runtimeTargetSha256Hex,
    computeProfile: profile.computeProfile,
    compatibilityDate: target.compatibilityDate,
    wallMilliseconds: manifestDurationMs,
    limits: Object.freeze({
      cpuMs: profile.cpuMilliseconds,
      subRequests: 0 as const,
    }),
    mainModule: graph.mainModule,
    modules: graph.modules,
    env: Object.freeze({}),
    entrypoint: APPLICATION_TASK_WORKER_ENTRYPOINT,
  }) satisfies ApplicationTaskWorkerDefinition;
});

function authorityMatches(
  source: ApplicationAnalysisSourceBundle,
  target: ApplicationTaskRuntimeTargetV1,
  manifest: CanonicalTaskManifestV1,
): boolean {
  const module = source.modules.find(candidate =>
    candidate.path === target.handler.sourceModulePath
  );
  return !(
    source.sourceArtifact.rootSha256 !== target.sourceArtifactRootSha256 ||
    module === undefined ||
    target.taskId !== manifest.taskId ||
    target.handler.logicalModulePath !== manifest.handler.logicalModulePath ||
    target.handler.sourceModulePath !== manifest.handler.artifactModulePath ||
    target.handler.exportName !== manifest.handler.exportName
  );
}

function selectComputeProfile(
  profiles: ReadonlyArray<ApplicationTaskWorkerComputeProfilePolicy>,
  selected: string,
): Result.Result<
  ApplicationTaskWorkerComputeProfilePolicy,
  ApplicationTaskWorkerDefinitionError
> {
  let match: ApplicationTaskWorkerComputeProfilePolicy | undefined;
  const observed = new Set<string>();
  for (const profile of profiles) {
    if (
      profile.computeProfile.length === 0 ||
      !Number.isSafeInteger(profile.cpuMilliseconds) ||
      profile.cpuMilliseconds < 1 ||
      !Number.isSafeInteger(profile.maximumDurationMs) ||
      profile.maximumDurationMs < 1 ||
      observed.has(profile.computeProfile)
    ) return Result.fail(definitionError("unsupportedComputeProfile"));
    observed.add(profile.computeProfile);
    if (profile.computeProfile === selected) match = profile;
  }
  if (match === undefined) {
    return Result.fail(definitionError("unsupportedComputeProfile"));
  }
  return Result.succeed(Object.freeze({ ...match }));
}

function captureHostPolicy(
  policy: unknown,
): Result.Result<ApplicationTaskWorkerHostPolicy, ApplicationTaskWorkerDefinitionError> {
  return Result.gen(function* () {
    const outer = yield* Result.try({
      try: () => {
        if (!isNonArrayRecord(policy)) throw new Error("Invalid host policy.");
        return Object.freeze({
          runtimeHostIdentity: policy.runtimeHostIdentity,
          compatibilityDate: policy.compatibilityDate,
          computeProfiles: policy.computeProfiles,
        });
      },
      catch: cause => definitionError("hostPolicyMismatch", cause),
    });
    const capturedProfiles = captureDenseDataArray(outer.computeProfiles);
    if (
      typeof outer.runtimeHostIdentity !== "string" ||
      outer.runtimeHostIdentity.length === 0 ||
      typeof outer.compatibilityDate !== "string" ||
      outer.compatibilityDate.length === 0 ||
      capturedProfiles === undefined
    ) return yield* Result.fail(definitionError("hostPolicyMismatch"));
    const profiles: ApplicationTaskWorkerComputeProfilePolicy[] = [];
    for (let index = 0; index < capturedProfiles.length; index += 1) {
      const value = capturedProfiles[index];
      const profile = yield* Result.try({
        try: () => {
          if (!isNonArrayRecord(value)) {
            throw new Error("Invalid compute profile policy.");
          }
          return Object.freeze({
            computeProfile: value.computeProfile,
            cpuMilliseconds: value.cpuMilliseconds,
            maximumDurationMs: value.maximumDurationMs,
          });
        },
        catch: cause => definitionError("unsupportedComputeProfile", cause),
      });
      if (
        typeof profile.computeProfile !== "string" ||
        profile.computeProfile.length === 0 ||
        typeof profile.cpuMilliseconds !== "number" ||
        !Number.isSafeInteger(profile.cpuMilliseconds) ||
        profile.cpuMilliseconds < 1 ||
        typeof profile.maximumDurationMs !== "number" ||
        !Number.isSafeInteger(profile.maximumDurationMs) ||
        profile.maximumDurationMs < 1
      ) return yield* Result.fail(definitionError("unsupportedComputeProfile"));
      profiles.push(profile as ApplicationTaskWorkerComputeProfilePolicy);
    }
    return Object.freeze({
      runtimeHostIdentity: outer.runtimeHostIdentity,
      compatibilityDate: outer.compatibilityDate,
      computeProfiles: Object.freeze(profiles),
    });
  });
}

function captureDenseDataArray(input: unknown): ReadonlyArray<unknown> | undefined {
  try {
    if (!Array.isArray(input)) return undefined;
    const length = Reflect.getOwnPropertyDescriptor(input, "length");
    if (
      length === undefined || !("value" in length) ||
      typeof length.value !== "number" || !Number.isSafeInteger(length.value) ||
      length.value < 0 || length.value > MAX_TASK_RUNTIME_COMPUTE_PROFILES_V1
    ) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== length.value + 1 || !keys.includes("length")) {
      return undefined;
    }
    const captured: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const key = String(index);
      if (!keys.includes(key)) return undefined;
      const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined || !("value" in descriptor) ||
        !descriptor.enumerable
      ) return undefined;
      captured.push(descriptor.value);
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

function snapshotSource(
  source: ApplicationAnalysisSourceBundle,
): ApplicationAnalysisSourceBundle {
  return Object.freeze({
    sourceArtifact: Object.freeze({
      rootSha256: source.sourceArtifact.rootSha256,
      executionModulePath: source.sourceArtifact.executionModulePath,
      schemaModulePath: source.sourceArtifact.schemaModulePath,
      modules: Object.freeze(source.sourceArtifact.modules.map(module =>
        Object.freeze({
          path: module.path,
          roles: module.roles,
          sourceSha256: module.sourceSha256,
          sourceByteLength: module.sourceByteLength,
        })
      )),
    }),
    modules: Object.freeze(source.modules.map(module => Object.freeze({
      path: module.path,
      roles: module.roles,
      sourceSha256: module.sourceSha256,
      sourceByteLength: module.sourceByteLength,
      source: module.source,
    }))),
  });
}

function entrypointSource(
  coreImport: string,
  executionImport: string,
  definition: Readonly<{
    readonly handlerExportName: string;
    readonly manifest: CanonicalTaskManifestV1;
    readonly runtimeTargetSha256Hex: string;
  }>,
): string {
  return [
    'import { RpcTarget, WorkerEntrypoint } from "cloudflare:workers";',
    `import { executeApplicationTaskWorkerV1, startApplicationTaskWorkerSessionV1 } from ${JSON.stringify(coreImport)};`,
    `const definition = Object.freeze(JSON.parse(${JSON.stringify(
      JSON.stringify(definition),
    )}));`,
    `const loadExecution = () => import(${JSON.stringify(executionImport)});`,
    "class FlarexTaskWorkerSession extends RpcTarget {",
    "  #execution;",
    "  constructor(execution) { super(); this.#execution = execution; }",
    "  acceptance() { return this.#execution.acceptance; }",
    "  requestInterruption(request) { return this.#execution.requestInterruption(request); }",
    "  settlement() { return this.#execution.settlement(); }",
    "}",
    `export class ${APPLICATION_TASK_WORKER_ENTRYPOINT} extends WorkerEntrypoint {`,
    "  async start(startRequest, capability, queryCapability) {",
    "    const ownedCapability = capability.dup();",
    "    let ownedQueryCapability;",
    "    try { ownedQueryCapability = queryCapability.dup(); }",
    "    catch (queryCapabilityFailure) {",
    "      try { ownedCapability[Symbol.dispose](); }",
    "      catch (inputCapabilityCleanupFailure) {",
    "        throw new Error('Application Task capability duplication cleanup failed.', {",
    "          cause: Object.freeze({ queryCapabilityFailure, inputCapabilityCleanupFailure }),",
    "        });",
    "      }",
    "      throw queryCapabilityFailure;",
    "    }",
    "    const execution = await startApplicationTaskWorkerSessionV1({",
    "      startRequest, capability: ownedCapability, queryCapability: ownedQueryCapability, definition, loadExecution,",
    "    });",
    "    this.ctx.waitUntil(execution.terminal.then(() => undefined, () => undefined));",
    "    return new FlarexTaskWorkerSession(execution);",
    "  }",
    "  run(request, capability, queryCapability) {",
    "    return executeApplicationTaskWorkerV1({",
    "      request, capability, queryCapability, definition, loadExecution,",
    "    });",
    "  }",
    "}",
    "",
  ].join("\n");
}

function definitionError(
  reason: ApplicationTaskWorkerDefinitionError["reason"],
  cause?: unknown,
): ApplicationTaskWorkerDefinitionError {
  return new ApplicationTaskWorkerDefinitionError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function hex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}
