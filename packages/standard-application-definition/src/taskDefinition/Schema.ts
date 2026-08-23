import {
  RunAttemptPolicyV1Schema,
  TaskComputeProfileRefV1Schema,
  TaskDefinitionRevisionIdV1Schema,
  type RunAttemptPolicyV1,
  type TaskComputeProfileRefV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { Result, Schema } from "effect";
import {
  ValidatorJsonV1,
  validatorJsonAdmissionIssueV1,
  type ValidatorJsonV1 as ValidatorJsonV1Type,
} from "flarex-protocol/validator-json";

import {
  InvalidStandardApplicationTaskDefinitionV1Error,
  type StandardApplicationTaskDefinitionOperationV1,
  type StandardApplicationTaskDefinitionReasonV1,
} from "./Errors.js";
import {
  MAX_TASK_CATALOG_ENTRIES_V1,
  MAX_TASK_CATALOG_VALIDATOR_NODES_V1,
  MAX_TASK_HANDLER_FIELD_UTF8_BYTES_V1,
  MAX_TASK_ID_UTF8_BYTES_V1,
  MAX_TASK_DURATION_SECONDS_V1,
  MAX_TASK_RUNTIME_OBJECT_REFERENCES_V1,
  TASK_RUNTIME_OBJECT_STORE_V1,
  taskRuntimeObjectKeyV1,
  type ApplicationRevisionTaskBindingFrameV1,
  type CanonicalTaskCatalogV1,
  type CanonicalTaskHandlerBindingV1,
  type CanonicalTaskManifestV1,
  type TaskDefinitionRuntimeBindingCommitmentV1,
  type TaskDefinitionRuntimeBindingV1,
  type TaskDefinitionSha256V1,
  type TaskIdV1,
  type TaskRunCreationAuthorityReceiptV1,
  type TaskRuntimeEntryFrameV1,
  type TaskRuntimeObjectReferenceV1,
  type TaskRuntimeObjectRoleV1,
} from "./Model.js";

export type CanonicalTaskRunAttemptPolicyInputV1 =
  typeof RunAttemptPolicyV1Schema.Encoded;
export type CanonicalTaskComputeProfileInputV1 =
  typeof TaskComputeProfileRefV1Schema.Encoded;

const STRICT_PARSE_OPTIONS = { onExcessProperty: "error" } as const;
const UTF8 = new TextEncoder();
const POSTGRES_SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const RUNTIME_OBJECT_ROLES = [
  "runtime_projection_module",
  "task_runtime_projection",
  "task_runtime_entry",
  "task_runtime_group_manifest",
  "task_runtime_materialization_spec",
] as const satisfies ReadonlyArray<TaskRuntimeObjectRoleV1>;
const SINGLETON_RUNTIME_OBJECT_ROLES = RUNTIME_OBJECT_ROLES.slice(1);

export const TaskIdV1Schema = Schema.String.check(
  Schema.makeFilter((value) => validTaskId(value)
    ? undefined
    : "Expected a bounded exact task ID"),
).pipe(Schema.brand("FlarexStandardApplication/TaskIdV1"));

const decodeTaskId = Schema.decodeUnknownResult(
  TaskIdV1Schema,
  STRICT_PARSE_OPTIONS,
);
const decodePolicy = Schema.decodeUnknownResult(
  RunAttemptPolicyV1Schema,
  STRICT_PARSE_OPTIONS,
);
const decodeComputeProfile = Schema.decodeUnknownResult(
  TaskComputeProfileRefV1Schema,
  STRICT_PARSE_OPTIONS,
);
const decodeDefinitionRevisionId = Schema.decodeUnknownResult(
  TaskDefinitionRevisionIdV1Schema,
  STRICT_PARSE_OPTIONS,
);
const decodeValidator = Schema.decodeUnknownResult(
  ValidatorJsonV1,
  STRICT_PARSE_OPTIONS,
);

export function decodeTaskIdV1(
  input: unknown,
): Result.Result<TaskIdV1, InvalidStandardApplicationTaskDefinitionV1Error> {
  return decodeTaskId(input).pipe(
    Result.mapError(() => invalid("decode_task_id", "invalid_task_id")),
  );
}

export function decodeCanonicalTaskManifestV1(
  input: unknown,
): Result.Result<
  CanonicalTaskManifestV1,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  return decodeManifestForOperation(input, "decode_manifest");
}

