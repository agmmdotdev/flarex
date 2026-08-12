import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { Encoding, Effect, Result } from "effect";
import {
  encodeCanonicalJson,
  isJsonObjectFromUnknown,
  type Json,
} from "flarex-protocol/json";

import type { StandardApplicationTaskSha256V1Error } from "./Errors.js";
import {
  MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1,
  MAX_TASK_RUNTIME_PUBLICATION_MODULES_V1,
  MAX_TASK_RUNTIME_PUBLICATION_OBJECTS_V1,
  MAX_TASK_RUNTIME_PUBLICATION_RECEIPT_CANONICAL_BYTES_V1,
  MAX_TASK_CATALOG_ENTRIES_V1,
  TASK_RUNTIME_ENTRY_CODEC_V1,
  TASK_RUNTIME_GROUP_MANIFEST_CODEC_V1,
  TASK_RUNTIME_MATERIALIZATION_SPEC_CODEC_V1,
  TASK_RUNTIME_OBJECT_STORE_V1,
  TASK_RUNTIME_PROJECTION_CODEC_V1,
  TASK_RUNTIME_PROJECTION_MODULE_CODEC_V1,
  TASK_RUNTIME_PUBLICATION_RECEIPT_CODEC_V1,
  taskRuntimeObjectKeyV1,
  type TaskDefinitionSha256V1,
  type TaskRuntimeObjectReferenceV1,
  type TaskRuntimeObjectRoleV1,
} from "./Model.js";
import {
  InvalidTaskRuntimePublicationV1Error,
  TaskRuntimePublicationCanonicalEncodingV1Defect,
} from "./RuntimePublicationErrors.js";
import type {
  StandardApplicationTaskSha256V1,
} from "./Sha256.js";
import type {
  TaskRuntimePublicationReceiptObjectPreimageV1,
  TaskRuntimePublicationReceiptPreimageV1,
} from "./RuntimePublicationPreparation.js";
import {
  capturePreparedTaskRuntimeObjectV1,
  capturePreparedTaskRuntimePublicationV1,
  type PreparedTaskRuntimeObjectV1,
  type PreparedTaskRuntimePublicationV1,
} from "./RuntimePublicationPreparation.js";

const UTF8 = new TextEncoder();
const FATAL_UTF8 = new TextDecoder("utf-8", { fatal: true });
const MAX_IDENTITY_UTF8_BYTES = 256;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const ROLE_ORDER = [
  "runtime_projection_module",
  "task_runtime_projection",
  "task_runtime_entry",
  "task_runtime_group_manifest",
  "task_runtime_materialization_spec",
] as const satisfies ReadonlyArray<TaskRuntimeObjectRoleV1>;

export interface PreparedTaskRuntimePublicationReceiptV1 {
  readonly version: 1;
  readonly canonicalByteLength: number;
  readonly readReceipt: () => TaskRuntimePublicationReceiptPreimageV1;
  readonly readCanonicalBytes: () => Uint8Array;
  readonly readSha256: () => TaskDefinitionSha256V1;
}

export interface CapturedTaskRuntimePublicationReceiptV1 {
  readonly receipt: TaskRuntimePublicationReceiptPreimageV1;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: TaskDefinitionSha256V1;
}

export interface PublishedTaskRuntimeObjectV1 {
  readonly version: 1;
  readonly readReference: () => TaskRuntimeObjectReferenceV1;
}

interface PreparedReceiptState {
  readonly receipt: TaskRuntimePublicationReceiptPreimageV1;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: TaskDefinitionSha256V1;
}

export interface TaskRuntimePublicationReceiptAuthorityV1 {
  readonly confirmPublishedObject: (
    object: PreparedTaskRuntimeObjectV1,
    reference: unknown,
  ) => Result.Result<
    PublishedTaskRuntimeObjectV1,
    InvalidTaskRuntimePublicationV1Error<"prepare_publication_receipt">
  >;
  readonly prepareReceipt: (
    publication: PreparedTaskRuntimePublicationV1,
    confirmations: ReadonlyArray<PublishedTaskRuntimeObjectV1>,
  ) => Effect.Effect<
    PreparedTaskRuntimePublicationReceiptV1,
    PrepareTaskRuntimePublicationReceiptV1Error
  >;
  readonly captureReceipt: (
    input: unknown,
  ) => Result.Result<
    CapturedTaskRuntimePublicationReceiptV1,
    InvalidTaskRuntimePublicationV1Error<"prepare_publication_receipt">
  >;
}

export type PrepareTaskRuntimePublicationReceiptV1Error =
  | InvalidTaskRuntimePublicationV1Error<"prepare_publication_receipt">
  | StandardApplicationTaskSha256V1Error;

