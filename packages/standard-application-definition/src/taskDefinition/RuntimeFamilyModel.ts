import type { TaskComputeProfileRefV1 } from
  "@flarex/durable-task/internal/run-attempt-v1";
import type { SourceArtifactV2ModuleRolesV1 } from
  "flarex-protocol/internal/declarative-v2-source-artifact-v2";

import {
  TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  TASK_RUNTIME_CONTRACT_IDENTITY_V1,
  TASK_RUNTIME_PROFILE_IDENTITY_V1,
  type CanonicalTaskHandlerBindingV1,
  type CanonicalTaskManifestV1,
  type TaskDefinitionSha256V1,
} from "./Model.js";

export const TASK_RUNTIME_COMPUTE_PROFILE_CATALOG_CODEC_V1 =
  "flarex.standard-application/task-runtime-compute-profile-catalog/v1" as const;
export const NODE_TASK_RUNTIME_ARTIFACT_CODEC_V1 =
  "flarex.standard-application/node-task-runtime-artifact/v1" as const;
export const NODE_TASK_RUNTIME_ARTIFACT_STORE_V1 =
  "flarex.r2/standard-application-node-task-runtime/v1" as const;
export const NODE_TASK_RUNTIME_BUNDLE_CODEC_V1 =
  "flarex.standard-application/node-task-bundle/v1" as const;
export const NODE_TASK_RUNTIME_DEPENDENCY_PACKAGE_CODEC_V1 =
  "flarex.standard-application/node-task-dependency-package/v1" as const;
export const NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1 =
  "flarex.node-task-executor/bridge/v1" as const;
export const NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1 =
  "flarex.node/task-runtime/v1" as const;
export const NODE_TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1 =
  "flarex.node-task-runtime/module-entry/exact-artifact-path/v1" as const;
export const ISOLATE_TASK_COMPUTE_PROVIDER_IDENTITY_V1 =
  "flarex.worker-loader/task-compute-provider" as const;
export const NODE_TASK_COMPUTE_PROVIDER_IDENTITY_V1 =
  "flarex.node/task-compute-provider" as const;

export const MAX_NODE_TASK_RUNTIME_ARTIFACT_MODULES_V1 = 4_096;
export const MAX_NODE_TASK_RUNTIME_ARTIFACT_OBJECT_BYTES_V1 =
  256 * 1_024 * 1_024;

export type TaskRuntimeFamilyV1 = "isolate" | "node";

export interface TaskRuntimeCapabilityPolicyV1 {
  readonly outbound: "denied";
  readonly filesystem: "none";
  readonly nativeModules: "denied";
  readonly environmentVariables: "platform_only";
  readonly secrets: "denied";
  readonly childProcesses: "denied";
}

interface TaskRuntimeComputeProfilePolicyBaseV1 {
  readonly computeProfile: TaskComputeProfileRefV1;
  readonly runtimeContractIdentity: typeof TASK_RUNTIME_CONTRACT_IDENTITY_V1;
  readonly resourceClassIdentity: string;
  readonly maximumDurationInSeconds: number;
  readonly capabilities: TaskRuntimeCapabilityPolicyV1;
}

export interface IsolateTaskRuntimeComputeProfilePolicyV1
  extends TaskRuntimeComputeProfilePolicyBaseV1 {
  readonly runtimeFamily: "isolate";
  readonly bridgeAbiIdentity: typeof TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1;
  readonly runtimeProfileIdentity: typeof TASK_RUNTIME_PROFILE_IDENTITY_V1;
  readonly provider: {
    readonly state: "enabled";
    readonly providerIdentity: typeof ISOLATE_TASK_COMPUTE_PROVIDER_IDENTITY_V1;
    readonly placement: "cloudflare_worker";
  };
}

export interface NodeTaskRuntimeComputeProfilePolicyV1
  extends TaskRuntimeComputeProfilePolicyBaseV1 {
  readonly runtimeFamily: "node";
  readonly bridgeAbiIdentity: typeof NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1;
  readonly runtimeProfileIdentity: typeof NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1;
  readonly provider: {
    readonly state: "disabled";
    readonly providerIdentity: typeof NODE_TASK_COMPUTE_PROVIDER_IDENTITY_V1;
    readonly placement: "unconfigured";
  };
}

export type TaskRuntimeComputeProfilePolicyV1 =
  | IsolateTaskRuntimeComputeProfilePolicyV1
  | NodeTaskRuntimeComputeProfilePolicyV1;

export interface TaskRuntimeComputeProfileCatalogV1 {
  readonly version: 1;
  readonly profiles: ReadonlyArray<TaskRuntimeComputeProfilePolicyV1>;
}

export type NodeTaskRuntimeArtifactObjectKindV1 =
  | "node_bundle"
  | "node_dependency_package";

