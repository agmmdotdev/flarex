import {
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8Array,
  isUint8ArrayWithByteLength,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import type {
  RunAttemptPolicyV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Encoding, Result } from "effect";
import {
  encodeCanonicalJson,
  isJsonObjectFromUnknown,
  type Json,
} from "flarex-protocol/json";

import {
  InvalidStandardApplicationTaskDefinitionV1Error,
  StandardApplicationTaskCanonicalEncodingV1Defect,
  type StandardApplicationTaskDefinitionOperationV1,
} from "./Errors.js";
import {
  APPLICATION_REVISION_TASK_BINDING_CODEC_V1,
  CANONICAL_TASK_CATALOG_CODEC_V1,
  CANONICAL_TASK_MANIFEST_CODEC_V1,
  MAX_TASK_CATALOG_ENTRIES_V1,
  MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  TASK_DEFINITION_RUNTIME_BINDING_CODEC_V1,
  TASK_RUN_CREATION_AUTHORITY_RECEIPT_CODEC_V1,
  TASK_RUNTIME_ENTRY_CODEC_V1,
  type CanonicalTaskManifestV1,
  type HashedCanonicalTaskCatalogV1,
  type TaskDefinitionRuntimeBindingCommitmentV1,
  type TaskDefinitionSha256V1,
  type TaskRunCreationAuthorityReceiptV1,
  type TaskRuntimeEntryFrameV1,
  type TaskRuntimeObjectReferenceV1,
} from "./Model.js";
import {
  decodeApplicationRevisionTaskBindingFrameV1,
  decodeCanonicalTaskManifestV1,
  decodeTaskDefinitionRuntimeBindingCommitmentV1,
  decodeTaskDefinitionRuntimeBindingV1,
  decodeTaskRunCreationAuthorityReceiptV1,
  decodeTaskRuntimeEntryFrameV1,
} from "./Schema.js";

const UTF8 = new TextEncoder();
const FATAL_UTF8 = new TextDecoder("utf-8", { fatal: true });

export function decodeCanonicalTaskManifestPreimageV1(
  input: unknown,
): Result.Result<
  CanonicalTaskManifestV1,
  InvalidStandardApplicationTaskDefinitionV1Error<"decode_manifest_preimage">
> {
  const operation = "decode_manifest_preimage" as const;
  const byteLength = uint8ArrayByteLength(input);
  if (
    byteLength === undefined || byteLength < 1 ||
    byteLength > MAX_TASK_DEFINITION_CANONICAL_BYTES_V1
  ) return Result.fail(invalid(operation, "invalid_shape"));
  return Result.gen(function* () {
    const bytes = yield* Result.try({
      try: () => copyBytes(input as Uint8Array),
      catch: () => invalid(operation, "invalid_shape"),
    });
    const parsed = yield* Result.try({
      try: () => JSON.parse(FATAL_UTF8.decode(bytes)) as unknown,
      catch: () => invalid(operation, "invalid_shape"),
    });
    if (
      !isJsonObjectFromUnknown(parsed) ||
      !hasExactKeys(parsed, ["codec", "task"]) ||
      parsed.codec !== CANONICAL_TASK_MANIFEST_CODEC_V1
    ) return yield* Result.fail(invalid(operation, "invalid_shape"));
    const manifest = yield* decodeCanonicalTaskManifestV1(parsed.task).pipe(
      Result.mapError(failure => reoperation(failure, operation)),
    );
    const canonical = yield* encodeCanonicalTaskManifestPreimageV1(manifest)
      .pipe(Result.mapError(failure => reoperation(failure, operation)));
    if (!bytesEqual(canonical, bytes)) {
      return yield* Result.fail(invalid(operation, "inconsistent_binding"));
    }
    return manifest;
  });
}

export function encodeCanonicalTaskManifestPreimageV1(
  input: unknown,
): Result.Result<Uint8Array, InvalidStandardApplicationTaskDefinitionV1Error> {
  return decodeCanonicalTaskManifestV1(input).pipe(
    Result.mapError((failure) => reoperation(failure, "encode_manifest")),
    Result.flatMap((manifest) => canonicalBytes({
      codec: CANONICAL_TASK_MANIFEST_CODEC_V1,
      task: {
        computeProfile: manifest.computeProfile,
        handler: {
          artifactModulePath: manifest.handler.artifactModulePath,
          exportName: manifest.handler.exportName,
          logicalModulePath: manifest.handler.logicalModulePath,
        },
        maximumDurationInSeconds: manifest.maximumDurationInSeconds,
        outputValidator: manifest.outputValidator === null
          ? null
          : validatorJson(manifest.outputValidator),
        payloadValidator: validatorJson(manifest.payloadValidator),
        queue: { kind: "default" },
        runAttemptPolicy: policyJson(manifest.runAttemptPolicy),
        taskId: manifest.taskId,
        version: 1,
      },
    }, "encode_manifest")),
  );
}

export function encodeHashedCanonicalTaskCatalogPreimageV1(
  catalog: Pick<HashedCanonicalTaskCatalogV1, "version" | "entries">,
): Result.Result<Uint8Array, InvalidStandardApplicationTaskDefinitionV1Error> {
  if (
    catalog.version !== 1 || !Array.isArray(catalog.entries) ||
    catalog.entries.length > MAX_TASK_CATALOG_ENTRIES_V1
  ) {
    return Result.fail(invalid("encode_catalog", "invalid_shape"));
  }
  const entries: Json[] = [];
  let previousTaskId: string | undefined;
  for (let index = 0; index < catalog.entries.length; index += 1) {
    const entry = catalog.entries[index];
    if (
      entry === undefined || entry.taskId !== entry.manifest.taskId ||
      !isUint8ArrayWithByteLength(entry.canonicalTaskManifestSha256, 32) ||
      (previousTaskId !== undefined &&
        compareUtf8(previousTaskId, entry.taskId) >= 0)
    ) {
      return Result.fail(invalid(
        "encode_catalog",
        "inconsistent_binding",
        `entries[${index}]`,
      ));
    }
    entries.push({
      canonicalTaskManifestSha256: encodeBytesToLowercaseHex(
        entry.canonicalTaskManifestSha256,
      ),
      taskId: entry.taskId,
    });
    previousTaskId = entry.taskId;
  }
  return canonicalBytes({
    codec: CANONICAL_TASK_CATALOG_CODEC_V1,
    entries,
  }, "encode_catalog");
}

export function encodeTaskRuntimeEntryPreimageV1(
  input: unknown,
): Result.Result<Uint8Array, InvalidStandardApplicationTaskDefinitionV1Error> {
  return decodeTaskRuntimeEntryFrameV1(input).pipe(
    Result.mapError((failure) => reoperation(failure, "encode_runtime_entry")),
    Result.flatMap((entry) => canonicalBytes({
      codec: TASK_RUNTIME_ENTRY_CODEC_V1,
      entry: taskRuntimeEntryJson(entry),
    }, "encode_runtime_entry")),
  );
}

export function decodeTaskRuntimeEntryPreimageV1(
  input: unknown,
): Result.Result<
  TaskRuntimeEntryFrameV1,
  InvalidStandardApplicationTaskDefinitionV1Error<
    "decode_runtime_entry_preimage"
  >
> {
  const operation = "decode_runtime_entry_preimage" as const;
  const byteLength = uint8ArrayByteLength(input);
  if (
    byteLength === undefined || byteLength > MAX_TASK_DEFINITION_CANONICAL_BYTES_V1
  ) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  return Result.gen(function* () {
    const bytes = yield* Result.try({
      try: () => copyBytes(input as Uint8Array),
      catch: () => invalid(operation, "invalid_shape"),
    });
    const parsed = yield* Result.try({
      try: () => JSON.parse(FATAL_UTF8.decode(bytes)) as unknown,
      catch: () => invalid(operation, "invalid_shape"),
    });
    if (
      !isJsonObjectFromUnknown(parsed)
      || !hasExactKeys(parsed, ["codec", "entry"])
      || parsed.codec !== TASK_RUNTIME_ENTRY_CODEC_V1
    ) {
      return yield* Result.fail(invalid(operation, "invalid_shape"));
    }
    const entry = decodeCanonicalTaskRuntimeEntry(parsed.entry);
    if (entry === undefined) {
      return yield* Result.fail(invalid(operation, "invalid_shape"));
    }
    const decoded = yield* decodeTaskRuntimeEntryFrameV1(entry).pipe(
      Result.mapError((failure) => reoperation(failure, operation)),
    );
    const canonical = yield* encodeTaskRuntimeEntryPreimageV1(decoded).pipe(
      Result.mapError((failure) => reoperation(failure, operation)),
    );
    if (!bytesEqual(canonical, bytes)) {
      return yield* Result.fail(invalid(operation, "inconsistent_binding"));
    }
    return decoded;
  });
}

export function encodeApplicationRevisionTaskBindingPreimageV1(
  input: unknown,
): Result.Result<Uint8Array, InvalidStandardApplicationTaskDefinitionV1Error> {
  return decodeApplicationRevisionTaskBindingFrameV1(input).pipe(
    Result.mapError((failure) => reoperation(
      failure,
      "encode_application_revision_task_binding",
    )),
    Result.flatMap((binding) => canonicalBytes({
      binding: {
        candidateSha256: hex(binding.candidateSha256),
        kind: binding.kind,
        taskCatalogSha256: hex(binding.taskCatalogSha256),
        taskCount: binding.taskCount.toString(10),
        taskEntryRootSha256: hex(binding.taskEntryRootSha256),
        taskRuntimeGroupManifestSha256:
          nullableHex(binding.taskRuntimeGroupManifestSha256),
        taskRuntimeMaterializationSpecSha256:
          nullableHex(binding.taskRuntimeMaterializationSpecSha256),
        taskRuntimeProjectionSha256:
          nullableHex(binding.taskRuntimeProjectionSha256),
      },
      codec: APPLICATION_REVISION_TASK_BINDING_CODEC_V1,
    }, "encode_application_revision_task_binding")),
  );
}

export function encodeTaskDefinitionRuntimeBindingPreimageV1(
  input: unknown,
): Result.Result<Uint8Array, InvalidStandardApplicationTaskDefinitionV1Error> {
  return decodeTaskDefinitionRuntimeBindingV1(input).pipe(
    Result.mapError((failure) => reoperation(failure, "encode_runtime_binding")),
    Result.flatMap((binding) => canonicalBytes({
      binding: taskDefinitionRuntimeBindingJson(binding),
      codec: TASK_DEFINITION_RUNTIME_BINDING_CODEC_V1,
    }, "encode_runtime_binding")),
  );
}

export function encodeTaskDefinitionRuntimeBindingCommitmentPreimageV1(
  input: unknown,
): Result.Result<
  Uint8Array,
  InvalidStandardApplicationTaskDefinitionV1Error<
    "encode_runtime_binding_commitment"
  >
> {
  return decodeTaskDefinitionRuntimeBindingCommitmentV1(input).pipe(
    Result.mapError((failure) => reoperation(
      failure,
      "encode_runtime_binding_commitment",
    )),
    Result.flatMap((binding) => canonicalBytes({
      binding: taskDefinitionRuntimeBindingJson(binding),
      codec: TASK_DEFINITION_RUNTIME_BINDING_CODEC_V1,
    }, "encode_runtime_binding_commitment")),
  );
}

export function decodeTaskDefinitionRuntimeBindingCommitmentPreimageV1(
  input: unknown,
): Result.Result<
  TaskDefinitionRuntimeBindingCommitmentV1,
  InvalidStandardApplicationTaskDefinitionV1Error<
    "decode_runtime_binding_commitment_preimage"
  >
> {
  const operation = "decode_runtime_binding_commitment_preimage" as const;
  if (
    !isUint8Array(input)
    || input.byteLength > MAX_TASK_DEFINITION_CANONICAL_BYTES_V1
  ) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(FATAL_UTF8.decode(input));
  } catch {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  if (
    !isJsonObjectFromUnknown(parsed)
    || !hasExactKeys(parsed, ["binding", "codec"])
    || parsed.codec !== TASK_DEFINITION_RUNTIME_BINDING_CODEC_V1
    || !isJsonObjectFromUnknown(parsed.binding)
    || !hasExactKeys(parsed.binding, [
      "applicationRevisionId",
      "applicationRevisionTaskBindingSha256",
      "artifactSha256",
      "candidateSha256",
      "canonicalTaskManifestSha256",
      "packageSha256",
      "runtimeObjects",
      "semanticRootSha256",
      "sourceRootSha256",
      "taskCatalogSha256",
      "taskEntryRootSha256",
      "taskId",
      "taskRuntimeEntry",
      "taskRuntimeEntrySha256",
      "taskRuntimeGroupManifestSha256",
      "taskRuntimeMaterializationSpecSha256",
      "taskRuntimeProjectionSha256",
      "version",
    ])
  ) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  const binding = parsed.binding;
  const digestFields = [
    "applicationRevisionTaskBindingSha256",
    "artifactSha256",
    "candidateSha256",
    "canonicalTaskManifestSha256",
    "packageSha256",
    "semanticRootSha256",
    "sourceRootSha256",
    "taskCatalogSha256",
    "taskEntryRootSha256",
    "taskRuntimeEntrySha256",
    "taskRuntimeGroupManifestSha256",
    "taskRuntimeMaterializationSpecSha256",
    "taskRuntimeProjectionSha256",
  ] as const;
  const digests = new Map<string, Uint8Array>();
  for (const field of digestFields) {
    const digest = decodeCanonicalDigest(binding[field]);
    if (digest === undefined) {
      return Result.fail(invalid(operation, "invalid_shape", field));
    }
    digests.set(field, digest);
  }
  const taskRuntimeEntry = decodeCanonicalTaskRuntimeEntry(
    binding.taskRuntimeEntry,
  );
  const runtimeObjects = decodeCanonicalRuntimeObjects(binding.runtimeObjects);
  if (taskRuntimeEntry === undefined || runtimeObjects === undefined) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  return decodeTaskDefinitionRuntimeBindingCommitmentV1({
    version: binding.version,
    applicationRevisionId: binding.applicationRevisionId,
    candidateSha256: digests.get("candidateSha256"),
    applicationRevisionTaskBindingSha256:
      digests.get("applicationRevisionTaskBindingSha256"),
    taskId: binding.taskId,
    canonicalTaskManifestSha256:
      digests.get("canonicalTaskManifestSha256"),
    taskRuntimeEntrySha256: digests.get("taskRuntimeEntrySha256"),
    taskRuntimeEntry,
    taskCatalogSha256: digests.get("taskCatalogSha256"),
    taskEntryRootSha256: digests.get("taskEntryRootSha256"),
    taskRuntimeProjectionSha256:
      digests.get("taskRuntimeProjectionSha256"),
    taskRuntimeGroupManifestSha256:
      digests.get("taskRuntimeGroupManifestSha256"),
    taskRuntimeMaterializationSpecSha256:
      digests.get("taskRuntimeMaterializationSpecSha256"),
    packageSha256: digests.get("packageSha256"),
    artifactSha256: digests.get("artifactSha256"),
    sourceRootSha256: digests.get("sourceRootSha256"),
    semanticRootSha256: digests.get("semanticRootSha256"),
    runtimeObjects,
  }).pipe(
    Result.mapError((failure) => reoperation(failure, operation)),
    Result.flatMap((commitment) =>
      encodeTaskDefinitionRuntimeBindingCommitmentPreimageV1(commitment).pipe(
        Result.mapError((failure) => reoperation(failure, operation)),
        Result.flatMap((canonical) => bytesEqual(canonical, input)
          ? Result.succeed(commitment)
          : Result.fail(invalid(operation, "inconsistent_binding"))),
      )
    ),
  );
}

export function encodeTaskRunCreationAuthorityReceiptPreimageV1(
  input: unknown,
): Result.Result<Uint8Array, InvalidStandardApplicationTaskDefinitionV1Error> {
  return decodeTaskRunCreationAuthorityReceiptV1(input).pipe(
    Result.mapError((failure) => reoperation(failure, "encode_creation_authority")),
    Result.flatMap((receipt) => canonicalBytes({
      authority: creationAuthorityJson(receipt),
      codec: TASK_RUN_CREATION_AUTHORITY_RECEIPT_CODEC_V1,
    }, "encode_creation_authority")),
  );
}

export function decodeTaskRunCreationAuthorityReceiptPreimageV1(
  input: unknown,
): Result.Result<
  TaskRunCreationAuthorityReceiptV1,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  const operation = "decode_creation_authority_preimage" as const;
  if (
    !isUint8Array(input)
    || input.byteLength > MAX_TASK_DEFINITION_CANONICAL_BYTES_V1
  ) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(FATAL_UTF8.decode(input));
  } catch {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  if (
    !isJsonObjectFromUnknown(parsed)
    || !hasExactKeys(parsed, ["authority", "codec"])
    || parsed.codec !== TASK_RUN_CREATION_AUTHORITY_RECEIPT_CODEC_V1
    || !isJsonObjectFromUnknown(parsed.authority)
    || !hasExactKeys(parsed.authority, [
      "activationHeadSha256",
      "activationRevision",
      "applicationRevisionId",
      "applicationRevisionTaskBindingSha256",
      "candidateSha256",
      "readinessReceiptSha256",
      "taskDefinitionRevisionId",
      "version",
    ])
  ) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  const authority = parsed.authority;
  const activationRevision = decodeCanonicalPositiveBigInt(
    authority.activationRevision,
  );
  const activationHeadSha256 = decodeCanonicalDigest(
    authority.activationHeadSha256,
  );
  const readinessReceiptSha256 = decodeCanonicalDigest(
    authority.readinessReceiptSha256,
  );
  const candidateSha256 = decodeCanonicalDigest(authority.candidateSha256);
  const applicationRevisionTaskBindingSha256 = decodeCanonicalDigest(
    authority.applicationRevisionTaskBindingSha256,
  );
  if (
    activationRevision === undefined
    || activationHeadSha256 === undefined
    || readinessReceiptSha256 === undefined
    || candidateSha256 === undefined
    || applicationRevisionTaskBindingSha256 === undefined
  ) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  return decodeTaskRunCreationAuthorityReceiptV1({
    version: authority.version,
    applicationRevisionId: authority.applicationRevisionId,
    activationRevision,
    activationHeadSha256,
    readinessReceiptSha256,
    candidateSha256,
    applicationRevisionTaskBindingSha256,
    taskDefinitionRevisionId: authority.taskDefinitionRevisionId,
  }).pipe(
    Result.mapError(failure => reoperation(failure, operation)),
    Result.flatMap(receipt =>
      encodeTaskRunCreationAuthorityReceiptPreimageV1(receipt).pipe(
        Result.mapError(failure => reoperation(failure, operation)),
        Result.flatMap(canonical => bytesEqual(canonical, input)
          ? Result.succeed(receipt)
          : Result.fail(invalid(operation, "inconsistent_binding"))),
      )
    ),
  );
}