export function encodeTaskRuntimePublicationReceiptPreimageV1(
  input: unknown,
): Result.Result<
  Uint8Array,
  InvalidTaskRuntimePublicationV1Error<"encode_publication_receipt">
> {
  return decodeReceiptValue(input, "encode_publication_receipt").pipe(
    Result.flatMap(receipt => canonicalReceiptBytes(
      receipt,
      "encode_publication_receipt",
    )),
  );
}

export function decodeTaskRuntimePublicationReceiptPreimageV1(
  input: unknown,
): Result.Result<
  TaskRuntimePublicationReceiptPreimageV1,
  InvalidTaskRuntimePublicationV1Error<"decode_publication_receipt">
> {
  const operation = "decode_publication_receipt" as const;
  return Result.gen(function* () {
    const byteLength = uint8ArrayByteLength(input);
    if (
      byteLength === undefined || byteLength < 1 ||
      byteLength > MAX_TASK_RUNTIME_PUBLICATION_RECEIPT_CANONICAL_BYTES_V1
    ) return yield* Result.fail(invalid(operation, "invalid_receipt"));
    const bytes = yield* Result.try({
      try: () => copyBytes(input as Uint8Array),
      catch: () => invalid(operation, "invalid_receipt"),
    });
    const parsed = yield* Result.try({
      try: () => JSON.parse(FATAL_UTF8.decode(bytes)) as unknown,
      catch: () => invalid(operation, "invalid_receipt"),
    });
    if (
      !isJsonObjectFromUnknown(parsed) ||
      !hasExactKeys(parsed, ["codec", "receipt"]) ||
      parsed.codec !== TASK_RUNTIME_PUBLICATION_RECEIPT_CODEC_V1
    ) return yield* Result.fail(invalid(operation, "invalid_receipt"));
    const receipt = yield* decodeReceiptJson(parsed.receipt, operation);
    const canonical = yield* canonicalReceiptBytes(receipt, operation);
    if (!bytesEqualFullScan(bytes, canonical)) {
      return yield* Result.fail(invalid(operation, "noncanonical_preimage"));
    }
    return receipt;
  });
}

export function makeTaskRuntimePublicationReceiptAuthorityV1(
  sha256: StandardApplicationTaskSha256V1,
): TaskRuntimePublicationReceiptAuthorityV1 {
  const preparedReceiptStates = new WeakMap<object, PreparedReceiptState>();
  const publishedObjectStates = new WeakMap<object, Readonly<{
    object: PreparedTaskRuntimeObjectV1;
    reference: TaskRuntimeObjectReferenceV1;
  }>>();

  const confirmPublishedObject: TaskRuntimePublicationReceiptAuthorityV1[
    "confirmPublishedObject"
  ] = (object, referenceInput) => {
    const captured = capturePreparedTaskRuntimeObjectV1(object);
    if (captured === undefined) {
      return Result.fail(invalid(
        "prepare_publication_receipt",
        "invalid_runtime_object",
      ));
    }
    return Result.try({
      try: () => captureReference(referenceInput),
      catch: () => invalid(
        "prepare_publication_receipt",
        "invalid_runtime_object",
      ),
    }).pipe(Result.flatMap(reference => {
      if (reference === undefined ||
        !referencesEqual(captured.reference, reference)) {
        return Result.fail(invalid(
          "prepare_publication_receipt",
          "invalid_runtime_object",
        ));
      }
      const confirmation = Object.freeze({
        version: 1 as const,
        readReference: () => copyReference(reference),
      });
      publishedObjectStates.set(confirmation, Object.freeze({
        object,
        reference: copyReference(reference),
      }));
      return Result.succeed(confirmation);
    }));
  };

  const prepareReceipt: TaskRuntimePublicationReceiptAuthorityV1[
    "prepareReceipt"
  ] = Effect.fn("StandardApplicationTask.prepareRuntimePublicationReceiptV1")(
    function* (publicationInput, confirmationsInput) {
      const publication = capturePreparedTaskRuntimePublicationV1(
        publicationInput,
      );
      if (publication === undefined || !confirmationsMatch(
        publication.objects,
        confirmationsInput,
        publishedObjectStates,
      )) {
        return yield* new InvalidTaskRuntimePublicationV1Error({
          operation: "prepare_publication_receipt",
          reason: "invalid_receipt",
          path: "publication",
        });
      }
      const state = yield* prepareCanonicalReceipt(publication.receipt, sha256);
      const prepared = Object.freeze({
        version: 1 as const,
        canonicalByteLength: state.canonicalBytes.byteLength,
        readReceipt: () => copyReceipt(state.receipt),
        readCanonicalBytes: () => copyBytes(state.canonicalBytes),
        readSha256: () => copyBytes(state.sha256) as TaskDefinitionSha256V1,
      });
      preparedReceiptStates.set(prepared, state);
      return prepared;
    },
  );

  const captureReceipt: TaskRuntimePublicationReceiptAuthorityV1[
    "captureReceipt"
  ] = input => {
    if (typeof input !== "object" || input === null) {
      return Result.fail(invalid(
        "prepare_publication_receipt",
        "invalid_receipt",
      ));
    }
    const state = preparedReceiptStates.get(input);
    return state === undefined
      ? Result.fail(invalid("prepare_publication_receipt", "invalid_receipt"))
      : Result.succeed(Object.freeze({
        receipt: copyReceipt(state.receipt),
        canonicalBytes: copyBytes(state.canonicalBytes),
        sha256: copyBytes(state.sha256) as TaskDefinitionSha256V1,
      }));
  };

  return Object.freeze({
    confirmPublishedObject,
    prepareReceipt,
    captureReceipt,
  });
}