export type NodeTaskRuntimeArtifactObjectCodecV1 =
  | typeof NODE_TASK_RUNTIME_BUNDLE_CODEC_V1
  | typeof NODE_TASK_RUNTIME_DEPENDENCY_PACKAGE_CODEC_V1;

interface NodeTaskRuntimeArtifactObjectReferenceBaseV1 {
  readonly storeIdentity: typeof NODE_TASK_RUNTIME_ARTIFACT_STORE_V1;
  readonly objectKey: string;
  readonly byteLength: bigint;
  readonly sha256: TaskDefinitionSha256V1;
}

export type NodeTaskRuntimeArtifactObjectReferenceV1 =
  NodeTaskRuntimeArtifactObjectReferenceBaseV1 & (
    | {
      readonly kind: "node_bundle";
      readonly codecIdentity: typeof NODE_TASK_RUNTIME_BUNDLE_CODEC_V1;
    }
    | {
      readonly kind: "node_dependency_package";
      readonly codecIdentity:
        typeof NODE_TASK_RUNTIME_DEPENDENCY_PACKAGE_CODEC_V1;
    }
  );

export interface NodeTaskRuntimeArtifactModuleV1 {
  readonly moduleOrdinal: bigint;
  readonly artifactModulePath: string;
  readonly sourceRoles: SourceArtifactV2ModuleRolesV1;
  readonly rawByteLength: bigint;
  readonly sourceSha256: TaskDefinitionSha256V1;
}

export interface NodeTaskRuntimeArtifactV1 {
  readonly version: 1;
  readonly kind: "node_task_runtime_artifact";
  readonly runtimeFamily: "node";
  readonly runtimeContractIdentity: typeof TASK_RUNTIME_CONTRACT_IDENTITY_V1;
  readonly bridgeAbiIdentity: typeof NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1;
  readonly runtimeProfileIdentity: typeof NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1;
  readonly moduleEntryPolicyIdentity:
    typeof NODE_TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1;
  readonly nodeRuntimeAbiIdentity: string;
  readonly moduleFormat: "es_module";
  readonly architecturePolicy: "portable_javascript";
  readonly nativeModules: "denied";
  readonly applicationRevisionId: string;
  readonly candidateSha256: TaskDefinitionSha256V1;
  readonly taskId: CanonicalTaskManifestV1["taskId"];
  readonly canonicalTaskManifestSha256: TaskDefinitionSha256V1;
  readonly computeProfileCatalogSha256: TaskDefinitionSha256V1;
  readonly handler: CanonicalTaskHandlerBindingV1;
  readonly executionModule: string;
  readonly modules: ReadonlyArray<NodeTaskRuntimeArtifactModuleV1>;
  readonly bundle: NodeTaskRuntimeArtifactObjectReferenceV1;
  readonly dependencies: NodeTaskRuntimeArtifactObjectReferenceV1 | null;
  readonly supportedComputeProfiles: ReadonlyArray<TaskComputeProfileRefV1>;
}

interface TaskRuntimeFamilyAdmissionBaseV1 {
  readonly runtimeContractIdentity: typeof TASK_RUNTIME_CONTRACT_IDENTITY_V1;
  readonly initialComputeProfile: TaskComputeProfileRefV1;
  readonly reachableComputeProfiles: ReadonlyArray<TaskComputeProfileRefV1>;
  readonly maximumDurationInSeconds: number;
}

export type TaskRuntimeFamilyAdmissionV1 = TaskRuntimeFamilyAdmissionBaseV1 & (
  | {
    readonly runtimeFamily: "isolate";
    readonly bridgeAbiIdentity: typeof TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1;
    readonly runtimeProfileIdentity: typeof TASK_RUNTIME_PROFILE_IDENTITY_V1;
  }
  | {
    readonly runtimeFamily: "node";
    readonly bridgeAbiIdentity: typeof NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1;
    readonly runtimeProfileIdentity: typeof NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1;
  }
);

export interface AdmittedNodeTaskRuntimeArtifactV1 {
  readonly readArtifact: () => NodeTaskRuntimeArtifactV1;
  readonly nodeTaskRuntimeArtifactSha256Hex: string;
  readonly computeProfileCatalogSha256Hex: string;
  readonly dispatchReadiness: "blocked_provider_disabled";
  readonly admission: Extract<TaskRuntimeFamilyAdmissionV1, {
    readonly runtimeFamily: "node";
  }>;
}

export interface NodeTaskRuntimeArtifactAdmissionInputV1 {
  readonly applicationRevisionId: unknown;
  readonly candidateSha256: unknown;
  readonly manifest: unknown;
  readonly artifact: unknown;
  readonly computeProfileCatalog: unknown;
}
