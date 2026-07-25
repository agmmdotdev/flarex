import {
  bytesEqualFullScan,
  isUint8Array,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Encoding, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetDimensionV2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import {
  GENERATED_DECLARATIVE_V2_VERIFIER_ASSET_BASE64_V1,
  GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1,
} from "./declarativeV2VerifierV1.generated";
import {
  DECLARATIVE_V2_EXECUTABLE_CORE_IDENTITY_V1,
  DECLARATIVE_V2_VERIFIER_ARENA_BYTE_FACTORS_V1,
  DECLARATIVE_V2_VERIFIER_ARENA_IDENTITY_V1,
  DECLARATIVE_V2_VERIFIER_ARENA_WIDTHS_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_ALIGNMENT_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_FORMAT_IDENTITY_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_FORMAT_VERSION_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_HEADER_BYTES_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_MAGIC_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_SECTION_ENTRY_BYTES_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_SECTIONS_V1,
  DECLARATIVE_V2_VERIFIER_DIAGNOSTIC_IDENTITY_V1,
  DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1,
  DECLARATIVE_V2_VERIFIER_UNICODE_IDENTITY_V1,
} from "./declarativeV2VerifierV1.contract";

const UTF8_ENCODER = new TextEncoder();
const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(
  Uint8Array.prototype,
);
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const GENERATED_ASSET_RESULT = Encoding.decodeBase64(
  GENERATED_DECLARATIVE_V2_VERIFIER_ASSET_BASE64_V1,
);
const MAX_U32 = 0xffff_ffffn;
const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;

export {
  DECLARATIVE_V2_EXECUTABLE_CORE_IDENTITY_V1,
  DECLARATIVE_V2_VERIFIER_ARENA_IDENTITY_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_FORMAT_IDENTITY_V1,
  DECLARATIVE_V2_VERIFIER_DIAGNOSTIC_IDENTITY_V1,
  DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1,
  DECLARATIVE_V2_VERIFIER_UNICODE_IDENTITY_V1,
  GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1,
};

export type DeclarativeV2VerifierAssetV1ErrorReason =
  | "invalidInput"
  | "invalidBudget"
  | "budgetExceeded"
  | "malformed"
  | "unsupportedVersion"
  | "nonCanonical"
  | "addressabilityExceeded"
  | "overflow";

export class DeclarativeV2VerifierAssetV1Error extends Data.TaggedError(
  "DeclarativeV2VerifierAssetV1Error",
)<{
  readonly operation: "loadAsset" | "planArena";
  readonly reason: DeclarativeV2VerifierAssetV1ErrorReason;
  readonly path?: string;
  readonly observed?: bigint;
  readonly maximum?: bigint;
}> {}

export interface DeclarativeV2VerifierAssetLoadBudgetV1 {
  readonly maximumTableBytes: number;
}

export interface DeclarativeV2VerifierLoadedSectionV1 {
  readonly id: number;
  readonly name: string;
  readonly recordBytes: number;
  readonly offset: number;
  readonly byteLength: number;
  readonly count: number;
}

export interface DeclarativeV2VerifierLoadedAssetV1 {
  readonly sections: ReadonlyArray<DeclarativeV2VerifierLoadedSectionV1>;
  readonly usage: Readonly<{ readonly tableBytes: number }>;
  readonly copyBytes: () => Uint8Array;
  readonly copySectionBytes: (name: string) => Uint8Array | undefined;
}

export interface DeclarativeV2VerifierArenaPlanInputV1 {
  readonly maximums: DeclarativeV2VerifierBudgetFrameV2;
  readonly required: DeclarativeV2VerifierBudgetFrameV2;
}

export interface DeclarativeV2VerifierArenaRegionV1 {
  readonly name: string;
  readonly offset: number;
  readonly byteLength: number;
}

export interface DeclarativeV2VerifierArenaPlanV1 {
  readonly requiredBytes: number;
  readonly regions: ReadonlyArray<DeclarativeV2VerifierArenaRegionV1>;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

function assetError(
  operation: "loadAsset" | "planArena",
  reason: DeclarativeV2VerifierAssetV1ErrorReason,
  path?: string,
  observed?: bigint,
  maximum?: bigint,
): DeclarativeV2VerifierAssetV1Error {
  return new DeclarativeV2VerifierAssetV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}

function captureExactOwnDataRecord(
  value: unknown,
  expected: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (!isNonArrayRecord(value)) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expected.length ||
      !keys.every((key) =>
        typeof key === "string" && expected.includes(key)
      )
    ) {
      return undefined;
    }
    const captured: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        return undefined;
      }
      captured[key] = descriptor.value;
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

function readU32(bytes: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 4 > bytes.byteLength) return undefined;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(offset, false);
}

