import {
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Result } from "effect";
import { encodeCanonicalJson } from "flarex-protocol/json";

const UTF8_ENCODER = new TextEncoder();
const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(Uint8Array.prototype);
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteOffset",
)?.get;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)?.get;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;

const SOURCE_BLOCK_DOMAIN = ascii("flarex.source-artifact-v2.source-block.v1\0");
const SOURCE_MAP_BLOCK_DOMAIN = ascii(
  "flarex.source-artifact-v2.source-map-block.v1\0",
);
const TREE_NODE_DOMAIN = ascii("flarex.source-artifact-v2.tree-node.v1\0");
const MODULE_DOMAIN = ascii("flarex.source-artifact-v2.module.v1\0");
const COMPLETED_ROOT_DOMAIN = ascii(
  "flarex.source-artifact-v2.completed-root.v1\0",
);
const UPLOAD_SELECTOR_DOMAIN = ascii(
  "flarex.source-artifact-v2.upload-selector.v1\0",
);

export const SOURCE_ARTIFACT_V2_CODEC_VERSION = 1;
export const SOURCE_ARTIFACT_V2_SHA256_BYTES = 32;
export const SOURCE_ARTIFACT_V2_ROLE_FUNCTION = 1;
export const SOURCE_ARTIFACT_V2_ROLE_SCHEMA = 2;
export const SOURCE_ARTIFACT_V2_ROLE_AUTH = 4;
export const SOURCE_ARTIFACT_V2_ROLE_EXECUTION = 8;
export const SOURCE_ARTIFACT_V2_ROLE_MASK = 15;

const TREE_KIND_SOURCE = 1;
const TREE_KIND_SOURCE_MAP = 2;
const TREE_KIND_MODULE = 3;
const ENVIRONMENT_ISOLATE = 1;
const UINT32_MAX = 0xffff_ffff;
export const SOURCE_ARTIFACT_V2_SIGNED_INT64_MAX = 9_223_372_036_854_775_807n;

export type SourceArtifactV2BlockKind = "source" | "sourceMap";
export type SourceArtifactV2TreeKind = SourceArtifactV2BlockKind | "module";
export type SourceArtifactV2FrameOperation =
  | "block"
  | "treeNode"
  | "module"
  | "completedRoot"
  | "uploadSelector";

export interface SourceArtifactV2FrameBudget {
  readonly maximumFrameBytesMaterialized: number;
}

export class SourceArtifactV2FrameInputError extends Data.TaggedError(
  "SourceArtifactV2FrameInputError",
)<{
  readonly operation: SourceArtifactV2FrameOperation;
  readonly field: string;
  readonly reason:
    | "invalidBudget"
    | "invalidBytes"
    | "invalidCounter"
    | "invalidDigest"
    | "invalidPath"
    | "invalidRoles"
    | "invalidRange"
    | "invalidOptionalValue";
}> {}

export class SourceArtifactV2FrameBudgetError extends Data.TaggedError(
  "SourceArtifactV2FrameBudgetError",
)<{
  readonly operation: SourceArtifactV2FrameOperation;
  readonly observed: number;
  readonly maximum: number;
}> {}

export type SourceArtifactV2FrameError =
  | SourceArtifactV2FrameInputError
  | SourceArtifactV2FrameBudgetError;

export interface SourceArtifactV2OwnedFrame {
  readonly bytes: Uint8Array;
  readonly canonicalBytesMaterialized: number;
  readonly frameBytesMaterialized: number;
}

export interface SourceArtifactV2FrameProjection {
  readonly canonicalBytesMaterialized: number;
  readonly frameBytesMaterialized: number;
}

export interface SourceArtifactV2TreeReference {
  readonly firstOrdinal: bigint;
  readonly count: bigint;
  readonly digest: Uint8Array;
}

