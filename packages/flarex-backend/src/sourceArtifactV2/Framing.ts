import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Result } from "effect";
import { encodeCanonicalJson } from "flarex-protocol/json";

const UTF8_ENCODER = new TextEncoder();
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
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

export interface SourceArtifactV2FrameDecodeBudget {
  readonly maximumInputBytesMaterialized: number;
  readonly maximumCanonicalBytesMaterialized: number;
  readonly maximumFrameBytesMaterialized: number;
}

export interface SourceArtifactV2FrameDecodeReceipt {
  readonly inputBytesMaterialized: number;
  readonly canonicalBytesMaterialized: number;
  readonly frameBytesMaterialized: number;
}

export class SourceArtifactV2FrameDecodeError extends Data.TaggedError(
  "SourceArtifactV2FrameDecodeError",
)<{
  readonly operation: Exclude<SourceArtifactV2FrameOperation, "uploadSelector">;
  readonly field: string;
  readonly reason:
    | "invalidBudget"
    | "invalidBytes"
    | "wrongDomain"
    | "truncated"
    | "trailingBytes"
    | "invalidVersion"
    | "invalidCounter"
    | "invalidTag"
    | "invalidRange"
    | "invalidRoles"
    | "invalidEnvironment"
    | "invalidCanonicalString"
    | "inconsistentFields"
    | "nonCanonicalFrame";
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export interface SourceArtifactV2DecodedFrame<A> {
  readonly value: A;
  readonly receipt: SourceArtifactV2FrameDecodeReceipt;
}

export interface SourceArtifactV2DecodedBlockFrame {
  readonly kind: SourceArtifactV2BlockKind;
  readonly blockIndex: bigint;
  readonly bytes: Uint8Array;
}

export interface SourceArtifactV2DecodedTreeNodeFrame {
  readonly kind: SourceArtifactV2TreeKind;
  readonly left: SourceArtifactV2TreeReference;
  readonly right: SourceArtifactV2TreeReference;
  readonly totalCount: bigint;
}

export interface SourceArtifactV2DecodedModuleFrame extends SourceArtifactV2ModuleFrameInput {
  readonly environment: "isolate";
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
  return Result.gen(function* () {
    const maximum = yield* decodeBudget(operation, budget);
    const decoded = yield* decodeUploadSelectorInput(input);
    const fixedBytes = UPLOAD_SELECTOR_DOMAIN.byteLength + 4 + 4 + 8 + 32;
    const deployment = yield* canonicalString(
      operation,
      "deploymentId",
      decoded.deploymentId,
      maximum - fixedBytes,
      maximum,
    );
    const upload = yield* canonicalString(
      operation,
      "uploadId",
      decoded.uploadId,
      maximum - fixedBytes - deployment.byteLength,
      maximum,
    );
    return yield* materializeFrame(
      operation,
      maximum,
      deployment.byteLength + upload.byteLength,
      [
        UPLOAD_SELECTOR_DOMAIN,
        u32(deployment.byteLength),
        deployment,
        u32(upload.byteLength),
        upload,
        u64(decoded.generation),
        ownedDigest(decoded.rootDigest),
      ],
    );
  });
}

export function decodeSourceArtifactV2BlockFrame(
  kind: SourceArtifactV2BlockKind,
  value: unknown,
  budget: unknown,
): Result.Result<
  SourceArtifactV2DecodedFrame<SourceArtifactV2DecodedBlockFrame>,
  SourceArtifactV2FrameDecodeError
> {
  const operation = "block" as const;
  const captured = captureDecodeInput(operation, value, budget);
  if (Result.isFailure(captured)) return Result.fail(captured.failure);
  const cursor = new SourceArtifactV2FrameCursor(captured.success.bytes);
  const domain = kind === "source" ? SOURCE_BLOCK_DOMAIN : SOURCE_MAP_BLOCK_DOMAIN;
  if (!cursor.readDomain(domain)) {
    return Result.fail(decodeError(operation, "domain", "wrongDomain"));
  }
  const blockIndex = cursor.readCounter();
  if (blockIndex === undefined) {
    return Result.fail(decodeError(operation, "blockIndex", cursor.counterFailureReason()));
  }
  const bodyByteLength = cursor.readCounter();
  if (bodyByteLength === undefined) {
    return Result.fail(decodeError(operation, "bodyByteLength", cursor.counterFailureReason()));
  }
  const bodyLength = safeLengthFromCounter(bodyByteLength);
  if (bodyLength === undefined || bodyLength === 0) {
    return Result.fail(decodeError(operation, "bodyByteLength", "invalidCounter"));
  }
  const body = cursor.readBytes(bodyLength);
  if (body === undefined) {
    return Result.fail(decodeError(operation, "bytes", "truncated"));
  }
  if (!cursor.atEnd()) {
    return Result.fail(decodeError(operation, "frame", "trailingBytes"));
  }
  const decoded = Object.freeze({ kind, blockIndex, bytes: body });
  return verifyDecodedFrame(
    operation,
    captured.success,
    decoded,
    () => sourceArtifactV2BlockFrame(kind, blockIndex, body, {
      maximumFrameBytesMaterialized:
        captured.success.budget.maximumFrameBytesMaterialized,
    }),
  );
}

export function decodeSourceArtifactV2TreeNodeFrame(
  kind: SourceArtifactV2TreeKind,
  value: unknown,
  budget: unknown,
): Result.Result<
  SourceArtifactV2DecodedFrame<SourceArtifactV2DecodedTreeNodeFrame>,
  SourceArtifactV2FrameDecodeError
> {
  const operation = "treeNode" as const;
  const captured = captureDecodeInput(operation, value, budget);
  if (Result.isFailure(captured)) return Result.fail(captured.failure);
  const cursor = new SourceArtifactV2FrameCursor(captured.success.bytes);
  if (!cursor.readDomain(TREE_NODE_DOMAIN)) {
    return Result.fail(decodeError(operation, "domain", "wrongDomain"));
  }
  const kindCode = cursor.readByte();
  if (kindCode === undefined) {
    return Result.fail(decodeError(operation, "kind", "truncated"));
  }
  if (kindCode !== treeKindCode(kind)) {
    return Result.fail(decodeError(operation, "kind", "invalidTag"));
  }
  const leftFirst = cursor.readCounter();
  const leftCount = cursor.readCounter();
  const rightCount = cursor.readCounter();
  if (leftFirst === undefined || leftCount === undefined || rightCount === undefined) {
    return Result.fail(decodeError(operation, "range", cursor.counterFailureReason()));
  }
  if (leftCount === 0n || rightCount === 0n) {
    return Result.fail(decodeError(operation, "range", "invalidCounter"));
  }
  const leftDigest = cursor.readBytes(SOURCE_ARTIFACT_V2_SHA256_BYTES);
  const rightDigest = cursor.readBytes(SOURCE_ARTIFACT_V2_SHA256_BYTES);
  const totalCount = cursor.readCounter();
  if (leftDigest === undefined || rightDigest === undefined || totalCount === undefined) {
    return Result.fail(decodeError(operation, "range", cursor.counterFailureReason()));
  }
  if (!cursor.atEnd()) {
    return Result.fail(decodeError(operation, "frame", "trailingBytes"));
  }
  const rightFirst = checkedDecodeCounterSum(leftFirst, leftCount);
  const expectedTotal = checkedDecodeCounterSum(leftCount, rightCount);
  if (rightFirst === undefined || expectedTotal === undefined || expectedTotal !== totalCount) {
    return Result.fail(decodeError(operation, "range", "invalidRange"));
  }
  const left = Object.freeze({ firstOrdinal: leftFirst, count: leftCount, digest: leftDigest });
  const right = Object.freeze({ firstOrdinal: rightFirst, count: rightCount, digest: rightDigest });
  const decoded = Object.freeze({ kind, left, right, totalCount });
  return verifyDecodedFrame(
    operation,
    captured.success,
    decoded,
    () => sourceArtifactV2TreeNodeFrame(kind, left, right, {
      maximumFrameBytesMaterialized:
        captured.success.budget.maximumFrameBytesMaterialized,
    }),
  );
}

export function decodeSourceArtifactV2ModuleFrame(
  value: unknown,
  budget: unknown,
): Result.Result<
  SourceArtifactV2DecodedFrame<SourceArtifactV2DecodedModuleFrame>,
  SourceArtifactV2FrameDecodeError
> {
  const operation = "module" as const;
  const captured = captureDecodeInput(operation, value, budget);
  if (Result.isFailure(captured)) return Result.fail(captured.failure);
  const cursor = new SourceArtifactV2FrameCursor(captured.success.bytes);
  if (!cursor.readDomain(MODULE_DOMAIN)) {
    return Result.fail(decodeError(operation, "domain", "wrongDomain"));
  }
  const ordinal = cursor.readCounter();
  const pathByteLength = cursor.readU32();
  if (ordinal === undefined || pathByteLength === undefined) {
    return Result.fail(decodeError(operation, "path", cursor.counterFailureReason()));
  }
  const path = decodeCanonicalFrameString(
    operation,
    "path",
    cursor,
    pathByteLength,
    captured.success,
  );
  if (Result.isFailure(path)) return Result.fail(path.failure);
  if (path.success.length === 0) {
    return Result.fail(decodeError(operation, "path", "invalidCanonicalString"));
  }
  const environment = cursor.readByte();
  const roles = cursor.readByte();
  if (environment === undefined || roles === undefined) {
    return Result.fail(decodeError(operation, "module", "truncated"));
  }
  if (environment !== ENVIRONMENT_ISOLATE) {
    return Result.fail(decodeError(operation, "environment", "invalidEnvironment"));
  }
  if (roles <= 0 || (roles & ~SOURCE_ARTIFACT_V2_ROLE_MASK) !== 0) {
    return Result.fail(decodeError(operation, "roles", "invalidRoles"));
  }
  const sourceByteLength = cursor.readCounter();
  const sourceBlockCount = cursor.readCounter();
  const sourceTreeDigest = cursor.readBytes(SOURCE_ARTIFACT_V2_SHA256_BYTES);
  if (
    sourceByteLength === undefined || sourceBlockCount === undefined ||
    sourceTreeDigest === undefined
  ) return Result.fail(decodeError(operation, "source", cursor.counterFailureReason()));
  if (sourceByteLength === 0n || sourceBlockCount === 0n) {
    return Result.fail(decodeError(operation, "source", "invalidCounter"));
  }
  const sourceMapTag = cursor.readByte();
  if (sourceMapTag === undefined) {
    return Result.fail(decodeError(operation, "sourceMap", "truncated"));
  }
  let sourceMapByteLength = 0n;
  let sourceMapBlockCount = 0n;
  let sourceMapTreeDigest: Uint8Array | null = null;
  if (sourceMapTag === 1) {
    const byteLength = cursor.readCounter();
    const blockCount = cursor.readCounter();
    const digest = cursor.readBytes(SOURCE_ARTIFACT_V2_SHA256_BYTES);
    if (byteLength === undefined || blockCount === undefined || digest === undefined) {
      return Result.fail(decodeError(operation, "sourceMap", cursor.counterFailureReason()));
    }
    if (byteLength === 0n || blockCount === 0n) {
      return Result.fail(decodeError(operation, "sourceMap", "inconsistentFields"));
    }
    sourceMapByteLength = byteLength;
    sourceMapBlockCount = blockCount;
    sourceMapTreeDigest = digest;
  } else if (sourceMapTag !== 0) {
    return Result.fail(decodeError(operation, "sourceMap", "invalidTag"));
  }
  if (!cursor.atEnd()) {
    return Result.fail(decodeError(operation, "frame", "trailingBytes"));
  }
  const decoded: SourceArtifactV2DecodedModuleFrame = Object.freeze({
    ordinal,
    path: path.success,
    environment: "isolate",
    roles,
    sourceByteLength,
    sourceBlockCount,
    sourceTreeDigest,
    sourceMapByteLength,
    sourceMapBlockCount,
    sourceMapTreeDigest,
  });
  return verifyDecodedFrame(
    operation,
    captured.success,
    decoded,
    () => sourceArtifactV2ModuleFrame(decoded, {
      maximumFrameBytesMaterialized:
        captured.success.budget.maximumFrameBytesMaterialized,
    }),
  );
}

export function decodeSourceArtifactV2CompletedRootFrame(
  value: unknown,
  budget: unknown,
): Result.Result<
  SourceArtifactV2DecodedFrame<SourceArtifactV2CompletedRootFrameInput>,
  SourceArtifactV2FrameDecodeError
> {
  const operation = "completedRoot" as const;
  const captured = captureDecodeInput(operation, value, budget);
  if (Result.isFailure(captured)) return Result.fail(captured.failure);
  const cursor = new SourceArtifactV2FrameCursor(captured.success.bytes);
  if (!cursor.readDomain(COMPLETED_ROOT_DOMAIN)) {
    return Result.fail(decodeError(operation, "domain", "wrongDomain"));
  }
  const version = cursor.readU32();
  if (version === undefined) {
    return Result.fail(decodeError(operation, "version", "truncated"));
  }
  if (version !== SOURCE_ARTIFACT_V2_CODEC_VERSION) {
    return Result.fail(decodeError(operation, "version", "invalidVersion"));
  }
  const moduleCount = cursor.readCounter();
  const functionModuleCount = cursor.readCounter();
  const totalSourceBytes = cursor.readCounter();
  const totalSourceMapBytes = cursor.readCounter();
  const moduleTreeDigest = cursor.readBytes(SOURCE_ARTIFACT_V2_SHA256_BYTES);
  if (
    moduleCount === undefined || functionModuleCount === undefined ||
    totalSourceBytes === undefined || totalSourceMapBytes === undefined ||
    moduleTreeDigest === undefined
  ) return Result.fail(decodeError(operation, "root", cursor.counterFailureReason()));
  if (
    moduleCount === 0n || totalSourceBytes === 0n ||
    functionModuleCount > moduleCount
  ) return Result.fail(decodeError(operation, "root", "invalidCounter"));
  const executionPath = decodeLengthPrefixedCanonicalString(
    operation,
    "executionPath",
    cursor,
    captured.success,
  );
  if (Result.isFailure(executionPath)) return Result.fail(executionPath.failure);
  if (executionPath.success.length === 0) {
    return Result.fail(decodeError(operation, "executionPath", "invalidCanonicalString"));
  }
  const schemaPath = decodeOptionalCanonicalFrameString(
    operation,
    "schemaPath",
    cursor,
    captured.success,
  );
  if (Result.isFailure(schemaPath)) return Result.fail(schemaPath.failure);
  const authPath = decodeOptionalCanonicalFrameString(
    operation,
    "authPath",
    cursor,
    captured.success,
  );
  if (Result.isFailure(authPath)) return Result.fail(authPath.failure);
  if (!cursor.atEnd()) {
    return Result.fail(decodeError(operation, "frame", "trailingBytes"));
  }
  const decoded = Object.freeze({
    moduleCount,
    functionModuleCount,
    totalSourceBytes,
    totalSourceMapBytes,
    moduleTreeDigest,
    executionPath: executionPath.success,
    schemaPath: schemaPath.success,
    authPath: authPath.success,
  });
  return verifyDecodedFrame(
    operation,
    captured.success,
    decoded,
    () => sourceArtifactV2CompletedRootFrame(decoded, {
      maximumFrameBytesMaterialized:
        captured.success.budget.maximumFrameBytesMaterialized,
    }),
  );
}

type SourceArtifactV2StoredFrameOperation = Exclude<
  SourceArtifactV2FrameOperation,
  "uploadSelector"
>;

interface SourceArtifactV2CapturedDecodeInput {
  readonly bytes: Uint8Array;
  readonly budget: SourceArtifactV2FrameDecodeBudget;
  canonicalBytesMaterialized: number;
}

function captureDecodeInput(
  operation: SourceArtifactV2StoredFrameOperation,
  value: unknown,
  budget: unknown,
): Result.Result<SourceArtifactV2CapturedDecodeInput, SourceArtifactV2FrameDecodeError> {
  const decodedBudget = decodeFrameDecodeBudget(operation, budget);
  if (Result.isFailure(decodedBudget)) return Result.fail(decodedBudget.failure);
  if (!isUint8Array(value)) {
    return Result.fail(decodeError(operation, "value", "invalidBytes"));
  }
  const byteLength = intrinsicByteLength(value);
  if (byteLength === undefined || byteLength === 0) {
    return Result.fail(decodeError(operation, "value", "invalidBytes"));
  }
  if (byteLength > decodedBudget.success.maximumInputBytesMaterialized) {
    return Result.fail(decodeBudgetError(
      operation,
      "inputBytesMaterialized",
      byteLength,
      decodedBudget.success.maximumInputBytesMaterialized,
    ));
  }
  if (byteLength > decodedBudget.success.maximumFrameBytesMaterialized) {
    return Result.fail(decodeBudgetError(
      operation,
      "frameBytesMaterialized",
      byteLength,
      decodedBudget.success.maximumFrameBytesMaterialized,
    ));
  }
  const bytes = intrinsicOwnedCopy(value);
  if (bytes === undefined || bytes.byteLength !== byteLength) {
    return Result.fail(decodeError(operation, "value", "invalidBytes"));
  }
  return Result.succeed({
    bytes,
    budget: decodedBudget.success,
    canonicalBytesMaterialized: 0,
  });
}

function decodeFrameDecodeBudget(
  operation: SourceArtifactV2StoredFrameOperation,
  value: unknown,
): Result.Result<SourceArtifactV2FrameDecodeBudget, SourceArtifactV2FrameDecodeError> {
  if (!isNonArrayRecord(value)) {
    return Result.fail(decodeError(operation, "budget", "invalidBudget"));
  }
  const input = value.maximumInputBytesMaterialized;
  const canonical = value.maximumCanonicalBytesMaterialized;
  const frame = value.maximumFrameBytesMaterialized;
  if (
    !isNonNegativeSafeInteger(input) || !isNonNegativeSafeInteger(canonical) ||
    !isNonNegativeSafeInteger(frame)
  ) return Result.fail(decodeError(operation, "budget", "invalidBudget"));
  return Result.succeed(Object.freeze({
    maximumInputBytesMaterialized: input,
    maximumCanonicalBytesMaterialized: canonical,
    maximumFrameBytesMaterialized: frame,
  }));
}

function decodeCanonicalFrameString(
  operation: SourceArtifactV2StoredFrameOperation,
  field: string,
  cursor: SourceArtifactV2FrameCursor,
  byteLength: number,
  captured: SourceArtifactV2CapturedDecodeInput,
): Result.Result<string, SourceArtifactV2FrameDecodeError> {
  const bytes = cursor.readBytes(byteLength);
  if (bytes === undefined) {
    return Result.fail(decodeError(operation, field, "truncated"));
  }
  let text: string;
  try {
    text = FATAL_UTF8_DECODER.decode(bytes);
  } catch {
    return Result.fail(decodeError(operation, field, "invalidCanonicalString"));
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return Result.fail(decodeError(operation, field, "invalidCanonicalString"));
  }
  if (typeof decoded !== "string") {
    return Result.fail(decodeError(operation, field, "invalidCanonicalString"));
  }
  const projected = canonicalJsonStringUtf8ByteLength(decoded);
  const nextCanonical = checkedSafeNumberAdd(
    captured.canonicalBytesMaterialized,
    projected,
  );
  if (
    nextCanonical === undefined ||
    nextCanonical > captured.budget.maximumCanonicalBytesMaterialized
  ) {
    return Result.fail(decodeBudgetError(
      operation,
      "canonicalBytesMaterialized",
      nextCanonical ?? Number.MAX_SAFE_INTEGER,
      captured.budget.maximumCanonicalBytesMaterialized,
    ));
  }
  const canonical = UTF8_ENCODER.encode(encodeCanonicalJson(decoded, canonicalInvariantDefect));
  if (canonical.byteLength !== projected) return canonicalInvariantDefect();
  captured.canonicalBytesMaterialized = nextCanonical;
  if (!bytesEqualFullScan(bytes, canonical)) {
    return Result.fail(decodeError(operation, field, "invalidCanonicalString"));
  }
  return Result.succeed(decoded);
}

function decodeLengthPrefixedCanonicalString(
  operation: SourceArtifactV2StoredFrameOperation,
  field: string,
  cursor: SourceArtifactV2FrameCursor,
  captured: SourceArtifactV2CapturedDecodeInput,
): Result.Result<string, SourceArtifactV2FrameDecodeError> {
  const byteLength = cursor.readU32();
  return byteLength === undefined
    ? Result.fail(decodeError(operation, field, "truncated"))
    : decodeCanonicalFrameString(operation, field, cursor, byteLength, captured);
}

function decodeOptionalCanonicalFrameString(
  operation: SourceArtifactV2StoredFrameOperation,
  field: string,
  cursor: SourceArtifactV2FrameCursor,
  captured: SourceArtifactV2CapturedDecodeInput,
): Result.Result<string | null, SourceArtifactV2FrameDecodeError> {
  const tag = cursor.readByte();
  if (tag === undefined) return Result.fail(decodeError(operation, field, "truncated"));
  if (tag === 0) return Result.succeed(null);
  if (tag !== 1) return Result.fail(decodeError(operation, field, "invalidTag"));
  const decoded = decodeLengthPrefixedCanonicalString(operation, field, cursor, captured);
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure);
  return decoded.success.length === 0
    ? Result.fail(decodeError(operation, field, "invalidCanonicalString"))
    : Result.succeed(decoded.success);
}