function taskDefinitionRuntimeBindingJson(
  binding: TaskDefinitionRuntimeBindingCommitmentV1,
): Json {
  return {
    applicationRevisionId: binding.applicationRevisionId,
    applicationRevisionTaskBindingSha256:
      hex(binding.applicationRevisionTaskBindingSha256),
    artifactSha256: hex(binding.artifactSha256),
    candidateSha256: hex(binding.candidateSha256),
    canonicalTaskManifestSha256: hex(binding.canonicalTaskManifestSha256),
    packageSha256: hex(binding.packageSha256),
    runtimeObjects: binding.runtimeObjects.map(runtimeObjectJson),
    semanticRootSha256: hex(binding.semanticRootSha256),
    sourceRootSha256: hex(binding.sourceRootSha256),
    taskCatalogSha256: hex(binding.taskCatalogSha256),
    taskEntryRootSha256: hex(binding.taskEntryRootSha256),
    taskId: binding.taskId,
    taskRuntimeEntry: taskRuntimeEntryJson(binding.taskRuntimeEntry),
    taskRuntimeEntrySha256: hex(binding.taskRuntimeEntrySha256),
    taskRuntimeGroupManifestSha256:
      hex(binding.taskRuntimeGroupManifestSha256),
    taskRuntimeMaterializationSpecSha256:
      hex(binding.taskRuntimeMaterializationSpecSha256),
    taskRuntimeProjectionSha256: hex(binding.taskRuntimeProjectionSha256),
    version: 1,
  };
}