export function decodeCanonicalTaskCatalogV1(
  input: unknown,
): Result.Result<
  CanonicalTaskCatalogV1,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  const outer = captureExactDataRecord(input, ["version", "tasks"]);
  if (outer === undefined || outer.version !== 1) {
    return Result.fail(invalid("decode_catalog", "invalid_shape"));
  }
  const tasks = captureDenseArray(outer.tasks, MAX_TASK_CATALOG_ENTRIES_V1);
  if (tasks === undefined) {
    return Result.fail(invalid(
      "decode_catalog",
      Array.isArray(outer.tasks) ? "too_many_tasks" : "invalid_shape",
      "tasks",
    ));
  }
  return Result.gen(function* () {
    const decoded: CanonicalTaskManifestV1[] = [];
    const seen = new Set<string>();
    let validatorNodes = 0;
    for (let index = 0; index < tasks.length; index += 1) {
      const manifest = yield* decodeManifestForOperation(
        tasks[index],
        "decode_catalog",
        `tasks[${index}]`,
      );
      validatorNodes += countValidatorNodes(manifest.payloadValidator);
      if (manifest.outputValidator !== null) {
        validatorNodes += countValidatorNodes(manifest.outputValidator);
      }
      if (validatorNodes > MAX_TASK_CATALOG_VALIDATOR_NODES_V1) {
        return yield* Result.fail(invalid(
          "decode_catalog",
          "catalog_validator_budget_exceeded",
          `tasks[${index}]`,
          validatorNodes,
          MAX_TASK_CATALOG_VALIDATOR_NODES_V1,
        ));
      }
      if (seen.has(manifest.taskId)) {
        return yield* Result.fail(invalid(
          "decode_catalog",
          "duplicate_task_id",
          `tasks[${index}].taskId`,
        ));
      }
      seen.add(manifest.taskId);
      decoded.push(manifest);
    }
    decoded.sort((left, right) => compareUtf8(left.taskId, right.taskId));
    return Object.freeze({
      version: 1,
      tasks: Object.freeze(decoded),
    });
  });
}

export function decodeTaskRuntimeEntryFrameV1(
  input: unknown,
): Result.Result<
  TaskRuntimeEntryFrameV1,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  const outer = captureExactDataRecord(input, [
    "kind",
    "taskOrdinal",
    "taskId",
    "canonicalTaskManifestSha256",
    "logicalExecutionModule",
    "artifactExecutionModule",
    "exportName",
    "group",
    "projectionSha256",
  ]);
  if (
    outer === undefined || outer.kind !== "task_runtime_entry" ||
    outer.group !== "durable_task"
  ) {
    return Result.fail(invalid("decode_runtime_entry", "invalid_shape"));
  }
  return Result.gen(function* () {
    const taskId = yield* decodeTaskIdV1(outer.taskId).pipe(
      Result.mapError(() => invalid(
        "decode_runtime_entry",
        "invalid_task_id",
        "taskId",
      )),
    );
    if (
      typeof outer.taskOrdinal !== "bigint" || outer.taskOrdinal < 0n ||
      outer.taskOrdinal >= BigInt(MAX_TASK_CATALOG_ENTRIES_V1)
    ) {
      return yield* Result.fail(invalid(
        "decode_runtime_entry",
        "invalid_ordinal",
        "taskOrdinal",
      ));
    }
    const handler = yield* decodeHandler({
      logicalModulePath: outer.logicalExecutionModule,
      artifactModulePath: outer.artifactExecutionModule,
      exportName: outer.exportName,
    }, "decode_runtime_entry", "handler");
    const manifestDigest = yield* decodeDigest(
      outer.canonicalTaskManifestSha256,
      "decode_runtime_entry",
      "canonicalTaskManifestSha256",
    );
    const projectionDigest = yield* decodeDigest(
      outer.projectionSha256,
      "decode_runtime_entry",
      "projectionSha256",
    );
    return Object.freeze({
      kind: "task_runtime_entry",
      taskOrdinal: outer.taskOrdinal,
      taskId,
      canonicalTaskManifestSha256: manifestDigest,
      logicalExecutionModule: handler.logicalModulePath,
      artifactExecutionModule: handler.artifactModulePath,
      exportName: handler.exportName,
      group: "durable_task",
      projectionSha256: projectionDigest,
    });
  });
}

