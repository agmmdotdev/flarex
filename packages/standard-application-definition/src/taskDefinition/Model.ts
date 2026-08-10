import type {
  RunAttemptPolicyV1,
  TaskComputeProfileRefV1,
  TaskDefinitionRevisionIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import type { Brand } from "effect";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";

export const CANONICAL_TASK_MANIFEST_CODEC_V1 =
  "flarex.standard-application/task-manifest/v1" as const;
export const CANONICAL_TASK_CATALOG_CODEC_V1 =
  "flarex.standard-application/task-catalog/v1" as const;
export const TASK_RUNTIME_ENTRY_CODEC_V1 =
  "flarex.standard-application/task-runtime-entry/v1" as const;
export const APPLICATION_REVISION_TASK_BINDING_CODEC_V1 =
  "flarex.standard-application/application-revision-task-binding/v1" as const;
export const TASK_DEFINITION_RUNTIME_BINDING_CODEC_V1 =
  "flarex.standard-application/task-definition-runtime-binding/v1" as const;
export const TASK_RUN_CREATION_AUTHORITY_RECEIPT_CODEC_V1 =
  "flarex.standard-application/task-run-creation-authority/v1" as const;
export const TASK_RUNTIME_OBJECT_STORE_V1 =
  "flarex.r2/standard-application-task-runtime/v1" as const;

export const MAX_TASK_ID_UTF8_BYTES_V1 = 255;
export const MAX_TASK_CATALOG_ENTRIES_V1 = 4_096;
export const MAX_TASK_CATALOG_VALIDATOR_NODES_V1 = 65_536;
export const MAX_TASK_HANDLER_FIELD_UTF8_BYTES_V1 = 1_024;
export const MAX_TASK_RUNTIME_OBJECT_REFERENCES_V1 = 4_096;
export const MAX_TASK_DEFINITION_CANONICAL_BYTES_V1 = 16 * 1_024 * 1_024;
export const MAX_TASK_DURATION_SECONDS_V1 = Math.floor(
  Number.MAX_SAFE_INTEGER / 1_000,
);

export type TaskIdV1 = Brand.Branded<
  string,
  "FlarexStandardApplication/TaskIdV1"
>;
export type TaskDefinitionSha256V1 = Brand.Branded<
  Uint8Array,
  "FlarexStandardApplication/TaskDefinitionSha256V1"
>;

export interface CanonicalTaskHandlerBindingV1 {
  readonly logicalModulePath: string;
  readonly artifactModulePath: string;
  readonly exportName: string;
}

export interface CanonicalTaskManifestV1 {
  readonly version: 1;
  readonly taskId: TaskIdV1;
  readonly handler: CanonicalTaskHandlerBindingV1;
  readonly payloadValidator: ValidatorJsonV1;
  readonly outputValidator: ValidatorJsonV1 | null;
  readonly runAttemptPolicy: RunAttemptPolicyV1;
  readonly maximumDurationInSeconds: number;
  readonly computeProfile: TaskComputeProfileRefV1;
  readonly queue: { readonly kind: "default" };
}

export interface CanonicalTaskCatalogV1 {
  readonly version: 1;
  readonly tasks: ReadonlyArray<CanonicalTaskManifestV1>;
}

export interface HashedCanonicalTaskCatalogEntryV1 {
  readonly taskId: TaskIdV1;
  readonly manifest: CanonicalTaskManifestV1;
  readonly canonicalTaskManifestSha256: TaskDefinitionSha256V1;
}

export interface HashedCanonicalTaskCatalogV1 {
  readonly version: 1;
  readonly entries: ReadonlyArray<HashedCanonicalTaskCatalogEntryV1>;
  readonly taskCatalogSha256: TaskDefinitionSha256V1;
}

export interface TaskRuntimeEntryFrameV1 {
  readonly kind: "task_runtime_entry";
  readonly taskOrdinal: bigint;
  readonly taskId: TaskIdV1;
  readonly canonicalTaskManifestSha256: TaskDefinitionSha256V1;
  readonly logicalExecutionModule: string;
  readonly artifactExecutionModule: string;
  readonly exportName: string;
  readonly group: "durable_task";
  readonly projectionSha256: TaskDefinitionSha256V1;
}

export interface ApplicationRevisionTaskBindingFrameV1 {
  readonly kind: "application_revision_task_binding";
  readonly candidateSha256: TaskDefinitionSha256V1;
  readonly taskCatalogSha256: TaskDefinitionSha256V1;
  readonly taskCount: bigint;
  readonly taskEntryRootSha256: TaskDefinitionSha256V1;
  readonly taskRuntimeProjectionSha256: TaskDefinitionSha256V1 | null;
  readonly taskRuntimeGroupManifestSha256: TaskDefinitionSha256V1 | null;
  readonly taskRuntimeMaterializationSpecSha256:
    TaskDefinitionSha256V1 | null;
}

export type TaskRuntimeObjectRoleV1 =
  | "runtime_projection_module"
  | "task_runtime_projection"
  | "task_runtime_entry"
  | "task_runtime_group_manifest"
  | "task_runtime_materialization_spec";

export interface TaskRuntimeObjectReferenceV1 {
  readonly storeIdentity: typeof TASK_RUNTIME_OBJECT_STORE_V1;
  readonly role: TaskRuntimeObjectRoleV1;
  readonly objectKey: string;
  readonly byteLength: bigint;
  readonly sha256: TaskDefinitionSha256V1;
}

/**
 * Durable immutable evidence needed to identify one runtime binding. The full
 * manifest remains owned by the later artifact/runtime reconstruction boundary.
 */
export interface TaskDefinitionRuntimeBindingCommitmentV1 {
  readonly version: 1;
  readonly applicationRevisionId: string;
  readonly candidateSha256: TaskDefinitionSha256V1;
  readonly applicationRevisionTaskBindingSha256: TaskDefinitionSha256V1;
  readonly taskId: TaskIdV1;
  readonly canonicalTaskManifestSha256: TaskDefinitionSha256V1;
  readonly taskRuntimeEntrySha256: TaskDefinitionSha256V1;
  readonly taskRuntimeEntry: TaskRuntimeEntryFrameV1;
  readonly taskCatalogSha256: TaskDefinitionSha256V1;
  readonly taskEntryRootSha256: TaskDefinitionSha256V1;
  readonly taskRuntimeProjectionSha256: TaskDefinitionSha256V1;
  readonly taskRuntimeGroupManifestSha256: TaskDefinitionSha256V1;
  readonly taskRuntimeMaterializationSpecSha256: TaskDefinitionSha256V1;
  readonly packageSha256: TaskDefinitionSha256V1;
  readonly artifactSha256: TaskDefinitionSha256V1;
  readonly sourceRootSha256: TaskDefinitionSha256V1;
  readonly semanticRootSha256: TaskDefinitionSha256V1;
  readonly runtimeObjects: ReadonlyArray<TaskRuntimeObjectReferenceV1>;
}

export interface TaskDefinitionRuntimeBindingV1
  extends TaskDefinitionRuntimeBindingCommitmentV1 {
  readonly manifest: CanonicalTaskManifestV1;
}

export interface TaskRunCreationAuthorityReceiptV1 {
  readonly version: 1;
  readonly applicationRevisionId: string;
  readonly activationRevision: bigint;
  readonly activationHeadSha256: TaskDefinitionSha256V1;
  readonly readinessReceiptSha256: TaskDefinitionSha256V1;
  readonly candidateSha256: TaskDefinitionSha256V1;
  readonly applicationRevisionTaskBindingSha256: TaskDefinitionSha256V1;
  readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
}

export function taskRuntimeObjectKeyV1(
  role: TaskRuntimeObjectRoleV1,
  lowercaseSha256: string,
): string {
  return `standard-application-task-runtime/v1/${role}/${lowercaseSha256}`;
}
