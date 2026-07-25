import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Data, Encoding, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import {
  DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1,
  DECLARATIVE_V2_CORE_DIAGNOSTICS_V1,
} from "./declarativeV2VerifierV1.contract";
import {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  type DeclarativeV2ArtifactModulePathHandleV1,
} from "./declarativeV2ArtifactModulePathV1";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1,
  loadGeneratedDeclarativeV2VerifierAssetV1,
  planDeclarativeV2VerifierArenaV1,
} from "./declarativeV2VerifierV1";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_ASSET_BASE64_V1,
  GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1,
} from "./declarativeV2VerifierExecutableV1.generated";
import {
  DECLARATIVE_V2_CANONICAL_TERMINALS_V1,
  DECLARATIVE_V2_KEYWORDS_V1,
  DECLARATIVE_V2_PARSER_NONTERMINALS_V1,
  DECLARATIVE_V2_PARSER_TERMINALS_V1,
  DECLARATIVE_V2_PLATFORM_IMPORT_ALLOWLIST_V1,
  DECLARATIVE_V2_PUNCTUATORS_V1,
  DECLARATIVE_V2_REGEX_GOAL_AFTER_V1,
  DECLARATIVE_V2_SAFE_ABI_LOOKUP_V1,
  DECLARATIVE_V2_TOKEN_KINDS_V1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_CONTRACT_V1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_SECTIONS_V1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_ALIGNMENT_V1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_HEADER_BYTES_V1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_MAGIC_V1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_SECTION_BYTES_V1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_VERSION_V1,
  DECLARATIVE_V2_VERIFIER_TRANSITION_QUANTUM_V1,
  type DeclarativeV2TokenKindV1,
} from "./declarativeV2VerifierExecutableV1.contract";
import {
  makeIncrementalCanonicalJsonByteSinkV1,
} from "./declarativeV2IncrementalCanonicalJsonV1";
import {
  createDeclarativeV2VerificationEvidenceSinkEncoderV2,
  makeDeclarativeV2DiagnosticEvidenceCursorV2,
  makeDeclarativeV2ImportCallEvidenceCursorV2,
  makeDeclarativeV2ModuleSummaryEvidenceCursorV2,
  makeDeclarativeV2ValueFlowEvidenceCursorV2,
  makeDeclarativeV2VerificationEvidenceBudgetV2,
  makeDeclarativeV2VerificationEvidenceTextCursorV2,
  type DeclarativeV2DiagnosticFrameV2,
  type DeclarativeV2ImportCallFrameV2,
  type DeclarativeV2ModuleSummaryFrameV2,
  type DeclarativeV2VerificationEvidenceCursorV2,
  type DeclarativeV2VerificationEvidenceV2Error,
  type DeclarativeV2VerificationEvidenceTextCursorV2,
  type DeclarativeV2ValueFlowFrameV2,
} from "./declarativeV2VerificationEvidenceV2";
import {
  createDeclarativeV2VerifierRuntimeSha256V1,
  createDeclarativeV2VerifierRuntimeArenaV1,
  declarativeV2VerifierRuntimeArenaRegionV1,
  finishDeclarativeV2VerifierRuntimeSha256V1,
  stepDeclarativeV2VerifierRuntimeSha256V1,
  type DeclarativeV2VerifierRuntimeArenaHandleV1,
} from "./declarativeV2VerifierRuntimeArenaV1";

const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(
  Uint8Array.prototype,
);
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const UINT8_ARRAY_SUBARRAY = Uint8Array.prototype.subarray;
const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const MAX_U32 = 0xffff_ffff;
const EXECUTABLE_ASSET_RESULT = Encoding.decodeBase64(
  GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_ASSET_BASE64_V1,
);

export {
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_CONTRACT_V1,
  GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1,
};

export type DeclarativeV2VerifierExecutableV1ErrorReason =
  | "invalidInput"
  | "invalidBudget"
  | "budgetExceeded"
  | "addressabilityExceeded"
  | "malformedAsset"
  | "unsupportedVersion"
  | "nonCanonicalAsset"
  | "closed"
  | "alreadyFinished"
  | "invalidState";

export class DeclarativeV2VerifierExecutableV1Error extends Data.TaggedError(
  "DeclarativeV2VerifierExecutableV1Error",
)<{
  readonly operation:
    | "loadExecutableAsset"
    | "create"
    | "step"
    | "finish"
    | "link";
  readonly reason: DeclarativeV2VerifierExecutableV1ErrorReason;
  readonly dimension?: string;
  readonly observed?: bigint;
  readonly maximum?: bigint;
}> {}

export interface DeclarativeV2VerifierExecutableSectionV1 {
  readonly id: number;
  readonly name: string;
  readonly recordBytes: number;
  readonly offset: number;
  readonly byteLength: number;
  readonly count: number;
}

export interface DeclarativeV2VerifierExecutableAssetV1 {
  readonly sections: ReadonlyArray<
    DeclarativeV2VerifierExecutableSectionV1
  >;
  readonly usage: Readonly<{ readonly tableBytes: number }>;
  readonly copyBytes: () => Uint8Array;
  readonly lookupHashedString: (
    section:
      | "keywords"
      | "punctuators"
      | "regexGoals"
      | "terminals"
      | "nonterminals"
      | "abiLookup"
      | "diagnosticLookup",
    value: string,
  ) => number | undefined;
  readonly parserAction: (
    state: number,
    terminal: number,
  ) => Readonly<{ readonly action: number; readonly value: number }> | undefined;
  readonly parserGoto: (
    state: number,
    nonterminal: number,
  ) => number | undefined;
  readonly parserProduction: (
    id: number,
  ) => Readonly<{
    readonly lhs: number;
    readonly rhsLength: number;
    readonly semanticOpcode: number;
    readonly rhs: ReadonlyArray<number>;
  }> | undefined;
  readonly operatorPrecedence: (
    spelling: string,
  ) => Readonly<{
    readonly precedence: number;
    readonly associativity: "left" | "right";
  }> | undefined;
  readonly utf8Transition: (
    state: number,
    byteClass: number,
  ) => Readonly<{
    readonly nextState: number;
    readonly action: number;
  }> | undefined;
  readonly numberTransition: (
    state: number,
    input: number,
  ) => Readonly<{
    readonly nextState: number;
    readonly action: number;
  }> | undefined;
  readonly asiAction: (context: number) => number | undefined;
  readonly templateTransition: (
    state: number,
    input: number,
  ) => Readonly<{
    readonly nextState: number;
    readonly action: number;
  }> | undefined;
  readonly parserRecovery: (
    state: number,
    terminal: number,
  ) => Readonly<{
    readonly action: number;
    readonly consumes: number;
  }> | undefined;
  readonly semanticOpcode: (id: number) => number | undefined;
  readonly canonicalAction: (
    state: number,
    terminal: number,
  ) => Readonly<{ readonly action: number; readonly value: number }> | undefined;
  readonly canonicalGoto: (
    state: number,
    nonterminal: number,
  ) => number | undefined;
  readonly canonicalProduction: (
    id: number,
  ) => Readonly<{
    readonly lhs: number;
    readonly rhsLength: number;
    readonly semanticOpcode: number;
  }> | undefined;
  readonly canonicalRecovery: () => Readonly<{
    readonly diagnostic: number;
    readonly consumes: number;
  }>;
}

export interface DeclarativeV2VerifierEngineCreateV1 {
  readonly modulePath: DeclarativeV2ArtifactModulePathHandleV1;
  readonly moduleOrdinal: bigint;
  readonly sourceSha256: Uint8Array;
  readonly maximums: DeclarativeV2VerifierBudgetFrameV2;
  readonly required: DeclarativeV2VerifierBudgetFrameV2;
}

export interface DeclarativeV2VerifierEngineStepReceiptV1 {
  readonly consumedBytes: number;
  readonly transitionCount: number;
  readonly deltaUsage: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

export interface DeclarativeV2VerifierImportSummaryV1 {
  readonly importedName: string;
  readonly localName: string;
  readonly moduleSpecifier: string;
  readonly targetKind: "artifactImport" | "platformImport";
}

export interface DeclarativeV2VerifierExportSummaryV1 {
  readonly exportName: string;
  readonly localName: string;
  readonly isDefault: boolean;
}

export interface DeclarativeV2VerifierFunctionSummaryV1 {
  readonly name: string;
  readonly isAsync: boolean;
  readonly calls: ReadonlyArray<string>;
  readonly capabilities: ReadonlyArray<string>;
}

export interface DeclarativeV2VerifierModuleResultV1 {
  readonly _tag: "DeclarativeV2VerifierModuleResultV1";
  readonly verified: boolean;
  readonly moduleOrdinal: bigint;
  readonly importCount: bigint;
  readonly exportCount: bigint;
  readonly functionCount: bigint;
  readonly callCount: bigint;
  readonly valueFlowCount: bigint;
  readonly diagnosticCount: bigint;
  readonly evidenceSha256: string;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

export interface DeclarativeV2VerifierModulePresentationV1 {
  readonly verified: boolean;
  readonly modulePath: string;
  readonly moduleOrdinal: bigint;
  readonly imports: ReadonlyArray<DeclarativeV2VerifierImportSummaryV1>;
  readonly exports: ReadonlyArray<DeclarativeV2VerifierExportSummaryV1>;
  readonly functions: ReadonlyArray<DeclarativeV2VerifierFunctionSummaryV1>;
  readonly moduleSummary: DeclarativeV2ModuleSummaryFrameV2;
  readonly importCalls: ReadonlyArray<DeclarativeV2ImportCallFrameV2>;
  readonly valueFlows: ReadonlyArray<DeclarativeV2ValueFlowFrameV2>;
  readonly diagnostics: ReadonlyArray<DeclarativeV2DiagnosticFrameV2>;
  readonly evidenceSha256: string;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

type DeclarativeV2VerifierOwnedModuleProjectionV1 = Omit<
  DeclarativeV2VerifierModulePresentationV1,
  "usage"
>;

interface DeclarativeV2VerifierOwnedModuleArenaV1 {
  readonly runtimeArena: DeclarativeV2VerifierRuntimeArenaHandleV1;
  readonly tokenView: DataView;
  readonly stringBytes: Uint8Array;
  readonly outputBytes: Uint8Array;
  readonly moduleView: DataView;
  readonly importEdgeView: DataView;
  readonly exportView: DataView;
  readonly functionView: DataView;
  readonly diagnosticView: DataView;
  readonly sourceSha256: Uint8Array;
  readonly moduleOrdinal: bigint;
  readonly importCount: number;
  readonly exportCount: number;
  readonly functionCount: number;
  readonly callCount: number;
  readonly valueFlowCount: number;
  readonly diagnosticCount: number;
  readonly evidenceSha256: string;
  readonly verified: boolean;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

const OWNED_MODULE_RESULTS = new WeakMap<
  object,
  DeclarativeV2VerifierOwnedModuleArenaV1
>();

export interface DeclarativeV2VerifierEngineFinishPendingV1 {
  readonly status: "pending";
  readonly state:
    | "finishingLexer"
    | "parsing"
    | "semanticFlow"
    | "orderingOutput";
  readonly transitionCount: number;
  readonly deltaUsage: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

export type DeclarativeV2VerifierEngineFinishResultV1 =
  | DeclarativeV2VerifierEngineFinishPendingV1
  | DeclarativeV2VerifierModuleResultV1;

export interface DeclarativeV2VerifierEngineV1 {
  readonly step: (
    bytes: unknown,
    maximumTransitions: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierEngineStepReceiptV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly finish: (maximumTransitions: unknown) => Result.Result<
    DeclarativeV2VerifierEngineFinishResultV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
}

interface TokenView {
  readonly index: number;
  readonly kind: DeclarativeV2TokenKindV1;
  readonly start: number;
  readonly end: number;
  readonly lineBefore: boolean;
}

interface MutableImport {
  importedNameToken: number;
  localNameToken: number;
  moduleSpecifierToken: number;
  targetKind: "artifactImport" | "platformImport";
}

interface MutableExport {
  exportNameToken: number;
  localNameToken: number;
  isDefault: boolean;
}

interface MutableFunction {
  nameToken: number;
  isAsync: boolean;
  bodyStart: number;
  bodyEnd: number;
}

type LexerMode =
  | "code"
  | "identifier"
  | "identifierEscape"
  | "number"
  | "singleString"
  | "doubleString"
  | "stringEscape"
  | "template"
  | "templateDollar"
  | "templateEscape"
  | "lineComment"
  | "blockComment"
  | "blockCommentStar"
  | "slash"
  | "regexp"
  | "regexpEscape"
  | "regexpClass";

function executableError(
  operation: DeclarativeV2VerifierExecutableV1Error["operation"],
  reason: DeclarativeV2VerifierExecutableV1ErrorReason,
  evidence?: Readonly<{
    readonly dimension?: string;
    readonly observed?: bigint;
    readonly maximum?: bigint;
  }>,
): DeclarativeV2VerifierExecutableV1Error {
  return new DeclarativeV2VerifierExecutableV1Error({
    operation,
    reason,
    ...(evidence?.dimension === undefined
      ? {}
      : { dimension: evidence.dimension }),
    ...(evidence?.observed === undefined
      ? {}
      : { observed: evidence.observed }),
    ...(evidence?.maximum === undefined
      ? {}
      : { maximum: evidence.maximum }),
  });
}

function intrinsicByteLength(value: Uint8Array): number | undefined {
  try {
    const observed = TYPED_ARRAY_BYTE_LENGTH_GETTER?.call(value) as unknown;
    return typeof observed === "number" ? observed : undefined;
  } catch {
    return undefined;
  }
}

function readU16(bytes: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 2 > bytes.byteLength) return undefined;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint16(offset, false);
}

function readU32(bytes: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 4 > bytes.byteLength) return undefined;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(offset, false);
}

function align(value: number, alignment: number): number {
  const remainder = value % alignment;
  return remainder === 0 ? value : value + alignment - remainder;
}

function bytesAreZero(bytes: Uint8Array, start: number, end: number): boolean {
  let combined = 0;
  for (let index = start; index < end; index += 1) {
    combined |= bytes[index] ?? 0;
  }
  return combined === 0;
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (const byte of encodeUtf8Owned(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function isExactExecutableLookupSpelling(
  sectionName:
    | "keywords"
    | "punctuators"
    | "regexGoals"
    | "terminals"
    | "nonterminals"
    | "abiLookup"
    | "diagnosticLookup",
  value: string,
): boolean {
  switch (sectionName) {
    case "keywords":
      return DECLARATIVE_V2_KEYWORDS_V1.some((candidate) => candidate === value);
    case "punctuators":
      return DECLARATIVE_V2_PUNCTUATORS_V1.some(
        (candidate) => candidate === value,
      );
    case "regexGoals":
      return DECLARATIVE_V2_REGEX_GOAL_AFTER_V1.some(
        (candidate) => `${candidate.token}:${candidate.goal}` === value,
      );
    case "terminals":
      return DECLARATIVE_V2_PARSER_TERMINALS_V1.some(
        (candidate) => candidate.name === value,
      );
    case "nonterminals":
      return DECLARATIVE_V2_PARSER_NONTERMINALS_V1.some(
        (candidate) => candidate.name === value,
      );
    case "abiLookup":
      return DECLARATIVE_V2_SAFE_ABI_LOOKUP_V1.some(
        (candidate) => candidate === value,
      );
    case "diagnosticLookup":
      return DECLARATIVE_V2_CORE_DIAGNOSTICS_V1.some(
        (candidate) => candidate.code === value,
      );
  }
}

function expectedExecutableAsset(): Uint8Array {
  if (Result.isFailure(EXECUTABLE_ASSET_RESULT)) {
    throw new Error("Generated executable verifier asset is invalid base64.");
  }
  return EXECUTABLE_ASSET_RESULT.success;
}

export function loadDeclarativeV2VerifierExecutableAssetV1(
  input: unknown,
  maximumTableBytes: unknown,
): Result.Result<
  DeclarativeV2VerifierExecutableAssetV1,
  DeclarativeV2VerifierExecutableV1Error
> {
  if (!isNonNegativeSafeInteger(maximumTableBytes)) {
    return Result.fail(
      executableError("loadExecutableAsset", "invalidBudget"),
    );
  }
  if (!isUint8Array(input)) {
    return Result.fail(executableError("loadExecutableAsset", "invalidInput"));
  }
  const visibleLength = intrinsicByteLength(input);
  if (visibleLength === undefined) {
    return Result.fail(executableError("loadExecutableAsset", "invalidInput"));
  }
  if (visibleLength > maximumTableBytes) {
    return Result.fail(executableError(
      "loadExecutableAsset",
      "budgetExceeded",
      {
        dimension: "tableBytes",
        observed: BigInt(visibleLength),
        maximum: BigInt(maximumTableBytes),
      },
    ));
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(input);
  } catch {
    return Result.fail(executableError("loadExecutableAsset", "invalidInput"));
  }
  const magic = encodeUtf8Owned(
    DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_MAGIC_V1,
  );
  if (
    bytes.byteLength <
      DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_HEADER_BYTES_V1 ||
    !bytesEqualFullScan(bytes.subarray(0, magic.byteLength), magic)
  ) {
    return Result.fail(
      executableError("loadExecutableAsset", "malformedAsset"),
    );
  }
  if (
    readU32(bytes, 8) !==
      DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_VERSION_V1
  ) {
    return Result.fail(
      executableError("loadExecutableAsset", "unsupportedVersion"),
    );
  }
  const headerBytes = readU32(bytes, 12);
  const sectionCount = readU32(bytes, 16);
  const sectionBytes = readU32(bytes, 20);
  const alignment = readU32(bytes, 24);
  const reserved = readU32(bytes, 28);
  if (
    headerBytes !==
      DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_HEADER_BYTES_V1 ||
    sectionCount !== DECLARATIVE_V2_VERIFIER_EXECUTABLE_SECTIONS_V1.length ||
    sectionBytes !==
      DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_SECTION_BYTES_V1 ||
    alignment !== DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_ALIGNMENT_V1 ||
    reserved !== 0
  ) {
    return Result.fail(
      executableError("loadExecutableAsset", "malformedAsset"),
    );
  }
  const tableEnd = headerBytes + sectionCount * sectionBytes;
  let expectedOffset = align(tableEnd, alignment);
  if (
    expectedOffset > bytes.byteLength ||
    !bytesAreZero(bytes, tableEnd, expectedOffset)
  ) {
    return Result.fail(
      executableError("loadExecutableAsset", "malformedAsset"),
    );
  }
  const sections: DeclarativeV2VerifierExecutableSectionV1[] = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const expected = DECLARATIVE_V2_VERIFIER_EXECUTABLE_SECTIONS_V1[index]!;
    const entry = headerBytes + index * sectionBytes;
    const id = readU32(bytes, entry);
    const recordBytes = readU32(bytes, entry + 4);
    const offset = readU32(bytes, entry + 8);
    const byteLength = readU32(bytes, entry + 12);
    const count = readU32(bytes, entry + 16);
    const flags = readU32(bytes, entry + 20);
    if (
      id !== expected.id ||
      recordBytes !== expected.recordBytes ||
      offset !== expectedOffset ||
      byteLength === undefined ||
      count === undefined ||
      flags !== 0 ||
      byteLength % recordBytes !== 0 ||
      count !== byteLength / recordBytes ||
      offset + byteLength > bytes.byteLength
    ) {
      return Result.fail(
        executableError("loadExecutableAsset", "malformedAsset"),
      );
    }
    if (
      expected.name !== "byteClasses" &&
      expected.name !== "keywords" &&
      expected.name !== "punctuators" &&
      expected.name !== "regexGoals" &&
      expected.name !== "terminals" &&
      expected.name !== "nonterminals" &&
      expected.name !== "abiLookup" &&
      expected.name !== "diagnosticLookup" &&
      expected.name !== "canonicalContract"
    ) {
      for (let row = 0; row < count; row += 1) {
        if (readU32(bytes, offset + row * recordBytes) !== row + 1) {
          return Result.fail(
            executableError("loadExecutableAsset", "malformedAsset"),
          );
        }
      }
    }
    sections.push(Object.freeze({
      id,
      name: expected.name,
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
      return Result.fail(
        executableError("loadExecutableAsset", "malformedAsset"),
      );
    }
  }
  if (expectedOffset !== bytes.byteLength) {
    return Result.fail(
      executableError("loadExecutableAsset", "malformedAsset"),
    );
  }
  if (!bytesEqualFullScan(bytes, expectedExecutableAsset())) {
    return Result.fail(
      executableError("loadExecutableAsset", "nonCanonicalAsset"),
    );
  }
  const frozenSections = Object.freeze(sections);
  const sectionNamed = (
    name: string,
  ): DeclarativeV2VerifierExecutableSectionV1 | undefined =>
    frozenSections.find((section) => section.name === name);
  const pairRow = (
    sectionName: string,
    left: number,
    right: number,
  ): number | undefined => {
    const section = sectionNamed(sectionName);
    if (section === undefined) return undefined;
    let low = 0;
    let high = section.count - 1;
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2);
      const offset = section.offset + middle * section.recordBytes;
      const observedLeft = readU32(bytes, offset + 4);
      const observedRight = readU32(bytes, offset + 8);
      if (observedLeft === undefined || observedRight === undefined) {
        return undefined;
      }
      if (
        observedLeft < left ||
        observedLeft === left && observedRight < right
      ) {
        low = middle + 1;
      } else if (
        observedLeft > left ||
        observedLeft === left && observedRight > right
      ) {
        high = middle - 1;
      } else {
        return offset;
      }
    }
    return undefined;
  };
  return Result.succeed(Object.freeze({
    sections: frozenSections,
    usage: Object.freeze({ tableBytes: bytes.byteLength }),
    copyBytes: (): Uint8Array => new Uint8Array(bytes),
    lookupHashedString: (
      sectionName:
        | "keywords"
        | "punctuators"
        | "regexGoals"
        | "terminals"
        | "nonterminals"
        | "abiLookup"
        | "diagnosticLookup",
      value: string,
    ): number | undefined => {
      if (!isExactExecutableLookupSpelling(sectionName, value)) {
        return undefined;
      }
      const section = frozenSections.find(({ name }) => name === sectionName);
      if (section === undefined) return undefined;
      const hash = fnv1a32(value);
      const length = utf8ByteLength(value);
      for (let row = 0; row < section.count; row += 1) {
        const offset = section.offset + row * section.recordBytes;
        if (
          readU32(bytes, offset) === hash &&
          readU16(bytes, offset + 4) === length
        ) {
          return readU16(bytes, offset + 6);
        }
      }
      return undefined;
    },
    parserAction: (
      state: number,
      terminal: number,
    ): Readonly<{ readonly action: number; readonly value: number }> | undefined => {
      const section = frozenSections.find(({ name }) => name === "parserActions");
      if (section === undefined) return undefined;
      for (let row = 0; row < section.count; row += 1) {
        const offset = section.offset + row * section.recordBytes;
        if (
          readU32(bytes, offset + 4) === state &&
          readU32(bytes, offset + 8) === terminal
        ) {
          const action = readU32(bytes, offset + 12);
          const value = readU32(bytes, offset + 16);
          if (action === undefined || value === undefined) return undefined;
          return Object.freeze({
            action,
            value,
          });
        }
      }
      return undefined;
    },
    parserGoto: (state: number, nonterminal: number): number | undefined => {
      const section = frozenSections.find(({ name }) => name === "parserGotos");
      if (section === undefined) return undefined;
      for (let row = 0; row < section.count; row += 1) {
        const offset = section.offset + row * section.recordBytes;
        if (
          readU32(bytes, offset + 4) === state &&
          readU32(bytes, offset + 8) === nonterminal
        ) {
          return readU32(bytes, offset + 12);
        }
      }
      return undefined;
    },
    parserProduction: (
      id: number,
    ): Readonly<{
      readonly lhs: number;
      readonly rhsLength: number;
      readonly semanticOpcode: number;
      readonly rhs: ReadonlyArray<number>;
    }> | undefined => {
      const section = frozenSections.find(({ name }) => name === "productions");
      if (section === undefined || id < 1 || id > section.count) {
        return undefined;
      }
      const offset = section.offset + (id - 1) * section.recordBytes;
      if (readU32(bytes, offset) !== id) return undefined;
      const lhs = readU32(bytes, offset + 4);
      const rhsLength = readU32(bytes, offset + 8);
      const semanticOpcode = readU32(bytes, offset + 12);
      if (
        lhs === undefined ||
        rhsLength === undefined ||
        rhsLength > 4 ||
        semanticOpcode === undefined
      ) return undefined;
      const rhs = Object.freeze(Array.from(
        { length: rhsLength },
        (_, index) => readU32(bytes, offset + 16 + index * 4) ?? 0,
      ));
      return Object.freeze({ lhs, rhsLength, semanticOpcode, rhs });
    },
    operatorPrecedence: (
      spelling: string,
    ): Readonly<{
      readonly precedence: number;
      readonly associativity: "left" | "right";
    }> | undefined => {
      const section = frozenSections.find(({ name }) => name === "precedence");
      if (section === undefined) return undefined;
      const hash = fnv1a32(spelling);
      for (let row = 0; row < section.count; row += 1) {
        const offset = section.offset + row * section.recordBytes;
        if (readU32(bytes, offset + 12) === hash) {
          const precedence = readU32(bytes, offset + 4);
          const associativity = readU32(bytes, offset + 8);
          if (precedence === undefined || associativity === undefined) {
            return undefined;
          }
          return Object.freeze({
            precedence,
            associativity: associativity === 2
              ? "right"
              : "left",
          });
        }
      }
      return undefined;
    },
    utf8Transition: (
      state: number,
      byteClass: number,
    ): Readonly<{ readonly nextState: number; readonly action: number }> |
      undefined => {
      const section = frozenSections.find(({ name }) => name ===
        "utf8Transitions");
      if (section === undefined) return undefined;
      for (let row = 0; row < section.count; row += 1) {
        const offset = section.offset + row * section.recordBytes;
        if (
          readU32(bytes, offset + 4) === state &&
          readU32(bytes, offset + 8) === byteClass
        ) {
          const nextState = readU32(bytes, offset + 12);
          const action = readU32(bytes, offset + 16);
          if (nextState === undefined || action === undefined) return undefined;
          return Object.freeze({ nextState, action });
        }
      }
      return undefined;
    },
    numberTransition: (
      state: number,
      input: number,
    ): Readonly<{ readonly nextState: number; readonly action: number }> |
      undefined => {
      const section = frozenSections.find(({ name }) => name ===
        "numberTransitions");
      if (section === undefined) return undefined;
      for (let row = 0; row < section.count; row += 1) {
        const offset = section.offset + row * section.recordBytes;
        if (
          readU32(bytes, offset + 4) === state &&
          readU32(bytes, offset + 8) === input
        ) {
          const nextState = readU32(bytes, offset + 12);
          const action = readU32(bytes, offset + 16);
          if (nextState === undefined || action === undefined) return undefined;
          return Object.freeze({ nextState, action });
        }
      }
      return undefined;
    },
    asiAction: (context: number): number | undefined => {
      const section = frozenSections.find(({ name }) => name ===
        "asiTransitions");
      if (section === undefined) return undefined;
      for (let row = 0; row < section.count; row += 1) {
        const offset = section.offset + row * section.recordBytes;
        if (readU32(bytes, offset + 4) === context) {
          return readU32(bytes, offset + 8);
        }
      }
      return undefined;
    },
    templateTransition: (
      state: number,
      input: number,
    ): Readonly<{ readonly nextState: number; readonly action: number }> |
      undefined => {
      const section = frozenSections.find(({ name }) => name ===
        "templateTransitions");
      if (section === undefined) return undefined;
      for (let row = 0; row < section.count; row += 1) {
        const offset = section.offset + row * section.recordBytes;
        if (
          readU32(bytes, offset + 4) === state &&
          readU32(bytes, offset + 8) === input
        ) {
          const nextState = readU32(bytes, offset + 12);
          const action = readU32(bytes, offset + 16);
          if (nextState === undefined || action === undefined) return undefined;
          return Object.freeze({ nextState, action });
        }
      }
      return undefined;
    },
    parserRecovery: (
      state: number,
      terminal: number,
    ): Readonly<{ readonly action: number; readonly consumes: number }> |
      undefined => {
      const section = frozenSections.find(({ name }) => name === "recovery");
      if (section === undefined) return undefined;
      for (let row = 0; row < section.count; row += 1) {
        const offset = section.offset + row * section.recordBytes;
        if (
          readU32(bytes, offset + 4) === state &&
          readU32(bytes, offset + 8) === terminal
        ) {
          const action = readU32(bytes, offset + 12);
          const consumes = readU32(bytes, offset + 16);
          if (action === undefined || consumes === undefined) return undefined;
          return Object.freeze({ action, consumes });
        }
      }
      return undefined;
    },
    semanticOpcode: (id: number): number | undefined => {
      const section = frozenSections.find(({ name }) => name ===
        "semanticActions");
      if (section === undefined) return undefined;
      for (let row = 0; row < section.count; row += 1) {
        const offset = section.offset + row * section.recordBytes;
        if (readU32(bytes, offset) === id) {
          return readU32(bytes, offset + 4);
        }
      }
      return undefined;
    },
    canonicalAction: (
      state: number,
      terminal: number,
    ): Readonly<{ readonly action: number; readonly value: number }> | undefined => {
      const offset = pairRow("canonicalLrActions", state, terminal);
      if (offset === undefined) return undefined;
      const action = readU32(bytes, offset + 12);
      const value = readU32(bytes, offset + 16);
      return action === undefined || value === undefined
        ? undefined
        : Object.freeze({ action, value });
    },
    canonicalGoto: (
      state: number,
      nonterminal: number,
    ): number | undefined => {
      const offset = pairRow("canonicalLrGotos", state, nonterminal);
      return offset === undefined ? undefined : readU32(bytes, offset + 12);
    },
    canonicalProduction: (
      id: number,
    ): Readonly<{
      readonly lhs: number;
      readonly rhsLength: number;
      readonly semanticOpcode: number;
    }> | undefined => {
      const section = sectionNamed("canonicalProductionHeaders");
      if (section === undefined || id < 1 || id > section.count) {
        return undefined;
      }
      const offset = section.offset + (id - 1) * section.recordBytes;
      if (readU32(bytes, offset) !== id) return undefined;
      const lhs = readU32(bytes, offset + 4);
      const rhsLength = readU32(bytes, offset + 12);
      const semanticOpcode = readU32(bytes, offset + 20);
      return lhs === undefined ||
          rhsLength === undefined ||
          semanticOpcode === undefined
        ? undefined
        : Object.freeze({ lhs, rhsLength, semanticOpcode });
    },
    canonicalRecovery: (): Readonly<{
      readonly diagnostic: number;
      readonly consumes: number;
    }> => {
      const section = sectionNamed("canonicalLrRecovery");
      if (section === undefined || section.count !== 1) {
        throw new Error("Canonical recovery policy is missing.");
      }
      const diagnostic = readU32(bytes, section.offset + 12);
      const consumes = readU32(bytes, section.offset + 16);
      if (
        readU32(bytes, section.offset + 4) !== 0 ||
        readU32(bytes, section.offset + 8) !== 0 ||
        diagnostic === undefined ||
        consumes === undefined
      ) {
        throw new Error("Canonical recovery policy is malformed.");
      }
      return Object.freeze({ diagnostic, consumes });
    },
  }));
}

export function loadGeneratedDeclarativeV2VerifierExecutableAssetV1(
  maximumTableBytes: number,
): Result.Result<
  DeclarativeV2VerifierExecutableAssetV1,
  DeclarativeV2VerifierExecutableV1Error
> {
  return loadDeclarativeV2VerifierExecutableAssetV1(
    expectedExecutableAsset(),
    maximumTableBytes,
  );
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    if (first <= 0x7f) length += 1;
    else if (first <= 0x7ff) length += 2;
    else if (first >= 0xd800 && first <= 0xdbff) {
      length += 4;
      index += 1;
    } else length += 3;
  }
  return length;
}

function encodeUtf8Owned(value: string): Uint8Array {
  const output = new Uint8Array(utf8ByteLength(value));
  let offset = 0;
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    let codePoint = first;
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      codePoint = 0x1_0000 +
        ((first - 0xd800) << 10) +
        (second - 0xdc00);
      index += 1;
    }
    if (codePoint <= 0x7f) {
      output[offset] = codePoint;
      offset += 1;
    } else if (codePoint <= 0x7ff) {
      output[offset] = 0xc0 | (codePoint >>> 6);
      output[offset + 1] = 0x80 | (codePoint & 0x3f);
      offset += 2;
    } else if (codePoint <= 0xffff) {
      output[offset] = 0xe0 | (codePoint >>> 12);
      output[offset + 1] = 0x80 | ((codePoint >>> 6) & 0x3f);
      output[offset + 2] = 0x80 | (codePoint & 0x3f);
      offset += 3;
    } else {
      output[offset] = 0xf0 | (codePoint >>> 18);
      output[offset + 1] = 0x80 | ((codePoint >>> 12) & 0x3f);
      output[offset + 2] = 0x80 | ((codePoint >>> 6) & 0x3f);
      output[offset + 3] = 0x80 | (codePoint & 0x3f);
      offset += 4;
    }
  }
  return output;
}

function hasCanonicalRelativeModuleSegments(value: string): boolean {
  if (!value.startsWith("./") || value.length <= 2) return false;
  let segmentStart = 2;
  for (let index = 2; index <= value.length; index += 1) {
    const atEnd = index === value.length;
    const code = atEnd ? 0x2f : value.charCodeAt(index);
    if (code === 0x5c) return false;
    if (code !== 0x2f) continue;
    const segmentLength = index - segmentStart;
    if (
      segmentLength === 0 ||
      segmentLength === 1 &&
        value.charCodeAt(segmentStart) === 0x2e ||
      segmentLength === 2 &&
        value.charCodeAt(segmentStart) === 0x2e &&
        value.charCodeAt(segmentStart + 1) === 0x2e
    ) return false;
    segmentStart = index + 1;
  }
  return true;
}

function decodeValidatedUtf8(bytes: Uint8Array): string | undefined {
  let output = "";
  for (let offset = 0; offset < bytes.byteLength;) {
    const first = bytes[offset]!;
    let codePoint: number;
    let width: number;
    if (first <= 0x7f) {
      codePoint = first;
      width = 1;
    } else if (first >= 0xc2 && first <= 0xdf) {
      if (offset + 1 >= bytes.byteLength) return undefined;
      const second = bytes[offset + 1]!;
      if (second < 0x80 || second > 0xbf) return undefined;
      codePoint = ((first & 0x1f) << 6) | (second & 0x3f);
      width = 2;
    } else if (first >= 0xe0 && first <= 0xef) {
      if (offset + 2 >= bytes.byteLength) return undefined;
      const second = bytes[offset + 1]!;
      const third = bytes[offset + 2]!;
      if (
        second < 0x80 ||
        second > 0xbf ||
        third < 0x80 ||
        third > 0xbf
      ) return undefined;
      codePoint = ((first & 0x0f) << 12) |
        ((second & 0x3f) << 6) |
        (third & 0x3f);
      if (
        codePoint < 0x800 ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) return undefined;
      width = 3;
    } else if (first >= 0xf0 && first <= 0xf4) {
      if (offset + 3 >= bytes.byteLength) return undefined;
      const second = bytes[offset + 1]!;
      const third = bytes[offset + 2]!;
      const fourth = bytes[offset + 3]!;
      if (
        second < 0x80 ||
        second > 0xbf ||
        third < 0x80 ||
        third > 0xbf ||
        fourth < 0x80 ||
        fourth > 0xbf
      ) return undefined;
      codePoint = ((first & 0x07) << 18) |
        ((second & 0x3f) << 12) |
        ((third & 0x3f) << 6) |
        (fourth & 0x3f);
      if (codePoint < 0x1_0000 || codePoint > 0x10ffff) return undefined;
      width = 4;
    } else return undefined;
    output += String.fromCodePoint(codePoint);
    offset += width;
  }
  return output;
}

function captureCreateInput(
  value: unknown,
): DeclarativeV2VerifierEngineCreateV1 | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const keys = [
    "modulePath",
    "moduleOrdinal",
    "sourceSha256",
    "maximums",
    "required",
  ] as const;
  const captured: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  try {
    if (Array.isArray(value)) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) =>
        typeof key !== "string" ||
        !keys.includes(key as typeof keys[number])
      )
    ) {
      return undefined;
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        return undefined;
      }
      captured[key] = descriptor.value;
    }
  } catch {
    return undefined;
  }
  const modulePath = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.capture(
    captured.modulePath,
  );
  if (
    Result.isFailure(modulePath) ||
    typeof captured.moduleOrdinal !== "bigint" ||
    captured.moduleOrdinal < 0n ||
    captured.moduleOrdinal > MAX_SIGNED_INT64 ||
    !isUint8ArrayWithByteLength(captured.sourceSha256, 32)
  ) {
    return undefined;
  }
  let digest: Uint8Array;
  try {
    digest = new Uint8Array(captured.sourceSha256);
  } catch {
    return undefined;
  }
  return Object.freeze({
    modulePath: modulePath.success,
    moduleOrdinal: captured.moduleOrdinal,
    sourceSha256: digest,
    maximums: captured.maximums as DeclarativeV2VerifierBudgetFrameV2,
    required: captured.required as DeclarativeV2VerifierBudgetFrameV2,
  });
}