export interface SourceArtifactV2ModuleFrameInput {
  readonly ordinal: bigint;
  readonly path: string;
  readonly roles: number;
  readonly sourceByteLength: bigint;
  readonly sourceBlockCount: bigint;
  readonly sourceTreeDigest: Uint8Array;
  readonly sourceMapByteLength: bigint;
  readonly sourceMapBlockCount: bigint;
  readonly sourceMapTreeDigest: Uint8Array | null;
}

export interface SourceArtifactV2CompletedRootFrameInput {
  readonly moduleCount: bigint;
  readonly functionModuleCount: bigint;
  readonly totalSourceBytes: bigint;
  readonly totalSourceMapBytes: bigint;
  readonly moduleTreeDigest: Uint8Array;
  readonly executionPath: string;
  readonly schemaPath: string | null;
  readonly authPath: string | null;
}

export interface SourceArtifactV2UploadSelectorFrameInput {
  readonly deploymentId: string;
  readonly uploadId: string;
  readonly generation: bigint;
  readonly rootDigest: Uint8Array;
}

export function sourceArtifactV2BlockFrame(
  kind: SourceArtifactV2BlockKind,
  blockIndex: unknown,
  value: unknown,
  budget: unknown,
): Result.Result<SourceArtifactV2OwnedFrame, SourceArtifactV2FrameError> {
  const operation = "block" as const;
  const maximum = decodeBudget(operation, budget);
  if (Result.isFailure(maximum)) return Result.fail(maximum.failure);
  const ordinal = decodeCounter(operation, "blockIndex", blockIndex);
  if (Result.isFailure(ordinal)) return Result.fail(ordinal.failure);
  if (!isUint8Array(value) || intrinsicByteLength(value) === 0) {
    return Result.fail(inputError(operation, "value", "invalidBytes"));
  }
  const visibleLength = intrinsicByteLength(value);
  if (visibleLength === undefined) {
    return Result.fail(inputError(operation, "value", "invalidBytes"));
  }
  const domain = kind === "source" ? SOURCE_BLOCK_DOMAIN : SOURCE_MAP_BLOCK_DOMAIN;
  const projected = domain.byteLength + 8 + 8 + visibleLength;
  if (projected > maximum.success) {
    return Result.fail(budgetError(operation, projected, maximum.success));
  }
  const body = intrinsicOwnedCopy(value);
  if (body === undefined) {
    return Result.fail(inputError(operation, "value", "invalidBytes"));
  }
  return materializeFrame(operation, maximum.success, 0, [
    domain,
    u64(ordinal.success),
    u64(BigInt(body.byteLength)),
    body,
  ]);
}

export function sourceArtifactV2BlockFrameProjection(
  kind: SourceArtifactV2BlockKind,
  blockIndex: unknown,
  bodyByteLength: unknown,
  budget: unknown,
): Result.Result<SourceArtifactV2FrameProjection, SourceArtifactV2FrameError> {
  const operation = "block" as const;
  const maximum = decodeBudget(operation, budget);
  if (Result.isFailure(maximum)) return Result.fail(maximum.failure);
  const ordinal = decodeCounter(operation, "blockIndex", blockIndex);
  if (Result.isFailure(ordinal)) return Result.fail(ordinal.failure);
  if (
    typeof bodyByteLength !== "number" || !Number.isSafeInteger(bodyByteLength) ||
    bodyByteLength < 1
  ) return Result.fail(inputError(operation, "value", "invalidBytes"));
  const domain = kind === "source" ? SOURCE_BLOCK_DOMAIN : SOURCE_MAP_BLOCK_DOMAIN;
  const projected = domain.byteLength + 8 + 8 + bodyByteLength;
  if (!Number.isSafeInteger(projected) || projected > maximum.success) {
    return Result.fail(budgetError(operation, projected, maximum.success));
  }
  return Result.succeed(Object.freeze({
    canonicalBytesMaterialized: 0,
    frameBytesMaterialized: projected,
  }));
}

