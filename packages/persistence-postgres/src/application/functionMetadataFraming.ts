import {
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { Data, Result } from "effect";
import { encodeCanonicalJson } from "flarex-protocol/json";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type {
  TransactionArtifactIdV1,
  TransactionArtifactRuntimeV1,
  TransactionPackageIdV1,
} from "flarex-protocol/transaction-session";

const UTF8_ENCODER = new TextEncoder();

const FUNCTION_PATH_DOMAIN = ascii("flarex.pam.function-metadata.path.v1\0");
const FUNCTION_ROW_DOMAIN = ascii("flarex.pam.function-metadata.row.v1\0");
const EMPTY_CHAIN_DOMAIN = ascii(
  "flarex.pam.function-metadata.chain-seed.v1\0",
);
const CHAIN_STEP_DOMAIN = ascii(
  "flarex.pam.function-metadata.chain-step.v1\0",
);
const PUBLICATION_KEY_DOMAIN = ascii(
  "flarex.pam.package-publication-key.v1\0",
);
const COMPLETED_PACKAGE_DOMAIN = ascii(
  "flarex.pam.package-complete.v1\0",
);

const SHA256_BYTE_LENGTH = 32;
const DYNAMIC_WORKER_RUNTIME_CODE = 1;
const UINT32_MAX = 0xffff_ffff;
const SIGNED_INT64_MAX = 9_223_372_036_854_775_807n;

export type FunctionMetadataFramingOperationV1 =
  | "functionPath"
  | "functionRow"
  | "emptyChain"
  | "chainStep"
  | "publicationKey"
  | "completedPackage";

export interface FunctionMetadataFramingBudgetV1 {
  readonly maximumFrameBytesMaterialized: number;
}

export type FunctionMetadataFramingInputReasonV1 =
  | "invalidBudget"
  | "invalidBytes"
  | "invalidDigestLength"
  | "invalidCounter"
  | "invalidCodecVersion";

export class FunctionMetadataFramingInputV1Error extends Data.TaggedError(
  "FunctionMetadataFramingInputV1Error",
)<{
  readonly operation: FunctionMetadataFramingOperationV1;
  readonly field: string;
  readonly reason: FunctionMetadataFramingInputReasonV1;
}> {}

export class FunctionMetadataFramingBudgetV1Error extends Data.TaggedError(
  "FunctionMetadataFramingBudgetV1Error",
)<{
  readonly operation: FunctionMetadataFramingOperationV1;
  readonly observed: number;
  readonly maximum: number;
}> {}

export class FunctionMetadataFramingCounterOverflowV1Error extends Data.TaggedError(
  "FunctionMetadataFramingCounterOverflowV1Error",
)<{
  readonly operation: FunctionMetadataFramingOperationV1;
  readonly field: "nextOrdinal" | "canonicalRowBytesTotal";
  readonly left: bigint;
  readonly right: bigint;
  readonly maximum: typeof SIGNED_INT64_MAX;
}> {}

export type FunctionMetadataFramingV1Error =
  | FunctionMetadataFramingInputV1Error
  | FunctionMetadataFramingBudgetV1Error
  | FunctionMetadataFramingCounterOverflowV1Error;

export interface FunctionMetadataPublicationKeyPinsV1 {
  readonly packageId: TransactionPackageIdV1;
  readonly artifactRuntime: TransactionArtifactRuntimeV1;
  readonly artifactId: TransactionArtifactIdV1;
  readonly sourcePackageSha256: Uint8Array;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly schemaManifestCodecVersion: number;
  readonly schemaManifestByteLength: bigint;
  readonly schemaManifestSha256: Uint8Array;
  readonly functionMetadataCodecVersion: number;
}

export interface FunctionMetadataChainStepV1 {
  readonly canonicalBytes: Uint8Array;
  readonly nextOrdinal: bigint;
  readonly nextCanonicalRowBytesTotal: bigint;
}

export function frameFunctionMetadataPathSha256PreimageV1(
  functionPath: string,
  budget: unknown,
): Result.Result<Uint8Array, FunctionMetadataFramingV1Error> {
  const operation = "functionPath" satisfies FunctionMetadataFramingOperationV1;
  return Result.gen(function* () {
    const maximum = yield* decodeBudget(operation, budget);
    const pathByteLength = canonicalStringByteLength(functionPath);
    yield* ensureFrameBudget(
      operation,
      maximum,
      [FUNCTION_PATH_DOMAIN.byteLength, 8, pathByteLength],
    );
    const pathBytes = canonicalStringBytes(functionPath);
    return yield* concatenateFrame(
      operation,
      maximum,
      [FUNCTION_PATH_DOMAIN, u64(BigInt(pathBytes.byteLength)), pathBytes],
    );
  });
}

export function frameFunctionMetadataRowSha256PreimageV1(
  canonicalRowBytes: unknown,
  budget: unknown,
): Result.Result<Uint8Array, FunctionMetadataFramingV1Error> {
  const operation = "functionRow" satisfies FunctionMetadataFramingOperationV1;
  return Result.gen(function* () {
    const maximum = yield* decodeBudget(operation, budget);
    const rowByteLength = yield* readableByteLength(
      operation,
      "canonicalRowBytes",
      canonicalRowBytes,
    );
    yield* ensureFrameBudget(
      operation,
      maximum,
      [FUNCTION_ROW_DOMAIN.byteLength, 8, rowByteLength],
    );
    const ownedRowBytes = yield* captureBytes(
      operation,
      "canonicalRowBytes",
      canonicalRowBytes,
    );
    return yield* concatenateFrame(
      operation,
      maximum,
      [
        FUNCTION_ROW_DOMAIN,
        u64(BigInt(ownedRowBytes.byteLength)),
        ownedRowBytes,
      ],
    );
  });
}

export function frameFunctionMetadataEmptyChainSha256PreimageV1(
  budget: unknown,
): Result.Result<Uint8Array, FunctionMetadataFramingV1Error> {
  const operation = "emptyChain" satisfies FunctionMetadataFramingOperationV1;
  return Result.gen(function* () {
    const maximum = yield* decodeBudget(operation, budget);
    yield* ensureFrameBudget(
      operation,
      maximum,
      [EMPTY_CHAIN_DOMAIN.byteLength],
    );
    return yield* concatenateFrame(operation, maximum, [EMPTY_CHAIN_DOMAIN]);
  });
}

export function frameFunctionMetadataChainStepSha256PreimageV1(
  input: Readonly<{
    readonly previousChainSha256: unknown;
    readonly ordinal: unknown;
    readonly canonicalRowBytesTotal: unknown;
    readonly functionPathSha256: unknown;
    readonly functionRowSha256: unknown;
    readonly canonicalRowByteLength: unknown;
  }>,
  budget: unknown,
): Result.Result<FunctionMetadataChainStepV1, FunctionMetadataFramingV1Error> {
  const operation = "chainStep" satisfies FunctionMetadataFramingOperationV1;
  return Result.gen(function* () {
    const maximum = yield* decodeBudget(operation, budget);
    yield* ensureFrameBudget(
      operation,
      maximum,
      [CHAIN_STEP_DOMAIN.byteLength, 32, 8, 32, 32, 8],
    );
    const previousChainSha256 = yield* captureDigest(
      operation,
      "previousChainSha256",
      input.previousChainSha256,
    );
    const ordinal = yield* decodeCounter(operation, "ordinal", input.ordinal);
    const canonicalRowBytesTotal = yield* decodeCounter(
      operation,
      "canonicalRowBytesTotal",
      input.canonicalRowBytesTotal,
    );
    const functionPathSha256 = yield* captureDigest(
      operation,
      "functionPathSha256",
      input.functionPathSha256,
    );
    const functionRowSha256 = yield* captureDigest(
      operation,
      "functionRowSha256",
      input.functionRowSha256,
    );
    const canonicalRowByteLength = yield* decodeCounter(
      operation,
      "canonicalRowByteLength",
      input.canonicalRowByteLength,
    );
    const nextOrdinal = yield* checkedAdd(
      operation,
      "nextOrdinal",
      ordinal,
      1n,
    );
    const nextCanonicalRowBytesTotal = yield* checkedAdd(
      operation,
      "canonicalRowBytesTotal",
      canonicalRowBytesTotal,
      canonicalRowByteLength,
    );
    const canonicalBytes = yield* concatenateFrame(
      operation,
      maximum,
      [
        CHAIN_STEP_DOMAIN,
        previousChainSha256,
        u64(ordinal),
        functionPathSha256,
        functionRowSha256,
        u64(canonicalRowByteLength),
      ],
    );
    return {
      canonicalBytes,
      nextOrdinal,
      nextCanonicalRowBytesTotal,
    };
  });
}

export function frameFunctionMetadataPublicationKeySha256PreimageV1(
  input: FunctionMetadataPublicationKeyPinsV1,
  budget: unknown,
): Result.Result<Uint8Array, FunctionMetadataFramingV1Error> {
  const operation = "publicationKey" satisfies FunctionMetadataFramingOperationV1;
  return Result.gen(function* () {
    const maximum = yield* decodeBudget(operation, budget);
    const packageIdByteLength = canonicalStringByteLength(input.packageId);
    const artifactIdByteLength = canonicalStringByteLength(input.artifactId);
    const schemaVersionIdByteLength = canonicalStringByteLength(
      input.schemaVersionId,
    );
    yield* ensureFrameBudget(operation, maximum, [
      PUBLICATION_KEY_DOMAIN.byteLength,
      8,
      packageIdByteLength,
      1,
      8,
      artifactIdByteLength,
      32,
      8,
      schemaVersionIdByteLength,
      4,
      8,
      32,
      4,
    ]);
    const sourcePackageSha256 = yield* captureDigest(
      operation,
      "sourcePackageSha256",
      input.sourcePackageSha256,
    );
    const schemaManifestCodecVersion = yield* decodeUint32(
      operation,
      "schemaManifestCodecVersion",
      input.schemaManifestCodecVersion,
    );
    const schemaManifestByteLength = yield* decodeCounter(
      operation,
      "schemaManifestByteLength",
      input.schemaManifestByteLength,
    );
    const schemaManifestSha256 = yield* captureDigest(
      operation,
      "schemaManifestSha256",
      input.schemaManifestSha256,
    );
    const functionMetadataCodecVersion = yield* decodeUint32(
      operation,
      "functionMetadataCodecVersion",
      input.functionMetadataCodecVersion,
    );
    const packageId = canonicalStringBytes(input.packageId);
    const artifactId = canonicalStringBytes(input.artifactId);
    const schemaVersionId = canonicalStringBytes(input.schemaVersionId);
    const runtime = new Uint8Array([DYNAMIC_WORKER_RUNTIME_CODE]);
    return yield* concatenateFrame(
      operation,
      maximum,
      [
        PUBLICATION_KEY_DOMAIN,
        u64(BigInt(packageId.byteLength)),
        packageId,
        runtime,
        u64(BigInt(artifactId.byteLength)),
        artifactId,
        sourcePackageSha256,
        u64(BigInt(schemaVersionId.byteLength)),
        schemaVersionId,
        u32(schemaManifestCodecVersion),
        u64(schemaManifestByteLength),
        schemaManifestSha256,
        u32(functionMetadataCodecVersion),
      ],
    );
  });
}

export function frameFunctionMetadataCompletedPackageSha256PreimageV1(
  input: Readonly<{
    readonly publicationKeySha256: unknown;
    readonly functionCount: unknown;
    readonly canonicalRowBytesTotal: unknown;
    readonly finalRowChainSha256: unknown;
  }>,
  budget: unknown,
): Result.Result<Uint8Array, FunctionMetadataFramingV1Error> {
  const operation = "completedPackage" satisfies FunctionMetadataFramingOperationV1;
  return Result.gen(function* () {
    const maximum = yield* decodeBudget(operation, budget);
    yield* ensureFrameBudget(
      operation,
      maximum,
      [COMPLETED_PACKAGE_DOMAIN.byteLength, 32, 8, 8, 32],
    );
    const publicationKeySha256 = yield* captureDigest(
      operation,
      "publicationKeySha256",
      input.publicationKeySha256,
    );
    const functionCount = yield* decodeCounter(
      operation,
      "functionCount",
      input.functionCount,
    );
    const canonicalRowBytesTotal = yield* decodeCounter(
      operation,
      "canonicalRowBytesTotal",
      input.canonicalRowBytesTotal,
    );
    const finalRowChainSha256 = yield* captureDigest(
      operation,
      "finalRowChainSha256",
      input.finalRowChainSha256,
    );
    return yield* concatenateFrame(
      operation,
      maximum,
      [
        COMPLETED_PACKAGE_DOMAIN,
        publicationKeySha256,
        u64(functionCount),
        u64(canonicalRowBytesTotal),
        finalRowChainSha256,
      ],
    );
  });
}

function decodeBudget(
  operation: FunctionMetadataFramingOperationV1,
  input: unknown,
): Result.Result<number, FunctionMetadataFramingInputV1Error> {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    return Result.fail(inputError(operation, "budget", "invalidBudget"));
  }
  const descriptor = Object.getOwnPropertyDescriptor(
    input,
    "maximumFrameBytesMaterialized",
  );
  if (descriptor === undefined || !("value" in descriptor)) {
    return Result.fail(inputError(
      operation,
      "budget.maximumFrameBytesMaterialized",
      "invalidBudget",
    ));
  }
  const maximum: unknown = descriptor.value;
  return typeof maximum === "number" &&
      Number.isSafeInteger(maximum) &&
      maximum > 0
    ? Result.succeed(maximum)
    : Result.fail(inputError(
      operation,
      "budget.maximumFrameBytesMaterialized",
      "invalidBudget",
    ));
}

