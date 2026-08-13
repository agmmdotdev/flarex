import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8Array,
  isUint8ArrayWithByteLength,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { Encoding, Result } from "effect";
import {
  encodeCanonicalJson,
  isJsonObjectFromUnknown,
  type Json,
} from "flarex-protocol/json";

import {
  InvalidTaskRuntimePublicationError,
  TaskRuntimePublicationCanonicalEncodingDefect,
  type TaskRuntimePublicationOperation,
  type TaskRuntimePublicationReason,
} from "./RuntimePublicationErrors.js";
import {
  MAX_TASK_CATALOG_ENTRIES_V1,
  MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  MAX_TASK_RUNTIME_MODULES_V1,
  MAX_TASK_RUNTIME_MODULE_SOURCE_BYTES_V1,
  TASK_RUNTIME_ENTRY_ROOT_CODEC_V1,
  TASK_RUNTIME_GROUP_MANIFEST_CODEC_V1,
  TASK_RUNTIME_MATERIALIZATION_SPEC_CODEC_V1,
  TASK_RUNTIME_MODULE_ROOT_CODEC_V1,
  TASK_RUNTIME_PROJECTION_CODEC_V1,
  TASK_RUNTIME_PROJECTION_MODULE_CODEC_V1,
  type TaskDefinitionSha256V1,
  type TaskRuntimeGroupManifestFrameV1,
  type TaskRuntimeMaterializationSpecV1,
  type TaskRuntimeProjectionFrameV1,
  type TaskRuntimeProjectionModuleFrameV1,
} from "./Model.js";
import {
  decodeTaskRuntimeGroupManifestFrameV1,
  decodeTaskRuntimeMaterializationSpecV1,
  decodeTaskRuntimeProjectionFrameV1,
  decodeTaskRuntimeProjectionModuleFrameV1,
} from "./RuntimePublicationSchema.js";

const UTF8 = new TextEncoder();
const FATAL_UTF8 = new TextDecoder("utf-8", { fatal: true });

export function encodeTaskRuntimeProjectionModulePreimageV1(
  input: unknown,
): Result.Result<
  Uint8Array,
  InvalidTaskRuntimePublicationError<"encode_projection_module">
> {
  return decodeTaskRuntimeProjectionModuleFrameV1(input).pipe(
    Result.mapError((failure) => reoperation(failure, "encode_projection_module")),
    Result.flatMap((frame) => canonicalBytes({
      codec: TASK_RUNTIME_PROJECTION_MODULE_CODEC_V1,
      frame: projectionModuleJson(frame),
    }, "encode_projection_module")),
  );
}

export function decodeTaskRuntimeProjectionModulePreimageV1(
  input: unknown,
): Result.Result<
  TaskRuntimeProjectionModuleFrameV1,
  InvalidTaskRuntimePublicationError<"decode_projection_module_preimage">
> {
  const operation = "decode_projection_module_preimage" as const;
  return Result.gen(function* () {
    const decoded = yield* parseCanonicalEnvelope(
      input,
      operation,
      TASK_RUNTIME_PROJECTION_MODULE_CODEC_V1,
      [
        "artifactModulePath",
        "group",
        "kind",
        "moduleFormat",
        "moduleOrdinal",
        "rawByteLength",
        "sourceBytes",
        "sourceEnvironment",
        "sourceRoles",
        "sourceSha256",
      ],
    );
    const frame = decoded.frame;
    const moduleOrdinal = decodeCanonicalNonNegativeBigInt(frame.moduleOrdinal);
    const sourceRoles = decodeCanonicalPositiveSafeInteger(frame.sourceRoles);
    const rawByteLength = decodeCanonicalNonNegativeBigInt(frame.rawByteLength);
    const sourceSha256 = decodeCanonicalDigest(frame.sourceSha256);
    const sourceBytes = yield* decodeCanonicalSourceBytes(
      frame.sourceBytes,
      operation,
    );
    if (
      moduleOrdinal === undefined || sourceRoles === undefined ||
      rawByteLength === undefined || sourceSha256 === undefined
    ) {
      return yield* Result.fail(invalid(operation, "invalid_shape"));
    }
    const value = yield* decodeTaskRuntimeProjectionModuleFrameV1({
      artifactModulePath: frame.artifactModulePath,
      group: frame.group,
      kind: frame.kind,
      moduleFormat: frame.moduleFormat,
      moduleOrdinal,
      rawByteLength,
      sourceBytes,
      sourceEnvironment: frame.sourceEnvironment,
      sourceRoles,
      sourceSha256,
    }).pipe(Result.mapError((failure) => reoperation(failure, operation)));
    const canonical = yield* encodeTaskRuntimeProjectionModulePreimageV1(value)
      .pipe(Result.mapError((failure) => reoperation(failure, operation)));
    if (!bytesEqualFullScan(canonical, decoded.bytes)) {
      return yield* Result.fail(invalid(operation, "noncanonical_preimage"));
    }
    return value;
  });
}