function zeroUsage(): Record<
  typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
  bigint
> {
  return Object.fromEntries(
    DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map((dimension) => [
      dimension,
      0n,
    ]),
  ) as Record<
    typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
    bigint
  >;
}

function frozenUsage(
  usage: Readonly<Record<
    typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
    bigint
  >>,
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze({
    kind: "attempt_usage",
    ...usage,
  });
}

function usageSnapshot(
  usage: Readonly<Record<
    typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
    bigint
  >>,
): Record<
  typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
  bigint
> {
  return Object.fromEntries(
    DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map((dimension) => [
      dimension,
      usage[dimension],
    ]),
  ) as Record<
    typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
    bigint
  >;
}

function frozenUsageDelta(
  usage: Readonly<Record<
    typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
    bigint
  >>,
  before: Readonly<Record<
    typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
    bigint
  >>,
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze({
    kind: "attempt_usage",
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map((dimension) => [
        dimension,
        usage[dimension] - before[dimension],
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2;
}

function captureTransitionAllowance(
  value: unknown,
  operation: "step" | "finish" | "link",
): Result.Result<number, DeclarativeV2VerifierExecutableV1Error> {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > DECLARATIVE_V2_VERIFIER_TRANSITION_QUANTUM_V1
  ) {
    return Result.fail(executableError(operation, "invalidInput", {
      dimension: "transitionQuantum",
      ...(typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0
        ? { observed: BigInt(Math.trunc(value)) }
        : {}),
      maximum: BigInt(DECLARATIVE_V2_VERIFIER_TRANSITION_QUANTUM_V1),
    }));
  }
  return Result.succeed(value);
}

function diagnosticDefinition(code: string): Readonly<{
  readonly id: number;
  readonly code: string;
  readonly phase: string;
  readonly order: number;
  readonly rule: string;
}> {
  const found = DECLARATIVE_V2_CORE_DIAGNOSTICS_V1.find(
    (candidate) => candidate.code === code,
  );
  if (found === undefined) throw new Error(`Unknown diagnostic ${code}.`);
  return found;
}

function abiDefinition(name: string): Readonly<{
  readonly id: number;
  readonly name: string;
  readonly capability: string;
  readonly catchability: string;
  readonly semantics: string;
}> | undefined {
  return DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1.find(
    (candidate) => candidate.name === name,
  );
}

function tokenKindId(kind: DeclarativeV2TokenKindV1): number {
  const found = DECLARATIVE_V2_TOKEN_KINDS_V1.find(
    (candidate) => candidate.name === kind,
  );
  if (found === undefined) throw new Error(`Unknown token kind ${kind}.`);
  return found.id;
}

function tokenKindName(id: number): DeclarativeV2TokenKindV1 {
  const found = DECLARATIVE_V2_TOKEN_KINDS_V1.find(
    (candidate) => candidate.id === id,
  );
  if (found === undefined) throw new Error(`Unknown token kind ID ${id}.`);
  return found.name;
}

function canonicalTerminalId(name: string): number | undefined {
  return DECLARATIVE_V2_CANONICAL_TERMINALS_V1.find(
    (terminal) => terminal.name === name,
  )?.id;
}

export function createDeclarativeV2VerifierEngineV1(
  rawInput: unknown,
): Result.Result<
  DeclarativeV2VerifierEngineV1,
  DeclarativeV2VerifierExecutableV1Error
> {
  const input = captureCreateInput(rawInput);
  if (input === undefined) {
    return Result.fail(executableError("create", "invalidInput"));
  }
  const prepared = Result.gen(function*() {
    const arenaPlan = yield* planDeclarativeV2VerifierArenaV1({
      maximums: input.maximums,
      required: input.required,
    }).pipe(Result.mapError((failure) => {
      const evidence = {
        ...(failure.path === undefined ? {} : { dimension: failure.path }),
        ...(failure.observed === undefined
          ? {}
          : { observed: failure.observed }),
        ...(failure.maximum === undefined
          ? {}
          : { maximum: failure.maximum }),
      };
      return executableError(
        "create",
        failure.reason === "addressabilityExceeded"
          ? "addressabilityExceeded"
          : failure.reason === "budgetExceeded"
          ? "budgetExceeded"
          : "invalidBudget",
        evidence,
      );
    }));
    const required = Object.freeze({
      ...arenaPlan.usage,
    }) satisfies DeclarativeV2VerifierBudgetFrameV2;
    for (const [dimension, minimum] of [
      ["calls", 1n],
      ["modules", 1n],
      ["parserStates", 1n],
      ["tokens", 1n],
    ] as const) {
      if (required[dimension] < minimum) {
        return yield* Result.fail(executableError(
          "create",
          "budgetExceeded",
          {
            dimension,
            observed: minimum,
            maximum: required[dimension],
          },
        ));
      }
    }
    const specificationAsset =
      yield* loadGeneratedDeclarativeV2VerifierAssetV1({
        maximumTableBytes:
          GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetByteLength,
      }).pipe(Result.mapError(() =>
        executableError("create", "invalidBudget", {
          dimension: "tableBytes",
        })
      ));
    const unicodeIdStart =
      specificationAsset.copySectionBytes("unicodeIdStart");
    const unicodeIdContinue =
      specificationAsset.copySectionBytes("unicodeIdContinue");
    if (unicodeIdStart === undefined || unicodeIdContinue === undefined) {
      throw new Error("Accepted verifier asset lost its Unicode range tables.");
    }
    const executableAssetBytes =
      GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1.assetByteLength;
    const totalTableBytes =
      BigInt(specificationAsset.usage.tableBytes + executableAssetBytes);
    if (required.tableBytes < totalTableBytes) {
      return yield* Result.fail(executableError(
        "create",
        "budgetExceeded",
        {
          dimension: "tableBytes",
          observed: totalTableBytes,
          maximum: required.tableBytes,
        },
      ));
    }
    const executableAsset =
      yield* loadGeneratedDeclarativeV2VerifierExecutableAssetV1(
        executableAssetBytes,
      );
    return {
      arenaPlan,
      required,
      specificationAsset,
      executableAsset,
      unicodeIdStart,
      unicodeIdContinue,
      totalTableBytes,
    };
  });
  if (Result.isFailure(prepared)) return Result.fail(prepared.failure);
  const {
    arenaPlan,
    required,
    executableAsset,
    unicodeIdStart,
    unicodeIdContinue,
    totalTableBytes,
  } = prepared.success;

  const runtimeArena = createDeclarativeV2VerifierRuntimeArenaV1(
    arenaPlan,
  );
  if (Result.isFailure(runtimeArena)) {
    return Result.fail(executableError(
      "create",
      runtimeArena.failure.reason === "addressabilityExceeded"
        ? "addressabilityExceeded"
        : "invalidState",
    ));
  }
  const getArenaRegion = (name: string): Uint8Array => {
    const found = declarativeV2VerifierRuntimeArenaRegionV1(
      runtimeArena.success,
      name,
    );
    if (Result.isFailure(found)) {
      throw new Error(`Verifier arena is missing ${name}.`);
    }
    return found.success;
  };
  const tokenRegion = getArenaRegion("tokenRecord");
  const parserStateRegion = getArenaRegion("parserStateRecord");
  const tokenBytesRegion = getArenaRegion("tokenBytesStorage");
  const nestingRegion = getArenaRegion("nestingRecord");
  const stringRegion = getArenaRegion("stringBytesStorage");
  const moduleRegion = getArenaRegion("moduleRecord");
  const importEdgeRegion = getArenaRegion("importEdgeRecord");
  const exportRegion = getArenaRegion("exportRecord");
  const functionRegion = getArenaRegion("functionRecord");
  const graphNodeRegion = getArenaRegion("graphNodeRecord");
  const diagnosticRegion = getArenaRegion("diagnosticBytesStorage");
  const outputRegion = getArenaRegion("outputBytesStorage");
  const tokenView = new DataView(
    tokenRegion.buffer,
    tokenRegion.byteOffset,
    tokenRegion.byteLength,
  );
  const parserStateView = new DataView(
    parserStateRegion.buffer,
    parserStateRegion.byteOffset,
    parserStateRegion.byteLength,
  );
  const nestingView = new DataView(
    nestingRegion.buffer,
    nestingRegion.byteOffset,
    nestingRegion.byteLength,
  );
  const moduleView = new DataView(
    moduleRegion.buffer,
    moduleRegion.byteOffset,
    moduleRegion.byteLength,
  );
  const importEdgeView = new DataView(
    importEdgeRegion.buffer,
    importEdgeRegion.byteOffset,
    importEdgeRegion.byteLength,
  );
  const exportView = new DataView(
    exportRegion.buffer,
    exportRegion.byteOffset,
    exportRegion.byteLength,
  );
  const functionView = new DataView(
    functionRegion.buffer,
    functionRegion.byteOffset,
    functionRegion.byteLength,
  );
  const graphNodeView = new DataView(
    graphNodeRegion.buffer,
    graphNodeRegion.byteOffset,
    graphNodeRegion.byteLength,
  );
  const diagnosticView = new DataView(
    diagnosticRegion.buffer,
    diagnosticRegion.byteOffset,
    diagnosticRegion.byteLength,
  );
  const stringBytes = stringRegion;
  const outputBytes = outputRegion;
  const lexemeStorage = tokenBytesRegion;
  const maximumTokens = Number(required.tokens);
  const usage = zeroUsage();
  usage.calls = 1n;
  usage.tableBytes = totalTableBytes;
  usage.modules = 1n;
  usage.parserStates = 1n;
  usage.objectBodyBytes = 0n;
  usage.sourceBytes = 0n;
  usage.sourceMapBytes = 0n;
  usage.semanticBytes = 0n;

  let mode: LexerMode = "code";
  let previousStringMode: "singleString" | "doubleString" | undefined;
  let identifierEscapeStage:
    | "expectU"
    | "firstHexOrBrace"
    | "fixedHex"
    | "bracedHex" = "expectU";
  let identifierEscapeDigits = "";
  let tokenCount = 0;
  let stringCursor = 0;
  let sourceOffset = 0;
  let tokenStart = 0;
  let lineBeforeNextToken = false;
  let currentTokenLineBefore = false;
  let lexemeLength = 0;
  let punctuator = "";
  let punctuatorStart = 0;
  let regexpClass = false;
  let templateStackLength = 0;
  const pendingUtf8 = new Uint8Array(4);
  let pendingUtf8Length = 0;
  let utf8State = 0;
  let numberState = 0;
  type EngineState =
    | "acceptingSource"
    | "finishingLexer"
    | "parsing"
    | "semanticFlow"
    | "orderingOutput"
    | "complete"
    | "failed";
  let engineState: EngineState = "acceptingSource";
  const canonicalParserCapacity = Math.floor(parserStateView.byteLength / 24);
  let canonicalParserDepth = 1;
  let canonicalParserCursor = 0;
  let canonicalParserAccepted = false;
  let canonicalParserRejected = false;
  let canonicalParserInjectedTerminal: number | undefined;
  let canonicalParserInjectionMask = 0;
  let canonicalParserWaitingForForHeader = false;
  let forHeaderScanCursor = -1;
  let forHeaderScanIndex = 0;
  let forHeaderScanDepth = 0;
  let forHeaderScanOpening: "[" | "{" | undefined;
  let forHeaderScanClosing: "]" | "}" | undefined;
  let forHeaderScanClosed = false;
  let forHeaderScanResolved: "classic" | "of" | undefined;
  let forHeaderScanSlashGoal: "division" | "regexp" = "regexp";
  let canonicalNestingDepth = 0;
  const pendingSlashScalarBytes = new Uint8Array(4);
  let pendingSlashScalarByteLength = 0;
  let pendingSlashScalarCodePoint = 0;
  let pendingSlashAtEof = false;
  type CanonicalReductionState =
    | Readonly<{
      readonly phase: "popping";
      readonly productionId: number;
      readonly lhs: number;
      readonly semanticOpcode: number;
      readonly remaining: number;
      readonly startToken: number;
      readonly endToken: number;
    }>
    | Readonly<{
      readonly phase: "semantic";
      readonly productionId: number;
      readonly lhs: number;
      readonly semanticOpcode: number;
      readonly startToken: number;
      readonly endToken: number;
    }>
    | Readonly<{
      readonly phase: "goto";
      readonly productionId: number;
      readonly lhs: number;
      readonly semanticOpcode: number;
      readonly startToken: number;
      readonly endToken: number;
    }>;
  let canonicalReduction: CanonicalReductionState | undefined;
  parserStateView.setUint32(0, 1, false);
  parserStateView.setUint32(4, 0, false);
  parserStateView.setUint32(8, 0, false);
  parserStateView.setUint32(12, 0, false);
  parserStateView.setUint32(16, 0, false);
  parserStateView.setUint32(20, 0, false);
  let orderedResult: DeclarativeV2VerifierOwnedModuleArenaV1 |
    undefined;
  let semanticIterator:
    | Generator<
      number,
      DeclarativeV2VerifierOwnedModuleArenaV1,
      void
    >
    | undefined;
  interface PendingIdentifierFinalizationV1 {
    readonly kind: "identifier";
    readonly operation: "step" | "finish";
    readonly end: number;
    readonly rawByteLength: number;
    readonly outputStart: number;
    cursor: number;
    outputLength: number;
    invalid: boolean;
    hadEscape: boolean;
    firstScalar: boolean;
    phase:
      | "read"
      | "escapeU"
      | "escapeFirst"
      | "escapeFixed"
      | "escapeBraced"
      | "writeScalar"
      | "classify"
      | "emit";
    escapeValue: number;
    escapeDigits: number;
    scalarBytes: Uint8Array;
    scalarByteCursor: number;
    scalarCodePoint: number;
    utf8CodePoint: number;
    utf8Minimum: number;
    utf8Remaining: number;
    keywordIndex: number;
    keywordByteIndex: number;
    keywordMatched: boolean;
  }
  interface PendingNumberFinalizationV1 {
    readonly kind: "number";
    readonly operation: "step" | "finish";
    readonly end: number;
    readonly rawByteLength: number;
    readonly outputStart: number;
    cursor: number;
    outputLength: number;
    invalid: boolean;
    phase: "read" | "write" | "emit";
    numericState:
      | "start"
      | "zero"
      | "integer"
      | "fractionStart"
      | "fraction"
      | "exponentStart"
      | "exponentSign"
      | "exponent"
      | "radixPrefix"
      | "radix";
    radix: 2 | 8 | 10 | 16;
    previousUnderscore: boolean;
    sawRadixDigit: boolean;
    bigint: boolean;
    pendingByte: number;
  }
  interface PendingRawTokenFinalizationV1 {
    readonly kind: "raw";
    readonly operation: "step" | "finish";
    readonly end: number;
    readonly rawByteLength: number;
    readonly outputStart: number;
    readonly tokenKind: "string" | "template" | "regexp";
    cursor: number;
    outputLength: number;
    invalid: boolean;
    phase: "read" | "emit";
    utf8CodePoint: number;
    utf8Minimum: number;
    utf8Remaining: number;
    stringEscape:
      | "plain"
      | "escape"
      | "hex"
      | "unicodeFirst"
      | "unicodeFixed"
      | "unicodeBraced";
    escapeDigits: number;
    escapeValue: number;
    previousEscapeZero: boolean;
  }
  type PendingTokenFinalizationV1 =
    | PendingIdentifierFinalizationV1
    | PendingNumberFinalizationV1
    | PendingRawTokenFinalizationV1;
  let pendingTokenFinalization: PendingTokenFinalizationV1 | undefined;
  let deferredScalar:
    | Readonly<{
      readonly codePoint: number;
      readonly bytes: Uint8Array;
    }>
    | undefined;
  let lastExhaustedDimension = "tokens";
  let operationalBudgetFailure:
    | DeclarativeV2VerifierExecutableV1Error
    | undefined;
  let diagnosticCount = 0;
  const DIAGNOSTIC_RECORD_BYTES = 32;

  const addDiagnostic = (
    code: string,
    offset: number,
    message?: string,
    operation: "step" | "finish" = "step",
  ): void => {
    const definition = diagnosticDefinition(code);
    const diagnosticBytes = BigInt(
      utf8ByteLength(definition.code) +
        utf8ByteLength(message ?? definition.rule),
    );
    if (
      usage.diagnosticBytes + diagnosticBytes >
        required.diagnosticBytes
    ) {
      operationalBudgetFailure ??= executableError(
        operation,
        "budgetExceeded",
        {
          dimension: "diagnosticBytes",
          observed: usage.diagnosticBytes + diagnosticBytes,
          maximum: required.diagnosticBytes,
        },
      );
      return;
    }
    const recordOffset = diagnosticCount * DIAGNOSTIC_RECORD_BYTES;
    if (recordOffset + DIAGNOSTIC_RECORD_BYTES > diagnosticView.byteLength) {
      operationalBudgetFailure ??= executableError(
        operation,
        "budgetExceeded",
        {
          dimension: "diagnosticBytes",
          observed: usage.diagnosticBytes + diagnosticBytes,
          maximum: required.diagnosticBytes,
        },
      );
      return;
    }
    usage.diagnosticBytes += diagnosticBytes;
    diagnosticView.setUint32(recordOffset, definition.id, false);
    diagnosticView.setBigUint64(recordOffset + 8, BigInt(offset), false);
    diagnosticView.setUint32(recordOffset + 16, diagnosticCount, false);
    diagnosticCount += 1;
  };

  const tokenRecordOffset = (index: number): number => index * 56;

  const emitToken = (
    kind: DeclarativeV2TokenKindV1,
    raw: ReadonlyArray<number> | Uint8Array,
    start: number,
    end: number,
    tokenByteLength = raw.length,
  ): boolean => {
    if (tokenCount >= maximumTokens) {
      lastExhaustedDimension = "tokens";
      return false;
    }
    if (
      usage.tokenBytes + BigInt(tokenByteLength) > required.tokenBytes ||
      stringCursor + raw.length > stringBytes.byteLength
    ) {
      lastExhaustedDimension = usage.tokenBytes + BigInt(tokenByteLength) >
          required.tokenBytes
        ? "tokenBytes"
        : "stringBytes";
      return false;
    }
    const offset = tokenRecordOffset(tokenCount);
    tokenView.setUint32(offset, tokenKindId(kind), false);
    tokenView.setUint32(offset + 4, start, false);
    tokenView.setUint32(offset + 8, end, false);
    tokenView.setUint32(offset + 12, stringCursor, false);
    tokenView.setUint32(offset + 16, raw.length, false);
    tokenView.setUint32(offset + 20, currentTokenLineBefore ? 1 : 0, false);
    stringBytes.set(raw, stringCursor);
    stringCursor += raw.length;
    tokenCount += 1;
    canonicalParserWaitingForForHeader = false;
    usage.tokens += 1n;
    usage.tokenBytes += BigInt(tokenByteLength);
    usage.stringBytes += BigInt(raw.length);
    currentTokenLineBefore = false;
    return true;
  };

  const emitCurrent = (
    kind: DeclarativeV2TokenKindV1,
    end = sourceOffset,
  ): boolean => {
    if (kind === "string" || kind === "template" || kind === "regexp") {
      return scheduleRawTokenFinalization(kind, end, "step");
    }
    const emitted = emitToken(
      kind,
      lexemeStorage.subarray(0, lexemeLength),
      tokenStart,
      end,
    );
    lexemeLength = 0;
    return emitted;
  };

  const appendLexeme = (
    raw: ReadonlyArray<number> | Uint8Array,
  ): boolean => {
    if (lexemeLength + raw.length > lexemeStorage.byteLength) {
      lastExhaustedDimension = "tokenBytes";
      return false;
    }
    lexemeStorage.set(raw, lexemeLength);
    lexemeLength += raw.length;
    return true;
  };

  const tokenAt = (index: number): TokenView => {
    if (index < 0 || index >= tokenCount) {
      throw new Error("Token index is outside the admitted token arena.");
    }
    const offset = tokenRecordOffset(index);
    return Object.freeze({
      index,
      kind: tokenKindName(tokenView.getUint32(offset, false)),
      start: tokenView.getUint32(offset + 4, false),
      end: tokenView.getUint32(offset + 8, false),
      lineBefore: tokenView.getUint32(offset + 20, false) === 1,
    });
  };

  const tokenTextOffset = (index: number): number =>
    tokenView.getUint32(tokenRecordOffset(index) + 12, false);
  const tokenTextByteLength = (index: number): number =>
    tokenView.getUint32(tokenRecordOffset(index) + 16, false);
  const tokenTextByteAt = (
    index: number,
    byteIndex: number,
  ): number | undefined => {
    const length = tokenTextByteLength(index);
    return byteIndex < 0 || byteIndex >= length
      ? undefined
      : stringBytes[tokenTextOffset(index) + byteIndex];
  };
  const tokenEqualsAscii = (index: number, expected: string): boolean => {
    if (tokenTextByteLength(index) !== expected.length) return false;
    for (let byteIndex = 0; byteIndex < expected.length; byteIndex += 1) {
      if (tokenTextByteAt(index, byteIndex) !== expected.charCodeAt(byteIndex)) {
        return false;
      }
    }
    return true;
  };
  const tokenIs = (token: TokenView, expected: string): boolean =>
    tokenEqualsAscii(token.index, expected);

  const canonicalTokenTerminals = (token: TokenView): ReadonlyArray<number> => {
    let fixedSpelling: string | undefined;
    if (token.kind === "keyword") {
      for (const keyword of DECLARATIVE_V2_KEYWORDS_V1) {
        if (tokenEqualsAscii(token.index, keyword)) {
          fixedSpelling = keyword;
          break;
        }
      }
    } else if (token.kind === "punctuator") {
      for (const punctuator of DECLARATIVE_V2_PUNCTUATORS_V1) {
        if (tokenEqualsAscii(token.index, punctuator)) {
          fixedSpelling = punctuator;
          break;
        }
      }
    }
    const first = tokenTextByteAt(token.index, 0);
    const last = tokenTextByteAt(
      token.index,
      tokenTextByteLength(token.index) - 1,
    );
    const name = fixedSpelling !== undefined
      ? fixedSpelling
      : token.kind === "template"
      ? first === 0x60 && last === 0x60
        ? "templateNoSubstitution"
        : first === 0x60 &&
            tokenTextByteAt(token.index, tokenTextByteLength(token.index) - 2) ===
              0x24 &&
            last === 0x7b
        ? "templateHead"
        : first === 0x7d &&
            tokenTextByteAt(token.index, tokenTextByteLength(token.index) - 2) ===
              0x24 &&
            last === 0x7b
        ? "templateMiddle"
        : first === 0x7d && last === 0x60
        ? "templateTail"
        : undefined
      : token.kind;
    if (name === undefined) return [];
    const candidates: number[] = [];
    const contextualName = tokenEqualsAscii(token.index, "async")
      ? "async"
      : tokenEqualsAscii(token.index, "from")
      ? "from"
      : tokenEqualsAscii(token.index, "of")
      ? "of"
      : undefined;
    if (contextualName !== undefined) {
      const contextual = canonicalTerminalId(contextualName);
      if (contextual !== undefined) candidates.push(contextual);
      const identifier = canonicalTerminalId("identifier");
      if (identifier !== undefined && !candidates.includes(identifier)) {
        candidates.push(identifier);
      }
      return candidates;
    }
    const terminal = canonicalTerminalId(name);
    return terminal === undefined ? [] : [terminal];
  };

  const canonicalStackState = (): number =>
    parserStateView.getUint32((canonicalParserDepth - 1) * 24, false);

  const canonicalPush = (
    state: number,
    symbol: number,
    startToken: number,
    endToken: number,
    semanticOpcode: number,
    productionId: number,
  ): boolean => {
    const nextDepth = canonicalParserDepth + 1;
    if (
      nextDepth > canonicalParserCapacity ||
      BigInt(nextDepth) > required.parserStates
    ) {
      operationalBudgetFailure ??= executableError(
        engineState === "acceptingSource" ? "step" : "finish",
        "budgetExceeded",
        {
          dimension: "parserStates",
          observed: BigInt(nextDepth),
          maximum: required.parserStates,
        },
      );
      return false;
    }
    const offset = canonicalParserDepth * 24;
    parserStateView.setUint32(offset, state, false);
    parserStateView.setUint32(offset + 4, symbol, false);
    parserStateView.setUint32(offset + 8, startToken, false);
    parserStateView.setUint32(offset + 12, endToken, false);
    parserStateView.setUint32(offset + 16, semanticOpcode, false);
    parserStateView.setUint32(offset + 20, productionId, false);
    canonicalParserDepth = nextDepth;
    if (BigInt(nextDepth) > usage.parserStates) {
      usage.parserStates = BigInt(nextDepth);
    }
    return true;
  };

  const updateCanonicalNesting = (
    terminal: number,
    operation: "step" | "finish",
  ): boolean => {
    const templateMiddle = terminal === canonicalTerminalId("templateMiddle");
    const opening = terminal === canonicalTerminalId("{") ||
      terminal === canonicalTerminalId("(") ||
      terminal === canonicalTerminalId("[") ||
      terminal === canonicalTerminalId("templateHead");
    const closing = terminal === canonicalTerminalId("}") ||
      terminal === canonicalTerminalId(")") ||
      terminal === canonicalTerminalId("]") ||
      terminal === canonicalTerminalId("templateTail");
    if (templateMiddle) {
      if (canonicalNestingDepth === 0) {
        throw new Error("Canonical template middle lost its open substitution.");
      }
    } else if (opening) {
      const observed = canonicalNestingDepth + 1;
      if (BigInt(observed) > required.nestingDepth) {
        operationalBudgetFailure ??= executableError(
          operation,
          "budgetExceeded",
          {
            dimension: "nestingDepth",
            observed: BigInt(observed),
            maximum: required.nestingDepth,
          },
        );
        return false;
      }
      canonicalNestingDepth = observed;
      if (BigInt(observed) > usage.nestingDepth) {
        usage.nestingDepth = BigInt(observed);
      }
    } else if (closing && canonicalNestingDepth > 0) {
      canonicalNestingDepth -= 1;
    }
    return true;
  };

  const recordCanonicalSemanticOpcode = (
    semanticOpcode: number,
    productionId: number,
    startToken: number,
    endToken: number,
  ): void => {
    if (semanticOpcode < 1 || semanticOpcode > 12) {
      throw new Error("Canonical parser referenced an unknown semantic opcode.");
    }
    if (startToken < 0 || startToken >= tokenCount) return;
    const offset = tokenRecordOffset(startToken);
    if (
      semanticOpcode === 4 ||
      semanticOpcode === 5 ||
      semanticOpcode === 9 ||
      semanticOpcode === 10 ||
      semanticOpcode === 11
    ) {
      tokenView.setUint32(offset + 24, semanticOpcode, false);
      tokenView.setUint32(offset + 28, productionId, false);
      tokenView.setUint32(offset + 32, endToken, false);
    }
  };

  const rejectCanonicalSyntax = (
    token: TokenView,
    operation: "step" | "finish",
  ): void => {
    if (canonicalParserRejected) return;
    const recovery = executableAsset.canonicalRecovery();
    if (recovery.diagnostic !== 4 || recovery.consumes !== 0) {
      throw new Error("Canonical recovery policy lost fail-closed semantics.");
    }
    canonicalParserRejected = true;
    if (token.kind !== "regexp") {
      addDiagnostic("CORE_SYNTAX", token.start, undefined, operation);
    }
  };

  const expressionStartTerminals = [
    canonicalTerminalId("identifier"),
    canonicalTerminalId("number"),
    canonicalTerminalId("bigint"),
    canonicalTerminalId("string"),
    canonicalTerminalId("templateNoSubstitution"),
    canonicalTerminalId("templateHead"),
    canonicalTerminalId("true"),
    canonicalTerminalId("false"),
    canonicalTerminalId("null"),
    canonicalTerminalId("undefined"),
    canonicalTerminalId("("),
    canonicalTerminalId("["),
    canonicalTerminalId("{"),
    canonicalTerminalId("await"),
    canonicalTerminalId("typeof"),
    canonicalTerminalId("void"),
    canonicalTerminalId("delete"),
    canonicalTerminalId("!"),
    canonicalTerminalId("~"),
    canonicalTerminalId("+"),
    canonicalTerminalId("-"),
    canonicalTerminalId("++"),
    canonicalTerminalId("--"),
  ].filter((terminal): terminal is number => terminal !== undefined);

  const chooseCanonicalInjection = (
    token: TokenView,
    terminals: ReadonlyArray<number>,
  ): number | undefined => {
    const state = canonicalStackState();
    const semicolon = canonicalTerminalId(";");
    const expressionStart = canonicalTerminalId("expressionStatementStart");
    const previous = canonicalParserCursor === 0
      ? undefined
      : tokenAt(canonicalParserCursor - 1);
    if (
      (canonicalParserInjectionMask & 2) === 0 &&
      expressionStart !== undefined &&
      terminals.some((terminal) => expressionStartTerminals.includes(terminal)) &&
      previous !== undefined &&
      ["{", "}", ";", ")", "else", "do", ":"].some((candidate) =>
        tokenIs(previous, candidate)
      ) &&
      executableAsset.canonicalAction(state, expressionStart) !==
        undefined
    ) {
      canonicalParserInjectionMask |= 2;
      return expressionStart;
    }
    if (
      (canonicalParserInjectionMask & 1) === 0 &&
      semicolon !== undefined &&
      (token.lineBefore || tokenIs(token, "}") || token.kind === "eof") &&
      !tokenIs(token, "else") &&
      !tokenIs(token, "catch") &&
      !tokenIs(token, "finally") &&
      !tokenIs(token, "while") &&
      executableAsset.canonicalAction(state, semicolon) !== undefined
    ) {
      canonicalParserInjectionMask |= 1;
      return semicolon;
    }
    return undefined;
  };

  const resetForHeaderScan = (): void => {
    forHeaderScanCursor = -1;
    forHeaderScanIndex = 0;
    forHeaderScanDepth = 0;
    forHeaderScanOpening = undefined;
    forHeaderScanClosing = undefined;
    forHeaderScanClosed = false;
    forHeaderScanResolved = undefined;
    forHeaderScanSlashGoal = "regexp";
  };

  const forHeaderSlashGoalAfter = (
    token: TokenView,
  ): "division" | "regexp" => {
    if (
      token.kind === "template" &&
      tokenTextByteAt(token.index, tokenTextByteLength(token.index) - 2) ===
        0x24 &&
      tokenTextByteAt(token.index, tokenTextByteLength(token.index) - 1) ===
        0x7b
    ) {
      return "regexp";
    }
    const expressionEndingKeyword =
      token.kind === "keyword" &&
      ["async", "false", "null", "of", "static", "super", "this", "true",
        "undefined"].some((candidate) => tokenIs(token, candidate));
    const lookupToken = token.kind === "punctuator"
      ? DECLARATIVE_V2_PUNCTUATORS_V1.find((candidate) =>
        tokenIs(token, candidate)
      )
      : expressionEndingKeyword
      ? "identifier"
      : token.kind;
    if (lookupToken === undefined) return "regexp";
    return executableAsset.lookupHashedString(
        "regexGoals",
        `${lookupToken}:division`,
      ) === undefined
      ? "regexp"
      : "division";
  };

  const forHeaderBranch = ():
    | "advanced"
    | "classic"
    | "of"
    | "pending" => {
    const first = tokenAt(canonicalParserCursor);
    if (!tokenIs(first, "[") && !tokenIs(first, "{")) {
      resetForHeaderScan();
      if (canonicalParserCursor + 1 >= tokenCount) return "pending";
      return tokenIs(tokenAt(canonicalParserCursor + 1), "of")
        ? "of"
        : "classic";
    }
    if (forHeaderScanCursor !== canonicalParserCursor) {
      resetForHeaderScan();
      forHeaderScanCursor = canonicalParserCursor;
      forHeaderScanIndex = canonicalParserCursor;
      forHeaderScanOpening = tokenIs(first, "[") ? "[" : "{";
      forHeaderScanClosing = tokenIs(first, "[") ? "]" : "}";
    }
    if (forHeaderScanResolved !== undefined) {
      return forHeaderScanResolved;
    }
    if (forHeaderScanIndex >= tokenCount) return "pending";
    const token = tokenAt(forHeaderScanIndex);
    forHeaderScanIndex += 1;
    if (forHeaderScanClosed) {
      forHeaderScanResolved = tokenIs(token, "of") ? "of" : "classic";
      return "advanced";
    }
    if (token.kind === "eof") {
      forHeaderScanResolved = "classic";
      return "advanced";
    }
    forHeaderScanSlashGoal = forHeaderSlashGoalAfter(token);
    if (
      forHeaderScanOpening !== undefined &&
      tokenIs(token, forHeaderScanOpening)
    ) {
      forHeaderScanDepth += 1;
    } else if (
      forHeaderScanClosing !== undefined &&
      tokenIs(token, forHeaderScanClosing)
    ) {
      forHeaderScanDepth -= 1;
      if (forHeaderScanDepth === 0) {
        forHeaderScanClosed = true;
      }
    }
    return "advanced";
  };

  const scheduleCanonicalReduction = (
    productionId: number,
  ): boolean => {
    const production = executableAsset.canonicalProduction(
      productionId,
    );
    if (
      production === undefined ||
      production.rhsLength >= canonicalParserDepth
    ) {
      throw new Error("Canonical action referenced an invalid production.");
    }
    const firstPopped = production.rhsLength === 0
      ? canonicalParserCursor
      : parserStateView.getUint32(
        (canonicalParserDepth - production.rhsLength) * 24 + 8,
        false,
      );
    const lastPopped = production.rhsLength === 0
      ? canonicalParserCursor
      : parserStateView.getUint32(
        (canonicalParserDepth - 1) * 24 + 12,
        false,
      );
    canonicalReduction = Object.freeze({
      phase: "popping",
      productionId,
      lhs: production.lhs,
      semanticOpcode: production.semanticOpcode,
      remaining: production.rhsLength,
      startToken: firstPopped,
      endToken: lastPopped,
    });
    return true;
  };

  const advanceCanonicalParser = (
    operation: "step" | "finish",
  ): "advanced" | "idle" | "rejected" => {
    if (canonicalParserAccepted || canonicalParserRejected) {
      return canonicalParserRejected ? "rejected" : "idle";
    }
    if (canonicalReduction !== undefined) {
      if (canonicalReduction.phase === "popping") {
        if (canonicalReduction.remaining > 0) {
          if (canonicalParserDepth <= 1) {
            throw new Error("Canonical reduction underflowed its fixed stack.");
          }
          canonicalParserDepth -= 1;
          canonicalReduction = Object.freeze({
            ...canonicalReduction,
            remaining: canonicalReduction.remaining - 1,
          });
          return "advanced";
        }
        canonicalReduction = Object.freeze({
          ...canonicalReduction,
          phase: "semantic",
        });
        return "advanced";
      }
      if (canonicalReduction.phase === "semantic") {
        recordCanonicalSemanticOpcode(
          canonicalReduction.semanticOpcode,
          canonicalReduction.productionId,
          canonicalReduction.startToken,
          canonicalReduction.endToken,
        );
        canonicalReduction = Object.freeze({
          ...canonicalReduction,
          phase: "goto",
        });
        return "advanced";
      }
      const nextState = executableAsset.canonicalGoto(
        canonicalStackState(),
        canonicalReduction.lhs,
      );
      if (nextState === undefined) {
        throw new Error("Canonical reduction lost its generated goto.");
      }
      if (
        !canonicalPush(
          nextState,
          0x8000_0000 | canonicalReduction.lhs,
          canonicalReduction.startToken,
          canonicalReduction.endToken,
          canonicalReduction.semanticOpcode,
          canonicalReduction.productionId,
        )
      ) {
        return "rejected";
      }
      canonicalReduction = undefined;
      return "advanced";
    }
    if (canonicalParserCursor >= tokenCount) return "idle";
    const token = tokenAt(canonicalParserCursor);
    const actualTerminals = canonicalTokenTerminals(token);
    if (actualTerminals.length === 0) {
      rejectCanonicalSyntax(token, operation);
      return "rejected";
    }
    const previousToken = canonicalParserCursor === 0
      ? undefined
      : tokenAt(canonicalParserCursor - 1);
    if (
      token.lineBefore &&
      (previousToken !== undefined && tokenIs(previousToken, "throw") ||
        previousToken !== undefined &&
          tokenIs(previousToken, "async") &&
          tokenIs(token, "function"))
    ) {
      rejectCanonicalSyntax(token, operation);
      return "rejected";
    }
    const bareForBindingStart =
      canonicalParserInjectedTerminal === undefined &&
      actualTerminals.some((terminal) =>
        terminal === canonicalTerminalId("identifier") ||
        terminal === canonicalTerminalId("[") ||
        terminal === canonicalTerminalId("{")
      ) &&
      previousToken !== undefined &&
      tokenIs(previousToken, "(") &&
      canonicalParserCursor >= 2 &&
      tokenIs(tokenAt(canonicalParserCursor - 2), "for");
    if (bareForBindingStart) {
      const branch = forHeaderBranch();
      if (branch === "advanced") {
        return "advanced";
      }
      if (branch === "pending") {
        canonicalParserWaitingForForHeader = true;
        return "idle";
      }
      const forBindingStart = canonicalTerminalId("forBindingStart");
      if (
        branch === "of" &&
        forBindingStart !== undefined &&
        executableAsset.canonicalAction(
            canonicalStackState(),
            forBindingStart,
          ) !== undefined
      ) {
        canonicalParserInjectedTerminal = forBindingStart;
        canonicalParserInjectionMask |= 4;
      }
    }
    let lookahead = canonicalParserInjectedTerminal;
    let action = lookahead === undefined
      ? undefined
      : executableAsset.canonicalAction(canonicalStackState(), lookahead);
    if (lookahead === undefined) {
      for (const candidate of actualTerminals) {
        const candidateAction = executableAsset.canonicalAction(
          canonicalStackState(),
          candidate,
        );
        if (candidateAction === undefined) continue;
        lookahead = candidate;
        action = candidateAction;
        break;
      }
    }
    if (action === undefined && canonicalParserInjectedTerminal === undefined) {
      const injected = chooseCanonicalInjection(token, actualTerminals);
      if (injected !== undefined) {
        canonicalParserInjectedTerminal = injected;
        lookahead = injected;
        action = executableAsset.canonicalAction(
          canonicalStackState(),
          lookahead,
        );
      }
    }
    if (action === undefined || lookahead === undefined) {
      rejectCanonicalSyntax(token, operation);
      return "rejected";
    }
    if (action.action === 1) {
      const synthetic = canonicalParserInjectedTerminal !== undefined;
      if (
        !canonicalPush(
          action.value,
          lookahead,
          canonicalParserCursor,
          canonicalParserCursor,
          0,
          0,
        ) ||
        !updateCanonicalNesting(lookahead, operation)
      ) {
        return "rejected";
      }
      if (synthetic) {
        canonicalParserInjectedTerminal = undefined;
      } else {
        canonicalParserCursor += 1;
        canonicalParserInjectionMask = 0;
        resetForHeaderScan();
      }
      return "advanced";
    }
    if (action.action === 2) {
      scheduleCanonicalReduction(action.value);
      return "advanced";
    }
    if (
      action.action === 3 &&
      token.kind === "eof" &&
      canonicalParserInjectedTerminal === undefined
    ) {
      canonicalParserAccepted = true;
      return "advanced";
    }
    throw new Error("Canonical action table contains an invalid action.");
  };

  const drainCanonicalParser = (
    operation: "step" | "finish",
    maximumTransitions: number,
  ): number => {
    let transitions = 0;
    while (transitions < maximumTransitions) {
      const advanced = advanceCanonicalParser(operation);
      if (advanced !== "advanced") break;
      transitions += 1;
    }
    return transitions;
  };

  const canonicalParserIsCaughtUp = (): boolean =>
    canonicalParserRejected ||
    canonicalParserAccepted ||
    canonicalParserWaitingForForHeader ||
    canonicalReduction === undefined &&
      canonicalParserInjectedTerminal === undefined &&
      canonicalParserCursor >= tokenCount;

  const advanceSlashLexicalGoal = (
    operation: "step" | "finish",
  ): "advanced" | "division" | "regexp" => {
    if (canonicalParserWaitingForForHeader) {
      if (
        forHeaderScanCursor === canonicalParserCursor &&
        forHeaderScanOpening !== undefined &&
        !forHeaderScanClosed
      ) {
        return forHeaderScanSlashGoal;
      }
      return "division";
    }
    if (canonicalReduction !== undefined) {
      const advanced = advanceCanonicalParser(operation);
      if (advanced !== "advanced") {
        throw new Error("Slash lexical-goal reduction did not advance.");
      }
      return "advanced";
    }
    const divisionSpelling =
      pendingSlashScalarByteLength > 0 &&
        pendingSlashScalarCodePoint === 0x3d
        ? "/="
        : "/";
    const division = canonicalTerminalId(divisionSpelling);
    if (division === undefined) {
      throw new Error("Canonical grammar lost the division terminal.");
    }
    const divisionAction = executableAsset.canonicalAction(
      canonicalStackState(),
      division,
    );
    if (divisionAction?.action === 2) {
      scheduleCanonicalReduction(divisionAction.value);
      return "advanced";
    }
    if (divisionAction?.action === 1) {
      return "division";
    }
    if (divisionAction === undefined) return "regexp";
    throw new Error("Canonical grammar produced an invalid slash action.");
  };

  const inUnicodeRanges = (
    ranges: Uint8Array,
    codePoint: number,
  ): boolean => {
    let low = 0;
    let high = ranges.byteLength / 8 - 1;
    const view = new DataView(
      ranges.buffer,
      ranges.byteOffset,
      ranges.byteLength,
    );
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2);
      const start = view.getUint32(middle * 8, false);
      const end = view.getUint32(middle * 8 + 4, false);
      if (codePoint < start) high = middle - 1;
      else if (codePoint > end) low = middle + 1;
      else return true;
    }
    return false;
  };
  const isIdentifierStart = (codePoint: number): boolean =>
    codePoint === 0x24 ||
    codePoint === 0x5f ||
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a) ||
    (codePoint >= 0x80 && inUnicodeRanges(unicodeIdStart, codePoint));
  const isIdentifierContinue = (codePoint: number): boolean =>
    isIdentifierStart(codePoint) ||
    (codePoint >= 0x30 && codePoint <= 0x39) ||
    (codePoint >= 0x80 && inUnicodeRanges(unicodeIdContinue, codePoint));
  const isEcmaWhitespace = (codePoint: number): boolean =>
    codePoint === 0x09 ||
    codePoint === 0x0b ||
    codePoint === 0x0c ||
    codePoint === 0x20 ||
    codePoint === 0x00a0 ||
    codePoint === 0x1680 ||
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    codePoint === 0x202f ||
    codePoint === 0x205f ||
    codePoint === 0x3000 ||
    (codePoint === 0xfeff && sourceOffset > 3);
  const isEcmaLineTerminator = (codePoint: number): boolean =>
    codePoint === 0x0a ||
    codePoint === 0x0d ||
    codePoint === 0x2028 ||
    codePoint === 0x2029;

  const beginToken = (bytes: ReadonlyArray<number> | Uint8Array): void => {
    tokenStart = sourceOffset - bytes.length;
    currentTokenLineBefore = lineBeforeNextToken;
    lineBeforeNextToken = false;
    lexemeLength = 0;
    if (!appendLexeme(bytes)) {
      throw executableError("step", "budgetExceeded", {
        dimension: "tokenBytes",
      });
    }
  };

  const hexValue = (byte: number): number | undefined =>
    byte >= 0x30 && byte <= 0x39
      ? byte - 0x30
      : byte >= 0x41 && byte <= 0x46
      ? byte - 0x41 + 10
      : byte >= 0x61 && byte <= 0x66
      ? byte - 0x61 + 10
      : undefined;

  const scalarBytes = (
    codePoint: number,
    output: Uint8Array,
  ): number => {
    if (codePoint <= 0x7f) {
      output[0] = codePoint;
      return 1;
    }
    if (codePoint <= 0x7ff) {
      output[0] = 0xc0 | (codePoint >>> 6);
      output[1] = 0x80 | (codePoint & 0x3f);
      return 2;
    }
    if (codePoint <= 0xffff) {
      output[0] = 0xe0 | (codePoint >>> 12);
      output[1] = 0x80 | ((codePoint >>> 6) & 0x3f);
      output[2] = 0x80 | (codePoint & 0x3f);
      return 3;
    }
    output[0] = 0xf0 | (codePoint >>> 18);
    output[1] = 0x80 | ((codePoint >>> 12) & 0x3f);
    output[2] = 0x80 | ((codePoint >>> 6) & 0x3f);
    output[3] = 0x80 | (codePoint & 0x3f);
    return 4;
  };

  const prepareIdentifierScalar = (
    state: PendingIdentifierFinalizationV1,
    codePoint: number,
  ): void => {
    if (
      (state.firstScalar
        ? !isIdentifierStart(codePoint)
        : !isIdentifierContinue(codePoint)) ||
      codePoint > 0x10ffff ||
      codePoint >= 0xd800 && codePoint <= 0xdfff
    ) {
      state.invalid = true;
    }
    state.firstScalar = false;
    state.scalarCodePoint = codePoint;
    state.scalarByteCursor = 0;
    const byteLength = scalarBytes(codePoint, state.scalarBytes);
    state.scalarBytes = state.scalarBytes.subarray(0, byteLength);
    state.phase = "writeScalar";
  };

  const scheduleTokenFinalization = (
    kind: "identifier" | "number",
    end: number,
    operation: "step" | "finish",
  ): boolean => {
    if (pendingTokenFinalization !== undefined || tokenCount >= maximumTokens) {
      lastExhaustedDimension = "tokens";
      return false;
    }
    if (usage.tokenBytes + BigInt(lexemeLength) > required.tokenBytes) {
      lastExhaustedDimension = "tokenBytes";
      return false;
    }
    if (stringCursor >= stringBytes.byteLength && lexemeLength > 0) {
      lastExhaustedDimension = "stringBytes";
      return false;
    }
    if (kind === "identifier") {
      pendingTokenFinalization = {
        kind,
        operation,
        end,
        rawByteLength: lexemeLength,
        outputStart: stringCursor,
        cursor: 0,
        outputLength: 0,
        invalid: lexemeLength === 0,
        hadEscape: false,
        firstScalar: true,
        phase: "read",
        escapeValue: 0,
        escapeDigits: 0,
        scalarBytes: new Uint8Array(4),
        scalarByteCursor: 0,
        scalarCodePoint: 0,
        utf8CodePoint: 0,
        utf8Minimum: 0,
        utf8Remaining: 0,
        keywordIndex: 0,
        keywordByteIndex: 0,
        keywordMatched: false,
      };
    } else {
      pendingTokenFinalization = {
        kind,
        operation,
        end,
        rawByteLength: lexemeLength,
        outputStart: stringCursor,
        cursor: 0,
        outputLength: 0,
        invalid: lexemeLength === 0,
        phase: "read",
        numericState: "start",
        radix: 10,
        previousUnderscore: false,
        sawRadixDigit: false,
        bigint: false,
        pendingByte: 0,
      };
    }
    mode = "code";
    return true;
  };

  const scheduleRawTokenFinalization = (
    tokenKind: PendingRawTokenFinalizationV1["tokenKind"],
    end: number,
    operation: "step" | "finish",
  ): boolean => {
    if (pendingTokenFinalization !== undefined || tokenCount >= maximumTokens) {
      lastExhaustedDimension = "tokens";
      return false;
    }
    if (
      usage.tokenBytes + BigInt(lexemeLength) > required.tokenBytes ||
      usage.stringBytes + BigInt(lexemeLength) > required.stringBytes ||
      stringCursor + lexemeLength > stringBytes.byteLength
    ) {
      lastExhaustedDimension =
        usage.tokenBytes + BigInt(lexemeLength) > required.tokenBytes
          ? "tokenBytes"
          : "stringBytes";
      return false;
    }
    pendingTokenFinalization = {
      kind: "raw",
      operation,
      end,
      rawByteLength: lexemeLength,
      outputStart: stringCursor,
      tokenKind,
      cursor: 0,
      outputLength: 0,
      invalid: lexemeLength === 0,
      phase: "read",
      utf8CodePoint: 0,
      utf8Minimum: 0,
      utf8Remaining: 0,
      stringEscape: "plain",
      escapeDigits: 0,
      escapeValue: 0,
      previousEscapeZero: false,
    };
    return true;
  };

  const writeFinalizedByte = (
    state: PendingTokenFinalizationV1,
    byte: number,
  ): boolean => {
    if (
      usage.stringBytes + 1n > required.stringBytes ||
      state.outputStart + state.outputLength >= stringBytes.byteLength
    ) {
      lastExhaustedDimension = "stringBytes";
      return false;
    }
    stringBytes[state.outputStart + state.outputLength] = byte;
    state.outputLength += 1;
    usage.stringBytes += 1n;
    return true;
  };

  const emitFinalizedToken = (
    state: PendingTokenFinalizationV1,
    kind: DeclarativeV2TokenKindV1,
  ): boolean => {
    if (state.invalid) {
      addDiagnostic(
        "CORE_UNSUPPORTED_TOKEN",
        tokenStart,
        undefined,
        state.operation,
      );
    }
    const offset = tokenRecordOffset(tokenCount);
    tokenView.setUint32(offset, tokenKindId(kind), false);
    tokenView.setUint32(offset + 4, tokenStart, false);
    tokenView.setUint32(offset + 8, state.end, false);
    tokenView.setUint32(offset + 12, state.outputStart, false);
    tokenView.setUint32(offset + 16, state.outputLength, false);
    tokenView.setUint32(offset + 20, currentTokenLineBefore ? 1 : 0, false);
    stringCursor += state.outputLength;
    tokenCount += 1;
    usage.tokens += 1n;
    usage.tokenBytes += BigInt(state.rawByteLength);
    currentTokenLineBefore = false;
    canonicalParserWaitingForForHeader = false;
    lexemeLength = 0;
    pendingTokenFinalization = undefined;
    return true;
  };

  const advanceIdentifierFinalization = (
    state: PendingIdentifierFinalizationV1,
  ): boolean => {
    if (state.phase === "writeScalar") {
      const byte = state.scalarBytes[state.scalarByteCursor];
      if (byte === undefined || !writeFinalizedByte(state, byte)) return false;
      state.scalarByteCursor += 1;
      if (state.scalarByteCursor >= state.scalarBytes.byteLength) {
        state.scalarBytes = new Uint8Array(4);
        state.phase = "read";
      }
      return true;
    }
    if (state.phase === "classify") {
      const keyword = DECLARATIVE_V2_KEYWORDS_V1[state.keywordIndex];
      if (keyword === undefined) {
        state.phase = "emit";
        return true;
      }
      if (keyword.length !== state.outputLength) {
        state.keywordIndex += 1;
        state.keywordByteIndex = 0;
        return true;
      }
      if (
        stringBytes[state.outputStart + state.keywordByteIndex] !==
          keyword.charCodeAt(state.keywordByteIndex)
      ) {
        state.keywordIndex += 1;
        state.keywordByteIndex = 0;
        return true;
      }
      state.keywordByteIndex += 1;
      if (state.keywordByteIndex === keyword.length) {
        state.keywordMatched = true;
        state.phase = "emit";
      }
      return true;
    }
    if (state.phase === "emit") {
      if (state.keywordMatched && state.hadEscape) state.invalid = true;
      return emitFinalizedToken(
        state,
        state.keywordMatched ? "keyword" : "identifier",
      );
    }
    if (state.cursor >= state.rawByteLength) {
      if (
        state.phase !== "read" ||
        state.firstScalar ||
        state.escapeDigits !== 0 ||
        state.utf8Remaining !== 0
      ) {
        state.invalid = true;
      }
      state.phase = "classify";
      return true;
    }
    const byte = lexemeStorage[state.cursor]!;
    state.cursor += 1;
    if (state.phase === "read") {
      if (state.utf8Remaining > 0) {
        if (byte < 0x80 || byte > 0xbf) {
          state.invalid = true;
          state.utf8Remaining = 0;
          prepareIdentifierScalar(state, state.utf8CodePoint);
          return true;
        }
        state.utf8CodePoint =
          (state.utf8CodePoint << 6) | (byte & 0x3f);
        state.utf8Remaining -= 1;
        if (state.utf8Remaining === 0) {
          if (
            state.utf8CodePoint < state.utf8Minimum ||
            state.utf8CodePoint > 0x10ffff ||
            state.utf8CodePoint >= 0xd800 &&
              state.utf8CodePoint <= 0xdfff
          ) {
            state.invalid = true;
          }
          prepareIdentifierScalar(state, state.utf8CodePoint);
        }
        return true;
      }
      if (byte === 0x5c) {
        state.hadEscape = true;
        state.phase = "escapeU";
        return true;
      }
      if (byte >= 0xc2 && byte <= 0xdf) {
        state.utf8CodePoint = byte & 0x1f;
        state.utf8Minimum = 0x80;
        state.utf8Remaining = 1;
        return true;
      } else if (byte >= 0xe0 && byte <= 0xef) {
        state.utf8CodePoint = byte & 0x0f;
        state.utf8Minimum = 0x800;
        state.utf8Remaining = 2;
        return true;
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        state.utf8CodePoint = byte & 0x07;
        state.utf8Minimum = 0x1_0000;
        state.utf8Remaining = 3;
        return true;
      } else if (byte > 0x7f) {
        state.invalid = true;
      }
      prepareIdentifierScalar(state, byte);
      return true;
    }
    if (state.phase === "escapeU") {
      if (byte !== 0x75) state.invalid = true;
      state.phase = "escapeFirst";
      return true;
    }
    if (state.phase === "escapeFirst") {
      if (byte === 0x7b) {
        state.escapeValue = 0;
        state.escapeDigits = 0;
        state.phase = "escapeBraced";
        return true;
      }
      const digit = hexValue(byte);
      if (digit === undefined) {
        state.invalid = true;
        state.phase = "read";
        return true;
      }
      state.escapeValue = digit;
      state.escapeDigits = 1;
      state.phase = "escapeFixed";
      return true;
    }
    if (state.phase === "escapeFixed") {
      const digit = hexValue(byte);
      if (digit === undefined) {
        state.invalid = true;
        state.phase = "read";
        return true;
      }
      state.escapeValue = state.escapeValue * 16 + digit;
      state.escapeDigits += 1;
      if (state.escapeDigits === 4) {
        prepareIdentifierScalar(state, state.escapeValue);
        state.escapeDigits = 0;
      }
      return true;
    }
    if (byte === 0x7d) {
      if (state.escapeDigits < 1 || state.escapeDigits > 6) {
        state.invalid = true;
        state.phase = "read";
      } else {
        prepareIdentifierScalar(state, state.escapeValue);
        state.escapeDigits = 0;
      }
      return true;
    }
    const digit = hexValue(byte);
    if (digit === undefined || state.escapeDigits >= 6) {
      state.invalid = true;
      state.phase = "read";
      return true;
    }
    state.escapeValue = state.escapeValue * 16 + digit;
    state.escapeDigits += 1;
    return true;
  };

  const digitForRadix = (byte: number, radix: 2 | 8 | 10 | 16): boolean => {
    const value = hexValue(byte);
    return value !== undefined && value < radix;
  };

  const advanceNumberValidation = (
    state: PendingNumberFinalizationV1,
    byte: number,
  ): void => {
    if (byte === 0x6e && state.cursor === state.rawByteLength) {
      state.bigint = true;
      if (
        state.previousUnderscore ||
        state.numericState === "fraction" ||
        state.numericState === "fractionStart" ||
        state.numericState === "exponent" ||
        state.numericState === "exponentStart" ||
        state.numericState === "exponentSign" ||
        state.numericState === "radixPrefix"
      ) state.invalid = true;
      return;
    }
    if (byte === 0x5f) {
      if (
        state.previousUnderscore ||
        !(
          state.numericState === "integer" ||
          state.numericState === "fraction" ||
          state.numericState === "exponent" ||
          state.numericState === "radix" && state.sawRadixDigit
        )
      ) state.invalid = true;
      state.previousUnderscore = true;
      return;
    }
    if (state.previousUnderscore && !digitForRadix(byte, state.radix)) {
      state.invalid = true;
    }
    state.previousUnderscore = false;
    switch (state.numericState) {
      case "start":
        if (byte === 0x2e) state.numericState = "fractionStart";
        else if (byte === 0x30) state.numericState = "zero";
        else if (byte >= 0x31 && byte <= 0x39) {
          state.numericState = "integer";
        } else state.invalid = true;
        return;
      case "zero":
        if (byte === 0x78 || byte === 0x58) {
          state.radix = 16;
          state.numericState = "radixPrefix";
        } else if (byte === 0x6f || byte === 0x4f) {
          state.radix = 8;
          state.numericState = "radixPrefix";
        } else if (byte === 0x62 || byte === 0x42) {
          state.radix = 2;
          state.numericState = "radixPrefix";
        } else if (byte === 0x2e) state.numericState = "fraction";
        else if (byte === 0x65 || byte === 0x45) {
          state.numericState = "exponentStart";
        } else if (byte >= 0x30 && byte <= 0x39) {
          state.invalid = true;
          state.numericState = "integer";
        } else state.invalid = true;
        return;
      case "integer":
        if (byte >= 0x30 && byte <= 0x39) return;
        if (byte === 0x2e) state.numericState = "fraction";
        else if (byte === 0x65 || byte === 0x45) {
          state.numericState = "exponentStart";
        } else state.invalid = true;
        return;
      case "fractionStart":
        if (byte >= 0x30 && byte <= 0x39) state.numericState = "fraction";
        else state.invalid = true;
        return;
      case "fraction":
        if (byte >= 0x30 && byte <= 0x39) return;
        if (byte === 0x65 || byte === 0x45) {
          state.numericState = "exponentStart";
        } else state.invalid = true;
        return;
      case "exponentStart":
        if (byte === 0x2b || byte === 0x2d) {
          state.numericState = "exponentSign";
        } else if (byte >= 0x30 && byte <= 0x39) {
          state.numericState = "exponent";
        } else state.invalid = true;
        return;
      case "exponentSign":
        if (byte >= 0x30 && byte <= 0x39) {
          state.numericState = "exponent";
        } else state.invalid = true;
        return;
      case "exponent":
        if (!(byte >= 0x30 && byte <= 0x39)) state.invalid = true;
        return;
      case "radixPrefix":
      case "radix":
        if (digitForRadix(byte, state.radix)) {
          state.sawRadixDigit = true;
          state.numericState = "radix";
        } else state.invalid = true;
        return;
    }
  };

  const advanceNumberFinalization = (
    state: PendingNumberFinalizationV1,
  ): boolean => {
    if (state.phase === "write") {
      if (!writeFinalizedByte(state, state.pendingByte)) return false;
      state.phase = "read";
      return true;
    }
    if (state.phase === "emit") {
      if (
        state.previousUnderscore ||
        state.numericState === "start" ||
        state.numericState === "fractionStart" ||
        state.numericState === "exponentStart" ||
        state.numericState === "exponentSign" ||
        state.numericState === "radixPrefix" ||
        state.numericState === "radix" && !state.sawRadixDigit
      ) state.invalid = true;
      return emitFinalizedToken(
        state,
        state.bigint ? "bigint" : "number",
      );
    }
    if (state.cursor >= state.rawByteLength) {
      state.phase = "emit";
      return true;
    }
    const byte = lexemeStorage[state.cursor]!;
    state.cursor += 1;
    advanceNumberValidation(state, byte);
    state.pendingByte = byte;
    state.phase = "write";
    return true;
  };

  const validateStringTokenByte = (
    state: PendingRawTokenFinalizationV1,
    byte: number,
  ): void => {
    if (state.previousEscapeZero) {
      if (byte >= 0x30 && byte <= 0x39) state.invalid = true;
      state.previousEscapeZero = false;
    }
    if (state.stringEscape === "plain") {
      if (byte === 0x5c) state.stringEscape = "escape";
      return;
    }
    if (state.stringEscape === "escape") {
      if (byte >= 0x31 && byte <= 0x39) state.invalid = true;
      if (byte === 0x30) state.previousEscapeZero = true;
      if (byte === 0x78) {
        state.stringEscape = "hex";
        state.escapeDigits = 0;
        return;
      }
      if (byte === 0x75) {
        state.stringEscape = "unicodeFirst";
        state.escapeDigits = 0;
        state.escapeValue = 0;
        return;
      }
      state.stringEscape = "plain";
      return;
    }
    if (state.stringEscape === "unicodeFirst") {
      if (byte === 0x7b) {
        state.stringEscape = "unicodeBraced";
        return;
      }
      const digit = hexValue(byte);
      if (digit === undefined) {
        state.invalid = true;
        state.stringEscape = "plain";
        return;
      }
      state.escapeDigits = 1;
      state.escapeValue = digit;
      state.stringEscape = "unicodeFixed";
      return;
    }
    if (state.stringEscape === "unicodeBraced") {
      if (byte === 0x7d) {
        if (
          state.escapeDigits < 1 ||
          state.escapeDigits > 6 ||
          state.escapeValue > 0x10ffff
        ) state.invalid = true;
        state.stringEscape = "plain";
        return;
      }
      const digit = hexValue(byte);
      if (digit === undefined || state.escapeDigits >= 6) {
        state.invalid = true;
        state.stringEscape = "plain";
        return;
      }
      state.escapeValue = state.escapeValue * 16 + digit;
      state.escapeDigits += 1;
      return;
    }
    const digit = hexValue(byte);
    if (digit === undefined) {
      state.invalid = true;
      state.stringEscape = "plain";
      return;
    }
    state.escapeValue = state.escapeValue * 16 + digit;
    state.escapeDigits += 1;
    if (
      state.stringEscape === "hex" && state.escapeDigits === 2 ||
      state.stringEscape === "unicodeFixed" && state.escapeDigits === 4
    ) {
      state.stringEscape = "plain";
    }
  };

  const advanceRawTokenFinalization = (
    state: PendingRawTokenFinalizationV1,
  ): boolean => {
    if (state.phase === "emit") {
      if (
        state.utf8Remaining !== 0 ||
        state.tokenKind === "string" &&
          state.stringEscape !== "plain"
      ) state.invalid = true;
      return emitFinalizedToken(state, state.tokenKind);
    }
    if (state.cursor >= state.rawByteLength) {
      state.phase = "emit";
      return true;
    }
    const index = state.cursor;
    const byte = lexemeStorage[index]!;
    state.cursor += 1;
    if (!writeFinalizedByte(state, byte)) return false;
    if (
      state.tokenKind === "string" &&
      index > 0 &&
      index + 1 < state.rawByteLength
    ) {
      validateStringTokenByte(state, byte);
    }
    if (state.utf8Remaining > 0) {
      if (byte < 0x80 || byte > 0xbf) {
        state.invalid = true;
        state.utf8Remaining = 0;
        return true;
      }
      state.utf8CodePoint =
        (state.utf8CodePoint << 6) | (byte & 0x3f);
      state.utf8Remaining -= 1;
      if (state.utf8Remaining === 0) {
        if (
          state.utf8CodePoint < state.utf8Minimum ||
          state.utf8CodePoint > 0x10ffff ||
          state.utf8CodePoint >= 0xd800 &&
            state.utf8CodePoint <= 0xdfff
        ) state.invalid = true;
      }
      return true;
    }
    if (byte <= 0x7f) {
      return true;
    } else if (byte >= 0xc2 && byte <= 0xdf) {
      state.utf8CodePoint = byte & 0x1f;
      state.utf8Minimum = 0x80;
      state.utf8Remaining = 1;
    } else if (byte >= 0xe0 && byte <= 0xef) {
      state.utf8CodePoint = byte & 0x0f;
      state.utf8Minimum = 0x800;
      state.utf8Remaining = 2;
    } else if (byte >= 0xf0 && byte <= 0xf4) {
      state.utf8CodePoint = byte & 0x07;
      state.utf8Minimum = 0x1_0000;
      state.utf8Remaining = 3;
    } else {
      state.invalid = true;
    }
    return true;
  };

  const advanceTokenFinalization = (): boolean => {
    const state = pendingTokenFinalization;
    if (state === undefined) return true;
    return state.kind === "identifier"
      ? advanceIdentifierFinalization(state)
      : state.kind === "number"
      ? advanceNumberFinalization(state)
      : advanceRawTokenFinalization(state);
  };

  const flushPunctuator = (
    operation: "step" | "finish" = "step",
  ): boolean => {
    if (punctuator.length === 0) return true;
    if (
      executableAsset.lookupHashedString(
        "punctuators",
        punctuator,
      ) === undefined
    ) {
      addDiagnostic(
        "CORE_UNSUPPORTED_TOKEN",
        punctuatorStart,
        undefined,
        operation,
      );
      punctuator = "";
      return true;
    }
    const bytes = [...encodeUtf8Owned(punctuator)];
    const emitted = emitToken(
      "punctuator",
      bytes,
      punctuatorStart,
      punctuatorStart + bytes.length,
    );
    punctuator = "";
    return emitted;
  };

  const processScalar = (
    codePoint: number,
    rawBytes: ReadonlyArray<number> | Uint8Array,
  ): boolean => {
    const scalar = String.fromCodePoint(codePoint);
    let reprocess = true;
    while (reprocess) {
      reprocess = false;
      switch (mode) {
        case "code": {
          if (punctuator.length > 0) {
            if (
              punctuator === "." &&
              codePoint >= 0x30 &&
              codePoint <= 0x39
            ) {
              tokenStart = punctuatorStart;
              lexemeLength = 0;
              if (
                !appendLexeme([0x2e]) ||
                !appendLexeme(rawBytes)
              ) {
                return false;
              }
              punctuator = "";
              numberState = 2;
              mode = "number";
              return true;
            }
            const candidate = punctuator + scalar;
            const matching = DECLARATIVE_V2_PUNCTUATORS_V1.filter((value) =>
              value.startsWith(candidate)
            );
            if (matching.length > 0) {
              punctuator = candidate;
              const hasLonger = matching.some(
                (value) => value.length > candidate.length,
              );
              if (!hasLonger) return flushPunctuator();
              return true;
            }
            if (!flushPunctuator()) return false;
            reprocess = true;
            continue;
          }
          if (
            codePoint === 0x7d &&
            templateStackLength > 0
          ) {
            const lastIndex = templateStackLength - 1;
            const depth = nestingView.getUint32(lastIndex * 16, false);
            if (depth === 0) {
              const transition = executableAsset.templateTransition(
                2,
                5,
              );
              if (
                transition?.nextState !== 1 ||
                transition.action !== 5
              ) {
                throw new Error("Executable template table lost substitution closure.");
              }
              templateStackLength -= 1;
              beginToken(rawBytes);
              mode = "template";
              return true;
            }
            nestingView.setUint32(lastIndex * 16, depth - 1, false);
          } else if (
            codePoint === 0x7b &&
            templateStackLength > 0
          ) {
            const lastIndex = templateStackLength - 1;
            const depth = nestingView.getUint32(lastIndex * 16, false);
            if (depth === MAX_U32) return false;
            nestingView.setUint32(lastIndex * 16, depth + 1, false);
          }
          if (isEcmaWhitespace(codePoint)) {
            return true;
          }
          if (isEcmaLineTerminator(codePoint)) {
            lineBeforeNextToken = true;
            return true;
          }
          if (isIdentifierStart(codePoint)) {
            beginToken(rawBytes);
            mode = "identifier";
            return true;
          }
          if (codePoint === 0x5c) {
            beginToken(rawBytes);
            identifierEscapeStage = "expectU";
            identifierEscapeDigits = "";
            mode = "identifierEscape";
            return true;
          }
          if (codePoint >= 0x30 && codePoint <= 0x39) {
            beginToken(rawBytes);
            numberState = 1;
            mode = "number";
            return true;
          }
          if (codePoint === 0x22 || codePoint === 0x27) {
            beginToken(rawBytes);
            mode = codePoint === 0x22 ? "doubleString" : "singleString";
            return true;
          }
          if (codePoint === 0x60) {
            beginToken(rawBytes);
            mode = "template";
            return true;
          }
          if (codePoint === 0x2f) {
            beginToken(rawBytes);
            mode = "slash";
            return true;
          }
          const candidate = scalar;
          const matching = DECLARATIVE_V2_PUNCTUATORS_V1.filter((value) =>
            value.startsWith(candidate)
          );
          if (matching.length > 0) {
            punctuatorStart = sourceOffset - rawBytes.length;
            currentTokenLineBefore = lineBeforeNextToken;
            lineBeforeNextToken = false;
            punctuator = candidate;
            const hasLonger = matching.some(
              (value) => value.length > candidate.length,
            );
            if (!hasLonger) return flushPunctuator();
            return true;
          }
          addDiagnostic("CORE_UNSUPPORTED_TOKEN", sourceOffset - rawBytes.length);
          return true;
        }
        case "identifier":
          if (isIdentifierContinue(codePoint)) {
            if (!appendLexeme(rawBytes)) return false;
            return true;
          }
          if (codePoint === 0x5c) {
            if (!appendLexeme(rawBytes)) return false;
            identifierEscapeStage = "expectU";
            identifierEscapeDigits = "";
            mode = "identifierEscape";
            return true;
          }
          deferredScalar = Object.freeze({
            codePoint,
            bytes: new Uint8Array(rawBytes),
          });
          return scheduleTokenFinalization(
            "identifier",
            sourceOffset - rawBytes.length,
            "step",
          );
        case "identifierEscape": {
          const isHex = /^[0-9a-fA-F]$/u.test(scalar);
          if (!appendLexeme(rawBytes)) return false;
          if (identifierEscapeStage === "expectU") {
            if (scalar !== "u") {
              addDiagnostic("CORE_UNSUPPORTED_TOKEN", tokenStart);
              mode = "identifier";
            } else {
              identifierEscapeStage = "firstHexOrBrace";
            }
            return true;
          }
          if (identifierEscapeStage === "firstHexOrBrace") {
            if (scalar === "{") {
              identifierEscapeStage = "bracedHex";
              return true;
            }
            if (!isHex) {
              addDiagnostic("CORE_UNSUPPORTED_TOKEN", tokenStart);
              mode = "identifier";
              return true;
            }
            identifierEscapeDigits = scalar;
            identifierEscapeStage = "fixedHex";
            return true;
          }
          if (identifierEscapeStage === "fixedHex") {
            if (!isHex) {
              addDiagnostic("CORE_UNSUPPORTED_TOKEN", tokenStart);
              mode = "identifier";
              return true;
            }
            identifierEscapeDigits += scalar;
            if (identifierEscapeDigits.length === 4) mode = "identifier";
            return true;
          }
          if (scalar === "}") {
            if (
              identifierEscapeDigits.length === 0 ||
              identifierEscapeDigits.length > 6
            ) addDiagnostic("CORE_UNSUPPORTED_TOKEN", tokenStart);
            mode = "identifier";
            return true;
          }
          if (!isHex || identifierEscapeDigits.length >= 6) {
            addDiagnostic("CORE_UNSUPPORTED_TOKEN", tokenStart);
            mode = "identifier";
            return true;
          }
          identifierEscapeDigits += scalar;
          return true;
        }
        case "number":
          {
            const inputClass = codePoint >= 0x30 && codePoint <= 0x39
              ? 1
              : codePoint === 0x2e
              ? 2
              : codePoint === 0x45 || codePoint === 0x65
              ? 3
              : codePoint === 0x2b || codePoint === 0x2d
              ? 4
              : codePoint === 0x5f
              ? 5
              : 0;
            const transition = inputClass === 0
              ? undefined
              : executableAsset.numberTransition(
                numberState,
                inputClass,
              );
            const radixOrSuffix = codePoint >= 0x41 && codePoint <= 0x5a ||
              codePoint >= 0x61 && codePoint <= 0x7a;
            if (transition !== undefined || radixOrSuffix) {
              if (transition !== undefined) numberState = transition.nextState;
              if (!appendLexeme(rawBytes)) return false;
              return true;
            }
          }
          deferredScalar = Object.freeze({
            codePoint,
            bytes: new Uint8Array(rawBytes),
          });
          return scheduleTokenFinalization(
            "number",
            sourceOffset - rawBytes.length,
            "step",
          );
        case "singleString":
        case "doubleString":
          if (!appendLexeme(rawBytes)) return false;
          if (isEcmaLineTerminator(codePoint)) {
            addDiagnostic("CORE_TRUNCATED_TOKEN", tokenStart);
            mode = "code";
            lexemeLength = 0;
            return true;
          }
          if (codePoint === 0x5c) {
            previousStringMode = mode;
            mode = "stringEscape";
          } else if (
            (mode === "singleString" && codePoint === 0x27) ||
            (mode === "doubleString" && codePoint === 0x22)
          ) {
            if (!emitCurrent("string")) return false;
            mode = "code";
          }
          return true;
        case "stringEscape":
          if (!appendLexeme(rawBytes)) return false;
          mode = previousStringMode ?? "doubleString";
          previousStringMode = undefined;
          return true;
        case "template":
          if (codePoint === 0x24) {
            if (!appendLexeme(rawBytes)) return false;
            mode = "templateDollar";
          } else {
            if (!appendLexeme(rawBytes)) return false;
          }
          if (codePoint === 0x5c) {
            const transition = executableAsset.templateTransition(1, 3);
            if (transition?.nextState !== 3 || transition.action !== 3) {
              throw new Error("Executable template table lost escape transition.");
            }
            mode = "templateEscape";
          } else if (codePoint === 0x60) {
            const transition = executableAsset.templateTransition(1, 1);
            if (transition?.nextState !== 0 || transition.action !== 1) {
              throw new Error("Executable template table lost close transition.");
            }
            if (!emitCurrent("template")) return false;
            mode = "code";
          }
          return true;
        case "templateDollar":
          if (codePoint === 0x7b) {
            const transition = executableAsset.templateTransition(1, 2);
            if (transition?.nextState !== 2 || transition.action !== 2) {
              throw new Error(
                "Executable template table lost substitution transition.",
              );
            }
            if (!appendLexeme(rawBytes)) return false;
            if (!emitCurrent("template")) return false;
            if (templateStackLength >= Number(required.nestingDepth)) {
              lastExhaustedDimension = "nestingDepth";
              return false;
            }
            nestingView.setUint32(templateStackLength * 16, 0, false);
            templateStackLength += 1;
            if (BigInt(templateStackLength) > usage.nestingDepth) {
              usage.nestingDepth = BigInt(templateStackLength);
            }
            mode = "code";
            return true;
          }
          mode = "template";
          reprocess = true;
          continue;
        case "templateEscape":
          {
            const transition = executableAsset.templateTransition(3, 4);
            if (transition?.nextState !== 1 || transition.action !== 4) {
              throw new Error(
                "Executable template table lost escaped-scalar transition.",
              );
            }
          }
          if (!appendLexeme(rawBytes)) return false;
          mode = "template";
          return true;
        case "lineComment":
          if (isEcmaLineTerminator(codePoint)) {
            lineBeforeNextToken = true;
            mode = "code";
          }
          return true;
        case "blockComment":
          if (codePoint === 0x2a) mode = "blockCommentStar";
          if (isEcmaLineTerminator(codePoint)) {
            lineBeforeNextToken = true;
          }
          return true;
        case "blockCommentStar":
          if (codePoint === 0x2f) {
            mode = "code";
          } else if (codePoint !== 0x2a) {
            mode = "blockComment";
          }
          return true;
        case "slash":
          if (codePoint === 0x2f) {
            lexemeLength = 0;
            mode = "lineComment";
            return true;
          }
          if (codePoint === 0x2a) {
            lexemeLength = 0;
            mode = "blockComment";
            return true;
          }
          if (
            pendingSlashScalarByteLength !== 0 ||
            rawBytes.length > pendingSlashScalarBytes.byteLength
          ) {
            throw new Error("Slash lexical-goal scalar storage is invalid.");
          }
          pendingSlashScalarBytes.set(rawBytes, 0);
          pendingSlashScalarByteLength = rawBytes.length;
          pendingSlashScalarCodePoint = codePoint;
          return true;
        case "regexp":
          if (!appendLexeme(rawBytes)) return false;
          if (codePoint === 0x5c) mode = "regexpEscape";
          else if (codePoint === 0x5b) {
            regexpClass = true;
            mode = "regexpClass";
          } else if (codePoint === 0x2f) {
            if (!emitCurrent("regexp")) return false;
            mode = "code";
          } else if (isEcmaLineTerminator(codePoint)) {
            addDiagnostic("CORE_TRUNCATED_TOKEN", tokenStart);
            mode = "code";
            lexemeLength = 0;
          }
          return true;
        case "regexpEscape":
          if (!appendLexeme(rawBytes)) return false;
          mode = regexpClass ? "regexpClass" : "regexp";
          return true;
        case "regexpClass":
          if (!appendLexeme(rawBytes)) return false;
          if (codePoint === 0x5c) mode = "regexpEscape";
          else if (codePoint === 0x5d) {
            regexpClass = false;
            mode = "regexp";
          }
          return true;
      }
    }
    return true;
  };

  const completePendingSlashScalar = (
    goal: "division" | "regexp",
    operation: "step" | "finish",
  ): boolean => {
    if (pendingSlashScalarByteLength === 0) {
      throw new Error("Slash lexical-goal completion lost its scalar.");
    }
    const codePoint = pendingSlashScalarCodePoint;
    const rawBytes = pendingSlashScalarBytes.subarray(
      0,
      pendingSlashScalarByteLength,
    );
    pendingSlashScalarByteLength = 0;
    pendingSlashScalarCodePoint = 0;
    if (goal === "regexp") {
      if (isEcmaLineTerminator(codePoint)) {
        addDiagnostic(
          "CORE_TRUNCATED_TOKEN",
          tokenStart,
          undefined,
          operation,
        );
        lexemeLength = 0;
        mode = "code";
        lineBeforeNextToken = true;
        return true;
      }
      if (!appendLexeme(rawBytes)) return false;
      regexpClass = codePoint === 0x5b;
      mode = codePoint === 0x5c
        ? "regexpEscape"
        : regexpClass
        ? "regexpClass"
        : "regexp";
      return true;
    }
    if (codePoint === 0x3d) {
      if (!appendLexeme(rawBytes)) return false;
      const emitted = emitToken(
        "punctuator",
        lexemeStorage.subarray(0, lexemeLength),
        tokenStart,
        tokenStart + lexemeLength,
      );
      lexemeLength = 0;
      mode = "code";
      return emitted;
    }
    if (!emitToken(
      "punctuator",
      lexemeStorage.subarray(0, lexemeLength),
      tokenStart,
      tokenStart + lexemeLength,
    )) return false;
    lexemeLength = 0;
    mode = "code";
    return processScalar(codePoint, rawBytes);
  };

  const completeSlashAtEof = (
    goal: "division" | "regexp",
  ): boolean => {
    pendingSlashAtEof = false;
    if (goal === "regexp") {
      addDiagnostic("CORE_TRUNCATED_TOKEN", tokenStart, undefined, "finish");
      lexemeLength = 0;
      mode = "code";
      return true;
    }
    const emitted = emitToken(
      "punctuator",
      lexemeStorage.subarray(0, lexemeLength),
      tokenStart,
      tokenStart + lexemeLength,
    );
    lexemeLength = 0;
    mode = "code";
    return emitted;
  };

  const consumeByte = (byte: number): boolean => {
    sourceOffset += 1;
    usage.sourceBytes += 1n;
    usage.objectBodyBytes = usage.sourceBytes + usage.semanticBytes;
    while (true) {
      const byteClass = utf8State === 0
        ? byte <= 0x7f
          ? 1
          : byte >= 0xc2 && byte <= 0xdf
          ? 2
          : byte >= 0xe0 && byte <= 0xef
          ? 3
          : byte >= 0xf0 && byte <= 0xf4
          ? 4
          : 6
        : byte >= 0x80 && byte <= 0xbf
        ? 5
        : 6;
      const transition = executableAsset.utf8Transition(
        utf8State,
        byteClass,
      );
      if (transition === undefined) {
        addDiagnostic("CORE_INVALID_UTF8", sourceOffset - 1);
        utf8State = 0;
        pendingUtf8Length = 0;
        return true;
      }
      if (transition.action === 1) {
        utf8State = transition.nextState;
        return processScalar(byte, [byte]);
      }
      if (transition.action === 2) {
        pendingUtf8[pendingUtf8Length] = byte;
        pendingUtf8Length += 1;
        utf8State = transition.nextState;
        return true;
      }
      if (transition.action === 4) {
        addDiagnostic("CORE_INVALID_UTF8", sourceOffset - pendingUtf8Length);
        pendingUtf8Length = 0;
        utf8State = transition.nextState;
        continue;
      }
      pendingUtf8[pendingUtf8Length] = byte;
      pendingUtf8Length += 1;
      const bytes = pendingUtf8.subarray(0, pendingUtf8Length);
      pendingUtf8Length = 0;
      utf8State = transition.nextState;
      let codePoint: number;
      if (bytes.byteLength === 2) {
        codePoint = ((bytes[0]! & 0x1f) << 6) |
          (bytes[1]! & 0x3f);
      } else if (bytes.byteLength === 3) {
        codePoint = ((bytes[0]! & 0x0f) << 12) |
          ((bytes[1]! & 0x3f) << 6) |
          (bytes[2]! & 0x3f);
      } else if (bytes.byteLength === 4) {
        codePoint = ((bytes[0]! & 0x07) << 18) |
          ((bytes[1]! & 0x3f) << 12) |
          ((bytes[2]! & 0x3f) << 6) |
          (bytes[3]! & 0x3f);
      } else {
        throw new Error("UTF-8 DFA completed an invalid scalar width.");
      }
      if (
        (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
        codePoint > 0x10ffff
      ) {
        addDiagnostic("CORE_INVALID_UTF8", sourceOffset - bytes.byteLength);
        return true;
      }
      return processScalar(codePoint, bytes);
    }
  };

  const step = (
    rawBytes: unknown,
    rawMaximumTransitions: unknown,
  ): Result.Result<
    DeclarativeV2VerifierEngineStepReceiptV1,
    DeclarativeV2VerifierExecutableV1Error
  > => {
    if (engineState !== "acceptingSource") {
      return Result.fail(executableError("step", "closed"));
    }
    const failStep = (
      error: DeclarativeV2VerifierExecutableV1Error,
    ): Result.Result<
      DeclarativeV2VerifierEngineStepReceiptV1,
      DeclarativeV2VerifierExecutableV1Error
    > => {
      engineState = "failed";
      return Result.fail(error);
    };
    const allowance = captureTransitionAllowance(
      rawMaximumTransitions,
      "step",
    );
    if (Result.isFailure(allowance)) return failStep(allowance.failure);
    const beforeUsage = usageSnapshot(usage);
    if (!isUint8Array(rawBytes)) {
      return failStep(executableError("step", "invalidInput"));
    }
    const length = intrinsicByteLength(rawBytes);
    if (length === undefined) {
      return failStep(executableError("step", "invalidInput"));
    }
    if (usage.calls + 1n > required.calls) {
      return failStep(executableError("step", "budgetExceeded", {
        dimension: "calls",
        observed: usage.calls + 1n,
        maximum: required.calls,
      }));
    }
    let bytes: Uint8Array;
    try {
      bytes = Reflect.apply(
        UINT8_ARRAY_SUBARRAY,
        rawBytes,
        [0, length],
      );
    } catch {
      return failStep(executableError("step", "invalidInput"));
    }
    usage.calls += 1n;
    let transitions = 0;
    let consumedBytes = 0;
    while (
      (consumedBytes < bytes.byteLength ||
        pendingSlashScalarByteLength > 0 ||
        pendingTokenFinalization !== undefined ||
        deferredScalar !== undefined) &&
      transitions < allowance.success
    ) {
      if (pendingTokenFinalization !== undefined) {
        const advanced = advanceTokenFinalization();
        transitions += 1;
        if (!advanced) {
          return failStep(executableError("step", "budgetExceeded", {
            dimension: lastExhaustedDimension,
          }));
        }
        if (operationalBudgetFailure !== undefined) {
          return failStep(operationalBudgetFailure);
        }
        continue;
      }
      if (deferredScalar !== undefined) {
        const scalar = deferredScalar;
        deferredScalar = undefined;
        transitions += 1;
        if (!processScalar(scalar.codePoint, scalar.bytes)) {
          return failStep(executableError("step", "budgetExceeded", {
            dimension: lastExhaustedDimension,
          }));
        }
        if (operationalBudgetFailure !== undefined) {
          return failStep(operationalBudgetFailure);
        }
        continue;
      }
      if (pendingSlashScalarByteLength > 0) {
        const goal = advanceSlashLexicalGoal("step");
        transitions += 1;
        if (
          goal !== "advanced" &&
          !completePendingSlashScalar(goal, "step")
        ) {
          return failStep(executableError("step", "budgetExceeded", {
            dimension: lastExhaustedDimension,
          }));
        }
        if (operationalBudgetFailure !== undefined) {
          return failStep(operationalBudgetFailure);
        }
        continue;
      }
      if (!canonicalParserIsCaughtUp()) {
        const advanced = drainCanonicalParser(
          "step",
          allowance.success - transitions,
        );
        transitions += advanced;
        if (operationalBudgetFailure !== undefined) {
          return failStep(operationalBudgetFailure);
        }
        if (!canonicalParserIsCaughtUp() || transitions >=
            allowance.success) {
          break;
        }
      }
      if (usage.sourceBytes + 1n > required.sourceBytes) {
        return failStep(executableError("step", "budgetExceeded", {
          dimension: "sourceBytes",
          observed: usage.sourceBytes + 1n,
          maximum: required.sourceBytes,
        }));
      }
      if (usage.objectBodyBytes + 1n > required.objectBodyBytes) {
        return failStep(executableError("step", "budgetExceeded", {
          dimension: "objectBodyBytes",
          observed: usage.objectBodyBytes + 1n,
          maximum: required.objectBodyBytes,
        }));
      }
      const byte = bytes[consumedBytes]!;
      consumedBytes += 1;
      transitions += 1;
      let consumed: boolean;
      try {
        consumed = consumeByte(byte);
      } catch (cause) {
        if (cause instanceof DeclarativeV2VerifierExecutableV1Error) {
          return failStep(cause);
        }
        throw cause;
      }
      if (!consumed) {
        return failStep(executableError("step", "budgetExceeded", {
          dimension: lastExhaustedDimension,
        }));
      }
      if (operationalBudgetFailure !== undefined) {
        return failStep(operationalBudgetFailure);
      }
    }
    if (
      consumedBytes === bytes.byteLength &&
      transitions < allowance.success &&
      pendingSlashScalarByteLength === 0 &&
      pendingTokenFinalization === undefined &&
      deferredScalar === undefined &&
      !canonicalParserIsCaughtUp()
    ) {
      transitions += drainCanonicalParser(
        "step",
        allowance.success - transitions,
      );
      if (operationalBudgetFailure !== undefined) {
        return failStep(operationalBudgetFailure);
      }
    }
    return Result.succeed(Object.freeze({
      consumedBytes,
      transitionCount: transitions,
      deltaUsage: frozenUsageDelta(usage, beforeUsage),
      usage: frozenUsage(usage),
    }));
  };

  const finishLexing = (): boolean => {
    if (pendingUtf8Length > 0) {
      addDiagnostic(
        "CORE_INVALID_UTF8",
        sourceOffset - pendingUtf8Length,
        undefined,
        "finish",
      );
      pendingUtf8Length = 0;
      utf8State = 0;
    }
    if (templateStackLength > 0) {
      addDiagnostic("CORE_TRUNCATED_TOKEN", tokenStart, undefined, "finish");
      templateStackLength = 0;
    }
    switch (mode) {
      case "identifier":
        if (!scheduleTokenFinalization("identifier", sourceOffset, "finish")) {
          throw executableError("finish", "budgetExceeded", {
            dimension: "tokens",
          });
        }
        return false;
      case "identifierEscape":
        addDiagnostic("CORE_TRUNCATED_TOKEN", tokenStart, undefined, "finish");
        break;
      case "number": {
        if (!scheduleTokenFinalization("number", sourceOffset, "finish")) {
          throw executableError("finish", "budgetExceeded", {
            dimension: "tokens",
          });
        }
        return false;
      }
      case "slash":
        if (!emitCurrent("punctuator")) {
          throw executableError("finish", "budgetExceeded", {
            dimension: "tokens",
          });
        }
        break;
      case "singleString":
      case "doubleString":
      case "stringEscape":
      case "template":
      case "templateDollar":
      case "templateEscape":
      case "blockComment":
      case "blockCommentStar":
      case "regexp":
      case "regexpEscape":
      case "regexpClass":
        addDiagnostic("CORE_TRUNCATED_TOKEN", tokenStart, undefined, "finish");
        break;
      case "lineComment":
      case "code":
        break;
    }
    if (!flushPunctuator("finish")) {
      throw executableError("finish", "budgetExceeded", {
        dimension: "tokens",
      });
    }
    currentTokenLineBefore = lineBeforeNextToken;
    if (!emitToken("eof", [], sourceOffset, sourceOffset)) {
      throw executableError("finish", "budgetExceeded", {
        dimension: "tokens",
      });
    }
    return true;
  };

  const createArenaSemanticFlowMachine = (): Generator<
    number,
    DeclarativeV2VerifierOwnedModuleArenaV1,
    void
  > => (function* arenaSemanticFlowMachine() {
    const IMPORT_RECORD_BYTES = 64;
    const EXPORT_RECORD_BYTES = 48;
    const FUNCTION_RECORD_BYTES = 144;
    const IMPORT_DECLARATION = 1;
    const IMPORT_CALL = 2;
    const TARGET_ARTIFACT = 1;
    const TARGET_PLATFORM = 2;
    const TARGET_LOCAL = 3;
    const TARGET_ABI = 4;
    const TOKEN_BINDING_OWNER_OFFSET = 44;
    let cursor = 0;
    let importCount = 0;
    let callCount = 0;
    let exportCount = 0;
    let functionCount = 0;
    let valueFlowCount = 0;
    let parserBudgetFailure:
      | DeclarativeV2VerifierExecutableV1Error
      | undefined;

    const chargeMany = (
      entries: ReadonlyArray<readonly [
        typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
        bigint,
      ]>,
    ): boolean => {
      for (const [dimension, amount] of entries) {
        if (usage[dimension] + amount > required[dimension]) {
          operationalBudgetFailure ??= executableError(
            "finish",
            "budgetExceeded",
            {
              dimension,
              observed: usage[dimension] + amount,
              maximum: required[dimension],
            },
          );
          return false;
        }
      }
      for (const [dimension, amount] of entries) usage[dimension] += amount;
      return true;
    };

    interface CodeUnitCursor {
      byteOffset: number;
      pendingLowSurrogate: number;
    }
    const readTokenCodeUnit = (
      tokenIndex: number,
      trimStart: number,
      trimEnd: number,
      state: CodeUnitCursor,
    ): number | undefined => {
      if (state.pendingLowSurrogate !== 0) {
        const value = state.pendingLowSurrogate;
        state.pendingLowSurrogate = 0;
        return value;
      }
      const length = tokenTextByteLength(tokenIndex) - trimStart - trimEnd;
      if (state.byteOffset >= length) return undefined;
      const absolute = trimStart + state.byteOffset;
      const first = tokenTextByteAt(tokenIndex, absolute)!;
      if (first <= 0x7f) {
        state.byteOffset += 1;
        return first;
      }
      const width = first <= 0xdf ? 2 : first <= 0xef ? 3 : 4;
      let codePoint = first &
        (width === 2 ? 0x1f : width === 3 ? 0x0f : 0x07);
      for (let offset = 1; offset < width; offset += 1) {
        codePoint = (codePoint << 6) |
          (tokenTextByteAt(tokenIndex, absolute + offset)! & 0x3f);
      }
      state.byteOffset += width;
      if (codePoint <= 0xffff) return codePoint;
      const adjusted = codePoint - 0x1_0000;
      state.pendingLowSurrogate = 0xdc00 | (adjusted & 0x3ff);
      return 0xd800 | (adjusted >>> 10);
    };
    const compareTokenSlices = function* (
      leftToken: number,
      rightToken: number,
      leftTrimStart = 0,
      leftTrimEnd = 0,
      rightTrimStart = 0,
      rightTrimEnd = 0,
    ): Generator<number, -1 | 0 | 1, void> {
      const left: CodeUnitCursor = {
        byteOffset: 0,
        pendingLowSurrogate: 0,
      };
      const right: CodeUnitCursor = {
        byteOffset: 0,
        pendingLowSurrogate: 0,
      };
      while (true) {
        yield 1;
        const leftUnit = readTokenCodeUnit(
          leftToken,
          leftTrimStart,
          leftTrimEnd,
          left,
        );
        const rightUnit = readTokenCodeUnit(
          rightToken,
          rightTrimStart,
          rightTrimEnd,
          right,
        );
        if (leftUnit !== rightUnit) {
          return leftUnit === undefined
            ? -1
            : rightUnit === undefined
            ? 1
            : leftUnit < rightUnit
            ? -1
            : 1;
        }
        if (leftUnit === undefined) return 0;
      }
    };
    const compareTokenToAscii = function* (
      tokenIndex: number,
      expected: string,
      trimStart = 0,
      trimEnd = 0,
    ): Generator<number, -1 | 0 | 1, void> {
      const state: CodeUnitCursor = {
        byteOffset: 0,
        pendingLowSurrogate: 0,
      };
      let expectedIndex = 0;
      while (true) {
        yield 1;
        const left = readTokenCodeUnit(
          tokenIndex,
          trimStart,
          trimEnd,
          state,
        );
        const right = expectedIndex < expected.length
          ? expected.charCodeAt(expectedIndex)
          : undefined;
        if (right !== undefined) expectedIndex += 1;
        if (left !== right) {
          return left === undefined
            ? -1
            : right === undefined
            ? 1
            : left < right
            ? -1
            : 1;
        }
        if (left === undefined) return 0;
      }
    };
    const tokenSliceByteLength = (
      tokenIndex: number,
      trimStart = 0,
      trimEnd = 0,
    ): number => tokenTextByteLength(tokenIndex) - trimStart - trimEnd;
    const tokenMatches = (
      tokenIndex: number,
      expected: string,
    ): boolean => tokenEqualsAscii(tokenIndex, expected);
    const at = (index: number): TokenView => tokenAt(index);
    const current = (): TokenView => at(cursor);
    const currentIs = (expected: string): boolean =>
      tokenMatches(cursor, expected);
    const markBinding = (tokenIndex: number, functionIndex: number): void => {
      tokenView.setUint32(
        tokenRecordOffset(tokenIndex) + TOKEN_BINDING_OWNER_OFFSET,
        functionIndex + 1,
        false,
      );
    };
    const isBinding = (tokenIndex: number, functionIndex: number): boolean =>
      tokenView.getUint32(
        tokenRecordOffset(tokenIndex) + TOKEN_BINDING_OWNER_OFFSET,
        false,
      ) === functionIndex + 1;

    const importRecordOffset = (index: number): number =>
      index * IMPORT_RECORD_BYTES;
    const exportRecordOffset = (index: number): number =>
      index * EXPORT_RECORD_BYTES;
    const functionRecordOffset = (index: number): number =>
      index * FUNCTION_RECORD_BYTES;
    const totalImportRecords = (): number => importCount + callCount;
    const importToken = (index: number, fieldOffset: number): number => {
      const stored = importEdgeView.getUint32(
        importRecordOffset(index) + fieldOffset,
        false,
      );
      if (stored === 0) {
        throw new Error("Semantic import record lost its token reference.");
      }
      return stored - 1;
    };
    const exportToken = (index: number, fieldOffset: number): number => {
      const stored = exportView.getUint32(
        exportRecordOffset(index) + fieldOffset,
        false,
      );
      if (stored === 0) {
        throw new Error("Semantic export record lost its token reference.");
      }
      return stored - 1;
    };
    const functionNameToken = (index: number): number => {
      const stored = functionView.getUint32(
        functionRecordOffset(index),
        false,
      );
      if (stored === 0) {
        throw new Error("Semantic function record lost its name.");
      }
      return stored - 1;
    };

    const add = (code: string, token: TokenView): void => {
      if (code === "CORE_SYNTAX") {
        if (!canonicalParserRejected) {
          throw new Error(
            "Canonical parser acceptance disagreed with semantic extraction.",
          );
        }
        return;
      }
      addDiagnostic(code, token.start, undefined, "finish");
    };
    const semicolon = (): void => {
      if (currentIs(";")) cursor += 1;
    };
    const findBalanced = function* (
      openIndex: number,
      open: string,
      close: string,
    ): Generator<number, number | undefined, void> {
      let depth = 0;
      for (let index = openIndex; index < tokenCount; index += 1) {
        yield 1;
        if (tokenMatches(index, open)) {
          depth += 1;
          const observedDepth = BigInt(depth);
          const observedStates = BigInt(depth + 1);
          if (
            observedDepth > required.nestingDepth ||
            observedStates > required.parserStates
          ) {
            parserBudgetFailure = executableError(
              "finish",
              "budgetExceeded",
              {
                dimension: observedDepth > required.nestingDepth
                  ? "nestingDepth"
                  : "parserStates",
                observed: observedDepth > required.nestingDepth
                  ? observedDepth
                  : observedStates,
                maximum: observedDepth > required.nestingDepth
                  ? required.nestingDepth
                  : required.parserStates,
              },
            );
            return undefined;
          }
          if (observedDepth > usage.nestingDepth) {
            usage.nestingDepth = observedDepth;
          }
          if (observedStates > usage.parserStates) {
            usage.parserStates = observedStates;
          }
        } else if (tokenMatches(index, close)) {
          depth -= 1;
          if (depth === 0) return index;
        }
      }
      return undefined;
    };
    const canonicalArtifactModuleSpecifier = function* (
      tokenIndex: number,
    ): Generator<number, boolean, void> {
      const length = tokenTextByteLength(tokenIndex);
      if (
        length <= 4 ||
        tokenTextByteAt(tokenIndex, 1) !== 0x2e ||
        tokenTextByteAt(tokenIndex, 2) !== 0x2f
      ) return false;
      let segmentStart = 3;
      for (let index = 3; index < length; index += 1) {
        yield 1;
        const atEnd = index === length - 1;
        const byte = atEnd ? 0x2f : tokenTextByteAt(tokenIndex, index)!;
        if (byte === 0x5c) return false;
        if (byte !== 0x2f) continue;
        const segmentLength = index - segmentStart;
        if (
          segmentLength === 0 ||
          segmentLength === 1 &&
            tokenTextByteAt(tokenIndex, segmentStart) === 0x2e ||
          segmentLength === 2 &&
            tokenTextByteAt(tokenIndex, segmentStart) === 0x2e &&
            tokenTextByteAt(tokenIndex, segmentStart + 1) === 0x2e
        ) return false;
        segmentStart = index + 1;
      }
      return true;
    };
    const allowlistedPlatformSpecifier = function* (
      tokenIndex: number,
    ): Generator<number, boolean, void> {
      for (const allowed of DECLARATIVE_V2_PLATFORM_IMPORT_ALLOWLIST_V1) {
        if ((yield* compareTokenToAscii(tokenIndex, allowed, 1, 1)) === 0) {
          return true;
        }
      }
      return false;
    };
    const abiIdForToken = function* (
      tokenIndex: number,
    ): Generator<number, number | undefined, void> {
      for (
        let index = 0;
        index < DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1.length;
        index += 1
      ) {
        const definition = DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1[index]!;
        if ((yield* compareTokenToAscii(tokenIndex, definition.name)) === 0) {
          return index;
        }
      }
      return undefined;
    };

    const modulePathLength =
      DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.byteLength(input.modulePath);
    if (Result.isFailure(modulePathLength)) {
      throw executableError("finish", "invalidInput");
    }
    const modulePathByteLength = modulePathLength.success;
    for (let index = 0; index < modulePathByteLength; index += 1) {
      yield 1;
      if (
        !chargeMany([["outputBytes", 1n]]) ||
        index >= outputBytes.byteLength
      ) {
        throw operationalBudgetFailure ??
          executableError("finish", "addressabilityExceeded", {
            dimension: "outputBytes",
          });
      }
      const byte = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.byteAt(
        input.modulePath,
        index,
      );
      if (Result.isFailure(byte) || byte.success === undefined) {
        throw executableError("finish", "invalidInput");
      }
      outputBytes[index] = byte.success;
    }

    const appendImportMember = (
      importedToken: number | undefined,
      localToken: number,
    ): boolean => {
      if (
        totalImportRecords() >=
          Math.floor(importEdgeView.byteLength / IMPORT_RECORD_BYTES)
      ) {
        operationalBudgetFailure ??= executableError(
          "finish",
          "budgetExceeded",
          {
            dimension: "importEdges",
            observed: BigInt(totalImportRecords() + 1),
            maximum: required.importEdges,
          },
        );
        return false;
      }
      const offset = importRecordOffset(totalImportRecords());
      importEdgeView.setUint32(offset, IMPORT_DECLARATION, false);
      importEdgeView.setUint32(
        offset + 4,
        importedToken === undefined ? 0 : importedToken + 1,
        false,
      );
      importEdgeView.setUint32(offset + 8, localToken + 1, false);
      importEdgeView.setUint32(offset + 40, importCount, false);
      importCount += 1;
      return true;
    };
    const finalizeImportMembers = function* (
      firstIndex: number,
      sourceToken: number,
      targetKind: number,
    ): Generator<number, void, void> {
      for (let index = firstIndex; index < importCount; index += 1) {
        yield 1;
        const offset = importRecordOffset(index);
        const importedStored = importEdgeView.getUint32(offset + 4, false);
        const localToken = importToken(index, 8);
        const importedLength = importedStored === 0
          ? 7
          : tokenTextByteLength(importedStored - 1);
        const outputLength =
          importedLength +
          tokenTextByteLength(localToken) +
          tokenSliceByteLength(sourceToken, 1, 1);
        if (!chargeMany([
          ["importEdges", 1n],
          ["graphNodes", 1n],
          ["frontierEntries", 1n],
          ["outputBytes", BigInt(outputLength)],
        ])) return;
        importEdgeView.setUint32(offset + 12, sourceToken + 1, false);
        importEdgeView.setUint32(offset + 16, targetKind, false);
        if (targetKind === TARGET_PLATFORM) {
          const abiId = importedStored === 0
            ? undefined
            : yield* abiIdForToken(importedStored - 1);
          if (abiId === undefined) add("CORE_IMPORT_TARGET", at(sourceToken));
          else importEdgeView.setUint32(offset + 36, abiId + 1, false);
        }
      }
    };
    const parseImport = function* (): Generator<number, void, void> {
      const start = current();
      cursor += 1;
      if (current().kind === "string") {
        add("CORE_SIDE_EFFECT_IMPORT", start);
        while (current().kind !== "eof" && !currentIs(";")) {
          yield 1;
          cursor += 1;
        }
        semicolon();
        return;
      }
      const firstImport = importCount;
      if (current().kind === "identifier") {
        if (!appendImportMember(undefined, cursor)) return;
        cursor += 1;
      } else if (currentIs("{")) {
        cursor += 1;
        while (current().kind !== "eof" && !currentIs("}")) {
          yield 1;
          if (current().kind !== "identifier") {
            add("CORE_SYNTAX", current());
            break;
          }
          const nameToken = cursor;
          cursor += 1;
          if (currentIs("as")) {
            add("CORE_REEXPORT", current());
            cursor += 1;
            if (current().kind === "identifier") cursor += 1;
          } else if (!appendImportMember(nameToken, nameToken)) return;
          if (currentIs(",")) cursor += 1;
          else if (!currentIs("}")) {
            add("CORE_SYNTAX", current());
            break;
          }
        }
        if (currentIs("}")) cursor += 1;
      } else {
        add("CORE_SYNTAX", current());
      }
      if (!currentIs("from")) {
        add("CORE_SYNTAX", current());
        while (current().kind !== "eof" && !currentIs(";")) {
          yield 1;
          cursor += 1;
        }
        semicolon();
        return;
      }
      cursor += 1;
      const source = current();
      if (source.kind !== "string") {
        add("CORE_SYNTAX", source);
        return;
      }
      const targetKind = tokenTextByteAt(source.index, 1) === 0x2e
        ? TARGET_ARTIFACT
        : TARGET_PLATFORM;
      const allowed = targetKind === TARGET_ARTIFACT
        ? yield* canonicalArtifactModuleSpecifier(source.index)
        : yield* allowlistedPlatformSpecifier(source.index);
      if (!allowed) add("CORE_IMPORT_TARGET", source);
      yield* finalizeImportMembers(firstImport, source.index, targetKind);
      cursor += 1;
      semicolon();
    };

    const appendFunction = (
      nameToken: number,
      isAsync: boolean,
      bodyStart: number,
      bodyEnd: number,
    ): number | undefined => {
      if (
        functionCount >=
          Math.floor(functionView.byteLength / FUNCTION_RECORD_BYTES)
      ) {
        operationalBudgetFailure ??= executableError(
          "finish",
          "budgetExceeded",
          {
            dimension: "functions",
            observed: BigInt(functionCount + 1),
            maximum: required.functions,
          },
        );
        return undefined;
      }
      if (
        !chargeMany([
          ["functions", 1n],
          ["graphNodes", 1n],
          ["outputBytes", BigInt(tokenTextByteLength(nameToken))],
        ])
      ) return undefined;
      const index = functionCount;
      const offset = functionRecordOffset(index);
      functionView.setUint32(offset, nameToken + 1, false);
      functionView.setUint32(offset + 4, isAsync ? 1 : 0, false);
      functionView.setUint32(offset + 8, bodyStart, false);
      functionView.setUint32(offset + 12, bodyEnd, false);
      functionView.setUint32(offset + 16, index, false);
      functionCount += 1;
      return index;
    };
    const appendExport = (
      exportNameToken: number | undefined,
      localNameToken: number,
      isDefault: boolean,
    ): boolean => {
      if (
        exportCount >= Math.floor(exportView.byteLength / EXPORT_RECORD_BYTES)
      ) {
        operationalBudgetFailure ??= executableError(
          "finish",
          "budgetExceeded",
          {
            dimension: "exports",
            observed: BigInt(exportCount + 1),
            maximum: required.exports,
          },
        );
        return false;
      }
      const exportLength = isDefault
        ? 7
        : tokenTextByteLength(exportNameToken!);
      if (!chargeMany([
        ["exports", 1n],
        [
          "outputBytes",
          BigInt(exportLength + tokenTextByteLength(localNameToken)),
        ],
      ])) return false;
      const offset = exportRecordOffset(exportCount);
      exportView.setUint32(
        offset,
        exportNameToken === undefined ? 0 : exportNameToken + 1,
        false,
      );
      exportView.setUint32(offset + 4, localNameToken + 1, false);
      exportView.setUint32(offset + 8, isDefault ? 1 : 0, false);
      exportView.setUint32(offset + 12, exportCount, false);
      exportCount += 1;
      return true;
    };
    const parseFunction = function* (
      exported: boolean,
      isDefault: boolean,
      isAsync: boolean,
    ): Generator<number, void, void> {
      const functionToken = current();
      if (!currentIs("function")) {
        add("CORE_SYNTAX", functionToken);
        return;
      }
      cursor += 1;
      if (currentIs("*")) {
        add("CORE_HIGHER_ORDER", current());
        cursor += 1;
      }
      const nameToken = current();
      if (nameToken.kind !== "identifier") {
        add("CORE_SYNTAX", nameToken);
        return;
      }
      cursor += 1;
      if (!currentIs("(")) {
        add("CORE_SYNTAX", current());
        return;
      }
      const paramsStart = cursor;
      const paramsEnd = yield* findBalanced(cursor, "(", ")");
      if (paramsEnd === undefined) {
        add("CORE_SYNTAX", current());
        cursor = tokenCount - 1;
        return;
      }
      cursor = paramsEnd + 1;
      if (!currentIs("{")) {
        add("CORE_SYNTAX", current());
        return;
      }
      const bodyStart = cursor;
      const bodyEnd = yield* findBalanced(cursor, "{", "}");
      if (bodyEnd === undefined) {
        add("CORE_SYNTAX", current());
        cursor = tokenCount - 1;
        return;
      }
      const functionIndex = appendFunction(
        nameToken.index,
        isAsync,
        bodyStart,
        bodyEnd,
      );
      if (functionIndex === undefined) return;
      let expectsBinding = true;
      let delimiterDepth = 0;
      for (let index = paramsStart + 1; index < paramsEnd; index += 1) {
        yield 1;
        const token = at(index);
        if (token.kind === "identifier" && expectsBinding) {
          markBinding(index, functionIndex);
          expectsBinding = false;
        } else if (
          (tokenMatches(index, "[") || tokenMatches(index, "{")) &&
          expectsBinding
        ) {
          if (delimiterDepth >= Math.floor(nestingView.byteLength / 16)) {
            operationalBudgetFailure ??= executableError(
              "finish",
              "budgetExceeded",
              {
                dimension: "nestingDepth",
                observed: BigInt(delimiterDepth + 1),
                maximum: required.nestingDepth,
              },
            );
            return;
          }
          nestingView.setUint32(
            delimiterDepth * 16,
            tokenMatches(index, "[") ? 1 : 2,
            false,
          );
          delimiterDepth += 1;
          expectsBinding = true;
        } else if (
          tokenMatches(index, "]") &&
          delimiterDepth > 0 &&
          nestingView.getUint32((delimiterDepth - 1) * 16, false) === 1
        ) {
          delimiterDepth -= 1;
          expectsBinding = false;
        } else if (
          tokenMatches(index, "}") &&
          delimiterDepth > 0 &&
          nestingView.getUint32((delimiterDepth - 1) * 16, false) === 2
        ) {
          delimiterDepth -= 1;
          expectsBinding = false;
        } else if (tokenMatches(index, ",") && !expectsBinding) {
          expectsBinding = true;
        }
      }
      if (exported) {
        appendExport(
          isDefault ? undefined : nameToken.index,
          nameToken.index,
          isDefault,
        );
      }
      cursor = bodyEnd + 1;
    };
    const parseDeclaration = function* (): Generator<number, void, void> {
      let exported = false;
      let isDefault = false;
      let isAsync = false;
      if (currentIs("export")) {
        exported = true;
        cursor += 1;
        if (currentIs("default")) {
          isDefault = true;
          cursor += 1;
        } else if (currentIs("{") || currentIs("*")) {
          add("CORE_REEXPORT", current());
          while (current().kind !== "eof" && !currentIs(";")) {
            yield 1;
            cursor += 1;
          }
          semicolon();
          return;
        }
      }
      if (currentIs("async")) {
        isAsync = true;
        cursor += 1;
      }
      if (currentIs("function")) {
        yield* parseFunction(exported, isDefault, isAsync);
        return;
      }
      add(
        currentIs("class")
          ? "CORE_CONSTRUCTION"
          : "CORE_TOP_LEVEL_EXECUTION",
        current(),
      );
      while (current().kind !== "eof" && !currentIs(";")) {
        yield 1;
        cursor += 1;
      }
      semicolon();
    };

    while (current().kind !== "eof") {
      yield 1;
      if (current().kind === "string") {
        cursor += 1;
        semicolon();
      } else if (currentIs("import")) {
        yield* parseImport();
      } else {
        yield* parseDeclaration();
      }
    }
    if (parserBudgetFailure !== undefined) throw parserBudgetFailure;
    if (operationalBudgetFailure !== undefined) {
      throw operationalBudgetFailure;
    }

    const firstTokenMatching = function* (
      targetToken: number,
      targetIsDefault = false,
    ): Generator<number, TokenView, void> {
      for (let index = 0; index < tokenCount; index += 1) {
        if (
          targetIsDefault
            ? (yield* compareTokenToAscii(index, "default")) === 0
            : (yield* compareTokenSlices(index, targetToken)) === 0
        ) return at(index);
      }
      return at(tokenCount - 1);
    };
    for (let index = 0; index < functionCount; index += 1) {
      const name = functionNameToken(index);
      for (let prior = 0; prior < index; prior += 1) {
        if ((yield* compareTokenSlices(name, functionNameToken(prior))) === 0) {
          add("CORE_EXPORT_AMBIGUITY", yield* firstTokenMatching(name));
          break;
        }
      }
    }
    for (let index = 0; index < exportCount; index += 1) {
      const offset = exportRecordOffset(index);
      const isDefault = exportView.getUint32(offset + 8, false) === 1;
      const name = isDefault ? undefined : exportToken(index, 0);
      for (let prior = 0; prior < index; prior += 1) {
        const priorOffset = exportRecordOffset(prior);
        const priorDefault =
          exportView.getUint32(priorOffset + 8, false) === 1;
        const equal = isDefault && priorDefault ||
          !isDefault && !priorDefault &&
            (yield* compareTokenSlices(name!, exportToken(prior, 0))) === 0;
        if (equal) {
          add(
            "CORE_EXPORT_AMBIGUITY",
            yield* firstTokenMatching(exportToken(index, 4)),
          );
          break;
        }
      }
    }
    for (let index = 0; index < importCount; index += 1) {
      const local = importToken(index, 8);
      let duplicate = false;
      for (let prior = 0; prior < index; prior += 1) {
        if ((yield* compareTokenSlices(local, importToken(prior, 8))) === 0) {
          duplicate = true;
          break;
        }
      }
      if (!duplicate) {
        for (let fn = 0; fn < functionCount; fn += 1) {
          if ((yield* compareTokenSlices(local, functionNameToken(fn))) === 0) {
            duplicate = true;
            break;
          }
        }
      }
      if (duplicate) {
        add("CORE_EXPORT_AMBIGUITY", yield* firstTokenMatching(local));
      }
    }

    const findBeforeClose = function* (
      start: number,
      end: number,
      expected: string,
    ): Generator<number, boolean, void> {
      let depth = 0;
      for (let index = start + 1; index < end; index += 1) {
        yield 1;
        if (tokenMatches(index, "(")) depth += 1;
        else if (tokenMatches(index, ")")) {
          depth -= 1;
          if (depth <= 0) return false;
        } else if (depth > 0 && tokenMatches(index, expected)) return true;
      }
      return false;
    };
    const findLocalFunction = function* (
      targetToken: number,
    ): Generator<number, number | undefined, void> {
      for (let index = 0; index < functionCount; index += 1) {
        if (
          (yield* compareTokenSlices(targetToken, functionNameToken(index))) ===
            0
        ) return index;
      }
      return undefined;
    };
    const findImportedTarget = function* (
      targetToken: number,
    ): Generator<number, number | undefined, void> {
      for (let index = 0; index < importCount; index += 1) {
        if (
          (yield* compareTokenSlices(targetToken, importToken(index, 8))) === 0
        ) return index;
      }
      return undefined;
    };
    const isShadowedBinding = function* (
      targetToken: number,
      functionIndex: number,
    ): Generator<number, boolean, void> {
      for (let index = 0; index < tokenCount; index += 1) {
        yield 1;
        if (
          isBinding(index, functionIndex) &&
          (yield* compareTokenSlices(targetToken, index)) === 0
        ) {
          return true;
        }
      }
      return false;
    };
    const appendCall = (
      functionIndex: number,
      targetToken: number,
      targetKind: number,
      importedIndex: number | undefined,
      abiId: number | undefined,
    ): boolean => {
      const recordIndex = totalImportRecords();
      if (
        recordIndex >=
          Math.floor(importEdgeView.byteLength / IMPORT_RECORD_BYTES)
      ) {
        operationalBudgetFailure ??= executableError(
          "finish",
          "budgetExceeded",
          {
            dimension: "importEdges",
            observed: BigInt(recordIndex + 1),
            maximum: required.importEdges,
          },
        );
        return false;
      }
      const functionName = functionNameToken(functionIndex);
      const targetModuleLength = importedIndex === undefined ||
          targetKind === TARGET_ABI
        ? 0
        : tokenSliceByteLength(importToken(importedIndex, 12), 1, 1);
      if (!chargeMany([
        ["importEdges", 1n],
        [
          "outputBytes",
          BigInt(
            tokenTextByteLength(functionName) +
              tokenTextByteLength(targetToken) +
              targetModuleLength,
          ),
        ],
      ])) return false;
      const offset = importRecordOffset(recordIndex);
      importEdgeView.setUint32(offset, IMPORT_CALL, false);
      importEdgeView.setUint32(offset + 16, targetKind, false);
      importEdgeView.setUint32(offset + 20, functionIndex + 1, false);
      importEdgeView.setUint32(offset + 24, targetToken + 1, false);
      importEdgeView.setUint32(
        offset + 28,
        importedIndex === undefined ? 0 : importedIndex + 1,
        false,
      );
      importEdgeView.setUint32(offset + 32, callCount, false);
      importEdgeView.setUint32(
        offset + 36,
        abiId === undefined ? 0 : abiId + 1,
        false,
      );
      if (abiId !== undefined) {
        importEdgeView.setUint32(offset + 44, valueFlowCount, false);
        valueFlowCount += 1;
      }
      callCount += 1;
      return true;
    };

    for (let functionIndex = 0; functionIndex < functionCount; functionIndex += 1) {
      yield 1;
      const functionOffset = functionRecordOffset(functionIndex);
      const bodyStart = functionView.getUint32(functionOffset + 8, false);
      const bodyEnd = functionView.getUint32(functionOffset + 12, false);
      const isAsync = functionView.getUint32(functionOffset + 4, false) === 1;
      for (let index = bodyStart + 1; index < bodyEnd - 1; index += 1) {
        yield 1;
        if (
          (tokenMatches(index, "let") || tokenMatches(index, "const")) &&
          at(index + 1).kind === "identifier"
        ) {
          markBinding(index + 1, functionIndex);
        }
      }
      let tryDepth = 0;
      let containsHostOperationInTry = false;
      for (let index = bodyStart + 1; index < bodyEnd; index += 1) {
        yield 1;
        const token = at(index);
        const next = index + 1 < bodyEnd ? at(index + 1) : undefined;
        if (tokenMatches(index, "try")) tryDepth += 1;
        if (
          tokenMatches(index, "catch") ||
          tokenMatches(index, "finally")
        ) {
          if (containsHostOperationInTry) {
            add("CORE_HOST_FAILURE_OBSERVATION", token);
          }
          if (tokenMatches(index, "finally")) {
            tryDepth = Math.max(0, tryDepth - 1);
          }
        }
        if (
          tokenMatches(index, "new") ||
          tokenMatches(index, "class") ||
          tokenMatches(index, "super")
        ) {
          add("CORE_CONSTRUCTION", token);
        } else if (
          tokenMatches(index, "function") ||
          tokenMatches(index, "=>")
        ) {
          add("CORE_HIGHER_ORDER", token);
        } else if (
          tokenMatches(index, "var") ||
          tokenMatches(index, "with") ||
          tokenMatches(index, "this") ||
          tokenMatches(index, "debugger") ||
          tokenMatches(index, "await") && !isAsync
        ) {
          add("CORE_UNSAFE_COERCION", token);
        } else if (
          tokenMatches(index, "eval") ||
          tokenMatches(index, "Function") ||
          tokenMatches(index, "AsyncFunction") ||
          tokenMatches(index, "GeneratorFunction") ||
          tokenMatches(index, "import") &&
            next !== undefined &&
            tokenIs(next, "(")
        ) {
          add(
            tokenMatches(index, "import")
              ? "CORE_DYNAMIC_IMPORT"
              : "CORE_DYNAMIC_CODE",
            token,
          );
        } else if (
          tokenMatches(index, ".") ||
          tokenMatches(index, "?.") ||
          tokenMatches(index, "[") &&
            index > bodyStart + 1 &&
            (
              at(index - 1).kind === "identifier" ||
              tokenMatches(index - 1, ")") ||
              tokenMatches(index - 1, "]")
            )
        ) {
          add("CORE_COMPUTED_DISPATCH", token);
        } else if (tokenMatches(index, "yield")) {
          add("CORE_HIGHER_ORDER", token);
        } else if (
          tokenMatches(index, "(") &&
          index + 3 < bodyEnd &&
          at(index + 1).kind === "identifier" &&
          tokenMatches(index + 2, ")") &&
          tokenMatches(index + 3, "(")
        ) {
          add("CORE_CALL_TARGET", token);
        } else if (token.kind === "regexp") {
          add("CORE_REGEXP_UNSUPPORTED", token);
        } else if (
          tokenMatches(index, "==") ||
          tokenMatches(index, "!=")
        ) {
          add("CORE_LOOSE_EQUALITY", token);
        } else if (
          tokenMatches(index, "for") &&
          (yield* findBeforeClose(index, bodyEnd, "in"))
        ) {
          add("CORE_UNSAFE_COERCION", token);
        }

        if (
          token.kind === "identifier" &&
          next !== undefined &&
          tokenIs(next, "(")
        ) {
          const localBinding = yield* isShadowedBinding(index, functionIndex);
          const localFunction = yield* findLocalFunction(index);
          const importedTarget = yield* findImportedTarget(index);
          let targetKind: number | undefined;
          let abiId: number | undefined;
          if (localBinding) targetKind = undefined;
          else if (localFunction !== undefined) targetKind = TARGET_LOCAL;
          else if (importedTarget !== undefined) {
            const importOffset = importRecordOffset(importedTarget);
            const importedKind =
              importEdgeView.getUint32(importOffset + 16, false);
            const storedAbi = importEdgeView.getUint32(
              importOffset + 36,
              false,
            );
            abiId = storedAbi === 0 ? undefined : storedAbi - 1;
            targetKind = importedKind === TARGET_PLATFORM &&
                abiId !== undefined
              ? TARGET_ABI
              : importedKind;
          }
          if (targetKind === undefined) {
            add("CORE_CALL_TARGET", token);
          } else if (
            appendCall(
              functionIndex,
              index,
              targetKind,
              importedTarget,
              abiId,
            ) &&
            abiId !== undefined
          ) {
            const abi = DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1[abiId];
            if (abi === undefined) {
              throw new Error("Accepted ABI lookup lost its definition.");
            }
            if (
              !chargeMany([[
                "outputBytes",
                BigInt(
                  tokenTextByteLength(functionNameToken(functionIndex)) +
                    tokenTextByteLength(index) +
                    utf8ByteLength(abi.capability),
                ),
              ]])
            ) continue;
            if (
              tryDepth > 0 &&
              (abi.catchability === "host" ||
                abi.catchability === "mixed")
            ) {
              containsHostOperationInTry = true;
            }
          }
        } else if (token.kind === "identifier") {
          const localFunction = yield* findLocalFunction(index);
          if (
            localFunction !== undefined &&
            (next === undefined || !tokenIs(next, "("))
          ) {
            add("CORE_HIGHER_ORDER", token);
          }
        }
      }
    }

    const recordAtOrder = function* (
      view: DataView,
      count: number,
      width: number,
      orderOffset: number,
      expectedOrder: number,
    ): Generator<number, number, void> {
      for (let index = 0; index < count; index += 1) {
        yield 1;
        if (
          view.getUint32(index * width + orderOffset, false) === expectedOrder
        ) return index;
      }
      throw new Error("Semantic ordering lost a fixed record.");
    };
    const stableOrderRecords = function* (
      view: DataView,
      count: number,
      width: number,
      orderOffset: number,
      compare: (
        leftIndex: number,
        rightIndex: number,
      ) => Generator<number, number, void>,
    ): Generator<number, void, void> {
      const scratchCapacity = Math.floor(graphNodeView.byteLength / 64);
      if (count > scratchCapacity) {
        operationalBudgetFailure ??= executableError(
          "finish",
          "budgetExceeded",
          {
            dimension: "graphNodes",
            observed: BigInt(count),
            maximum: required.graphNodes,
          },
        );
        return;
      }
      const SOURCE_INDEX_OFFSET = 0;
      const TARGET_INDEX_OFFSET = 4;
      for (let index = 0; index < count; index += 1) {
        yield 1;
        graphNodeView.setUint32(index * 64 + SOURCE_INDEX_OFFSET, index, false);
      }
      let sourceOffset = SOURCE_INDEX_OFFSET;
      let targetOffset = TARGET_INDEX_OFFSET;
      for (let runWidth = 1; runWidth < count; runWidth *= 2) {
        for (let start = 0; start < count; start += runWidth * 2) {
          let left = start;
          const leftEnd = Math.min(start + runWidth, count);
          let right = leftEnd;
          const rightEnd = Math.min(start + runWidth * 2, count);
          let target = start;
          while (left < leftEnd || right < rightEnd) {
            let selected: number;
            if (left >= leftEnd) {
              selected = graphNodeView.getUint32(
                right * 64 + sourceOffset,
                false,
              );
              right += 1;
            } else if (right >= rightEnd) {
              selected = graphNodeView.getUint32(
                left * 64 + sourceOffset,
                false,
              );
              left += 1;
            } else {
              const leftIndex = graphNodeView.getUint32(
                left * 64 + sourceOffset,
                false,
              );
              const rightIndex = graphNodeView.getUint32(
                right * 64 + sourceOffset,
                false,
              );
              if ((yield* compare(leftIndex, rightIndex)) <= 0) {
                selected = leftIndex;
                left += 1;
              } else {
                selected = rightIndex;
                right += 1;
              }
            }
            yield 1;
            graphNodeView.setUint32(
              target * 64 + targetOffset,
              selected,
              false,
            );
            target += 1;
          }
        }
        const previousSource = sourceOffset;
        sourceOffset = targetOffset;
        targetOffset = previousSource;
      }
      for (let order = 0; order < count; order += 1) {
        yield 1;
        const recordIndex = graphNodeView.getUint32(
          order * 64 + sourceOffset,
          false,
        );
        view.setUint32(recordIndex * width + orderOffset, order, false);
      }
    };
    yield* stableOrderRecords(
      importEdgeView,
      importCount,
      IMPORT_RECORD_BYTES,
      40,
      function* (left, right) {
        const moduleOrder = yield* compareTokenSlices(
          importToken(left, 12),
          importToken(right, 12),
          1,
          1,
          1,
          1,
        );
        if (moduleOrder !== 0) return moduleOrder;
        const leftStored = importEdgeView.getUint32(
          importRecordOffset(left) + 4,
          false,
        );
        const rightStored = importEdgeView.getUint32(
          importRecordOffset(right) + 4,
          false,
        );
        if (leftStored === 0 && rightStored === 0) return 0;
        if (leftStored === 0) {
          return (yield* compareTokenToAscii(rightStored - 1, "default")) * -1;
        }
        if (rightStored === 0) {
          return yield* compareTokenToAscii(leftStored - 1, "default");
        }
        return yield* compareTokenSlices(leftStored - 1, rightStored - 1);
      },
    );
    yield* stableOrderRecords(
      exportView,
      exportCount,
      EXPORT_RECORD_BYTES,
      12,
      function* (left, right) {
        const leftDefault =
          exportView.getUint32(exportRecordOffset(left) + 8, false) === 1;
        const rightDefault =
          exportView.getUint32(exportRecordOffset(right) + 8, false) === 1;
        if (leftDefault && rightDefault) return 0;
        if (leftDefault) {
          return (yield* compareTokenToAscii(
            exportToken(right, 0),
            "default",
          )) * -1;
        }
        if (rightDefault) {
          return yield* compareTokenToAscii(
            exportToken(left, 0),
            "default",
          );
        }
        return yield* compareTokenSlices(
          exportToken(left, 0),
          exportToken(right, 0),
        );
      },
    );
    yield* stableOrderRecords(
      functionView,
      functionCount,
      FUNCTION_RECORD_BYTES,
      16,
      function* (left, right) {
        return yield* compareTokenSlices(
          functionNameToken(left),
          functionNameToken(right),
        );
      },
    );

    const phaseOrder = (
      diagnosticId: number,
    ): number => {
      const phase = DECLARATIVE_V2_CORE_DIAGNOSTICS_V1.find(
        (candidate) => candidate.id === diagnosticId,
      )?.phase;
      return phase === "source"
        ? 0
        : phase === "lexical"
        ? 1
        : phase === "parse"
        ? 2
        : phase === "valueFlow"
        ? 3
        : phase === "link"
        ? 4
        : phase === "registration"
        ? 5
        : phase === "admission"
        ? 6
        : 7;
    };
    yield* stableOrderRecords(
      diagnosticView,
      diagnosticCount,
      DIAGNOSTIC_RECORD_BYTES,
      16,
      function* (left, right) {
        yield 1;
        const leftOffset = left * DIAGNOSTIC_RECORD_BYTES;
        const rightOffset = right * DIAGNOSTIC_RECORD_BYTES;
        const leftId = diagnosticView.getUint32(leftOffset, false);
        const rightId = diagnosticView.getUint32(rightOffset, false);
        const phase = phaseOrder(leftId) - phaseOrder(rightId);
        if (phase !== 0) return phase;
        const leftByte = diagnosticView.getBigUint64(
          leftOffset + 8,
          false,
        );
        const rightByte = diagnosticView.getBigUint64(
          rightOffset + 8,
          false,
        );
        if (leftByte !== rightByte) return leftByte < rightByte ? -1 : 1;
        return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
      },
    );

    if (operationalBudgetFailure !== undefined) {
      throw operationalBudgetFailure;
    }

    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      if (usage[dimension] > required[dimension]) {
        throw executableError("finish", "budgetExceeded", {
          dimension,
          observed: usage[dimension],
          maximum: required[dimension],
        });
      }
    }
    const ownedSourceSha256 = new Uint8Array(32);
    for (let index = 0; index < 32; index += 1) {
      yield 1;
      ownedSourceSha256[index] = input.sourceSha256[index]!;
    }
    moduleView.setUint32(0, 0, false);
    moduleView.setUint32(4, modulePathByteLength, false);
    moduleView.setBigUint64(8, input.moduleOrdinal, false);
    moduleView.setBigUint64(16, usage.sourceBytes, false);
    moduleView.setUint32(24, importCount, false);
    moduleView.setUint32(28, exportCount, false);
    moduleView.setUint32(32, functionCount, false);
    moduleView.setUint32(36, callCount, false);
    moduleView.setUint32(40, valueFlowCount, false);
    moduleView.setUint32(44, diagnosticCount, false);

    type ArenaEvidenceText =
      | Readonly<{
        readonly kind: "token";
        readonly token: number;
        readonly trimStart: number;
        readonly trimEnd: number;
      }>
      | Readonly<{
        readonly kind: "modulePath";
        readonly offset: number;
        readonly byteLength: number;
      }>;
    const readUtf8Scalar = (
      bytes: Uint8Array,
      start: number,
      byteLength: number,
      cursorState: { byteOffset: number },
    ): number | undefined => {
      if (cursorState.byteOffset >= byteLength) return undefined;
      const absolute = start + cursorState.byteOffset;
      const first = bytes[absolute]!;
      const width = first <= 0x7f
        ? 1
        : first <= 0xdf
        ? 2
        : first <= 0xef
        ? 3
        : 4;
      let codePoint = first &
        (width === 1
          ? 0x7f
          : width === 2
          ? 0x1f
          : width === 3
          ? 0x0f
          : 0x07);
      for (let offset = 1; offset < width; offset += 1) {
        codePoint = (codePoint << 6) | (bytes[absolute + offset]! & 0x3f);
      }
      cursorState.byteOffset += width;
      return codePoint;
    };
    const makeArenaEvidenceTextCursor = (
      text: ArenaEvidenceText,
    ): DeclarativeV2VerificationEvidenceTextCursorV2 => {
      const cursorState = { byteOffset: 0 };
      const byteLength = text.kind === "modulePath"
        ? text.byteLength
        : tokenSliceByteLength(
          text.token,
          text.trimStart,
          text.trimEnd,
        );
      const created = makeDeclarativeV2VerificationEvidenceTextCursorV2(
        byteLength,
        () =>
          text.kind === "modulePath"
            ? readUtf8Scalar(
              outputBytes,
              text.offset,
              text.byteLength,
              cursorState,
            )
            : readUtf8Scalar(
              stringBytes,
              tokenTextOffset(text.token) + text.trimStart,
              byteLength,
              cursorState,
            ),
      );
      if (Result.isFailure(created)) {
        throw new Error("Trusted arena evidence text was not canonical.");
      }
      return created.success;
    };

    type EvidenceCursor =
      | Readonly<{ readonly kind: "module" }>
      | Readonly<{ readonly kind: "call"; readonly recordIndex: number }>
      | Readonly<{ readonly kind: "value"; readonly recordIndex: number }>
      | Readonly<{ readonly kind: "diagnostic"; readonly recordIndex: number }>;
    const makeEvidenceCursor = (
      frame: EvidenceCursor,
    ): DeclarativeV2VerificationEvidenceCursorV2 => {
      let created: Result.Result<
        DeclarativeV2VerificationEvidenceCursorV2,
        DeclarativeV2VerificationEvidenceV2Error
      >;
      if (frame.kind === "module") {
        created = makeDeclarativeV2ModuleSummaryEvidenceCursorV2(
          input.moduleOrdinal,
          makeArenaEvidenceTextCursor({
            kind: "modulePath",
            offset: 0,
            byteLength: modulePathByteLength,
          }),
          ownedSourceSha256,
          usage.sourceBytes,
          BigInt(importCount),
          BigInt(exportCount),
          BigInt(functionCount),
          BigInt(callCount),
          BigInt(valueFlowCount),
        );
      } else if (frame.kind === "call") {
        const offset = importRecordOffset(frame.recordIndex);
        const functionIndex =
          importEdgeView.getUint32(offset + 20, false) - 1;
        const edgeOrdinal = importEdgeView.getUint32(offset + 32, false);
        const targetKind = importEdgeView.getUint32(offset + 16, false);
        const importIndex = importEdgeView.getUint32(offset + 28, false);
        created = makeDeclarativeV2ImportCallEvidenceCursorV2(
          input.moduleOrdinal,
          BigInt(edgeOrdinal),
          makeArenaEvidenceTextCursor({
            kind: "token",
            token: functionNameToken(functionIndex),
            trimStart: 0,
            trimEnd: 0,
          }),
          targetKind === TARGET_LOCAL
            ? "local"
            : targetKind === TARGET_ARTIFACT
            ? "artifactImport"
            : targetKind === TARGET_PLATFORM
            ? "platformImport"
            : "abi",
          targetKind === TARGET_LOCAL ||
              targetKind === TARGET_ABI ||
              importIndex === 0
            ? null
            : makeArenaEvidenceTextCursor({
              kind: "token",
              token: importToken(importIndex - 1, 12),
              trimStart: 1,
              trimEnd: 1,
            }),
          makeArenaEvidenceTextCursor({
            kind: "token",
            token: importToken(frame.recordIndex, 24),
            trimStart: 0,
            trimEnd: 0,
          }),
        );
      } else if (frame.kind === "value") {
        const offset = importRecordOffset(frame.recordIndex);
        const functionIndex =
          importEdgeView.getUint32(offset + 20, false) - 1;
        const abiId = importEdgeView.getUint32(offset + 36, false) - 1;
        const operationOrdinal =
          importEdgeView.getUint32(offset + 44, false);
        const abi = DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1[abiId];
        if (abi === undefined) {
          throw new Error("Semantic ABI record lost its definition.");
        }
        created = makeDeclarativeV2ValueFlowEvidenceCursorV2(
          input.moduleOrdinal,
          makeArenaEvidenceTextCursor({
            kind: "token",
            token: functionNameToken(functionIndex),
            trimStart: 0,
            trimEnd: 0,
          }),
          BigInt(operationOrdinal),
          abi.name,
          abi.capability,
          abi.catchability,
        );
      } else {
        const recordOffset = frame.recordIndex * DIAGNOSTIC_RECORD_BYTES;
        const diagnosticId = diagnosticView.getUint32(recordOffset, false);
        const definition = DECLARATIVE_V2_CORE_DIAGNOSTICS_V1.find(
          (candidate) => candidate.id === diagnosticId,
        );
        if (definition === undefined) {
          throw new Error("Semantic diagnostic record lost its definition.");
        }
        created = makeDeclarativeV2DiagnosticEvidenceCursorV2(
          definition.phase,
          input.moduleOrdinal,
          diagnosticView.getBigUint64(recordOffset + 8, false),
          BigInt(diagnosticId),
          definition.code,
          definition.rule,
        );
      }
      if (Result.isFailure(created)) {
        throw new Error("Trusted arena evidence cursor was rejected.");
      }
      return created.success;
    };

    const frameBytesResult = declarativeV2VerifierRuntimeArenaRegionV1(
      runtimeArena.success,
      "frameBytesStorage",
    );
    if (Result.isFailure(frameBytesResult)) {
      throw new Error("Verifier frame storage could not acquire its arena.");
    }
    const frameBytes = frameBytesResult.success;
    const evidenceIndexCount = valueFlowCount + diagnosticCount;
    const evidenceIndexByteLength = evidenceIndexCount * 4;
    const evidenceFrameCapacity =
      frameBytes.byteLength - evidenceIndexByteLength;
    if (evidenceFrameCapacity < 0) {
      throw executableError("finish", "budgetExceeded", {
        dimension: "frameBytes",
      });
    }
    const evidenceIndexView = new DataView(
      frameBytes.buffer,
      frameBytes.byteOffset + evidenceFrameCapacity,
      evidenceIndexByteLength,
    );
    for (let index = 0; index < evidenceIndexCount; index += 1) {
      yield 1;
      evidenceIndexView.setUint32(index * 4, MAX_U32, false);
    }
    let indexedValueFlows = 0;
    for (let index = 0; index < callCount; index += 1) {
      yield 1;
      const recordIndex = importCount + index;
      const recordOffset = importRecordOffset(recordIndex);
      if (importEdgeView.getUint32(recordOffset + 36, false) === 0) continue;
      const ordinal = importEdgeView.getUint32(recordOffset + 44, false);
      if (
        ordinal >= valueFlowCount ||
        evidenceIndexView.getUint32(ordinal * 4, false) !== MAX_U32
      ) {
        throw new Error("Semantic value-flow ordinal is invalid.");
      }
      evidenceIndexView.setUint32(ordinal * 4, recordIndex, false);
      indexedValueFlows += 1;
    }
    if (indexedValueFlows !== valueFlowCount) {
      throw new Error("Semantic value-flow evidence is incomplete.");
    }
    for (let recordIndex = 0; recordIndex < diagnosticCount; recordIndex += 1) {
      yield 1;
      const order = diagnosticView.getUint32(
        recordIndex * DIAGNOSTIC_RECORD_BYTES + 16,
        false,
      );
      const indexOffset = (valueFlowCount + order) * 4;
      if (
        order >= diagnosticCount ||
        evidenceIndexView.getUint32(indexOffset, false) !== MAX_U32
      ) {
        throw new Error("Semantic diagnostic order is invalid.");
      }
      evidenceIndexView.setUint32(indexOffset, recordIndex, false);
    }
    const valueFlowRecordAt = (ordinal: number): number => {
      const stored = evidenceIndexView.getUint32(ordinal * 4, false);
      if (stored === MAX_U32) {
        throw new Error("Semantic value-flow ordinal is missing.");
      }
      return stored;
    };
    const diagnosticRecordAt = (order: number): number => {
      const stored = evidenceIndexView.getUint32(
        (valueFlowCount + order) * 4,
        false,
      );
      if (stored === MAX_U32) {
        throw new Error("Semantic diagnostic order is missing.");
      }
      return stored;
    };
    const evidenceHash = createDeclarativeV2VerifierRuntimeSha256V1(
      runtimeArena.success,
    );
    if (Result.isFailure(evidenceHash)) {
      throw new Error("Verifier evidence hash could not acquire its arena.");
    }
    const evidenceCount =
      1 + callCount + valueFlowCount + diagnosticCount;
    for (let evidenceIndex = 0; evidenceIndex < evidenceCount; evidenceIndex += 1) {
      let frame: EvidenceCursor;
      if (evidenceIndex === 0) {
        frame = Object.freeze({ kind: "module" });
      } else if (evidenceIndex <= callCount) {
        frame = Object.freeze({
          kind: "call",
          recordIndex: importCount + evidenceIndex - 1,
        });
      } else if (evidenceIndex <= callCount + valueFlowCount) {
          frame = Object.freeze({
            kind: "value",
            recordIndex: valueFlowRecordAt(evidenceIndex - callCount - 1),
          });
      } else {
          frame = Object.freeze({
            kind: "diagnostic",
            recordIndex: diagnosticRecordAt(
              evidenceIndex - callCount - valueFlowCount - 1,
            ),
        });
      }
      const remainingFrameBytes = required.frameBytes - usage.frameBytes;
      const remainingCanonicalBytes =
        required.canonicalBytes - usage.canonicalBytes;
      if (
        remainingFrameBytes < 0n ||
        remainingCanonicalBytes < 0n ||
        remainingFrameBytes > BigInt(MAX_U32) ||
        remainingCanonicalBytes > BigInt(MAX_U32)
      ) {
        throw executableError("finish", "budgetExceeded", {
          dimension: remainingFrameBytes < 0n ||
              remainingFrameBytes > BigInt(MAX_U32)
            ? "frameBytes"
            : "canonicalBytes",
        });
      }
      const controllingCanonicalDimension = remainingFrameBytes <
          remainingCanonicalBytes
        ? "frameBytes"
        : "canonicalBytes";
      const budget = makeDeclarativeV2VerificationEvidenceBudgetV2(
        Number(remainingFrameBytes),
        Number(remainingCanonicalBytes),
      );
      if (Result.isFailure(budget)) {
        throw executableError("finish", "budgetExceeded", {
          dimension: "canonicalBytes",
        });
      }
      const evidenceCursor = makeEvidenceCursor(frame);
      const sink = makeIncrementalCanonicalJsonByteSinkV1((byte, offset) => {
        if (offset >= evidenceFrameCapacity) {
          throw new Error("Verifier frame exceeded its admitted arena.");
        }
        frameBytes[offset] = byte;
      });
      const encoder = createDeclarativeV2VerificationEvidenceSinkEncoderV2(
        evidenceCursor,
        budget.success,
        sink,
      );
      if (Result.isFailure(encoder)) {
        throw new Error("Trusted evidence sink encoder rejected its source.");
      }
      let encodedByteLength: number | undefined;
      let accountedCanonicalBytes = 0n;
      while (encodedByteLength === undefined) {
        yield 1;
        const encoded = encoder.success.step(1);
        if (Result.isFailure(encoded)) {
          if (encoded.failure.reason === "budgetExceeded") {
            throw executableError("finish", "budgetExceeded", {
              dimension: encoded.failure.path === "frameBytes"
                ? "frameBytes"
                : controllingCanonicalDimension,
            });
          }
          throw new Error("Trusted evidence sink encoding failed.");
        }
        const aggregateCanonicalBytes = BigInt(
          encoded.success.mechanical.aggregate.canonicalBytes,
        );
        const deltaCanonicalBytes =
          aggregateCanonicalBytes - accountedCanonicalBytes;
        usage.frameBytes += deltaCanonicalBytes;
        usage.canonicalBytes += deltaCanonicalBytes;
        accountedCanonicalBytes = aggregateCanonicalBytes;
        if (encoded.success.status === "complete") {
          encodedByteLength = encoded.success.canonicalByteLength;
        }
      }
      let hashOffset = 0;
      while (hashOffset < encodedByteLength) {
        yield 1;
        if (!chargeMany([["calls", 1n]])) throw operationalBudgetFailure!;
        const hashed = stepDeclarativeV2VerifierRuntimeSha256V1(
          evidenceHash.success,
          UINT8_ARRAY_SUBARRAY.call(
            frameBytes,
            hashOffset,
            encodedByteLength,
          ) as Uint8Array,
          1,
        );
        if (Result.isFailure(hashed)) {
          throw executableError("finish", "budgetExceeded", {
            dimension: hashed.failure.dimension === "calls"
              ? "calls"
              : "hashBytes",
          });
        }
        hashOffset += Number(hashed.success.receipt.delta.consumedBytes);
        usage.hashBytes += hashed.success.receipt.delta.hashBytes;
      }
    }
    let evidenceDigest: Uint8Array | undefined;
    while (evidenceDigest === undefined) {
      yield 1;
      if (!chargeMany([["calls", 1n]])) throw operationalBudgetFailure!;
      const finished = finishDeclarativeV2VerifierRuntimeSha256V1(
        evidenceHash.success,
        1,
      );
      if (Result.isFailure(finished)) {
        throw new Error("Trusted verifier evidence hash did not settle.");
      }
      if (finished.success.status === "complete") {
        usage.hashBytes = finished.success.receipt.aggregate.hashBytes;
        evidenceDigest = finished.success.digest;
      }
    }
    let evidenceSha256 = "";
    for (let index = 0; index < evidenceDigest.byteLength; index += 1) {
      yield 1;
      const byte = evidenceDigest[index]!;
      evidenceSha256 += "0123456789abcdef"[byte >>> 4]!;
      evidenceSha256 += "0123456789abcdef"[byte & 0x0f]!;
    }
    return Object.freeze({
      runtimeArena: runtimeArena.success,
      tokenView,
      stringBytes,
      outputBytes,
      moduleView,
      importEdgeView,
      exportView,
      functionView,
      diagnosticView,
      sourceSha256: ownedSourceSha256,
      moduleOrdinal: input.moduleOrdinal,
      importCount,
      exportCount,
      functionCount,
      callCount,
      valueFlowCount,
      diagnosticCount,
      evidenceSha256,
      verified: diagnosticCount === 0,
      usage: frozenUsage(usage),
    });
  })();

  const finish = (rawMaximumTransitions: unknown): Result.Result<
    DeclarativeV2VerifierEngineFinishResultV1,
    DeclarativeV2VerifierExecutableV1Error
  > => {
    if (engineState === "complete") {
      return Result.fail(executableError("finish", "alreadyFinished"));
    }
    if (engineState === "failed") {
      return Result.fail(executableError("finish", "closed"));
    }
    const failFinish = (
      error: DeclarativeV2VerifierExecutableV1Error,
    ): Result.Result<
      DeclarativeV2VerifierEngineFinishResultV1,
      DeclarativeV2VerifierExecutableV1Error
    > => {
      engineState = "failed";
      return Result.fail(error);
    };
    const allowance = captureTransitionAllowance(
      rawMaximumTransitions,
      "finish",
    );
    if (Result.isFailure(allowance)) return failFinish(allowance.failure);
    const beforeUsage = usageSnapshot(usage);
    const pendingFinish = (
      state: DeclarativeV2VerifierEngineFinishPendingV1["state"],
      transitionCount: number,
    ): Result.Result<
      DeclarativeV2VerifierEngineFinishResultV1,
      DeclarativeV2VerifierExecutableV1Error
    > => Result.succeed(Object.freeze({
      status: "pending",
      state,
      transitionCount,
      deltaUsage: frozenUsageDelta(usage, beforeUsage),
      usage: frozenUsage(usage),
    }));
    if (usage.calls + 1n > required.calls) {
      return failFinish(executableError("finish", "budgetExceeded", {
        dimension: "calls",
        observed: usage.calls + 1n,
        maximum: required.calls,
      }));
    }
    usage.calls += 1n;
    const enteredFinishingLexer = engineState === "acceptingSource";
    if (enteredFinishingLexer) {
      engineState = "finishingLexer";
    }
    if (allowance.success === 0) {
      if (engineState === "acceptingSource") {
        throw new Error("Finish failed to seal source input.");
      }
      return pendingFinish(engineState, 0);
    }
    if (enteredFinishingLexer) {
      return pendingFinish("finishingLexer", 0);
    }
    if (engineState === "finishingLexer") {
      let transitions = 0;
      if (
        mode === "slash" &&
        pendingSlashScalarByteLength === 0 &&
        !pendingSlashAtEof
      ) {
        pendingSlashAtEof = true;
      }
      while (
        (pendingSlashScalarByteLength > 0 || pendingSlashAtEof) &&
        transitions < allowance.success
      ) {
        const goal = advanceSlashLexicalGoal("finish");
        transitions += 1;
        if (
          goal !== "advanced" &&
          !(pendingSlashAtEof
            ? completeSlashAtEof(goal)
            : completePendingSlashScalar(goal, "finish"))
        ) {
          return failFinish(executableError("finish", "budgetExceeded", {
            dimension: lastExhaustedDimension,
          }));
        }
        if (operationalBudgetFailure !== undefined) {
          return failFinish(operationalBudgetFailure);
        }
      }
      if (pendingSlashScalarByteLength > 0 || pendingSlashAtEof) {
        return pendingFinish("finishingLexer", transitions);
      }
      while (
        (pendingTokenFinalization !== undefined ||
          deferredScalar !== undefined) &&
        transitions < allowance.success
      ) {
        if (pendingTokenFinalization !== undefined) {
          const advanced = advanceTokenFinalization();
          transitions += 1;
          if (!advanced) {
            return failFinish(executableError("finish", "budgetExceeded", {
              dimension: lastExhaustedDimension,
            }));
          }
        } else if (deferredScalar !== undefined) {
          const scalar = deferredScalar;
          deferredScalar = undefined;
          transitions += 1;
          if (!processScalar(scalar.codePoint, scalar.bytes)) {
            return failFinish(executableError("finish", "budgetExceeded", {
              dimension: lastExhaustedDimension,
            }));
          }
        }
        if (operationalBudgetFailure !== undefined) {
          return failFinish(operationalBudgetFailure);
        }
      }
      if (
        pendingTokenFinalization !== undefined ||
        deferredScalar !== undefined
      ) {
        return pendingFinish("finishingLexer", transitions);
      }
      if (transitions >= allowance.success) {
        return pendingFinish("finishingLexer", transitions);
      }
      try {
        const finished = finishLexing();
        transitions += 1;
        if (!finished) {
          return pendingFinish("finishingLexer", transitions);
        }
      } catch (cause) {
        if (cause instanceof DeclarativeV2VerifierExecutableV1Error) {
          return failFinish(cause);
        }
        throw cause;
      }
      if (operationalBudgetFailure !== undefined) {
        return failFinish(operationalBudgetFailure);
      }
      engineState = "parsing";
      return pendingFinish("parsing", transitions);
    }
    if (engineState === "parsing") {
      const transitions = drainCanonicalParser(
        "finish",
        allowance.success,
      );
      if (
        canonicalParserAccepted ||
        canonicalParserRejected ||
        canonicalParserIsCaughtUp() && canonicalParserCursor >= tokenCount
      ) {
        if (!canonicalParserAccepted && !canonicalParserRejected) {
          rejectCanonicalSyntax(tokenAt(tokenCount - 1), "finish");
        }
        engineState = "semanticFlow";
      }
      if (operationalBudgetFailure !== undefined) {
        return failFinish(operationalBudgetFailure);
      }
      return pendingFinish(engineState, transitions);
    }
    if (engineState === "orderingOutput") {
      if (orderedResult === undefined) {
        throw new Error("Ordering state lost its owned verifier result.");
      }
      const settledOwnedResult = Object.freeze({
        ...orderedResult,
        usage: frozenUsage(usage),
      });
      const result = Object.freeze({
        _tag: "DeclarativeV2VerifierModuleResultV1",
        verified: settledOwnedResult.verified,
        moduleOrdinal: settledOwnedResult.moduleOrdinal,
        importCount: BigInt(settledOwnedResult.importCount),
        exportCount: BigInt(settledOwnedResult.exportCount),
        functionCount: BigInt(settledOwnedResult.functionCount),
        callCount: BigInt(settledOwnedResult.callCount),
        valueFlowCount: BigInt(settledOwnedResult.valueFlowCount),
        diagnosticCount: BigInt(settledOwnedResult.diagnosticCount),
        evidenceSha256: settledOwnedResult.evidenceSha256,
        usage: settledOwnedResult.usage,
      } satisfies DeclarativeV2VerifierModuleResultV1);
      OWNED_MODULE_RESULTS.set(result, settledOwnedResult);
      engineState = "complete";
      return Result.succeed(result);
    }
    engineState = "semanticFlow";
    if (semanticIterator === undefined) {
      semanticIterator = createArenaSemanticFlowMachine();
    }
    let semanticTransitions = 0;
    while (
      semanticTransitions < allowance.success
    ) {
      let transition: IteratorResult<
        number,
        DeclarativeV2VerifierOwnedModuleArenaV1
      >;
      try {
        transition = semanticIterator.next();
      } catch (cause) {
        if (cause instanceof DeclarativeV2VerifierExecutableV1Error) {
          return failFinish(cause);
        }
        engineState = "failed";
        throw cause;
      }
      if (transition.done) {
        orderedResult = transition.value;
        engineState = "orderingOutput";
        return pendingFinish("orderingOutput", semanticTransitions);
      }
      semanticTransitions += transition.value;
    }
    return pendingFinish("semanticFlow", semanticTransitions);
  };

  return Result.succeed(Object.freeze({ step, finish }));
}

