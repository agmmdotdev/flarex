import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8Array,
} from "@flarex/utils/bytes";
import { Encoding, Result } from "effect";
import {
  encodeCanonicalJson,
  isJsonObjectFromUnknown,
  type Json,
} from "flarex-protocol/json";

import {
  MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  type TaskDefinitionSha256V1,
} from "./Model.js";
import {
  InvalidTaskRuntimeFamilyV1Error,
  TaskRuntimeFamilyCanonicalEncodingV1Defect,
  type TaskRuntimeFamilyFailureReasonV1,
  type TaskRuntimeFamilyOperationV1,
} from "./RuntimeFamilyErrors.js";
import {
  NODE_TASK_RUNTIME_ARTIFACT_CODEC_V1,
  TASK_RUNTIME_COMPUTE_PROFILE_CATALOG_CODEC_V1,
  type NodeTaskRuntimeArtifactObjectReferenceV1,
  type NodeTaskRuntimeArtifactV1,
  type TaskRuntimeComputeProfileCatalogV1,
} from "./RuntimeFamilyModel.js";
import {
  decodeNodeTaskRuntimeArtifactV1,
  decodeTaskRuntimeComputeProfileCatalogV1,
} from "./RuntimeFamilySchema.js";

const UTF8 = new TextEncoder();
const FATAL_UTF8 = new TextDecoder("utf-8", { fatal: true });
const CANONICAL_NON_NEGATIVE_BIGINT = /^(?:0|[1-9][0-9]*)$/u;

export function encodeTaskRuntimeComputeProfileCatalogPreimageV1(
  input: unknown,
): Result.Result<
  Uint8Array,
  InvalidTaskRuntimeFamilyV1Error<"encode_compute_profile_catalog">
> {
  const operation = "encode_compute_profile_catalog" as const;
  return decodeTaskRuntimeComputeProfileCatalogV1(input).pipe(
    Result.mapError(error => reoperation(error, operation)),
    Result.flatMap(value => canonicalBytes({
      codec: TASK_RUNTIME_COMPUTE_PROFILE_CATALOG_CODEC_V1,
      value: catalogJson(value),
    }, operation)),
  );
}

export function decodeTaskRuntimeComputeProfileCatalogPreimageV1(
  input: unknown,
): Result.Result<
  TaskRuntimeComputeProfileCatalogV1,
  InvalidTaskRuntimeFamilyV1Error<"decode_compute_profile_catalog_preimage">
> {
  const operation = "decode_compute_profile_catalog_preimage" as const;
  return Result.gen(function* () {
    const envelope = yield* parseEnvelope(
      input,
      TASK_RUNTIME_COMPUTE_PROFILE_CATALOG_CODEC_V1,
      operation,
    );
    const value = yield* decodeTaskRuntimeComputeProfileCatalogV1(
      envelope.value,
    ).pipe(Result.mapError(error => reoperation(error, operation)));
    const canonical = yield* encodeTaskRuntimeComputeProfileCatalogPreimageV1(
      value,
    ).pipe(Result.mapError(error => reoperation(error, operation)));
    if (!bytesEqualFullScan(canonical, envelope.bytes)) {
      return yield* Result.fail(invalid(operation, "noncanonical_preimage"));
    }
    return value;
  });
}

export function encodeNodeTaskRuntimeArtifactPreimageV1(
  input: unknown,
): Result.Result<
  Uint8Array,
  InvalidTaskRuntimeFamilyV1Error<"encode_node_artifact">
> {
  const operation = "encode_node_artifact" as const;
  return decodeNodeTaskRuntimeArtifactV1(input).pipe(
    Result.mapError(error => reoperation(error, operation)),
    Result.flatMap(value => canonicalBytes({
      codec: NODE_TASK_RUNTIME_ARTIFACT_CODEC_V1,
      value: nodeArtifactJson(value),
    }, operation)),
  );
}

export function decodeNodeTaskRuntimeArtifactPreimageV1(
  input: unknown,
): Result.Result<
  NodeTaskRuntimeArtifactV1,
  InvalidTaskRuntimeFamilyV1Error<"decode_node_artifact_preimage">