export const hashTaskRuntimePublicationReceiptPreimageV1 = Effect.fn(
  "StandardApplicationTask.hashRuntimePublicationReceiptPreimageV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  TaskDefinitionSha256V1,
  PrepareTaskRuntimePublicationReceiptV1Error
> {
  const state = yield* prepareCanonicalReceipt(input, sha256);
  return copyBytes(state.sha256) as TaskDefinitionSha256V1;
});

const prepareCanonicalReceipt = Effect.fn(
  "StandardApplicationTask.prepareCanonicalRuntimePublicationReceiptV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<PreparedReceiptState, PrepareTaskRuntimePublicationReceiptV1Error> {
  const receipt = yield* Effect.fromResult(
    decodeReceiptValue(input, "prepare_publication_receipt"),
  );
  const canonicalBytes = yield* Effect.fromResult(
    canonicalReceiptBytes(receipt, "prepare_publication_receipt"),
  );
  const digest = yield* sha256(canonicalBytes, {
    maximumInputBytes:
      MAX_TASK_RUNTIME_PUBLICATION_RECEIPT_CANONICAL_BYTES_V1,
  });
  if (!isUint8ArrayWithByteLength(digest, 32)) {
    return yield* Effect.die(new Error("Task runtime receipt SHA-256 was invalid."));
  }
  const ownedDigest = copyBytes(digest) as TaskDefinitionSha256V1;
  return Object.freeze({
    receipt,
    canonicalBytes: copyBytes(canonicalBytes),
    sha256: ownedDigest,
  });
});


function decodeReceiptValue<Operation extends
  | "encode_publication_receipt"
  | "prepare_publication_receipt">(
  input: unknown,
  operation: Operation,
): Result.Result<
  TaskRuntimePublicationReceiptPreimageV1,
  InvalidTaskRuntimePublicationV1Error<Operation>
> {
  return Result.try({
    try: () => captureReceiptValue(input),
    catch: () => invalid(operation, "invalid_receipt"),
  }).pipe(Result.flatMap(captured => captured === undefined
    ? Result.fail(invalid(operation, "invalid_receipt"))
    : validateReceipt(captured, operation)));
}

