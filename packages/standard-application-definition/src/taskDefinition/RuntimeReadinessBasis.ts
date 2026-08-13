import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { Effect, Encoding, Result } from "effect";
import {
  encodeCanonicalJson,
  isJsonObjectFromUnknown,
  type Json,
} from "flarex-protocol/json";

import type { StandardApplicationTaskSha256V1Error } from "./Errors.js";
import {
  MAX_TASK_CATALOG_ENTRIES_V1,
  MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1,
  MAX_TASK_RUNTIME_PUBLICATION_OBJECTS_V1,
  type TaskDefinitionSha256V1,
} from "./Model.js";
import {
  InvalidTaskRuntimeReadinessV1Error,
  TaskRuntimeReadinessCanonicalEncodingV1Defect,
  invalidTaskRuntimeReadiness as readinessInvalid,
  type TaskRuntimeReadinessBasisV1,
} from "./RuntimeReadinessModel.js";
import { isTaskRuntimeReadinessIdentity as validIdentity } from
  "./RuntimeReadinessIdentity.js";
import { decodeTaskRuntimeMaterializationSpecV1 } from
  "./RuntimePublicationSchema.js";
import type { StandardApplicationTaskSha256V1 } from "./Sha256.js";

export const TASK_RUNTIME_READINESS_BASIS_CODEC_V1 =
  "flarex.standard-application/task-runtime-readiness-basis/v1" as const;
export const MAX_TASK_RUNTIME_READINESS_BASIS_CANONICAL_BYTES_V1 =
  1 * 1_024 * 1_024;

const FATAL_UTF8 = new TextDecoder("utf-8", { fatal: true });
const UTF8 = new TextEncoder();

export function encodeTaskRuntimeReadinessBasisPreimageV1(
  input: unknown,
): Result.Result<
  Uint8Array,
  InvalidTaskRuntimeReadinessV1Error<"encode_readiness_basis">
> {
  return decodeBasisValue(input, "encode_readiness_basis").pipe(
    Result.flatMap(basis => canonicalBasisBytes(
      basis,
      "encode_readiness_basis",
    )),
  );
}

export function decodeTaskRuntimeReadinessBasisPreimageV1(
  input: unknown,
): Result.Result<
  TaskRuntimeReadinessBasisV1,
  InvalidTaskRuntimeReadinessV1Error<"decode_readiness_basis">
> {
  const operation = "decode_readiness_basis" as const;
  return Result.gen(function* () {
    const byteLength = uint8ArrayByteLength(input);
    if (
      byteLength === undefined || byteLength < 1 ||
      byteLength > MAX_TASK_RUNTIME_READINESS_BASIS_CANONICAL_BYTES_V1
    ) return yield* Result.fail(readinessInvalid(operation, "invalid_basis"));
    const bytes = yield* Result.try({
      try: () => copyBytes(input as Uint8Array),
      catch: () => readinessInvalid(operation, "invalid_basis"),
    });
    const parsed = yield* Result.try({
      try: () => JSON.parse(FATAL_UTF8.decode(bytes)) as unknown,
      catch: () => readinessInvalid(operation, "invalid_basis"),
    });
    if (
      !isJsonObjectFromUnknown(parsed) ||
      !hasExactKeys(parsed, ["basis", "codec"]) ||
      parsed.codec !== TASK_RUNTIME_READINESS_BASIS_CODEC_V1
    ) return yield* Result.fail(readinessInvalid(operation, "invalid_basis"));
    const basis = yield* decodeBasisJson(parsed.basis, operation);
    const canonical = yield* canonicalBasisBytes(basis, operation);
    if (!bytesEqualFullScan(bytes, canonical)) {
      return yield* Result.fail(readinessInvalid(
        operation,
        "noncanonical_preimage",
      ));
    }
    return basis;
  });
}

export const hashTaskRuntimeReadinessBasisV1 = Effect.fn(
  "StandardApplicationTask.hashRuntimeReadinessBasisV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  TaskDefinitionSha256V1,
  | InvalidTaskRuntimeReadinessV1Error<"hash_readiness_basis">
  | StandardApplicationTaskSha256V1Error
> {
  const bytes = yield* Effect.fromResult(
    encodeTaskRuntimeReadinessBasisPreimageV1(input).pipe(
      Result.mapError(failure => readinessInvalid(
        "hash_readiness_basis",
        failure.reason,
        failure.path,
      )),
    ),
  );
  return yield* digest(
    bytes,
    MAX_TASK_RUNTIME_READINESS_BASIS_CANONICAL_BYTES_V1,
    sha256,
  );
});