export const DECLARATIVE_V2_VERIFIER_EXECUTABLE_V1_TEST_ONLY = Object.freeze({
  materializeModuleResult(
    rawResult: unknown,
    maximumIterations: number,
  ): Result.Result<
    DeclarativeV2VerifierModulePresentationV1,
    DeclarativeV2VerifierExecutableV1Error
  > {
    const owned = rawResult !== null && typeof rawResult === "object"
      ? OWNED_MODULE_RESULTS.get(rawResult)
      : undefined;
    if (
      owned === undefined ||
      !Number.isSafeInteger(maximumIterations) ||
      maximumIterations < 1
    ) {
      return Result.fail(executableError("finish", "invalidInput"));
    }
    let remaining = maximumIterations;
    const use = (amount = 1): boolean => {
      if (amount < 0 || remaining < amount) return false;
      remaining -= amount;
      return true;
    };
    const tokenOffset = (index: number): number =>
      owned.tokenView.getUint32(index * 56 + 12, false);
    const tokenLength = (index: number): number =>
      owned.tokenView.getUint32(index * 56 + 16, false);
    const decode = (
      bytes: Uint8Array,
      offset: number,
      byteLength: number,
    ): string | undefined => {
      if (!use(byteLength + 1)) return undefined;
      return decodeValidatedUtf8(
        UINT8_ARRAY_SUBARRAY.call(
          bytes,
          offset,
          offset + byteLength,
        ) as Uint8Array,
      );
    };
    const tokenText = (
      index: number,
      trimStart = 0,
      trimEnd = 0,
    ): string | undefined =>
      decode(
        owned.stringBytes,
        tokenOffset(index) + trimStart,
        tokenLength(index) - trimStart - trimEnd,
      );
    const modulePath = decode(
      owned.outputBytes,
      owned.moduleView.getUint32(0, false),
      owned.moduleView.getUint32(4, false),
    );
    if (modulePath === undefined) {
      return Result.fail(executableError("finish", "invalidInput"));
    }
    const orderedIndexes = (
      view: DataView,
      count: number,
      width: number,
      orderOffset: number,
    ): number[] | undefined => {
      const indexes = new Array<number>(count);
      for (let index = 0; index < count; index += 1) {
        if (!use()) return undefined;
        const order = view.getUint32(index * width + orderOffset, false);
        if (order >= count || indexes[order] !== undefined) return undefined;
        indexes[order] = index;
      }
      return indexes;
    };
    const orderStrings = (values: string[]): void => {
      for (let outer = 1; outer < values.length; outer += 1) {
        let inner = outer;
        while (
          inner > 0 &&
          compareUtf16Strings(values[inner - 1]!, values[inner]!) > 0
        ) {
          const previous = values[inner - 1]!;
          values[inner - 1] = values[inner]!;
          values[inner] = previous;
          inner -= 1;
        }
      }
    };
    const imports: DeclarativeV2VerifierImportSummaryV1[] = [];
    const importIndexes = orderedIndexes(
      owned.importEdgeView,
      owned.importCount,
      64,
      40,
    );
    if (importIndexes === undefined) {
      return Result.fail(executableError("finish", "invalidInput"));
    }
    for (let order = 0; order < owned.importCount; order += 1) {
      const index = importIndexes[order];
      if (index === undefined) {
        return Result.fail(executableError("finish", "invalidInput"));
      }
      const offset = index * 64;
      const importedStored = owned.importEdgeView.getUint32(offset + 4, false);
      const localStored = owned.importEdgeView.getUint32(offset + 8, false);
      const moduleStored = owned.importEdgeView.getUint32(offset + 12, false);
      const importedName = importedStored === 0
        ? "default"
        : tokenText(importedStored - 1);
      const localName = localStored === 0
        ? undefined
        : tokenText(localStored - 1);
      const moduleSpecifier = moduleStored === 0
        ? undefined
        : tokenText(moduleStored - 1, 1, 1);
      if (
        importedName === undefined ||
        localName === undefined ||
        moduleSpecifier === undefined
      ) {
        return Result.fail(executableError("finish", "invalidInput"));
      }
      imports.push(Object.freeze({
        importedName,
        localName,
        moduleSpecifier,
        targetKind:
          owned.importEdgeView.getUint32(offset + 16, false) === 1
            ? "artifactImport"
            : "platformImport",
      }));
    }
    const exports: DeclarativeV2VerifierExportSummaryV1[] = [];
    const exportIndexes = orderedIndexes(
      owned.exportView,
      owned.exportCount,
      48,
      12,
    );
    if (exportIndexes === undefined) {
      return Result.fail(executableError("finish", "invalidInput"));
    }
    for (let order = 0; order < owned.exportCount; order += 1) {
      const index = exportIndexes[order];
      if (index === undefined) {
        return Result.fail(executableError("finish", "invalidInput"));
      }
      const offset = index * 48;
      const isDefault = owned.exportView.getUint32(offset + 8, false) === 1;
      const exportStored = owned.exportView.getUint32(offset, false);
      const localStored = owned.exportView.getUint32(offset + 4, false);
      const exportName = isDefault
        ? "default"
        : exportStored === 0
        ? undefined
        : tokenText(exportStored - 1);
      const localName = localStored === 0
        ? undefined
        : tokenText(localStored - 1);
      if (exportName === undefined || localName === undefined) {
        return Result.fail(executableError("finish", "invalidInput"));
      }
      exports.push(Object.freeze({ exportName, localName, isDefault }));
    }
    const functions: DeclarativeV2VerifierFunctionSummaryV1[] = [];
    const functionIndexes = orderedIndexes(
      owned.functionView,
      owned.functionCount,
      144,
      16,
    );
    if (functionIndexes === undefined) {
      return Result.fail(executableError("finish", "invalidInput"));
    }
    for (let order = 0; order < owned.functionCount; order += 1) {
      const index = functionIndexes[order];
      if (index === undefined) {
        return Result.fail(executableError("finish", "invalidInput"));
      }
      const offset = index * 144;
      const nameStored = owned.functionView.getUint32(offset, false);
      const name = nameStored === 0 ? undefined : tokenText(nameStored - 1);
      if (name === undefined) {
        return Result.fail(executableError("finish", "invalidInput"));
      }
      const calls: string[] = [];
      const capabilities: string[] = [];
      for (let call = 0; call < owned.callCount; call += 1) {
        if (!use()) {
          return Result.fail(executableError("finish", "invalidInput"));
        }
        const callOffset = (owned.importCount + call) * 64;
        if (
          owned.importEdgeView.getUint32(callOffset + 20, false) !== index + 1
        ) continue;
        const targetStored = owned.importEdgeView.getUint32(
          callOffset + 24,
          false,
        );
        const target = targetStored === 0
          ? undefined
          : tokenText(targetStored - 1);
        if (target === undefined) {
          return Result.fail(executableError("finish", "invalidInput"));
        }
        calls.push(target);
        const abiStored = owned.importEdgeView.getUint32(
          callOffset + 36,
          false,
        );
        if (abiStored !== 0) {
          const abi = DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1[abiStored - 1];
          if (abi === undefined) {
            return Result.fail(executableError("finish", "invalidInput"));
          }
          capabilities.push(abi.capability);
        }
      }
      orderStrings(calls);
      orderStrings(capabilities);
      functions.push(Object.freeze({
        name,
        isAsync: owned.functionView.getUint32(offset + 4, false) === 1,
        calls: Object.freeze(calls),
        capabilities: Object.freeze(capabilities),
      }));
    }
    const importCalls: DeclarativeV2ImportCallFrameV2[] = [];
    const valueFlows: DeclarativeV2ValueFlowFrameV2[] = [];
    for (let call = 0; call < owned.callCount; call += 1) {
      if (!use()) {
        return Result.fail(executableError("finish", "invalidInput"));
      }
      const offset = (owned.importCount + call) * 64;
      const functionIndex =
        owned.importEdgeView.getUint32(offset + 20, false) - 1;
      const callerStored = owned.functionView.getUint32(
        functionIndex * 144,
        false,
      );
      const targetStored = owned.importEdgeView.getUint32(offset + 24, false);
      const callerFunction = callerStored === 0
        ? undefined
        : tokenText(callerStored - 1);
      const targetName = targetStored === 0
        ? undefined
        : tokenText(targetStored - 1);
      if (callerFunction === undefined || targetName === undefined) {
        return Result.fail(executableError("finish", "invalidInput"));
      }
      const targetCode = owned.importEdgeView.getUint32(offset + 16, false);
      const importStored = owned.importEdgeView.getUint32(offset + 28, false);
      let targetModulePath: string | null = null;
      if (
        importStored !== 0 &&
        targetCode !== 3 &&
        targetCode !== 4
      ) {
        const moduleStored = owned.importEdgeView.getUint32(
          (importStored - 1) * 64 + 12,
          false,
        );
        targetModulePath = moduleStored === 0
          ? undefined!
          : tokenText(moduleStored - 1, 1, 1)!;
      }
      if (targetModulePath === undefined) {
        return Result.fail(executableError("finish", "invalidInput"));
      }
      importCalls.push(Object.freeze({
        kind: "import_call_v2",
        moduleOrdinal: owned.moduleOrdinal,
        edgeOrdinal: BigInt(
          owned.importEdgeView.getUint32(offset + 32, false),
        ),
        callerFunction,
        targetKind: targetCode === 3
          ? "local"
          : targetCode === 1
          ? "artifactImport"
          : targetCode === 2
          ? "platformImport"
          : "abi",
        targetModulePath,
        targetName,
      }));
      const abiStored = owned.importEdgeView.getUint32(offset + 36, false);
      if (abiStored !== 0) {
        const abi = DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1[abiStored - 1];
        if (abi === undefined) {
          return Result.fail(executableError("finish", "invalidInput"));
        }
        valueFlows.push(Object.freeze({
          kind: "value_flow_v2",
          moduleOrdinal: owned.moduleOrdinal,
          functionName: callerFunction,
          operationOrdinal: BigInt(
            owned.importEdgeView.getUint32(offset + 44, false),
          ),
          operationName: abi.name,
          capability: abi.capability,
          catchability: abi.catchability as "application" | "mixed" | "host",
        }));
      }
    }
    const diagnostics: DeclarativeV2DiagnosticFrameV2[] = [];
    const diagnosticIndexes = orderedIndexes(
      owned.diagnosticView,
      owned.diagnosticCount,
      32,
      16,
    );
    if (diagnosticIndexes === undefined) {
      return Result.fail(executableError("finish", "invalidInput"));
    }
    for (let order = 0; order < owned.diagnosticCount; order += 1) {
      const index = diagnosticIndexes[order];
      if (index === undefined) {
        return Result.fail(executableError("finish", "invalidInput"));
      }
      const offset = index * 32;
      const id = owned.diagnosticView.getUint32(offset, false);
      const definition = DECLARATIVE_V2_CORE_DIAGNOSTICS_V1.find(
        (candidate) => candidate.id === id,
      );
      if (definition === undefined) {
        return Result.fail(executableError("finish", "invalidInput"));
      }
      diagnostics.push(Object.freeze({
        kind: "diagnostic_v2",
        phase: definition.phase as DeclarativeV2DiagnosticFrameV2["phase"],
        moduleOrdinal: owned.moduleOrdinal,
        byteOffset: owned.diagnosticView.getBigUint64(offset + 8, false),
        diagnosticId: BigInt(id),
        code: definition.code,
        message: definition.rule,
      }));
    }
    const moduleSummary = Object.freeze({
      kind: "module_summary_v2",
      moduleOrdinal: owned.moduleOrdinal,
      modulePath,
      sourceSha256: new Uint8Array(owned.sourceSha256),
      sourceByteLength: owned.moduleView.getBigUint64(16, false),
      importCount: BigInt(owned.importCount),
      exportCount: BigInt(owned.exportCount),
      functionCount: BigInt(owned.functionCount),
      callCount: BigInt(owned.callCount),
      valueFlowCount: BigInt(owned.valueFlowCount),
    } satisfies DeclarativeV2ModuleSummaryFrameV2);
    return Result.succeed(Object.freeze({
      verified: owned.verified,
      modulePath,
      moduleOrdinal: owned.moduleOrdinal,
      imports: Object.freeze(imports),
      exports: Object.freeze(exports),
      functions: Object.freeze(functions),
      moduleSummary,
      importCalls: Object.freeze(importCalls),
      valueFlows: Object.freeze(valueFlows),
      diagnostics: Object.freeze(diagnostics),
      evidenceSha256: owned.evidenceSha256,
      usage: owned.usage,
    }));
  },
  materializeLinkResult(
    rawResult: unknown,
    maximumIterations: number,
  ): Result.Result<
    DeclarativeV2VerifierLinkPresentationV1,
    DeclarativeV2VerifierExecutableV1Error
  > {
    const presentation = rawResult !== null && typeof rawResult === "object"
      ? OWNED_LINK_RESULTS.get(rawResult)
      : undefined;
    if (
      presentation === undefined ||
      !Number.isSafeInteger(maximumIterations) ||
      maximumIterations < 1
    ) {
      return Result.fail(executableError("link", "invalidInput"));
    }
    let remaining = maximumIterations;
    const decode = (text: LinkTextRefV1): string | undefined => {
      if (remaining < text.byteLength + 1) return undefined;
      remaining -= text.byteLength + 1;
      return decodeValidatedUtf8(
        UINT8_ARRAY_SUBARRAY.call(
          presentation.state.textBytes,
          text.offset,
          text.offset + text.byteLength,
        ) as Uint8Array,
      );
    };
    const moduleOrder: string[] = [];
    for (let index = 0; index < presentation.state.count; index += 1) {
      const modulePath = decode(linkModuleText(
        presentation.state,
        orderedModule(presentation.state, index),
      ));
      if (modulePath === undefined) {
        return Result.fail(executableError("link", "invalidInput"));
      }
      moduleOrder.push(modulePath);
    }
    const diagnostics: DeclarativeV2DiagnosticFrameV2[] = [];
    for (let order = 0; order < presentation.state.diagnosticCount; order += 1) {
      let found = -1;
      for (
        let index = 0;
        index < presentation.state.diagnosticCount;
        index += 1
      ) {
        if (remaining < 1) {
          return Result.fail(executableError("link", "invalidInput"));
        }
        remaining -= 1;
        if (
          presentation.state.diagnosticView.getUint32(
            index * 32 + 16,
            false,
          ) === order
        ) {
          found = index;
          break;
        }
      }
      if (found < 0) {
        return Result.fail(executableError("link", "invalidInput"));
      }
      const offset = found * 32;
      const id = presentation.state.diagnosticView.getUint32(offset, false);
      const definition = DECLARATIVE_V2_CORE_DIAGNOSTICS_V1.find(
        (candidate) => candidate.id === id,
      );
      if (definition === undefined) {
        return Result.fail(executableError("link", "invalidInput"));
      }
      diagnostics.push(Object.freeze({
        kind: "diagnostic_v2",
        phase: "link",
        moduleOrdinal: presentation.state.diagnosticView.getBigUint64(
          offset + 8,
          false,
        ),
        byteOffset: 0n,
        diagnosticId: BigInt(id),
        code: definition.code,
        message: definition.rule,
      }));
    }
    return Result.succeed(Object.freeze({
      moduleOrder: Object.freeze(moduleOrder),
      diagnostics: Object.freeze(diagnostics),
      usage: frozenUsage(presentation.state.usage),
    }));
  },
});

