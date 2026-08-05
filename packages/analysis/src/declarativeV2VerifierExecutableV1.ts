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
  GENERATED_DECLARATIVE_V2_VERIFIER_ASSET_BASE64_V1,
  GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1,
} from "./declarativeV2VerifierV1.generated";
import {
  DECLARATIVE_V2_VERIFIER_ARENA_WIDTHS_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_ALIGNMENT_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_FORMAT_VERSION_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_HEADER_BYTES_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_MAGIC_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_SECTION_ENTRY_BYTES_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_SECTIONS_V1,
  DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1,
} from "./declarativeV2VerifierV1.contract";
import {
  DECLARATIVE_V2_VERIFIER_ARENA_STORAGE_REGIONS_V2,
  deriveDeclarativeV2VerifierLinkArenaStorageV2,
  deriveDeclarativeV2VerifierParseArenaStorageV2,
  type DeclarativeV2VerifierArenaStorageRegionV2,
  type DeclarativeV2VerifierArenaStorageV2,
} from "./declarativeV2VerifierArenaStorageV2";
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
  deriveDeclarativeV2VerifierRestartCanonicalBytesSha256V1,
  makeDeclarativeV2VerifierRestartFunctionBodyPrefixV1,
  makeDeclarativeV2VerifierRestartFunctionBodyTokenPrefixV1,
  type DeclarativeV2RestartDiagnosticRecordV1,
  type DeclarativeV2RestartDirectCallRecordV1,
  type DeclarativeV2RestartExportBindingRecordV1,
  type DeclarativeV2RestartFunctionRecordV1,
  type DeclarativeV2RestartModuleIdentityRecordV1,
  type DeclarativeV2RestartResolvedEdgeRecordV1,
  type DeclarativeV2RestartStaticImportRecordV1,
  type DeclarativeV2RestartValueFlowRecordV1,
  type DeclarativeV2VerifierRestartRecordV1,
} from "./declarativeV2VerifierRestartEvidenceV1";
import {
  createDeclarativeV2VerifierRuntimeSha256V1,
  createDeclarativeV2VerifierRuntimeArenaV1,
  declarativeV2VerifierRuntimeArenaRegionV1,
  finishDeclarativeV2VerifierRuntimeSha256V1,
  stepDeclarativeV2VerifierRuntimeSha256V1,
  type DeclarativeV2VerifierRuntimeArenaHandleV1,
  type DeclarativeV2VerifierRuntimeSha256V1,
} from "./declarativeV2VerifierRuntimeArenaV1";

export const DECLARATIVE_V2_VERIFIER_PARSE_SEMANTIC_CAPACITY_BOUNDS_V1 =
  Object.freeze({
    nonDiagnosticEvidenceFramesPerDomainUnit: 2,
    semanticOutputRecordsPerDomainUnit: 6,
    maximumSemanticOutputBytesPerDomainByte: 8,
    maximumSemanticTransitionsPerDomainUnitSquared: 256,
  });

const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(
  Uint8Array.prototype,
);
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)?.get;
const SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
      SharedArrayBuffer.prototype,
      "byteLength",
    )?.get;
const UINT8_ARRAY_SUBARRAY = Uint8Array.prototype.subarray;
// Canonical grammar terminals begin at one. Terminal zero is the parser-owned
// identity for a lexically admitted token rejected by that grammar; stored zero
// remains the uninitialized arena sentinel because terminal IDs are stored +1.
const CANONICAL_REJECTED_TOKEN_TERMINAL_V1 = 0;
const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const MAX_U32 = 0xffff_ffff;
const EXECUTABLE_ASSET_RESULT = Encoding.decodeBase64(
  GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_ASSET_BASE64_V1,
);
const SPECIFICATION_ASSET_RESULT = Encoding.decodeBase64(
  GENERATED_DECLARATIVE_V2_VERIFIER_ASSET_BASE64_V1,
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
    | "link"
    | "access";
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
  readonly evidenceIndexView: DataView;
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

interface LocalVerifierPlanFailureV1 {
  readonly reason:
    | "invalidInput"
    | "invalidBudget"
    | "budgetExceeded"
    | "addressabilityExceeded"
    | "overflow";
  readonly path?: string;
  readonly observed?: bigint;
  readonly maximum?: bigint;
}

interface LocalVerifierArenaPlanV2 {
  readonly requiredBytes: number;
  readonly regions: ReadonlyArray<Readonly<{
    readonly name: string;
    readonly offset: number;
    readonly byteLength: number;
  }>>;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

const localPlanFailure = (
  reason: LocalVerifierPlanFailureV1["reason"],
  path?: string,
  observed?: bigint,
  maximum?: bigint,
): LocalVerifierPlanFailureV1 => Object.freeze({
  reason,
  ...(path === undefined ? {} : { path }),
  ...(observed === undefined ? {} : { observed }),
  ...(maximum === undefined ? {} : { maximum }),
});

const captureLocalBudgetFrame = (
  value: unknown,
  kind: "command_budget" | "attempt_usage",
): DeclarativeV2VerifierBudgetFrameV2 | undefined => {
  if (value === null || typeof value !== "object") return undefined;
  const expected = ["kind", ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2];
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return undefined;
  }
  if (
    keys.length !== expected.length ||
    keys.some(key => typeof key !== "string" || !expected.includes(key))
  ) return undefined;
  const captured: Record<string, string | bigint> = { kind };
  for (const key of expected) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return undefined;
    }
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    if (key === "kind") {
      if (descriptor.value !== kind) return undefined;
      continue;
    }
    if (
      typeof descriptor.value !== "bigint" ||
      descriptor.value < 0n ||
      descriptor.value > MAX_SIGNED_INT64
    ) return undefined;
    captured[key] = descriptor.value;
  }
  return Object.freeze(captured) as DeclarativeV2VerifierBudgetFrameV2;
};

const captureLocalArenaStorageV2 = (
  value: unknown,
): DeclarativeV2VerifierArenaStorageV2 | undefined => {
  if (value === null || typeof value !== "object") return undefined;
  const names: ReadonlyArray<DeclarativeV2VerifierArenaStorageRegionV2> =
    DECLARATIVE_V2_VERIFIER_ARENA_STORAGE_REGIONS_V2.map(
    ({ name }) => name,
  );
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return undefined;
  }
  if (
    keys.length !== names.length ||
    keys.some(key => !names.some(name => name === key))
  ) return undefined;
  const captured = Object.create(null) as Record<
    typeof names[number],
    bigint
  >;
  for (const name of names) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, name);
    } catch {
      return undefined;
    }
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "bigint" ||
      descriptor.value < 0n ||
      descriptor.value > MAX_SIGNED_INT64
    ) return undefined;
    captured[name] = descriptor.value;
  }
  return Object.freeze(captured);
};

const planDeclarativeV2VerifierArenaV2 = (
  input: unknown,
): Result.Result<LocalVerifierArenaPlanV2, LocalVerifierPlanFailureV1> => {
  if (input === null || typeof input !== "object") {
    return Result.fail(localPlanFailure("invalidInput"));
  }
  let maximumsValue: unknown;
  let requiredValue: unknown;
  let storageValue: unknown;
  try {
    const keys = Reflect.ownKeys(input);
    if (
      keys.length !== 3 ||
      !Object.hasOwn(input, "maximums") ||
      !Object.hasOwn(input, "required") ||
      !Object.hasOwn(input, "storage")
    ) return Result.fail(localPlanFailure("invalidInput"));
    const maximumsDescriptor = Object.getOwnPropertyDescriptor(
      input,
      "maximums",
    );
    const requiredDescriptor = Object.getOwnPropertyDescriptor(
      input,
      "required",
    );
    const storageDescriptor = Object.getOwnPropertyDescriptor(
      input,
      "storage",
    );
    if (
      maximumsDescriptor === undefined ||
      requiredDescriptor === undefined ||
      storageDescriptor === undefined ||
      !("value" in maximumsDescriptor) ||
      !("value" in requiredDescriptor) ||
      !("value" in storageDescriptor)
    ) return Result.fail(localPlanFailure("invalidInput"));
    maximumsValue = maximumsDescriptor.value;
    requiredValue = requiredDescriptor.value;
    storageValue = storageDescriptor.value;
  } catch {
    return Result.fail(localPlanFailure("invalidInput"));
  }
  const maximums = captureLocalBudgetFrame(maximumsValue, "command_budget");
  const required = captureLocalBudgetFrame(requiredValue, "attempt_usage");
  if (maximums === undefined || required === undefined) {
    return Result.fail(localPlanFailure("invalidBudget"));
  }
  const storage = captureLocalArenaStorageV2(storageValue);
  if (storage === undefined) {
    return Result.fail(localPlanFailure("invalidBudget", "storage"));
  }
  if (required.sourceMapBytes !== 0n) {
    return Result.fail(localPlanFailure(
      "invalidInput",
      "sourceMapBytes",
      required.sourceMapBytes,
      0n,
    ));
  }
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    if (required[dimension] > maximums[dimension]) {
      return Result.fail(localPlanFailure(
        "budgetExceeded",
        dimension,
        required[dimension],
        maximums[dimension],
      ));
    }
  }
  const bodyBytes =
    required.sourceBytes + required.sourceMapBytes + required.semanticBytes;
  if (bodyBytes > required.objectBodyBytes) {
    return Result.fail(localPlanFailure(
      "budgetExceeded",
      "objectBodyBytes",
      bodyBytes,
      required.objectBodyBytes,
    ));
  }
  for (const dimension of [
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
  ] as const) {
    if (required[dimension] > BigInt(MAX_U32)) {
      return Result.fail(localPlanFailure(
        "addressabilityExceeded",
        dimension,
        required[dimension],
        BigInt(MAX_U32),
      ));
    }
  }
  const regions: Array<Readonly<{
    readonly name: string;
    readonly offset: number;
    readonly byteLength: number;
  }>> = [];
  let total = BigInt(DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1.arena.baseBytes);
  const append = (
    name: string,
    count: bigint,
    width: bigint,
  ): LocalVerifierPlanFailureV1 | undefined => {
    const length = count * width;
    const next = total + length;
    if (length > MAX_SIGNED_INT64 || next > MAX_SIGNED_INT64) {
      return localPlanFailure("overflow", name);
    }
    if (next > BigInt(MAX_U32)) {
      return localPlanFailure(
        "addressabilityExceeded",
        name,
        next,
        BigInt(MAX_U32),
      );
    }
    regions.push(Object.freeze({
      name,
      offset: Number(total),
      byteLength: Number(length),
    }));
    total = next;
    return undefined;
  };
  for (const width of DECLARATIVE_V2_VERIFIER_ARENA_WIDTHS_V1) {
    const failure = append(
      width.name,
      required[width.dimension],
      BigInt(width.bytes),
    );
    if (failure !== undefined) return Result.fail(failure);
  }
  for (const { name } of DECLARATIVE_V2_VERIFIER_ARENA_STORAGE_REGIONS_V2) {
    const failure = append(
      name,
      storage[name],
      1n,
    );
    if (failure !== undefined) return Result.fail(failure);
  }
  if (
    required.tableBytes <
      BigInt(GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetByteLength)
  ) {
    return Result.fail(localPlanFailure(
      "budgetExceeded",
      "tableBytes",
      BigInt(GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetByteLength),
      required.tableBytes,
    ));
  }
  return Result.succeed(Object.freeze({
    requiredBytes: Number(total),
    regions: Object.freeze(regions),
    usage: required,
  }));
};

const loadGeneratedDeclarativeV2VerifierAssetV1 = (
  budget: Readonly<{ readonly maximumTableBytes: number }>,
): Result.Result<
  Readonly<{
    readonly usage: Readonly<{ readonly tableBytes: number }>;
    readonly copySectionBytes: (name: string) => Uint8Array | undefined;
  }>,
  LocalVerifierPlanFailureV1