function decodeCounter(
  operation: FunctionMetadataFramingOperationV1,
  field: string,
  input: unknown,
): Result.Result<bigint, FunctionMetadataFramingInputV1Error> {
  return typeof input === "bigint" &&
      input >= 0n &&
      input <= SIGNED_INT64_MAX
    ? Result.succeed(input)
    : Result.fail(inputError(operation, field, "invalidCounter"));
}

function decodeUint32(
  operation: FunctionMetadataFramingOperationV1,
  field: string,
  input: unknown,
): Result.Result<number, FunctionMetadataFramingInputV1Error> {
  return typeof input === "number" &&
      Number.isInteger(input) &&
      input >= 0 &&
      input <= UINT32_MAX
    ? Result.succeed(input)
    : Result.fail(inputError(operation, field, "invalidCodecVersion"));
}

function captureDigest(
  operation: FunctionMetadataFramingOperationV1,
  field: string,
  input: unknown,
): Result.Result<Uint8Array, FunctionMetadataFramingInputV1Error> {
  if (!isUint8ArrayWithByteLength(input, SHA256_BYTE_LENGTH)) {
    return Result.fail(inputError(operation, field, "invalidDigestLength"));
  }
  return captureReadableBytes(operation, field, input);
}

function captureBytes(
  operation: FunctionMetadataFramingOperationV1,
  field: string,
  input: unknown,
): Result.Result<Uint8Array, FunctionMetadataFramingInputV1Error> {
  if (!isUint8Array(input)) {
    return Result.fail(inputError(operation, field, "invalidBytes"));
  }
  return captureReadableBytes(operation, field, input);
}