function captureReceiptValue(
  input: unknown,
): TaskRuntimePublicationReceiptPreimageV1 | undefined {
  const outer = exactDataRecord(input, [
    "version", "scopeId", "candidateId", "applicationRevisionId",
    "candidateSha256", "taskCatalogBindingSha256",
    "applicationRevisionTaskBindingSha256", "taskCatalogSha256",
    "taskEntryRootSha256", "taskRuntimeProjectionSha256",
    "taskRuntimeGroupManifestSha256",
    "taskRuntimeMaterializationSpecSha256", "packageSha256",
    "artifactSha256", "sourceRootSha256", "semanticRootSha256",
    "runtimeObjects",
  ]);
  if (outer === undefined || !Array.isArray(outer.runtimeObjects)) {
    return undefined;
  }
  const runtimeObjects = denseDataArray(
    outer.runtimeObjects,
    MAX_TASK_RUNTIME_PUBLICATION_OBJECTS_V1,
  );
  if (runtimeObjects === undefined) return undefined;
  const objects: TaskRuntimePublicationReceiptObjectPreimageV1[] = [];
  for (const inputObject of runtimeObjects) {
    const item = exactDataRecord(inputObject, [
      "ordinal", "codecIdentity", "reference",
    ]);
    const reference = item === undefined
      ? undefined
      : exactDataRecord(item.reference, [
        "storeIdentity", "role", "objectKey", "byteLength", "sha256",
      ]);
    if (item === undefined || reference === undefined) return undefined;
    objects.push({
      ordinal: item.ordinal as bigint,
      codecIdentity: item.codecIdentity as string,
      reference: {
        storeIdentity: reference.storeIdentity as typeof TASK_RUNTIME_OBJECT_STORE_V1,
        role: reference.role as TaskRuntimeObjectRoleV1,
        objectKey: reference.objectKey as string,
        byteLength: reference.byteLength as bigint,
        sha256: copyDigest(reference.sha256),
      },
    });
  }
  return {
    version: outer.version as 1,
    scopeId: outer.scopeId as string,
    candidateId: outer.candidateId as string,
    applicationRevisionId: outer.applicationRevisionId as string,
    candidateSha256: copyDigest(outer.candidateSha256),
    taskCatalogBindingSha256: copyDigest(outer.taskCatalogBindingSha256),
    applicationRevisionTaskBindingSha256:
      copyDigest(outer.applicationRevisionTaskBindingSha256),
    taskCatalogSha256: copyDigest(outer.taskCatalogSha256),
    taskEntryRootSha256: copyDigest(outer.taskEntryRootSha256),
    taskRuntimeProjectionSha256:
      copyNullableDigest(outer.taskRuntimeProjectionSha256),
    taskRuntimeGroupManifestSha256:
      copyNullableDigest(outer.taskRuntimeGroupManifestSha256),
    taskRuntimeMaterializationSpecSha256:
      copyNullableDigest(outer.taskRuntimeMaterializationSpecSha256),
    packageSha256: copyDigest(outer.packageSha256),
    artifactSha256: copyDigest(outer.artifactSha256),
    sourceRootSha256: copyDigest(outer.sourceRootSha256),
    semanticRootSha256: copyDigest(outer.semanticRootSha256),
    runtimeObjects: objects,
  };
}

function validateReceipt<Operation extends
  | "encode_publication_receipt"
  | "decode_publication_receipt"
  | "prepare_publication_receipt">(
  receipt: TaskRuntimePublicationReceiptPreimageV1,
  operation: Operation,
): Result.Result<
  TaskRuntimePublicationReceiptPreimageV1,
  InvalidTaskRuntimePublicationV1Error<Operation>
> {
  if (
    receipt.version !== 1 || !validIdentity(receipt.scopeId) ||
    !validIdentity(receipt.candidateId) ||
    !validIdentity(receipt.applicationRevisionId) ||
    !allDigestsValid(receipt)
  ) return Result.fail(invalid(operation, "invalid_receipt"));
  const objects: TaskRuntimePublicationReceiptObjectPreimageV1[] = [];
  const objectKeys = new Set<string>();
  const singletonRoles = new Set<TaskRuntimeObjectRoleV1>();
  const roleCounts = new Map<TaskRuntimeObjectRoleV1, number>();
  let previousRole = -1;
  for (let index = 0; index < receipt.runtimeObjects.length; index += 1) {
    const item = receipt.runtimeObjects[index]!;
    const reference = item.reference;
    const roleIndex = ROLE_ORDER.indexOf(reference.role);
    const expectedOrdinal = roleCounts.get(reference.role) ?? 0;
    if (
      item.ordinal !== BigInt(expectedOrdinal) || roleIndex < 0 ||
      reference.storeIdentity !== TASK_RUNTIME_OBJECT_STORE_V1 ||
      item.codecIdentity !== codecForRole(reference.role) ||
      typeof reference.byteLength !== "bigint" || reference.byteLength < 1n ||
      reference.byteLength > BigInt(MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1) ||
      !isUint8ArrayWithByteLength(reference.sha256, 32) ||
      reference.objectKey !== taskRuntimeObjectKeyV1(
        reference.role,
        encodeBytesToLowercaseHex(reference.sha256),
      ) || objectKeys.has(reference.objectKey) || roleIndex < previousRole
    ) return Result.fail(invalid(operation, "invalid_runtime_object", `runtimeObjects[${index}]`));
    if (reference.role !== "runtime_projection_module" &&
      reference.role !== "task_runtime_entry") {
      if (singletonRoles.has(reference.role)) {
        return Result.fail(invalid(operation, "duplicate_runtime_object", `runtimeObjects[${index}].reference.role`));
      }
      singletonRoles.add(reference.role);
    }
    objectKeys.add(reference.objectKey);
    roleCounts.set(reference.role, expectedOrdinal + 1);
    if (
      (reference.role === "runtime_projection_module" &&
        expectedOrdinal + 1 > MAX_TASK_RUNTIME_PUBLICATION_MODULES_V1) ||
      (reference.role === "task_runtime_entry" &&
        expectedOrdinal + 1 > MAX_TASK_CATALOG_ENTRIES_V1)
    ) return Result.fail(invalid(
      operation,
      "invalid_runtime_object",
      `runtimeObjects[${index}]`,
    ));
    previousRole = roleIndex;
    objects.push(copyReceiptObject(item));
  }
  const empty = objects.length === 0;
  const rootsNull = receipt.taskRuntimeProjectionSha256 === null &&
    receipt.taskRuntimeGroupManifestSha256 === null &&
    receipt.taskRuntimeMaterializationSpecSha256 === null;
  if (empty !== rootsNull || (!empty && (
    !objects.some(item => item.reference.role === "runtime_projection_module") ||
    !objects.some(item => item.reference.role === "task_runtime_entry") ||
    !singletonRoles.has("task_runtime_projection") ||
    !singletonRoles.has("task_runtime_group_manifest") ||
    !singletonRoles.has("task_runtime_materialization_spec")
  ))) return Result.fail(invalid(operation, "missing_runtime_object"));
  if (!empty && (
    !singletonDigestMatches(
      objects,
      "task_runtime_projection",
      receipt.taskRuntimeProjectionSha256,
    ) || !singletonDigestMatches(
      objects,
      "task_runtime_group_manifest",
      receipt.taskRuntimeGroupManifestSha256,
    ) || !singletonDigestMatches(
      objects,
      "task_runtime_materialization_spec",
      receipt.taskRuntimeMaterializationSpecSha256,
    )
  )) return Result.fail(invalid(operation, "invalid_digest"));
  return Result.succeed(freezeReceipt(receipt, objects));
}