export function sourceArtifactV2TreeNodeFrame(
  kind: SourceArtifactV2TreeKind,
  left: unknown,
  right: unknown,
  budget: unknown,
): Result.Result<SourceArtifactV2OwnedFrame, SourceArtifactV2FrameError> {
  const operation = "treeNode" as const;
  const maximum = decodeBudget(operation, budget);
  if (Result.isFailure(maximum)) return Result.fail(maximum.failure);
  const leftReference = decodeTreeReference(operation, "left", left);
  if (Result.isFailure(leftReference)) return Result.fail(leftReference.failure);
  const rightReference = decodeTreeReference(operation, "right", right);
  if (Result.isFailure(rightReference)) return Result.fail(rightReference.failure);
  const expectedRightFirst = checkedAddCounter(
    operation,
    "range",
    leftReference.success.firstOrdinal,
    leftReference.success.count,
  );
  if (Result.isFailure(expectedRightFirst)) return Result.fail(expectedRightFirst.failure);
  if (expectedRightFirst.success !== rightReference.success.firstOrdinal) {
    return Result.fail(inputError(operation, "range", "invalidRange"));
  }
  const totalCount = checkedAddCounter(
    operation,
    "count",
    leftReference.success.count,
    rightReference.success.count,
  );
  if (Result.isFailure(totalCount)) return Result.fail(totalCount.failure);
  return materializeFrame(operation, maximum.success, 0, [
    TREE_NODE_DOMAIN,
    Uint8Array.of(treeKindCode(kind)),
    u64(leftReference.success.firstOrdinal),
    u64(leftReference.success.count),
    u64(rightReference.success.count),
    ownedDigest(leftReference.success.digest),
    ownedDigest(rightReference.success.digest),
    u64(totalCount.success),
  ]);
}

export function sourceArtifactV2ModuleFrame(
  input: unknown,
  budget: unknown,
): Result.Result<SourceArtifactV2OwnedFrame, SourceArtifactV2FrameError> {
  const operation = "module" as const;
  const maximum = decodeBudget(operation, budget);
  if (Result.isFailure(maximum)) return Result.fail(maximum.failure);
  const decoded = decodeModuleInput(input);
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure);
  const sourceMap = decoded.success.sourceMapTreeDigest === null
    ? [Uint8Array.of(0)]
    : [
      Uint8Array.of(1),
      u64(decoded.success.sourceMapByteLength),
      u64(decoded.success.sourceMapBlockCount),
      ownedDigest(decoded.success.sourceMapTreeDigest),
    ];
  const fixedBytes = MODULE_DOMAIN.byteLength + 8 + 4 + 1 + 1 + 8 + 8 + 32 +
    sourceMap.reduce((total, part) => total + part.byteLength, 0);
  const path = canonicalString(
    operation,
    "path",
    decoded.success.path,
    maximum.success - fixedBytes,
    maximum.success,
  );
  if (Result.isFailure(path)) return Result.fail(path.failure);
  return materializeFrame(operation, maximum.success, path.success.byteLength, [
    MODULE_DOMAIN,
    u64(decoded.success.ordinal),
    u32(path.success.byteLength),
    path.success,
    Uint8Array.of(ENVIRONMENT_ISOLATE),
    Uint8Array.of(decoded.success.roles),
    u64(decoded.success.sourceByteLength),
    u64(decoded.success.sourceBlockCount),
    ownedDigest(decoded.success.sourceTreeDigest),
    ...sourceMap,
  ]);
}

