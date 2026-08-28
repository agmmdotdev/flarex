import {
  TaskComputeProfileRefV1Schema,
  type TaskComputeProfileRefV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { Result, Schema } from "effect";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  isSourceArtifactV2ModuleRolesV1,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";

import { decodeTaskIdV1 } from "./Schema.js";
import {
  InvalidTaskRuntimeFamilyV1Error,
  type TaskRuntimeFamilyFailureReasonV1,
  type TaskRuntimeFamilyOperationV1,
} from "./RuntimeFamilyErrors.js";
import {
  MAX_NODE_TASK_RUNTIME_ARTIFACT_MODULES_V1,
  MAX_NODE_TASK_RUNTIME_ARTIFACT_OBJECT_BYTES_V1,
  ISOLATE_TASK_COMPUTE_PROVIDER_IDENTITY_V1,
  NODE_TASK_RUNTIME_ARTIFACT_STORE_V1,
  NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  NODE_TASK_RUNTIME_BUNDLE_CODEC_V1,
  NODE_TASK_RUNTIME_DEPENDENCY_PACKAGE_CODEC_V1,
  NODE_TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  NODE_TASK_COMPUTE_PROVIDER_IDENTITY_V1,
  NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1,
  type NodeTaskRuntimeArtifactModuleV1,
  type NodeTaskRuntimeArtifactObjectKindV1,
  type NodeTaskRuntimeArtifactObjectReferenceV1,
  type NodeTaskRuntimeArtifactV1,
  type TaskRuntimeCapabilityPolicyV1,
  type TaskRuntimeComputeProfileCatalogV1,
  type TaskRuntimeComputeProfilePolicyV1,
} from "./RuntimeFamilyModel.js";
import {
  MAX_TASK_DURATION_SECONDS_V1,
  MAX_TASK_RUNTIME_COMPUTE_PROFILES_V1,
  MAX_TASK_RUNTIME_MODULE_SOURCE_BYTES_V1,
  MAX_TASK_RUNTIME_PROJECTION_RAW_BYTES_V1,
  MAX_TASK_RUNTIME_PUBLICATION_TEXT_UTF8_BYTES_V1,
  TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  TASK_RUNTIME_CONTRACT_IDENTITY_V1,
  TASK_RUNTIME_PROFILE_IDENTITY_V1,
  TASK_RUNTIME_RESERVED_MODULE_PATH_PREFIX_V1,
  type TaskDefinitionSha256V1,
} from "./Model.js";

const STRICT_PARSE_OPTIONS = { onExcessProperty: "error" } as const;
const UTF8 = new TextEncoder();
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const decodeComputeProfile = Schema.decodeUnknownResult(
  TaskComputeProfileRefV1Schema,
  STRICT_PARSE_OPTIONS,
);

export function decodeTaskRuntimeComputeProfileCatalogV1(
  input: unknown,
): Result.Result<
  TaskRuntimeComputeProfileCatalogV1,
  InvalidTaskRuntimeFamilyV1Error<"decode_compute_profile_catalog">
> {
  const operation = "decode_compute_profile_catalog" as const;
  const outer = captureExactDataRecord(input, ["version", "profiles"]);
  if (outer === undefined || outer.version !== 1) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  const values = captureDenseArray(
    outer.profiles,
    MAX_TASK_RUNTIME_COMPUTE_PROFILES_V1,
  );
  if (values === undefined || values.length === 0) {
    return Result.fail(invalid(operation, "invalid_compute_profile", "profiles"));
  }
  return Result.gen(function* () {
    const profiles: TaskRuntimeComputeProfilePolicyV1[] = [];
    let previous: string | undefined;
    for (let index = 0; index < values.length; index += 1) {
      const profile = yield* decodeRuntimeProfile(
        values[index],
        operation,
        `profiles[${index}]`,
      );
      if (previous !== undefined) {
        const order = compareTaskRuntimeFamilyUtf8V1(previous, profile.computeProfile);
        if (order === 0) {
          return yield* Result.fail(invalid(
            operation,
            "duplicate_compute_profile",
            `profiles[${index}].computeProfile`,
          ));
        }
        if (order > 0) {
          return yield* Result.fail(invalid(
            operation,
            "unordered_compute_profiles",
            `profiles[${index}].computeProfile`,
          ));
        }
      }
      previous = profile.computeProfile;
      profiles.push(profile);
    }
    return Object.freeze({ version: 1 as const, profiles: Object.freeze(profiles) });
  });
}

export function decodeNodeTaskRuntimeArtifactV1(
  input: unknown,
): Result.Result<
  NodeTaskRuntimeArtifactV1,
  InvalidTaskRuntimeFamilyV1Error<"decode_node_artifact">
> {
  const operation = "decode_node_artifact" as const;
  const outer = captureExactDataRecord(input, [
    "version",
    "kind",
    "runtimeFamily",
    "runtimeContractIdentity",
    "bridgeAbiIdentity",
    "runtimeProfileIdentity",
    "moduleEntryPolicyIdentity",
    "nodeRuntimeAbiIdentity",
    "moduleFormat",
    "architecturePolicy",
    "nativeModules",
    "applicationRevisionId",
    "candidateSha256",
    "taskId",
    "canonicalTaskManifestSha256",
    "computeProfileCatalogSha256",
    "handler",
    "executionModule",
    "modules",
    "bundle",
    "dependencies",
    "supportedComputeProfiles",
  ]);
  if (
    outer === undefined || outer.version !== 1 ||
    outer.kind !== "node_task_runtime_artifact" ||
    outer.runtimeFamily !== "node"
  ) return Result.fail(invalid(operation, "invalid_shape"));
  if (
    outer.runtimeContractIdentity !== TASK_RUNTIME_CONTRACT_IDENTITY_V1 ||
    outer.bridgeAbiIdentity !== NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1 ||
    outer.runtimeProfileIdentity !== NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1 ||
    outer.moduleEntryPolicyIdentity !==
      NODE_TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1
  ) return Result.fail(invalid(operation, "invalid_runtime_contract"));
  if (
    outer.moduleFormat !== "es_module" ||
    outer.architecturePolicy !== "portable_javascript" ||
    outer.nativeModules !== "denied"
  ) return Result.fail(invalid(operation, "invalid_runtime_contract"));

  return Result.gen(function* () {
    const nodeRuntimeAbiIdentity = yield* decodeText(
      outer.nodeRuntimeAbiIdentity,
      operation,
      "nodeRuntimeAbiIdentity",
    );
    const applicationRevisionId = yield* decodeText(
      outer.applicationRevisionId,
      operation,
      "applicationRevisionId",
    );
    const candidateSha256 = yield* decodeDigest(
      outer.candidateSha256,
      operation,
      "candidateSha256",
    );
    const taskId = yield* decodeTaskIdV1(outer.taskId).pipe(
      Result.mapError(() => invalid(operation, "invalid_text", "taskId")),
    );
    const canonicalTaskManifestSha256 = yield* decodeDigest(
      outer.canonicalTaskManifestSha256,
      operation,
      "canonicalTaskManifestSha256",
    );
    const computeProfileCatalogSha256 = yield* decodeDigest(
      outer.computeProfileCatalogSha256,
      operation,
      "computeProfileCatalogSha256",
    );
    const handler = yield* decodeHandler(outer.handler, operation);
    const executionModule = yield* decodeModulePath(
      outer.executionModule,
      operation,
      "executionModule",
    );
    const modules = yield* decodeModules(outer.modules, operation);
    const bundle = yield* decodeArtifactReference(
      outer.bundle,
      "node_bundle",
      operation,
      "bundle",
    );
    const dependencies = outer.dependencies === null
      ? null
      : yield* decodeArtifactReference(
        outer.dependencies,
        "node_dependency_package",
        operation,
        "dependencies",
      );
    const supportedComputeProfiles = yield* decodeComputeProfiles(
      outer.supportedComputeProfiles,
      operation,
      "supportedComputeProfiles",
    );
    const execution = modules.find(
      module => module.artifactModulePath === executionModule,
    );
    if (
      execution === undefined ||
      (execution.sourceRoles & SOURCE_ARTIFACT_V2_ROLE_EXECUTION) === 0
    ) {
      return yield* Result.fail(invalid(
        operation,
        "missing_execution_module",
        "executionModule",
      ));
    }
    const handlerModule = modules.find(
      module => module.artifactModulePath === handler.artifactModulePath,
    );
    if (
      handlerModule === undefined ||
      (handlerModule.sourceRoles & SOURCE_ARTIFACT_V2_ROLE_FUNCTION) === 0
    ) {
      return yield* Result.fail(invalid(
        operation,
        "missing_handler_module",
        "handler.artifactModulePath",
      ));
    }
    return Object.freeze({
      version: 1 as const,
      kind: "node_task_runtime_artifact" as const,
      runtimeFamily: "node" as const,
      runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
      bridgeAbiIdentity: NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
      runtimeProfileIdentity: NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1,
      moduleEntryPolicyIdentity:
        NODE_TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
      nodeRuntimeAbiIdentity,
      moduleFormat: "es_module" as const,
      architecturePolicy: "portable_javascript" as const,
      nativeModules: "denied" as const,
      applicationRevisionId,
      candidateSha256,
      taskId,
      canonicalTaskManifestSha256,
      computeProfileCatalogSha256,
      handler,
      executionModule,
      modules,
      bundle,
      dependencies,
      supportedComputeProfiles,
    });
  });
}

function decodeRuntimeProfile<Operation extends TaskRuntimeFamilyOperationV1>(
  input: unknown,
  operation: Operation,
  path: string,
): Result.Result<
  TaskRuntimeComputeProfilePolicyV1,
  InvalidTaskRuntimeFamilyV1Error<Operation>
> {
  const outer = captureExactDataRecord(input, [
    "computeProfile",
    "runtimeFamily",
    "runtimeContractIdentity",
    "bridgeAbiIdentity",
    "runtimeProfileIdentity",
    "resourceClassIdentity",
    "maximumDurationInSeconds",
    "capabilities",
    "provider",
  ]);
  if (outer === undefined) {
    return Result.fail(invalid(operation, "invalid_shape", path));
  }
  return Result.gen(function* () {
    const computeProfile = yield* decodeComputeProfile(outer.computeProfile).pipe(
      Result.mapError(() => invalid(
        operation,
        "invalid_compute_profile",
        `${path}.computeProfile`,
      )),
      Result.filterOrFail(
        value => validText(value),
        () => invalid(
          operation,
          "invalid_compute_profile",
          `${path}.computeProfile`,
        ),
      ),
    );
    if (
      outer.runtimeContractIdentity !== TASK_RUNTIME_CONTRACT_IDENTITY_V1 ||
      (outer.runtimeFamily !== "isolate" && outer.runtimeFamily !== "node")
    ) return yield* Result.fail(invalid(
      operation,
      outer.runtimeFamily === "isolate" || outer.runtimeFamily === "node"
        ? "invalid_runtime_contract"
        : "invalid_runtime_family",
      `${path}.runtimeFamily`,
    ));
    const expectedBridge = outer.runtimeFamily === "isolate"
      ? TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1
      : NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1;
    const expectedProfile = outer.runtimeFamily === "isolate"
      ? TASK_RUNTIME_PROFILE_IDENTITY_V1
      : NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1;
    if (
      outer.bridgeAbiIdentity !== expectedBridge ||
      outer.runtimeProfileIdentity !== expectedProfile
    ) return yield* Result.fail(invalid(
      operation,
      "invalid_runtime_contract",
      `${path}.runtimeIdentity`,
    ));
    const resourceClassIdentity = yield* decodeText(
      outer.resourceClassIdentity,
      operation,
      `${path}.resourceClassIdentity`,
    );
    if (
      typeof outer.maximumDurationInSeconds !== "number" ||
      !Number.isSafeInteger(outer.maximumDurationInSeconds) ||
      outer.maximumDurationInSeconds < 1 ||
      outer.maximumDurationInSeconds > MAX_TASK_DURATION_SECONDS_V1
    ) return yield* Result.fail(invalid(
      operation,
      "invalid_number",
      `${path}.maximumDurationInSeconds`,
    ));
    const capabilities = yield* decodeCapabilityPolicy(
      outer.capabilities,
      operation,
      `${path}.capabilities`,
    );
    const provider = yield* decodeProviderPolicy(
      outer.provider,
      outer.runtimeFamily,
      operation,
      `${path}.provider`,
    );
    return outer.runtimeFamily === "isolate"
      ? Object.freeze({
        computeProfile,
        runtimeFamily: "isolate" as const,
        runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
        bridgeAbiIdentity: TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
        runtimeProfileIdentity: TASK_RUNTIME_PROFILE_IDENTITY_V1,
        resourceClassIdentity,
        maximumDurationInSeconds: outer.maximumDurationInSeconds,
        capabilities,
        provider: provider.isolate,
      })
      : Object.freeze({
        computeProfile,
        runtimeFamily: "node" as const,
        runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
        bridgeAbiIdentity: NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
        runtimeProfileIdentity: NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1,
        resourceClassIdentity,
        maximumDurationInSeconds: outer.maximumDurationInSeconds,
        capabilities,
        provider: provider.node,
      });
  });
}

function decodeProviderPolicy<Operation extends TaskRuntimeFamilyOperationV1>(
  input: unknown,
  runtimeFamily: "isolate" | "node",
  operation: Operation,
  path: string,
): Result.Result<{
  readonly isolate: {
    readonly state: "enabled";
    readonly providerIdentity: typeof ISOLATE_TASK_COMPUTE_PROVIDER_IDENTITY_V1;
    readonly placement: "cloudflare_worker";
  };
  readonly node: {
    readonly state: "disabled";
    readonly providerIdentity: typeof NODE_TASK_COMPUTE_PROVIDER_IDENTITY_V1;
    readonly placement: "unconfigured";
  };
}, InvalidTaskRuntimeFamilyV1Error<Operation>> {
  const outer = captureExactDataRecord(input, [
    "state",
    "providerIdentity",
    "placement",
  ]);
  const isolate = Object.freeze({
    state: "enabled" as const,
    providerIdentity: ISOLATE_TASK_COMPUTE_PROVIDER_IDENTITY_V1,
    placement: "cloudflare_worker" as const,
  });
  const node = Object.freeze({
    state: "disabled" as const,
    providerIdentity: NODE_TASK_COMPUTE_PROVIDER_IDENTITY_V1,
    placement: "unconfigured" as const,
  });
  const expected = runtimeFamily === "isolate" ? isolate : node;
  return outer !== undefined && outer.state === expected.state &&
      outer.providerIdentity === expected.providerIdentity &&
      outer.placement === expected.placement
    ? Result.succeed(Object.freeze({ isolate, node }))
    : Result.fail(invalid(operation, "invalid_runtime_contract", path));
}

function decodeCapabilityPolicy<Operation extends TaskRuntimeFamilyOperationV1>(
  input: unknown,
  operation: Operation,
  path: string,
): Result.Result<
  TaskRuntimeCapabilityPolicyV1,
  InvalidTaskRuntimeFamilyV1Error<Operation>
> {
  const outer = captureExactDataRecord(input, [
    "outbound",
    "filesystem",
    "nativeModules",
    "environmentVariables",
    "secrets",
    "childProcesses",
  ]);
  if (
    outer === undefined || outer.outbound !== "denied" ||
    outer.filesystem !== "none" || outer.nativeModules !== "denied" ||
    outer.environmentVariables !== "platform_only" ||
    outer.secrets !== "denied" || outer.childProcesses !== "denied"
  ) return Result.fail(invalid(operation, "invalid_capability_policy", path));
  return Result.succeed(Object.freeze({
    outbound: "denied" as const,
    filesystem: "none" as const,
    nativeModules: "denied" as const,
    environmentVariables: "platform_only" as const,
    secrets: "denied" as const,
    childProcesses: "denied" as const,
  }));
}

function decodeHandler<Operation extends TaskRuntimeFamilyOperationV1>(
  input: unknown,
  operation: Operation,
): Result.Result<
  NodeTaskRuntimeArtifactV1["handler"],
  InvalidTaskRuntimeFamilyV1Error<Operation>
> {
  const outer = captureExactDataRecord(input, [
    "logicalModulePath",
    "artifactModulePath",
    "exportName",
  ]);
  if (outer === undefined) {
    return Result.fail(invalid(operation, "invalid_shape", "handler"));
  }
  return Result.gen(function* () {
    const logicalModulePath = yield* decodeModulePath(
      outer.logicalModulePath,
      operation,
      "handler.logicalModulePath",
    );
    const artifactModulePath = yield* decodeModulePath(
      outer.artifactModulePath,
      operation,
      "handler.artifactModulePath",
    );
    const exportName = yield* decodeText(
      outer.exportName,
      operation,
      "handler.exportName",
    );
    return Object.freeze({ logicalModulePath, artifactModulePath, exportName });
  });
}

function decodeModules<Operation extends TaskRuntimeFamilyOperationV1>(
  input: unknown,
  operation: Operation,
): Result.Result<
  ReadonlyArray<NodeTaskRuntimeArtifactModuleV1>,
  InvalidTaskRuntimeFamilyV1Error<Operation>
> {
  const values = captureDenseArray(input, MAX_NODE_TASK_RUNTIME_ARTIFACT_MODULES_V1);
  if (values === undefined || values.length === 0) {
    return Result.fail(invalid(operation, "invalid_module", "modules"));
  }
  return Result.gen(function* () {
    const modules: NodeTaskRuntimeArtifactModuleV1[] = [];
    let previous: string | undefined;
    let rawByteLength = 0;
    for (let index = 0; index < values.length; index += 1) {
      const path = `modules[${index}]`;
      const outer = captureExactDataRecord(values[index], [
        "moduleOrdinal",
        "artifactModulePath",
        "sourceRoles",
        "rawByteLength",
        "sourceSha256",
      ]);
      if (
        outer === undefined || outer.moduleOrdinal !== BigInt(index) ||
        !isSourceArtifactV2ModuleRolesV1(outer.sourceRoles) ||
        typeof outer.rawByteLength !== "bigint" || outer.rawByteLength < 1n ||
        outer.rawByteLength > BigInt(MAX_TASK_RUNTIME_MODULE_SOURCE_BYTES_V1)
      ) return yield* Result.fail(invalid(operation, "invalid_module", path));
      const artifactModulePath = yield* decodeModulePath(
        outer.artifactModulePath,
        operation,
        `${path}.artifactModulePath`,
      );
      if (previous !== undefined) {
        const order = compareTaskRuntimeFamilyUtf8V1(previous, artifactModulePath);
        if (order === 0) {
          return yield* Result.fail(invalid(
            operation,
            "duplicate_module_path",
            `${path}.artifactModulePath`,
          ));
        }
        if (order > 0) {
          return yield* Result.fail(invalid(
            operation,
            "unordered_modules",
            `${path}.artifactModulePath`,
          ));
        }
      }
      previous = artifactModulePath;
      rawByteLength += Number(outer.rawByteLength);
      if (
        !Number.isSafeInteger(rawByteLength) ||
        rawByteLength > MAX_TASK_RUNTIME_PROJECTION_RAW_BYTES_V1
      ) return yield* Result.fail(invalid(
        operation,
        "invalid_module",
        "modules.rawByteLength",
      ));
      const sourceSha256 = yield* decodeDigest(
        outer.sourceSha256,
        operation,
        `${path}.sourceSha256`,
      );
      modules.push(Object.freeze({
        moduleOrdinal: outer.moduleOrdinal,
        artifactModulePath,
        sourceRoles: outer.sourceRoles,
        rawByteLength: outer.rawByteLength,
        sourceSha256,
      }));
    }
    return Object.freeze(modules);
  });
}

function decodeArtifactReference<Operation extends TaskRuntimeFamilyOperationV1>(
  input: unknown,
  expectedKind: NodeTaskRuntimeArtifactObjectKindV1,
  operation: Operation,
  path: string,
): Result.Result<
  NodeTaskRuntimeArtifactObjectReferenceV1,
  InvalidTaskRuntimeFamilyV1Error<Operation>
> {
  const outer = captureExactDataRecord(input, [
    "storeIdentity",
    "kind",
    "codecIdentity",
    "objectKey",
    "byteLength",
    "sha256",
  ]);
  const codecIdentity = expectedKind === "node_bundle"
    ? NODE_TASK_RUNTIME_BUNDLE_CODEC_V1
    : NODE_TASK_RUNTIME_DEPENDENCY_PACKAGE_CODEC_V1;
  if (
    outer === undefined || outer.storeIdentity !== NODE_TASK_RUNTIME_ARTIFACT_STORE_V1 ||
    outer.kind !== expectedKind || outer.codecIdentity !== codecIdentity ||
    typeof outer.byteLength !== "bigint" || outer.byteLength < 1n ||
    outer.byteLength > BigInt(MAX_NODE_TASK_RUNTIME_ARTIFACT_OBJECT_BYTES_V1)
  ) return Result.fail(invalid(operation, "invalid_artifact_reference", path));
  const byteLength = outer.byteLength;
  return decodeDigest(outer.sha256, operation, `${path}.sha256`).pipe(
    Result.flatMap(sha256 => {
      const objectKey = nodeTaskRuntimeArtifactObjectKeyV1(expectedKind, sha256);
      return outer.objectKey === objectKey
        ? Result.succeed(expectedKind === "node_bundle"
          ? Object.freeze({
            storeIdentity: NODE_TASK_RUNTIME_ARTIFACT_STORE_V1,
            kind: "node_bundle" as const,
            codecIdentity: NODE_TASK_RUNTIME_BUNDLE_CODEC_V1,
            objectKey,
            byteLength,
            sha256,
          })
          : Object.freeze({
            storeIdentity: NODE_TASK_RUNTIME_ARTIFACT_STORE_V1,
            kind: "node_dependency_package" as const,
            codecIdentity: NODE_TASK_RUNTIME_DEPENDENCY_PACKAGE_CODEC_V1,
            objectKey,
            byteLength,
            sha256,
          }))
        : Result.fail(invalid(
          operation,
          "invalid_artifact_reference",
          `${path}.objectKey`,
        ));
    }),
  );
}

function decodeComputeProfiles<Operation extends TaskRuntimeFamilyOperationV1>(
  input: unknown,
  operation: Operation,
  path: string,
): Result.Result<
  ReadonlyArray<TaskComputeProfileRefV1>,
  InvalidTaskRuntimeFamilyV1Error<Operation>
> {
  const values = captureDenseArray(input, MAX_TASK_RUNTIME_COMPUTE_PROFILES_V1);
  if (values === undefined || values.length === 0) {
    return Result.fail(invalid(operation, "invalid_compute_profile", path));
  }
  return Result.gen(function* () {
    const profiles: TaskComputeProfileRefV1[] = [];
    let previous: string | undefined;
    for (let index = 0; index < values.length; index += 1) {
      const profile = yield* decodeComputeProfile(values[index]).pipe(
        Result.mapError(() => invalid(
          operation,
          "invalid_compute_profile",
          `${path}[${index}]`,
        )),
      );
      if (previous !== undefined) {
        const order = compareTaskRuntimeFamilyUtf8V1(previous, profile);
        if (order === 0) {
          return yield* Result.fail(invalid(
            operation,
            "duplicate_compute_profile",
            `${path}[${index}]`,
          ));
        }
        if (order > 0) {
          return yield* Result.fail(invalid(
            operation,
            "unordered_compute_profiles",
            `${path}[${index}]`,
          ));
        }
      }
      previous = profile;
      profiles.push(profile);
    }
    return Object.freeze(profiles);
  });
}

function decodeModulePath<Operation extends TaskRuntimeFamilyOperationV1>(
  input: unknown,
  operation: Operation,
  path: string,
): Result.Result<string, InvalidTaskRuntimeFamilyV1Error<Operation>> {
  return decodeText(input, operation, path).pipe(Result.flatMap(value => {
    const segments = value.split("/");
    return value.startsWith("/") || value.endsWith("/") || value.includes("\\") ||
        value.startsWith(TASK_RUNTIME_RESERVED_MODULE_PATH_PREFIX_V1) ||
        segments.some(segment => segment === "" || segment === "." || segment === "..")
      ? Result.fail(invalid(operation, "invalid_text", path))
      : Result.succeed(value);
  }));
}

function decodeText<Operation extends TaskRuntimeFamilyOperationV1>(
  input: unknown,
  operation: Operation,
  path: string,
): Result.Result<string, InvalidTaskRuntimeFamilyV1Error<Operation>> {
  return typeof input === "string" && validText(input)
    ? Result.succeed(input)
    : Result.fail(invalid(operation, "invalid_text", path));
}

function decodeDigest<Operation extends TaskRuntimeFamilyOperationV1>(
  input: unknown,
  operation: Operation,
  path: string,
): Result.Result<
  TaskDefinitionSha256V1,
  InvalidTaskRuntimeFamilyV1Error<Operation>
> {
  return isUint8ArrayWithByteLength(input, 32)
    ? Result.try({
      try: () => copyBytes(input) as TaskDefinitionSha256V1,
      catch: () => invalid(operation, "invalid_digest", path),
    })
    : Result.fail(invalid(operation, "invalid_digest", path));
}

export function nodeTaskRuntimeArtifactObjectKeyV1(
  kind: NodeTaskRuntimeArtifactObjectKindV1,
  digest: TaskDefinitionSha256V1,
): string {
  return `standard-application-node-task-runtime/v1/${kind}/${
    encodeBytesToLowercaseHex(digest)
  }`;
}

export function compareTaskRuntimeFamilyUtf8V1(
  left: string,
  right: string,
): number {
  const leftBytes = UTF8.encode(left);
  const rightBytes = UTF8.encode(right);
  const length = Math.min(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.byteLength - rightBytes.byteLength;
}

function validText(value: string): boolean {
  if (
    value.length === 0 || value.trimStart() !== value || value.trimEnd() !== value ||
    CONTROL_CHARACTERS.test(value) ||
    UTF8.encode(value).byteLength > MAX_TASK_RUNTIME_PUBLICATION_TEXT_UTF8_BYTES_V1
  ) return false;
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (!(second >= 0xdc00 && second <= 0xdfff)) return false;
      index += 1;
    } else if (first >= 0xdc00 && first <= 0xdfff) return false;
  }
  return true;
}

function captureExactDataRecord(
  input: unknown,
  expectedKeys: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return undefined;
    }
    const keys = Reflect.ownKeys(input);
    if (
      keys.length !== expectedKeys.length ||
      keys.some(key => typeof key !== "string" || !expectedKeys.includes(key))
    ) return undefined;
    const captured: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)
      ) return undefined;
      captured[key] = descriptor.value;
    }
    return captured;
  } catch {
    return undefined;
  }
}

function captureDenseArray(
  input: unknown,
  maximum: number,
): ReadonlyArray<unknown> | undefined {
  try {
    if (!Array.isArray(input) || input.length > maximum) return undefined;
    const values: unknown[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (
        descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)
      ) return undefined;
      values.push(descriptor.value);
    }
    return values;
  } catch {
    return undefined;
  }
}

function invalid<Operation extends TaskRuntimeFamilyOperationV1>(
  operation: Operation,
  reason: TaskRuntimeFamilyFailureReasonV1,
  path?: string,
  observed?: number,
  maximum?: number,
): InvalidTaskRuntimeFamilyV1Error<Operation> {
  return new InvalidTaskRuntimeFamilyV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}