export function encodeTaskRuntimeProjectionPreimageV1(
  input: unknown,
): Result.Result<
  Uint8Array,
  InvalidTaskRuntimePublicationError<"encode_projection">
> {
  return decodeTaskRuntimeProjectionFrameV1(input).pipe(
    Result.mapError((failure) => reoperation(failure, "encode_projection")),
    Result.flatMap((frame) => canonicalBytes({
      codec: TASK_RUNTIME_PROJECTION_CODEC_V1,
      frame: projectionJson(frame),
    }, "encode_projection")),
  );
}

export function decodeTaskRuntimeProjectionPreimageV1(
  input: unknown,
): Result.Result<
  TaskRuntimeProjectionFrameV1,
  InvalidTaskRuntimePublicationError<"decode_projection_preimage">
> {
  const operation = "decode_projection_preimage" as const;
  return Result.gen(function* () {
    const decoded = yield* parseCanonicalEnvelope(
      input,
      operation,
      TASK_RUNTIME_PROJECTION_CODEC_V1,
      [
        "executionModule",
        "group",
        "kind",
        "moduleCount",
        "moduleRootSha256",
        "rawByteLength",
      ],
    );
    const moduleCount = decodeCanonicalPositiveBigInt(decoded.frame.moduleCount);
    const rawByteLength = decodeCanonicalNonNegativeBigInt(
      decoded.frame.rawByteLength,
    );
    const moduleRootSha256 = decodeCanonicalDigest(
      decoded.frame.moduleRootSha256,
    );
    if (
      moduleCount === undefined || rawByteLength === undefined ||
      moduleRootSha256 === undefined
    ) {
      return yield* Result.fail(invalid(operation, "invalid_shape"));
    }
    const value = yield* decodeTaskRuntimeProjectionFrameV1({
      executionModule: decoded.frame.executionModule,
      group: decoded.frame.group,
      kind: decoded.frame.kind,
      moduleCount,
      moduleRootSha256,
      rawByteLength,
    }).pipe(Result.mapError((failure) => reoperation(failure, operation)));
    yield* requireCanonical(
      decoded.bytes,
      encodeTaskRuntimeProjectionPreimageV1(value),
      operation,
    );
    return value;
  });
}

export function encodeTaskRuntimeGroupManifestPreimageV1(
  input: unknown,
): Result.Result<
  Uint8Array,
  InvalidTaskRuntimePublicationError<"encode_group_manifest">
> {
  return decodeTaskRuntimeGroupManifestFrameV1(input).pipe(
    Result.mapError((failure) => reoperation(failure, "encode_group_manifest")),
    Result.flatMap((frame) => canonicalBytes({
      codec: TASK_RUNTIME_GROUP_MANIFEST_CODEC_V1,
      frame: groupManifestJson(frame),
    }, "encode_group_manifest")),
  );
}

export function decodeTaskRuntimeGroupManifestPreimageV1(
  input: unknown,
): Result.Result<
  TaskRuntimeGroupManifestFrameV1,
  InvalidTaskRuntimePublicationError<"decode_group_manifest_preimage">