function readableByteLength(
  operation: FunctionMetadataFramingOperationV1,
  field: string,
  input: unknown,
): Result.Result<number, FunctionMetadataFramingInputV1Error> {
  if (!isUint8Array(input)) {
    return Result.fail(inputError(operation, field, "invalidBytes"));
  }
  try {
    let byteLength = 0;
    for (const byte of Uint8Array.prototype.values.call(input)) {
      byteLength += 1;
      void byte;
    }
    return Result.succeed(byteLength);
  } catch (cause) {
    if (cause instanceof TypeError) {
      return Result.fail(inputError(operation, field, "invalidBytes"));
    }
    throw cause;
  }
}

function captureReadableBytes(
  operation: FunctionMetadataFramingOperationV1,
  field: string,
  input: Uint8Array,
): Result.Result<Uint8Array, FunctionMetadataFramingInputV1Error> {
  return Result.gen(function* () {
    const byteLength = yield* readableByteLength(operation, field, input);
    const owned = new Uint8Array(byteLength);
    try {
      Uint8Array.prototype.set.call(owned, input);
      return owned;
    } catch (cause) {
      if (cause instanceof TypeError) {
        return yield* Result.fail(inputError(operation, field, "invalidBytes"));
      }
      throw cause;
    }
  });
}

function checkedAdd(
  operation: FunctionMetadataFramingOperationV1,
  field: FunctionMetadataFramingCounterOverflowV1Error["field"],
  left: bigint,
  right: bigint,
): Result.Result<bigint, FunctionMetadataFramingCounterOverflowV1Error> {
  return left <= SIGNED_INT64_MAX - right
    ? Result.succeed(left + right)
    : Result.fail(new FunctionMetadataFramingCounterOverflowV1Error({
      operation,
      field,
      left,
      right,
      maximum: SIGNED_INT64_MAX,
    }));
}