export function decodeApplicationRevisionTaskBindingFrameV1(
  input: unknown,
): Result.Result<
  ApplicationRevisionTaskBindingFrameV1,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  const operation = "decode_application_revision_task_binding" as const;
  const outer = captureExactDataRecord(input, [
    "kind",
    "candidateSha256",
    "taskCatalogSha256",
    "taskCount",
    "taskEntryRootSha256",
    "taskRuntimeProjectionSha256",
    "taskRuntimeGroupManifestSha256",
    "taskRuntimeMaterializationSpecSha256",
  ]);
  if (outer === undefined || outer.kind !== "application_revision_task_binding") {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  return Result.gen(function* () {
    if (
      typeof outer.taskCount !== "bigint" || outer.taskCount < 0n ||
      outer.taskCount > BigInt(MAX_TASK_CATALOG_ENTRIES_V1)
    ) {
      return yield* Result.fail(invalid(operation, "invalid_ordinal", "taskCount"));
    }
    const candidateSha256 = yield* decodeDigest(
      outer.candidateSha256,
      operation,
      "candidateSha256",
    );
    const taskCatalogSha256 = yield* decodeDigest(
      outer.taskCatalogSha256,
      operation,
      "taskCatalogSha256",
    );
    const taskEntryRootSha256 = yield* decodeDigest(
      outer.taskEntryRootSha256,
      operation,
      "taskEntryRootSha256",
    );
    const runtimeValues = [
      outer.taskRuntimeProjectionSha256,
      outer.taskRuntimeGroupManifestSha256,
      outer.taskRuntimeMaterializationSpecSha256,
    ];
    const allNull = runtimeValues.every((value) => value === null);
    const allPresent = runtimeValues.every((value) => value !== null);
    if (
      (outer.taskCount === 0n && !allNull) ||
      (outer.taskCount > 0n && !allPresent)
    ) {
      return yield* Result.fail(invalid(operation, "inconsistent_binding"));
    }
    const runtimeDigests: Array<TaskDefinitionSha256V1 | null> = [];
    for (let index = 0; index < runtimeValues.length; index += 1) {
      const value = runtimeValues[index];
      runtimeDigests.push(value === null
        ? null
        : yield* decodeDigest(value, operation, [
          "taskRuntimeProjectionSha256",
          "taskRuntimeGroupManifestSha256",
          "taskRuntimeMaterializationSpecSha256",
        ][index] ?? "runtimeDigest"));
    }
    return Object.freeze({
      kind: "application_revision_task_binding",
      candidateSha256,
      taskCatalogSha256,
      taskCount: outer.taskCount,
      taskEntryRootSha256,
      taskRuntimeProjectionSha256: runtimeDigests[0] ?? null,
      taskRuntimeGroupManifestSha256: runtimeDigests[1] ?? null,
      taskRuntimeMaterializationSpecSha256: runtimeDigests[2] ?? null,
    });
  });
}

const TASK_RUNTIME_BINDING_COMMITMENT_KEYS_V1 = [
  "version",
  "applicationRevisionId",
  "candidateSha256",
  "applicationRevisionTaskBindingSha256",
  "taskId",
  "canonicalTaskManifestSha256",
  "taskRuntimeEntrySha256",
  "taskRuntimeEntry",
  "taskCatalogSha256",
  "taskEntryRootSha256",
  "taskRuntimeProjectionSha256",
  "taskRuntimeGroupManifestSha256",
  "taskRuntimeMaterializationSpecSha256",
  "packageSha256",
  "artifactSha256",
  "sourceRootSha256",
  "semanticRootSha256",
  "runtimeObjects",
] as const;

export function decodeTaskDefinitionRuntimeBindingCommitmentV1(
  input: unknown,
): Result.Result<
  TaskDefinitionRuntimeBindingCommitmentV1,
  InvalidStandardApplicationTaskDefinitionV1Error<
    "decode_runtime_binding_commitment"
  >
> {
  const operation = "decode_runtime_binding_commitment" as const;
  const outer = captureExactDataRecord(
    input,
    TASK_RUNTIME_BINDING_COMMITMENT_KEYS_V1,
  );
  if (outer === undefined || outer.version !== 1) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  return decodeRuntimeBindingCommitmentCapturedV1(outer, operation).pipe(
    Result.mapError((failure) => reoperation(failure, operation)),
  );
}

export function decodeTaskDefinitionRuntimeBindingV1(
  input: unknown,
): Result.Result<
  TaskDefinitionRuntimeBindingV1,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  const operation = "decode_runtime_binding" as const;
  const outer = captureExactDataRecord(input, [
    "version",
    "applicationRevisionId",
    "candidateSha256",
    "applicationRevisionTaskBindingSha256",
    "taskId",
    "manifest",
    "canonicalTaskManifestSha256",
    "taskRuntimeEntrySha256",
    "taskRuntimeEntry",
    "taskCatalogSha256",
    "taskEntryRootSha256",
    "taskRuntimeProjectionSha256",
    "taskRuntimeGroupManifestSha256",
    "taskRuntimeMaterializationSpecSha256",
    "packageSha256",
    "artifactSha256",
    "sourceRootSha256",
    "semanticRootSha256",
    "runtimeObjects",
  ]);
  if (outer === undefined || outer.version !== 1) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  return Result.gen(function* () {
    const applicationRevisionId = yield* decodeBoundedText(
      outer.applicationRevisionId,
      operation,
      "invalid_application_revision",
      "applicationRevisionId",
      MAX_TASK_HANDLER_FIELD_UTF8_BYTES_V1,
    );
    const taskId = yield* decodeTaskIdV1(outer.taskId).pipe(
      Result.mapError(() => invalid(operation, "invalid_task_id", "taskId")),
    );
    const manifest = yield* decodeManifestForOperation(
      outer.manifest,
      operation,
      "manifest",
    );
    const taskRuntimeEntry = yield* decodeRuntimeBindingTaskEntryCapturedV1(
      outer.taskRuntimeEntry,
      operation,
    );
    if (
      manifest.taskId !== taskId || taskRuntimeEntry.taskId !== taskId ||
      taskRuntimeEntry.logicalExecutionModule
        !== manifest.handler.logicalModulePath ||
      taskRuntimeEntry.artifactExecutionModule
        !== manifest.handler.artifactModulePath ||
      taskRuntimeEntry.exportName !== manifest.handler.exportName
    ) {
      return yield* Result.fail(invalid(operation, "inconsistent_binding"));
    }
    const commitment = yield* decodeRuntimeBindingCommitmentEvidenceCapturedV1(
      outer,
      operation,
      applicationRevisionId,
      taskId,
      taskRuntimeEntry,
    );
    return Object.freeze({ ...commitment, manifest });
  });
}