> {
  const operation = "decode_group_manifest_preimage" as const;
  return Result.gen(function* () {
    const decoded = yield* parseCanonicalEnvelope(
      input,
      operation,
      TASK_RUNTIME_GROUP_MANIFEST_CODEC_V1,
      [
        "kind",
        "taskCatalogSha256",
        "taskCount",
        "taskEntryRootSha256",
        "taskRuntimeMaterializationSpecSha256",
        "taskRuntimeProjectionSha256",
      ],
    );
    const taskCount = decodeCanonicalPositiveBigInt(decoded.frame.taskCount);
    const taskCatalogSha256 = decodeCanonicalDigest(
      decoded.frame.taskCatalogSha256,
    );
    const taskEntryRootSha256 = decodeCanonicalDigest(
      decoded.frame.taskEntryRootSha256,
    );
    const taskRuntimeProjectionSha256 = decodeCanonicalDigest(
      decoded.frame.taskRuntimeProjectionSha256,
    );
    const taskRuntimeMaterializationSpecSha256 = decodeCanonicalDigest(
      decoded.frame.taskRuntimeMaterializationSpecSha256,
    );
    if (
      taskCount === undefined || taskCatalogSha256 === undefined ||
      taskEntryRootSha256 === undefined ||
      taskRuntimeProjectionSha256 === undefined ||
      taskRuntimeMaterializationSpecSha256 === undefined
    ) {
      return yield* Result.fail(invalid(operation, "invalid_shape"));
    }
    const value = yield* decodeTaskRuntimeGroupManifestFrameV1({
      kind: decoded.frame.kind,
      taskCatalogSha256,
      taskCount,
      taskEntryRootSha256,
      taskRuntimeMaterializationSpecSha256,
      taskRuntimeProjectionSha256,
    }).pipe(Result.mapError((failure) => reoperation(failure, operation)));
    yield* requireCanonical(
      decoded.bytes,
      encodeTaskRuntimeGroupManifestPreimageV1(value),
      operation,
    );
    return value;
  });
}

export function encodeTaskRuntimeMaterializationSpecPreimageV1(
  input: unknown,
): Result.Result<
  Uint8Array,
  InvalidTaskRuntimePublicationError<"encode_materialization_spec">
> {
  return decodeTaskRuntimeMaterializationSpecV1(input).pipe(
    Result.mapError((failure) => reoperation(
      failure,
      "encode_materialization_spec",
    )),
    Result.flatMap((spec) => canonicalBytes({
      codec: TASK_RUNTIME_MATERIALIZATION_SPEC_CODEC_V1,
      spec: materializationSpecJson(spec),
    }, "encode_materialization_spec")),
  );
}

export function decodeTaskRuntimeMaterializationSpecPreimageV1(
  input: unknown,
): Result.Result<
  TaskRuntimeMaterializationSpecV1,
  InvalidTaskRuntimePublicationError<
    "decode_materialization_spec_preimage"
  >
> {
  const operation = "decode_materialization_spec_preimage" as const;
  return Result.gen(function* () {
    const decoded = yield* parseCanonicalNamedEnvelope(
      input,
      operation,
      TASK_RUNTIME_MATERIALIZATION_SPEC_CODEC_V1,
      "spec",
      [
        "bridgeAbiIdentity",
        "compatibilityDate",
        "compatibilityFlags",
        "kind",
        "moduleEntryPolicyIdentity",
        "runtimeContractIdentity",
        "runtimeImplementationVersion",
        "runtimeProfileIdentity",
        "supportedComputeProfiles",
      ],
    );
    const value = yield* decodeTaskRuntimeMaterializationSpecV1(decoded.value)
      .pipe(Result.mapError((failure) => reoperation(failure, operation)));
    yield* requireCanonical(
      decoded.bytes,
      encodeTaskRuntimeMaterializationSpecPreimageV1(value),
      operation,
    );
    return value;
  });
}

export function encodeTaskRuntimeModuleRootPreimageV1(
  input: unknown,
): Result.Result<
  Uint8Array,
  InvalidTaskRuntimePublicationError<"encode_module_root">
> {
  return decodeDigestList(
    input,
    "encode_module_root",
    MAX_TASK_RUNTIME_MODULES_V1,
    false,
  ).pipe(Result.flatMap((digests) => canonicalBytes({
    codec: TASK_RUNTIME_MODULE_ROOT_CODEC_V1,
    digests: digests.map(hex),
  }, "encode_module_root")));
}

export function decodeTaskRuntimeModuleRootPreimageV1(
  input: unknown,
): Result.Result<
  ReadonlyArray<TaskDefinitionSha256V1>,
  InvalidTaskRuntimePublicationError<"decode_module_root_preimage">
> {
  return decodeRootPreimage(
    input,
    "decode_module_root_preimage",
    TASK_RUNTIME_MODULE_ROOT_CODEC_V1,
    MAX_TASK_RUNTIME_MODULES_V1,
    false,
    encodeTaskRuntimeModuleRootPreimageV1,
  );
}

export function encodeTaskRuntimeEntryRootPreimageV1(
  input: unknown,
): Result.Result<
  Uint8Array,
  InvalidTaskRuntimePublicationError<"encode_entry_root">