function decodeBasisValue<Operation extends "encode_readiness_basis">(
  input: unknown,
  operation: Operation,
): Result.Result<
  TaskRuntimeReadinessBasisV1,
  InvalidTaskRuntimeReadinessV1Error<Operation>
> {
  return decodeBasisRecord(input, operation);
}

function decodeBasisJson<Operation extends "decode_readiness_basis">(
  input: Json | undefined,
  operation: Operation,
): Result.Result<
  TaskRuntimeReadinessBasisV1,
  InvalidTaskRuntimeReadinessV1Error<Operation>
> {
  if (!isJsonObjectFromUnknown(input)) {
    return Result.fail(readinessInvalid(operation, "invalid_basis"));
  }
  const digestFields = [
    "applicationPublicationSha256",
    "applicationRevisionTaskBindingSha256",
    "applicationTaskCatalogBindingSha256",
    "publicationReceiptSha256",
    "sourceArtifactRootSha256",
    "taskCatalogSha256",
    "taskEntryRootSha256",
  ] as const;
  const value: Record<string, unknown> = { ...input };
  for (const field of digestFields) value[field] = decodeCanonicalDigest(input[field]);
  for (const field of [
    "taskRuntimeGroupManifestSha256",
    "taskRuntimeMaterializationSpecSha256",
    "taskRuntimeProjectionSha256",
  ] as const) {
    value[field] = input[field] === null ? null : decodeCanonicalDigest(input[field]);
  }
  value.taskCount = decodeCanonicalNonNegativeBigInt(
    input.taskCount,
    BigInt(MAX_TASK_CATALOG_ENTRIES_V1),
  );
  value.objectCount = decodeCanonicalNonNegativeBigInt(
    input.objectCount,
    BigInt(MAX_TASK_RUNTIME_PUBLICATION_OBJECTS_V1),
  );
  value.canonicalObjectByteLength = decodeCanonicalNonNegativeBigInt(
    input.canonicalObjectByteLength,
    BigInt(MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1),
  );
  return decodeBasisRecord(value, operation);
}

function decodeBasisRecord<Operation extends
  "encode_readiness_basis" | "decode_readiness_basis">(
  input: unknown,
  operation: Operation,
): Result.Result<
  TaskRuntimeReadinessBasisV1,
  InvalidTaskRuntimeReadinessV1Error<Operation>