function decodeRuntimeBindingCommitmentCapturedV1(
  outer: Readonly<Record<string, unknown>>,
  operation: StandardApplicationTaskDefinitionOperationV1,
): Result.Result<
  TaskDefinitionRuntimeBindingCommitmentV1,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  return Result.gen(function* () {
    const applicationRevisionId = yield* decodeBoundedText(
      outer.applicationRevisionId,
      operation,
      "invalid_application_revision",
      "applicationRevisionId",
      MAX_TASK_HANDLER_FIELD_UTF8_BYTES_V1,
    );
    const taskId = yield* decodeTaskIdV1(outer.taskId).pipe(
      Result.mapError(() => invalid(operation, "invalid_task_id", "taskId")),
    );
    const taskRuntimeEntry = yield* decodeRuntimeBindingTaskEntryCapturedV1(
      outer.taskRuntimeEntry,
      operation,
    );
    if (taskRuntimeEntry.taskId !== taskId) {
      return yield* Result.fail(invalid(operation, "inconsistent_binding"));
    }
    return yield* decodeRuntimeBindingCommitmentEvidenceCapturedV1(
      outer,
      operation,
      applicationRevisionId,
      taskId,
      taskRuntimeEntry,
    );
  });
}

function decodeRuntimeBindingTaskEntryCapturedV1(
  input: unknown,
  operation: StandardApplicationTaskDefinitionOperationV1,
): Result.Result<
  TaskRuntimeEntryFrameV1,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  return decodeTaskRuntimeEntryFrameV1(input).pipe(
    Result.mapError((failure) => invalid(
      operation,
      failure.reason,
      failure.path === undefined
        ? "taskRuntimeEntry"
        : `taskRuntimeEntry.${failure.path}`,
    )),
  );
}

function decodeRuntimeBindingCommitmentEvidenceCapturedV1(
  outer: Readonly<Record<string, unknown>>,
  operation: StandardApplicationTaskDefinitionOperationV1,
  applicationRevisionId: string,
  taskId: TaskIdV1,
  taskRuntimeEntry: TaskRuntimeEntryFrameV1,
): Result.Result<
  TaskDefinitionRuntimeBindingCommitmentV1,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  return Result.gen(function* () {
    const digestFields = [
      "candidateSha256",
      "applicationRevisionTaskBindingSha256",
      "canonicalTaskManifestSha256",
      "taskRuntimeEntrySha256",
      "taskCatalogSha256",
      "taskEntryRootSha256",
      "taskRuntimeProjectionSha256",
      "taskRuntimeGroupManifestSha256",
      "taskRuntimeMaterializationSpecSha256",
      "packageSha256",
      "artifactSha256",
      "sourceRootSha256",
      "semanticRootSha256",
    ] as const;
    const digests = new Map<(typeof digestFields)[number], TaskDefinitionSha256V1>();
    for (const field of digestFields) {
      digests.set(field, yield* decodeDigest(outer[field], operation, field));
    }
    const references = yield* decodeRuntimeObjectReferences(
      outer.runtimeObjects,
      operation,
    );
    const expectedByRole = new Map<TaskRuntimeObjectRoleV1, TaskDefinitionSha256V1>([
      ["task_runtime_entry", digests.get("taskRuntimeEntrySha256")!],
      ["task_runtime_projection", digests.get("taskRuntimeProjectionSha256")!],
      ["task_runtime_group_manifest", digests.get("taskRuntimeGroupManifestSha256")!],
      ["task_runtime_materialization_spec", digests.get("taskRuntimeMaterializationSpecSha256")!],
    ]);
    for (const [role, expected] of expectedByRole) {
      const reference = references.find((candidate) => candidate.role === role);
      if (reference === undefined || !bytesEqual(reference.sha256, expected)) {
        return yield* Result.fail(invalid(
          operation,
          "inconsistent_binding",
          `runtimeObjects.${role}`,
        ));
      }
    }
    if (!bytesEqual(
      taskRuntimeEntry.canonicalTaskManifestSha256,
      digests.get("canonicalTaskManifestSha256")!,
    ) || !bytesEqual(
      taskRuntimeEntry.projectionSha256,
      digests.get("taskRuntimeProjectionSha256")!,
    )) {
      return yield* Result.fail(invalid(operation, "inconsistent_binding"));
    }
    return Object.freeze({
      version: 1,
      applicationRevisionId,
      candidateSha256: digests.get("candidateSha256")!,
      applicationRevisionTaskBindingSha256:
        digests.get("applicationRevisionTaskBindingSha256")!,
      taskId,
      canonicalTaskManifestSha256:
        digests.get("canonicalTaskManifestSha256")!,
      taskRuntimeEntrySha256: digests.get("taskRuntimeEntrySha256")!,
      taskRuntimeEntry,
      taskCatalogSha256: digests.get("taskCatalogSha256")!,
      taskEntryRootSha256: digests.get("taskEntryRootSha256")!,
      taskRuntimeProjectionSha256:
        digests.get("taskRuntimeProjectionSha256")!,
      taskRuntimeGroupManifestSha256:
        digests.get("taskRuntimeGroupManifestSha256")!,
      taskRuntimeMaterializationSpecSha256:
        digests.get("taskRuntimeMaterializationSpecSha256")!,
      packageSha256: digests.get("packageSha256")!,
      artifactSha256: digests.get("artifactSha256")!,
      sourceRootSha256: digests.get("sourceRootSha256")!,
      semanticRootSha256: digests.get("semanticRootSha256")!,
      runtimeObjects: references,
    });
  });
}