function intrinsicByteLength(value: Uint8Array): number | undefined {
  try {
    const length = TYPED_ARRAY_BYTE_LENGTH_GETTER?.call(value) as unknown;
    return typeof length === "number" ? length : undefined;
  } catch {
    return undefined;
  }
}

function bytesAreZero(bytes: Uint8Array, start: number, end: number): boolean {
  let combined = 0;
  for (let index = start; index < end; index += 1) {
    combined |= bytes[index] ?? 0;
  }
  return combined === 0;
}

function align(value: number, alignment: number): number {
  const remainder = value % alignment;
  return remainder === 0 ? value : value + alignment - remainder;
}

function expectedGeneratedAsset(): Uint8Array {
  if (Result.isFailure(GENERATED_ASSET_RESULT)) {
    throw new Error("Generated Declarative V2 verifier asset is invalid base64.");
  }
  return GENERATED_ASSET_RESULT.success;
}

export function loadDeclarativeV2VerifierAssetV1(
  input: unknown,
  budget: unknown,
): Result.Result<
  DeclarativeV2VerifierLoadedAssetV1,
  DeclarativeV2VerifierAssetV1Error
> {
  const capturedBudget = captureExactOwnDataRecord(
    budget,
    ["maximumTableBytes"],
  );
  if (capturedBudget === undefined) {
    return Result.fail(assetError("loadAsset", "invalidBudget"));
  }
  const maximum = capturedBudget.maximumTableBytes;
  if (!isNonNegativeSafeInteger(maximum)) {
    return Result.fail(assetError("loadAsset", "invalidBudget", "maximumTableBytes"));
  }
  if (!isUint8Array(input)) {
    return Result.fail(assetError("loadAsset", "invalidInput"));
  }
  const visibleLength = intrinsicByteLength(input);
  if (visibleLength === undefined) {
    return Result.fail(assetError("loadAsset", "invalidInput"));
  }
  if (visibleLength > maximum) {
    return Result.fail(assetError(
      "loadAsset",
      "budgetExceeded",
      "tableBytes",
      BigInt(visibleLength),
      BigInt(maximum),
    ));
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(input);
  } catch {
    return Result.fail(assetError("loadAsset", "invalidInput"));
  }
  const magic = UTF8_ENCODER.encode(DECLARATIVE_V2_VERIFIER_ASSET_MAGIC_V1);
  if (
    bytes.byteLength < DECLARATIVE_V2_VERIFIER_ASSET_HEADER_BYTES_V1 ||
    !bytesEqualFullScan(bytes.subarray(0, magic.byteLength), magic)
  ) {
    return Result.fail(assetError("loadAsset", "malformed"));
  }
  const version = readU32(bytes, 8);
  if (version !== DECLARATIVE_V2_VERIFIER_ASSET_FORMAT_VERSION_V1) {
    return Result.fail(assetError("loadAsset", "unsupportedVersion"));
  }
  const headerBytes = readU32(bytes, 12);
  const sectionCount = readU32(bytes, 16);
  const sectionEntryBytes = readU32(bytes, 20);
  const alignment = readU32(bytes, 24);
  const reserved = readU32(bytes, 28);
  if (
    headerBytes !== DECLARATIVE_V2_VERIFIER_ASSET_HEADER_BYTES_V1 ||
    sectionCount !== DECLARATIVE_V2_VERIFIER_ASSET_SECTIONS_V1.length ||
    sectionEntryBytes !== DECLARATIVE_V2_VERIFIER_ASSET_SECTION_ENTRY_BYTES_V1 ||
    alignment !== DECLARATIVE_V2_VERIFIER_ASSET_ALIGNMENT_V1 ||
    reserved !== 0
  ) {
    return Result.fail(assetError("loadAsset", "malformed"));
  }
  const tableEnd = headerBytes + sectionCount * sectionEntryBytes;
  const firstSectionOffset = align(tableEnd, alignment);
  if (
    tableEnd > bytes.byteLength ||
    firstSectionOffset > bytes.byteLength ||
    !bytesAreZero(bytes, tableEnd, firstSectionOffset)
  ) {
    return Result.fail(assetError("loadAsset", "malformed"));
  }
  const sections: DeclarativeV2VerifierLoadedSectionV1[] = [];
  let expectedOffset = firstSectionOffset;
  for (let index = 0; index < sectionCount; index += 1) {
    const definition = DECLARATIVE_V2_VERIFIER_ASSET_SECTIONS_V1[index]!;
    const entry = headerBytes + index * sectionEntryBytes;
    const id = readU32(bytes, entry);
    const recordBytes = readU32(bytes, entry + 4);
    const offset = readU32(bytes, entry + 8);
    const byteLength = readU32(bytes, entry + 12);
    const count = readU32(bytes, entry + 16);
    const flags = readU32(bytes, entry + 20);
    if (
      id !== definition.id ||
      recordBytes !== definition.recordBytes ||
      offset !== expectedOffset ||
      byteLength === undefined ||
      count === undefined ||
      flags !== 0 ||
      byteLength % recordBytes !== 0 ||
      count !== byteLength / recordBytes ||
      offset + byteLength > bytes.byteLength
    ) {
      return Result.fail(assetError("loadAsset", "malformed"));
    }
    if (recordBytes >= 4 && definition.name !== "stringPool" &&
      definition.name !== "canonicalSpecification") {
      for (let row = 0; row < count; row += 1) {
        const rowId = readU32(bytes, offset + row * recordBytes);
        if (
          definition.name.startsWith("unicode")
            ? rowId === undefined
            : rowId !== row + 1
        ) {
          return Result.fail(assetError("loadAsset", "malformed"));
        }
      }
    }
    if (definition.name.startsWith("unicode")) {
      let previousEnd = -1;
      for (let row = 0; row < count; row += 1) {
        const start = readU32(bytes, offset + row * 8);
        const end = readU32(bytes, offset + row * 8 + 4);
        if (
          start === undefined ||
          end === undefined ||
          start > end ||
          end > 0x10ffff ||
          start <= previousEnd
        ) {
          return Result.fail(assetError("loadAsset", "malformed"));
        }
        previousEnd = end;
      }
    }
    sections.push(Object.freeze({
      id,
      name: definition.name,
      recordBytes,
      offset,
      byteLength,
      count,
    }));
    const unalignedEnd = offset + byteLength;
    expectedOffset = align(unalignedEnd, alignment);
    if (
      expectedOffset > bytes.byteLength ||
      !bytesAreZero(bytes, unalignedEnd, expectedOffset)
    ) {
      return Result.fail(assetError("loadAsset", "malformed"));
    }
  }
  if (expectedOffset !== bytes.byteLength) {
    return Result.fail(assetError("loadAsset", "malformed"));
  }
  const expected = expectedGeneratedAsset();
  if (!bytesEqualFullScan(bytes, expected)) {
    return Result.fail(assetError("loadAsset", "nonCanonical"));
  }
  const loadedSections = Object.freeze(sections);
  return Result.succeed(Object.freeze({
    sections: loadedSections,
    usage: Object.freeze({ tableBytes: bytes.byteLength }),
    copyBytes: (): Uint8Array => new Uint8Array(bytes),
    copySectionBytes: (name: string): Uint8Array | undefined => {
      const section = loadedSections.find((candidate) => candidate.name === name);
      return section === undefined
        ? undefined
        : bytes.slice(section.offset, section.offset + section.byteLength);
    },
  }));
}