function decodeCanonicalTaskRuntimeEntry(
  input: Json | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (
    !isJsonObjectFromUnknown(input)
    || !hasExactKeys(input, [
      "artifactExecutionModule",
      "canonicalTaskManifestSha256",
      "exportName",
      "group",
      "kind",
      "logicalExecutionModule",
      "projectionSha256",
      "taskId",
      "taskOrdinal",
    ])
  ) return undefined;
  const canonicalTaskManifestSha256 = decodeCanonicalDigest(
    input.canonicalTaskManifestSha256,
  );
  const projectionSha256 = decodeCanonicalDigest(input.projectionSha256);
  const taskOrdinal = decodeCanonicalNonNegativeBigInt(input.taskOrdinal);
  return canonicalTaskManifestSha256 === undefined
      || projectionSha256 === undefined
      || taskOrdinal === undefined
    ? undefined
    : {
      ...input,
      canonicalTaskManifestSha256,
      projectionSha256,
      taskOrdinal,
    };
}

function decodeCanonicalRuntimeObjects(
  input: Json | undefined,
): ReadonlyArray<Readonly<Record<string, unknown>>> | undefined {
  if (!Array.isArray(input)) return undefined;
  const references: Array<Readonly<Record<string, unknown>>> = [];
  for (const item of input) {
    if (
      !isJsonObjectFromUnknown(item)
      || !hasExactKeys(item, [
        "byteLength",
        "objectKey",
        "role",
        "sha256",
        "storeIdentity",
      ])
    ) return undefined;
    const byteLength = decodeCanonicalPositiveBigInt(item.byteLength);
    const sha256 = decodeCanonicalDigest(item.sha256);
    if (byteLength === undefined || sha256 === undefined) return undefined;
    references.push({ ...item, byteLength, sha256 });
  }
  return references;
}