export function decodeTaskRunCreationAuthorityReceiptV1(
  input: unknown,
): Result.Result<
  TaskRunCreationAuthorityReceiptV1,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  const operation = "decode_creation_authority" as const;
  const outer = captureExactDataRecord(input, [
    "version",
    "applicationRevisionId",
    "activationRevision",
    "activationHeadSha256",
    "readinessReceiptSha256",
    "candidateSha256",
    "applicationRevisionTaskBindingSha256",
    "taskDefinitionRevisionId",
  ]);
  if (outer === undefined || outer.version !== 1) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  return Result.gen(function* () {
    const applicationRevisionId = yield* decodeBoundedText(
      outer.applicationRevisionId,
      operation,
      "invalid_application_revision",
      "applicationRevisionId",
      MAX_TASK_HANDLER_FIELD_UTF8_BYTES_V1,
    );
    if (
      typeof outer.activationRevision !== "bigint" ||
      outer.activationRevision < 1n ||
      outer.activationRevision > POSTGRES_SIGNED_BIGINT_MAX
    ) {
      return yield* Result.fail(invalid(
        operation,
        "invalid_activation_revision",
        "activationRevision",
      ));
    }
    const taskDefinitionRevisionId = yield* decodeDefinitionRevisionId(
      outer.taskDefinitionRevisionId,
    ).pipe(Result.mapError(() => invalid(
      operation,
      "invalid_shape",
      "taskDefinitionRevisionId",
    )));
    const activationHeadSha256 = yield* decodeDigest(
      outer.activationHeadSha256,
      operation,
      "activationHeadSha256",
    );
    const readinessReceiptSha256 = yield* decodeDigest(
      outer.readinessReceiptSha256,
      operation,
      "readinessReceiptSha256",
    );
    const candidateSha256 = yield* decodeDigest(
      outer.candidateSha256,
      operation,
      "candidateSha256",
    );
    const applicationRevisionTaskBindingSha256 = yield* decodeDigest(
      outer.applicationRevisionTaskBindingSha256,
      operation,
      "applicationRevisionTaskBindingSha256",
    );
    return Object.freeze({
      version: 1,
      applicationRevisionId,
      activationRevision: outer.activationRevision,
      activationHeadSha256,
      readinessReceiptSha256,
      candidateSha256,
      applicationRevisionTaskBindingSha256,
      taskDefinitionRevisionId,
    });
  });
}