function verifyDecodedFrame<A>(
  operation: SourceArtifactV2StoredFrameOperation,
  captured: SourceArtifactV2CapturedDecodeInput,
  value: A,
  reencode: () => Result.Result<SourceArtifactV2OwnedFrame, SourceArtifactV2FrameError>,
): Result.Result<SourceArtifactV2DecodedFrame<A>, SourceArtifactV2FrameDecodeError> {
  const expectedCanonical = operation === "module" || operation === "completedRoot"
    ? captured.canonicalBytesMaterialized
    : 0;
  const canonicalAfterReencode = checkedSafeNumberAdd(
    captured.canonicalBytesMaterialized,
    expectedCanonical,
  );
  if (
    canonicalAfterReencode === undefined ||
    canonicalAfterReencode > captured.budget.maximumCanonicalBytesMaterialized
  ) {
    return Result.fail(decodeBudgetError(
      operation,
      "canonicalBytesMaterialized",
      canonicalAfterReencode ?? Number.MAX_SAFE_INTEGER,
      captured.budget.maximumCanonicalBytesMaterialized,
    ));
  }
  const encoded = reencode();
  if (Result.isFailure(encoded)) {
    throw new Error("Validated source-artifact projection could not be re-encoded.");
  }
  if (
    encoded.success.canonicalBytesMaterialized !== expectedCanonical ||
    encoded.success.frameBytesMaterialized !== captured.bytes.byteLength
  ) return canonicalInvariantDefect();
  if (!bytesEqualFullScan(captured.bytes, encoded.success.bytes)) {
    return Result.fail(decodeError(operation, "frame", "nonCanonicalFrame"));
  }
  return Result.succeed(Object.freeze({
    value,
    receipt: Object.freeze({
      inputBytesMaterialized: captured.bytes.byteLength,
      canonicalBytesMaterialized: canonicalAfterReencode,
      frameBytesMaterialized: encoded.success.frameBytesMaterialized,
    }),
  }));
}