> {
  const operation = "decode_node_artifact_preimage" as const;
  return Result.gen(function* () {
    const envelope = yield* parseEnvelope(
      input,
      NODE_TASK_RUNTIME_ARTIFACT_CODEC_V1,
      operation,
    );
    const decodedInput = nodeArtifactFromJson(envelope.value);
    if (decodedInput === undefined) {
      return yield* Result.fail(invalid(operation, "invalid_shape"));
    }
    const value = yield* decodeNodeTaskRuntimeArtifactV1(decodedInput).pipe(
      Result.mapError(error => reoperation(error, operation)),
    );
    const canonical = yield* encodeNodeTaskRuntimeArtifactPreimageV1(value)
      .pipe(Result.mapError(error => reoperation(error, operation)));
    if (!bytesEqualFullScan(canonical, envelope.bytes)) {
      return yield* Result.fail(invalid(operation, "noncanonical_preimage"));
    }
    return value;
  });
}

function catalogJson(value: TaskRuntimeComputeProfileCatalogV1): Json {
  return {
    version: value.version,
    profiles: value.profiles.map(profile => ({
      computeProfile: profile.computeProfile,
      runtimeFamily: profile.runtimeFamily,
      runtimeContractIdentity: profile.runtimeContractIdentity,
      bridgeAbiIdentity: profile.bridgeAbiIdentity,
      runtimeProfileIdentity: profile.runtimeProfileIdentity,
      resourceClassIdentity: profile.resourceClassIdentity,
      maximumDurationInSeconds: profile.maximumDurationInSeconds,
      capabilities: { ...profile.capabilities },
      provider: { ...profile.provider },
    })),
  };
}

function nodeArtifactJson(value: NodeTaskRuntimeArtifactV1): Json {
  return {
    version: value.version,
    kind: value.kind,
    runtimeFamily: value.runtimeFamily,
    runtimeContractIdentity: value.runtimeContractIdentity,
    bridgeAbiIdentity: value.bridgeAbiIdentity,
    runtimeProfileIdentity: value.runtimeProfileIdentity,
    moduleEntryPolicyIdentity: value.moduleEntryPolicyIdentity,
    nodeRuntimeAbiIdentity: value.nodeRuntimeAbiIdentity,
    moduleFormat: value.moduleFormat,
    architecturePolicy: value.architecturePolicy,
    nativeModules: value.nativeModules,
    applicationRevisionId: value.applicationRevisionId,
    candidateSha256: hex(value.candidateSha256),
    taskId: value.taskId,
    canonicalTaskManifestSha256: hex(value.canonicalTaskManifestSha256),
    computeProfileCatalogSha256: hex(value.computeProfileCatalogSha256),
    handler: { ...value.handler },
    executionModule: value.executionModule,
    modules: value.modules.map(module => ({
      moduleOrdinal: module.moduleOrdinal.toString(10),
      artifactModulePath: module.artifactModulePath,
      sourceRoles: module.sourceRoles,
      rawByteLength: module.rawByteLength.toString(10),
      sourceSha256: hex(module.sourceSha256),
    })),
    bundle: referenceJson(value.bundle),
    dependencies: value.dependencies === null
      ? null
      : referenceJson(value.dependencies),
    supportedComputeProfiles: [...value.supportedComputeProfiles],
  };
}

function referenceJson(value: NodeTaskRuntimeArtifactObjectReferenceV1): Json {
  return {
    storeIdentity: value.storeIdentity,
    kind: value.kind,
    codecIdentity: value.codecIdentity,
    objectKey: value.objectKey,
    byteLength: value.byteLength.toString(10),
    sha256: hex(value.sha256),
  };
}