function decodeManifestForOperation(
  input: unknown,
  operation: StandardApplicationTaskDefinitionOperationV1,
  pathPrefix?: string,
): Result.Result<
  CanonicalTaskManifestV1,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  const outer = captureExactDataRecord(input, [
    "version",
    "taskId",
    "handler",
    "payloadValidator",
    "outputValidator",
    "runAttemptPolicy",
    "maximumDurationInSeconds",
    "computeProfile",
    "queue",
  ]);
  if (outer === undefined || outer.version !== 1) {
    return Result.fail(invalid(operation, "invalid_shape", pathPrefix));
  }
  const path = (name: string) => pathPrefix === undefined
    ? name
    : `${pathPrefix}.${name}`;
  return Result.gen(function* () {
    const taskId = yield* decodeTaskId(outer.taskId).pipe(
      Result.mapError(() => invalid(operation, "invalid_task_id", path("taskId"))),
    );
    const handler = yield* decodeHandler(
      outer.handler,
      operation,
      path("handler"),
    );
    const payloadValidator = yield* decodeValidatorSnapshot(
      outer.payloadValidator,
      operation,
      path("payloadValidator"),
    );
    const outputValidator = outer.outputValidator === null
      ? null
      : yield* decodeValidatorSnapshot(
        outer.outputValidator,
        operation,
        path("outputValidator"),
      );
    const capturedPolicy = captureRunAttemptPolicy(outer.runAttemptPolicy);
    if (capturedPolicy === undefined) {
      return yield* Result.fail(invalid(
        operation,
        "invalid_policy",
        path("runAttemptPolicy"),
      ));
    }
    const runAttemptPolicy = yield* decodePolicy(capturedPolicy).pipe(
      Result.map(snapshotPolicy), Result.mapError(() => invalid(
      operation,
      "invalid_policy",
      path("runAttemptPolicy"),
    )));
    if (runAttemptPolicy.outOfMemory.kind !== "disabled") {
      return yield* Result.fail(invalid(
        operation,
        "invalid_policy",
        path("runAttemptPolicy.outOfMemory"),
      ));
    }
    if (
      typeof outer.maximumDurationInSeconds !== "number" ||
      !Number.isSafeInteger(outer.maximumDurationInSeconds) ||
      outer.maximumDurationInSeconds < 1 ||
      outer.maximumDurationInSeconds > MAX_TASK_DURATION_SECONDS_V1
    ) {
      return yield* Result.fail(invalid(
        operation,
        "invalid_duration",
        path("maximumDurationInSeconds"),
      ));
    }
    const computeProfile = yield* decodeComputeProfile(
      outer.computeProfile,
    ).pipe(Result.mapError(() => invalid(
      operation,
      "invalid_compute_profile",
      path("computeProfile"),
    )));
    const queue = captureExactDataRecord(outer.queue, ["kind"]);
    if (queue === undefined || queue.kind !== "default") {
      return yield* Result.fail(invalid(
        operation,
        "invalid_queue",
        path("queue"),
      ));
    }
    return Object.freeze({
      version: 1,
      taskId,
      handler,
      payloadValidator,
      outputValidator,
      runAttemptPolicy,
      maximumDurationInSeconds: outer.maximumDurationInSeconds,
      computeProfile,
      queue: Object.freeze({ kind: "default" as const }),
    });
  });
}

function decodeHandler(
  input: unknown,
  operation: StandardApplicationTaskDefinitionOperationV1,
  path: string,
): Result.Result<
  CanonicalTaskHandlerBindingV1,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  const handler = captureExactDataRecord(input, [
    "logicalModulePath",
    "artifactModulePath",
    "exportName",
  ]);
  if (handler === undefined) {
    return Result.fail(invalid(operation, "invalid_handler", path));
  }
  return Result.gen(function* () {
    const logicalModulePath = yield* decodeBoundedText(
      handler.logicalModulePath,
      operation,
      "invalid_handler",
      `${path}.logicalModulePath`,
      MAX_TASK_HANDLER_FIELD_UTF8_BYTES_V1,
    );
    const artifactModulePath = yield* decodeBoundedText(
      handler.artifactModulePath,
      operation,
      "invalid_handler",
      `${path}.artifactModulePath`,
      MAX_TASK_HANDLER_FIELD_UTF8_BYTES_V1,
    );
    const exportName = yield* decodeBoundedText(
      handler.exportName,
      operation,
      "invalid_handler",
      `${path}.exportName`,
      MAX_TASK_HANDLER_FIELD_UTF8_BYTES_V1,
    );
    return Object.freeze({ logicalModulePath, artifactModulePath, exportName });
  });
}

function decodeValidatorSnapshot(
  input: unknown,
  operation: StandardApplicationTaskDefinitionOperationV1,
  path: string,
): Result.Result<
  ValidatorJsonV1Type,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  if (validatorJsonAdmissionIssueV1(input) !== undefined) {
    return Result.fail(invalid(operation, "invalid_validator", path));
  }
  return decodeValidator(input).pipe(
    Result.map((value) => freezeValidator(structuredClone(value))),
    Result.mapError(() => invalid(operation, "invalid_validator", path)),
  );
}