class SourceArtifactV2FrameCursor {
  readonly #view: DataView;
  #offset = 0;
  #invalidCounterObserved = false;

  constructor(readonly bytes: Uint8Array) {
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  readDomain(expected: Uint8Array): boolean {
    const observed = this.readBytes(expected.byteLength);
    return observed !== undefined && bytesEqualFullScan(observed, expected);
  }

  readByte(): number | undefined {
    if (this.#offset >= this.bytes.byteLength) return undefined;
    const value = this.#view.getUint8(this.#offset);
    this.#offset += 1;
    return value;
  }

  readU32(): number | undefined {
    if (this.bytes.byteLength - this.#offset < 4) return undefined;
    const value = this.#view.getUint32(this.#offset, false);
    this.#offset += 4;
    return value;
  }

  readCounter(): bigint | undefined {
    if (this.bytes.byteLength - this.#offset < 8) return undefined;
    const value = this.#view.getBigUint64(this.#offset, false);
    this.#offset += 8;
    if (value <= SOURCE_ARTIFACT_V2_SIGNED_INT64_MAX) return value;
    this.#invalidCounterObserved = true;
    return undefined;
  }

  readBytes(length: number): Uint8Array | undefined {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.bytes.byteLength - this.#offset) {
      return undefined;
    }
    const value = this.bytes.subarray(this.#offset, this.#offset + length);
    this.#offset += length;
    return value;
  }

  atEnd(): boolean {
    return this.#offset === this.bytes.byteLength;
  }

  counterFailureReason(): "invalidCounter" | "truncated" {
    return this.#invalidCounterObserved ? "invalidCounter" : "truncated";
  }
}

function safeLengthFromCounter(value: bigint): number | undefined {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}

function checkedDecodeCounterSum(left: bigint, right: bigint): bigint | undefined {
  const sum = left + right;
  return sum <= SOURCE_ARTIFACT_V2_SIGNED_INT64_MAX ? sum : undefined;
}

function checkedSafeNumberAdd(left: number, right: number): number | undefined {
  const sum = left + right;
  return Number.isSafeInteger(sum) ? sum : undefined;
}

function decodeError(
  operation: SourceArtifactV2StoredFrameOperation,
  field: string,
  reason: SourceArtifactV2FrameDecodeError["reason"],
): SourceArtifactV2FrameDecodeError {
  return new SourceArtifactV2FrameDecodeError({ operation, field, reason });
}

function decodeBudgetError(
  operation: SourceArtifactV2StoredFrameOperation,
  field: string,
  observed: number,
  maximum: number,
): SourceArtifactV2FrameDecodeError {
  return new SourceArtifactV2FrameDecodeError({
    operation,
    field,
    reason: "invalidBudget",
    observed,
    maximum,
  });
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
  return Result.gen(function* () {
    const generation = yield* decodePositiveCounter(operation, "generation", value.generation);
    const rootDigest = yield* decodeDigest(operation, "rootDigest", value.rootDigest);
    return {
      generation,
      rootDigest,
    };
  }).pipe(Result.map(({ generation, rootDigest }) => ({
    deploymentId: value.deploymentId as string,
    uploadId: value.uploadId as string,
    generation,
    rootDigest,
  })));
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