export function loadGeneratedDeclarativeV2VerifierAssetV1(
  budget: DeclarativeV2VerifierAssetLoadBudgetV1,
): Result.Result<
  DeclarativeV2VerifierLoadedAssetV1,
  DeclarativeV2VerifierAssetV1Error
> {
  return loadDeclarativeV2VerifierAssetV1(expectedGeneratedAsset(), budget);
}

function captureBudgetFrame(
  value: unknown,
  kind: "attempt_usage" | "command_budget",
): Result.Result<
  DeclarativeV2VerifierBudgetFrameV2,
  DeclarativeV2VerifierAssetV1Error
> {
  const keys = ["kind", ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2];
  const record = captureExactOwnDataRecord(value, keys);
  if (record === undefined) {
    return Result.fail(assetError("planArena", "invalidBudget"));
  }
  if (record.kind !== kind) {
    return Result.fail(assetError("planArena", "invalidBudget", "kind"));
  }
  const captured: Record<string, bigint | string> = { kind };
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    const member = record[dimension];
    if (
      typeof member !== "bigint" ||
      member < 0n ||
      member > MAX_SIGNED_INT64
    ) {
      return Result.fail(assetError("planArena", "invalidBudget", dimension));
    }
    captured[dimension] = member;
  }
  return Result.succeed(Object.freeze(captured) as DeclarativeV2VerifierBudgetFrameV2);
}

function checkedAdd(
  left: bigint,
  right: bigint,
): bigint | undefined {
  const result = left + right;
  return result <= MAX_SIGNED_INT64 ? result : undefined;
}

function checkedMultiply(
  left: bigint,
  right: bigint,
): bigint | undefined {
  const result = left * right;
  return result <= MAX_SIGNED_INT64 ? result : undefined;
}

export function planDeclarativeV2VerifierArenaV1(
  input: unknown,
): Result.Result<
  DeclarativeV2VerifierArenaPlanV1,
  DeclarativeV2VerifierAssetV1Error