function decodeReceiptJson<Operation extends "decode_publication_receipt">(
  input: Json | undefined,
  operation: Operation,
): Result.Result<TaskRuntimePublicationReceiptPreimageV1, InvalidTaskRuntimePublicationV1Error<Operation>> {
  if (!isJsonObjectFromUnknown(input) || !hasExactKeys(input, [
    "applicationRevisionId", "applicationRevisionTaskBindingSha256",
    "artifactSha256", "candidateId", "candidateSha256", "packageSha256",
    "runtimeObjects", "scopeId", "semanticRootSha256", "sourceRootSha256",
    "taskCatalogBindingSha256", "taskCatalogSha256", "taskEntryRootSha256",
    "taskRuntimeGroupManifestSha256", "taskRuntimeMaterializationSpecSha256",
    "taskRuntimeProjectionSha256", "version",
  ]) || !Array.isArray(input.runtimeObjects) ||
    input.runtimeObjects.length > MAX_TASK_RUNTIME_PUBLICATION_OBJECTS_V1) {
    return Result.fail(invalid(operation, "invalid_receipt"));
  }
  const runtimeObjects: TaskRuntimePublicationReceiptObjectPreimageV1[] = [];
  for (const raw of input.runtimeObjects) {
    if (!isJsonObjectFromUnknown(raw) || !hasExactKeys(raw, ["codecIdentity", "ordinal", "reference"]) ||
      !isJsonObjectFromUnknown(raw.reference) || !hasExactKeys(raw.reference, ["byteLength", "objectKey", "role", "sha256", "storeIdentity"])) {
      return Result.fail(invalid(operation, "invalid_runtime_object"));
    }
    const ordinal = canonicalNonNegativeBigInt(raw.ordinal);
    const byteLength = canonicalPositiveBigInt(raw.reference.byteLength);
    const digest = canonicalDigest(raw.reference.sha256);
    if (ordinal === undefined || byteLength === undefined || digest === undefined) {
      return Result.fail(invalid(operation, "invalid_runtime_object"));
    }
    runtimeObjects.push({
      ordinal,
      codecIdentity: raw.codecIdentity as string,
      reference: {
        storeIdentity: raw.reference.storeIdentity as typeof TASK_RUNTIME_OBJECT_STORE_V1,
        role: raw.reference.role as TaskRuntimeObjectRoleV1,
        objectKey: raw.reference.objectKey as string,
        byteLength,
        sha256: digest,
      },
    });
  }
  const digestFields = [
    "candidateSha256", "taskCatalogBindingSha256",
    "applicationRevisionTaskBindingSha256", "taskCatalogSha256",
    "taskEntryRootSha256", "packageSha256", "artifactSha256",
    "sourceRootSha256", "semanticRootSha256",
  ] as const;
  const digests = new Map<string, TaskDefinitionSha256V1>();
  for (const field of digestFields) {
    const digest = canonicalDigest(input[field]);
    if (digest === undefined) return Result.fail(invalid(operation, "invalid_digest", field));
    digests.set(field, digest);
  }
  const nullable = (field: "taskRuntimeProjectionSha256" | "taskRuntimeGroupManifestSha256" | "taskRuntimeMaterializationSpecSha256") =>
    input[field] === null ? null : canonicalDigest(input[field]);
  const projection = nullable("taskRuntimeProjectionSha256");
  const group = nullable("taskRuntimeGroupManifestSha256");
  const materialization = nullable("taskRuntimeMaterializationSpecSha256");
  if (projection === undefined || group === undefined || materialization === undefined) {
    return Result.fail(invalid(operation, "invalid_digest"));
  }
  return validateReceipt({
    version: input.version as 1,
    scopeId: input.scopeId as string,
    candidateId: input.candidateId as string,
    applicationRevisionId: input.applicationRevisionId as string,
    candidateSha256: digests.get("candidateSha256")!,
    taskCatalogBindingSha256: digests.get("taskCatalogBindingSha256")!,
    applicationRevisionTaskBindingSha256: digests.get("applicationRevisionTaskBindingSha256")!,
    taskCatalogSha256: digests.get("taskCatalogSha256")!,
    taskEntryRootSha256: digests.get("taskEntryRootSha256")!,
    taskRuntimeProjectionSha256: projection,
    taskRuntimeGroupManifestSha256: group,
    taskRuntimeMaterializationSpecSha256: materialization,
    packageSha256: digests.get("packageSha256")!,
    artifactSha256: digests.get("artifactSha256")!,
    sourceRootSha256: digests.get("sourceRootSha256")!,
    semanticRootSha256: digests.get("semanticRootSha256")!,
    runtimeObjects,
  }, operation);
}