> {
  const outer = exactDataRecord(input, BASIS_KEYS);
  if (
    outer === undefined || outer.version !== 1 ||
    (outer.kind !== "empty" && outer.kind !== "populated") ||
    !validIdentity(outer.scopeId) || !validIdentity(outer.candidateId) ||
    !validIdentity(outer.analysisId) ||
    !validIdentity(outer.applicationRevisionId)
  ) return Result.fail(readinessInvalid(operation, "invalid_basis"));
  return Result.gen(function* () {
    const digests = new Map<string, TaskDefinitionSha256V1>();
    for (const field of BASIS_DIGEST_KEYS) {
      const digest = yield* basisDigest(outer[field], operation, field);
      digests.set(field, digest);
    }
    const projection = yield* nullableBasisDigest(
      outer.taskRuntimeProjectionSha256,
      operation,
      "taskRuntimeProjectionSha256",
    );
    const group = yield* nullableBasisDigest(
      outer.taskRuntimeGroupManifestSha256,
      operation,
      "taskRuntimeGroupManifestSha256",
    );
    const materializationDigest = yield* nullableBasisDigest(
      outer.taskRuntimeMaterializationSpecSha256,
      operation,
      "taskRuntimeMaterializationSpecSha256",
    );
    if (
      typeof outer.taskCount !== "bigint" || outer.taskCount < 0n ||
      outer.taskCount > BigInt(MAX_TASK_CATALOG_ENTRIES_V1) ||
      typeof outer.objectCount !== "bigint" || outer.objectCount < 0n ||
      outer.objectCount > BigInt(MAX_TASK_RUNTIME_PUBLICATION_OBJECTS_V1) ||
      typeof outer.canonicalObjectByteLength !== "bigint" ||
      outer.canonicalObjectByteLength < 0n ||
      outer.canonicalObjectByteLength >
        BigInt(MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1)
    ) return yield* Result.fail(readinessInvalid(operation, "invalid_basis"));
    const policy = yield* decodeTaskRuntimeMaterializationSpecV1({
      kind: "task_runtime_materialization_spec",
      runtimeContractIdentity: outer.runtimeContractIdentity,
      bridgeAbiIdentity: outer.bridgeAbiIdentity,
      compatibilityDate: outer.compatibilityDate,
      compatibilityFlags: outer.compatibilityFlags,
      runtimeProfileIdentity: outer.runtimeProfileIdentity,
      runtimeImplementationVersion: outer.runtimeImplementationVersion,
      supportedComputeProfiles: outer.supportedComputeProfiles,
      moduleEntryPolicyIdentity: outer.moduleEntryPolicyIdentity,
    }).pipe(Result.mapError(cause => readinessInvalid(
      operation,
      "invalid_basis",
      "materializationPolicy",
      cause,
    )));
    const empty = outer.kind === "empty";
    const allRuntimeRootsNull = projection === null && group === null &&
      materializationDigest === null;
    const allRuntimeRootsPresent = projection !== null && group !== null &&
      materializationDigest !== null;
    if (
      empty !== (outer.taskCount === 0n) ||
      empty !== (outer.objectCount === 0n) ||
      empty !== (outer.canonicalObjectByteLength === 0n) ||
      (empty ? !allRuntimeRootsNull : !allRuntimeRootsPresent) ||
      (!empty && (
        outer.objectCount < outer.taskCount + 4n ||
        outer.canonicalObjectByteLength < outer.objectCount
      ))
    ) return yield* Result.fail(readinessInvalid(operation, "invalid_basis"));
    return Object.freeze({
      version: 1 as const,
      kind: outer.kind as "empty" | "populated",
      scopeId: outer.scopeId as string,
      candidateId: outer.candidateId as string,
      analysisId: outer.analysisId as string,
      applicationRevisionId: outer.applicationRevisionId as string,
      publicationReceiptSha256: digests.get("publicationReceiptSha256")!,
      applicationPublicationSha256:
        digests.get("applicationPublicationSha256")!,
      sourceArtifactRootSha256: digests.get("sourceArtifactRootSha256")!,
      applicationTaskCatalogBindingSha256:
        digests.get("applicationTaskCatalogBindingSha256")!,
      applicationRevisionTaskBindingSha256:
        digests.get("applicationRevisionTaskBindingSha256")!,
      taskCatalogSha256: digests.get("taskCatalogSha256")!,
      taskCount: outer.taskCount,
      taskEntryRootSha256: digests.get("taskEntryRootSha256")!,
      taskRuntimeProjectionSha256: projection,
      taskRuntimeGroupManifestSha256: group,
      taskRuntimeMaterializationSpecSha256: materializationDigest,
      runtimeContractIdentity: policy.runtimeContractIdentity,
      bridgeAbiIdentity: policy.bridgeAbiIdentity,
      compatibilityDate: policy.compatibilityDate,
      compatibilityFlags: policy.compatibilityFlags,
      runtimeProfileIdentity: policy.runtimeProfileIdentity,
      runtimeImplementationVersion: policy.runtimeImplementationVersion,
      supportedComputeProfiles: policy.supportedComputeProfiles,
      moduleEntryPolicyIdentity: policy.moduleEntryPolicyIdentity,
      objectCount: outer.objectCount,
      canonicalObjectByteLength: outer.canonicalObjectByteLength,
    });
  });
}

const BASIS_DIGEST_KEYS = [
  "applicationPublicationSha256",
  "applicationRevisionTaskBindingSha256",
  "applicationTaskCatalogBindingSha256",
  "publicationReceiptSha256",
  "sourceArtifactRootSha256",
  "taskCatalogSha256",
  "taskEntryRootSha256",
] as const;

