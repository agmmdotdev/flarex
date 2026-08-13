import {
  MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  type CanonicalTaskManifestV1,
  type TaskDefinitionSha256V1,
  type TaskIdV1,
} from "../taskDefinition/Model.js";
export { MAX_APPLICATION_RUNTIME_HOST_IDENTITY_CODE_UNITS_V1 } from
  "flarex-protocol/internal/application-runtime-cold-receipt-v1";

export const APPLICATION_TASK_CATALOG_BINDING_CODEC_V1 =
  "flarex.standard-application/application-task-catalog-binding/v1" as const;
export const APPLICATION_TASK_DEFINITION_BINDING_CODEC_V1 =
  "flarex.standard-application/application-task-definition-binding/v1" as const;
export const APPLICATION_TASK_RUNTIME_TARGET_CODEC_V1 =
  "flarex.standard-application/application-task-runtime-target/v1" as const;
export const APPLICATION_TASK_RUN_CREATION_AUTHORITY_CODEC_V1 =
  "flarex.standard-application/application-task-run-creation-authority/v1" as const;
export const MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1 = 16 * 1_024 * 1_024;
/** Bounds one catalog header plus all retained definition and manifest frames. */
export const MAX_APPLICATION_TASK_BINDING_EVIDENCE_BYTES_V1 =
  2 * MAX_TASK_DEFINITION_CANONICAL_BYTES_V1;

export interface ApplicationTaskBindingAuthorityV1 {
  readonly scopeId: string;
  readonly revisionId: string;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly publicationSha256: string;
  readonly sourceArtifactRootSha256: string;
}

export interface ApplicationTaskRuntimeHostPolicyV1 {
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
}

export interface ApplicationTaskCatalogBindingV1
  extends ApplicationTaskBindingAuthorityV1,
    ApplicationTaskRuntimeHostPolicyV1 {
  readonly version: 1;
  readonly taskCatalogSha256: TaskDefinitionSha256V1;
  readonly taskCount: number;
}

export interface ApplicationTaskHandlerBindingV1 {
  readonly logicalModulePath: string;
  readonly sourceModulePath: string;
  readonly exportName: string;
}

export interface ApplicationTaskDefinitionBindingV1 {
  readonly version: 1;
  readonly applicationTaskCatalogBindingSha256: TaskDefinitionSha256V1;
  readonly taskId: TaskIdV1;
  readonly canonicalTaskManifestSha256: TaskDefinitionSha256V1;
  readonly handler: ApplicationTaskHandlerBindingV1;
}

/**
 * Immutable executable identity for one Application task. Active readiness and
 * head authority intentionally remain in the issuer-backed selection.
 */
export interface ApplicationTaskRuntimeTargetV1 {
  readonly version: 1;
  readonly scopeId: string;
  readonly revisionId: string;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly sourceArtifactRootSha256: string;
  readonly publicationSha256: string;
  readonly applicationTaskCatalogBindingSha256: TaskDefinitionSha256V1;
  readonly applicationTaskDefinitionBindingSha256: TaskDefinitionSha256V1;
  readonly taskCatalogSha256: TaskDefinitionSha256V1;
  readonly taskId: TaskIdV1;
  readonly canonicalTaskManifestSha256: TaskDefinitionSha256V1;
  readonly handler: ApplicationTaskHandlerBindingV1;
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
}

export interface ApplicationTaskRunCreationAuthorityV1 {
  readonly version: 1;
  readonly scopeId: string;
  readonly activationSequence: bigint;
  readonly activeHeadSha256: TaskDefinitionSha256V1;
  readonly readinessSha256: TaskDefinitionSha256V1;
  readonly runtimeTarget: ApplicationTaskRuntimeTargetV1;
  readonly applicationTaskRuntimeTargetSha256: TaskDefinitionSha256V1;
}

export interface PreparedApplicationTaskCatalogBindingV1 {
  readonly binding: ApplicationTaskCatalogBindingV1;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: TaskDefinitionSha256V1;
}

export interface PreparedApplicationTaskDefinitionBindingV1 {
  readonly binding: ApplicationTaskDefinitionBindingV1;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: TaskDefinitionSha256V1;
  readonly manifest: CanonicalTaskManifestV1;
  readonly canonicalManifestBytes: Uint8Array;
}

export interface PreparedApplicationTaskBindingsV1 {
  readonly catalog: PreparedApplicationTaskCatalogBindingV1;
  readonly definitions: ReadonlyArray<PreparedApplicationTaskDefinitionBindingV1>;
}