> {
  return decodeDigestList(
    input,
    "encode_entry_root",
    MAX_TASK_CATALOG_ENTRIES_V1,
    true,
  ).pipe(Result.flatMap((digests) => canonicalBytes({
    codec: TASK_RUNTIME_ENTRY_ROOT_CODEC_V1,
    digests: digests.map(hex),
  }, "encode_entry_root")));
}

export function decodeTaskRuntimeEntryRootPreimageV1(
  input: unknown,
): Result.Result<
  ReadonlyArray<TaskDefinitionSha256V1>,
  InvalidTaskRuntimePublicationError<"decode_entry_root_preimage">
> {
  return decodeRootPreimage(
    input,
    "decode_entry_root_preimage",
    TASK_RUNTIME_ENTRY_ROOT_CODEC_V1,
    MAX_TASK_CATALOG_ENTRIES_V1,
    true,
    encodeTaskRuntimeEntryRootPreimageV1,
  );
}

function projectionModuleJson(frame: TaskRuntimeProjectionModuleFrameV1): Json {
  return {
    artifactModulePath: frame.artifactModulePath,
    group: "durable_task",
    kind: "runtime_projection_module",
    moduleFormat: "es_module",
    moduleOrdinal: frame.moduleOrdinal.toString(10),
    rawByteLength: frame.rawByteLength.toString(10),
    sourceBytes: Encoding.encodeBase64Url(frame.sourceBytes),
    sourceEnvironment: "isolate",
    sourceRoles: frame.sourceRoles.toString(10),
    sourceSha256: hex(frame.sourceSha256),
  };
}

function projectionJson(frame: TaskRuntimeProjectionFrameV1): Json {
  return {
    executionModule: frame.executionModule,
    group: "durable_task",
    kind: "task_runtime_projection",
    moduleCount: frame.moduleCount.toString(10),
    moduleRootSha256: hex(frame.moduleRootSha256),
    rawByteLength: frame.rawByteLength.toString(10),
  };
}

function groupManifestJson(frame: TaskRuntimeGroupManifestFrameV1): Json {
  return {
    kind: "task_runtime_group_manifest",
    taskCatalogSha256: hex(frame.taskCatalogSha256),
    taskCount: frame.taskCount.toString(10),
    taskEntryRootSha256: hex(frame.taskEntryRootSha256),
    taskRuntimeMaterializationSpecSha256:
      hex(frame.taskRuntimeMaterializationSpecSha256),
    taskRuntimeProjectionSha256: hex(frame.taskRuntimeProjectionSha256),
  };
}

function materializationSpecJson(spec: TaskRuntimeMaterializationSpecV1): Json {
  return {
    bridgeAbiIdentity: spec.bridgeAbiIdentity,
    compatibilityDate: spec.compatibilityDate,
    compatibilityFlags: [...spec.compatibilityFlags],
    kind: "task_runtime_materialization_spec",
    moduleEntryPolicyIdentity: spec.moduleEntryPolicyIdentity,
    runtimeContractIdentity: spec.runtimeContractIdentity,
    runtimeImplementationVersion: spec.runtimeImplementationVersion,
    runtimeProfileIdentity: spec.runtimeProfileIdentity,
    supportedComputeProfiles: [...spec.supportedComputeProfiles],
  };
}

function parseCanonicalEnvelope<Operation extends TaskRuntimePublicationOperation>(
  input: unknown,
  operation: Operation,
  codec: string,
  frameKeys: ReadonlyArray<string>,
): Result.Result<
  Readonly<{
    readonly bytes: Uint8Array;
    readonly frame: Readonly<Record<string, Json>>;
  }>,
  InvalidTaskRuntimePublicationError<Operation>
> {
  return parseCanonicalNamedEnvelope(
    input,
    operation,
    codec,
    "frame",
    frameKeys,
  ).pipe(Result.map((parsed) => ({
    bytes: parsed.bytes,
    frame: parsed.value,
  })));
}

function parseCanonicalNamedEnvelope<
  Operation extends TaskRuntimePublicationOperation,
>(
  input: unknown,
  operation: Operation,
  codec: string,
  valueKey: "frame" | "spec",
  valueKeys: ReadonlyArray<string>,
): Result.Result<
  Readonly<{
    readonly bytes: Uint8Array;
    readonly value: Readonly<Record<string, Json>>;
  }>,
  InvalidTaskRuntimePublicationError<Operation>