export function sourceArtifactV2CompletedRootFrame(
  input: unknown,
  budget: unknown,
): Result.Result<SourceArtifactV2OwnedFrame, SourceArtifactV2FrameError> {
  const operation = "completedRoot" as const;
  const maximum = decodeBudget(operation, budget);
  if (Result.isFailure(maximum)) return Result.fail(maximum.failure);
  const decoded = decodeCompletedRootInput(input);
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure);
  const fixedBytes = COMPLETED_ROOT_DOMAIN.byteLength + 4 + 32 + 32 + 4 + 1 + 1;
  const execution = canonicalString(
    operation,
    "executionPath",
    decoded.success.executionPath,
    maximum.success - fixedBytes,
    maximum.success,
  );
  if (Result.isFailure(execution)) return Result.fail(execution.failure);
  const schema = optionalCanonicalString(
    operation,
    "schemaPath",
    decoded.success.schemaPath,
    maximum.success - fixedBytes - execution.success.byteLength - 4,
    maximum.success,
  );
  if (Result.isFailure(schema)) return Result.fail(schema.failure);
  const auth = optionalCanonicalString(
    operation,
    "authPath",
    decoded.success.authPath,
    maximum.success - fixedBytes - execution.success.byteLength - 4 -
      canonicalOptionalLength(schema.success) - (schema.success === null ? 0 : 4),
    maximum.success,
  );
  if (Result.isFailure(auth)) return Result.fail(auth.failure);
  const canonicalBytes = execution.success.byteLength +
    canonicalOptionalLength(schema.success) + canonicalOptionalLength(auth.success);
  return materializeFrame(operation, maximum.success, canonicalBytes, [
    COMPLETED_ROOT_DOMAIN,
    u32(SOURCE_ARTIFACT_V2_CODEC_VERSION),
    u64(decoded.success.moduleCount),
    u64(decoded.success.functionModuleCount),
    u64(decoded.success.totalSourceBytes),
    u64(decoded.success.totalSourceMapBytes),
    ownedDigest(decoded.success.moduleTreeDigest),
    u32(execution.success.byteLength),
    execution.success,
    ...optionalStringParts(schema.success),
    ...optionalStringParts(auth.success),
  ]);
}

export function sourceArtifactV2UploadSelectorFrame(
  input: unknown,
  budget: unknown,
): Result.Result<SourceArtifactV2OwnedFrame, SourceArtifactV2FrameError> {
  const operation = "uploadSelector" as const;
  const maximum = decodeBudget(operation, budget);
  if (Result.isFailure(maximum)) return Result.fail(maximum.failure);
  const decoded = decodeUploadSelectorInput(input);
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure);
  const fixedBytes = UPLOAD_SELECTOR_DOMAIN.byteLength + 4 + 4 + 8 + 32;
  const deployment = canonicalString(
    operation,
    "deploymentId",
    decoded.success.deploymentId,
    maximum.success - fixedBytes,
    maximum.success,
  );
  if (Result.isFailure(deployment)) return Result.fail(deployment.failure);
  const upload = canonicalString(
    operation,
    "uploadId",
    decoded.success.uploadId,
    maximum.success - fixedBytes - deployment.success.byteLength,
    maximum.success,
  );
  if (Result.isFailure(upload)) return Result.fail(upload.failure);
  return materializeFrame(
    operation,
    maximum.success,
    deployment.success.byteLength + upload.success.byteLength,
    [
      UPLOAD_SELECTOR_DOMAIN,
      u32(deployment.success.byteLength),
      deployment.success,
      u32(upload.success.byteLength),
      upload.success,
      u64(decoded.success.generation),
      ownedDigest(decoded.success.rootDigest),
    ],
  );
}