function decodeRuntimeObjectReferences(
  input: unknown,
  operation: StandardApplicationTaskDefinitionOperationV1,
): Result.Result<
  ReadonlyArray<TaskRuntimeObjectReferenceV1>,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  const values = captureDenseArray(input, MAX_TASK_RUNTIME_OBJECT_REFERENCES_V1);
  if (values === undefined || values.length === 0) {
    return Result.fail(invalid(operation, "missing_runtime_object", "runtimeObjects"));
  }
  return Result.gen(function* () {
    const references: TaskRuntimeObjectReferenceV1[] = [];
    const objectKeys = new Set<string>();
    const singletonRoles = new Set<TaskRuntimeObjectRoleV1>();
    let modules = 0;
    for (let index = 0; index < values.length; index += 1) {
      const reference = yield* decodeRuntimeObjectReference(
        values[index],
        operation,
        `runtimeObjects[${index}]`,
      );
      if (objectKeys.has(reference.objectKey)) {
        return yield* Result.fail(invalid(
          operation,
          "duplicate_runtime_object",
          `runtimeObjects[${index}].objectKey`,
        ));
      }
      objectKeys.add(reference.objectKey);
      if (reference.role === "runtime_projection_module") {
        modules += 1;
      } else if (singletonRoles.has(reference.role)) {
        return yield* Result.fail(invalid(
          operation,
          "duplicate_runtime_object",
          `runtimeObjects[${index}].role`,
        ));
      } else {
        singletonRoles.add(reference.role);
      }
      references.push(reference);
    }
    if (
      modules === 0 || SINGLETON_RUNTIME_OBJECT_ROLES.some((role) =>
        !singletonRoles.has(role)
      )
    ) {
      return yield* Result.fail(invalid(
        operation,
        "missing_runtime_object",
        "runtimeObjects",
      ));
    }
    references.sort((left, right) => {
      const roleOrder = RUNTIME_OBJECT_ROLES.indexOf(left.role) -
        RUNTIME_OBJECT_ROLES.indexOf(right.role);
      return roleOrder === 0
        ? compareText(left.objectKey, right.objectKey)
        : roleOrder;
    });
    return Object.freeze(references);
  });
}

function decodeRuntimeObjectReference(
  input: unknown,
  operation: StandardApplicationTaskDefinitionOperationV1,
  path: string,
): Result.Result<
  TaskRuntimeObjectReferenceV1,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  const outer = captureExactDataRecord(input, [
    "storeIdentity",
    "role",
    "objectKey",
    "byteLength",
    "sha256",
  ]);
  if (
    outer === undefined || outer.storeIdentity !== TASK_RUNTIME_OBJECT_STORE_V1 ||
    !isRuntimeObjectRole(outer.role) ||
    typeof outer.byteLength !== "bigint" || outer.byteLength < 1n ||
    outer.byteLength > POSTGRES_SIGNED_BIGINT_MAX
  ) {
    return Result.fail(invalid(operation, "invalid_runtime_object", path));
  }
  return decodeDigest(outer.sha256, operation, `${path}.sha256`).pipe(
    Result.flatMap((sha256) => {
      const objectKey = taskRuntimeObjectKeyV1(
        outer.role as TaskRuntimeObjectRoleV1,
        encodeBytesToLowercaseHex(sha256),
      );
      return outer.objectKey === objectKey
        ? Result.succeed(Object.freeze({
          storeIdentity: TASK_RUNTIME_OBJECT_STORE_V1,
          role: outer.role as TaskRuntimeObjectRoleV1,
          objectKey,
          byteLength: outer.byteLength as bigint,
          sha256,
        }))
        : Result.fail(invalid(
          operation,
          "invalid_runtime_object",
          `${path}.objectKey`,
        ));
    }),
  );
}

function decodeDigest(
  input: unknown,
  operation: StandardApplicationTaskDefinitionOperationV1,
  path: string,
): Result.Result<
  TaskDefinitionSha256V1,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  return isUint8ArrayWithByteLength(input, 32)
    ? Result.succeed(copyBytes(input) as TaskDefinitionSha256V1)
    : Result.fail(invalid(operation, "invalid_digest", path));
}

function decodeBoundedText(
  input: unknown,
  operation: StandardApplicationTaskDefinitionOperationV1,
  reason: StandardApplicationTaskDefinitionReasonV1,
  path: string,
  maximumBytes: number,
): Result.Result<string, InvalidStandardApplicationTaskDefinitionV1Error> {
  return typeof input === "string" && validScalarText(input) &&
      input.length > 0 && UTF8.encode(input).byteLength <= maximumBytes &&
      !CONTROL_CHARACTERS.test(input) &&
      input.trimStart() === input && input.trimEnd() === input
    ? Result.succeed(input)
    : Result.fail(invalid(operation, reason, path));
}

function snapshotPolicy(policy: RunAttemptPolicyV1): RunAttemptPolicyV1 {
  return Object.freeze({
    version: 1,
    retry: Object.freeze({ ...policy.retry }),
    outOfMemory: policy.outOfMemory.kind === "disabled"
      ? Object.freeze({ kind: "disabled" as const })
      : Object.freeze({
        kind: "escalate_once" as const,
        computeProfile: policy.outOfMemory.computeProfile,
      }),
  });
}