const BASIS_KEYS = [
  "analysisId",
  "applicationPublicationSha256",
  "applicationRevisionId",
  "applicationRevisionTaskBindingSha256",
  "applicationTaskCatalogBindingSha256",
  "bridgeAbiIdentity",
  "candidateId",
  "canonicalObjectByteLength",
  "compatibilityDate",
  "compatibilityFlags",
  "kind",
  "moduleEntryPolicyIdentity",
  "objectCount",
  "publicationReceiptSha256",
  "runtimeContractIdentity",
  "runtimeImplementationVersion",
  "runtimeProfileIdentity",
  "scopeId",
  "sourceArtifactRootSha256",
  "supportedComputeProfiles",
  "taskCatalogSha256",
  "taskCount",
  "taskEntryRootSha256",
  "taskRuntimeGroupManifestSha256",
  "taskRuntimeMaterializationSpecSha256",
  "taskRuntimeProjectionSha256",
  "version",
] as const;

function canonicalBasisBytes<Operation extends
  "encode_readiness_basis" | "decode_readiness_basis">(
  basis: TaskRuntimeReadinessBasisV1,
  operation: Operation,
): Result.Result<
  Uint8Array,
  InvalidTaskRuntimeReadinessV1Error<Operation>
> {
  const bytes = UTF8.encode(encodeCanonicalJson({
    basis: basisJson(basis),
    codec: TASK_RUNTIME_READINESS_BASIS_CODEC_V1,
  }, issue => {
    throw new TaskRuntimeReadinessCanonicalEncodingV1Defect({
      operation,
      issue,
    });
  }));
  return bytes.byteLength <= MAX_TASK_RUNTIME_READINESS_BASIS_CANONICAL_BYTES_V1
    ? Result.succeed(bytes)
    : Result.fail(readinessInvalid(
      operation,
      "canonical_bytes_exceeded",
      undefined,
      undefined,
      bytes.byteLength,
      MAX_TASK_RUNTIME_READINESS_BASIS_CANONICAL_BYTES_V1,
    ));
}

function basisJson(basis: TaskRuntimeReadinessBasisV1): Json {
  return {
    analysisId: basis.analysisId,
    applicationPublicationSha256: hex(basis.applicationPublicationSha256),
    applicationRevisionId: basis.applicationRevisionId,
    applicationRevisionTaskBindingSha256:
      hex(basis.applicationRevisionTaskBindingSha256),
    applicationTaskCatalogBindingSha256:
      hex(basis.applicationTaskCatalogBindingSha256),
    bridgeAbiIdentity: basis.bridgeAbiIdentity,
    candidateId: basis.candidateId,
    canonicalObjectByteLength: basis.canonicalObjectByteLength.toString(10),
    compatibilityDate: basis.compatibilityDate,
    compatibilityFlags: [...basis.compatibilityFlags],
    kind: basis.kind,
    moduleEntryPolicyIdentity: basis.moduleEntryPolicyIdentity,
    objectCount: basis.objectCount.toString(10),
    publicationReceiptSha256: hex(basis.publicationReceiptSha256),
    runtimeContractIdentity: basis.runtimeContractIdentity,
    runtimeImplementationVersion: basis.runtimeImplementationVersion,
    runtimeProfileIdentity: basis.runtimeProfileIdentity,
    scopeId: basis.scopeId,
    sourceArtifactRootSha256: hex(basis.sourceArtifactRootSha256),
    supportedComputeProfiles: [...basis.supportedComputeProfiles],
    taskCatalogSha256: hex(basis.taskCatalogSha256),
    taskCount: basis.taskCount.toString(10),
    taskEntryRootSha256: hex(basis.taskEntryRootSha256),
    taskRuntimeGroupManifestSha256:
      nullableHex(basis.taskRuntimeGroupManifestSha256),
    taskRuntimeMaterializationSpecSha256:
      nullableHex(basis.taskRuntimeMaterializationSpecSha256),
    taskRuntimeProjectionSha256:
      nullableHex(basis.taskRuntimeProjectionSha256),
    version: 1,
  };
}