function canonicalReceiptBytes<Operation extends
  | "encode_publication_receipt"
  | "decode_publication_receipt"
  | "prepare_publication_receipt">(
  receipt: TaskRuntimePublicationReceiptPreimageV1,
  operation: Operation,
): Result.Result<Uint8Array, InvalidTaskRuntimePublicationV1Error<Operation>> {
  const bytes = UTF8.encode(encodeCanonicalJson({
    codec: TASK_RUNTIME_PUBLICATION_RECEIPT_CODEC_V1,
    receipt: receiptJson(receipt),
  }, issue => {
    throw new TaskRuntimePublicationCanonicalEncodingV1Defect({ operation, issue });
  }));
  return bytes.byteLength <= MAX_TASK_RUNTIME_PUBLICATION_RECEIPT_CANONICAL_BYTES_V1
    ? Result.succeed(bytes)
    : Result.fail(invalid(operation, "canonical_bytes_exceeded", undefined, bytes.byteLength, MAX_TASK_RUNTIME_PUBLICATION_RECEIPT_CANONICAL_BYTES_V1));
}

function receiptJson(receipt: TaskRuntimePublicationReceiptPreimageV1): Json {
  return {
    applicationRevisionId: receipt.applicationRevisionId,
    applicationRevisionTaskBindingSha256: hex(receipt.applicationRevisionTaskBindingSha256),
    artifactSha256: hex(receipt.artifactSha256),
    candidateId: receipt.candidateId,
    candidateSha256: hex(receipt.candidateSha256),
    packageSha256: hex(receipt.packageSha256),
    runtimeObjects: receipt.runtimeObjects.map(item => ({
      codecIdentity: item.codecIdentity,
      ordinal: item.ordinal.toString(10),
      reference: {
        byteLength: item.reference.byteLength.toString(10),
        objectKey: item.reference.objectKey,
        role: item.reference.role,
        sha256: hex(item.reference.sha256),
        storeIdentity: item.reference.storeIdentity,
      },
    })),
    scopeId: receipt.scopeId,
    semanticRootSha256: hex(receipt.semanticRootSha256),
    sourceRootSha256: hex(receipt.sourceRootSha256),
    taskCatalogBindingSha256: hex(receipt.taskCatalogBindingSha256),
    taskCatalogSha256: hex(receipt.taskCatalogSha256),
    taskEntryRootSha256: hex(receipt.taskEntryRootSha256),
    taskRuntimeGroupManifestSha256: nullableHex(receipt.taskRuntimeGroupManifestSha256),
    taskRuntimeMaterializationSpecSha256: nullableHex(receipt.taskRuntimeMaterializationSpecSha256),
    taskRuntimeProjectionSha256: nullableHex(receipt.taskRuntimeProjectionSha256),
    version: 1,
  };
}