> => {
  if (
    !isNonNegativeSafeInteger(budget.maximumTableBytes) ||
    Result.isFailure(SPECIFICATION_ASSET_RESULT)
  ) return Result.fail(localPlanFailure("invalidBudget"));
  const bytes = SPECIFICATION_ASSET_RESULT.success;
  if (bytes.byteLength > budget.maximumTableBytes) {
    return Result.fail(localPlanFailure(
      "budgetExceeded",
      "tableBytes",
      BigInt(bytes.byteLength),
      BigInt(budget.maximumTableBytes),
    ));
  }
  const directory = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const magic = encodeUtf8Owned(DECLARATIVE_V2_VERIFIER_ASSET_MAGIC_V1);
  if (
    bytes.byteLength < DECLARATIVE_V2_VERIFIER_ASSET_HEADER_BYTES_V1 ||
    !bytesEqualFullScan(bytes.subarray(0, magic.byteLength), magic)
  ) return Result.fail(localPlanFailure("invalidInput"));
  const version = readU32(bytes, 8);
  const headerBytes = readU32(bytes, 12);
  const sectionCount = readU32(bytes, 16);
  const sectionEntryBytes = readU32(bytes, 20);
  const alignment = readU32(bytes, 24);
  const reserved = readU32(bytes, 28);
  if (
    version !== DECLARATIVE_V2_VERIFIER_ASSET_FORMAT_VERSION_V1 ||
    headerBytes !== DECLARATIVE_V2_VERIFIER_ASSET_HEADER_BYTES_V1 ||
    sectionCount !== DECLARATIVE_V2_VERIFIER_ASSET_SECTIONS_V1.length ||
    sectionEntryBytes !==
      DECLARATIVE_V2_VERIFIER_ASSET_SECTION_ENTRY_BYTES_V1 ||
    alignment !== DECLARATIVE_V2_VERIFIER_ASSET_ALIGNMENT_V1 ||
    reserved !== 0
  ) {
    return Result.fail(localPlanFailure("invalidInput"));
  }
  const tableEnd = headerBytes + sectionCount * sectionEntryBytes;
  let expectedOffset = align(tableEnd, alignment);
  if (
    tableEnd > bytes.byteLength ||
    expectedOffset > bytes.byteLength ||
    !bytesAreZero(bytes, tableEnd, expectedOffset)
  ) return Result.fail(localPlanFailure("invalidInput"));
  const sections: Array<Readonly<{
    readonly name: string;
    readonly offset: number;
    readonly byteLength: number;
  }>> = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const definition = DECLARATIVE_V2_VERIFIER_ASSET_SECTIONS_V1[index]!;
    const entry = headerBytes + index * sectionEntryBytes;
    const id = directory.getUint32(entry, false);
    const recordBytes = directory.getUint32(entry + 4, false);
    const offset = directory.getUint32(entry + 8, false);
    const byteLength = directory.getUint32(entry + 12, false);
    const count = directory.getUint32(entry + 16, false);
    const flags = directory.getUint32(entry + 20, false);
    if (
      id !== definition.id ||
      recordBytes !== definition.recordBytes ||
      offset !== expectedOffset ||
      flags !== 0 ||
      byteLength % recordBytes !== 0 ||
      count !== byteLength / recordBytes ||
      offset + byteLength > bytes.byteLength
    ) {
      return Result.fail(localPlanFailure("invalidInput"));
    }
    if (
      recordBytes >= 4 &&
      definition.name !== "stringPool" &&
      definition.name !== "canonicalSpecification"
    ) {
      for (let row = 0; row < count; row += 1) {
        const rowId = readU32(bytes, offset + row * recordBytes);
        if (
          definition.name.startsWith("unicode")
            ? rowId === undefined
            : rowId !== row + 1
        ) return Result.fail(localPlanFailure("invalidInput"));
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
        ) return Result.fail(localPlanFailure("invalidInput"));
        previousEnd = end;
      }
    }
    sections.push(Object.freeze({
      name: definition.name,
      offset,
      byteLength,
    }));
    const unalignedEnd = offset + byteLength;
    expectedOffset = align(unalignedEnd, alignment);
    if (
      expectedOffset > bytes.byteLength ||
      !bytesAreZero(bytes, unalignedEnd, expectedOffset)
    ) return Result.fail(localPlanFailure("invalidInput"));
  }
  if (expectedOffset !== bytes.byteLength) {
    return Result.fail(localPlanFailure("invalidInput"));
  }
  return Result.succeed(Object.freeze({
    usage: Object.freeze({ tableBytes: bytes.byteLength }),
    copySectionBytes: (name: string) => {
      const section = sections.find(candidate => candidate.name === name);
      return section === undefined
        ? undefined
        : bytes.slice(section.offset, section.offset + section.byteLength);
    },
  }));
};

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
    const arenaPlan = yield* planDeclarativeV2VerifierArenaV2({
      maximums: input.maximums,
      required: input.required,
      storage: deriveDeclarativeV2VerifierParseArenaStorageV2(input.required),
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
    const emittedIndex = tokenCount;
    const offset = tokenRecordOffset(emittedIndex);
    tokenView.setUint32(offset, tokenKindId(kind), false);
    tokenView.setUint32(offset + 4, start, false);
    tokenView.setUint32(offset + 8, end, false);
    tokenView.setUint32(offset + 12, stringCursor, false);
    tokenView.setUint32(offset + 16, raw.length, false);
    tokenView.setUint32(offset + 20, currentTokenLineBefore ? 1 : 0, false);
    stringBytes.set(raw, stringCursor);
    stringCursor += raw.length;
    tokenCount += 1;
    const initialTerminal =
      canonicalTokenTerminals(tokenAt(emittedIndex))[0] ??
      CANONICAL_REJECTED_TOKEN_TERMINAL_V1;
    tokenView.setUint32(offset + 36, initialTerminal + 1, false);
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
        tokenView.setUint32(
          tokenRecordOffset(canonicalParserCursor) + 36,
          lookahead + 1,
          false,
        );
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
    const emittedIndex = tokenCount;
    const offset = tokenRecordOffset(emittedIndex);
    tokenView.setUint32(offset, tokenKindId(kind), false);
    tokenView.setUint32(offset + 4, tokenStart, false);
    tokenView.setUint32(offset + 8, state.end, false);
    tokenView.setUint32(offset + 12, state.outputStart, false);
    tokenView.setUint32(offset + 16, state.outputLength, false);
    tokenView.setUint32(offset + 20, currentTokenLineBefore ? 1 : 0, false);
    stringCursor += state.outputLength;
    tokenCount += 1;
    const initialTerminal =
      canonicalTokenTerminals(tokenAt(emittedIndex))[0] ??
      CANONICAL_REJECTED_TOKEN_TERMINAL_V1;
    tokenView.setUint32(offset + 36, initialTerminal + 1, false);
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
      functionView.setUint32(
        offset + 24,
        Math.max(0, bodyEnd - bodyStart - 1),
        false,
      );
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
      let parameterCount = paramsEnd === paramsStart + 1 ? 0 : 1;
      for (let index = paramsStart + 1; index < paramsEnd; index += 1) {
        yield 1;
        const token = at(index);
        if (
          tokenMatches(index, ",") &&
          delimiterDepth === 0 &&
          index + 1 < paramsEnd
        ) {
          parameterCount += 1;
        }
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
      functionView.setUint32(
        functionRecordOffset(functionIndex) + 20,
        parameterCount,
        false,
      );
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
              (abi.name === "runQuery" || abi.name === "runMutation") &&
              !(
                tokenMatches(index - 1, "await") &&
                tokenMatches(index + 1, "(") &&
                tokenMatches(index + 2, "{") &&
                tokenMatches(index + 3, "_path") &&
                tokenMatches(index + 4, ":") &&
                at(index + 5).kind === "string" &&
                tokenMatches(index + 6, "}") &&
                (tokenMatches(index + 7, ",") ||
                  tokenMatches(index + 7, ")"))
              )
            ) {
              add("CORE_CALL_TARGET", token);
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
            if (tryDepth > 0 && abi.catchability === "host") {
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
      evidenceIndexView,
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
  readonly readyForModule: boolean;
  readonly transitionCount: number;
  readonly deltaUsage: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

export type DeclarativeV2VerifierLinkStepV1 =
  | DeclarativeV2VerifierLinkPendingV1
  | DeclarativeV2VerifierLinkResultV1;

export interface DeclarativeV2VerifierAuthenticatedLinkBindingsV1 {
  readonly attemptSha256: Uint8Array;
  readonly futureRegistrationIntentSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly authenticatedInputSha256: Uint8Array;
  readonly linkSequence: bigint;
  readonly parsePagesRootSha256: Uint8Array;
  readonly currentProgressSha256: Uint8Array;
  readonly predecessorAndTailsSha256: Uint8Array;
  readonly rangeSha256: Uint8Array;
  readonly analyzerReleaseSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
}

export interface DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1
  extends DeclarativeV2VerifierAuthenticatedLinkBindingsV1 {
  readonly moduleOrdinal: bigint;
  readonly producingParseResultSha256: Uint8Array;
}

export interface DeclarativeV2VerifierAuthenticatedLinkClaimPortV1 {
  readonly claim: (
    module: DeclarativeV2VerifierModuleResultV1,
  ) => Result.Result<
    DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
}

export type DeclarativeV2VerifierLinkCapacityV1 = Readonly<{
  readonly _tag: "DeclarativeV2VerifierLinkCapacityV1";
}> & Readonly<Record<
  typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
  bigint
>>;

export interface DeclarativeV2VerifierAuthenticatedLinkAccumulatorV1 {
  readonly _tag: "DeclarativeV2VerifierAuthenticatedLinkAccumulatorV1";
}

export interface DeclarativeV2VerifierAuthenticatedLinkDriverV1 {
  readonly _tag: "DeclarativeV2VerifierAuthenticatedLinkDriverV1";
}

export interface DeclarativeV2VerifierAuthenticatedLinkAdmissionReceiptV1 {
  readonly status: "pending" | "ready";
  readonly transitionCount: number;
  readonly admittedModuleCount: bigint;
}

export interface DeclarativeV2VerifierAuthenticatedLinkSealPendingV1 {
  readonly status: "pending";
  readonly transitionCount: 0;
}

export interface DeclarativeV2VerifierAuthenticatedLinkSealCompleteV1 {
  readonly status: "complete";
  readonly transitionCount: 1;
  readonly driver: DeclarativeV2VerifierAuthenticatedLinkDriverV1;
  readonly capacity: DeclarativeV2VerifierLinkCapacityV1;
}

export type DeclarativeV2VerifierAuthenticatedLinkSealResultV1 =
  | DeclarativeV2VerifierAuthenticatedLinkSealPendingV1
  | DeclarativeV2VerifierAuthenticatedLinkSealCompleteV1;

export interface DeclarativeV2VerifierAuthenticatedLinkDrivePendingV1 {
  readonly status: "pending";
  readonly transitionCount: number;
  readonly deltaUsage: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

export type DeclarativeV2VerifierAuthenticatedLinkDriveResultV1 =
  | DeclarativeV2VerifierAuthenticatedLinkDrivePendingV1
  | DeclarativeV2VerifierLinkResultV1;

export interface DeclarativeV2VerifierAuthenticatedLinkFactoryV1 {
  readonly create: (
    bindings: unknown,
    commandBudget: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierAuthenticatedLinkAccumulatorV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly admit: (
    accumulator: unknown,
    module: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierAuthenticatedLinkAdmissionReceiptV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly seal: (
    accumulator: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierAuthenticatedLinkSealResultV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly step: (
    driver: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierAuthenticatedLinkDriveResultV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  /**
   * Package-internal settled-cold bridge. The restart runtime has already
   * authenticated and reconstructed both the module sequence and link result;
   * this installs the one-shot registration presentation without rerunning the
   * linker or creating a second module representation.
   */
  readonly adoptRestarted: (
    result: unknown,
    bindings: unknown,
    modules: readonly unknown[],
  ) => Result.Result<void, DeclarativeV2VerifierExecutableV1Error>;
  readonly close: (
    capability: unknown,
  ) => Result.Result<void, DeclarativeV2VerifierExecutableV1Error>;
}

declare const DECLARATIVE_V2_VERIFIER_COMPLETED_LINK_CLAIM_V1: unique symbol;
declare const DECLARATIVE_V2_VERIFIER_COMPLETED_LINK_LOOKUP_V1: unique symbol;

/**
 * Package-local, process-local authority retained by an authenticated link
 * result for the registration driver. It is intentionally absent from the
 * package facade and public result shape.
 */
export interface DeclarativeV2VerifierCompletedLinkClaimV1 {
  readonly _tag: "DeclarativeV2VerifierCompletedLinkClaimV1";
  readonly [DECLARATIVE_V2_VERIFIER_COMPLETED_LINK_CLAIM_V1]: true;
}

export interface DeclarativeV2VerifierCompletedLinkLookupV1 {
  readonly _tag: "DeclarativeV2VerifierCompletedLinkLookupV1";
  readonly [DECLARATIVE_V2_VERIFIER_COMPLETED_LINK_LOOKUP_V1]: true;
}

export interface DeclarativeV2VerifierCompletedLinkLookupUsageV1 {
  readonly calls: bigint;
  readonly exports: bigint;
  readonly frontierEntries: bigint;
  readonly stringBytes: bigint;
}

export type DeclarativeV2VerifierCompletedLinkLookupStepV1 =
  | Readonly<{
      readonly status: "pending";
      readonly transitionCount: number;
      readonly usage: DeclarativeV2VerifierCompletedLinkLookupUsageV1;
    }>
  | Readonly<{
      readonly status: "complete";
      readonly transitionCount: number;
      readonly found: boolean;
      readonly moduleOrdinal: bigint | null;
      readonly producingParseResultSha256: Uint8Array | null;
      readonly usesRunMutation: boolean | null;
      readonly usage: DeclarativeV2VerifierCompletedLinkLookupUsageV1;
    }>;

export interface DeclarativeV2VerifierCompletedLinkClaimPortV1 {
  readonly claim: (
    result: unknown,
    expectedBindings: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierCompletedLinkClaimV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly beginHandlerLookup: (
    claim: unknown,
    modulePath: unknown,
    exportName: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierCompletedLinkLookupV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly stepHandlerLookup: (
    lookup: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierCompletedLinkLookupStepV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly close: (
    handle: unknown,
  ) => Result.Result<void, DeclarativeV2VerifierExecutableV1Error>;
}

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
  hasCycleDiagnostic: boolean;
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
    | "findExportFunction"
    | "compareExportFunction"
    | "complete";
  copySourceRecord: number;
  copyRecordOrder: number;
  copyByteIndex: number;
  copyFunctionIndex: number;
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

interface AuthenticatedRegistrationPresentationV1 {
  bindings: CapturedAuthenticatedLinkBindingsV1 | undefined;
  readonly rawModules: Array<DeclarativeV2VerifierModuleResultV1>;
  readonly modules: Array<DeclarativeV2VerifierOwnedModuleArenaV1>;
  readonly claims: Array<CapturedAuthenticatedLinkModuleClaimV1>;
  claimed: boolean;
}

interface LinkResultPresentationV1 {
  readonly state: LinkerStateV1;
  registration: AuthenticatedRegistrationPresentationV1 | undefined;
}

const OWNED_LINKERS = new WeakMap<object, LinkerStateV1>();
const OWNED_LINK_RESULTS = new WeakMap<object, LinkResultPresentationV1>();
const COMPLETED_LINK_CLAIM_PORTS_V1 = new WeakMap<
  object,
  DeclarativeV2VerifierCompletedLinkClaimPortV1
>();

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
  const plan = planDeclarativeV2VerifierArenaV2({
    maximums,
    required: requiredInput,
    storage: deriveDeclarativeV2VerifierLinkArenaStorageV2(requiredInput),
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
    hasCycleDiagnostic: false,
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
    copyFunctionIndex: 0,
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

export function readDeclarativeV2VerifierLinkerUsageV1(
  rawLinker: unknown,
): Result.Result<
  DeclarativeV2VerifierBudgetFrameV2,
  DeclarativeV2VerifierExecutableV1Error
> {
  const state = rawLinker !== null && typeof rawLinker === "object"
    ? OWNED_LINKERS.get(rawLinker)
    : undefined;
  return state === undefined
    ? Result.fail(executableError("link", "invalidInput"))
    : Result.succeed(frozenUsage(state.usage));
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
  if (code === "CORE_MODULE_CYCLE") state.hasCycleDiagnostic = true;
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
      state.copyFunctionIndex = 0;
      state.copyByteIndex = 0;
      state.copyPhase = "findExportFunction";
      return Result.succeed(undefined);
    }
    if (state.copyPhase === "findExportFunction") {
      if (state.copyFunctionIndex >= source.functionCount) {
        return Result.fail(executableError("link", "invalidState"));
      }
      state.copyByteIndex = 0;
      state.copyPhase = "compareExportFunction";
      return Result.succeed(undefined);
    }
    if (state.copyPhase === "compareExportFunction") {
      const sourceExportOffset = state.copySourceRecord * 48;
      const localStored = source.exportView.getUint32(
        sourceExportOffset + 4,
        false,
      );
      const functionStored = source.functionView.getUint32(
        state.copyFunctionIndex * 144,
        false,
      );
      if (localStored === 0 || functionStored === 0) {
        return Result.fail(executableError("link", "invalidState"));
      }
      const localLength = sourceTokenLength(source, localStored - 1);
      const functionLength = sourceTokenLength(source, functionStored - 1);
      if (localLength !== functionLength) {
        state.copyFunctionIndex += 1;
        state.copyPhase = "findExportFunction";
        return Result.succeed(undefined);
      }
      if (state.copyByteIndex < localLength) {
        if (
          sourceTokenByte(source, localStored - 1, state.copyByteIndex) !==
            sourceTokenByte(
              source,
              functionStored - 1,
              state.copyByteIndex,
            )
        ) {
          state.copyFunctionIndex += 1;
          state.copyByteIndex = 0;
          state.copyPhase = "findExportFunction";
          return Result.succeed(undefined);
        }
        state.copyByteIndex += 1;
        return Result.succeed(undefined);
      }
      const destination = state.exportCount * 48;
      state.exportView.setUint32(
        destination + 8,
        state.copyFunctionIndex + 1,
        false,
      );
      state.exportCount += 1;
      state.copyRecordOrder += 1;
      state.copySourceRecord = 0;
      state.copyByteIndex = 0;
      state.copyFunctionIndex = 0;
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
    const resolvedModuleIndex = orderedModule(
      state,
      state.pendingTargetPosition,
    );
    const resolvedExportStart = state.moduleView.getUint32(
      resolvedModuleIndex * 64 + 24,
      false,
    );
    state.importEdgeView.setUint32(
      importedOffset + 20,
      resolvedModuleIndex + 1,
      false,
    );
    state.importEdgeView.setUint32(
      importedOffset + 24,
      state.exportView.getUint32(
        (resolvedExportStart + state.exportIndex) * 48 + 8,
        false,
      ),
      false,
    );
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
  while (
    transitions < allowance.success &&
    state.phase !== "complete" &&
    !(state.phase === "accepting" && !state.sealed)
  ) {
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
      readyForModule: state.phase === "accepting" && !state.sealed,
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
  OWNED_LINK_RESULTS.set(result, { state, registration: undefined });
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

const AUTHENTICATED_LINK_DIGEST_FIELDS_V1 = [
  "attemptSha256",
  "futureRegistrationIntentSha256",
  "candidateSha256",
  "authenticatedInputSha256",
  "parsePagesRootSha256",
  "currentProgressSha256",
  "predecessorAndTailsSha256",
  "rangeSha256",
  "analyzerReleaseSha256",
  "analyzerIdentitySha256",
  "verifierIdentitySha256",
] as const;

interface CapturedAuthenticatedLinkBindingsV1 {
  readonly attemptSha256: Uint8Array;
  readonly futureRegistrationIntentSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly authenticatedInputSha256: Uint8Array;
  readonly linkSequence: bigint;
  readonly parsePagesRootSha256: Uint8Array;
  readonly currentProgressSha256: Uint8Array;
  readonly predecessorAndTailsSha256: Uint8Array;
  readonly rangeSha256: Uint8Array;
  readonly analyzerReleaseSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
}

interface CapturedAuthenticatedLinkModuleClaimV1
  extends CapturedAuthenticatedLinkBindingsV1 {
  readonly moduleOrdinal: bigint;
  readonly producingParseResultSha256: Uint8Array;
}

interface LinkModuleCapacitySummaryV1 {
  readonly pathByteLength: bigint;
  readonly importCount: bigint;
  readonly exportCount: bigint;
  readonly functionCount: bigint;
  readonly copiedTextByteLength: bigint;
  readonly maximumImportedNameByteLength: bigint;
  readonly maximumModuleSpecifierByteLength: bigint;
  readonly maximumExportNameByteLength: bigint;
  readonly maximumExportLocalByteLength: bigint;
  readonly maximumFunctionNameByteLength: bigint;
  readonly copyTransitionCapacity: bigint;
}

interface PendingLinkModuleSummaryV1 {
  readonly rawModule: object;
  readonly owned: DeclarativeV2VerifierOwnedModuleArenaV1;
  readonly claim: CapturedAuthenticatedLinkModuleClaimV1;
  phase: "imports" | "exports" | "functions" | "complete";
  index: number;
  copiedTextByteLength: bigint;
  maximumImportedNameByteLength: bigint;
  maximumModuleSpecifierByteLength: bigint;
  maximumExportNameByteLength: bigint;
  maximumExportLocalByteLength: bigint;
  maximumFunctionNameByteLength: bigint;
}

interface AuthenticatedLinkAccumulatorStateV1 {
  bindings: CapturedAuthenticatedLinkBindingsV1 | undefined;
  commandBudget: DeclarativeV2VerifierBudgetFrameV2 | undefined;
  readonly rawModules: Array<DeclarativeV2VerifierModuleResultV1>;
  readonly modules: Array<DeclarativeV2VerifierOwnedModuleArenaV1>;
  readonly claims: Array<CapturedAuthenticatedLinkModuleClaimV1>;
  readonly summaries: Array<LinkModuleCapacitySummaryV1>;
  pending: PendingLinkModuleSummaryV1 | undefined;
  closed: boolean;
}

interface AuthenticatedLinkDriverStateV1 {
  bindings: CapturedAuthenticatedLinkBindingsV1 | undefined;
  capacity: DeclarativeV2VerifierLinkCapacityV1 | undefined;
  linker: LinkerStateV1 | undefined;
  readonly rawModules: Array<DeclarativeV2VerifierModuleResultV1>;
  readonly modules: Array<DeclarativeV2VerifierOwnedModuleArenaV1>;
  readonly claims: Array<CapturedAuthenticatedLinkModuleClaimV1>;
  moduleIndex: number;
  coreTransitionCount: bigint;
  closed: boolean;
}

interface CompletedLinkClaimStateV1 {
  linker: LinkerStateV1 | undefined;
  bindings: CapturedAuthenticatedLinkBindingsV1 | undefined;
  readonly rawModules: Array<DeclarativeV2VerifierModuleResultV1>;
  readonly modules: Array<DeclarativeV2VerifierOwnedModuleArenaV1>;
  readonly claims: Array<CapturedAuthenticatedLinkModuleClaimV1>;
  activeLookup: object | undefined;
  closed: boolean;
}

interface CompletedLinkLookupStateV1 {
  claim: CompletedLinkClaimStateV1 | undefined;
  modulePath: string | undefined;
  exportName: string | undefined;
  readonly expectedUtf8: IncrementalUtf8StringCursorV1;
  phase:
    | "findModule"
    | "compareModule"
    | "findExport"
    | "compareExport"
    | "findFunction"
    | "compareFunction"
    | "scanReachableCalls"
    | "findLocalTarget"
    | "compareLocalTarget"
    | "complete";
  moduleIndex: number;
  exportIndex: number;
  functionIndex: number;
  callIndex: number;
  localToken: number;
  targetToken: number;
  targetFunctionIndex: number;
  readonly reachableModuleIndexes: number[];
  readonly reachableFunctionIndexes: number[];
  readonly reachableVisited: Map<number, Set<number>>;
  reachableIndex: number;
  byteIndex: number;
  transitionCount: bigint;
  terminalCharged: boolean;
  found: boolean;
  usesRunMutation: boolean;
  calls: bigint;
  exports: bigint;
  frontierEntries: bigint;
  stringBytes: bigint;
  closed: boolean;
}

interface IncrementalUtf8StringCursorV1 {
  source: string | undefined;
  sourceIndex: number;
  scalar: number;
  scalarByteIndex: number;
  scalarByteLength: number;
}

const AUTHENTICATED_LINK_CLAIMED_MODULES_V1 = new WeakSet<object>();

const captureExactOwnedRecordV1 = (
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | undefined => {
  if (value === null || typeof value !== "object") return undefined;
  let ownKeys: readonly PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch {
    return undefined;
  }
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some(key => typeof key !== "string" || !keys.includes(key))
  ) return undefined;
  const captured: Record<string, unknown> = {};
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return undefined;
    }
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    captured[key] = descriptor.value;
  }
  return Object.freeze(captured);
};

const captureOwnedSha256V1 = (value: unknown): Uint8Array | undefined => {
  if (
    !isUint8ArrayWithByteLength(value, 32) ||
    TYPED_ARRAY_BUFFER_GETTER === undefined
  ) return undefined;
  try {
    const buffer = Reflect.apply(
      TYPED_ARRAY_BUFFER_GETTER,
      value,
      [],
    ) as ArrayBufferLike;
    if (SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER !== undefined) {
      try {
        Reflect.apply(
          SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER,
          buffer,
          [],
        );
        return undefined;
      } catch {
        // An intrinsic SharedArrayBuffer brand failure proves ordinary backing.
      }
    }
    return new Uint8Array(value);
  } catch {
    return undefined;
  }
};

const resetIncrementalUtf8StringCursorV1 = (
  cursor: IncrementalUtf8StringCursorV1,
  source: string,
): void => {
  cursor.source = source;
  cursor.sourceIndex = 0;
  cursor.scalar = 0;
  cursor.scalarByteIndex = 0;
  cursor.scalarByteLength = 0;
};

const nextIncrementalUtf8ByteV1 = (
  cursor: IncrementalUtf8StringCursorV1,
): number | undefined => {
  if (cursor.scalarByteIndex >= cursor.scalarByteLength) {
    const source = cursor.source;
    if (source === undefined || cursor.sourceIndex >= source.length) {
      return undefined;
    }
    const first = source.charCodeAt(cursor.sourceIndex);
    let scalar = first;
    let width = 1;
    if (
      first >= 0xd800 &&
      first <= 0xdbff &&
      cursor.sourceIndex + 1 < source.length
    ) {
      const second = source.charCodeAt(cursor.sourceIndex + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        scalar =
          0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00);
        width = 2;
      } else {
        scalar = 0xfffd;
      }
    } else if (first >= 0xd800 && first <= 0xdfff) {
      scalar = 0xfffd;
    }
    cursor.sourceIndex += width;
    cursor.scalar = scalar;
    cursor.scalarByteIndex = 0;
    cursor.scalarByteLength = scalar <= 0x7f
      ? 1
      : scalar <= 0x7ff
      ? 2
      : scalar <= 0xffff
      ? 3
      : 4;
  }
  const scalar = cursor.scalar;
  const index = cursor.scalarByteIndex;
  const length = cursor.scalarByteLength;
  cursor.scalarByteIndex += 1;
  if (length === 1) return scalar;
  if (length === 2) {
    return index === 0
      ? 0xc0 | (scalar >>> 6)
      : 0x80 | (scalar & 0x3f);
  }
  if (length === 3) {
    if (index === 0) return 0xe0 | (scalar >>> 12);
    if (index === 1) return 0x80 | ((scalar >>> 6) & 0x3f);
    return 0x80 | (scalar & 0x3f);
  }
  if (index === 0) return 0xf0 | (scalar >>> 18);
  if (index === 1) return 0x80 | ((scalar >>> 12) & 0x3f);
  if (index === 2) return 0x80 | ((scalar >>> 6) & 0x3f);
  return 0x80 | (scalar & 0x3f);
};

const captureVerifierEvidenceSha256V1 = (
  value: string,
): Uint8Array | undefined => {
  if (!/^[0-9a-f]{64}$/.test(value)) return undefined;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const parsed = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isSafeInteger(parsed)) return undefined;
    bytes[index] = parsed;
  }
  return bytes;
};

const captureAuthenticatedLinkBindingsV1 = (
  value: unknown,
): CapturedAuthenticatedLinkBindingsV1 | undefined => {
  const keys = [
    "attemptSha256",
    "futureRegistrationIntentSha256",
    "candidateSha256",
    "authenticatedInputSha256",
    "linkSequence",
    "parsePagesRootSha256",
    "currentProgressSha256",
    "predecessorAndTailsSha256",
    "rangeSha256",
    "analyzerReleaseSha256",
    "analyzerIdentitySha256",
    "verifierIdentitySha256",
  ] as const;
  const captured = captureExactOwnedRecordV1(value, keys);
  if (
    captured === undefined ||
    typeof captured.linkSequence !== "bigint" ||
    captured.linkSequence < 0n ||
    captured.linkSequence > MAX_SIGNED_INT64
  ) return undefined;
  const digests: Partial<Record<
    typeof AUTHENTICATED_LINK_DIGEST_FIELDS_V1[number],
    Uint8Array
  >> = {};
  for (const field of AUTHENTICATED_LINK_DIGEST_FIELDS_V1) {
    const digest = captureOwnedSha256V1(captured[field]);
    if (digest === undefined) return undefined;
    digests[field] = digest;
  }
  return Object.freeze({
    attemptSha256: digests.attemptSha256!,
    futureRegistrationIntentSha256:
      digests.futureRegistrationIntentSha256!,
    candidateSha256: digests.candidateSha256!,
    authenticatedInputSha256: digests.authenticatedInputSha256!,
    linkSequence: captured.linkSequence,
    parsePagesRootSha256: digests.parsePagesRootSha256!,
    currentProgressSha256: digests.currentProgressSha256!,
    predecessorAndTailsSha256: digests.predecessorAndTailsSha256!,
    rangeSha256: digests.rangeSha256!,
    analyzerReleaseSha256: digests.analyzerReleaseSha256!,
    analyzerIdentitySha256: digests.analyzerIdentitySha256!,
    verifierIdentitySha256: digests.verifierIdentitySha256!,
  });
};

const captureAuthenticatedLinkModuleClaimV1 = (
  value: unknown,
): CapturedAuthenticatedLinkModuleClaimV1 | undefined => {
  const keys = [
    "attemptSha256",
    "futureRegistrationIntentSha256",
    "candidateSha256",
    "authenticatedInputSha256",
    "linkSequence",
    "parsePagesRootSha256",
    "currentProgressSha256",
    "predecessorAndTailsSha256",
    "rangeSha256",
    "analyzerReleaseSha256",
    "analyzerIdentitySha256",
    "verifierIdentitySha256",
    "moduleOrdinal",
    "producingParseResultSha256",
  ] as const;
  const captured = captureExactOwnedRecordV1(value, keys);
  if (
    captured === undefined ||
    typeof captured.moduleOrdinal !== "bigint" ||
    captured.moduleOrdinal < 0n ||
    captured.moduleOrdinal > MAX_SIGNED_INT64
  ) return undefined;
  const bindings = captureAuthenticatedLinkBindingsV1(
    Object.freeze(Object.fromEntries(
      keys.slice(0, 12).map(key => [key, captured[key]]),
    )),
  );
  const producingParseResultSha256 = captureOwnedSha256V1(
    captured.producingParseResultSha256,
  );
  return bindings === undefined || producingParseResultSha256 === undefined
    ? undefined
    : Object.freeze({
      ...bindings,
      moduleOrdinal: captured.moduleOrdinal,
      producingParseResultSha256,
    });
};

const authenticatedLinkBindingsEqualV1 = (
  left: CapturedAuthenticatedLinkBindingsV1,
  right: CapturedAuthenticatedLinkBindingsV1,
): boolean =>
  left.linkSequence === right.linkSequence &&
  AUTHENTICATED_LINK_DIGEST_FIELDS_V1.every(field =>
    bytesEqualFullScan(left[field], right[field])
  );

const checkedLinkCapacityAddV1 = (
  left: bigint,
  right: bigint,
  dimension: string,
): Result.Result<bigint, DeclarativeV2VerifierExecutableV1Error> => {
  const value = left + right;
  return value > MAX_SIGNED_INT64
    ? Result.fail(executableError("link", "addressabilityExceeded", {
      dimension,
      observed: value,
      maximum: MAX_SIGNED_INT64,
    }))
    : Result.succeed(value);
};

const checkedLinkCapacityMultiplyV1 = (
  left: bigint,
  right: bigint,
  dimension: string,
): Result.Result<bigint, DeclarativeV2VerifierExecutableV1Error> => {
  const value = left * right;
  return value > MAX_SIGNED_INT64
    ? Result.fail(executableError("link", "addressabilityExceeded", {
      dimension,
      observed: value,
      maximum: MAX_SIGNED_INT64,
    }))
    : Result.succeed(value);
};

const maximumBigIntV1 = (left: bigint, right: bigint): bigint =>
  left > right ? left : right;

const moduleTokenByteLengthV1 = (
  owned: DeclarativeV2VerifierOwnedModuleArenaV1,
  storedToken: number,
): bigint =>
  storedToken === 0 ? 0n : BigInt(sourceTokenLength(owned, storedToken - 1));

const finishLinkModuleCapacitySummaryV1 = (
  pending: PendingLinkModuleSummaryV1,
): Result.Result<
  LinkModuleCapacitySummaryV1,
  DeclarativeV2VerifierExecutableV1Error
> => Result.gen(function*() {
  const owned = pending.owned;
  const pathByteLength = BigInt(owned.moduleView.getUint32(4, false));
  const importCount = BigInt(owned.importCount);
  const exportCount = BigInt(owned.exportCount);
  const functionCount = BigInt(owned.functionCount);
  let importUnit = yield* checkedLinkCapacityAddV1(
    importCount,
    pending.maximumImportedNameByteLength,
    "calls",
  );
  importUnit = yield* checkedLinkCapacityAddV1(
    importUnit,
    pending.maximumModuleSpecifierByteLength,
    "calls",
  );
  importUnit = yield* checkedLinkCapacityAddV1(importUnit, 6n, "calls");
  let importWork = yield* checkedLinkCapacityMultiplyV1(
    importCount,
    importUnit,
    "calls",
  );
  importWork = yield* checkedLinkCapacityAddV1(importWork, 1n, "calls");
  let functionCompareUnit = yield* checkedLinkCapacityAddV1(
    pending.maximumExportLocalByteLength,
    pending.maximumFunctionNameByteLength,
    "calls",
  );
  functionCompareUnit = yield* checkedLinkCapacityAddV1(
    functionCompareUnit,
    4n,
    "calls",
  );
  const functionCompareWork = yield* checkedLinkCapacityMultiplyV1(
    functionCount,
    functionCompareUnit,
    "calls",
  );
  let exportUnit = yield* checkedLinkCapacityAddV1(
    exportCount,
    pending.maximumExportNameByteLength,
    "calls",
  );
  exportUnit = yield* checkedLinkCapacityAddV1(
    exportUnit,
    functionCompareWork,
    "calls",
  );
  exportUnit = yield* checkedLinkCapacityAddV1(exportUnit, 7n, "calls");
  let exportWork = yield* checkedLinkCapacityMultiplyV1(
    exportCount,
    exportUnit,
    "calls",
  );
  exportWork = yield* checkedLinkCapacityAddV1(exportWork, 2n, "calls");
  let copyTransitionCapacity = yield* checkedLinkCapacityAddV1(
    pathByteLength,
    importWork,
    "calls",
  );
  copyTransitionCapacity = yield* checkedLinkCapacityAddV1(
    copyTransitionCapacity,
    exportWork,
    "calls",
  );
  copyTransitionCapacity = yield* checkedLinkCapacityAddV1(
    copyTransitionCapacity,
    4n,
    "calls",
  );
  return Object.freeze({
    pathByteLength,
    importCount,
    exportCount,
    functionCount,
    copiedTextByteLength: pending.copiedTextByteLength,
    maximumImportedNameByteLength: pending.maximumImportedNameByteLength,
    maximumModuleSpecifierByteLength:
      pending.maximumModuleSpecifierByteLength,
    maximumExportNameByteLength: pending.maximumExportNameByteLength,
    maximumExportLocalByteLength: pending.maximumExportLocalByteLength,
    maximumFunctionNameByteLength: pending.maximumFunctionNameByteLength,
    copyTransitionCapacity,
  });
});

const closeAuthenticatedLinkAccumulatorStateV1 = (
  state: AuthenticatedLinkAccumulatorStateV1,
): void => {
  state.closed = true;
  state.bindings = undefined;
  state.commandBudget = undefined;
  state.pending = undefined;
  state.rawModules.splice(0);
  state.modules.splice(0);
  state.claims.splice(0);
  state.summaries.splice(0);
};

const closeAuthenticatedLinkDriverStateV1 = (
  state: AuthenticatedLinkDriverStateV1,
): void => {
  state.closed = true;
  state.bindings = undefined;
  state.capacity = undefined;
  state.rawModules.splice(0);
  state.modules.splice(0);
  state.claims.splice(0);
  const linker = state.linker;
  state.linker = undefined;
  if (linker !== undefined) {
    linker.pendingModule = undefined;
    if (linker.phase !== "complete") linker.phase = "failed";
  }
};

const freezeLinkCapacityV1 = (
  values: Readonly<Record<
    typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
    bigint
  >>,
): DeclarativeV2VerifierLinkCapacityV1 =>
  Object.freeze({
    _tag: "DeclarativeV2VerifierLinkCapacityV1",
    ...values,
  });

const linkCapacityAsRequiredUsageV1 = (
  capacity: DeclarativeV2VerifierLinkCapacityV1,
): DeclarativeV2VerifierBudgetFrameV2 =>
  Object.freeze({
    kind: "attempt_usage",
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
        dimension,
        capacity[dimension],
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2;

const deriveAuthenticatedLinkCapacityV1 = (
  summaries: readonly LinkModuleCapacitySummaryV1[],
  commandBudget: DeclarativeV2VerifierBudgetFrameV2,
): Result.Result<
  DeclarativeV2VerifierLinkCapacityV1,
  DeclarativeV2VerifierExecutableV1Error
> => Result.gen(function*() {
  const moduleCount = BigInt(summaries.length);
  let importCount = 0n;
  let exportCount = 0n;
  let functionCount = 0n;
  let copiedTextByteLength = 0n;
  let copyTransitionCapacity = 0n;
  let totalPathByteLength = 0n;
  let maximumPathByteLength = 0n;
  let maximumImportedNameByteLength = 0n;
  let maximumModuleSpecifierByteLength = 0n;
  let maximumExportNameByteLength = 0n;
  for (const summary of summaries) {
    importCount = yield* checkedLinkCapacityAddV1(
      importCount,
      summary.importCount,
      "importEdges",
    );
    exportCount = yield* checkedLinkCapacityAddV1(
      exportCount,
      summary.exportCount,
      "exports",
    );
    functionCount = yield* checkedLinkCapacityAddV1(
      functionCount,
      summary.functionCount,
      "functions",
    );
    copiedTextByteLength = yield* checkedLinkCapacityAddV1(
      copiedTextByteLength,
      summary.copiedTextByteLength,
      "outputBytes",
    );
    copyTransitionCapacity = yield* checkedLinkCapacityAddV1(
      copyTransitionCapacity,
      summary.copyTransitionCapacity,
      "calls",
    );
    totalPathByteLength = yield* checkedLinkCapacityAddV1(
      totalPathByteLength,
      summary.pathByteLength,
      "outputBytes",
    );
    maximumPathByteLength = maximumBigIntV1(
      maximumPathByteLength,
      summary.pathByteLength,
    );
    maximumImportedNameByteLength = maximumBigIntV1(
      maximumImportedNameByteLength,
      summary.maximumImportedNameByteLength,
    );
    maximumModuleSpecifierByteLength = maximumBigIntV1(
      maximumModuleSpecifierByteLength,
      summary.maximumModuleSpecifierByteLength,
    );
    maximumExportNameByteLength = maximumBigIntV1(
      maximumExportNameByteLength,
      summary.maximumExportNameByteLength,
    );
  }
  const graphNodes = yield* checkedLinkCapacityAddV1(
    moduleCount,
    importCount,
    "graphNodes",
  );
  const indexingTransitions = yield* checkedLinkCapacityAddV1(
    totalPathByteLength,
    moduleCount + 1n,
    "calls",
  );
  const orderingPairs = yield* checkedLinkCapacityMultiplyV1(
    moduleCount,
    moduleCount > 0n ? moduleCount - 1n : 0n,
    "calls",
  );
  const orderingTransitions = yield* checkedLinkCapacityMultiplyV1(
    orderingPairs / 2n,
    maximumPathByteLength + 1n,
    "calls",
  );
  const duplicateTransitions = yield* checkedLinkCapacityMultiplyV1(
    moduleCount > 0n ? moduleCount - 1n : 0n,
    maximumPathByteLength + 1n,
    "calls",
  );
  const pathSearchTransitions = yield* checkedLinkCapacityMultiplyV1(
    yield* checkedLinkCapacityMultiplyV1(importCount, moduleCount, "calls"),
    maximumPathByteLength + maximumModuleSpecifierByteLength + 1n,
    "calls",
  );
  const exportSearchTransitions = yield* checkedLinkCapacityMultiplyV1(
    yield* checkedLinkCapacityMultiplyV1(importCount, exportCount, "calls"),
    maximumImportedNameByteLength + maximumExportNameByteLength + 1n,
    "calls",
  );
  const linkAdministrativeTransitions = yield* checkedLinkCapacityAddV1(
    moduleCount * 4n,
    importCount * 5n + 8n,
    "calls",
  );
  const diagnosticOrderingTransitions = yield* checkedLinkCapacityMultiplyV1(
    yield* checkedLinkCapacityMultiplyV1(importCount, importCount, "calls"),
    importCount + 1n,
    "calls",
  );
  let coreTransitionCapacity = copyTransitionCapacity;
  for (const value of [
    indexingTransitions,
    orderingTransitions + 1n,
    duplicateTransitions + 1n,
    pathSearchTransitions,
    exportSearchTransitions,
    linkAdministrativeTransitions,
    diagnosticOrderingTransitions + 1n,
  ]) {
    coreTransitionCapacity = yield* checkedLinkCapacityAddV1(
      coreTransitionCapacity,
      value,
      "calls",
    );
  }
  const transitionCallCapacity =
    (coreTransitionCapacity + BigInt(DECLARATIVE_V2_VERIFIER_TRANSITION_QUANTUM_V1) -
      1n) /
    BigInt(DECLARATIVE_V2_VERIFIER_TRANSITION_QUANTUM_V1);
  const calls = yield* checkedLinkCapacityAddV1(
    3n + moduleCount,
    transitionCallCapacity,
    "calls",
  );
  const diagnosticDefinitionBytes = maximumBigIntV1(
    BigInt(
      utf8ByteLength(diagnosticDefinition("CORE_IMPORT_TARGET").code) +
        utf8ByteLength(diagnosticDefinition("CORE_IMPORT_TARGET").rule),
    ),
    BigInt(
      utf8ByteLength(diagnosticDefinition("CORE_MODULE_CYCLE").code) +
        utf8ByteLength(diagnosticDefinition("CORE_MODULE_CYCLE").rule),
    ),
  );
  const diagnosticBytes = yield* checkedLinkCapacityMultiplyV1(
    importCount,
    diagnosticDefinitionBytes,
    "diagnosticBytes",
  );
  const outputBytes = yield* checkedLinkCapacityAddV1(
    copiedTextByteLength,
    diagnosticBytes,
    "outputBytes",
  );
  const capacityValues = zeroUsage();
  capacityValues.calls = calls;
  capacityValues.modules = moduleCount;
  capacityValues.importEdges = importCount;
  capacityValues.exports = exportCount;
  capacityValues.graphNodes = graphNodes;
  capacityValues.frontierEntries = moduleCount;
  capacityValues.tableBytes = BigInt(
    GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetByteLength,
  );
  capacityValues.diagnosticBytes = diagnosticBytes;
  capacityValues.outputBytes = outputBytes;
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    if (capacityValues[dimension] > commandBudget[dimension]) {
      return yield* Result.fail(executableError(
        "link",
        "budgetExceeded",
        {
          dimension,
          observed: capacityValues[dimension],
          maximum: commandBudget[dimension],
        },
      ));
    }
  }
  for (const [dimension, value] of [
    ["modules", moduleCount],
    ["importEdges", importCount],
    ["exports", exportCount],
    ["graphNodes", graphNodes],
    ["frontierEntries", moduleCount],
  ] as const) {
    if (value > BigInt(MAX_U32)) {
      return yield* Result.fail(executableError(
        "link",
        "addressabilityExceeded",
        {
          dimension,
          observed: value,
          maximum: BigInt(MAX_U32),
        },
      ));
    }
  }
  return freezeLinkCapacityV1(capacityValues);
});

const actualUsageWithinCapacityV1 = (
  usage: Readonly<Record<
    typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
    bigint
  >>,
  capacity: DeclarativeV2VerifierLinkCapacityV1,
): Result.Result<void, DeclarativeV2VerifierExecutableV1Error> => {
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    if (usage[dimension] > capacity[dimension]) {
      return Result.fail(executableError("link", "invalidState", {
        dimension,
        observed: usage[dimension],
        maximum: capacity[dimension],
      }));
    }
  }
  return Result.succeed(undefined);
};

export function makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1(
  claimPort: DeclarativeV2VerifierAuthenticatedLinkClaimPortV1,
): DeclarativeV2VerifierAuthenticatedLinkFactoryV1 {
  const accumulators = new WeakMap<
    object,
    AuthenticatedLinkAccumulatorStateV1
  >();
  const drivers = new WeakMap<object, AuthenticatedLinkDriverStateV1>();

  const accumulatorHandle =
    (): DeclarativeV2VerifierAuthenticatedLinkAccumulatorV1 =>
      Object.freeze({
        _tag: "DeclarativeV2VerifierAuthenticatedLinkAccumulatorV1",
      });
  const driverHandle = (): DeclarativeV2VerifierAuthenticatedLinkDriverV1 =>
    Object.freeze({
      _tag: "DeclarativeV2VerifierAuthenticatedLinkDriverV1",
    });

  const failAccumulator = (
    state: AuthenticatedLinkAccumulatorStateV1,
    error: DeclarativeV2VerifierExecutableV1Error,
  ): Result.Result<never, DeclarativeV2VerifierExecutableV1Error> => {
    closeAuthenticatedLinkAccumulatorStateV1(state);
    return Result.fail(error);
  };

  const failDriver = (
    state: AuthenticatedLinkDriverStateV1,
    error: DeclarativeV2VerifierExecutableV1Error,
  ): Result.Result<never, DeclarativeV2VerifierExecutableV1Error> => {
    closeAuthenticatedLinkDriverStateV1(state);
    return Result.fail(error);
  };

  const failAcceptedDriver = (
    state: AuthenticatedLinkDriverStateV1,
    error: DeclarativeV2VerifierExecutableV1Error,
  ): Result.Result<never, DeclarativeV2VerifierExecutableV1Error> => {
    if (
      error.reason === "budgetExceeded" ||
      error.reason === "addressabilityExceeded" ||
      error.reason === "invalidState"
    ) {
      closeAuthenticatedLinkDriverStateV1(state);
      throw new Error(
        `Accepted authenticated link plan contradicted ${error.reason}` +
          (error.dimension === undefined ? "." : ` at ${error.dimension}.`),
      );
    }
    return failDriver(state, error);
  };

  const create: DeclarativeV2VerifierAuthenticatedLinkFactoryV1["create"] =
    (rawBindings, rawCommandBudget) => {
      const bindings = captureAuthenticatedLinkBindingsV1(rawBindings);
      const commandBudget = captureLocalBudgetFrame(
        rawCommandBudget,
        "command_budget",
      );
      if (bindings === undefined || commandBudget === undefined) {
        return Result.fail(executableError("link", "invalidInput"));
      }
      const state: AuthenticatedLinkAccumulatorStateV1 = {
        bindings,
        commandBudget,
        rawModules: [],
        modules: [],
        claims: [],
        summaries: [],
        pending: undefined,
        closed: false,
      };
      const handle = accumulatorHandle();
      accumulators.set(handle, state);
      return Result.succeed(handle);
    };

  const admit: DeclarativeV2VerifierAuthenticatedLinkFactoryV1["admit"] =
    (rawAccumulator, rawModule, rawAllowance) => {
      const state = rawAccumulator !== null && typeof rawAccumulator === "object"
        ? accumulators.get(rawAccumulator)
        : undefined;
      if (state === undefined) {
        return Result.fail(executableError("link", "invalidInput"));
      }
      if (state.closed) {
        return Result.fail(executableError("link", "closed"));
      }
      const allowance = captureTransitionAllowance(rawAllowance, "link");
      if (Result.isFailure(allowance)) {
        return failAccumulator(state, allowance.failure);
      }
      if (allowance.success === 0) {
        return Result.succeed(Object.freeze({
          status: state.pending === undefined ? "ready" : "pending",
          transitionCount: 0,
          admittedModuleCount: BigInt(state.modules.length),
        }));
      }
      let transitions = 0;
      if (state.pending === undefined) {
        if (rawModule === null || typeof rawModule !== "object") {
          return failAccumulator(
            state,
            executableError("link", "invalidInput"),
          );
        }
        const owned = OWNED_MODULE_RESULTS.get(rawModule);
        if (
          owned === undefined ||
          AUTHENTICATED_LINK_CLAIMED_MODULES_V1.has(rawModule)
        ) {
          return failAccumulator(
            state,
            executableError("link", "invalidInput"),
          );
        }
        const rawClaim = claimPort.claim(
          rawModule as DeclarativeV2VerifierModuleResultV1,
        );
        if (Result.isFailure(rawClaim)) {
          return failAccumulator(state, rawClaim.failure);
        }
        const claim = captureAuthenticatedLinkModuleClaimV1(rawClaim.success);
        const bindings = state.bindings;
        const producingParseResultSha256 = captureVerifierEvidenceSha256V1(
          owned.evidenceSha256,
        );
        if (
          claim === undefined ||
          bindings === undefined ||
          producingParseResultSha256 === undefined ||
          !authenticatedLinkBindingsEqualV1(bindings, claim) ||
          claim.moduleOrdinal !== BigInt(state.modules.length) ||
          claim.moduleOrdinal !== owned.moduleOrdinal ||
          !bytesEqualFullScan(
            claim.producingParseResultSha256,
            producingParseResultSha256,
          )
        ) {
          return failAccumulator(
            state,
            executableError("link", "invalidInput"),
          );
        }
        AUTHENTICATED_LINK_CLAIMED_MODULES_V1.add(rawModule);
        const pathByteLength = BigInt(owned.moduleView.getUint32(4, false));
        state.pending = {
          rawModule,
          owned,
          claim,
          phase: "imports",
          index: 0,
          copiedTextByteLength: pathByteLength,
          maximumImportedNameByteLength: 0n,
          maximumModuleSpecifierByteLength: 0n,
          maximumExportNameByteLength: 0n,
          maximumExportLocalByteLength: 0n,
          maximumFunctionNameByteLength: 0n,
        };
        transitions += 1;
      } else if (state.pending.rawModule !== rawModule) {
        return failAccumulator(
          state,
          executableError("link", "invalidInput"),
        );
      }
      while (transitions < allowance.success && state.pending !== undefined) {
        const pending = state.pending;
        const owned = pending.owned;
        if (pending.phase === "imports") {
          if (pending.index >= owned.importCount) {
            pending.phase = "exports";
            pending.index = 0;
            transitions += 1;
            continue;
          }
          const offset = pending.index * 64;
          const importedStored = owned.importEdgeView.getUint32(
            offset + 4,
            false,
          );
          const specifierStored = owned.importEdgeView.getUint32(
            offset + 12,
            false,
          );
          const importedLength = importedStored === 0
            ? 7n
            : moduleTokenByteLengthV1(owned, importedStored);
          const rawSpecifierLength = moduleTokenByteLengthV1(
            owned,
            specifierStored,
          );
          if (rawSpecifierLength < 2n) {
            closeAuthenticatedLinkAccumulatorStateV1(state);
            throw new Error("Accepted verifier import lost quoted specifier.");
          }
          const specifierLength = rawSpecifierLength - 2n;
          pending.copiedTextByteLength += importedLength + specifierLength;
          pending.maximumImportedNameByteLength = maximumBigIntV1(
            pending.maximumImportedNameByteLength,
            importedLength,
          );
          pending.maximumModuleSpecifierByteLength = maximumBigIntV1(
            pending.maximumModuleSpecifierByteLength,
            specifierLength,
          );
          pending.index += 1;
          transitions += 1;
          continue;
        }
        if (pending.phase === "exports") {
          if (pending.index >= owned.exportCount) {
            pending.phase = "functions";
            pending.index = 0;
            transitions += 1;
            continue;
          }
          const offset = pending.index * 48;
          const isDefault = owned.exportView.getUint32(offset + 8, false) === 1;
          const exportedStored = owned.exportView.getUint32(offset, false);
          const localStored = owned.exportView.getUint32(offset + 4, false);
          const exportedLength = isDefault
            ? 7n
            : moduleTokenByteLengthV1(owned, exportedStored);
          const localLength = moduleTokenByteLengthV1(owned, localStored);
          if (exportedLength === 0n || localLength === 0n) {
            closeAuthenticatedLinkAccumulatorStateV1(state);
            throw new Error("Accepted verifier export lost owned names.");
          }
          pending.copiedTextByteLength += exportedLength;
          pending.maximumExportNameByteLength = maximumBigIntV1(
            pending.maximumExportNameByteLength,
            exportedLength,
          );
          pending.maximumExportLocalByteLength = maximumBigIntV1(
            pending.maximumExportLocalByteLength,
            localLength,
          );
          pending.index += 1;
          transitions += 1;
          continue;
        }
        if (pending.phase === "functions") {
          if (pending.index >= owned.functionCount) {
            pending.phase = "complete";
            transitions += 1;
            continue;
          }
          const stored = owned.functionView.getUint32(
            pending.index * 144,
            false,
          );
          const length = moduleTokenByteLengthV1(owned, stored);
          if (length === 0n) {
            closeAuthenticatedLinkAccumulatorStateV1(state);
            throw new Error("Accepted verifier function lost owned name.");
          }
          pending.maximumFunctionNameByteLength = maximumBigIntV1(
            pending.maximumFunctionNameByteLength,
            length,
          );
          pending.index += 1;
          transitions += 1;
          continue;
        }
        const summary = finishLinkModuleCapacitySummaryV1(pending);
        if (Result.isFailure(summary)) {
          return failAccumulator(state, summary.failure);
        }
        state.rawModules.push(
          pending.rawModule as DeclarativeV2VerifierModuleResultV1,
        );
        state.modules.push(owned);
        state.claims.push(pending.claim);
        state.summaries.push(summary.success);
        state.pending = undefined;
        transitions += 1;
      }
      return Result.succeed(Object.freeze({
        status: state.pending === undefined ? "ready" : "pending",
        transitionCount: transitions,
        admittedModuleCount: BigInt(state.modules.length),
      }));
    };

  const seal: DeclarativeV2VerifierAuthenticatedLinkFactoryV1["seal"] =
    (rawAccumulator, rawAllowance) => {
      const state = rawAccumulator !== null && typeof rawAccumulator === "object"
        ? accumulators.get(rawAccumulator)
        : undefined;
      if (state === undefined) {
        return Result.fail(executableError("link", "invalidInput"));
      }
      if (state.closed) {
        return Result.fail(executableError("link", "closed"));
      }
      const allowance = captureTransitionAllowance(rawAllowance, "link");
      if (Result.isFailure(allowance)) {
        return failAccumulator(state, allowance.failure);
      }
      if (allowance.success === 0) {
        return Result.succeed(Object.freeze({
          status: "pending",
          transitionCount: 0,
        }));
      }
      if (
        state.pending !== undefined ||
        state.modules.length === 0 ||
        state.commandBudget === undefined
      ) {
        return failAccumulator(
          state,
          executableError("link", "invalidState"),
        );
      }
      const capacity = deriveAuthenticatedLinkCapacityV1(
        state.summaries,
        state.commandBudget,
      );
      if (Result.isFailure(capacity)) {
        return failAccumulator(state, capacity.failure);
      }
      const created = createDeclarativeV2VerifierLinkerV1(
        state.commandBudget,
        linkCapacityAsRequiredUsageV1(capacity.success),
      );
      if (Result.isFailure(created)) {
        return failAccumulator(state, created.failure);
      }
      const linker = OWNED_LINKERS.get(created.success);
      if (linker === undefined) {
        closeAuthenticatedLinkAccumulatorStateV1(state);
        throw new Error("Accepted authenticated link plan lost its linker.");
      }
      const sealCharge = linkUsageCharge(linker, "calls", 1n);
      if (Result.isFailure(sealCharge)) {
        return failAccumulator(state, sealCharge.failure);
      }
      const driverState: AuthenticatedLinkDriverStateV1 = {
        bindings: state.bindings,
        capacity: capacity.success,
        linker,
        rawModules: state.rawModules.splice(0),
        modules: state.modules.splice(0),
        claims: state.claims.splice(0),
        moduleIndex: 0,
        coreTransitionCount: 0n,
        closed: false,
      };
      state.summaries.splice(0);
      state.bindings = undefined;
      state.commandBudget = undefined;
      state.closed = true;
      const handle = driverHandle();
      drivers.set(handle, driverState);
      return Result.succeed(Object.freeze({
        status: "complete",
        transitionCount: 1,
        driver: handle,
        capacity: capacity.success,
      }));
    };

  const step: DeclarativeV2VerifierAuthenticatedLinkFactoryV1["step"] =
    (rawDriver, rawAllowance) => {
      const state = rawDriver !== null && typeof rawDriver === "object"
        ? drivers.get(rawDriver)
        : undefined;
      if (state === undefined) {
        return Result.fail(executableError("link", "invalidInput"));
      }
      const linker = state.linker;
      if (state.closed || state.capacity === undefined || linker === undefined) {
        return Result.fail(executableError("link", "closed"));
      }
      const allowance = captureTransitionAllowance(rawAllowance, "link");
      if (Result.isFailure(allowance)) {
        return failDriver(state, allowance.failure);
      }
      const before = usageSnapshot(linker.usage);
      if (allowance.success === 0) {
        return Result.succeed(Object.freeze({
          status: "pending",
          transitionCount: 0,
          deltaUsage: frozenUsageDelta(linker.usage, before),
          usage: frozenUsage(linker.usage),
        }));
      }
      let transitions = 0;
      while (transitions < allowance.success) {
        if (
          linker.phase === "accepting" &&
          state.moduleIndex < state.modules.length
        ) {
          const module = state.modules[state.moduleIndex]!;
          const charges = [
            ["calls", 1n],
            ["modules", 1n],
            ["graphNodes", 1n + BigInt(module.importCount)],
            ["importEdges", BigInt(module.importCount)],
            ["exports", BigInt(module.exportCount)],
          ] as const;
          for (const [dimension, amount] of charges) {
            const charged = linkUsageCharge(linker, dimension, amount);
            if (Result.isFailure(charged)) {
              return failAcceptedDriver(state, charged.failure);
            }
          }
          if (
            linker.count >=
              Math.floor(linker.moduleView.byteLength / 64) ||
            linker.importCount + module.importCount >
              Math.floor(linker.importEdgeView.byteLength / 64) ||
            linker.exportCount + module.exportCount >
              Math.floor(linker.exportView.byteLength / 48)
          ) {
            return failAcceptedDriver(
              state,
              executableError("link", "addressabilityExceeded"),
            );
          }
          linker.pendingModule = module;
          linker.phase = "copyingModule";
          linker.copyPhase = "modulePath";
          linker.copySourceRecord = 0;
          linker.copyRecordOrder = 0;
          linker.copyByteIndex = 0;
          linker.copyImportStart = linker.importCount;
          linker.copyExportStart = linker.exportCount;
          const moduleOffset = linker.count * 64;
          linker.moduleView.setUint32(
            moduleOffset,
            linker.textCursor,
            false,
          );
          linker.moduleView.setUint32(moduleOffset + 4, 0, false);
          linker.moduleView.setBigUint64(
            moduleOffset + 8,
            module.moduleOrdinal,
            false,
          );
          linker.moduleView.setUint32(
            moduleOffset + 16,
            linker.importCount,
            false,
          );
          linker.moduleView.setUint32(
            moduleOffset + 20,
            module.importCount,
            false,
          );
          linker.moduleView.setUint32(
            moduleOffset + 24,
            linker.exportCount,
            false,
          );
          linker.moduleView.setUint32(
            moduleOffset + 28,
            module.exportCount,
            false,
          );
          linker.graph.setUint32(
            linker.count * 64,
            linker.count,
            false,
          );
          state.moduleIndex += 1;
          transitions += 1;
          continue;
        }
        if (
          linker.phase === "accepting" &&
          state.moduleIndex === state.modules.length
        ) {
          linker.sealed = true;
          linker.phase = "indexing";
          transitions += 1;
          continue;
        }
        if (linker.phase === "complete") {
          const terminalCharge = linkUsageCharge(
            linker,
            "calls",
            1n,
          );
          if (Result.isFailure(terminalCharge)) {
            return failAcceptedDriver(state, terminalCharge.failure);
          }
          const withinCapacity = actualUsageWithinCapacityV1(
            linker.usage,
            state.capacity,
          );
          if (Result.isFailure(withinCapacity)) {
            return failAcceptedDriver(state, withinCapacity.failure);
          }
          const result = Object.freeze({
            _tag: "DeclarativeV2VerifierLinkResultV1",
            moduleCount: BigInt(linker.count),
            diagnosticCount: BigInt(linker.diagnosticCount),
            usage: frozenUsage(linker.usage),
          } satisfies DeclarativeV2VerifierLinkResultV1);
          const registration: AuthenticatedRegistrationPresentationV1 = {
            bindings: state.bindings,
            rawModules: state.rawModules.splice(0),
            modules: state.modules.splice(0),
            claims: state.claims.splice(0),
            claimed: false,
          };
          state.bindings = undefined;
          OWNED_LINK_RESULTS.set(result, { state: linker, registration });
          transitions += 1;
          closeAuthenticatedLinkDriverStateV1(state);
          return Result.succeed(result);
        }
        if (
          state.coreTransitionCount %
              BigInt(DECLARATIVE_V2_VERIFIER_TRANSITION_QUANTUM_V1) ===
            0n
        ) {
          const callCharge = linkUsageCharge(linker, "calls", 1n);
          if (Result.isFailure(callCharge)) {
            return failAcceptedDriver(state, callCharge.failure);
          }
        }
        const advanced = advanceLinkerOne(linker);
        if (Result.isFailure(advanced)) {
          return failAcceptedDriver(state, advanced.failure);
        }
        state.coreTransitionCount += 1n;
        transitions += 1;
      }
      return Result.succeed(Object.freeze({
        status: "pending",
        transitionCount: transitions,
        deltaUsage: frozenUsageDelta(linker.usage, before),
        usage: frozenUsage(linker.usage),
      }));
    };

  const close: DeclarativeV2VerifierAuthenticatedLinkFactoryV1["close"] =
    rawCapability => {
      if (rawCapability === null || typeof rawCapability !== "object") {
        return Result.fail(executableError("link", "invalidInput"));
      }
      const accumulator = accumulators.get(rawCapability);
      if (accumulator !== undefined) {
        if (accumulator.closed) {
          return Result.fail(executableError("link", "closed"));
        }
        closeAuthenticatedLinkAccumulatorStateV1(accumulator);
        return Result.succeed(undefined);
      }
      const driver = drivers.get(rawCapability);
      if (driver === undefined) {
        return Result.fail(executableError("link", "invalidInput"));
      }
      if (driver.closed) {
        return Result.fail(executableError("link", "closed"));
      }
      closeAuthenticatedLinkDriverStateV1(driver);
      return Result.succeed(undefined);
    };

  const adoptRestarted:
    DeclarativeV2VerifierAuthenticatedLinkFactoryV1["adoptRestarted"] =
      (rawResult, rawBindings, rawModules) => {
        const presentation =
          rawResult !== null && typeof rawResult === "object"
            ? OWNED_LINK_RESULTS.get(rawResult)
            : undefined;
        const bindings = captureAuthenticatedLinkBindingsV1(rawBindings);
        if (
          presentation === undefined ||
          presentation.registration !== undefined ||
          bindings === undefined ||
          !Array.isArray(rawModules) ||
          BigInt(rawModules.length) !==
            (rawResult as DeclarativeV2VerifierLinkResultV1).moduleCount
        ) {
          return Result.fail(executableError("link", "invalidInput"));
        }
        const modules: DeclarativeV2VerifierOwnedModuleArenaV1[] = [];
        const claims: DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1[] = [];
        for (let index = 0; index < rawModules.length; index += 1) {
          const rawModule = rawModules[index];
          const module =
            rawModule !== null && typeof rawModule === "object"
              ? OWNED_MODULE_RESULTS.get(rawModule)
              : undefined;
          const producingParseResultSha256 = module === undefined
            ? undefined
            : captureVerifierEvidenceSha256V1(module.evidenceSha256);
          if (
            module === undefined ||
            producingParseResultSha256 === undefined ||
            module.moduleOrdinal !== BigInt(index) ||
            AUTHENTICATED_LINK_CLAIMED_MODULES_V1.has(rawModule as object)
          ) {
            return Result.fail(executableError("link", "invalidInput"));
          }
          modules.push(module);
          claims.push(Object.freeze({
            ...bindings,
            moduleOrdinal: module.moduleOrdinal,
            producingParseResultSha256,
          }));
        }
        for (const rawModule of rawModules) {
          AUTHENTICATED_LINK_CLAIMED_MODULES_V1.add(rawModule as object);
        }
        presentation.registration = {
          bindings,
          rawModules:
            rawModules.slice() as DeclarativeV2VerifierModuleResultV1[],
          modules,
          claims,
          claimed: false,
        };
        return Result.succeed(undefined);
      };

  const COMPLETED_LINK_TARGET_ARTIFACT_V1 = 1;
  const COMPLETED_LINK_TARGET_LOCAL_V1 = 3;
  const completedClaims = new WeakMap<object, CompletedLinkClaimStateV1>();
  const completedLookups = new WeakMap<object, CompletedLinkLookupStateV1>();

  const completedClaimHandle = (): DeclarativeV2VerifierCompletedLinkClaimV1 =>
    Object.freeze({
      _tag: "DeclarativeV2VerifierCompletedLinkClaimV1",
    }) as DeclarativeV2VerifierCompletedLinkClaimV1;
  const completedLookupHandle = (): DeclarativeV2VerifierCompletedLinkLookupV1 =>
    Object.freeze({
      _tag: "DeclarativeV2VerifierCompletedLinkLookupV1",
    }) as DeclarativeV2VerifierCompletedLinkLookupV1;
  const lookupUsage = (
    state: CompletedLinkLookupStateV1,
  ): DeclarativeV2VerifierCompletedLinkLookupUsageV1 =>
    Object.freeze({
      calls: state.calls,
      exports: state.exports,
      frontierEntries: state.frontierEntries,
      stringBytes: state.stringBytes,
    });
  const releaseCompletedLookup = (state: CompletedLinkLookupStateV1): void => {
    state.closed = true;
    state.modulePath = undefined;
    state.exportName = undefined;
    state.expectedUtf8.source = undefined;
    state.reachableModuleIndexes.splice(0);
    state.reachableFunctionIndexes.splice(0);
    state.reachableVisited.clear();
    const claim = state.claim;
    state.claim = undefined;
    if (claim?.activeLookup !== undefined) claim.activeLookup = undefined;
  };
  const releaseCompletedClaim = (state: CompletedLinkClaimStateV1): void => {
    state.closed = true;
    state.linker = undefined;
    state.bindings = undefined;
    state.rawModules.splice(0);
    state.modules.splice(0);
    state.claims.splice(0);
    state.activeLookup = undefined;
  };
  const invalidateRegistrationPresentation = (
    presentation: AuthenticatedRegistrationPresentationV1,
  ): void => {
    presentation.claimed = true;
    presentation.bindings = undefined;
    presentation.rawModules.splice(0);
    presentation.modules.splice(0);
    presentation.claims.splice(0);
  };
  const lookupComplete = (
    state: CompletedLinkLookupStateV1,
    transitions: number,
  ): DeclarativeV2VerifierCompletedLinkLookupStepV1 => {
    if (!state.terminalCharged) {
      state.calls += 1n;
      state.terminalCharged = true;
    }
    const claim = state.claim;
    const moduleClaim = state.found
      ? claim?.claims[state.moduleIndex]
      : undefined;
    const result = Object.freeze({
      status: "complete",
      transitionCount: transitions,
      found: state.found,
      moduleOrdinal: moduleClaim?.moduleOrdinal ?? null,
      producingParseResultSha256:
        moduleClaim === undefined
          ? null
          : new Uint8Array(moduleClaim.producingParseResultSha256),
      usesRunMutation: state.found ? state.usesRunMutation : null,
      usage: lookupUsage(state),
    }) satisfies DeclarativeV2VerifierCompletedLinkLookupStepV1;
    releaseCompletedLookup(state);
    return result;
  };

  const completedLinkClaimPort: DeclarativeV2VerifierCompletedLinkClaimPortV1 =
    Object.freeze({
      claim: (rawResult: unknown, rawExpectedBindings: unknown) => {
        const presentation =
          rawResult !== null && typeof rawResult === "object"
            ? OWNED_LINK_RESULTS.get(rawResult)
            : undefined;
        const registration = presentation?.registration;
        const expected = captureAuthenticatedLinkBindingsV1(
          rawExpectedBindings,
        );
        if (
          presentation === undefined ||
          registration === undefined ||
          registration.claimed ||
          registration.bindings === undefined ||
          expected === undefined ||
          registration.rawModules.length !== registration.modules.length ||
          registration.modules.length !== registration.claims.length ||
          registration.modules.length !== Number(
            (rawResult as DeclarativeV2VerifierLinkResultV1).moduleCount,
          ) ||
          !authenticatedLinkBindingsEqualV1(registration.bindings, expected)
        ) {
          if (registration !== undefined && !registration.claimed) {
            invalidateRegistrationPresentation(registration);
          }
          return Result.fail(executableError("link", "invalidInput"));
        }
        registration.claimed = true;
        const state: CompletedLinkClaimStateV1 = {
          linker: presentation.state,
          bindings: registration.bindings,
          rawModules: registration.rawModules.splice(0),
          modules: registration.modules.splice(0),
          claims: registration.claims.splice(0),
          activeLookup: undefined,
          closed: false,
        };
        registration.bindings = undefined;
        presentation.registration = undefined;
        const handle = completedClaimHandle();
        completedClaims.set(handle, state);
        return Result.succeed(handle);
      },
      beginHandlerLookup: (
        rawClaim: unknown,
        rawModulePath: unknown,
        rawExportName: unknown,
      ) => {
        const state =
          rawClaim !== null && typeof rawClaim === "object"
            ? completedClaims.get(rawClaim)
            : undefined;
        if (state === undefined || state.closed) {
          return Result.fail(executableError("access", "closed"));
        }
        if (
          typeof rawModulePath !== "string" ||
          rawModulePath.length === 0 ||
          typeof rawExportName !== "string" ||
          rawExportName.length === 0 ||
          state.activeLookup !== undefined
        ) {
          releaseCompletedClaim(state);
          return Result.fail(executableError("access", "invalidInput"));
        }
        const lookupState: CompletedLinkLookupStateV1 = {
          claim: state,
          modulePath: rawModulePath,
          exportName: rawExportName,
          expectedUtf8: {
            source: undefined,
            sourceIndex: 0,
            scalar: 0,
            scalarByteIndex: 0,
            scalarByteLength: 0,
          },
          phase: "findModule",
          moduleIndex: 0,
          exportIndex: 0,
          functionIndex: 0,
          callIndex: 0,
          localToken: -1,
          targetToken: -1,
          targetFunctionIndex: 0,
          reachableModuleIndexes: [],
          reachableFunctionIndexes: [],
          reachableVisited: new Map(),
          reachableIndex: 0,
          byteIndex: 0,
          transitionCount: 0n,
          terminalCharged: false,
          found: false,
          usesRunMutation: false,
          calls: 1n,
          exports: 0n,
          frontierEntries: 0n,
          stringBytes: 0n,
          closed: false,
        };
        const handle = completedLookupHandle();
        lookupState.claim!.activeLookup = handle;
        completedLookups.set(handle, lookupState);
        return Result.succeed(handle);
      },
      stepHandlerLookup: (rawLookup: unknown, rawAllowance: unknown) => {
        const state =
          rawLookup !== null && typeof rawLookup === "object"
            ? completedLookups.get(rawLookup)
            : undefined;
        if (state === undefined || state.closed || state.claim?.closed) {
          return Result.fail(executableError("access", "closed"));
        }
        const allowance = captureTransitionAllowance(rawAllowance, "link");
        if (Result.isFailure(allowance)) {
          const claim = state.claim;
          releaseCompletedLookup(state);
          if (claim !== undefined) releaseCompletedClaim(claim);
          return Result.fail(allowance.failure);
        }
        if (allowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            transitionCount: 0,
            usage: lookupUsage(state),
          }));
        }
        let transitions = 0;
        const claim = state.claim;
        if (claim === undefined) {
          throw new Error("Accepted completed-link lookup lost its claim.");
        }
        let invalid = false;
        while (
          transitions < allowance.success &&
          state.phase !== "complete" &&
          !invalid
        ) {
          if (
            state.transitionCount %
                BigInt(DECLARATIVE_V2_VERIFIER_TRANSITION_QUANTUM_V1) ===
              0n
          ) {
            state.calls += 1n;
          }
          const module = claim.modules[state.moduleIndex];
          if (state.phase === "findModule") {
            if (module === undefined) {
              state.phase = "complete";
            } else {
              state.frontierEntries += 1n;
              resetIncrementalUtf8StringCursorV1(
                state.expectedUtf8,
                state.modulePath!,
              );
              state.phase = "compareModule";
              state.byteIndex = 0;
            }
          } else if (state.phase === "compareModule") {
            const length = module!.moduleView.getUint32(4, false);
            const expected = nextIncrementalUtf8ByteV1(state.expectedUtf8);
            if (expected === undefined && state.byteIndex >= length) {
              state.phase = "findExport";
              state.exportIndex = 0;
              state.byteIndex = 0;
            } else if (expected === undefined || state.byteIndex >= length) {
              state.moduleIndex += 1;
              state.phase = "findModule";
              state.byteIndex = 0;
            } else {
              state.stringBytes += 1n;
              const offset = module!.moduleView.getUint32(0, false);
              if (
                module!.outputBytes[offset + state.byteIndex] !==
                  expected
              ) {
                state.moduleIndex += 1;
                state.phase = "findModule";
                state.byteIndex = 0;
              } else {
                state.byteIndex += 1;
              }
            }
          } else if (state.phase === "findExport") {
            if (state.exportIndex >= module!.exportCount) {
              state.moduleIndex += 1;
              state.phase = "findModule";
              state.byteIndex = 0;
            } else {
              state.exports += 1n;
              state.frontierEntries += 1n;
              resetIncrementalUtf8StringCursorV1(
                state.expectedUtf8,
                state.exportName!,
              );
              state.phase = "compareExport";
              state.byteIndex = 0;
            }
          } else if (state.phase === "compareExport") {
            const offset = state.exportIndex * 48;
            const isDefault = module!.exportView.getUint32(offset + 8, false) === 1;
            const stored = module!.exportView.getUint32(offset, false);
            const token = stored - 1;
            const length = isDefault ? 7 : sourceTokenLength(module!, token);
            const expected = nextIncrementalUtf8ByteV1(state.expectedUtf8);
            if (expected === undefined && state.byteIndex >= length) {
              state.localToken =
                module!.exportView.getUint32(offset + 4, false) - 1;
              state.functionIndex = 0;
              state.byteIndex = 0;
              state.phase = "findFunction";
            } else if (expected === undefined || state.byteIndex >= length) {
              state.exportIndex += 1;
              state.phase = "findExport";
              state.byteIndex = 0;
            } else {
              state.stringBytes += 1n;
              const actual = isDefault
                ? "default".charCodeAt(state.byteIndex)
                : module!.stringBytes[
                    tokenOffsetV1(module!, token) + state.byteIndex
                  ];
              if (actual !== expected) {
                state.exportIndex += 1;
                state.phase = "findExport";
                state.byteIndex = 0;
              } else {
                state.byteIndex += 1;
              }
            }
          } else if (state.phase === "findFunction") {
            if (state.functionIndex >= module!.functionCount) {
              state.exportIndex += 1;
              state.phase = "findExport";
              state.byteIndex = 0;
            } else {
              state.frontierEntries += 1n;
              const functionToken =
                module!.functionView.getUint32(
                  state.functionIndex * 144,
                  false,
                ) - 1;
              if (
                tokenLengthV1(module!, functionToken) !==
                  tokenLengthV1(module!, state.localToken)
              ) {
                state.functionIndex += 1;
              } else {
                state.phase = "compareFunction";
                state.byteIndex = 0;
              }
            }
          } else if (state.phase === "compareFunction") {
            const functionToken =
              module!.functionView.getUint32(state.functionIndex * 144, false) - 1;
            const length = tokenLengthV1(module!, functionToken);
            if (state.byteIndex >= length) {
              state.found = true;
              state.reachableVisited.set(
                state.moduleIndex,
                new Set([state.functionIndex]),
              );
              state.reachableModuleIndexes.push(state.moduleIndex);
              state.reachableFunctionIndexes.push(state.functionIndex);
              state.reachableIndex = 0;
              state.callIndex = 0;
              state.phase = "scanReachableCalls";
            } else {
              state.stringBytes += 1n;
              if (
                module!.stringBytes[
                  tokenOffsetV1(module!, functionToken) + state.byteIndex
                ] !==
                  module!.stringBytes[
                    tokenOffsetV1(module!, state.localToken) + state.byteIndex
                  ]
              ) {
                state.functionIndex += 1;
                state.phase = "findFunction";
                state.byteIndex = 0;
              } else {
                state.byteIndex += 1;
              }
            }
          } else if (state.phase === "scanReachableCalls") {
            if (state.reachableIndex >= state.reachableModuleIndexes.length) {
              state.phase = "complete";
            } else {
              const reachableModuleIndex =
                state.reachableModuleIndexes[state.reachableIndex]!;
              const reachableFunctionIndex =
                state.reachableFunctionIndexes[state.reachableIndex]!;
              const reachableModule = claim.modules[reachableModuleIndex];
              if (reachableModule === undefined) {
                invalid = true;
              } else if (state.callIndex >= reachableModule.callCount) {
                state.reachableIndex += 1;
                state.callIndex = 0;
              } else {
                state.frontierEntries += 1n;
                const offset =
                  (reachableModule.importCount + state.callIndex) * 64;
                state.callIndex += 1;
                const caller = reachableModule.importEdgeView.getUint32(
                  offset + 20,
                  false,
                );
                if (caller === reachableFunctionIndex + 1) {
                  const abiStored = reachableModule.importEdgeView.getUint32(
                    offset + 36,
                    false,
                  );
                  const abi = abiStored === 0
                    ? undefined
                    : DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1[abiStored - 1];
                  if (abi?.name === "runMutation") {
                    state.usesRunMutation = true;
                    state.phase = "complete";
                  } else if (abiStored === 0) {
                    const targetStored =
                      reachableModule.importEdgeView.getUint32(
                        offset + 24,
                        false,
                      );
                    const targetKind =
                      reachableModule.importEdgeView.getUint32(
                        offset + 16,
                        false,
                      );
                    if (targetStored === 0) {
                      invalid = true;
                    } else if (targetKind === COMPLETED_LINK_TARGET_LOCAL_V1) {
                      state.targetToken = targetStored - 1;
                      state.targetFunctionIndex = 0;
                      state.byteIndex = 0;
                      state.phase = "findLocalTarget";
                    } else if (
                      targetKind === COMPLETED_LINK_TARGET_ARTIFACT_V1
                    ) {
                      const importStored =
                        reachableModule.importEdgeView.getUint32(
                          offset + 28,
                          false,
                        );
                      if (importStored === 0) {
                        invalid = true;
                      } else {
                        const linker: LinkerStateV1 | undefined = claim.linker;
                        const linkerModuleOffset = reachableModuleIndex * 64;
                        const linkerImportStart = linker?.moduleView.getUint32(
                          linkerModuleOffset + 16,
                          false,
                        );
                        const linkerImportCount = linker?.moduleView.getUint32(
                          linkerModuleOffset + 20,
                          false,
                        );
                        const importIndex = importStored - 1;
                        if (
                          linker === undefined ||
                          linkerImportStart === undefined ||
                          linkerImportCount === undefined ||
                          importIndex >= linkerImportCount
                        ) {
                          invalid = true;
                        } else {
                          const linkerImportOffset =
                            (linkerImportStart + importIndex) * 64;
                          const resolvedModuleStored =
                            linker.importEdgeView.getUint32(
                              linkerImportOffset + 20,
                              false,
                            );
                          const resolvedFunctionStored: number =
                            linker.importEdgeView.getUint32(
                              linkerImportOffset + 24,
                              false,
                            );
                          const resolvedModuleIndex = resolvedModuleStored - 1;
                          const resolvedFunctionIndex =
                            resolvedFunctionStored - 1;
                          const resolvedModule =
                            claim.modules[resolvedModuleIndex];
                          let visited =
                            state.reachableVisited.get(resolvedModuleIndex);
                          if (
                            resolvedModuleStored === 0 ||
                            resolvedFunctionStored === 0 ||
                            resolvedModule === undefined ||
                            resolvedFunctionIndex >= resolvedModule.functionCount
                          ) {
                            invalid = true;
                          } else {
                            if (visited === undefined) {
                              visited = new Set();
                              state.reachableVisited.set(
                                resolvedModuleIndex,
                                visited,
                              );
                            }
                            if (!visited.has(resolvedFunctionIndex)) {
                              visited.add(resolvedFunctionIndex);
                              state.reachableModuleIndexes.push(
                                resolvedModuleIndex,
                              );
                              state.reachableFunctionIndexes.push(
                                resolvedFunctionIndex,
                              );
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          } else if (state.phase === "findLocalTarget") {
            const sourceModuleIndex =
              state.reachableModuleIndexes[state.reachableIndex]!;
            const sourceModule = claim.modules[sourceModuleIndex];
            if (sourceModule === undefined) {
              invalid = true;
            } else if (
              state.targetFunctionIndex >= sourceModule.functionCount
            ) {
              invalid = true;
            } else {
              const candidateToken = sourceModule.functionView.getUint32(
                state.targetFunctionIndex * 144,
                false,
              ) - 1;
              if (
                tokenLengthV1(sourceModule, candidateToken) !==
                  tokenLengthV1(sourceModule, state.targetToken)
              ) {
                state.targetFunctionIndex += 1;
              } else {
                state.byteIndex = 0;
                state.phase = "compareLocalTarget";
              }
            }
          } else if (state.phase === "compareLocalTarget") {
            const sourceModuleIndex =
              state.reachableModuleIndexes[state.reachableIndex]!;
            const sourceModule = claim.modules[sourceModuleIndex];
            if (sourceModule === undefined) {
              invalid = true;
            } else {
              const candidateToken = sourceModule.functionView.getUint32(
                state.targetFunctionIndex * 144,
                false,
              ) - 1;
              const length = tokenLengthV1(sourceModule, candidateToken);
              if (state.byteIndex >= length) {
                let visited = state.reachableVisited.get(sourceModuleIndex);
                if (visited === undefined) {
                  visited = new Set();
                  state.reachableVisited.set(sourceModuleIndex, visited);
                }
                if (!visited.has(state.targetFunctionIndex)) {
                    visited.add(state.targetFunctionIndex);
                    state.reachableModuleIndexes.push(sourceModuleIndex);
                    state.reachableFunctionIndexes.push(
                      state.targetFunctionIndex,
                    );
                }
                state.phase = "scanReachableCalls";
                state.byteIndex = 0;
              } else {
                state.stringBytes += 1n;
                if (
                  sourceModule.stringBytes[
                    tokenOffsetV1(sourceModule, candidateToken) + state.byteIndex
                  ] !==
                    sourceModule.stringBytes[
                      tokenOffsetV1(sourceModule, state.targetToken) +
                      state.byteIndex
                    ]
                ) {
                  state.targetFunctionIndex += 1;
                  state.phase = "findLocalTarget";
                  state.byteIndex = 0;
                } else {
                  state.byteIndex += 1;
                }
              }
            }
          }
          transitions += 1;
          state.transitionCount += 1n;
        }
        if (invalid) {
          releaseCompletedLookup(state);
          releaseCompletedClaim(claim);
          return Result.fail(executableError("access", "invalidInput"));
        }
        return Result.succeed(
          state.phase === "complete"
            ? lookupComplete(state, transitions)
            : Object.freeze({
                status: "pending",
                transitionCount: transitions,
                usage: lookupUsage(state),
              }),
        );
      },
      close: (rawHandle: unknown) => {
        if (rawHandle === null || typeof rawHandle !== "object") {
          return Result.fail(executableError("access", "invalidInput"));
        }
        const lookup = completedLookups.get(rawHandle);
        if (lookup !== undefined) {
          if (lookup.closed) {
            return Result.fail(executableError("access", "closed"));
          }
          releaseCompletedLookup(lookup);
          return Result.succeed(undefined);
        }
        const claim = completedClaims.get(rawHandle);
        if (claim === undefined) {
          return Result.fail(executableError("access", "invalidInput"));
        }
        if (claim.closed) return Result.fail(executableError("access", "closed"));
        if (claim.activeLookup !== undefined) {
          const active = completedLookups.get(claim.activeLookup);
          if (active !== undefined) releaseCompletedLookup(active);
        }
        releaseCompletedClaim(claim);
        return Result.succeed(undefined);
      },
    });

  const factory = Object.freeze({
    create,
    admit,
    seal,
    step,
    adoptRestarted,
    close,
  });
  COMPLETED_LINK_CLAIM_PORTS_V1.set(factory, completedLinkClaimPort);
  return factory;
}

export function declarativeV2VerifierCompletedLinkClaimPortV1(
  factory: unknown,
): DeclarativeV2VerifierCompletedLinkClaimPortV1 | undefined {
  return factory !== null && typeof factory === "object"
    ? COMPLETED_LINK_CLAIM_PORTS_V1.get(factory)
    : undefined;
}

/**
 * Private, package-internal access to verifier-owned evidence. The public
 * package root does not export this surface; it is intentionally reachable
 * only through the Declarative V2 verifier internal subpath.
 */
export interface DeclarativeV2VerifierModuleEvidenceCursorV1 {
  readonly _tag: "DeclarativeV2VerifierModuleEvidenceCursorV1";
}

export interface DeclarativeV2VerifierLinkEvidenceCursorV1 {
  readonly _tag: "DeclarativeV2VerifierLinkEvidenceCursorV1";
}

export interface DeclarativeV2VerifierHandlerLookupV1 {
  readonly _tag: "DeclarativeV2VerifierHandlerLookupV1";
}

export interface DeclarativeV2VerifierAccessPendingV1 {
  readonly status: "pending";
  readonly transitionCount: number;
  readonly deltaUsage: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

export interface DeclarativeV2VerifierEvidenceItemV1 {
  readonly status: "item";
  readonly transitionCount: number;
  readonly evidence: DeclarativeV2VerificationEvidenceCursorV2;
  readonly deltaUsage: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

export interface DeclarativeV2VerifierEvidenceCompleteV1 {
  readonly status: "complete";
  readonly transitionCount: number;
  readonly deltaUsage: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

export type DeclarativeV2VerifierEvidenceReadV1 =
  | DeclarativeV2VerifierAccessPendingV1
  | DeclarativeV2VerifierEvidenceItemV1
  | DeclarativeV2VerifierEvidenceCompleteV1;

export interface DeclarativeV2VerifierHandlerLookupCompleteV1 {
  readonly status: "complete";
  readonly matched: boolean;
  readonly transitionCount: number;
  readonly deltaUsage: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

export type DeclarativeV2VerifierHandlerLookupStepV1 =
  | DeclarativeV2VerifierAccessPendingV1
  | DeclarativeV2VerifierHandlerLookupCompleteV1;

interface ModuleEvidenceAccessStateV1 {
  readonly owned: DeclarativeV2VerifierOwnedModuleArenaV1;
  readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: ReturnType<typeof zeroUsage>;
  index: number;
  closed: boolean;
}

interface LinkEvidenceAccessStateV1 {
  readonly owned: LinkResultPresentationV1;
  readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: ReturnType<typeof zeroUsage>;
  order: number;
  scan: number;
  closed: boolean;
}

interface HandlerLookupStateV1 {
  readonly owned: DeclarativeV2VerifierOwnedModuleArenaV1;
  readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: ReturnType<typeof zeroUsage>;
  readonly path: DeclarativeV2ArtifactModulePathHandleV1;
  readonly expectedExport: Uint8Array;
  readonly capturedExport: Uint8Array;
  phase: "copyExport" | "modulePath" | "findExport" | "compareExport" |
    "findFunction" | "compareFunction" | "complete" | "failed";
  byteIndex: number;
  recordIndex: number;
  localToken: number;
  matched: boolean;
}

const accessUsageCharge = (
  usage: ReturnType<typeof zeroUsage>,
  maximum: DeclarativeV2VerifierBudgetFrameV2,
  dimension: typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
  amount: bigint,
): Result.Result<void, DeclarativeV2VerifierExecutableV1Error> => {
  const observed = usage[dimension] + amount;
  if (observed > maximum[dimension]) {
    return Result.fail(executableError("access", "budgetExceeded", {
      dimension,
      observed,
      maximum: maximum[dimension],
    }));
  }
  usage[dimension] = observed;
  return Result.succeed(undefined);
};

const captureAccessBudgetV1 = (
  value: DeclarativeV2VerifierBudgetFrameV2,
): Result.Result<
  DeclarativeV2VerifierBudgetFrameV2,
  DeclarativeV2VerifierExecutableV1Error
> => {
  const captured =
    captureLocalBudgetFrame(value, "command_budget") ??
    captureLocalBudgetFrame(value, "attempt_usage");
  if (captured === undefined) {
    return Result.fail(executableError("access", "invalidInput"));
  }
  const members = Object.fromEntries(
    DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(
      dimension => [dimension, captured[dimension]] as const,
    ),
  );
  const maximums = Object.freeze({
    kind: "command_budget",
    ...members,
  }) as DeclarativeV2VerifierBudgetFrameV2;
  const required = Object.freeze({
    kind: "attempt_usage",
    ...members,
  }) as DeclarativeV2VerifierBudgetFrameV2;
  const planned = planDeclarativeV2VerifierArenaV2({
    maximums,
    required,
    storage: deriveDeclarativeV2VerifierParseArenaStorageV2(required),
  });
  return Result.isFailure(planned)
    ? Result.fail(executableError("access", "invalidInput"))
    : Result.succeed(planned.success.usage);
};

const accessAllowanceV1 = (
  value: unknown,
): Result.Result<number, DeclarativeV2VerifierExecutableV1Error> => {
  if (
    !isNonNegativeSafeInteger(value) ||
    value > DECLARATIVE_V2_VERIFIER_TRANSITION_QUANTUM_V1
  ) {
    return Result.fail(executableError("access", "invalidInput", {
      dimension: "transitionQuantum",
    }));
  }
  return Result.succeed(value);
};

const tokenOffsetV1 = (
  owned: DeclarativeV2VerifierOwnedModuleArenaV1,
  token: number,
): number => owned.tokenView.getUint32(token * 56 + 12, false);

const tokenLengthV1 = (
  owned: DeclarativeV2VerifierOwnedModuleArenaV1,
  token: number,
): number => owned.tokenView.getUint32(token * 56 + 16, false);

const arenaTextCursorV1 = (
  owned: DeclarativeV2VerifierOwnedModuleArenaV1,
  bytes: Uint8Array,
  offset: number,
  byteLength: number,
): DeclarativeV2VerificationEvidenceTextCursorV2 => {
  let cursor = 0;
  const created = makeDeclarativeV2VerificationEvidenceTextCursorV2(
    byteLength,
    () => {
      if (cursor >= byteLength) return undefined;
      const absolute = offset + cursor;
      const first = bytes[absolute]!;
      const width = first <= 0x7f ? 1 : first <= 0xdf ? 2 : first <= 0xef ? 3 : 4;
      let scalar = first & (
        width === 1 ? 0x7f : width === 2 ? 0x1f : width === 3 ? 0x0f : 0x07
      );
      for (let index = 1; index < width; index += 1) {
        scalar = (scalar << 6) | (bytes[absolute + index]! & 0x3f);
      }
      cursor += width;
      return scalar;
    },
  );
  if (Result.isFailure(created)) {
    throw new Error("Verifier-owned canonical text was rejected.");
  }
  void owned;
  return created.success;
};

const tokenEvidenceTextV1 = (
  owned: DeclarativeV2VerifierOwnedModuleArenaV1,
  token: number,
  trimStart = 0,
  trimEnd = 0,
): DeclarativeV2VerificationEvidenceTextCursorV2 =>
  arenaTextCursorV1(
    owned,
    owned.stringBytes,
    tokenOffsetV1(owned, token) + trimStart,
    tokenLengthV1(owned, token) - trimStart - trimEnd,
  );

const moduleEvidenceAtV1 = (
  owned: DeclarativeV2VerifierOwnedModuleArenaV1,
  index: number,
): DeclarativeV2VerificationEvidenceCursorV2 => {
  const modulePathOffset = owned.moduleView.getUint32(0, false);
  const modulePathLength = owned.moduleView.getUint32(4, false);
  if (index === 0) {
    const created = makeDeclarativeV2ModuleSummaryEvidenceCursorV2(
      owned.moduleOrdinal,
      arenaTextCursorV1(
        owned,
        owned.outputBytes,
        modulePathOffset,
        modulePathLength,
      ),
      owned.sourceSha256,
      owned.usage.sourceBytes,
      BigInt(owned.importCount),
      BigInt(owned.exportCount),
      BigInt(owned.functionCount),
      BigInt(owned.callCount),
      BigInt(owned.valueFlowCount),
    );
    if (Result.isFailure(created)) throw new Error("Owned module evidence is invalid.");
    return created.success;
  }
  if (index <= owned.callCount) {
    const recordIndex = owned.importCount + index - 1;
    const offset = recordIndex * 64;
    const functionIndex = owned.importEdgeView.getUint32(offset + 20, false) - 1;
    const targetKind = owned.importEdgeView.getUint32(offset + 16, false);
    const importIndex = owned.importEdgeView.getUint32(offset + 28, false);
    const created = makeDeclarativeV2ImportCallEvidenceCursorV2(
      owned.moduleOrdinal,
      BigInt(owned.importEdgeView.getUint32(offset + 32, false)),
      tokenEvidenceTextV1(
        owned,
        owned.functionView.getUint32(functionIndex * 144, false) - 1,
      ),
      targetKind === 3
        ? "local"
        : targetKind === 1
        ? "artifactImport"
        : targetKind === 2
        ? "platformImport"
        : "abi",
      targetKind === 3 || targetKind === 4 || importIndex === 0
        ? null
        : tokenEvidenceTextV1(
          owned,
          owned.importEdgeView.getUint32((importIndex - 1) * 64 + 12, false) - 1,
          1,
          1,
        ),
      tokenEvidenceTextV1(
        owned,
        owned.importEdgeView.getUint32(offset + 24, false) - 1,
      ),
    );
    if (Result.isFailure(created)) throw new Error("Owned call evidence is invalid.");
    return created.success;
  }
  const valueStart = 1 + owned.callCount;
  if (index < valueStart + owned.valueFlowCount) {
    const ordinal = index - valueStart;
    const recordIndex = owned.evidenceIndexView.getUint32(ordinal * 4, false);
    const offset = recordIndex * 64;
    const functionIndex = owned.importEdgeView.getUint32(offset + 20, false) - 1;
    const abiId = owned.importEdgeView.getUint32(offset + 36, false) - 1;
    const abi = DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1[abiId];
    if (abi === undefined) throw new Error("Owned ABI evidence is invalid.");
    const created = makeDeclarativeV2ValueFlowEvidenceCursorV2(
      owned.moduleOrdinal,
      tokenEvidenceTextV1(
        owned,
        owned.functionView.getUint32(functionIndex * 144, false) - 1,
      ),
      BigInt(owned.importEdgeView.getUint32(offset + 44, false)),
      abi.name,
      abi.capability,
      abi.catchability,
    );
    if (Result.isFailure(created)) throw new Error("Owned value evidence is invalid.");
    return created.success;
  }
  const diagnosticOrder = index - valueStart - owned.valueFlowCount;
  const recordIndex = owned.evidenceIndexView.getUint32(
    (owned.valueFlowCount + diagnosticOrder) * 4,
    false,
  );
  const offset = recordIndex * 32;
  const id = owned.diagnosticView.getUint32(offset, false);
  const definition = DECLARATIVE_V2_CORE_DIAGNOSTICS_V1.find(
    candidate => candidate.id === id,
  );
  if (definition === undefined) throw new Error("Owned diagnostic evidence is invalid.");
  const created = makeDeclarativeV2DiagnosticEvidenceCursorV2(
    definition.phase,
    owned.moduleOrdinal,
    owned.diagnosticView.getBigUint64(offset + 8, false),
    BigInt(id),
    definition.code,
    definition.rule,
  );
  if (Result.isFailure(created)) throw new Error("Owned diagnostic evidence is invalid.");
  return created.success;
};

const deriveRestartModuleEvidenceSha256V1 = function* (
  owned: DeclarativeV2VerifierOwnedModuleArenaV1,
  maximum: DeclarativeV2VerifierBudgetFrameV2,
  workUsage: ReturnType<typeof zeroUsage>,
): Generator<number, string, void> {
  const maximumFrameBytes = Number(
    maximum.frameBytes > BigInt(MAX_U32)
      ? BigInt(MAX_U32)
      : maximum.frameBytes,
  );
  const maximumCanonicalBytes = Number(
    maximum.canonicalBytes > BigInt(MAX_U32)
      ? BigInt(MAX_U32)
      : maximum.canonicalBytes,
  );
  const budget = makeDeclarativeV2VerificationEvidenceBudgetV2(
    maximumFrameBytes,
    maximumCanonicalBytes,
  );
  if (Result.isFailure(budget)) {
    throw executableError("access", "budgetExceeded");
  }
  const hash = createDeclarativeV2VerifierRuntimeSha256V1(owned.runtimeArena);
  if (Result.isFailure(hash)) {
    throw executableError("access", "invalidState");
  }
  const byte = new Uint8Array(1);
  let hashByteCount = 0n;
  const evidenceCount = 1 + owned.callCount + owned.valueFlowCount +
    owned.diagnosticCount;
  for (let index = 0; index < evidenceCount; index += 1) {
    const evidence = moduleEvidenceAtV1(owned, index);
    let pendingByte: number | undefined;
    const sink = makeIncrementalCanonicalJsonByteSinkV1((value, _offset) => {
      if (pendingByte !== undefined) {
        throw new Error("Evidence sink emitted more than one byte per transition.");
      }
      pendingByte = value;
    });
    const encoder = createDeclarativeV2VerificationEvidenceSinkEncoderV2(
      evidence,
      budget.success,
      sink,
    );
    if (Result.isFailure(encoder)) {
      throw executableError("access", "invalidState");
    }
    for (;;) {
      yield 1;
      const encoded = encoder.success.step(1);
      if (Result.isFailure(encoded)) {
        throw executableError(
          "access",
          encoded.failure.reason === "budgetExceeded"
            ? "budgetExceeded"
            : "invalidState",
        );
      }
      if (pendingByte !== undefined) {
        const canonicalCharge = accessUsageCharge(
          workUsage,
          maximum,
          "canonicalBytes",
          1n,
        );
        const hashCharge = accessUsageCharge(
          workUsage,
          maximum,
          "hashBytes",
          1n,
        );
        if (Result.isFailure(canonicalCharge)) throw canonicalCharge.failure;
        if (Result.isFailure(hashCharge)) throw hashCharge.failure;
        byte[0] = pendingByte;
        pendingByte = undefined;
        let consumed = false;
        while (!consumed) {
          yield 1;
          const hashed = stepDeclarativeV2VerifierRuntimeSha256V1(
            hash.success,
            byte,
            1,
          );
          if (Result.isFailure(hashed)) {
            throw executableError("access", "budgetExceeded", {
              dimension: "hashBytes",
            });
          }
          consumed = hashed.success.receipt.delta.consumedBytes === 1n;
        }
        hashByteCount += 1n;
        if (hashByteCount > maximum.hashBytes) {
          throw executableError("access", "budgetExceeded", {
            dimension: "hashBytes",
            observed: hashByteCount,
            maximum: maximum.hashBytes,
          });
        }
      }
      if (encoded.success.status === "complete") break;
    }
  }
  let digest: Uint8Array | undefined;
  while (digest === undefined) {
    yield 1;
    const finished = finishDeclarativeV2VerifierRuntimeSha256V1(
      hash.success,
      1,
    );
    if (Result.isFailure(finished)) {
      throw executableError("access", "invalidState");
    }
    if (finished.success.status === "complete") {
      digest = finished.success.digest;
    }
  }
  const digestOutputCharge = accessUsageCharge(
    workUsage,
    maximum,
    "outputBytes",
    64n,
  );
  if (Result.isFailure(digestOutputCharge)) throw digestOutputCharge.failure;
  let hexadecimal = "";
  for (let index = 0; index < digest.byteLength; index += 1) {
    yield 1;
    const byte = digest[index]!;
    hexadecimal += "0123456789abcdef"[byte >>> 4]!;
    hexadecimal += "0123456789abcdef"[byte & 0x0f]!;
  }
  return hexadecimal;
};

export interface DeclarativeV2VerifierResultAccessFactoryV1 {
  readonly moduleEvidence: (
    result: unknown,
    maximum: DeclarativeV2VerifierBudgetFrameV2,
  ) => Result.Result<
    DeclarativeV2VerifierModuleEvidenceCursorV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly readModuleEvidence: (
    cursor: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierEvidenceReadV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly handlerLookup: (
    result: unknown,
    modulePath: unknown,
    exportNameUtf8: unknown,
    maximum: DeclarativeV2VerifierBudgetFrameV2,
  ) => Result.Result<
    DeclarativeV2VerifierHandlerLookupV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly stepHandlerLookup: (
    lookup: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierHandlerLookupStepV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly linkEvidence: (
    result: unknown,
    maximum: DeclarativeV2VerifierBudgetFrameV2,
  ) => Result.Result<
    DeclarativeV2VerifierLinkEvidenceCursorV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly readLinkEvidence: (
    cursor: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierEvidenceReadV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly close: (
    handle: unknown,
  ) => Result.Result<void, DeclarativeV2VerifierExecutableV1Error>;
}

export function makeDeclarativeV2VerifierResultAccessFactoryV1():
  DeclarativeV2VerifierResultAccessFactoryV1 {
  const moduleCursors = new WeakMap<object, ModuleEvidenceAccessStateV1>();
  const linkCursors = new WeakMap<object, LinkEvidenceAccessStateV1>();
  const lookups = new WeakMap<object, HandlerLookupStateV1>();
  const moduleCursor = (): DeclarativeV2VerifierModuleEvidenceCursorV1 =>
    Object.freeze({ _tag: "DeclarativeV2VerifierModuleEvidenceCursorV1" });
  const linkCursor = (): DeclarativeV2VerifierLinkEvidenceCursorV1 =>
    Object.freeze({ _tag: "DeclarativeV2VerifierLinkEvidenceCursorV1" });
  const lookupHandle = (): DeclarativeV2VerifierHandlerLookupV1 =>
    Object.freeze({ _tag: "DeclarativeV2VerifierHandlerLookupV1" });

  const moduleEvidence: DeclarativeV2VerifierResultAccessFactoryV1["moduleEvidence"] =
    (rawResult, rawMaximum) => {
      const owned = rawResult !== null && typeof rawResult === "object"
        ? OWNED_MODULE_RESULTS.get(rawResult)
        : undefined;
      const maximum = captureAccessBudgetV1(rawMaximum);
      if (owned === undefined || Result.isFailure(maximum)) {
        return Result.fail(executableError("access", "invalidInput"));
      }
      const handle = moduleCursor();
      moduleCursors.set(handle, {
        owned,
        maximum: maximum.success,
        usage: zeroUsage(),
        index: 0,
        closed: false,
      });
      return Result.succeed(handle);
    };

  const readModuleEvidence:
    DeclarativeV2VerifierResultAccessFactoryV1["readModuleEvidence"] =
      (rawCursor, rawAllowance) => {
        const state = rawCursor !== null && typeof rawCursor === "object"
          ? moduleCursors.get(rawCursor)
          : undefined;
        if (state === undefined) {
          return Result.fail(executableError("access", "invalidInput"));
        }
        if (state.closed) return Result.fail(executableError("access", "closed"));
        const allowance = accessAllowanceV1(rawAllowance);
        if (Result.isFailure(allowance)) {
          state.closed = true;
          return Result.fail(allowance.failure);
        }
        const before = usageSnapshot(state.usage);
        const call = accessUsageCharge(state.usage, state.maximum, "calls", 1n);
        if (Result.isFailure(call)) {
          state.closed = true;
          return Result.fail(call.failure);
        }
        if (allowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            transitionCount: 0,
            deltaUsage: frozenUsageDelta(state.usage, before),
            usage: frozenUsage(state.usage),
          }));
        }
        const count = 1 + state.owned.callCount +
          state.owned.valueFlowCount + state.owned.diagnosticCount;
        if (state.index >= count) {
          state.closed = true;
          return Result.succeed(Object.freeze({
            status: "complete",
            transitionCount: 1,
            deltaUsage: frozenUsageDelta(state.usage, before),
            usage: frozenUsage(state.usage),
          }));
        }
        const evidence = moduleEvidenceAtV1(state.owned, state.index);
        state.index += 1;
        return Result.succeed(Object.freeze({
          status: "item",
          transitionCount: 1,
          evidence,
          deltaUsage: frozenUsageDelta(state.usage, before),
          usage: frozenUsage(state.usage),
        }));
      };

  const handlerLookup: DeclarativeV2VerifierResultAccessFactoryV1["handlerLookup"] =
    (rawResult, rawPath, rawExport, rawMaximum) => {
      const owned = rawResult !== null && typeof rawResult === "object"
        ? OWNED_MODULE_RESULTS.get(rawResult)
        : undefined;
      const path = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.capture(rawPath);
      const maximum = captureAccessBudgetV1(rawMaximum);
      if (
        owned === undefined ||
        Result.isFailure(path) ||
        Result.isFailure(maximum) ||
        !isUint8Array(rawExport)
      ) {
        return Result.fail(executableError("access", "invalidInput"));
      }
      const byteLength = TYPED_ARRAY_BYTE_LENGTH_GETTER?.call(rawExport) as unknown;
      if (
        typeof byteLength !== "number" ||
        byteLength < 1 ||
        BigInt(byteLength) > maximum.success.stringBytes ||
        BigInt(byteLength) > maximum.success.outputBytes ||
        byteLength > MAX_U32
      ) {
        return Result.fail(executableError("access", "budgetExceeded", {
          dimension: "stringBytes",
        }));
      }
      const handle = lookupHandle();
      lookups.set(handle, {
        owned,
        maximum: maximum.success,
        usage: zeroUsage(),
        path: path.success,
        expectedExport: rawExport,
        capturedExport: new Uint8Array(byteLength),
        phase: "copyExport",
        byteIndex: 0,
        recordIndex: 0,
        localToken: -1,
        matched: false,
      });
      return Result.succeed(handle);
    };

  const stepHandlerLookup:
    DeclarativeV2VerifierResultAccessFactoryV1["stepHandlerLookup"] =
      (rawLookup, rawAllowance) => {
        const state = rawLookup !== null && typeof rawLookup === "object"
          ? lookups.get(rawLookup)
          : undefined;
        if (state === undefined) {
          return Result.fail(executableError("access", "invalidInput"));
        }
        if (state.phase === "failed" || state.phase === "complete") {
          return Result.fail(executableError("access", "closed"));
        }
        const allowance = accessAllowanceV1(rawAllowance);
        if (Result.isFailure(allowance)) {
          state.phase = "failed";
          return Result.fail(allowance.failure);
        }
        const before = usageSnapshot(state.usage);
        const call = accessUsageCharge(state.usage, state.maximum, "calls", 1n);
        if (Result.isFailure(call)) {
          state.phase = "failed";
          return Result.fail(call.failure);
        }
        let transitions = 0;
        const charge = (
          dimension: typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
        ): boolean => {
          const charged = accessUsageCharge(
            state.usage,
            state.maximum,
            dimension,
            1n,
          );
          if (Result.isFailure(charged)) {
            state.phase = "failed";
            return false;
          }
          return true;
        };
        while (transitions < allowance.success && state.phase !== "complete") {
          transitions += 1;
          if (state.phase === "copyExport") {
            if (state.byteIndex >= state.capturedExport.byteLength) {
              state.phase = "modulePath";
              state.byteIndex = 0;
              continue;
            }
            if (!charge("stringBytes") || !charge("outputBytes")) break;
            state.capturedExport[state.byteIndex] =
              state.expectedExport[state.byteIndex]!;
            state.byteIndex += 1;
            continue;
          }
          if (state.phase === "modulePath") {
            const expectedLength =
              DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.byteLength(state.path);
            if (Result.isFailure(expectedLength)) {
              state.phase = "failed";
              break;
            }
            const actualLength = state.owned.moduleView.getUint32(4, false);
            if (expectedLength.success !== actualLength) {
              state.phase = "complete";
              continue;
            }
            if (state.byteIndex >= actualLength) {
              state.phase = "findExport";
              state.byteIndex = 0;
              continue;
            }
            if (!charge("stringBytes")) break;
            const expected = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.byteAt(
              state.path,
              state.byteIndex,
            );
            if (
              Result.isFailure(expected) ||
              expected.success !==
                state.owned.outputBytes[
                  state.owned.moduleView.getUint32(0, false) + state.byteIndex
                ]
            ) {
              state.phase = "complete";
              continue;
            }
            state.byteIndex += 1;
            continue;
          }
          if (state.phase === "findExport") {
            if (state.recordIndex >= state.owned.exportCount) {
              state.phase = "complete";
              continue;
            }
            state.phase = "compareExport";
            state.byteIndex = 0;
            continue;
          }
          if (state.phase === "compareExport") {
            const offset = state.recordIndex * 48;
            const isDefault = state.owned.exportView.getUint32(
              offset + 8,
              false,
            ) === 1;
            const stored = state.owned.exportView.getUint32(offset, false);
            const token = stored - 1;
            const expectedLength = state.capturedExport.byteLength;
            const actualLength = isDefault ? 7 : tokenLengthV1(state.owned, token);
            if (expectedLength !== actualLength) {
              state.recordIndex += 1;
              state.phase = "findExport";
              continue;
            }
            if (state.byteIndex >= actualLength) {
              state.localToken =
                state.owned.exportView.getUint32(offset + 4, false) - 1;
              state.recordIndex = 0;
              state.byteIndex = 0;
              state.phase = "findFunction";
              continue;
            }
            if (!charge("stringBytes")) break;
            const actual = isDefault
              ? "default".charCodeAt(state.byteIndex)
              : state.owned.stringBytes[
                tokenOffsetV1(state.owned, token) + state.byteIndex
              ];
            if (actual !== state.capturedExport[state.byteIndex]) {
              state.recordIndex += 1;
              state.byteIndex = 0;
              state.phase = "findExport";
              continue;
            }
            state.byteIndex += 1;
            continue;
          }
          if (state.phase === "findFunction") {
            if (state.recordIndex >= state.owned.functionCount) {
              state.phase = "complete";
              continue;
            }
            state.phase = "compareFunction";
            state.byteIndex = 0;
            continue;
          }
          const token = state.owned.functionView.getUint32(
            state.recordIndex * 144,
            false,
          ) - 1;
          const leftLength = tokenLengthV1(state.owned, token);
          const rightLength = tokenLengthV1(state.owned, state.localToken);
          if (leftLength !== rightLength) {
            state.recordIndex += 1;
            state.phase = "findFunction";
            continue;
          }
          if (state.byteIndex >= leftLength) {
            state.matched = true;
            state.phase = "complete";
            continue;
          }
          if (!charge("stringBytes")) break;
          if (
            state.owned.stringBytes[tokenOffsetV1(state.owned, token) +
              state.byteIndex] !==
              state.owned.stringBytes[
                tokenOffsetV1(state.owned, state.localToken) + state.byteIndex
              ]
          ) {
            state.recordIndex += 1;
            state.byteIndex = 0;
            state.phase = "findFunction";
            continue;
          }
          state.byteIndex += 1;
        }
        if (state.phase === "failed") {
          return Result.fail(executableError("access", "budgetExceeded"));
        }
        if (state.phase === "complete") {
          return Result.succeed(Object.freeze({
            status: "complete",
            matched: state.matched,
            transitionCount: transitions,
            deltaUsage: frozenUsageDelta(state.usage, before),
            usage: frozenUsage(state.usage),
          }));
        }
        return Result.succeed(Object.freeze({
          status: "pending",
          transitionCount: transitions,
          deltaUsage: frozenUsageDelta(state.usage, before),
          usage: frozenUsage(state.usage),
        }));
      };

  const linkEvidence: DeclarativeV2VerifierResultAccessFactoryV1["linkEvidence"] =
    (rawResult, rawMaximum) => {
      const owned = rawResult !== null && typeof rawResult === "object"
        ? OWNED_LINK_RESULTS.get(rawResult)
        : undefined;
      const maximum = captureAccessBudgetV1(rawMaximum);
      if (owned === undefined || Result.isFailure(maximum)) {
        return Result.fail(executableError("access", "invalidInput"));
      }
      const handle = linkCursor();
      linkCursors.set(handle, {
        owned,
        maximum: maximum.success,
        usage: zeroUsage(),
        order: 0,
        scan: 0,
        closed: false,
      });
      return Result.succeed(handle);
    };

  const readLinkEvidence:
    DeclarativeV2VerifierResultAccessFactoryV1["readLinkEvidence"] =
      (rawCursor, rawAllowance) => {
        const state = rawCursor !== null && typeof rawCursor === "object"
          ? linkCursors.get(rawCursor)
          : undefined;
        if (state === undefined) {
          return Result.fail(executableError("access", "invalidInput"));
        }
        if (state.closed) return Result.fail(executableError("access", "closed"));
        const allowance = accessAllowanceV1(rawAllowance);
        if (Result.isFailure(allowance)) {
          state.closed = true;
          return Result.fail(allowance.failure);
        }
        const before = usageSnapshot(state.usage);
        const call = accessUsageCharge(state.usage, state.maximum, "calls", 1n);
        if (Result.isFailure(call)) {
          state.closed = true;
          return Result.fail(call.failure);
        }
        let transitions = 0;
        const link = state.owned.state;
        while (transitions < allowance.success) {
          if (state.order >= link.diagnosticCount) {
            state.closed = true;
            return Result.succeed(Object.freeze({
              status: "complete",
              transitionCount: transitions,
              deltaUsage: frozenUsageDelta(state.usage, before),
              usage: frozenUsage(state.usage),
            }));
          }
          if (state.scan >= link.diagnosticCount) {
            state.closed = true;
            return Result.fail(executableError("access", "invalidState"));
          }
          transitions += 1;
          const index = state.scan++;
          if (
            link.diagnosticView.getUint32(index * 32 + 16, false) !== state.order
          ) continue;
          const offset = index * 32;
          const id = link.diagnosticView.getUint32(offset, false);
          const definition = DECLARATIVE_V2_CORE_DIAGNOSTICS_V1.find(
            candidate => candidate.id === id,
          );
          if (definition === undefined) {
            state.closed = true;
            return Result.fail(executableError("access", "invalidState"));
          }
          const evidence = makeDeclarativeV2DiagnosticEvidenceCursorV2(
            "link",
            link.diagnosticView.getBigUint64(offset + 8, false),
            0n,
            BigInt(id),
            definition.code,
            definition.rule,
          );
          if (Result.isFailure(evidence)) {
            state.closed = true;
            return Result.fail(executableError("access", "invalidState"));
          }
          state.order += 1;
          state.scan = 0;
          return Result.succeed(Object.freeze({
            status: "item",
            transitionCount: transitions,
            evidence: evidence.success,
            deltaUsage: frozenUsageDelta(state.usage, before),
            usage: frozenUsage(state.usage),
          }));
        }
        return Result.succeed(Object.freeze({
          status: "pending",
          transitionCount: transitions,
          deltaUsage: frozenUsageDelta(state.usage, before),
          usage: frozenUsage(state.usage),
        }));
      };

  const close: DeclarativeV2VerifierResultAccessFactoryV1["close"] =
    rawHandle => {
      if (rawHandle === null || typeof rawHandle !== "object") {
        return Result.fail(executableError("access", "invalidInput"));
      }
      const module = moduleCursors.get(rawHandle);
      if (module !== undefined) {
        if (module.closed) return Result.fail(executableError("access", "closed"));
        module.closed = true;
        return Result.succeed(undefined);
      }
      const link = linkCursors.get(rawHandle);
      if (link !== undefined) {
        if (link.closed) return Result.fail(executableError("access", "closed"));
        link.closed = true;
        return Result.succeed(undefined);
      }
      const lookup = lookups.get(rawHandle);
      if (lookup !== undefined) {
        if (lookup.phase === "failed" || lookup.phase === "complete") {
          return Result.fail(executableError("access", "closed"));
        }
        lookup.phase = "failed";
        return Result.succeed(undefined);
      }
      return Result.fail(executableError("access", "invalidInput"));
    };

  return Object.freeze({
    moduleEvidence,
    readModuleEvidence,
    handlerLookup,
    stepHandlerLookup,
    linkEvidence,
    readLinkEvidence,
    close,
  });
}

export interface DeclarativeV2VerifierRestartRecordCursorV1 {
  readonly _tag: "DeclarativeV2VerifierRestartRecordCursorV1";
}

export interface DeclarativeV2VerifierRestartRecordReadPendingV1 {
  readonly status: "pending";
  readonly transitionCount: number;
  readonly hashBytes: bigint;
  readonly deltaUsage: DeclarativeV2VerifierBudgetFrameV2;
}

export interface DeclarativeV2VerifierRestartRecordReadItemV1 {
  readonly status: "item";
  readonly transitionCount: number;
  readonly hashBytes: bigint;
  readonly deltaUsage: DeclarativeV2VerifierBudgetFrameV2;
  readonly record: DeclarativeV2VerifierRestartRecordV1;
}

export interface DeclarativeV2VerifierRestartRecordReadCompleteV1 {
  readonly status: "complete";
  readonly transitionCount: number;
  readonly hashBytes: bigint;
  readonly deltaUsage: DeclarativeV2VerifierBudgetFrameV2;
}

export type DeclarativeV2VerifierRestartRecordReadV1 =
  | DeclarativeV2VerifierRestartRecordReadPendingV1
  | DeclarativeV2VerifierRestartRecordReadItemV1
  | DeclarativeV2VerifierRestartRecordReadCompleteV1;

export interface DeclarativeV2VerifierRestartModuleBuilderV1 {
  readonly _tag: "DeclarativeV2VerifierRestartModuleBuilderV1";
}

export type DeclarativeV2VerifierRestartModuleBuilderStepV1 =
  | Readonly<{
    readonly status: "pending";
    readonly transitionCount: number;
    readonly deltaUsage: DeclarativeV2VerifierBudgetFrameV2;
  }>
  | Readonly<{
    readonly status: "complete";
    readonly transitionCount: number;
    readonly deltaUsage: DeclarativeV2VerifierBudgetFrameV2;
    readonly result: DeclarativeV2VerifierModuleResultV1;
  }>;

export interface DeclarativeV2VerifierExecutableRestartBridgeV1 {
  readonly admitModuleResult: (
    moduleResult: unknown,
  ) => Result.Result<void, DeclarativeV2VerifierExecutableV1Error>;
  readonly openModuleRecords: (
    moduleResult: unknown,
    authenticatedInputSha256: unknown,
    maximum: DeclarativeV2VerifierBudgetFrameV2,
  ) => Result.Result<
    DeclarativeV2VerifierRestartRecordCursorV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly readModuleRecord: (
    cursor: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierRestartRecordReadV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly openLinkRecords: (
    linkResult: unknown,
    parsePagesRootSha256: unknown,
    maximum: DeclarativeV2VerifierBudgetFrameV2,
  ) => Result.Result<
    DeclarativeV2VerifierRestartRecordCursorV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly readLinkRecord: (
    cursor: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierRestartRecordReadV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly createModuleBuilder: (
    maximum: DeclarativeV2VerifierBudgetFrameV2,
    settledUsage: DeclarativeV2VerifierBudgetFrameV2,
  ) => Result.Result<
    DeclarativeV2VerifierRestartModuleBuilderV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly appendModuleRecord: (
    builder: unknown,
    record: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierBudgetFrameV2,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly finishModuleBuilder: (
    builder: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierRestartModuleBuilderStepV1,
    DeclarativeV2VerifierExecutableV1Error
  >;
  readonly adoptLinkResult: (
    result: unknown,
    parsePagesRootSha256: unknown,
  ) => Result.Result<void, DeclarativeV2VerifierExecutableV1Error>;
  readonly revoke: (
    result: unknown,
  ) => Result.Result<void, DeclarativeV2VerifierExecutableV1Error>;
}

interface RestartModuleCursorStateV1 {
  readonly owned: DeclarativeV2VerifierOwnedModuleArenaV1;
  readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  readonly workUsage: ReturnType<typeof zeroUsage>;
  readonly hashArena: DeclarativeV2VerifierRuntimeArenaHandleV1;
  readonly authenticatedInputSha256: Uint8Array;
  readonly restartRecords: ReadonlyArray<DeclarativeV2VerifierRestartRecordV1> |
    undefined;
  bodyHash: RestartModuleBodyHashStateV1 | undefined;
  orderSearch: RestartModuleOrderSearchStateV1 | undefined;
  recordIterator: RestartRecordIteratorV1 | undefined;
  index: number;
  closed: boolean;
}

interface RestartModuleOrderSearchStateV1 {
  readonly kind: "import" | "export" | "diagnostic";
  readonly targetOrder: number;
  candidateIndex: number;
}

interface RestartModuleBodyHashStateV1 {
  readonly functionOrdinal: number;
  searchIndex: number;
  functionIndex: number | undefined;
  hash: DeclarativeV2VerifierRuntimeSha256V1 | undefined;
  prefix: Uint8Array | undefined;
  prefixOffset: number;
  tokenIndex: number;
  bodyEnd: number;
  tokenPrefix: Uint8Array | undefined;
  tokenPrefixOffset: number;
  tokenByteOffset: number;
  tokenByteLength: number;
  tokenByteCursor: number;
  digest: Uint8Array | undefined;
  phase:
    | "search"
    | "prefix"
    | "tokenPrefix"
    | "tokenBytes"
    | "finish"
    | "ready";
}

interface RestartLinkCursorStateV1 {
  readonly owned: LinkResultPresentationV1;
  readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  readonly workUsage: ReturnType<typeof zeroUsage>;
  readonly parsePagesRootSha256: Uint8Array;
  sourceSearchIndex: number;
  diagnosticSearchIndex: number;
  recordIterator: RestartRecordIteratorV1 | undefined;
  index: number;
  closed: boolean;
}

interface RestartRecordWorkV1 {
  readonly dimension?:
    typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number];
  readonly amount?: bigint;
}

type RestartRecordIteratorV1 = Generator<
  RestartRecordWorkV1,
  DeclarativeV2VerifierRestartRecordV1 | undefined,
  void
>;

interface RestartModuleBuilderStateV1 {
  readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
  readonly workUsage: ReturnType<typeof zeroUsage>;
  readonly records: DeclarativeV2VerifierRestartRecordV1[];
  iterator:
    | Generator<
      number,
      Result.Result<
        DeclarativeV2VerifierModuleResultV1,
        DeclarativeV2VerifierExecutableV1Error
      >,
      void
    >
    | undefined;
  closed: boolean;
}

interface RestartResultProvenanceV1 {
  readonly owner: object;
  readonly restartRecords?: ReadonlyArray<DeclarativeV2VerifierRestartRecordV1>;
  readonly parsePagesRootSha256?: Uint8Array;
  revoked: boolean;
}

const RESTART_RESULT_PROVENANCE = new WeakMap<
  object,
  RestartResultProvenanceV1
>();

const restartAllowanceV1 = (
  raw: unknown,
): Result.Result<number, DeclarativeV2VerifierExecutableV1Error> =>
  typeof raw === "number" &&
    Number.isSafeInteger(raw) &&
    raw >= 0 &&
    raw <= 1_024
    ? Result.succeed(raw)
    : Result.fail(executableError("access", "invalidInput"));

const restartOwnedBytesTextV1 = function* (
  bytes: Uint8Array,
  offset: number,
  length: number,
  dimension: "tokenBytes" | "outputBytes",
): Generator<RestartRecordWorkV1, string, void> {
  yield { dimension, amount: BigInt(length) };
  yield { dimension: "stringBytes", amount: BigInt(length) };
  let text = "";
  let cursor = offset;
  const end = offset + length;
  while (cursor < end) {
    yield {};
    const first = bytes[cursor]!;
    let codePoint: number;
    let width: number;
    if (first <= 0x7f) {
      codePoint = first;
      width = 1;
    } else if (first >= 0xc2 && first <= 0xdf) {
      codePoint = ((first & 0x1f) << 6) | (bytes[cursor + 1]! & 0x3f);
      width = 2;
    } else if (first >= 0xe0 && first <= 0xef) {
      codePoint =
        ((first & 0x0f) << 12) |
        ((bytes[cursor + 1]! & 0x3f) << 6) |
        (bytes[cursor + 2]! & 0x3f);
      width = 3;
    } else if (first >= 0xf0 && first <= 0xf4) {
      codePoint =
        ((first & 0x07) << 18) |
        ((bytes[cursor + 1]! & 0x3f) << 12) |
        ((bytes[cursor + 2]! & 0x3f) << 6) |
        (bytes[cursor + 3]! & 0x3f);
      width = 4;
    } else {
      throw new Error("Verified text lost its UTF-8 invariant.");
    }
    if (
      cursor + width > end ||
      (width > 1 &&
        (
          codePoint < (width === 2 ? 0x80 : width === 3 ? 0x800 : 0x1_0000) ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ))
    ) {
      throw new Error("Verified text lost its UTF-8 invariant.");
    }
    text += String.fromCodePoint(codePoint);
    cursor += width;
  }
  return text;
};

const restartOwnedTextV1 = function* (
  owned: DeclarativeV2VerifierOwnedModuleArenaV1,
  tokenIndex: number,
  trimStart = 0,
  trimEnd = 0,
): Generator<RestartRecordWorkV1, string, void> {
  const offset = tokenOffsetV1(owned, tokenIndex) + trimStart;
  const length = tokenLengthV1(owned, tokenIndex) - trimStart - trimEnd;
  return yield* restartOwnedBytesTextV1(
    owned.stringBytes,
    offset,
    length,
    "tokenBytes",
  );
};

const restartModulePathV1 = function* (
  owned: DeclarativeV2VerifierOwnedModuleArenaV1,
): Generator<RestartRecordWorkV1, string, void> {
  const offset = owned.moduleView.getUint32(0, false);
  const length = owned.moduleView.getUint32(4, false);
  return yield* restartOwnedBytesTextV1(
    owned.outputBytes,
    offset,
    length,
    "outputBytes",
  );
};

const restartModuleRecordAtV1 = function* (
  state: RestartModuleCursorStateV1,
  orderedIndex?: number,
  bodyFunctionIndex?: number,
  bodySha256?: Uint8Array,
): RestartRecordIteratorV1 {
  const owned = state.owned;
  let position = state.index;
  if (position === 0) {
    return Object.freeze({
      kind: "module_identity_v1",
      recordOrdinal: 0n,
      moduleOrdinal: owned.moduleOrdinal,
      modulePath: yield* restartModulePathV1(owned),
      sourceSha256: new Uint8Array(owned.sourceSha256),
      sourceByteLength: owned.moduleView.getBigUint64(16, false),
      authenticatedInputSha256: new Uint8Array(
        state.authenticatedInputSha256,
      ),
    } satisfies DeclarativeV2RestartModuleIdentityRecordV1);
  }
  position -= 1;
  if (position < owned.importCount) {
    const index = orderedIndex;
    if (index === undefined) {
      throw new Error("Verified import order was not incrementally settled.");
    }
    const offset = index * 64;
    const importedStored = owned.importEdgeView.getUint32(offset + 4, false);
    const localStored = owned.importEdgeView.getUint32(offset + 8, false);
    const moduleStored = owned.importEdgeView.getUint32(offset + 12, false);
    if (localStored === 0 || moduleStored === 0) {
      throw new Error("Verified import lost its bindings.");
    }
    return Object.freeze({
      kind: "static_import_v1",
      recordOrdinal: BigInt(state.index),
      moduleOrdinal: owned.moduleOrdinal,
      importOrdinal: BigInt(position),
      sourceModulePath: yield* restartOwnedTextV1(
        owned,
        moduleStored - 1,
        1,
        1,
      ),
      importedName: importedStored === 0
        ? "default"
        : yield* restartOwnedTextV1(owned, importedStored - 1),
      localName: yield* restartOwnedTextV1(owned, localStored - 1),
    } satisfies DeclarativeV2RestartStaticImportRecordV1);
  }
  position -= owned.importCount;
  if (position < owned.exportCount) {
    const index = orderedIndex;
    if (index === undefined) {
      throw new Error("Verified export order was not incrementally settled.");
    }
    const offset = index * 48;
    const localStored = owned.exportView.getUint32(offset + 4, false);
    const exportStored = owned.exportView.getUint32(offset, false);
    const isDefault = owned.exportView.getUint32(offset + 8, false) === 1;
    if (localStored === 0 || (!isDefault && exportStored === 0)) {
      throw new Error("Verified export lost its bindings.");
    }
    return Object.freeze({
      kind: "export_binding_v1",
      recordOrdinal: BigInt(state.index),
      moduleOrdinal: owned.moduleOrdinal,
      exportOrdinal: BigInt(position),
      exportName: isDefault
        ? "default"
        : yield* restartOwnedTextV1(owned, exportStored - 1),
      localFunctionName: yield* restartOwnedTextV1(owned, localStored - 1),
    } satisfies DeclarativeV2RestartExportBindingRecordV1);
  }
  position -= owned.exportCount;
  if (position < owned.functionCount) {
    const index = bodyFunctionIndex;
    if (index === undefined || bodySha256 === undefined) {
      throw new Error("Verified function body was not incrementally settled.");
    }
    const offset = index * 144;
    const nameStored = owned.functionView.getUint32(offset, false);
    if (nameStored === 0) throw new Error("Verified function lost its name.");
    return Object.freeze({
      kind: "function_v1",
      recordOrdinal: BigInt(state.index),
      moduleOrdinal: owned.moduleOrdinal,
      functionOrdinal: BigInt(position),
      functionName: yield* restartOwnedTextV1(owned, nameStored - 1),
      async: owned.functionView.getUint32(offset + 4, false) === 1,
      parameterCount: BigInt(owned.functionView.getUint32(offset + 20, false)),
      bodySha256: new Uint8Array(bodySha256),
    } satisfies DeclarativeV2RestartFunctionRecordV1);
  }
  position -= owned.functionCount;
  if (position < owned.callCount) {
    const offset = (owned.importCount + position) * 64;
    const functionIndex =
      owned.importEdgeView.getUint32(offset + 20, false) - 1;
    const targetStored = owned.importEdgeView.getUint32(offset + 24, false);
    const importStored = owned.importEdgeView.getUint32(offset + 28, false);
    const targetCode = owned.importEdgeView.getUint32(offset + 16, false);
    if (targetStored === 0 || functionIndex < 0) {
      throw new Error("Verified call lost its target.");
    }
    const functionStored = owned.functionView.getUint32(
      functionIndex * 144,
      false,
    );
    let targetModulePath: string | null = null;
    if (importStored !== 0 && targetCode !== 3 && targetCode !== 4) {
      const moduleStored = owned.importEdgeView.getUint32(
        (importStored - 1) * 64 + 12,
        false,
      );
      if (moduleStored === 0) throw new Error("Verified call lost its module.");
      targetModulePath = yield* restartOwnedTextV1(
        owned,
        moduleStored - 1,
        1,
        1,
      );
    }
    return Object.freeze({
      kind: "direct_call_v1",
      recordOrdinal: BigInt(state.index),
      moduleOrdinal: owned.moduleOrdinal,
      callOrdinal: BigInt(position),
      callerFunctionOrdinal: BigInt(functionIndex),
      targetKind: targetCode === 3
        ? "local"
        : targetCode === 1
        ? "artifactImport"
        : targetCode === 2
        ? "platformImport"
        : "abi",
      targetModulePath,
      targetName: yield* restartOwnedTextV1(owned, targetStored - 1),
    } satisfies DeclarativeV2RestartDirectCallRecordV1);
  }
  position -= owned.callCount;
  if (position < owned.valueFlowCount) {
    const recordIndex = owned.evidenceIndexView.getUint32(position * 4, false);
    const offset = recordIndex * 64;
    const functionIndex =
      owned.importEdgeView.getUint32(offset + 20, false) - 1;
    const abiId = owned.importEdgeView.getUint32(offset + 36, false) - 1;
    const abi = DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1[abiId];
    if (abi === undefined || functionIndex < 0) {
      throw new Error("Verified value flow lost its ABI.");
    }
    return Object.freeze({
      kind: "value_flow_v1",
      recordOrdinal: BigInt(state.index),
      moduleOrdinal: owned.moduleOrdinal,
      flowOrdinal: BigInt(position),
      functionOrdinal: BigInt(functionIndex),
      operationName: abi.name,
      capability: abi.capability,
      catchability: abi.catchability as "application" | "mixed" | "host",
    } satisfies DeclarativeV2RestartValueFlowRecordV1);
  }
  position -= owned.valueFlowCount;
  if (position < owned.diagnosticCount) {
    const recordIndex = owned.evidenceIndexView.getUint32(
      (owned.valueFlowCount + position) * 4,
      false,
    );
    const offset = recordIndex * 32;
    const id = owned.diagnosticView.getUint32(offset, false);
    const definition = DECLARATIVE_V2_CORE_DIAGNOSTICS_V1.find(
      candidate => candidate.id === id,
    );
    if (definition === undefined) {
      throw new Error("Verified diagnostic lost its definition.");
    }
    return Object.freeze({
      kind: "diagnostic_v1",
      recordOrdinal: BigInt(state.index),
      phase: definition.phase === "link" ? "link" : definition.phase === "valueFlow"
        ? "valueFlow"
        : "parse",
      moduleOrdinal: owned.moduleOrdinal,
      diagnosticOrdinal: BigInt(position),
      byteOffset: owned.diagnosticView.getBigUint64(offset + 8, false),
      diagnosticId: BigInt(id),
      code: definition.code,
      message: definition.rule,
    } satisfies DeclarativeV2RestartDiagnosticRecordV1);
  }
  position -= owned.diagnosticCount;
  if (position === 0) {
    return Object.freeze({
      kind: "parse_terminal_v1",
      recordOrdinal: BigInt(state.index),
      moduleOrdinal: owned.moduleOrdinal,
      importCount: BigInt(owned.importCount),
      exportCount: BigInt(owned.exportCount),
      functionCount: BigInt(owned.functionCount),
      callCount: BigInt(owned.callCount),
      valueFlowCount: BigInt(owned.valueFlowCount),
      diagnosticCount: BigInt(owned.diagnosticCount),
      sourceSha256: new Uint8Array(owned.sourceSha256),
      authenticatedInputSha256: new Uint8Array(
        state.authenticatedInputSha256,
      ),
      precedingRecordsRootSha256: new Uint8Array(32),
    });
  }
  return undefined;
};

const advanceRestartBodyHashV1 = (
  state: RestartModuleCursorStateV1,
): Readonly<{
  readonly transitionCount: number;
  readonly hashBytes: bigint;
}> => {
  const body = state.bodyHash;
  if (body === undefined || body.phase === "ready") {
    throw new Error("Restart function body hash is not pending.");
  }
  const owned = state.owned;
  if (body.phase === "search") {
    if (body.searchIndex >= owned.functionCount) {
      throw new Error("Verified function lost its deterministic order.");
    }
    const offset = body.searchIndex * 144;
    if (
      owned.functionView.getUint32(offset + 16, false) !== body.functionOrdinal
    ) {
      body.searchIndex += 1;
      return Object.freeze({ transitionCount: 1, hashBytes: 0n });
    }
    body.functionIndex = body.searchIndex;
    const bodyStart = owned.functionView.getUint32(offset + 8, false);
    body.bodyEnd = owned.functionView.getUint32(offset + 12, false);
    const bodyTokenCount = owned.functionView.getUint32(offset + 24, false);
    if (
      body.bodyEnd <= bodyStart ||
      bodyTokenCount !== Math.max(0, body.bodyEnd - bodyStart - 1)
    ) {
      throw new Error("Verified function lost its body range.");
    }
    const prefix = makeDeclarativeV2VerifierRestartFunctionBodyPrefixV1(
      owned.moduleOrdinal,
      BigInt(body.functionOrdinal),
      BigInt(bodyTokenCount),
    );
    const hash = createDeclarativeV2VerifierRuntimeSha256V1(state.hashArena);
    if (Result.isFailure(prefix) || Result.isFailure(hash)) {
      throw new Error("Verified function body hash could not be initialized.");
    }
    body.prefix = prefix.success;
    body.hash = hash.success;
    body.tokenIndex = bodyStart + 1;
    body.phase = "prefix";
    return Object.freeze({ transitionCount: 1, hashBytes: 0n });
  }
  if (body.phase === "prefix") {
    const hashed = stepDeclarativeV2VerifierRuntimeSha256V1(
      body.hash,
      UINT8_ARRAY_SUBARRAY.call(
        body.prefix,
        body.prefixOffset,
        body.prefix!.byteLength,
      ) as Uint8Array,
      1,
    );
    if (Result.isFailure(hashed)) {
      throw new Error("Verified function body prefix hashing failed.");
    }
    body.prefixOffset += Number(
      hashed.success.receipt.delta.consumedBytes,
    );
    if (body.prefixOffset === body.prefix!.byteLength) {
      body.phase = "tokenPrefix";
    }
    return Object.freeze({
      transitionCount: Number(hashed.success.receipt.delta.transitions),
      hashBytes: hashed.success.receipt.delta.hashBytes,
    });
  }
  if (body.phase === "tokenPrefix") {
    if (body.tokenIndex >= body.bodyEnd) {
      body.phase = "finish";
      return Object.freeze({ transitionCount: 1, hashBytes: 0n });
    }
    if (body.tokenPrefix === undefined) {
      const terminalStored = owned.tokenView.getUint32(
        body.tokenIndex * 56 + 36,
        false,
      );
      if (terminalStored === 0) {
        throw new Error("Verified body token lost its parser terminal.");
      }
      body.tokenByteOffset = tokenOffsetV1(owned, body.tokenIndex);
      body.tokenByteLength = tokenLengthV1(owned, body.tokenIndex);
      const prefix = makeDeclarativeV2VerifierRestartFunctionBodyTokenPrefixV1(
        terminalStored - 1,
        BigInt(body.tokenByteLength),
      );
      if (Result.isFailure(prefix)) {
        throw new Error("Verified body token prefix was not canonical.");
      }
      body.tokenPrefix = prefix.success;
      body.tokenPrefixOffset = 0;
      body.tokenByteCursor = 0;
      return Object.freeze({ transitionCount: 1, hashBytes: 0n });
    }
    const hashed = stepDeclarativeV2VerifierRuntimeSha256V1(
      body.hash,
      UINT8_ARRAY_SUBARRAY.call(
        body.tokenPrefix,
        body.tokenPrefixOffset,
        body.tokenPrefix.byteLength,
      ) as Uint8Array,
      1,
    );
    if (Result.isFailure(hashed)) {
      throw new Error("Verified body token prefix hashing failed.");
    }
    body.tokenPrefixOffset += Number(
      hashed.success.receipt.delta.consumedBytes,
    );
    if (body.tokenPrefixOffset === body.tokenPrefix.byteLength) {
      body.phase = "tokenBytes";
    }
    return Object.freeze({
      transitionCount: Number(hashed.success.receipt.delta.transitions),
      hashBytes: hashed.success.receipt.delta.hashBytes,
    });
  }
  if (body.phase === "tokenBytes") {
    if (body.tokenByteCursor === body.tokenByteLength) {
      body.tokenIndex += 1;
      body.tokenPrefix = undefined;
      body.phase = "tokenPrefix";
      return Object.freeze({ transitionCount: 1, hashBytes: 0n });
    }
    const hashed = stepDeclarativeV2VerifierRuntimeSha256V1(
      body.hash,
      UINT8_ARRAY_SUBARRAY.call(
        owned.stringBytes,
        body.tokenByteOffset + body.tokenByteCursor,
        body.tokenByteOffset + body.tokenByteLength,
      ) as Uint8Array,
      1,
    );
    if (Result.isFailure(hashed)) {
      throw new Error("Verified body token hashing failed.");
    }
    body.tokenByteCursor += Number(
      hashed.success.receipt.delta.consumedBytes,
    );
    return Object.freeze({
      transitionCount: Number(hashed.success.receipt.delta.transitions),
      hashBytes: hashed.success.receipt.delta.hashBytes,
    });
  }
  const finished = finishDeclarativeV2VerifierRuntimeSha256V1(body.hash, 1);
  if (Result.isFailure(finished)) {
    throw new Error("Verified function body hash finalization failed.");
  }
  if (finished.success.status === "complete") {
    body.digest = new Uint8Array(finished.success.digest);
    body.phase = "ready";
  }
  return Object.freeze({
    transitionCount: Number(finished.success.receipt.delta.transitions),
    hashBytes: finished.success.receipt.delta.hashBytes,
  });
};

const advanceRestartRecordIteratorV1 = (
  state: {
    readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
    readonly workUsage: ReturnType<typeof zeroUsage>;
    recordIterator: RestartRecordIteratorV1 | undefined;
  },
  allowance: number,
): Result.Result<
  Readonly<{
    readonly transitionCount: number;
    readonly deltaUsage: DeclarativeV2VerifierBudgetFrameV2;
    readonly record?: DeclarativeV2VerifierRestartRecordV1;
  }>,
  DeclarativeV2VerifierExecutableV1Error
> => {
  const before = usageSnapshot(state.workUsage);
  let used = 0;
  while (used < allowance) {
    const call = accessUsageCharge(
      state.workUsage,
      state.maximum,
      "calls",
      1n,
    );
    if (Result.isFailure(call)) return Result.fail(call.failure);
    let advanced: IteratorResult<
      RestartRecordWorkV1,
      DeclarativeV2VerifierRestartRecordV1 | undefined
    >;
    try {
      advanced = state.recordIterator!.next();
    } catch (cause) {
      if (cause instanceof DeclarativeV2VerifierExecutableV1Error) {
        return Result.fail(cause);
      }
      throw cause;
    }
    used += 1;
    if (advanced.done) {
      state.recordIterator = undefined;
      return Result.succeed(Object.freeze({
        transitionCount: used,
        deltaUsage: frozenUsageDelta(state.workUsage, before),
        ...(advanced.value === undefined ? {} : { record: advanced.value }),
      }));
    }
    if (
      advanced.value.dimension !== undefined &&
      advanced.value.amount !== undefined
    ) {
      const charged = accessUsageCharge(
        state.workUsage,
        state.maximum,
        advanced.value.dimension,
        advanced.value.amount,
      );
      if (Result.isFailure(charged)) return Result.fail(charged.failure);
    }
  }
  return Result.succeed(Object.freeze({
    transitionCount: used,
    deltaUsage: frozenUsageDelta(state.workUsage, before),
  }));
};

/**
 * This bridge is intentionally package-private. It exposes record-at-a-time
 * views over verifier-owned arenas and performs final-only registration of
 * rehydrated results. The restart runtime must authenticate and validate the
 * records before calling the builder.
 */
export function makeDeclarativeV2VerifierExecutableRestartBridgeV1():
  DeclarativeV2VerifierExecutableRestartBridgeV1 {
  const owner = Object.freeze({});
  const moduleCursors = new WeakMap<object, RestartModuleCursorStateV1>();
  const linkCursors = new WeakMap<object, RestartLinkCursorStateV1>();
  const builders = new WeakMap<object, RestartModuleBuilderStateV1>();
  const cursor = (): DeclarativeV2VerifierRestartRecordCursorV1 =>
    Object.freeze({ _tag: "DeclarativeV2VerifierRestartRecordCursorV1" });
  const builder = (): DeclarativeV2VerifierRestartModuleBuilderV1 =>
    Object.freeze({ _tag: "DeclarativeV2VerifierRestartModuleBuilderV1" });

  const admitModuleResult:
    DeclarativeV2VerifierExecutableRestartBridgeV1["admitModuleResult"] =
      rawResult => {
        const provenance = rawResult !== null && typeof rawResult === "object"
          ? RESTART_RESULT_PROVENANCE.get(rawResult)
          : undefined;
        return provenance?.owner === owner &&
            !provenance.revoked &&
            rawResult !== null &&
            typeof rawResult === "object" &&
            OWNED_MODULE_RESULTS.get(rawResult) !== undefined
          ? Result.succeed(undefined)
          : Result.fail(executableError("access", "invalidInput"));
      };

  const openModuleRecords:
    DeclarativeV2VerifierExecutableRestartBridgeV1["openModuleRecords"] =
      (rawResult, rawAuthenticatedInputSha256, maximum) => {
        const provenance = rawResult !== null && typeof rawResult === "object"
          ? RESTART_RESULT_PROVENANCE.get(rawResult)
          : undefined;
        const owned = rawResult !== null && typeof rawResult === "object"
          ? OWNED_MODULE_RESULTS.get(rawResult)
          : undefined;
        if (provenance?.owner === owner && provenance.revoked) {
          return Result.fail(executableError("access", "closed"));
        }
        if (
          (provenance !== undefined &&
            (provenance.owner !== owner || provenance.revoked)) ||
          owned === undefined ||
          !isUint8ArrayWithByteLength(rawAuthenticatedInputSha256, 32)
        ) {
          return Result.fail(executableError("access", "invalidInput"));
        }
        const restartRecords = provenance?.restartRecords;
        if (
          restartRecords !== undefined &&
          (
            restartRecords[0]?.kind !== "module_identity_v1" ||
            !bytesEqualFullScan(
              restartRecords[0].authenticatedInputSha256,
              rawAuthenticatedInputSha256,
            )
          )
        ) {
          return Result.fail(executableError("access", "invalidInput"));
        }
        const hashMaximum = Object.freeze({
          ...maximum,
          kind: "command_budget",
        } satisfies DeclarativeV2VerifierBudgetFrameV2);
        const hashArena = createDeclarativeV2VerifierRuntimeArenaV1({
          requiredBytes: 0,
          regions: Object.freeze([]),
          usage: hashMaximum,
        });
        if (Result.isFailure(hashArena)) {
          return Result.fail(executableError("access", "invalidInput"));
        }
        const handle = cursor();
        moduleCursors.set(handle, {
          owned,
          maximum,
          workUsage: zeroUsage(),
          hashArena: hashArena.success,
          authenticatedInputSha256: new Uint8Array(rawAuthenticatedInputSha256),
          restartRecords,
          bodyHash: undefined,
          orderSearch: undefined,
          recordIterator: undefined,
          index: 0,
          closed: false,
        });
        return Result.succeed(handle);
      };

  const readModuleRecord:
    DeclarativeV2VerifierExecutableRestartBridgeV1["readModuleRecord"] =
      (rawCursor, rawAllowance) => {
        const state = rawCursor !== null && typeof rawCursor === "object"
          ? moduleCursors.get(rawCursor)
          : undefined;
        if (state === undefined) {
          return Result.fail(executableError("access", "invalidInput"));
        }
        if (state.closed) {
          return Result.fail(executableError("access", "closed"));
        }
        const allowance = restartAllowanceV1(rawAllowance);
        if (Result.isFailure(allowance)) {
          state.closed = true;
          return Result.fail(allowance.failure);
        }
        if (allowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            transitionCount: 0,
            hashBytes: 0n,
            deltaUsage: frozenUsage(zeroUsage()),
          }));
        }
        const before = usageSnapshot(state.workUsage);
        if (state.restartRecords === undefined) {
          let used = 0;
          let hashBytes = 0n;
          if (state.recordIterator !== undefined) {
            const advanced = advanceRestartRecordIteratorV1(
              state,
              allowance.success,
            );
            if (Result.isFailure(advanced)) {
              state.closed = true;
              return Result.fail(advanced.failure);
            }
            if (advanced.success.record === undefined) {
              return Result.succeed(Object.freeze({
                status: "pending",
                transitionCount: advanced.success.transitionCount,
                hashBytes: 0n,
                deltaUsage: advanced.success.deltaUsage,
              }));
            }
            state.index += 1;
            return Result.succeed(Object.freeze({
              status: "item",
              transitionCount: advanced.success.transitionCount,
              hashBytes: 0n,
              deltaUsage: advanced.success.deltaUsage,
              record: advanced.success.record,
            }));
          }
          const orderedPosition = state.index - 1;
          const orderKind = orderedPosition >= 0 &&
              orderedPosition < state.owned.importCount
            ? "import"
            : orderedPosition >= state.owned.importCount &&
                orderedPosition <
                  state.owned.importCount + state.owned.exportCount
            ? "export"
            : undefined;
          if (orderKind !== undefined) {
            const targetOrder = orderKind === "import"
              ? orderedPosition
              : orderedPosition - state.owned.importCount;
            state.orderSearch ??= {
              kind: orderKind,
              targetOrder,
              candidateIndex: 0,
            };
            const search = state.orderSearch;
            const count = orderKind === "import"
              ? state.owned.importCount
              : state.owned.exportCount;
            const view = orderKind === "import"
              ? state.owned.importEdgeView
              : state.owned.exportView;
            const width = orderKind === "import" ? 64 : 48;
            const orderOffset = orderKind === "import" ? 40 : 12;
            while (
              used < allowance.success &&
              search.candidateIndex < count
            ) {
              const call = accessUsageCharge(
                state.workUsage,
                state.maximum,
                "calls",
                1n,
              );
              if (Result.isFailure(call)) {
                state.closed = true;
                return Result.fail(call.failure);
              }
              const candidate = search.candidateIndex;
              search.candidateIndex += 1;
              used += 1;
              if (
                view.getUint32(candidate * width + orderOffset, false) !==
                  targetOrder
              ) continue;
              state.orderSearch = undefined;
              state.recordIterator = restartModuleRecordAtV1(state, candidate);
              const advanced = advanceRestartRecordIteratorV1(
                state,
                allowance.success - used,
              );
              if (Result.isFailure(advanced)) {
                state.closed = true;
                return Result.fail(advanced.failure);
              }
              if (advanced.success.record === undefined) {
                return Result.succeed(Object.freeze({
                  status: "pending",
                  transitionCount: used + advanced.success.transitionCount,
                  hashBytes: 0n,
                  deltaUsage: frozenUsageDelta(state.workUsage, before),
                }));
              }
              state.index += 1;
              return Result.succeed(Object.freeze({
                status: "item",
                transitionCount: used + advanced.success.transitionCount,
                hashBytes: 0n,
                deltaUsage: frozenUsageDelta(state.workUsage, before),
                record: advanced.success.record,
              }));
            }
            if (search.candidateIndex >= count) {
              throw new Error("Verified arena lost a deterministic record order.");
            }
            return Result.succeed(Object.freeze({
              status: "pending",
              transitionCount: used,
              hashBytes: 0n,
              deltaUsage: frozenUsageDelta(state.workUsage, before),
            }));
          }
          const functionOrdinal =
            state.index - 1 - state.owned.importCount - state.owned.exportCount;
          if (
            functionOrdinal >= 0 &&
            functionOrdinal < state.owned.functionCount
          ) {
            state.bodyHash ??= {
              functionOrdinal,
              searchIndex: 0,
              functionIndex: undefined,
              hash: undefined,
              prefix: undefined,
              prefixOffset: 0,
              tokenIndex: 0,
              bodyEnd: 0,
              tokenPrefix: undefined,
              tokenPrefixOffset: 0,
              tokenByteOffset: 0,
              tokenByteLength: 0,
              tokenByteCursor: 0,
              digest: undefined,
              phase: "search",
            };
            while (
              used < allowance.success &&
              state.bodyHash.phase !== "ready"
            ) {
              const call = accessUsageCharge(
                state.workUsage,
                state.maximum,
                "calls",
                1n,
              );
              if (Result.isFailure(call)) {
                state.closed = true;
                return Result.fail(call.failure);
              }
              const advanced = advanceRestartBodyHashV1(state);
              if (advanced.hashBytes > 0n) {
                const charged = accessUsageCharge(
                  state.workUsage,
                  state.maximum,
                  "hashBytes",
                  advanced.hashBytes,
                );
                if (Result.isFailure(charged)) {
                  state.closed = true;
                  return Result.fail(charged.failure);
                }
              }
              used += advanced.transitionCount;
              hashBytes += advanced.hashBytes;
            }
            if (state.bodyHash.phase !== "ready") {
              return Result.succeed(Object.freeze({
                status: "pending",
                transitionCount: used,
                hashBytes,
                deltaUsage: frozenUsageDelta(state.workUsage, before),
              }));
            }
            if (used >= allowance.success) {
              return Result.succeed(Object.freeze({
                status: "pending",
                transitionCount: used,
                hashBytes,
                deltaUsage: frozenUsageDelta(state.workUsage, before),
              }));
            }
            state.recordIterator = restartModuleRecordAtV1(
              state,
              undefined,
              state.bodyHash.functionIndex,
              state.bodyHash.digest,
            );
            state.bodyHash = undefined;
            const advanced = advanceRestartRecordIteratorV1(
              state,
              allowance.success - used,
            );
            if (Result.isFailure(advanced)) {
              state.closed = true;
              return Result.fail(advanced.failure);
            }
            if (advanced.success.record === undefined) {
              return Result.succeed(Object.freeze({
                status: "pending",
                transitionCount: used + advanced.success.transitionCount,
                hashBytes,
                deltaUsage: frozenUsageDelta(state.workUsage, before),
              }));
            }
            state.index += 1;
            return Result.succeed(Object.freeze({
              status: "item",
              transitionCount: used + advanced.success.transitionCount,
              hashBytes,
              deltaUsage: frozenUsageDelta(state.workUsage, before),
              record: advanced.success.record,
            }));
          }
        }
        if (state.restartRecords === undefined) {
          state.recordIterator = restartModuleRecordAtV1(state);
          const advanced = advanceRestartRecordIteratorV1(
            state,
            allowance.success,
          );
          if (Result.isFailure(advanced)) {
            state.closed = true;
            return Result.fail(advanced.failure);
          }
          if (advanced.success.record !== undefined) {
            state.index += 1;
            return Result.succeed(Object.freeze({
              status: "item",
              transitionCount: advanced.success.transitionCount,
              hashBytes: 0n,
              deltaUsage: advanced.success.deltaUsage,
              record: advanced.success.record,
            }));
          }
          if (state.recordIterator !== undefined) {
            return Result.succeed(Object.freeze({
              status: "pending",
              transitionCount: advanced.success.transitionCount,
              hashBytes: 0n,
              deltaUsage: advanced.success.deltaUsage,
            }));
          }
        }
        const call = accessUsageCharge(
          state.workUsage,
          state.maximum,
          "calls",
          1n,
        );
        if (Result.isFailure(call)) {
          state.closed = true;
          return Result.fail(call.failure);
        }
        const record = state.restartRecords?.[state.index];
        if (record === undefined) {
          state.closed = true;
          return Result.succeed(Object.freeze({
            status: "complete",
            transitionCount: 1,
            hashBytes: 0n,
            deltaUsage: frozenUsageDelta(state.workUsage, before),
          }));
        }
        state.index += 1;
        return Result.succeed(Object.freeze({
          status: "item",
          transitionCount: 1,
          hashBytes: 0n,
          deltaUsage: frozenUsageDelta(state.workUsage, before),
          record,
        }));
      };

  const openLinkRecords:
    DeclarativeV2VerifierExecutableRestartBridgeV1["openLinkRecords"] =
      (rawResult, rawParsePagesRootSha256, maximum) => {
        const provenance = rawResult !== null && typeof rawResult === "object"
          ? RESTART_RESULT_PROVENANCE.get(rawResult)
          : undefined;
        const owned = rawResult !== null && typeof rawResult === "object"
          ? OWNED_LINK_RESULTS.get(rawResult)
          : undefined;
        if (provenance?.owner === owner && provenance.revoked) {
          return Result.fail(executableError("access", "closed"));
        }
        if (
          (provenance !== undefined &&
            (provenance.owner !== owner || provenance.revoked)) ||
          owned === undefined ||
          !isUint8ArrayWithByteLength(rawParsePagesRootSha256, 32)
        ) {
          return Result.fail(executableError("access", "invalidInput"));
        }
        if (
          provenance?.parsePagesRootSha256 !== undefined &&
          !bytesEqualFullScan(
            provenance.parsePagesRootSha256,
            rawParsePagesRootSha256,
          )
        ) {
          return Result.fail(executableError("access", "invalidInput"));
        }
        const handle = cursor();
        linkCursors.set(handle, {
          owned,
          maximum,
          workUsage: zeroUsage(),
          parsePagesRootSha256: new Uint8Array(rawParsePagesRootSha256),
          sourceSearchIndex: 0,
          diagnosticSearchIndex: 0,
          recordIterator: undefined,
          index: 0,
          closed: false,
        });
        return Result.succeed(handle);
      };

  const readLinkRecord:
    DeclarativeV2VerifierExecutableRestartBridgeV1["readLinkRecord"] =
      (rawCursor, rawAllowance) => {
        const state = rawCursor !== null && typeof rawCursor === "object"
          ? linkCursors.get(rawCursor)
          : undefined;
        if (state === undefined) {
          return Result.fail(executableError("access", "invalidInput"));
        }
        if (state.closed) {
          return Result.fail(executableError("access", "closed"));
        }
        const allowance = restartAllowanceV1(rawAllowance);
        if (Result.isFailure(allowance)) {
          state.closed = true;
          return Result.fail(allowance.failure);
        }
        if (allowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            transitionCount: 0,
            hashBytes: 0n,
            deltaUsage: frozenUsage(zeroUsage()),
          }));
        }
        const before = usageSnapshot(state.workUsage);
        const link = state.owned.state;
        if (state.recordIterator !== undefined) {
          const advanced = advanceRestartRecordIteratorV1(
            state,
            allowance.success,
          );
          if (Result.isFailure(advanced)) {
            state.closed = true;
            return Result.fail(advanced.failure);
          }
          if (advanced.success.record === undefined) {
            return Result.succeed(Object.freeze({
              status: "pending",
              transitionCount: advanced.success.transitionCount,
              hashBytes: 0n,
              deltaUsage: advanced.success.deltaUsage,
            }));
          }
          state.index += 1;
          return Result.succeed(Object.freeze({
            status: "item",
            transitionCount: advanced.success.transitionCount,
            hashBytes: 0n,
            deltaUsage: advanced.success.deltaUsage,
            record: advanced.success.record,
          }));
        }
        if (state.index < link.importCount) {
          let used = 0;
          while (
            used < allowance.success &&
            state.sourceSearchIndex < link.count
          ) {
            const call = accessUsageCharge(
              state.workUsage,
              state.maximum,
              "calls",
              1n,
            );
            if (Result.isFailure(call)) {
              state.closed = true;
              return Result.fail(call.failure);
            }
            const sourceModule = state.sourceSearchIndex;
            state.sourceSearchIndex += 1;
            used += 1;
            const moduleOffset = sourceModule * 64;
            const start = link.moduleView.getUint32(moduleOffset + 16, false);
            const count = link.moduleView.getUint32(moduleOffset + 20, false);
            if (state.index < start || state.index >= start + count) continue;
            const importOrdinal = state.index - start;
            const offset = state.index * 64;
            const targetStored = link.importEdgeView.getUint32(
              offset + 20,
              false,
            );
            const targetModuleIndex = targetStored === 0
              ? null
              : targetStored - 1;
            const targetFunctionStored = link.importEdgeView.getUint32(
              offset + 24,
              false,
            );
            const targetOffset = link.importEdgeView.getUint32(offset, false);
            const targetLength = link.importEdgeView.getUint32(
              offset + 4,
              false,
            );
            state.sourceSearchIndex = 0;
            state.recordIterator = (function* resolvedEdgeRecord():
              RestartRecordIteratorV1 {
              const targetName = yield* restartOwnedBytesTextV1(
                link.textBytes,
                targetOffset,
                targetLength,
                "outputBytes",
              );
              return Object.freeze({
                kind: "resolved_edge_v1",
                recordOrdinal: BigInt(state.index),
                edgeOrdinal: BigInt(state.index),
                sourceModuleOrdinal: link.moduleView.getBigUint64(
                  moduleOffset + 8,
                  false,
                ),
                importOrdinal: BigInt(importOrdinal),
                targetKind:
                  link.importEdgeView.getUint32(offset + 16, false) === 1
                    ? "module"
                    : "platform",
                targetModuleOrdinal: targetModuleIndex === null
                  ? null
                  : link.moduleView.getBigUint64(
                    targetModuleIndex * 64 + 8,
                    false,
                  ),
                targetFunctionOrdinal: targetModuleIndex === null
                  ? null
                  : targetFunctionStored === 0
                  ? null
                  : BigInt(targetFunctionStored - 1),
                targetName,
              } satisfies DeclarativeV2RestartResolvedEdgeRecordV1);
            })();
            const advanced = advanceRestartRecordIteratorV1(
              state,
              allowance.success - used,
            );
            if (Result.isFailure(advanced)) {
              state.closed = true;
              return Result.fail(advanced.failure);
            }
            if (advanced.success.record === undefined) {
              return Result.succeed(Object.freeze({
                status: "pending",
                transitionCount: used + advanced.success.transitionCount,
                hashBytes: 0n,
                deltaUsage: frozenUsageDelta(state.workUsage, before),
              }));
            }
            state.index += 1;
            return Result.succeed(Object.freeze({
              status: "item",
              transitionCount: used + advanced.success.transitionCount,
              hashBytes: 0n,
              deltaUsage: frozenUsageDelta(state.workUsage, before),
              record: advanced.success.record,
            }));
          }
          if (state.sourceSearchIndex >= link.count) {
            throw new Error("Linked import lost its source module.");
          }
          return Result.succeed(Object.freeze({
            status: "pending",
            transitionCount: used,
            hashBytes: 0n,
            deltaUsage: frozenUsageDelta(state.workUsage, before),
          }));
        }
        let position = state.index - link.importCount;
        let record: DeclarativeV2VerifierRestartRecordV1 | undefined;
        if (record === undefined && position < link.count) {
          const moduleIndex = orderedModule(link, position);
          record = Object.freeze({
            kind: "module_order_v1",
            recordOrdinal: BigInt(state.index),
            orderOrdinal: BigInt(position),
            moduleOrdinal: link.moduleView.getBigUint64(
              moduleIndex * 64 + 8,
              false,
            ),
          });
        } else if (record === undefined) {
          position -= link.count;
          if (position === 0) {
            record = Object.freeze({
              kind: "cycle_result_v1",
              recordOrdinal: BigInt(state.index),
              cycleOrdinal: 0n,
              moduleCount: BigInt(link.count),
              membersRootSha256: new Uint8Array(32),
              accepted: !link.hasCycleDiagnostic,
            });
          } else {
            position -= 1;
            if (position < link.diagnosticCount) {
              if (state.diagnosticSearchIndex >= link.diagnosticCount) {
                throw new Error(
                  "Linked diagnostic lost its deterministic order.",
                );
              }
              const index = state.diagnosticSearchIndex;
              state.diagnosticSearchIndex += 1;
              if (
                link.diagnosticView.getUint32(index * 32 + 16, false) !==
                  position
              ) {
                const call = accessUsageCharge(
                  state.workUsage,
                  state.maximum,
                  "calls",
                  1n,
                );
                if (Result.isFailure(call)) {
                  state.closed = true;
                  return Result.fail(call.failure);
                }
                return Result.succeed(Object.freeze({
                  status: "pending",
                  transitionCount: 1,
                  hashBytes: 0n,
                  deltaUsage: frozenUsageDelta(state.workUsage, before),
                }));
              }
              state.diagnosticSearchIndex = 0;
              const offset = index * 32;
              const id = link.diagnosticView.getUint32(offset, false);
              const definition = DECLARATIVE_V2_CORE_DIAGNOSTICS_V1.find(
                candidate => candidate.id === id,
              );
              if (definition === undefined) {
                throw new Error("Linked diagnostic lost its definition.");
              }
              record = Object.freeze({
                kind: "diagnostic_v1",
                recordOrdinal: BigInt(state.index),
                phase: "link",
                moduleOrdinal: link.diagnosticView.getBigUint64(
                  offset + 8,
                  false,
                ),
                diagnosticOrdinal: BigInt(position),
                byteOffset: 0n,
                diagnosticId: BigInt(id),
                code: definition.code,
                message: definition.rule,
              });
            } else {
              position -= link.diagnosticCount;
              if (position === 0) {
                record = Object.freeze({
                  kind: "link_terminal_v1",
                  recordOrdinal: BigInt(state.index),
                  moduleCount: BigInt(link.count),
                  edgeCount: BigInt(link.importCount),
                  orderCount: BigInt(link.count),
                  cycleCount: 1n,
                  diagnosticCount: BigInt(link.diagnosticCount),
                  parsePagesRootSha256: new Uint8Array(
                    state.parsePagesRootSha256,
                  ),
                  precedingRecordsRootSha256: new Uint8Array(32),
                });
              }
            }
          }
        }
        if (record === undefined) {
          const call = accessUsageCharge(
            state.workUsage,
            state.maximum,
            "calls",
            1n,
          );
          if (Result.isFailure(call)) {
            state.closed = true;
            return Result.fail(call.failure);
          }
          state.closed = true;
          return Result.succeed(Object.freeze({
            status: "complete",
            transitionCount: 1,
            hashBytes: 0n,
            deltaUsage: frozenUsageDelta(state.workUsage, before),
          }));
        }
        const call = accessUsageCharge(
          state.workUsage,
          state.maximum,
          "calls",
          1n,
        );
        if (Result.isFailure(call)) {
          state.closed = true;
          return Result.fail(call.failure);
        }
        state.index += 1;
        return Result.succeed(Object.freeze({
          status: "item",
          transitionCount: 1,
          hashBytes: 0n,
          deltaUsage: frozenUsageDelta(state.workUsage, before),
          record,
        }));
      };

  const createModuleBuilder:
    DeclarativeV2VerifierExecutableRestartBridgeV1["createModuleBuilder"] =
      (rawMaximum, rawUsage) => {
        const maximum = captureAccessBudgetV1(rawMaximum);
        const usage =
          captureLocalBudgetFrame(rawUsage, "attempt_usage") ??
          captureLocalBudgetFrame(rawUsage, "command_budget");
        if (Result.isFailure(maximum) || usage === undefined) {
          return Result.fail(executableError("access", "invalidBudget"));
        }
        const handle = builder();
        builders.set(handle, {
          maximum: maximum.success,
          usage,
          workUsage: zeroUsage(),
          records: [],
          iterator: undefined,
          closed: false,
        });
        return Result.succeed(handle);
      };

  const appendModuleRecord:
    DeclarativeV2VerifierExecutableRestartBridgeV1["appendModuleRecord"] =
      (rawBuilder, rawRecord) => {
        const state = rawBuilder !== null && typeof rawBuilder === "object"
          ? builders.get(rawBuilder)
          : undefined;
        if (state === undefined) {
          return Result.fail(executableError("access", "invalidInput"));
        }
        if (state.closed) {
          return Result.fail(executableError("access", "closed"));
        }
        if (
          rawRecord === null ||
          typeof rawRecord !== "object" ||
          !("kind" in rawRecord) ||
          typeof rawRecord.kind !== "string"
        ) {
          state.closed = true;
          return Result.fail(executableError("access", "invalidInput"));
        }
        const before = usageSnapshot(state.workUsage);
        const call = accessUsageCharge(
          state.workUsage,
          state.maximum,
          "calls",
          1n,
        );
        const reference = Result.isFailure(call)
          ? call
          : accessUsageCharge(
            state.workUsage,
            state.maximum,
            "tableBytes",
            8n,
          );
        if (Result.isFailure(reference)) {
          state.closed = true;
          return Result.fail(reference.failure);
        }
        state.records.push(rawRecord as DeclarativeV2VerifierRestartRecordV1);
        return Result.succeed(
          frozenUsageDelta(state.workUsage, before),
        );
      };

  const finishModuleBuilder:
    DeclarativeV2VerifierExecutableRestartBridgeV1["finishModuleBuilder"] =
      (rawBuilder, rawAllowance) => {
        const state = rawBuilder !== null && typeof rawBuilder === "object"
          ? builders.get(rawBuilder)
          : undefined;
        if (state === undefined) {
          return Result.fail(executableError("access", "invalidInput"));
        }
        if (state.closed) {
          return Result.fail(executableError("access", "closed"));
        }
        const allowance = restartAllowanceV1(rawAllowance);
        if (Result.isFailure(allowance)) {
          state.closed = true;
          return Result.fail(allowance.failure);
        }
        if (allowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            transitionCount: 0,
            deltaUsage: frozenUsage(zeroUsage()),
          }));
        }
        const usageBefore = usageSnapshot(state.workUsage);
        state.iterator ??= (function* moduleBuilderIterator() {
        yield 1;
        const identity = state.records[0];
        const terminal = state.records[state.records.length - 1];
        if (
          identity?.kind !== "module_identity_v1" ||
          terminal?.kind !== "parse_terminal_v1"
        ) {
          return Result.fail(executableError("access", "invalidState"));
        }
        const chargeBuilder = (
          dimension: typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
          amount: bigint,
        ): void => {
          const charged = accessUsageCharge(
            state.workUsage,
            state.maximum,
            dimension,
            amount,
          );
          if (Result.isFailure(charged)) throw charged.failure;
        };
        const arenaCount = (value: bigint, _path: string): number => {
          if (value < 0n || value > 0xffff_ffffn) {
            throw executableError("access", "budgetExceeded", {
              dimension: "tableBytes",
              observed: value,
              maximum: 0xffff_ffffn,
            });
          }
          return Number(value);
        };
        const importCount = arenaCount(terminal.importCount, "importCount");
        const exportCount = arenaCount(terminal.exportCount, "exportCount");
        const functionCount = arenaCount(
          terminal.functionCount,
          "functionCount",
        );
        const callCount = arenaCount(terminal.callCount, "callCount");
        const flowCount = arenaCount(
          terminal.valueFlowCount,
          "valueFlowCount",
        );
        const diagnosticCount = arenaCount(
          terminal.diagnosticCount,
          "diagnosticCount",
        );
        chargeBuilder("modules", 1n);
        chargeBuilder(
          "importEdges",
          terminal.importCount + terminal.callCount,
        );
        chargeBuilder("exports", terminal.exportCount);
        chargeBuilder("functions", terminal.functionCount);
        chargeBuilder("graphNodes", terminal.valueFlowCount);
        chargeBuilder("diagnosticBytes", terminal.diagnosticCount);
        const partitionReferenceCount =
          terminal.importCount +
          terminal.exportCount +
          terminal.functionCount +
          terminal.callCount +
          terminal.valueFlowCount +
          terminal.diagnosticCount;
        const maximumTextReferenceCount =
          1n +
          terminal.importCount * 3n +
          terminal.exportCount * 2n +
          terminal.functionCount +
          terminal.callCount;
        const tokenIndexBytes =
          terminal.importCount * 12n +
          terminal.exportCount * 8n +
          terminal.functionCount * 4n +
          terminal.callCount * 4n;
        chargeBuilder(
          "tableBytes",
          partitionReferenceCount * 8n +
            maximumTextReferenceCount * 16n +
            tokenIndexBytes,
        );
        const imports =
          new Array<DeclarativeV2RestartStaticImportRecordV1>(importCount);
        const exports =
          new Array<DeclarativeV2RestartExportBindingRecordV1>(exportCount);
        const functions =
          new Array<DeclarativeV2RestartFunctionRecordV1>(functionCount);
        const calls =
          new Array<DeclarativeV2RestartDirectCallRecordV1>(callCount);
        const flows =
          new Array<DeclarativeV2RestartValueFlowRecordV1>(flowCount);
        const diagnostics =
          new Array<DeclarativeV2RestartDiagnosticRecordV1>(diagnosticCount);
        let importIndex = 0;
        let exportIndex = 0;
        let functionIndex = 0;
        let callIndex = 0;
        let flowIndex = 0;
        let diagnosticIndex = 0;
        for (const record of state.records) {
          yield 1;
          switch (record.kind) {
            case "static_import_v1":
              if (importIndex >= imports.length) {
                return Result.fail(executableError("access", "invalidState"));
              }
              imports[importIndex++] = record;
              break;
            case "export_binding_v1":
              if (exportIndex >= exports.length) {
                return Result.fail(executableError("access", "invalidState"));
              }
              exports[exportIndex++] = record;
              break;
            case "function_v1":
              if (functionIndex >= functions.length) {
                return Result.fail(executableError("access", "invalidState"));
              }
              functions[functionIndex++] = record;
              break;
            case "direct_call_v1":
              if (callIndex >= calls.length) {
                return Result.fail(executableError("access", "invalidState"));
              }
              calls[callIndex++] = record;
              break;
            case "value_flow_v1":
              if (flowIndex >= flows.length) {
                return Result.fail(executableError("access", "invalidState"));
              }
              flows[flowIndex++] = record;
              break;
            case "diagnostic_v1":
              if (diagnosticIndex >= diagnostics.length) {
                return Result.fail(executableError("access", "invalidState"));
              }
              diagnostics[diagnosticIndex++] = record;
              break;
            default:
              break;
          }
        }
        if (
          importIndex !== imports.length ||
          exportIndex !== exports.length ||
          functionIndex !== functions.length ||
          callIndex !== calls.length ||
          flowIndex !== flows.length ||
          diagnosticIndex !== diagnostics.length
        ) {
          return Result.fail(executableError("access", "invalidState"));
        }
        interface BuilderTextV1 {
          readonly value: string;
          readonly quoted: boolean;
        }
        chargeBuilder("tokens", 1n);
        const strings: BuilderTextV1[] = [{
          value: identity.modulePath,
          quoted: false,
        }];
        const textEquals = function* (
          left: BuilderTextV1,
          right: BuilderTextV1,
        ): Generator<number, boolean, void> {
          yield 1;
          if (
            left.quoted !== right.quoted ||
            left.value.length !== right.value.length
          ) return false;
          for (let index = 0; index < left.value.length; index += 1) {
            yield 1;
            if (left.value.charCodeAt(index) !== right.value.charCodeAt(index)) {
              return false;
            }
          }
          return true;
        };
        const tokenIndex = function* (
          value: string,
          quoted = false,
        ): Generator<number, number, void> {
          const candidate = { value, quoted };
          for (let index = 0; index < strings.length; index += 1) {
            if (yield* textEquals(strings[index]!, candidate)) return index;
          }
          yield 1;
          chargeBuilder("tokens", 1n);
          strings.push(Object.freeze(candidate));
          return strings.length - 1;
        };
        const importTokens = new Uint32Array(imports.length * 3);
        for (let index = 0; index < imports.length; index += 1) {
          const record = imports[index]!;
          importTokens[index * 3] = yield* tokenIndex(record.importedName);
          importTokens[index * 3 + 1] = yield* tokenIndex(record.localName);
          importTokens[index * 3 + 2] = yield* tokenIndex(
            record.sourceModulePath,
            true,
          );
        }
        const exportTokens = new Uint32Array(exports.length * 2);
        for (let index = 0; index < exports.length; index += 1) {
          const record = exports[index]!;
          exportTokens[index * 2] = yield* tokenIndex(record.exportName);
          exportTokens[index * 2 + 1] = yield* tokenIndex(
            record.localFunctionName,
          );
        }
        const functionTokens = new Uint32Array(functions.length);
        for (let index = 0; index < functions.length; index += 1) {
          functionTokens[index] = yield* tokenIndex(
            functions[index]!.functionName,
          );
        }
        const callTokens = new Uint32Array(calls.length);
        for (let index = 0; index < calls.length; index += 1) {
          callTokens[index] = yield* tokenIndex(calls[index]!.targetName);
        }
        const utf8ByteLengthOf = function* (
          text: BuilderTextV1,
        ): Generator<number, number, void> {
          let byteLength = text.quoted ? 2 : 0;
          for (let index = 0; index < text.value.length; index += 1) {
            yield 1;
            const first = text.value.charCodeAt(index);
            if (first <= 0x7f) byteLength += 1;
            else if (first <= 0x7ff) byteLength += 2;
            else if (first >= 0xd800 && first <= 0xdbff) {
              index += 1;
              byteLength += 4;
            } else byteLength += 3;
          }
          return byteLength;
        };
        const encodeText = function* (
          text: BuilderTextV1,
          maximumBytes: number,
        ): Generator<number, Uint8Array, void> {
          const byteLength = yield* utf8ByteLengthOf(text);
          if (byteLength > maximumBytes) {
            throw executableError("access", "budgetExceeded", {
              dimension: "stringBytes",
              observed: BigInt(byteLength),
              maximum: BigInt(maximumBytes),
            });
          }
          chargeBuilder("stringBytes", BigInt(byteLength));
          chargeBuilder("tableBytes", BigInt(byteLength));
          const output = new Uint8Array(byteLength);
          let offset = 0;
          const write = function* (byte: number): Generator<number, void, void> {
            yield 1;
            output[offset] = byte;
            offset += 1;
          };
          if (text.quoted) yield* write(0x22);
          for (let index = 0; index < text.value.length; index += 1) {
            const first = text.value.charCodeAt(index);
            let codePoint = first;
            if (first >= 0xd800 && first <= 0xdbff) {
              const second = text.value.charCodeAt(index + 1);
              codePoint =
                0x1_0000 + ((first - 0xd800) << 10) + (second - 0xdc00);
              index += 1;
            }
            if (codePoint <= 0x7f) {
              yield* write(codePoint);
            } else if (codePoint <= 0x7ff) {
              yield* write(0xc0 | (codePoint >>> 6));
              yield* write(0x80 | (codePoint & 0x3f));
            } else if (codePoint <= 0xffff) {
              yield* write(0xe0 | (codePoint >>> 12));
              yield* write(0x80 | ((codePoint >>> 6) & 0x3f));
              yield* write(0x80 | (codePoint & 0x3f));
            } else {
              yield* write(0xf0 | (codePoint >>> 18));
              yield* write(0x80 | ((codePoint >>> 12) & 0x3f));
              yield* write(0x80 | ((codePoint >>> 6) & 0x3f));
              yield* write(0x80 | (codePoint & 0x3f));
            }
          }
          if (text.quoted) yield* write(0x22);
          return output;
        };
        const encodedStrings: Uint8Array[] = [];
        let totalStringBytes = 0;
        for (const text of strings) {
          const remainingBigInt =
            state.maximum.stringBytes - BigInt(totalStringBytes);
          if (remainingBigInt < 0n) {
            return Result.fail(executableError("access", "budgetExceeded", {
              dimension: "stringBytes",
              observed: BigInt(totalStringBytes),
              maximum: state.maximum.stringBytes,
            }));
          }
          const remaining = Number(
            remainingBigInt > 0xffff_ffffn
              ? 0xffff_ffffn
              : remainingBigInt,
          );
          const encoded = yield* encodeText(text, remaining);
          totalStringBytes += encoded.byteLength;
          encodedStrings.push(encoded);
        }
        if (
          BigInt(totalStringBytes) > state.maximum.stringBytes ||
          BigInt(strings.length) > state.maximum.tokens
        ) {
          return Result.fail(executableError("access", "budgetExceeded"));
        }
        chargeBuilder("tableBytes", BigInt(totalStringBytes));
        const stringBytes = new Uint8Array(totalStringBytes);
        chargeBuilder("tableBytes", BigInt(strings.length * 56));
        const tokenView = new DataView(new ArrayBuffer(strings.length * 56));
        let stringOffset = 0;
        for (let index = 0; index < encodedStrings.length; index += 1) {
          const bytes = encodedStrings[index]!;
          for (let byteIndex = 0; byteIndex < bytes.byteLength; byteIndex += 1) {
            yield 1;
            stringBytes[stringOffset + byteIndex] = bytes[byteIndex]!;
          }
          tokenView.setUint32(index * 56 + 12, stringOffset, false);
          tokenView.setUint32(index * 56 + 16, bytes.byteLength, false);
          stringOffset += bytes.byteLength;
        }
        chargeBuilder("outputBytes", BigInt(encodedStrings[0]!.byteLength));
        const outputBytes = new Uint8Array(encodedStrings[0]!.byteLength);
        for (let index = 0; index < outputBytes.byteLength; index += 1) {
          yield 1;
          outputBytes[index] = encodedStrings[0]![index]!;
        }
        chargeBuilder("tableBytes", 64n);
        const moduleView = new DataView(new ArrayBuffer(64));
        moduleView.setUint32(0, 0, false);
        moduleView.setUint32(4, outputBytes.byteLength, false);
        moduleView.setBigUint64(8, identity.moduleOrdinal, false);
        moduleView.setBigUint64(16, identity.sourceByteLength, false);
        chargeBuilder(
          "tableBytes",
          BigInt((imports.length + calls.length) * 64),
        );
        const importEdgeView = new DataView(
          new ArrayBuffer((imports.length + calls.length) * 64),
        );
        for (let index = 0; index < imports.length; index += 1) {
          yield 1;
          const record = imports[index]!;
          const offset = index * 64;
          importEdgeView.setUint32(
            offset + 4,
            importTokens[index * 3]! + 1,
            false,
          );
          importEdgeView.setUint32(
            offset + 8,
            importTokens[index * 3 + 1]! + 1,
            false,
          );
          importEdgeView.setUint32(
            offset + 12,
            importTokens[index * 3 + 2]! + 1,
            false,
          );
          importEdgeView.setUint32(
            offset + 16,
            record.sourceModulePath.charCodeAt(0) === 0x2e ? 1 : 2,
            false,
          );
          importEdgeView.setUint32(offset + 40, index, false);
        }
        for (let index = 0; index < calls.length; index += 1) {
          yield 1;
          const record = calls[index]!;
          const offset = (imports.length + index) * 64;
          importEdgeView.setUint32(
            offset + 16,
            record.targetKind === "artifactImport"
              ? 1
              : record.targetKind === "platformImport"
              ? 2
              : record.targetKind === "local"
              ? 3
              : 4,
            false,
          );
          importEdgeView.setUint32(
            offset + 20,
            Number(record.callerFunctionOrdinal) + 1,
            false,
          );
          importEdgeView.setUint32(
            offset + 24,
            callTokens[index]! + 1,
            false,
          );
          let importIndex = -1;
          if (record.targetModulePath !== null) {
            for (let candidateIndex = 0; candidateIndex < imports.length; candidateIndex += 1) {
              if (
                yield* textEquals(
                  { value: imports[candidateIndex]!.sourceModulePath, quoted: false },
                  { value: record.targetModulePath, quoted: false },
                )
              ) {
                importIndex = candidateIndex;
                break;
              }
            }
          }
          importEdgeView.setUint32(offset + 28, importIndex + 1, false);
          importEdgeView.setUint32(offset + 32, Number(record.callOrdinal), false);
          let flow: DeclarativeV2RestartValueFlowRecordV1 | undefined;
          for (const candidate of flows) {
            yield 1;
            if (
              candidate.functionOrdinal === record.callerFunctionOrdinal &&
              (yield* textEquals(
                { value: candidate.operationName, quoted: false },
                { value: record.targetName, quoted: false },
              ))
            ) {
              flow = candidate;
              break;
            }
          }
          if (flow !== undefined) {
            let abi = -1;
            for (
              let candidateIndex = 0;
              candidateIndex < DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1.length;
              candidateIndex += 1
            ) {
              if (
                yield* textEquals(
                  {
                    value:
                      DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1[candidateIndex]!.name,
                    quoted: false,
                  },
                  { value: flow.operationName, quoted: false },
                )
              ) {
                abi = candidateIndex;
                break;
              }
            }
            if (abi >= 0) {
              importEdgeView.setUint32(offset + 36, abi + 1, false);
              importEdgeView.setUint32(offset + 44, Number(flow.flowOrdinal), false);
            }
          }
        }
        chargeBuilder("tableBytes", BigInt(exports.length * 48));
        const exportView = new DataView(new ArrayBuffer(exports.length * 48));
        for (let index = 0; index < exports.length; index += 1) {
          yield 1;
          const record = exports[index]!;
          const offset = index * 48;
          exportView.setUint32(
            offset,
            record.exportName === "default" ? 0 : exportTokens[index * 2]! + 1,
            false,
          );
          exportView.setUint32(
            offset + 4,
            exportTokens[index * 2 + 1]! + 1,
            false,
          );
          exportView.setUint32(offset + 8, record.exportName === "default" ? 1 : 0, false);
          exportView.setUint32(offset + 12, index, false);
        }
        chargeBuilder("tableBytes", BigInt(functions.length * 144));
        const functionView = new DataView(new ArrayBuffer(functions.length * 144));
        for (let index = 0; index < functions.length; index += 1) {
          yield 1;
          const record = functions[index]!;
          const offset = index * 144;
          functionView.setUint32(offset, functionTokens[index]! + 1, false);
          functionView.setUint32(offset + 4, record.async ? 1 : 0, false);
          functionView.setUint32(offset + 16, index, false);
          functionView.setUint32(offset + 20, Number(record.parameterCount), false);
          for (
            let byteIndex = 0;
            byteIndex < record.bodySha256.byteLength;
            byteIndex += 1
          ) {
            yield 1;
            functionView.setUint8(offset + 32 + byteIndex, record.bodySha256[byteIndex]!);
          }
        }
        chargeBuilder("tableBytes", BigInt(diagnostics.length * 32));
        const diagnosticView = new DataView(new ArrayBuffer(diagnostics.length * 32));
        for (let index = 0; index < diagnostics.length; index += 1) {
          yield 1;
          const record = diagnostics[index]!;
          const offset = index * 32;
          diagnosticView.setUint32(offset, Number(record.diagnosticId), false);
          diagnosticView.setBigUint64(offset + 8, record.byteOffset, false);
          diagnosticView.setUint32(offset + 16, index, false);
        }
        chargeBuilder(
          "tableBytes",
          BigInt((flows.length + diagnostics.length) * 4),
        );
        const evidenceIndexView = new DataView(
          new ArrayBuffer((flows.length + diagnostics.length) * 4),
        );
        for (let index = 0; index < flows.length; index += 1) {
          const flow = flows[index]!;
          let callIndex = -1;
          for (let candidateIndex = 0; candidateIndex < calls.length; candidateIndex += 1) {
            yield 1;
            const call = calls[candidateIndex]!;
            if (
              call.callerFunctionOrdinal === flow.functionOrdinal &&
              (yield* textEquals(
                { value: call.targetName, quoted: false },
                { value: flow.operationName, quoted: false },
              ))
            ) {
              callIndex = candidateIndex;
              break;
            }
          }
          evidenceIndexView.setUint32(index * 4, imports.length + Math.max(0, callIndex), false);
        }
        for (let index = 0; index < diagnostics.length; index += 1) {
          yield 1;
          evidenceIndexView.setUint32((flows.length + index) * 4, index, false);
        }
        const reconstructedUsage = Object.freeze({
          ...state.usage,
          sourceBytes: identity.sourceByteLength,
        } satisfies DeclarativeV2VerifierBudgetFrameV2);
        yield 1;
        const runtimeArena = createDeclarativeV2VerifierRuntimeArenaV1({
          requiredBytes: 0,
          regions: Object.freeze([]),
          usage: Object.freeze({
            ...state.maximum,
            kind: "command_budget",
          }),
        });
        if (Result.isFailure(runtimeArena)) {
          return Result.fail(executableError("access", "invalidBudget"));
        }
        const incompleteOwned = Object.freeze({
          runtimeArena: runtimeArena.success,
          tokenView,
          stringBytes,
          outputBytes,
          moduleView,
          importEdgeView,
          exportView,
          functionView,
          diagnosticView,
          evidenceIndexView,
          sourceSha256: new Uint8Array(identity.sourceSha256),
          moduleOrdinal: identity.moduleOrdinal,
          importCount: imports.length,
          exportCount: exports.length,
          functionCount: functions.length,
          callCount: calls.length,
          valueFlowCount: flows.length,
          diagnosticCount: diagnostics.length,
          evidenceSha256: "",
          verified: diagnostics.length === 0,
          usage: reconstructedUsage,
        } satisfies DeclarativeV2VerifierOwnedModuleArenaV1);
        const evidenceSha256 = yield* deriveRestartModuleEvidenceSha256V1(
          incompleteOwned,
          state.maximum,
          state.workUsage,
        );
        const owned = Object.freeze({
          ...incompleteOwned,
          evidenceSha256,
        });
        const result = Object.freeze({
          _tag: "DeclarativeV2VerifierModuleResultV1",
          verified: owned.verified,
          moduleOrdinal: owned.moduleOrdinal,
          importCount: BigInt(owned.importCount),
          exportCount: BigInt(owned.exportCount),
          functionCount: BigInt(owned.functionCount),
          callCount: BigInt(owned.callCount),
          valueFlowCount: BigInt(owned.valueFlowCount),
          diagnosticCount: BigInt(owned.diagnosticCount),
          evidenceSha256: owned.evidenceSha256,
          usage: reconstructedUsage,
        } satisfies DeclarativeV2VerifierModuleResultV1);
        OWNED_MODULE_RESULTS.set(
          result,
          owned as DeclarativeV2VerifierOwnedModuleArenaV1,
        );
        RESTART_RESULT_PROVENANCE.set(result, {
          owner,
          restartRecords: Object.freeze(state.records),
          revoked: false,
        });
        return Result.succeed(result);
        })();
        let used = 0;
        while (used < allowance.success) {
          let advanced: IteratorResult<
            number,
            Result.Result<
              DeclarativeV2VerifierModuleResultV1,
              DeclarativeV2VerifierExecutableV1Error
            >
          >;
          try {
            advanced = state.iterator.next();
          } catch (cause) {
            state.closed = true;
            if (cause instanceof DeclarativeV2VerifierExecutableV1Error) {
              return Result.fail(cause);
            }
            throw cause;
          }
          const chargedCall = accessUsageCharge(
            state.workUsage,
            state.maximum,
            "calls",
            1n,
          );
          if (Result.isFailure(chargedCall)) {
            state.closed = true;
            return Result.fail(chargedCall.failure);
          }
          used += 1;
          if (!advanced.done) continue;
          state.closed = true;
          if (Result.isFailure(advanced.value)) {
            return Result.fail(advanced.value.failure);
          }
          return Result.succeed(Object.freeze({
            status: "complete",
            transitionCount: used,
            deltaUsage: frozenUsageDelta(state.workUsage, usageBefore),
            result: advanced.value.success,
          }));
        }
        return Result.succeed(Object.freeze({
          status: "pending",
          transitionCount: used,
          deltaUsage: frozenUsageDelta(state.workUsage, usageBefore),
        }));
      };

  const adoptLinkResult:
    DeclarativeV2VerifierExecutableRestartBridgeV1["adoptLinkResult"] =
      (rawResult, rawParsePagesRootSha256) => {
        if (
          rawResult === null ||
          typeof rawResult !== "object" ||
          OWNED_LINK_RESULTS.get(rawResult) === undefined ||
          !isUint8ArrayWithByteLength(rawParsePagesRootSha256, 32) ||
          RESTART_RESULT_PROVENANCE.has(rawResult)
        ) {
          return Result.fail(executableError("access", "invalidInput"));
        }
        RESTART_RESULT_PROVENANCE.set(rawResult, {
          owner,
          parsePagesRootSha256: new Uint8Array(rawParsePagesRootSha256),
          revoked: false,
        });
        return Result.succeed(undefined);
      };

  const revoke: DeclarativeV2VerifierExecutableRestartBridgeV1["revoke"] =
    rawResult => {
      const provenance = rawResult !== null && typeof rawResult === "object"
        ? RESTART_RESULT_PROVENANCE.get(rawResult)
        : undefined;
      if (provenance === undefined || provenance.owner !== owner) {
        return Result.fail(executableError("access", "invalidInput"));
      }
      if (provenance.revoked) {
        return Result.fail(executableError("access", "closed"));
      }
      provenance.revoked = true;
      OWNED_MODULE_RESULTS.delete(rawResult as object);
      OWNED_LINK_RESULTS.delete(rawResult as object);
      return Result.succeed(undefined);
    };

  return Object.freeze({
    admitModuleResult,
    openModuleRecords,
    readModuleRecord,
    openLinkRecords,
    readLinkRecord,
    createModuleBuilder,
    appendModuleRecord,
    finishModuleBuilder,
    adoptLinkResult,
    revoke,
  });
}