export function copyTaskRuntimeReadinessBasisV1(basis: TaskRuntimeReadinessBasisV1): TaskRuntimeReadinessBasisV1 {
  return Object.freeze({
    ...basis,
    publicationReceiptSha256: copyDigest(basis.publicationReceiptSha256),
    applicationPublicationSha256:
      copyDigest(basis.applicationPublicationSha256),
    sourceArtifactRootSha256:
      copyDigest(basis.sourceArtifactRootSha256),
    applicationTaskCatalogBindingSha256:
      copyDigest(basis.applicationTaskCatalogBindingSha256),
    applicationRevisionTaskBindingSha256:
      copyDigest(basis.applicationRevisionTaskBindingSha256),
    taskCatalogSha256: copyDigest(basis.taskCatalogSha256),
    taskEntryRootSha256: copyDigest(basis.taskEntryRootSha256),
    taskRuntimeProjectionSha256:
      copyNullableDigest(basis.taskRuntimeProjectionSha256),
    taskRuntimeGroupManifestSha256:
      copyNullableDigest(basis.taskRuntimeGroupManifestSha256),
    taskRuntimeMaterializationSpecSha256:
      copyNullableDigest(basis.taskRuntimeMaterializationSpecSha256),
    compatibilityFlags: Object.freeze([...basis.compatibilityFlags]),
    supportedComputeProfiles: Object.freeze([...basis.supportedComputeProfiles]),
  });
}

function basisDigest<Operation extends
  "encode_readiness_basis" | "decode_readiness_basis">(
  input: unknown,
  operation: Operation,
  path: string,
): Result.Result<
  TaskDefinitionSha256V1,
  InvalidTaskRuntimeReadinessV1Error<Operation>
> {
  if (!isUint8ArrayWithByteLength(input, 32)) {
    return Result.fail(readinessInvalid(operation, "invalid_basis", path));
  }
  return Result.try({
    try: () => copyDigest(input),
    catch: () => readinessInvalid(operation, "invalid_basis", path),
  });
}

function nullableBasisDigest<Operation extends
  "encode_readiness_basis" | "decode_readiness_basis">(
  input: unknown,
  operation: Operation,
  path: string,
): Result.Result<
  TaskDefinitionSha256V1 | null,
  InvalidTaskRuntimeReadinessV1Error<Operation>
> {
  return input === null
    ? Result.succeed(null)
    : basisDigest(input, operation, path);
}

function digest(
  bytes: Uint8Array,
  maximumInputBytes: number,
  sha256: StandardApplicationTaskSha256V1,
): Effect.Effect<TaskDefinitionSha256V1, StandardApplicationTaskSha256V1Error> {
  return sha256(bytes, { maximumInputBytes }).pipe(
    Effect.map(value => copyDigest(value)),
  );
}


function exactDataRecord(
  input: unknown,
  keys: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return undefined;
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== keys.length ||
      actual.some(key => typeof key !== "string" || !keys.includes(key))
    ) return undefined;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)
      ) return undefined;
      Object.defineProperty(output, key, {
        enumerable: true,
        value: descriptor.value,
      });
    }
    return output;
  } catch {
    return undefined;
  }
}


function decodeCanonicalDigest(input: Json | undefined):
TaskDefinitionSha256V1 | undefined {
  if (typeof input !== "string" || !/^[0-9a-f]{64}$/u.test(input)) {
    return undefined;
  }
  return Encoding.decodeHex(input).pipe(Result.match({
    onFailure: () => undefined,
    onSuccess: bytes => isUint8ArrayWithByteLength(bytes, 32)
      ? copyDigest(bytes)
      : undefined,
  }));
}

function decodeCanonicalNonNegativeBigInt(
  input: Json | undefined,
  maximum: bigint,
): bigint | undefined {
  if (typeof input !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(input)) {
    return undefined;
  }
  const maximumText = maximum.toString(10);
  if (
    input.length > maximumText.length ||
    (input.length === maximumText.length && input > maximumText)
  ) return undefined;
  return BigInt(input);
}

function hasExactKeys(
  input: Readonly<Record<string, unknown>>,
  keys: ReadonlyArray<string>,
): boolean {
  const actual = Reflect.ownKeys(input);
  return actual.length === keys.length && actual.every(key =>
    typeof key === "string" && keys.includes(key)
  );
}

function hex(value: TaskDefinitionSha256V1): string {
  return encodeBytesToLowercaseHex(value);
}

function nullableHex(value: TaskDefinitionSha256V1 | null): string | null {
  return value === null ? null : hex(value);
}

function copyDigest(value: Uint8Array): TaskDefinitionSha256V1 {
  return copyBytes(value) as TaskDefinitionSha256V1;
}

function copyNullableDigest(
  value: TaskDefinitionSha256V1 | null,
): TaskDefinitionSha256V1 | null {
  return value === null ? null : copyDigest(value);
}