function freezeReceipt(receipt: TaskRuntimePublicationReceiptPreimageV1, objects: ReadonlyArray<TaskRuntimePublicationReceiptObjectPreimageV1>): TaskRuntimePublicationReceiptPreimageV1 {
  return Object.freeze({
    ...receipt,
    candidateSha256: copyDigest(receipt.candidateSha256),
    taskCatalogBindingSha256: copyDigest(receipt.taskCatalogBindingSha256),
    applicationRevisionTaskBindingSha256: copyDigest(receipt.applicationRevisionTaskBindingSha256),
    taskCatalogSha256: copyDigest(receipt.taskCatalogSha256),
    taskEntryRootSha256: copyDigest(receipt.taskEntryRootSha256),
    taskRuntimeProjectionSha256: copyNullableDigest(receipt.taskRuntimeProjectionSha256),
    taskRuntimeGroupManifestSha256: copyNullableDigest(receipt.taskRuntimeGroupManifestSha256),
    taskRuntimeMaterializationSpecSha256: copyNullableDigest(receipt.taskRuntimeMaterializationSpecSha256),
    packageSha256: copyDigest(receipt.packageSha256),
    artifactSha256: copyDigest(receipt.artifactSha256),
    sourceRootSha256: copyDigest(receipt.sourceRootSha256),
    semanticRootSha256: copyDigest(receipt.semanticRootSha256),
    runtimeObjects: Object.freeze([...objects]),
  });
}

function copyReceipt(receipt: TaskRuntimePublicationReceiptPreimageV1): TaskRuntimePublicationReceiptPreimageV1 {
  return freezeReceipt(receipt, receipt.runtimeObjects.map(copyReceiptObject));
}

function copyReceiptObject(item: TaskRuntimePublicationReceiptObjectPreimageV1): TaskRuntimePublicationReceiptObjectPreimageV1 {
  return Object.freeze({
    ordinal: item.ordinal,
    codecIdentity: item.codecIdentity,
    reference: Object.freeze({ ...item.reference, sha256: copyDigest(item.reference.sha256) }),
  });
}

function exactDataRecord(input: unknown, keys: ReadonlyArray<string>): Readonly<Record<string, unknown>> | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some(key => typeof key !== "string" || !keys.includes(key))) return undefined;
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    Object.defineProperty(output, key, { enumerable: true, value: descriptor.value });
  }
  return output;
}

function denseDataArray(input: ReadonlyArray<unknown>, maximum: number): ReadonlyArray<unknown> | undefined {
  if (input.length > maximum) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const output: unknown[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    output.push(descriptor.value);
  }
  return Reflect.ownKeys(descriptors).every(key => key === "length" || (typeof key === "string" && /^(?:0|[1-9][0-9]*)$/u.test(key) && Number(key) < input.length)) ? output : undefined;
}

function allDigestsValid(receipt: TaskRuntimePublicationReceiptPreimageV1): boolean {
  return [receipt.candidateSha256, receipt.taskCatalogBindingSha256, receipt.applicationRevisionTaskBindingSha256, receipt.taskCatalogSha256, receipt.taskEntryRootSha256, receipt.packageSha256, receipt.artifactSha256, receipt.sourceRootSha256, receipt.semanticRootSha256].every(value => isUint8ArrayWithByteLength(value, 32)) && [receipt.taskRuntimeProjectionSha256, receipt.taskRuntimeGroupManifestSha256, receipt.taskRuntimeMaterializationSpecSha256].every(value => value === null || isUint8ArrayWithByteLength(value, 32));
}

function singletonDigestMatches(
  objects: ReadonlyArray<TaskRuntimePublicationReceiptObjectPreimageV1>,
  role: TaskRuntimeObjectRoleV1,
  digest: TaskDefinitionSha256V1 | null,
): boolean {
  const item = objects.find(candidate => candidate.reference.role === role);
  return digest !== null && item !== undefined &&
    bytesEqualFullScan(item.reference.sha256, digest);
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value && !CONTROL_CHARACTERS.test(value) && UTF8.encode(value).byteLength <= MAX_IDENTITY_UTF8_BYTES;
}

function codecForRole(role: TaskRuntimeObjectRoleV1): string {
  switch (role) {
    case "runtime_projection_module": return TASK_RUNTIME_PROJECTION_MODULE_CODEC_V1;
    case "task_runtime_projection": return TASK_RUNTIME_PROJECTION_CODEC_V1;
    case "task_runtime_entry": return TASK_RUNTIME_ENTRY_CODEC_V1;
    case "task_runtime_group_manifest": return TASK_RUNTIME_GROUP_MANIFEST_CODEC_V1;
    case "task_runtime_materialization_spec": return TASK_RUNTIME_MATERIALIZATION_SPEC_CODEC_V1;
  }
}

function canonicalDigest(value: Json | undefined): TaskDefinitionSha256V1 | undefined {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) return undefined;
  return Encoding.decodeHex(value).pipe(Result.match({ onFailure: () => undefined, onSuccess: bytes => isUint8ArrayWithByteLength(bytes, 32) ? copyBytes(bytes) as TaskDefinitionSha256V1 : undefined }));
}