function taskRuntimeEntryJson(entry: TaskRuntimeEntryFrameV1): Json {
  return {
    artifactExecutionModule: entry.artifactExecutionModule,
    canonicalTaskManifestSha256: hex(entry.canonicalTaskManifestSha256),
    exportName: entry.exportName,
    group: "durable_task",
    kind: "task_runtime_entry",
    logicalExecutionModule: entry.logicalExecutionModule,
    projectionSha256: hex(entry.projectionSha256),
    taskId: entry.taskId,
    taskOrdinal: entry.taskOrdinal.toString(10),
  };
}

function runtimeObjectJson(reference: TaskRuntimeObjectReferenceV1): Json {
  return {
    byteLength: reference.byteLength.toString(10),
    objectKey: reference.objectKey,
    role: reference.role,
    sha256: hex(reference.sha256),
    storeIdentity: reference.storeIdentity,
  };
}

function creationAuthorityJson(
  receipt: TaskRunCreationAuthorityReceiptV1,
): Json {
  return {
    activationHeadSha256: hex(receipt.activationHeadSha256),
    activationRevision: receipt.activationRevision.toString(10),
    applicationRevisionId: receipt.applicationRevisionId,
    applicationRevisionTaskBindingSha256:
      hex(receipt.applicationRevisionTaskBindingSha256),
    candidateSha256: hex(receipt.candidateSha256),
    readinessReceiptSha256: hex(receipt.readinessReceiptSha256),
    taskDefinitionRevisionId: receipt.taskDefinitionRevisionId,
    version: 1,
  };
}