function concatenateFrame(
  operation: FunctionMetadataFramingOperationV1,
  maximum: number,
  segments: ReadonlyArray<Uint8Array>,
): Result.Result<Uint8Array, FunctionMetadataFramingBudgetV1Error> {
  let total = 0;
  for (const segment of segments) {
    if (segment.byteLength > maximum - total) {
      return Result.fail(new FunctionMetadataFramingBudgetV1Error({
        operation,
        observed: maximum + 1,
        maximum,
      }));
    }
    total += segment.byteLength;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const segment of segments) {
    Uint8Array.prototype.set.call(output, segment, offset);
    offset += segment.byteLength;
  }
  return Result.succeed(output);
}

function ensureFrameBudget(
  operation: FunctionMetadataFramingOperationV1,
  maximum: number,
  segmentByteLengths: ReadonlyArray<number>,
): Result.Result<void, FunctionMetadataFramingBudgetV1Error> {
  let total = 0;
  for (const segmentByteLength of segmentByteLengths) {
    if (segmentByteLength > maximum - total) {
      return Result.fail(new FunctionMetadataFramingBudgetV1Error({
        operation,
        observed: maximum + 1,
        maximum,
      }));
    }
    total += segmentByteLength;
  }
  return Result.succeed(undefined);
}

function canonicalStringBytes(value: string): Uint8Array {
  const canonical = encodeCanonicalJson(value, (issue) => {
    throw new Error(
      `Canonical string encoding invariant failed: ${issue.reason}.`,
    );
  });
  return UTF8_ENCODER.encode(canonical);
}

function canonicalStringByteLength(value: string): number {
  let byteLength = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) {
      byteLength += 2;
    } else if (code <= 0x1f) {
      byteLength +=
        code === 0x08 ||
          code === 0x09 ||
          code === 0x0a ||
          code === 0x0c ||
          code === 0x0d
          ? 2
          : 6;
    } else if (code <= 0x7f) {
      byteLength += 1;
    } else if (code <= 0x7ff) {
      byteLength += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        byteLength += 4;
        index += 1;
      } else {
        byteLength += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      byteLength += 6;
    } else {
      byteLength += 3;
    }
  }
  return byteLength;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, false);
  return bytes;
}

function inputError(
  operation: FunctionMetadataFramingOperationV1,
  field: string,
  reason: FunctionMetadataFramingInputReasonV1,
): FunctionMetadataFramingInputV1Error {
  return new FunctionMetadataFramingInputV1Error({ operation, field, reason });
}

function ascii(value: string): Uint8Array {
  const bytes = UTF8_ENCODER.encode(value);
  for (const byte of bytes) {
    if (byte > 0x7f) {
      throw new Error("Function Metadata framing domain must be ASCII.");
    }
  }
  return bytes;
}