function decodeModuleInput(
  value: unknown,
): Result.Result<SourceArtifactV2ModuleFrameInput, SourceArtifactV2FrameInputError> {
  const operation = "module" as const;
  if (!isNonArrayRecord(value)) {
    return Result.fail(inputError(operation, "input", "invalidBytes"));
  }
  const ordinal = decodeCounter(operation, "ordinal", value.ordinal);
  if (Result.isFailure(ordinal)) return Result.fail(ordinal.failure);
  if (typeof value.path !== "string" || value.path.length === 0) {
    return Result.fail(inputError(operation, "path", "invalidPath"));
  }
  if (
    typeof value.roles !== "number" || !Number.isSafeInteger(value.roles) ||
    value.roles <= 0 || (value.roles & ~SOURCE_ARTIFACT_V2_ROLE_MASK) !== 0
  ) {
    return Result.fail(inputError(operation, "roles", "invalidRoles"));
  }
  const sourceByteLength = decodePositiveCounter(operation, "sourceByteLength", value.sourceByteLength);
  if (Result.isFailure(sourceByteLength)) return Result.fail(sourceByteLength.failure);
  const sourceBlockCount = decodePositiveCounter(operation, "sourceBlockCount", value.sourceBlockCount);
  if (Result.isFailure(sourceBlockCount)) return Result.fail(sourceBlockCount.failure);
  const sourceTreeDigest = decodeDigest(operation, "sourceTreeDigest", value.sourceTreeDigest);
  if (Result.isFailure(sourceTreeDigest)) return Result.fail(sourceTreeDigest.failure);
  const sourceMapByteLength = decodeCounter(operation, "sourceMapByteLength", value.sourceMapByteLength);
  if (Result.isFailure(sourceMapByteLength)) return Result.fail(sourceMapByteLength.failure);
  const sourceMapBlockCount = decodeCounter(operation, "sourceMapBlockCount", value.sourceMapBlockCount);
  if (Result.isFailure(sourceMapBlockCount)) return Result.fail(sourceMapBlockCount.failure);
  const mapDigest = value.sourceMapTreeDigest === null
    ? Result.succeed<Uint8Array | null>(null)
    : decodeDigest(operation, "sourceMapTreeDigest", value.sourceMapTreeDigest);
  if (Result.isFailure(mapDigest)) return Result.fail(mapDigest.failure);
  const mapAbsent = sourceMapByteLength.success === 0n && sourceMapBlockCount.success === 0n &&
    mapDigest.success === null;
  const mapPresent = sourceMapByteLength.success > 0n && sourceMapBlockCount.success > 0n &&
    mapDigest.success !== null;
  if (!mapAbsent && !mapPresent) {
    return Result.fail(inputError(operation, "sourceMap", "invalidOptionalValue"));
  }
  return Result.succeed({
    ordinal: ordinal.success,
    path: value.path,
    roles: value.roles,
    sourceByteLength: sourceByteLength.success,
    sourceBlockCount: sourceBlockCount.success,
    sourceTreeDigest: sourceTreeDigest.success,
    sourceMapByteLength: sourceMapByteLength.success,
    sourceMapBlockCount: sourceMapBlockCount.success,
    sourceMapTreeDigest: mapDigest.success,
  });
}

function decodeCompletedRootInput(
  value: unknown,
): Result.Result<SourceArtifactV2CompletedRootFrameInput, SourceArtifactV2FrameInputError> {
  const operation = "completedRoot" as const;
  if (!isNonArrayRecord(value)) {
    return Result.fail(inputError(operation, "input", "invalidBytes"));
  }
  const moduleCount = decodePositiveCounter(operation, "moduleCount", value.moduleCount);
  if (Result.isFailure(moduleCount)) return Result.fail(moduleCount.failure);
  const functionCount = decodeCounter(operation, "functionModuleCount", value.functionModuleCount);
  if (Result.isFailure(functionCount)) return Result.fail(functionCount.failure);
  if (functionCount.success > moduleCount.success) {
    return Result.fail(inputError(operation, "functionModuleCount", "invalidCounter"));
  }
  const sourceBytes = decodePositiveCounter(operation, "totalSourceBytes", value.totalSourceBytes);
  if (Result.isFailure(sourceBytes)) return Result.fail(sourceBytes.failure);
  const sourceMapBytes = decodeCounter(operation, "totalSourceMapBytes", value.totalSourceMapBytes);
  if (Result.isFailure(sourceMapBytes)) return Result.fail(sourceMapBytes.failure);
  const treeDigest = decodeDigest(operation, "moduleTreeDigest", value.moduleTreeDigest);
  if (Result.isFailure(treeDigest)) return Result.fail(treeDigest.failure);
  if (typeof value.executionPath !== "string" || value.executionPath.length === 0) {
    return Result.fail(inputError(operation, "executionPath", "invalidPath"));
  }
  if (!optionalPath(value.schemaPath) || !optionalPath(value.authPath)) {
    return Result.fail(inputError(operation, "optionalPath", "invalidPath"));
  }
  return Result.succeed({
    moduleCount: moduleCount.success,
    functionModuleCount: functionCount.success,
    totalSourceBytes: sourceBytes.success,
    totalSourceMapBytes: sourceMapBytes.success,
    moduleTreeDigest: treeDigest.success,
    executionPath: value.executionPath,
    schemaPath: value.schemaPath,
    authPath: value.authPath,
  });
}