function freezeValidator(value: ValidatorJsonV1Type): ValidatorJsonV1Type {
  switch (value.type) {
    case "array":
      return Object.freeze({ type: "array", value: freezeValidator(value.value) });
    case "object": {
      const fields: Record<string, {
        readonly fieldType: ValidatorJsonV1Type;
        readonly optional: boolean;
      }> = {};
      for (const key of Object.keys(value.value)) {
        const field = value.value[key];
        if (field !== undefined) {
          fields[key] = Object.freeze({
            fieldType: freezeValidator(field.fieldType),
            optional: field.optional,
          });
        }
      }
      return Object.freeze({ type: "object", value: Object.freeze(fields) });
    }
    case "record":
      return Object.freeze({
        type: "record",
        keys: freezeValidator(value.keys),
        values: freezeValidator(value.values),
      });
    case "union":
      return Object.freeze({
        type: "union",
        value: Object.freeze(value.value.map(freezeValidator)),
      });
    default:
      return Object.freeze({ ...value });
  }
}

function countValidatorNodes(root: ValidatorJsonV1Type): number {
  let nodes = 0;
  const pending: ValidatorJsonV1Type[] = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === undefined) break;
    nodes += 1;
    switch (value.type) {
      case "array":
        pending.push(value.value);
        break;
      case "object":
        for (const field of Object.values(value.value)) {
          pending.push(field.fieldType);
        }
        break;
      case "record":
        pending.push(value.values, value.keys);
        break;
      case "union":
        for (let index = value.value.length - 1; index >= 0; index -= 1) {
          const member = value.value[index];
          if (member !== undefined) pending.push(member);
        }
        break;
    }
  }
  return nodes;
}

function validTaskId(value: string): boolean {
  return validScalarText(value) && value.length > 0 &&
    UTF8.encode(value).byteLength <= MAX_TASK_ID_UTF8_BYTES_V1 &&
    !CONTROL_CHARACTERS.test(value) &&
    value.trimStart() === value && value.trimEnd() === value;
}

function validScalarText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (!(second >= 0xdc00 && second <= 0xdfff)) return false;
      index += 1;
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = UTF8.encode(left);
  const rightBytes = UTF8.encode(right);
  const length = Math.min(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.byteLength - rightBytes.byteLength;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
      keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
    ) {
      return undefined;
    }
    const captured: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return undefined;
      }
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
      if (descriptor === undefined || !("value" in descriptor)) return undefined;
      values.push(descriptor.value);
    }
    return values;
  } catch {
    return undefined;
  }
}

function captureRunAttemptPolicy(input: unknown): unknown | undefined {
  const policy = captureExactDataRecord(input, [
    "version",
    "retry",
    "outOfMemory",
  ]);
  if (policy === undefined) return undefined;
  const retry = captureExactDataRecord(policy.retry, [
    "maxAttempts",
    "factor",
    "minTimeoutInMs",
    "maxTimeoutInMs",
    "randomize",
  ]);
  if (retry === undefined) return undefined;
  const outOfMemory = captureExactDataRecord(policy.outOfMemory, ["kind"])
    ?? captureExactDataRecord(policy.outOfMemory, ["kind", "computeProfile"]);
  if (outOfMemory === undefined) return undefined;
  return {
    version: policy.version,
    retry: {
      maxAttempts: retry.maxAttempts,
      factor: retry.factor,
      minTimeoutInMs: retry.minTimeoutInMs,
      maxTimeoutInMs: retry.maxTimeoutInMs,
      randomize: retry.randomize,
    },
    outOfMemory: { ...outOfMemory },
  };
}

function isRuntimeObjectRole(value: unknown): value is TaskRuntimeObjectRoleV1 {
  return RUNTIME_OBJECT_ROLES.some((role) => role === value);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function invalid<Operation extends StandardApplicationTaskDefinitionOperationV1>(
  operation: Operation,
  reason: StandardApplicationTaskDefinitionReasonV1,
  path?: string,
  observed?: number,
  maximum?: number,
): InvalidStandardApplicationTaskDefinitionV1Error<Operation> {
  return new InvalidStandardApplicationTaskDefinitionV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}

function reoperation<
  Operation extends StandardApplicationTaskDefinitionOperationV1,
>(
  failure: InvalidStandardApplicationTaskDefinitionV1Error,
  operation: Operation,
): InvalidStandardApplicationTaskDefinitionV1Error<Operation> {
  return new InvalidStandardApplicationTaskDefinitionV1Error({
    operation,
    reason: failure.reason,
    ...(failure.path === undefined ? {} : { path: failure.path }),
    ...(failure.observed === undefined ? {} : { observed: failure.observed }),
    ...(failure.maximum === undefined ? {} : { maximum: failure.maximum }),
  });
}