> {
  return Result.gen(function* () {
    const bytes = yield* captureCanonicalInput(input, operation);
    const parsed = yield* Result.try({
      try: () => JSON.parse(FATAL_UTF8.decode(bytes)) as unknown,
      catch: () => invalid(operation, "invalid_shape"),
    });
    if (
      !isJsonObjectFromUnknown(parsed) ||
      !hasExactKeys(parsed, ["codec", valueKey]) || parsed.codec !== codec
    ) {
      return yield* Result.fail(invalid(operation, "invalid_shape"));
    }
    const value = parsed[valueKey];
    if (!isJsonObjectFromUnknown(value) || !hasExactKeys(value, valueKeys)) {
      return yield* Result.fail(invalid(operation, "invalid_shape"));
    }
    return Object.freeze({ bytes, value });
  });
}

function decodeRootPreimage<Operation extends
  | "decode_module_root_preimage"
  | "decode_entry_root_preimage">(
  input: unknown,
  operation: Operation,
  codec: string,
  maximum: number,
  allowEmpty: boolean,
  encode: (input: unknown) => Result.Result<Uint8Array, InvalidTaskRuntimePublicationError>,
): Result.Result<
  ReadonlyArray<TaskDefinitionSha256V1>,
  InvalidTaskRuntimePublicationError<Operation>
> {
  return Result.gen(function* () {
    const bytes = yield* captureCanonicalInput(input, operation);
    const parsed = yield* Result.try({
      try: () => JSON.parse(FATAL_UTF8.decode(bytes)) as unknown,
      catch: () => invalid(operation, "invalid_shape"),
    });
    if (
      !isJsonObjectFromUnknown(parsed) ||
      !hasExactKeys(parsed, ["codec", "digests"]) || parsed.codec !== codec ||
      !Array.isArray(parsed.digests) || parsed.digests.length > maximum ||
      (!allowEmpty && parsed.digests.length === 0)
    ) {
      return yield* Result.fail(invalid(operation, "invalid_shape"));
    }
    const digests: TaskDefinitionSha256V1[] = [];
    for (const item of parsed.digests) {
      const digest = decodeCanonicalDigest(item);
      if (digest === undefined) {
        return yield* Result.fail(invalid(operation, "invalid_digest"));
      }
      digests.push(digest);
    }
    const canonical = yield* encode(digests).pipe(
      Result.mapError((failure) => reoperation(failure, operation)),
    );
    if (!bytesEqualFullScan(bytes, canonical)) {
      return yield* Result.fail(invalid(operation, "noncanonical_preimage"));
    }
    return Object.freeze(digests);
  });
}

function decodeDigestList<Operation extends
  | "encode_module_root"
  | "encode_entry_root">(
  input: unknown,
  operation: Operation,
  maximum: number,
  allowEmpty: boolean,
): Result.Result<
  ReadonlyArray<TaskDefinitionSha256V1>,
  InvalidTaskRuntimePublicationError<Operation>
> {
  try {
    if (
      !Array.isArray(input) || input.length > maximum ||
      (!allowEmpty && input.length === 0)
    ) {
      return Result.fail(invalid(operation, "invalid_root"));
    }
    const digests: TaskDefinitionSha256V1[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor) ||
        !isUint8ArrayWithByteLength(descriptor.value, 32)
      ) {
        return Result.fail(invalid(operation, "invalid_digest", `[${index}]`));
      }
      const digest = copyBytes(descriptor.value) as TaskDefinitionSha256V1;
      digests.push(digest);
    }
    return Result.succeed(Object.freeze(digests));
  } catch {
    return Result.fail(invalid(operation, "invalid_root"));
  }
}

function captureCanonicalInput<Operation extends TaskRuntimePublicationOperation>(
  input: unknown,
  operation: Operation,
): Result.Result<Uint8Array, InvalidTaskRuntimePublicationError<Operation>> {
  const byteLength = uint8ArrayByteLength(input);
  if (
    byteLength === undefined || byteLength > MAX_TASK_DEFINITION_CANONICAL_BYTES_V1
  ) {
    return Result.fail(invalid(
      operation,
      "invalid_shape",
      undefined,
      byteLength,
      MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
    ));
  }
  return Result.try({
    try: () => copyBytes(input as Uint8Array),
    catch: () => invalid(operation, "invalid_shape"),
  });
}