function decodeUploadSelectorInput(
  value: unknown,
): Result.Result<SourceArtifactV2UploadSelectorFrameInput, SourceArtifactV2FrameInputError> {
  const operation = "uploadSelector" as const;
  if (!isNonArrayRecord(value)) {
    return Result.fail(inputError(operation, "input", "invalidBytes"));
  }
  if (typeof value.deploymentId !== "string" || value.deploymentId.length === 0) {
    return Result.fail(inputError(operation, "deploymentId", "invalidPath"));
  }
  if (typeof value.uploadId !== "string" || value.uploadId.length === 0) {
    return Result.fail(inputError(operation, "uploadId", "invalidPath"));
  }
  const generation = decodePositiveCounter(operation, "generation", value.generation);
  if (Result.isFailure(generation)) return Result.fail(generation.failure);
  const rootDigest = decodeDigest(operation, "rootDigest", value.rootDigest);
  if (Result.isFailure(rootDigest)) return Result.fail(rootDigest.failure);
  return Result.succeed({
    deploymentId: value.deploymentId,
    uploadId: value.uploadId,
    generation: generation.success,
    rootDigest: rootDigest.success,
  });
}

function decodeTreeReference(
  operation: SourceArtifactV2FrameOperation,
  field: string,
  value: unknown,
): Result.Result<SourceArtifactV2TreeReference, SourceArtifactV2FrameInputError> {
  if (!isNonArrayRecord(value)) {
    return Result.fail(inputError(operation, field, "invalidRange"));
  }
  const first = decodeCounter(operation, `${field}.firstOrdinal`, value.firstOrdinal);
  if (Result.isFailure(first)) return Result.fail(first.failure);
  const count = decodePositiveCounter(operation, `${field}.count`, value.count);
  if (Result.isFailure(count)) return Result.fail(count.failure);
  const digest = decodeDigest(operation, `${field}.digest`, value.digest);
  if (Result.isFailure(digest)) return Result.fail(digest.failure);
  return Result.succeed({
    firstOrdinal: first.success,
    count: count.success,
    digest: digest.success,
  });
}

function decodeBudget(
  operation: SourceArtifactV2FrameOperation,
  value: unknown,
): Result.Result<number, SourceArtifactV2FrameInputError> {
  if (
    !isNonArrayRecord(value) ||
    typeof value.maximumFrameBytesMaterialized !== "number" ||
    !Number.isSafeInteger(value.maximumFrameBytesMaterialized) ||
    value.maximumFrameBytesMaterialized < 0
  ) {
    return Result.fail(inputError(operation, "budget", "invalidBudget"));
  }
  return Result.succeed(value.maximumFrameBytesMaterialized);
}

function decodeCounter(
  operation: SourceArtifactV2FrameOperation,
  field: string,
  value: unknown,
): Result.Result<bigint, SourceArtifactV2FrameInputError> {
  if (
    typeof value !== "bigint" || value < 0n ||
    value > SOURCE_ARTIFACT_V2_SIGNED_INT64_MAX
  ) {
    return Result.fail(inputError(operation, field, "invalidCounter"));
  }
  return Result.succeed(value);
}

