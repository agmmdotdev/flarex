import type { TaskComputeProfileRefV1 } from
  "@flarex/durable-task/internal/run-attempt-v1";
import { Data } from "effect";
import type { CanonicalJsonEncodingInvariantIssue } from "flarex-protocol/json";

import type {
  InvalidStandardApplicationTaskDefinitionV1Error,
  StandardApplicationTaskSha256V1Error,
} from "./Errors.js";
import {
  TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  TASK_RUNTIME_CONTRACT_IDENTITY_V1,
  TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  TASK_RUNTIME_PROFILE_IDENTITY_V1,
  type HashedCanonicalTaskCatalogV1,
  type TaskDefinitionSha256V1,
  type TaskRuntimeMaterializationSpecV1,
  type TaskRuntimeObjectReferenceV1,
} from "./Model.js";
import type { InvalidTaskRuntimePublicationV1Error } from
  "./RuntimePublicationErrors.js";

export type TaskRuntimeReadinessOperationV1 =
  | "verify_readiness"
  | "encode_readiness_basis"
  | "decode_readiness_basis"
  | "hash_readiness_basis";

export type TaskRuntimeReadinessReasonV1 =
  | "invalid_input"
  | "invalid_receipt"
  | "receipt_digest_mismatch"
  | "authoritative_evidence_mismatch"
  | "runtime_object_mismatch"
  | "runtime_object_invalid"
  | "runtime_root_mismatch"
  | "runtime_policy_unsupported"
  | "invalid_basis"
  | "noncanonical_preimage"
  | "canonical_bytes_exceeded";

export class InvalidTaskRuntimeReadinessV1Error<
  Operation extends TaskRuntimeReadinessOperationV1 =
    TaskRuntimeReadinessOperationV1,
> extends Data.TaggedError("InvalidTaskRuntimeReadinessV1Error")<{
  readonly operation: Operation;
  readonly reason: TaskRuntimeReadinessReasonV1;
  readonly path?: string;
  readonly observed?: number;
  readonly maximum?: number;
  readonly cause?:
    | InvalidTaskRuntimePublicationV1Error
    | InvalidStandardApplicationTaskDefinitionV1Error;
}> {}

export class TaskRuntimeReadinessCanonicalEncodingV1Defect
  extends Data.TaggedError("TaskRuntimeReadinessCanonicalEncodingV1Defect")<{
    readonly operation: "encode_readiness_basis" | "decode_readiness_basis";
    readonly issue: CanonicalJsonEncodingInvariantIssue;
  }> {}

export interface TaskRuntimeReadinessExpectedEvidence {
  readonly scopeId: string;
  readonly candidateId: string;
  readonly applicationRevisionId: string;
  readonly candidateSha256: TaskDefinitionSha256V1;
  readonly taskCatalogBindingSha256: TaskDefinitionSha256V1;
  readonly taskCatalog: HashedCanonicalTaskCatalogV1;
  readonly packageSha256: Uint8Array;
  readonly artifactSha256: Uint8Array;
  readonly sourceRootSha256: Uint8Array;
  readonly semanticRootSha256: Uint8Array;
  readonly materializationPolicy: TaskRuntimeMaterializationSpecV1;
}

export interface TaskRuntimeReadinessObject {
  readonly reference: TaskRuntimeObjectReferenceV1;
  readonly canonicalBytes: Uint8Array;
}

export interface TaskRuntimeReadinessVerificationInput {
  readonly receiptCanonicalBytes: Uint8Array;
  readonly receiptSha256: TaskDefinitionSha256V1;
  readonly expected: TaskRuntimeReadinessExpectedEvidence;
  readonly runtimeObjects: ReadonlyArray<TaskRuntimeReadinessObject>;
}

export interface TaskRuntimeReadinessBasisV1 {
  readonly version: 1;
  readonly kind: "empty" | "populated";
  readonly scopeId: string;
  readonly candidateId: string;
  readonly applicationRevisionId: string;
  readonly publicationReceiptSha256: TaskDefinitionSha256V1;
  readonly candidateSha256: TaskDefinitionSha256V1;
  readonly taskCatalogBindingSha256: TaskDefinitionSha256V1;
  readonly applicationRevisionTaskBindingSha256: TaskDefinitionSha256V1;
  readonly taskCatalogSha256: TaskDefinitionSha256V1;
  readonly taskCount: bigint;
  readonly taskEntryRootSha256: TaskDefinitionSha256V1;
  readonly taskRuntimeProjectionSha256: TaskDefinitionSha256V1 | null;
  readonly taskRuntimeGroupManifestSha256: TaskDefinitionSha256V1 | null;
  readonly taskRuntimeMaterializationSpecSha256:
    TaskDefinitionSha256V1 | null;
  readonly packageSha256: TaskDefinitionSha256V1;
  readonly artifactSha256: TaskDefinitionSha256V1;
  readonly sourceRootSha256: TaskDefinitionSha256V1;
  readonly semanticRootSha256: TaskDefinitionSha256V1;
  readonly runtimeContractIdentity: typeof TASK_RUNTIME_CONTRACT_IDENTITY_V1;
  readonly bridgeAbiIdentity: typeof TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1;
  readonly compatibilityDate: string;
  readonly compatibilityFlags: ReadonlyArray<string>;
  readonly runtimeProfileIdentity: typeof TASK_RUNTIME_PROFILE_IDENTITY_V1;
  readonly runtimeImplementationVersion: string;
  readonly supportedComputeProfiles: ReadonlyArray<TaskComputeProfileRefV1>;
  readonly moduleEntryPolicyIdentity:
    typeof TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1;
  readonly objectCount: bigint;
  readonly canonicalObjectByteLength: bigint;
}

export interface PreparedTaskRuntimeReadinessBasisV1 {
  readonly version: 1;
  readonly readBasis: () => TaskRuntimeReadinessBasisV1;
  readonly readCanonicalBytes: () => Uint8Array;
  readonly readSha256: () => TaskDefinitionSha256V1;
}

export type VerifyTaskRuntimeReadinessError =
  | InvalidTaskRuntimeReadinessV1Error<"verify_readiness">
  | StandardApplicationTaskSha256V1Error;

export function invalidTaskRuntimeReadiness<
  Operation extends TaskRuntimeReadinessOperationV1,
>(
  operation: Operation,
  reason: TaskRuntimeReadinessReasonV1,
  path?: string,
  cause?:
    | InvalidTaskRuntimePublicationV1Error
    | InvalidStandardApplicationTaskDefinitionV1Error,
  observed?: number,
  maximum?: number,
): InvalidTaskRuntimeReadinessV1Error<Operation> {
  return new InvalidTaskRuntimeReadinessV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(cause === undefined ? {} : { cause }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}