function canonicalPositiveBigInt(value: Json | undefined): bigint | undefined {
  return boundedCanonicalBigInt(
    value,
    1n,
    BigInt(MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1),
  );
}

function canonicalNonNegativeBigInt(value: Json | undefined): bigint | undefined {
  return boundedCanonicalBigInt(
    value,
    0n,
    BigInt(MAX_TASK_RUNTIME_PUBLICATION_OBJECTS_V1 - 1),
  );
}

function boundedCanonicalBigInt(
  value: Json | undefined,
  minimum: bigint,
  maximum: bigint,
): bigint | undefined {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return undefined;
  }
  const maximumText = maximum.toString(10);
  if (value.length > maximumText.length ||
    (value.length === maximumText.length && value > maximumText)) {
    return undefined;
  }
  const parsed = BigInt(value);
  return parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

function confirmationsMatch(
  objects: ReadonlyArray<PreparedTaskRuntimeObjectV1>,
  input: unknown,
  publishedObjectStates: WeakMap<object, Readonly<{
    object: PreparedTaskRuntimeObjectV1;
    reference: TaskRuntimeObjectReferenceV1;
  }>>,
): boolean {
  try {
    if (!Array.isArray(input) || input.length !== objects.length) return false;
    const confirmations = denseDataArray(input, objects.length);
    if (confirmations === undefined) return false;
    return objects.every((object, index) => {
      const confirmation = confirmations[index];
      if (typeof confirmation !== "object" || confirmation === null) return false;
      const state = publishedObjectStates.get(confirmation);
      return state !== undefined && state.object === object;
    });
  } catch {
    return false;
  }
}

function captureReference(input: unknown): TaskRuntimeObjectReferenceV1 | undefined {
  const captured = exactDataRecord(input, [
    "storeIdentity", "role", "objectKey", "byteLength", "sha256",
  ]);
  if (captured === undefined ||
    captured.storeIdentity !== TASK_RUNTIME_OBJECT_STORE_V1 ||
    typeof captured.role !== "string" ||
    !ROLE_ORDER.includes(captured.role as TaskRuntimeObjectRoleV1) ||
    typeof captured.objectKey !== "string" ||
    typeof captured.byteLength !== "bigint" ||
    captured.byteLength < 1n ||
    captured.byteLength > BigInt(MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1) ||
    !isUint8ArrayWithByteLength(captured.sha256, 32)) {
    return undefined;
  }
  return Object.freeze({
    storeIdentity: TASK_RUNTIME_OBJECT_STORE_V1,
    role: captured.role as TaskRuntimeObjectRoleV1,
    objectKey: captured.objectKey,
    byteLength: captured.byteLength,
    sha256: copyBytes(captured.sha256) as TaskDefinitionSha256V1,
  });
}

function referencesEqual(
  left: TaskRuntimeObjectReferenceV1,
  right: TaskRuntimeObjectReferenceV1,
): boolean {
  return left.storeIdentity === right.storeIdentity &&
    left.role === right.role && left.objectKey === right.objectKey &&
    left.byteLength === right.byteLength &&
    bytesEqualFullScan(left.sha256, right.sha256);
}

function copyReference(
  reference: TaskRuntimeObjectReferenceV1,
): TaskRuntimeObjectReferenceV1 {
  return Object.freeze({
    ...reference,
    sha256: copyBytes(reference.sha256) as TaskDefinitionSha256V1,
  });
}
function copyDigest(value: unknown): TaskDefinitionSha256V1 { if (!isUint8ArrayWithByteLength(value, 32)) throw new TypeError("invalid digest"); return copyBytes(value) as TaskDefinitionSha256V1; }
function copyNullableDigest(value: unknown): TaskDefinitionSha256V1 | null { return value === null ? null : copyDigest(value); }
function hex(value: TaskDefinitionSha256V1): string { return encodeBytesToLowercaseHex(value); }
function nullableHex(value: TaskDefinitionSha256V1 | null): string | null { return value === null ? null : hex(value); }
function hasExactKeys(value: Readonly<Record<string, Json>>, keys: ReadonlyArray<string>): boolean { const actual = Object.keys(value); return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function invalid<Operation extends "encode_publication_receipt" | "decode_publication_receipt" | "prepare_publication_receipt">(operation: Operation, reason: ConstructorParameters<typeof InvalidTaskRuntimePublicationV1Error<Operation>>[0]["reason"], path?: string, observed?: number, maximum?: number): InvalidTaskRuntimePublicationV1Error<Operation> { return new InvalidTaskRuntimePublicationV1Error({ operation, reason, ...(path === undefined ? {} : { path }), ...(observed === undefined ? {} : { observed }), ...(maximum === undefined ? {} : { maximum }) }); }