function decodePositiveCounter(
  operation: SourceArtifactV2FrameOperation,
  field: string,
  value: unknown,
): Result.Result<bigint, SourceArtifactV2FrameInputError> {
  const decoded = decodeCounter(operation, field, value);
  return Result.isSuccess(decoded) && decoded.success === 0n
    ? Result.fail(inputError(operation, field, "invalidCounter"))
    : decoded;
}

function checkedAddCounter(
  operation: SourceArtifactV2FrameOperation,
  field: string,
  left: bigint,
  right: bigint,
): Result.Result<bigint, SourceArtifactV2FrameInputError> {
  const sum = left + right;
  return sum > SOURCE_ARTIFACT_V2_SIGNED_INT64_MAX
    ? Result.fail(inputError(operation, field, "invalidCounter"))
    : Result.succeed(sum);
}

function decodeDigest(
  operation: SourceArtifactV2FrameOperation,
  field: string,
  value: unknown,
): Result.Result<Uint8Array, SourceArtifactV2FrameInputError> {
  return isUint8ArrayWithByteLength(value, SOURCE_ARTIFACT_V2_SHA256_BYTES)
    ? Result.succeed(ownedDigest(value))
    : Result.fail(inputError(operation, field, "invalidDigest"));
}

function canonicalString(
  operation: SourceArtifactV2FrameOperation,
  field: string,
  value: string,
  availableBytes: number,
  maximumFrameBytes: number,
): Result.Result<Uint8Array, SourceArtifactV2FrameError> {
  if (value.length === 0) {
    return Result.fail(inputError(operation, field, "invalidPath"));
  }
  const projected = canonicalJsonStringUtf8ByteLength(value);
  if (projected > availableBytes) {
    return Result.fail(budgetError(
      operation,
      maximumFrameBytes - availableBytes + projected,
      maximumFrameBytes,
    ));
  }
  const bytes = UTF8_ENCODER.encode(encodeCanonicalJson(value, canonicalInvariantDefect));
  if (bytes.byteLength !== projected) {
    return canonicalInvariantDefect();
  }
  if (bytes.byteLength > UINT32_MAX) {
    return Result.fail(inputError(operation, field, "invalidCounter"));
  }
  return Result.succeed(bytes);
}

function optionalCanonicalString(
  operation: SourceArtifactV2FrameOperation,
  field: string,
  value: string | null,
  availableBytes: number,
  maximumFrameBytes: number,
): Result.Result<Uint8Array | null, SourceArtifactV2FrameError> {
  return value === null
    ? Result.succeed(null)
    : canonicalString(operation, field, value, availableBytes, maximumFrameBytes);
}

function canonicalJsonStringUtf8ByteLength(value: string): number {
  let total = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 ||
      code === 0x0a || code === 0x0c || code === 0x0d) {
      total = checkedLength(total, 2);
    } else if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff)) {
      if (
        code >= 0xd800 && code <= 0xdbff && index + 1 < value.length &&
        value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff
      ) {
        total = checkedLength(total, 4);
        index += 1;
      } else {
        total = checkedLength(total, 6);
      }
    } else {
      total = checkedLength(total, code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3);
    }
  }
  return total;
}

function checkedLength(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) return canonicalInvariantDefect();
  return sum;
}