function decodeCanonicalSourceBytes<Operation extends TaskRuntimePublicationOperation>(
  input: Json | undefined,
  operation: Operation,
): Result.Result<Uint8Array, InvalidTaskRuntimePublicationError<Operation>> {
  if (typeof input !== "string") {
    return Result.fail(invalid(operation, "invalid_source_bytes"));
  }
  if (input === "") return Result.succeed(new Uint8Array());
  const maximumEncodedLength = Math.ceil(
    MAX_TASK_RUNTIME_MODULE_SOURCE_BYTES_V1 * 4 / 3,
  );
  if (
    input.length > maximumEncodedLength || input.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/u.test(input)
  ) {
    return Result.fail(invalid(operation, "invalid_source_bytes"));
  }
  return Encoding.decodeBase64Url(input).pipe(
    Result.mapError(() => invalid(operation, "invalid_source_bytes")),
    Result.flatMap((bytes) => {
      return isUint8Array(bytes) &&
          bytes.byteLength <= MAX_TASK_RUNTIME_MODULE_SOURCE_BYTES_V1 &&
          Encoding.encodeBase64Url(bytes) === input
        ? Result.succeed(bytes)
        : Result.fail(invalid(operation, "invalid_source_bytes"));
    }),
  );
}

function requireCanonical<Operation extends TaskRuntimePublicationOperation>(
  input: Uint8Array,
  encoded: Result.Result<Uint8Array, InvalidTaskRuntimePublicationError>,
  operation: Operation,
): Result.Result<void, InvalidTaskRuntimePublicationError<Operation>> {
  return encoded.pipe(
    Result.mapError((failure) => reoperation(failure, operation)),
    Result.flatMap((canonical) => bytesEqualFullScan(input, canonical)
      ? Result.succeed(undefined)
      : Result.fail(invalid(operation, "noncanonical_preimage"))),
  );
}

function canonicalBytes<Operation extends TaskRuntimePublicationOperation>(
  value: Json,
  operation: Operation,
): Result.Result<Uint8Array, InvalidTaskRuntimePublicationError<Operation>> {
  const bytes = UTF8.encode(encodeCanonicalJson(value, (issue) => {
    throw new TaskRuntimePublicationCanonicalEncodingDefect({
      operation,
      issue,
    });
  }));
  return bytes.byteLength <= MAX_TASK_DEFINITION_CANONICAL_BYTES_V1
    ? Result.succeed(bytes)
    : Result.fail(invalid(
      operation,
      "canonical_bytes_exceeded",
      undefined,
      bytes.byteLength,
      MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
    ));
}

function decodeCanonicalPositiveBigInt(value: Json | undefined): bigint | undefined {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value)
    ? safeBigInt(value)
    : undefined;
}

function decodeCanonicalPositiveSafeInteger(
  value: Json | undefined,
): number | undefined {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    return undefined;
  }
  const decoded = Number(value);
  return Number.isSafeInteger(decoded) ? decoded : undefined;
}

function decodeCanonicalNonNegativeBigInt(
  value: Json | undefined,
): bigint | undefined {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)
    ? safeBigInt(value)
    : undefined;
}

function safeBigInt(value: string): bigint | undefined {
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function decodeCanonicalDigest(
  value: Json | undefined,
): TaskDefinitionSha256V1 | undefined {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    return undefined;
  }
  const decoded = Encoding.decodeHex(value);
  return Result.match(decoded, {
    onFailure: () => undefined,
    onSuccess: (bytes) => isUint8ArrayWithByteLength(bytes, 32)
      ? copyBytes(bytes) as TaskDefinitionSha256V1
      : undefined,
  });
}

function hasExactKeys(
  value: Readonly<Record<string, Json>>,
  expected: ReadonlyArray<string>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key));
}

function hex(value: TaskDefinitionSha256V1): string {
  return encodeBytesToLowercaseHex(value);
}

function reoperation<Operation extends TaskRuntimePublicationOperation>(
  failure: InvalidTaskRuntimePublicationError,
  operation: Operation,
): InvalidTaskRuntimePublicationError<Operation> {
  return new InvalidTaskRuntimePublicationError({
    operation,
    reason: failure.reason,
    ...(failure.path === undefined ? {} : { path: failure.path }),
    ...(failure.observed === undefined ? {} : { observed: failure.observed }),
    ...(failure.maximum === undefined ? {} : { maximum: failure.maximum }),
  });
}

function invalid<Operation extends TaskRuntimePublicationOperation>(
  operation: Operation,
  reason: TaskRuntimePublicationReason,
  path?: string,
  observed?: number,
  maximum?: number,
): InvalidTaskRuntimePublicationError<Operation> {
  return new InvalidTaskRuntimePublicationError({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}