export interface DeclarativeV2VerifierLinkResultV1 {
  readonly _tag: "DeclarativeV2VerifierLinkResultV1";
  readonly moduleCount: bigint;
  readonly diagnosticCount: bigint;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

interface DeclarativeV2VerifierLinkPresentationV1 {
  readonly moduleOrder: ReadonlyArray<string>;
  readonly diagnostics: ReadonlyArray<DeclarativeV2DiagnosticFrameV2>;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

export interface DeclarativeV2VerifierLinkerV1 {
  readonly _tag: "DeclarativeV2VerifierLinkerV1";
}

export interface DeclarativeV2VerifierLinkPendingV1 {
  readonly status: "pending";
  readonly transitionCount: number;
  readonly deltaUsage: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

export type DeclarativeV2VerifierLinkStepV1 =
  | DeclarativeV2VerifierLinkPendingV1
  | DeclarativeV2VerifierLinkResultV1;

interface LinkerStateV1 {
  readonly required: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: ReturnType<typeof zeroUsage>;
  readonly runtimeArena: DeclarativeV2VerifierRuntimeArenaHandleV1;
  readonly graph: DataView;
  readonly frontier: DataView;
  readonly moduleView: DataView;
  readonly importEdgeView: DataView;
  readonly exportView: DataView;
  readonly diagnosticView: DataView;
  readonly textBytes: Uint8Array;
  pendingModule: DeclarativeV2VerifierOwnedModuleArenaV1 | undefined;
  count: number;
  importCount: number;
  exportCount: number;
  diagnosticCount: number;
  textCursor: number;
  sealed: boolean;
  phase:
    | "accepting"
    | "copyingModule"
    | "indexing"
    | "ordering"
    | "checkingDuplicates"
    | "linking"
    | "orderingDiagnostics"
    | "complete"
    | "failed";
  indexModule: number;
  indexCodeUnit: number;
  indexPreviousHighSurrogate: boolean;
  copyPhase:
    | "modulePath"
    | "findImport"
    | "importedName"
    | "moduleSpecifier"
    | "findExport"
    | "exportName"
    | "complete";
  copySourceRecord: number;
  copyRecordOrder: number;
  copyByteIndex: number;
  copyImportStart: number;
  copyExportStart: number;
  orderOuter: number;
  orderInner: number;
  orderCompareCursor: number;
  orderCompareRightCursor: number;
  duplicatePosition: number;
  duplicateCompareCursor: number;
  duplicateCompareRightCursor: number;
  rootPosition: number;
  stackDepth: number;
  searchCandidate: number;
  pathCompareCursor: number;
  exportIndex: number;
  exportCompareCursor: number;
  exportCompareRightCursor: number;
  pendingTargetPosition: number;
  linkPhase:
    | "selectRoot"
    | "selectImport"
    | "compareTargetPath"
    | "compareExport"
    | "applyTarget";
  diagnosticOuter: number;
  diagnosticInner: number;
  diagnosticSearchCursor: number;
  diagnosticLeftRecord: number;
  diagnosticRightRecord: number;
  compareLeftPendingLow: number;
  compareRightPendingLow: number;
}

interface LinkResultPresentationV1 {
  readonly state: LinkerStateV1;
}

const OWNED_LINKERS = new WeakMap<object, LinkerStateV1>();
const OWNED_LINK_RESULTS = new WeakMap<object, LinkResultPresentationV1>();

const linkerHandle = (): DeclarativeV2VerifierLinkerV1 =>
  Object.freeze({
    _tag: "DeclarativeV2VerifierLinkerV1",
  });

const linkUsageCharge = (
  state: LinkerStateV1,
  dimension: typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
  amount: bigint,
): Result.Result<void, DeclarativeV2VerifierExecutableV1Error> => {
  const observed = state.usage[dimension] + amount;
  if (observed > state.required[dimension]) {
    return Result.fail(executableError("link", "budgetExceeded", {
      dimension,
      observed,
      maximum: state.required[dimension],
    }));
  }
  state.usage[dimension] = observed;
  return Result.succeed(undefined);
};

const linkerState = (
  rawLinker: unknown,
): Result.Result<LinkerStateV1, DeclarativeV2VerifierExecutableV1Error> => {
  const state = rawLinker !== null && typeof rawLinker === "object"
    ? OWNED_LINKERS.get(rawLinker)
    : undefined;
  return state === undefined
    ? Result.fail(executableError("link", "invalidInput"))
    : state.phase === "failed" || state.phase === "complete"
    ? Result.fail(executableError("link", "closed"))
    : Result.succeed(state);
};

export function createDeclarativeV2VerifierLinkerV1(
  maximums: DeclarativeV2VerifierBudgetFrameV2,
  requiredInput: DeclarativeV2VerifierBudgetFrameV2,
): Result.Result<
  DeclarativeV2VerifierLinkerV1,
  DeclarativeV2VerifierExecutableV1Error
> {
  const plan = planDeclarativeV2VerifierArenaV1({
    maximums,
    required: requiredInput,
  });
  if (Result.isFailure(plan)) {
    return Result.fail(executableError(
      "link",
      plan.failure.reason === "addressabilityExceeded" ||
          plan.failure.reason === "overflow"
        ? "addressabilityExceeded"
        : plan.failure.reason === "budgetExceeded"
        ? "budgetExceeded"
        : "invalidBudget",
      {
        ...(plan.failure.path === undefined
          ? {}
          : { dimension: plan.failure.path }),
        ...(plan.failure.observed === undefined
          ? {}
          : { observed: plan.failure.observed }),
        ...(plan.failure.maximum === undefined
          ? {}
          : { maximum: plan.failure.maximum }),
      },
    ));
  }
  const required = plan.success.usage;
  if (
    required.calls < 1n ||
    required.modules > BigInt(MAX_U32) ||
    required.frontierEntries > BigInt(MAX_U32)
  ) {
    return Result.fail(executableError(
      "link",
      required.calls < 1n ? "budgetExceeded" : "addressabilityExceeded",
      required.calls < 1n
        ? {
          dimension: "calls",
          observed: 1n,
          maximum: required.calls,
        }
        : undefined,
    ));
  }
  const arena = createDeclarativeV2VerifierRuntimeArenaV1(
    plan.success,
  );
  if (Result.isFailure(arena)) {
    return Result.fail(executableError(
      "link",
      arena.failure.reason === "addressabilityExceeded"
        ? "addressabilityExceeded"
        : "invalidState",
    ));
  }
  const graph = declarativeV2VerifierRuntimeArenaRegionV1(
    arena.success,
    "graphNodeRecord",
  );
  const frontier = declarativeV2VerifierRuntimeArenaRegionV1(
    arena.success,
    "frontierRecord",
  );
  const modules = declarativeV2VerifierRuntimeArenaRegionV1(
    arena.success,
    "moduleRecord",
  );
  const imports = declarativeV2VerifierRuntimeArenaRegionV1(
    arena.success,
    "importEdgeRecord",
  );
  const exports = declarativeV2VerifierRuntimeArenaRegionV1(
    arena.success,
    "exportRecord",
  );
  const diagnostics = declarativeV2VerifierRuntimeArenaRegionV1(
    arena.success,
    "diagnosticBytesStorage",
  );
  const text = declarativeV2VerifierRuntimeArenaRegionV1(
    arena.success,
    "outputBytesStorage",
  );
  if (
    Result.isFailure(graph) ||
    Result.isFailure(frontier) ||
    Result.isFailure(modules) ||
    Result.isFailure(imports) ||
    Result.isFailure(exports) ||
    Result.isFailure(diagnostics) ||
    Result.isFailure(text)
  ) {
    throw new Error("Accepted verifier arena lost linker regions.");
  }
  const usage = zeroUsage();
  usage.calls = 1n;
  const state: LinkerStateV1 = {
    required,
    usage,
    runtimeArena: arena.success,
    graph: new DataView(
      graph.success.buffer,
      graph.success.byteOffset,
      graph.success.byteLength,
    ),
    frontier: new DataView(
      frontier.success.buffer,
      frontier.success.byteOffset,
      frontier.success.byteLength,
    ),
    moduleView: new DataView(
      modules.success.buffer,
      modules.success.byteOffset,
      modules.success.byteLength,
    ),
    importEdgeView: new DataView(
      imports.success.buffer,
      imports.success.byteOffset,
      imports.success.byteLength,
    ),
    exportView: new DataView(
      exports.success.buffer,
      exports.success.byteOffset,
      exports.success.byteLength,
    ),
    diagnosticView: new DataView(
      diagnostics.success.buffer,
      diagnostics.success.byteOffset,
      diagnostics.success.byteLength,
    ),
    textBytes: text.success,
    pendingModule: undefined,
    count: 0,
    importCount: 0,
    exportCount: 0,
    diagnosticCount: 0,
    textCursor: 0,
    sealed: false,
    phase: "accepting",
    indexModule: 0,
    indexCodeUnit: 0,
    indexPreviousHighSurrogate: false,
    copyPhase: "modulePath",
    copySourceRecord: 0,
    copyRecordOrder: 0,
    copyByteIndex: 0,
    copyImportStart: 0,
    copyExportStart: 0,
    orderOuter: 1,
    orderInner: 1,
    orderCompareCursor: 0,
    orderCompareRightCursor: 0,
    duplicatePosition: 1,
    duplicateCompareCursor: 0,
    duplicateCompareRightCursor: 0,
    rootPosition: 0,
    stackDepth: 0,
    searchCandidate: 0,
    pathCompareCursor: 0,
    exportIndex: 0,
    exportCompareCursor: 0,
    exportCompareRightCursor: 0,
    pendingTargetPosition: -1,
    linkPhase: "selectRoot",
    diagnosticOuter: 1,
    diagnosticInner: 1,
    diagnosticSearchCursor: 0,
    diagnosticLeftRecord: -1,
    diagnosticRightRecord: -1,
    compareLeftPendingLow: 0,
    compareRightPendingLow: 0,
  };
  const handle = linkerHandle();
  OWNED_LINKERS.set(handle, state);
  return Result.succeed(handle);
}

export function appendDeclarativeV2VerifierLinkerModuleV1(
  rawLinker: unknown,
  rawModule: unknown,
): Result.Result<void, DeclarativeV2VerifierExecutableV1Error> {
  const captured = linkerState(rawLinker);
  if (Result.isFailure(captured)) return Result.fail(captured.failure);
  const state = captured.success;
  if (state.sealed) {
    state.phase = "failed";
    return Result.fail(executableError("link", "closed"));
  }
  if (state.pendingModule !== undefined) {
    return Result.fail(executableError("link", "invalidState"));
  }
  if (state.phase !== "accepting") {
    state.phase = "failed";
    return Result.fail(executableError("link", "closed"));
  }
  const owned = rawModule !== null && typeof rawModule === "object"
    ? OWNED_MODULE_RESULTS.get(rawModule)
    : undefined;
  if (owned === undefined) {
    state.phase = "failed";
    return Result.fail(executableError("link", "invalidInput"));
  }
  const charges = [
    ["calls", 1n],
    ["modules", 1n],
    ["graphNodes", 1n + BigInt(owned.importCount)],
    ["importEdges", BigInt(owned.importCount)],
    ["exports", BigInt(owned.exportCount)],
  ] as const;
  for (const [dimension, amount] of charges) {
    const charged = linkUsageCharge(state, dimension, amount);
    if (Result.isFailure(charged)) {
      state.phase = "failed";
      return Result.fail(charged.failure);
    }
  }
  if (BigInt(state.count) >= state.required.modules) {
    state.phase = "failed";
    return Result.fail(executableError("link", "budgetExceeded", {
      dimension: "modules",
      observed: BigInt(state.count + 1),
      maximum: state.required.modules,
    }));
  }
  if (
    state.count >= Math.floor(state.moduleView.byteLength / 64) ||
    state.importCount + owned.importCount >
      Math.floor(state.importEdgeView.byteLength / 64) ||
    state.exportCount + owned.exportCount >
      Math.floor(state.exportView.byteLength / 48)
  ) {
    state.phase = "failed";
    return Result.fail(executableError("link", "addressabilityExceeded", {
      dimension: "modules",
      observed: BigInt(state.count + 1),
      maximum: state.required.modules,
    }));
  }
  state.pendingModule = owned;
  state.phase = "copyingModule";
  state.copyPhase = "modulePath";
  state.copySourceRecord = 0;
  state.copyRecordOrder = 0;
  state.copyByteIndex = 0;
  state.copyImportStart = state.importCount;
  state.copyExportStart = state.exportCount;
  const moduleOffset = state.count * 64;
  state.moduleView.setUint32(moduleOffset, state.textCursor, false);
  state.moduleView.setUint32(moduleOffset + 4, 0, false);
  state.moduleView.setBigUint64(
    moduleOffset + 8,
    owned.moduleOrdinal,
    false,
  );
  state.moduleView.setUint32(moduleOffset + 16, state.importCount, false);
  state.moduleView.setUint32(moduleOffset + 20, owned.importCount, false);
  state.moduleView.setUint32(moduleOffset + 24, state.exportCount, false);
  state.moduleView.setUint32(moduleOffset + 28, owned.exportCount, false);
  state.graph.setUint32(state.count * 64, state.count, false);
  return Result.succeed(undefined);
}

const orderedModule = (
  state: LinkerStateV1,
  position: number,
): number => state.graph.getUint32(position * 64, false);

interface LinkTextRefV1 {
  readonly offset: number;
  readonly byteLength: number;
}

const linkModuleText = (
  state: LinkerStateV1,
  moduleIndex: number,
): LinkTextRefV1 => ({
  offset: state.moduleView.getUint32(moduleIndex * 64, false),
  byteLength: state.moduleView.getUint32(moduleIndex * 64 + 4, false),
});

const readLinkCodeUnit = (
  state: LinkerStateV1,
  text: LinkTextRefV1,
  cursor: number,
  pending: "left" | "right",
): number | undefined => {
  const pendingValue = pending === "left"
    ? state.compareLeftPendingLow
    : state.compareRightPendingLow;
  if (pendingValue !== 0) {
    if (pending === "left") state.compareLeftPendingLow = 0;
    else state.compareRightPendingLow = 0;
    return pendingValue;
  }
  if (cursor >= text.byteLength) return undefined;
  const first = state.textBytes[text.offset + cursor]!;
  if (first <= 0x7f) return first;
  const width = first <= 0xdf ? 2 : first <= 0xef ? 3 : 4;
  let codePoint = first &
    (width === 2 ? 0x1f : width === 3 ? 0x0f : 0x07);
  for (let index = 1; index < width; index += 1) {
    codePoint = (codePoint << 6) |
      (state.textBytes[text.offset + cursor + index]! & 0x3f);
  }
  if (codePoint <= 0xffff) return codePoint;
  const adjusted = codePoint - 0x1_0000;
  const low = 0xdc00 | (adjusted & 0x3ff);
  if (pending === "left") state.compareLeftPendingLow = low;
  else state.compareRightPendingLow = low;
  return 0xd800 | (adjusted >>> 10);
};

const linkUtf8Width = (byte: number): number =>
  byte <= 0x7f ? 1 : byte <= 0xdf ? 2 : byte <= 0xef ? 3 : 4;

const compareCodeUnitStep = (
  state: LinkerStateV1,
  left: LinkTextRefV1,
  right: LinkTextRefV1,
  leftCursor: number,
  rightCursor: number,
): Readonly<{
  readonly done: false;
  readonly leftAdvance: number;
  readonly rightAdvance: number;
}> | Readonly<{
  readonly done: true;
  readonly order: -1 | 0 | 1;
}> => {
  const leftAdvance = state.compareLeftPendingLow !== 0
    ? 0
    : leftCursor < left.byteLength
    ? linkUtf8Width(state.textBytes[left.offset + leftCursor]!)
    : 0;
  const rightAdvance = state.compareRightPendingLow !== 0
    ? 0
    : rightCursor < right.byteLength
    ? linkUtf8Width(state.textBytes[right.offset + rightCursor]!)
    : 0;
  const leftCode = readLinkCodeUnit(state, left, leftCursor, "left");
  const rightCode = readLinkCodeUnit(state, right, rightCursor, "right");
  if (leftCode !== undefined && rightCode !== undefined) {
    return leftCode === rightCode
      ? Object.freeze({ done: false, leftAdvance, rightAdvance })
      : Object.freeze({
        done: true,
        order: leftCode < rightCode ? -1 : 1,
      });
  }
  return Object.freeze({
    done: true,
    order: leftCode === rightCode ? 0 : leftCode === undefined ? -1 : 1,
  });
};

const addLinkDiagnosticV1 = (
  state: LinkerStateV1,
  code: "CORE_IMPORT_TARGET" | "CORE_MODULE_CYCLE",
  moduleOrdinal: bigint,
): Result.Result<void, DeclarativeV2VerifierExecutableV1Error> => {
  const definition = diagnosticDefinition(code);
  const bytes = BigInt(
    utf8ByteLength(definition.code) + utf8ByteLength(definition.rule),
  );
  const diagnosticCharge = linkUsageCharge(
    state,
    "diagnosticBytes",
    bytes,
  );
  if (Result.isFailure(diagnosticCharge)) return diagnosticCharge;
  const outputCharge = linkUsageCharge(state, "outputBytes", bytes);
  if (Result.isFailure(outputCharge)) return outputCharge;
  const offset = state.diagnosticCount * 32;
  if (offset + 32 > state.diagnosticView.byteLength) {
    return Result.fail(executableError("link", "addressabilityExceeded", {
      dimension: "diagnosticBytes",
      observed: state.usage.diagnosticBytes,
      maximum: state.required.diagnosticBytes,
    }));
  }
  state.diagnosticView.setUint32(offset, definition.id, false);
  state.diagnosticView.setBigUint64(offset + 8, moduleOrdinal, false);
  state.diagnosticView.setUint32(offset + 16, state.diagnosticCount, false);
  state.diagnosticCount += 1;
  return Result.succeed(undefined);
};

const resolvedPathCodeUnit = (
  importerPath: string,
  directoryLength: number,
  moduleSpecifier: string,
  cursor: number,
): number | undefined =>
  cursor < directoryLength
    ? importerPath.charCodeAt(cursor)
    : cursor - directoryLength + 2 < moduleSpecifier.length
    ? moduleSpecifier.charCodeAt(cursor - directoryLength + 2)
    : undefined;

const appendLinkTextByte = (
  state: LinkerStateV1,
  byte: number,
): Result.Result<void, DeclarativeV2VerifierExecutableV1Error> => {
  const charged = linkUsageCharge(state, "outputBytes", 1n);
  if (Result.isFailure(charged)) return charged;
  if (state.textCursor >= state.textBytes.byteLength) {
    return Result.fail(executableError("link", "addressabilityExceeded", {
      dimension: "outputBytes",
      observed: BigInt(state.textCursor + 1),
      maximum: state.required.outputBytes,
    }));
  }
  state.textBytes[state.textCursor] = byte;
  state.textCursor += 1;
  return Result.succeed(undefined);
};

const sourceTokenByte = (
  module: DeclarativeV2VerifierOwnedModuleArenaV1,
  tokenIndex: number,
  byteIndex: number,
): number | undefined => {
  const offset = module.tokenView.getUint32(tokenIndex * 56 + 12, false);
  const length = module.tokenView.getUint32(tokenIndex * 56 + 16, false);
  return byteIndex < 0 || byteIndex >= length
    ? undefined
    : module.stringBytes[offset + byteIndex];
};

const sourceTokenLength = (
  module: DeclarativeV2VerifierOwnedModuleArenaV1,
  tokenIndex: number,
): number => module.tokenView.getUint32(tokenIndex * 56 + 16, false);

const advanceLinkerOne = (
  state: LinkerStateV1,
): Result.Result<void, DeclarativeV2VerifierExecutableV1Error> => {
  if (state.phase === "copyingModule") {
    const source = state.pendingModule;
    if (source === undefined) {
      return Result.fail(executableError("link", "invalidState"));
    }
    const moduleOffset = state.count * 64;
    if (state.copyPhase === "modulePath") {
      const sourceOffset = source.moduleView.getUint32(0, false);
      const sourceLength = source.moduleView.getUint32(4, false);
      if (state.copyByteIndex < sourceLength) {
        const copied = appendLinkTextByte(
          state,
          source.outputBytes[sourceOffset + state.copyByteIndex]!,
        );
        if (Result.isFailure(copied)) return copied;
        state.copyByteIndex += 1;
        return Result.succeed(undefined);
      }
      state.moduleView.setUint32(
        moduleOffset + 4,
        state.copyByteIndex,
        false,
      );
      state.copyByteIndex = 0;
      state.copyRecordOrder = 0;
      state.copySourceRecord = 0;
      state.copyPhase = "findImport";
      return Result.succeed(undefined);
    }
    if (state.copyPhase === "findImport") {
      if (state.copyRecordOrder >= source.importCount) {
        state.copyRecordOrder = 0;
        state.copySourceRecord = 0;
        state.copyPhase = "findExport";
        return Result.succeed(undefined);
      }
      if (state.copySourceRecord >= source.importCount) {
        return Result.fail(executableError("link", "invalidState"));
      }
      const sourceOffset = state.copySourceRecord * 64;
      if (
        source.importEdgeView.getUint32(sourceOffset + 40, false) !==
          state.copyRecordOrder
      ) {
        state.copySourceRecord += 1;
        return Result.succeed(undefined);
      }
      const destination = state.importCount * 64;
      state.importEdgeView.setUint32(destination, state.textCursor, false);
      state.importEdgeView.setUint32(
        destination + 16,
        source.importEdgeView.getUint32(sourceOffset + 16, false),
        false,
      );
      state.copyByteIndex = 0;
      state.copyPhase = "importedName";
      return Result.succeed(undefined);
    }
    if (state.copyPhase === "importedName") {
      const sourceOffset = state.copySourceRecord * 64;
      const stored = source.importEdgeView.getUint32(sourceOffset + 4, false);
      const length = stored === 0
        ? 7
        : sourceTokenLength(source, stored - 1);
      if (state.copyByteIndex < length) {
        const byte = stored === 0
          ? "default".charCodeAt(state.copyByteIndex)
          : sourceTokenByte(source, stored - 1, state.copyByteIndex)!;
        const copied = appendLinkTextByte(state, byte);
        if (Result.isFailure(copied)) return copied;
        state.copyByteIndex += 1;
        return Result.succeed(undefined);
      }
      const destination = state.importCount * 64;
      state.importEdgeView.setUint32(
        destination + 4,
        state.copyByteIndex,
        false,
      );
      state.importEdgeView.setUint32(destination + 8, state.textCursor, false);
      state.copyByteIndex = 0;
      state.copyPhase = "moduleSpecifier";
      return Result.succeed(undefined);
    }
    if (state.copyPhase === "moduleSpecifier") {
      const sourceOffset = state.copySourceRecord * 64;
      const stored = source.importEdgeView.getUint32(sourceOffset + 12, false);
      if (stored === 0) {
        return Result.fail(executableError("link", "invalidState"));
      }
      const length = sourceTokenLength(source, stored - 1) - 2;
      if (state.copyByteIndex < length) {
        const copied = appendLinkTextByte(
          state,
          sourceTokenByte(source, stored - 1, state.copyByteIndex + 1)!,
        );
        if (Result.isFailure(copied)) return copied;
        state.copyByteIndex += 1;
        return Result.succeed(undefined);
      }
      const destination = state.importCount * 64;
      state.importEdgeView.setUint32(
        destination + 12,
        state.copyByteIndex,
        false,
      );
      state.importCount += 1;
      state.copyRecordOrder += 1;
      state.copySourceRecord = 0;
      state.copyByteIndex = 0;
      state.copyPhase = "findImport";
      return Result.succeed(undefined);
    }
    if (state.copyPhase === "findExport") {
      if (state.copyRecordOrder >= source.exportCount) {
        state.copyPhase = "complete";
        return Result.succeed(undefined);
      }
      if (state.copySourceRecord >= source.exportCount) {
        return Result.fail(executableError("link", "invalidState"));
      }
      const sourceOffset = state.copySourceRecord * 48;
      if (
        source.exportView.getUint32(sourceOffset + 12, false) !==
          state.copyRecordOrder
      ) {
        state.copySourceRecord += 1;
        return Result.succeed(undefined);
      }
      const destination = state.exportCount * 48;
      state.exportView.setUint32(destination, state.textCursor, false);
      state.copyByteIndex = 0;
      state.copyPhase = "exportName";
      return Result.succeed(undefined);
    }
    if (state.copyPhase === "exportName") {
      const sourceOffset = state.copySourceRecord * 48;
      const isDefault =
        source.exportView.getUint32(sourceOffset + 8, false) === 1;
      const stored = source.exportView.getUint32(sourceOffset, false);
      const length = isDefault
        ? 7
        : stored === 0
        ? 0
        : sourceTokenLength(source, stored - 1);
      if (length === 0) {
        return Result.fail(executableError("link", "invalidState"));
      }
      if (state.copyByteIndex < length) {
        const byte = isDefault
          ? "default".charCodeAt(state.copyByteIndex)
          : sourceTokenByte(source, stored - 1, state.copyByteIndex)!;
        const copied = appendLinkTextByte(state, byte);
        if (Result.isFailure(copied)) return copied;
        state.copyByteIndex += 1;
        return Result.succeed(undefined);
      }
      const destination = state.exportCount * 48;
      state.exportView.setUint32(
        destination + 4,
        state.copyByteIndex,
        false,
      );
      state.exportCount += 1;
      state.copyRecordOrder += 1;
      state.copySourceRecord = 0;
      state.copyByteIndex = 0;
      state.copyPhase = "findExport";
      return Result.succeed(undefined);
    }
    state.pendingModule = undefined;
    state.count += 1;
    state.phase = state.sealed ? "indexing" : "accepting";
    state.copyPhase = "modulePath";
    return Result.succeed(undefined);
  }
  if (state.phase === "indexing") {
    if (state.indexModule >= state.count) {
      state.phase = "ordering";
      return Result.succeed(undefined);
    }
    const module = linkModuleText(state, state.indexModule);
    if (state.indexCodeUnit >= module.byteLength) {
      state.indexModule += 1;
      state.indexCodeUnit = 0;
      state.indexPreviousHighSurrogate = false;
      return Result.succeed(undefined);
    }
    const code = state.textBytes[module.offset + state.indexCodeUnit]!;
    if (code === 0x2f) {
      state.graph.setUint32(
        state.indexModule * 64 + 8,
        state.indexCodeUnit + 1,
        false,
      );
    }
    state.indexCodeUnit += 1;
    return Result.succeed(undefined);
  }
  if (state.phase === "ordering") {
    if (state.count < 2 || state.orderOuter >= state.count) {
      state.phase = "checkingDuplicates";
      return Result.succeed(undefined);
    }
    const left = linkModuleText(
      state,
      orderedModule(state, state.orderInner - 1),
    );
    const right = linkModuleText(
      state,
      orderedModule(state, state.orderInner),
    );
    const compared = compareCodeUnitStep(
      state,
      left,
      right,
      state.orderCompareCursor,
      state.orderCompareRightCursor,
    );
    if (!compared.done) {
      state.orderCompareCursor += compared.leftAdvance;
      state.orderCompareRightCursor += compared.rightAdvance;
      return Result.succeed(undefined);
    }
    state.orderCompareCursor = 0;
    state.orderCompareRightCursor = 0;
    state.compareLeftPendingLow = 0;
    state.compareRightPendingLow = 0;
    if (compared.order > 0) {
      const leftOffset = (state.orderInner - 1) * 64;
      const rightOffset = state.orderInner * 64;
      const prior = state.graph.getUint32(leftOffset, false);
      state.graph.setUint32(
        leftOffset,
        state.graph.getUint32(rightOffset, false),
        false,
      );
      state.graph.setUint32(rightOffset, prior, false);
    }
    if (compared.order > 0 && state.orderInner > 1) state.orderInner -= 1;
    else {
      state.orderOuter += 1;
      state.orderInner = state.orderOuter;
    }
    return Result.succeed(undefined);
  }
  if (state.phase === "checkingDuplicates") {
    if (state.duplicatePosition >= state.count) {
      state.phase = "linking";
      return Result.succeed(undefined);
    }
    const left = linkModuleText(
      state,
      orderedModule(state, state.duplicatePosition - 1),
    );
    const right = linkModuleText(
      state,
      orderedModule(state, state.duplicatePosition),
    );
    const compared = compareCodeUnitStep(
      state,
      left,
      right,
      state.duplicateCompareCursor,
      state.duplicateCompareRightCursor,
    );
    if (!compared.done) {
      state.duplicateCompareCursor += compared.leftAdvance;
      state.duplicateCompareRightCursor += compared.rightAdvance;
      return Result.succeed(undefined);
    }
    state.duplicateCompareCursor = 0;
    state.duplicateCompareRightCursor = 0;
    state.compareLeftPendingLow = 0;
    state.compareRightPendingLow = 0;
    if (compared.order === 0) {
      return Result.fail(executableError("link", "invalidInput"));
    }
    state.duplicatePosition += 1;
    return Result.succeed(undefined);
  }
  if (state.phase === "linking") {
    if (state.linkPhase === "selectRoot") {
      if (state.rootPosition >= state.count) {
        state.phase = "orderingDiagnostics";
        return Result.succeed(undefined);
      }
      if (
        state.graph.getUint32(state.rootPosition * 64 + 12, false) !== 0
      ) {
        state.rootPosition += 1;
        return Result.succeed(undefined);
      }
      const frontierCharge = linkUsageCharge(
        state,
        "frontierEntries",
        1n,
      );
      if (Result.isFailure(frontierCharge)) return frontierCharge;
      state.frontier.setUint32(0, state.rootPosition, false);
      state.frontier.setUint32(4, 0, false);
      state.stackDepth = 1;
      state.graph.setUint32(state.rootPosition * 64 + 12, 1, false);
      state.linkPhase = "selectImport";
      return Result.succeed(undefined);
    }
    if (state.linkPhase === "selectImport") {
      if (state.stackDepth === 0) {
        state.rootPosition += 1;
        state.linkPhase = "selectRoot";
        return Result.succeed(undefined);
      }
      const frame = (state.stackDepth - 1) * 32;
      const position = state.frontier.getUint32(frame, false);
      const importIndex = state.frontier.getUint32(frame + 4, false);
      const moduleIndex = orderedModule(state, position);
      const moduleOffset = moduleIndex * 64;
      const importStart = state.moduleView.getUint32(
        moduleOffset + 16,
        false,
      );
      const importCount = state.moduleView.getUint32(
        moduleOffset + 20,
        false,
      );
      if (importIndex >= importCount) {
        state.graph.setUint32(position * 64 + 12, 2, false);
        state.stackDepth -= 1;
        return Result.succeed(undefined);
      }
      state.frontier.setUint32(frame + 4, importIndex + 1, false);
      const importedOffset = (importStart + importIndex) * 64;
      if (state.importEdgeView.getUint32(importedOffset + 16, false) !== 1) {
        return Result.succeed(undefined);
      }
      state.searchCandidate = 0;
      state.pathCompareCursor = 0;
      state.pendingTargetPosition = -1;
      state.linkPhase = "compareTargetPath";
      return Result.succeed(undefined);
    }
    const frame = (state.stackDepth - 1) * 32;
    const position = state.frontier.getUint32(frame, false);
    const importIndex = state.frontier.getUint32(frame + 4, false) - 1;
    const moduleIndex = orderedModule(state, position);
    const moduleOffset = moduleIndex * 64;
    const importStart = state.moduleView.getUint32(
      moduleOffset + 16,
      false,
    );
    const importedOffset = (importStart + importIndex) * 64;
    if (state.linkPhase === "compareTargetPath") {
      if (state.searchCandidate >= state.count) {
        const failure = addLinkDiagnosticV1(
          state,
          "CORE_IMPORT_TARGET",
          state.moduleView.getBigUint64(moduleOffset + 8, false),
        );
        state.linkPhase = "selectImport";
        return failure;
      }
      const candidateIndex = orderedModule(state, state.searchCandidate);
      const candidate = linkModuleText(state, candidateIndex);
      const directoryLength = state.graph.getUint32(moduleIndex * 64 + 8, false);
      const modulePath = linkModuleText(state, moduleIndex);
      const specifierOffset = state.importEdgeView.getUint32(
        importedOffset + 8,
        false,
      );
      const specifierLength = state.importEdgeView.getUint32(
        importedOffset + 12,
        false,
      );
      const resolvedLength = directoryLength + specifierLength - 2;
      const resolvedCode = state.pathCompareCursor < resolvedLength
        ? state.pathCompareCursor < directoryLength
          ? state.textBytes[modulePath.offset + state.pathCompareCursor]
          : state.textBytes[
            specifierOffset + state.pathCompareCursor - directoryLength + 2
          ]
        : undefined;
      const candidateCode = state.pathCompareCursor < candidate.byteLength
        ? state.textBytes[candidate.offset + state.pathCompareCursor]
        : undefined;
      if (resolvedCode === candidateCode) {
        if (resolvedCode === undefined) {
          state.pendingTargetPosition = state.searchCandidate;
          state.exportIndex = 0;
          state.exportCompareCursor = 0;
          state.linkPhase = "compareExport";
        } else state.pathCompareCursor += 1;
        return Result.succeed(undefined);
      }
      state.searchCandidate += 1;
      state.pathCompareCursor = 0;
      return Result.succeed(undefined);
    }
    if (state.linkPhase === "compareExport") {
      const target = orderedModule(state, state.pendingTargetPosition);
      const targetOffset = target * 64;
      const exportStart = state.moduleView.getUint32(
        targetOffset + 24,
        false,
      );
      const exportCount = state.moduleView.getUint32(
        targetOffset + 28,
        false,
      );
      if (state.exportIndex >= exportCount) {
        const failure = addLinkDiagnosticV1(
          state,
          "CORE_IMPORT_TARGET",
          state.moduleView.getBigUint64(moduleOffset + 8, false),
        );
        state.linkPhase = "selectImport";
        return failure;
      }
      const exportOffset = (exportStart + state.exportIndex) * 48;
      const compared = compareCodeUnitStep(
        state,
        {
          offset: state.exportView.getUint32(exportOffset, false),
          byteLength: state.exportView.getUint32(exportOffset + 4, false),
        },
        {
          offset: state.importEdgeView.getUint32(importedOffset, false),
          byteLength: state.importEdgeView.getUint32(
            importedOffset + 4,
            false,
          ),
        },
        state.exportCompareCursor,
        state.exportCompareRightCursor,
      );
      if (!compared.done) {
        state.exportCompareCursor += compared.leftAdvance;
        state.exportCompareRightCursor += compared.rightAdvance;
        return Result.succeed(undefined);
      }
      state.exportCompareCursor = 0;
      state.exportCompareRightCursor = 0;
      state.compareLeftPendingLow = 0;
      state.compareRightPendingLow = 0;
      if (compared.order === 0) {
        state.linkPhase = "applyTarget";
      } else state.exportIndex += 1;
      return Result.succeed(undefined);
    }
    const targetState = state.graph.getUint32(
      state.pendingTargetPosition * 64 + 12,
      false,
    );
    if (targetState === 1) {
      const failure = addLinkDiagnosticV1(
        state,
        "CORE_MODULE_CYCLE",
        state.moduleView.getBigUint64(
          orderedModule(state, state.pendingTargetPosition) * 64 + 8,
          false,
        ),
      );
      state.linkPhase = "selectImport";
      return failure;
    }
    if (targetState === 0) {
      if (state.stackDepth >= Number(state.required.frontierEntries)) {
        return Result.fail(executableError("link", "budgetExceeded", {
          dimension: "frontierEntries",
          observed: BigInt(state.stackDepth + 1),
          maximum: state.required.frontierEntries,
        }));
      }
      const frontierCharge = linkUsageCharge(state, "frontierEntries", 1n);
      if (Result.isFailure(frontierCharge)) return frontierCharge;
      const nextFrame = state.stackDepth * 32;
      state.frontier.setUint32(
        nextFrame,
        state.pendingTargetPosition,
        false,
      );
      state.frontier.setUint32(nextFrame + 4, 0, false);
      state.stackDepth += 1;
      state.graph.setUint32(
        state.pendingTargetPosition * 64 + 12,
        1,
        false,
      );
    }
    state.linkPhase = "selectImport";
    return Result.succeed(undefined);
  }
  if (state.phase === "orderingDiagnostics") {
    if (
      state.diagnosticCount < 2 ||
      state.diagnosticOuter >= state.diagnosticCount
    ) {
      state.phase = "complete";
      return Result.succeed(undefined);
    }
    if (state.diagnosticSearchCursor < state.diagnosticCount) {
      const index = state.diagnosticSearchCursor;
      const order = state.diagnosticView.getUint32(index * 32 + 16, false);
      if (order === state.diagnosticInner - 1) {
        state.diagnosticLeftRecord = index;
      }
      if (order === state.diagnosticInner) {
        state.diagnosticRightRecord = index;
      }
      state.diagnosticSearchCursor += 1;
      return Result.succeed(undefined);
    }
    if (
      state.diagnosticLeftRecord < 0 ||
      state.diagnosticRightRecord < 0
    ) {
      return Result.fail(executableError("link", "invalidState"));
    }
    const leftOffset = state.diagnosticLeftRecord * 32;
    const rightOffset = state.diagnosticRightRecord * 32;
    const leftModule = state.diagnosticView.getBigUint64(
      leftOffset + 8,
      false,
    );
    const rightModule = state.diagnosticView.getBigUint64(
      rightOffset + 8,
      false,
    );
    const leftId = state.diagnosticView.getUint32(leftOffset, false);
    const rightId = state.diagnosticView.getUint32(rightOffset, false);
    const outOfOrder = leftModule !== rightModule
      ? leftModule > rightModule
      : leftId > rightId;
    if (outOfOrder) {
      state.diagnosticView.setUint32(
        leftOffset + 16,
        state.diagnosticInner,
        false,
      );
      state.diagnosticView.setUint32(
        rightOffset + 16,
        state.diagnosticInner - 1,
        false,
      );
    }
    if (outOfOrder && state.diagnosticInner > 1) {
      state.diagnosticInner -= 1;
    } else {
      state.diagnosticOuter += 1;
      state.diagnosticInner = state.diagnosticOuter;
    }
    state.diagnosticSearchCursor = 0;
    state.diagnosticLeftRecord = -1;
    state.diagnosticRightRecord = -1;
  }
  return Result.succeed(undefined);
};

const driveLinkerV1 = (
  state: LinkerStateV1,
  rawAllowance: unknown,
): Result.Result<
  DeclarativeV2VerifierLinkStepV1,
  DeclarativeV2VerifierExecutableV1Error
> => {
  const allowance = captureTransitionAllowance(rawAllowance, "link");
  if (Result.isFailure(allowance)) {
    state.phase = "failed";
    return Result.fail(allowance.failure);
  }
  const before = usageSnapshot(state.usage);
  const callCharge = linkUsageCharge(state, "calls", 1n);
  if (Result.isFailure(callCharge)) {
    state.phase = "failed";
    return Result.fail(callCharge.failure);
  }
  let transitions = 0;
  while (transitions < allowance.success && state.phase !== "complete") {
    const advanced = advanceLinkerOne(state);
    transitions += 1;
    if (Result.isFailure(advanced)) {
      state.phase = "failed";
      return Result.fail(advanced.failure);
    }
  }
  if (state.phase !== "complete") {
    return Result.succeed(Object.freeze({
      status: "pending",
      transitionCount: transitions,
      deltaUsage: frozenUsageDelta(state.usage, before),
      usage: frozenUsage(state.usage),
    }));
  }
  const result = Object.freeze({
    _tag: "DeclarativeV2VerifierLinkResultV1",
    moduleCount: BigInt(state.count),
    diagnosticCount: BigInt(state.diagnosticCount),
    usage: frozenUsage(state.usage),
  } satisfies DeclarativeV2VerifierLinkResultV1);
  OWNED_LINK_RESULTS.set(result, { state });
  return Result.succeed(result);
};

export function stepDeclarativeV2VerifierLinkerV1(
  rawLinker: unknown,
  rawAllowance: unknown,
): Result.Result<
  DeclarativeV2VerifierLinkStepV1,
  DeclarativeV2VerifierExecutableV1Error
> {
  const captured = linkerState(rawLinker);
  if (Result.isFailure(captured)) return Result.fail(captured.failure);
  if (
    !captured.success.sealed &&
    captured.success.phase !== "copyingModule"
  ) {
    return Result.fail(executableError("link", "invalidState"));
  }
  return driveLinkerV1(captured.success, rawAllowance);
}

export function finishDeclarativeV2VerifierLinkerV1(
  rawLinker: unknown,
  rawAllowance: unknown,
): Result.Result<
  DeclarativeV2VerifierLinkStepV1,
  DeclarativeV2VerifierExecutableV1Error
> {
  const captured = linkerState(rawLinker);
  if (Result.isFailure(captured)) return Result.fail(captured.failure);
  const state = captured.success;
  if (!state.sealed) {
    state.sealed = true;
    if (state.phase === "accepting") state.phase = "indexing";
  }
  return driveLinkerV1(state, rawAllowance);
}