function materializeFrame(
  operation: SourceArtifactV2FrameOperation,
  maximum: number,
  canonicalBytesMaterialized: number,
  parts: ReadonlyArray<Uint8Array>,
): Result.Result<SourceArtifactV2OwnedFrame, SourceArtifactV2FrameBudgetError> {
  let total = 0;
  for (const part of parts) {
    total += part.byteLength;
    if (!Number.isSafeInteger(total) || total > maximum) {
      return Result.fail(new SourceArtifactV2FrameBudgetError({
        operation,
        observed: total,
        maximum,
      }));
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return Result.succeed(Object.freeze({
    bytes,
    canonicalBytesMaterialized,
    frameBytesMaterialized: total,
  }));
}

function inputError(
  operation: SourceArtifactV2FrameOperation,
  field: string,
  reason: SourceArtifactV2FrameInputError["reason"],
): SourceArtifactV2FrameInputError {
  return new SourceArtifactV2FrameInputError({ operation, field, reason });
}

function budgetError(
  operation: SourceArtifactV2FrameOperation,
  observed: number,
  maximum: number,
): SourceArtifactV2FrameBudgetError {
  return new SourceArtifactV2FrameBudgetError({ operation, observed, maximum });
}

function intrinsicByteLength(value: Uint8Array): number | undefined {
  try {
    const length: unknown = TYPED_ARRAY_BYTE_LENGTH_GETTER?.call(value);
    return typeof length === "number" ? length : undefined;
  } catch {
    return undefined;
  }
}

function intrinsicOwnedCopy(value: Uint8Array): Uint8Array | undefined {
  const length = intrinsicByteLength(value);
  if (length === undefined) return undefined;
  let byteOffset: unknown;
  let buffer: unknown;
  try {
    byteOffset = TYPED_ARRAY_BYTE_OFFSET_GETTER?.call(value);
    buffer = TYPED_ARRAY_BUFFER_GETTER?.call(value);
  } catch {
    return undefined;
  }
  if (
    typeof byteOffset !== "number" ||
    !isIntrinsicArrayBuffer(buffer)
  ) return undefined;
  const copy = new Uint8Array(length);
  try {
    copy.set(new Uint8Array(buffer, byteOffset, length));
    return copy;
  } catch {
    return undefined;
  }
}

function isIntrinsicArrayBuffer(value: unknown): value is ArrayBuffer {
  if (value === null || typeof value !== "object") return false;
  try {
    const length: unknown = ARRAY_BUFFER_BYTE_LENGTH_GETTER?.call(value);
    return typeof length === "number";
  } catch {
    return false;
  }
}

function ownedDigest(value: Uint8Array): Uint8Array {
  const copy = intrinsicOwnedCopy(value);
  if (copy === undefined || copy.byteLength !== SOURCE_ARTIFACT_V2_SHA256_BYTES) {
    throw new Error("Validated source-artifact digest lost its intrinsic byte representation.");
  }
  return copy;
}

function optionalPath(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function canonicalOptionalLength(value: Uint8Array | null): number {
  return value === null ? 0 : value.byteLength;
}

function optionalStringParts(value: Uint8Array | null): ReadonlyArray<Uint8Array> {
  return value === null
    ? [Uint8Array.of(0)]
    : [Uint8Array.of(1), u32(value.byteLength), value];
}

function treeKindCode(kind: SourceArtifactV2TreeKind): number {
  switch (kind) {
    case "source":
      return TREE_KIND_SOURCE;
    case "sourceMap":
      return TREE_KIND_SOURCE_MAP;
    case "module":
      return TREE_KIND_MODULE;
  }
}

function ascii(value: string): Uint8Array {
  const bytes = UTF8_ENCODER.encode(value);
  for (const byte of bytes) {
    if (byte > 0x7f) throw new Error("Source-artifact frame domain must be ASCII.");
  }
  return bytes;
}

function u32(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new Error("Source-artifact U32 value is outside its validated range.");
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function u64(value: bigint): Uint8Array {
  if (value < 0n || value > SOURCE_ARTIFACT_V2_SIGNED_INT64_MAX) {
    throw new Error("Source-artifact U64 value is outside its validated signed-int64 range.");
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, false);
  return bytes;
}

function canonicalInvariantDefect(): never {
  throw new Error("Validated source-artifact string lost canonical JSON membership.");
}