function policyJson(
  policy: RunAttemptPolicyV1,
): Json {
  return {
    outOfMemory: policy.outOfMemory.kind === "disabled"
      ? { kind: "disabled" }
      : {
        computeProfile: policy.outOfMemory.computeProfile,
        kind: "escalate_once",
      },
    retry: {
      factor: policy.retry.factor,
      maxAttempts: policy.retry.maxAttempts,
      maxTimeoutInMs: policy.retry.maxTimeoutInMs,
      minTimeoutInMs: policy.retry.minTimeoutInMs,
      randomize: policy.retry.randomize,
    },
    version: 1,
  };
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

function hasExactKeys(
  value: Readonly<Record<string, Json>>,
  expected: ReadonlyArray<string>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length
    && expected.every(key => Object.hasOwn(value, key));
}

function decodeCanonicalPositiveBigInt(value: Json | undefined): bigint | undefined {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    return undefined;
  }
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function decodeCanonicalNonNegativeBigInt(
  value: Json | undefined,
): bigint | undefined {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return undefined;
  }
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function decodeCanonicalDigest(value: Json | undefined): Uint8Array | undefined {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    return undefined;
  }
  const decoded = Encoding.decodeHex(value);
  return Result.isSuccess(decoded)
    && isUint8ArrayWithByteLength(decoded.success, 32)
    ? decoded.success
    : undefined;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function validatorJson(
  validator: import("flarex-protocol/validator-json").ValidatorJsonV1,
): Json {
  switch (validator.type) {
    case "array":
      return { type: "array", value: validatorJson(validator.value) };
    case "object": {
      const fields: Record<string, Json> = {};
      for (const key of Object.keys(validator.value).sort()) {
        const field = validator.value[key];
        if (field !== undefined) {
          fields[key] = {
            fieldType: validatorJson(field.fieldType),
            optional: field.optional,
          };
        }
      }
      return { type: "object", value: fields };
    }
    case "record":
      return {
        keys: validatorJson(validator.keys),
        type: "record",
        values: validatorJson(validator.values),
      };
    case "union":
      return {
        type: "union",
        value: validator.value.map(validatorJson),
      };
    default:
      return { ...validator };
  }
}

function canonicalBytes<
  Operation extends StandardApplicationTaskDefinitionOperationV1,
>(
  value: Json,
  operation: Operation,
): Result.Result<
  Uint8Array,
  InvalidStandardApplicationTaskDefinitionV1Error<Operation>
> {
  const bytes = UTF8.encode(encodeCanonicalJson(value, (issue) => {
    throw new StandardApplicationTaskCanonicalEncodingV1Defect({
      operation,
      issue,
    });
  }));
  return bytes.byteLength <= MAX_TASK_DEFINITION_CANONICAL_BYTES_V1
    ? Result.succeed(bytes)
    : Result.fail(new InvalidStandardApplicationTaskDefinitionV1Error({
      operation,
      reason: "canonical_bytes_exceeded",
      observed: bytes.byteLength,
      maximum: MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
    }));
}

function hex(digest: TaskDefinitionSha256V1): string {
  return encodeBytesToLowercaseHex(digest);
}

function nullableHex(digest: TaskDefinitionSha256V1 | null): string | null {
  return digest === null ? null : hex(digest);
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

function invalid<Operation extends StandardApplicationTaskDefinitionOperationV1>(
  operation: Operation,
  reason: InvalidStandardApplicationTaskDefinitionV1Error["reason"],
  path?: string,
): InvalidStandardApplicationTaskDefinitionV1Error<Operation> {
  return new InvalidStandardApplicationTaskDefinitionV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
  });
}