function nodeArtifactFromJson(value: Json): unknown | undefined {
  if (!isJsonObjectFromUnknown(value)) return undefined;
  const modules = Array.isArray(value.modules)
    ? value.modules.map(module => {
      if (!isJsonObjectFromUnknown(module)) return undefined;
      const moduleOrdinal = bigintFromJson(module.moduleOrdinal);
      const rawByteLength = bigintFromJson(module.rawByteLength);
      const sourceSha256 = digestFromJson(module.sourceSha256);
      return moduleOrdinal === undefined || rawByteLength === undefined ||
          sourceSha256 === undefined
        ? undefined
        : { ...module, moduleOrdinal, rawByteLength, sourceSha256 };
    })
    : undefined;
  if (modules === undefined || modules.includes(undefined)) return undefined;
  const candidateSha256 = digestFromJson(value.candidateSha256);
  const canonicalTaskManifestSha256 = digestFromJson(
    value.canonicalTaskManifestSha256,
  );
  const computeProfileCatalogSha256 = digestFromJson(
    value.computeProfileCatalogSha256,
  );
  const bundle = referenceFromJson(value.bundle);
  const dependencies = value.dependencies === null
    ? null
    : referenceFromJson(value.dependencies);
  if (
    candidateSha256 === undefined || canonicalTaskManifestSha256 === undefined ||
    computeProfileCatalogSha256 === undefined ||
    bundle === undefined || dependencies === undefined
  ) return undefined;
  return {
    ...value,
    candidateSha256,
    canonicalTaskManifestSha256,
    computeProfileCatalogSha256,
    modules,
    bundle,
    dependencies,
  };
}

function referenceFromJson(value: Json | undefined): unknown | undefined {
  if (!isJsonObjectFromUnknown(value)) return undefined;
  const byteLength = bigintFromJson(value.byteLength);
  const sha256 = digestFromJson(value.sha256);
  return byteLength === undefined || sha256 === undefined
    ? undefined
    : { ...value, byteLength, sha256 };
}

function bigintFromJson(value: Json | undefined): bigint | undefined {
  if (typeof value !== "string" || !CANONICAL_NON_NEGATIVE_BIGINT.test(value)) {
    return undefined;
  }
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function digestFromJson(
  value: Json | undefined,
): TaskDefinitionSha256V1 | undefined {
  if (typeof value !== "string" || value.length !== 64) return undefined;
  const decoded = Encoding.decodeHex(value);
  return Result.isSuccess(decoded) && decoded.success.byteLength === 32
    ? decoded.success as TaskDefinitionSha256V1
    : undefined;
}

function parseEnvelope<Operation extends TaskRuntimeFamilyOperationV1>(
  input: unknown,
  expectedCodec: string,
  operation: Operation,
): Result.Result<
  { readonly bytes: Uint8Array; readonly value: Json },
  InvalidTaskRuntimeFamilyV1Error<Operation>
> {
  if (!isUint8Array(input)) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  if (input.byteLength > MAX_TASK_DEFINITION_CANONICAL_BYTES_V1) {
    return Result.fail(invalid(
      operation,
      "canonical_bytes_exceeded",
      undefined,
      input.byteLength,
      MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
    ));
  }
  return Result.try({
    try: () => {
      const parsed: unknown = JSON.parse(FATAL_UTF8.decode(input));
      if (
        !isJsonObjectFromUnknown(parsed) ||
        Object.keys(parsed).length !== 2 ||
        parsed.codec !== expectedCodec ||
        !("value" in parsed)
      ) throw new Error("invalid envelope");
      return Object.freeze({ bytes: copyBytes(input), value: parsed.value });
    },
    catch: () => invalid(operation, "invalid_shape"),
  });
}

function canonicalBytes<Operation extends TaskRuntimeFamilyOperationV1>(
  value: Json,
  operation: Operation,
): Result.Result<Uint8Array, InvalidTaskRuntimeFamilyV1Error<Operation>> {
  const bytes = UTF8.encode(encodeCanonicalJson(value, issue => {
    throw new TaskRuntimeFamilyCanonicalEncodingV1Defect({ operation, issue });
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

function hex(value: TaskDefinitionSha256V1): string {
  return encodeBytesToLowercaseHex(value);
}

function reoperation<Operation extends TaskRuntimeFamilyOperationV1>(
  error: InvalidTaskRuntimeFamilyV1Error,
  operation: Operation,
): InvalidTaskRuntimeFamilyV1Error<Operation> {
  return invalid(
    operation,
    error.reason,
    error.path,
    error.observed,
    error.maximum,
  );
}

function invalid<Operation extends TaskRuntimeFamilyOperationV1>(
  operation: Operation,
  reason: TaskRuntimeFamilyFailureReasonV1,
  path?: string,
  observed?: number,
  maximum?: number,
): InvalidTaskRuntimeFamilyV1Error<Operation> {
  return new InvalidTaskRuntimeFamilyV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}