> {
  return Result.gen(function*() {
  const capturedInput = captureExactOwnDataRecord(
    input,
    ["maximums", "required"],
  );
  if (capturedInput === undefined) {
    return yield* Result.fail(assetError("planArena", "invalidInput"));
  }
  const maximums = yield* captureBudgetFrame(
    capturedInput.maximums,
    "command_budget",
  );
  const required = yield* captureBudgetFrame(
    capturedInput.required,
    "attempt_usage",
  );
  if (required.sourceMapBytes !== 0n) {
    return yield* Result.fail(assetError(
      "planArena",
      "invalidInput",
      "sourceMapBytes",
      required.sourceMapBytes,
      0n,
    ));
  }
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    if (required[dimension] > maximums[dimension]) {
      return yield* Result.fail(assetError(
        "planArena",
        "budgetExceeded",
        dimension,
        required[dimension],
        maximums[dimension],
      ));
    }
  }
  const objectBodyRequired = required.sourceBytes +
    required.sourceMapBytes +
    required.semanticBytes;
  if (objectBodyRequired > required.objectBodyBytes) {
    return yield* Result.fail(assetError(
      "planArena",
      "budgetExceeded",
      "objectBodyBytes",
      objectBodyRequired,
      required.objectBodyBytes,
    ));
  }
  const indexedDimensions: ReadonlyArray<DeclarativeV2VerifierBudgetDimensionV2> = [
    "modules",
    "importEdges",
    "exports",
    "functions",
    "tokens",
    "parserStates",
    "nestingDepth",
    "schemaNodes",
    "validatorNodes",
    "graphNodes",
    "frontierEntries",
  ];
  for (const dimension of indexedDimensions) {
    if (required[dimension] > MAX_U32) {
      return yield* Result.fail(assetError(
        "planArena",
        "addressabilityExceeded",
        dimension,
        required[dimension],
        MAX_U32,
      ));
    }
  }
  const regions: DeclarativeV2VerifierArenaRegionV1[] = [];
  let total = BigInt(DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1.arena.baseBytes);
  const appendRegion = (
    name: string,
    count: bigint,
    width: bigint,
  ): DeclarativeV2VerifierAssetV1Error | undefined => {
    const byteLength = checkedMultiply(count, width);
    if (byteLength === undefined) {
      return assetError("planArena", "overflow", name);
    }
    const next = checkedAdd(total, byteLength);
    if (next === undefined) return assetError("planArena", "overflow", name);
    if (next > MAX_U32) {
      return assetError(
        "planArena",
        "addressabilityExceeded",
        name,
        next,
        MAX_U32,
      );
    }
    regions.push(Object.freeze({
      name,
      offset: Number(total),
      byteLength: Number(byteLength),
    }));
    total = next;
    return undefined;
  };
  for (const width of DECLARATIVE_V2_VERIFIER_ARENA_WIDTHS_V1) {
    const failure = appendRegion(
      width.name,
      required[width.dimension],
      BigInt(width.bytes),
    );
    if (failure !== undefined) return yield* Result.fail(failure);
  }
  for (const factor of DECLARATIVE_V2_VERIFIER_ARENA_BYTE_FACTORS_V1) {
    const failure = appendRegion(
      `${factor.dimension}Storage`,
      required[factor.dimension],
      BigInt(factor.factor),
    );
    if (failure !== undefined) return yield* Result.fail(failure);
  }
  if (required.tableBytes < BigInt(GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetByteLength)) {
    return yield* Result.fail(assetError(
      "planArena",
      "budgetExceeded",
      "tableBytes",
      BigInt(GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetByteLength),
      required.tableBytes,
    ));
  }
  return Object.freeze({
    requiredBytes: Number(total),
    regions: Object.freeze(regions),
    usage: required,
  });
  });
}

export * from "./declarativeV2SemanticRecordsV1";
export * from "./declarativeV2VerificationEvidenceV2";
export * from "./declarativeV2VerifierExecutableV1";
export {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  DeclarativeV2ArtifactModulePathV1Error,
  makeDeclarativeV2ArtifactModulePathFactoryV1,
} from "./declarativeV2ArtifactModulePathV1";
export type {
  DeclarativeV2ArtifactModulePathFactoryV1,
  DeclarativeV2ArtifactModulePathFinishResultV1,
  DeclarativeV2ArtifactModulePathHandleV1,
  DeclarativeV2ArtifactModulePathStepReceiptV1,
  DeclarativeV2ArtifactModulePathUsageV1,
  DeclarativeV2ArtifactModulePathValidatorV1,
} from "./declarativeV2ArtifactModulePathV1";
export {
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_CONTRACT_V1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_IDENTITY_V1,
} from "./declarativeV2VerifierExecutableV1.contract";
