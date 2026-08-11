import {
  MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  type CanonicalTaskManifestV1,
  type TaskDefinitionSha256V1,
  type TaskIdV1,
} from "../taskDefinition/Model.js";

export const APPLICATION_TASK_CATALOG_BINDING_CODEC_V1 =
  "flarex.standard-application/application-task-catalog-binding/v1" as const;
export const APPLICATION_TASK_DEFINITION_BINDING_CODEC_V1 =
  "flarex.standard-application/application-task-definition-binding/v1" as const;
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
