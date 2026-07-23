import {
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import { Data, Result } from "effect";
import {
  DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
  DECLARATIVE_V2_SHA256_BYTES_V1,
  type DeclarativeV2CommandKindV1,
  type DeclarativeV2VerifierPhaseV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import {
  encodeCanonicalJson,
} from "flarex-protocol/json";

const UTF8_ENCODER = new TextEncoder();
const U32_MAX = 0xffff_ffff;

const MODULE_PATH_DOMAIN = UTF8_ENCODER.encode(
  "flarex.declarative-v2/module-path-projection/v1\0",
);
const COMMAND_OUTPUT_DOMAIN = UTF8_ENCODER.encode(
  "flarex.declarative-v2/command-output-manifest/v1\0",
);

const COMMAND_KIND_TAG = {
  source_page: 1,
  parse_module: 2,
  link_page: 3,
  registration_page: 4,
} as const satisfies Readonly<Record<
  Exclude<DeclarativeV2CommandKindV1, "finalize">,
  number
>>;

const PHASE_TAG = {
  source: 1,
  parse: 2,
  link: 3,
  registration: 4,
  verdict: 5,
} as const satisfies Readonly<Record<DeclarativeV2VerifierPhaseV1, number>>;

const EVIDENCE_KIND_TAG = {
  module_summary: 1,
  import_edge: 2,
  phase_page_manifest: 3,
  link_node: 4,
  frontier_entry: 5,
  registration: 6,
  diagnostic: 7,
} as const;

export interface DeclarativeV2VerifierDerivationBudgetV1 {
  readonly maximumFrameBytes: number;
}

export interface DeclarativeV2VerifierDerivationUsageV1 {
  readonly frameBytes: number;
}

export class DeclarativeV2VerifierDerivationInputV1Error
  extends Data.TaggedError("DeclarativeV2VerifierDerivationInputV1Error")<{
    readonly operation: "modulePathProjection" | "commandOutputManifest";
    readonly reason:
      | "invalidInput"
      | "invalidBudget"
      | "frameBytesExceeded"
      | "outOfOrder";
    readonly observed?: number;
    readonly maximum?: number;
  }> {}

export class DeclarativeV2VerifierDerivationInvariantV1Defect
  extends Data.TaggedError(
    "DeclarativeV2VerifierDerivationInvariantV1Defect",
  )<{
    readonly reason: "canonicalStringEncodingFailed";
  }> {}

export interface DeclarativeV2ModulePathProjectionPreimageV1 {
  readonly bytes: Uint8Array;
  readonly usage: DeclarativeV2VerifierDerivationUsageV1;
}

export type DeclarativeV2SettledEvidenceKeyV1 =
  | Readonly<{
    readonly kind: "module_summary";
    readonly moduleOrdinal: bigint;
    readonly frameSha256: Uint8Array;
  }>
  | Readonly<{
    readonly kind: "import_edge";
    readonly moduleOrdinal: bigint;
    readonly edgeOrdinal: bigint;
    readonly frameSha256: Uint8Array;
  }>
  | Readonly<{
    readonly kind: "phase_page_manifest";
    readonly phase: DeclarativeV2VerifierPhaseV1;
    readonly pageOrdinal: bigint;
    readonly frameSha256: Uint8Array;
  }>
  | Readonly<{
    readonly kind: "link_node";
    readonly moduleOrdinal: bigint;
    readonly rowVersion: bigint;
    readonly frameSha256: Uint8Array;
  }>
  | Readonly<{
    readonly kind: "frontier_entry";
    readonly frontierSequence: bigint;
    readonly rowVersion: bigint;
    readonly frameSha256: Uint8Array;
  }>
  | Readonly<{
    readonly kind: "registration";
    readonly registrationOrdinal: bigint;
    readonly frameSha256: Uint8Array;
  }>
  | Readonly<{
    readonly kind: "diagnostic";
    readonly diagnosticOrdinal: bigint;
    readonly frameSha256: Uint8Array;
  }>;

export interface DeclarativeV2CommandOutputManifestInputV1 {
  readonly attemptSha256: Uint8Array;
  readonly commandKind: Exclude<DeclarativeV2CommandKindV1, "finalize">;
  readonly sequence: bigint;
  readonly evidence: readonly DeclarativeV2SettledEvidenceKeyV1[];
}

export interface DeclarativeV2CommandOutputManifestPreimageV1 {
  readonly bytes: Uint8Array;
  readonly evidence: readonly DeclarativeV2SettledEvidenceKeyV1[];
  readonly usage: DeclarativeV2VerifierDerivationUsageV1;
}

export function buildDeclarativeV2ModulePathProjectionPreimageV1(
  modulePath: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2ModulePathProjectionPreimageV1,
  DeclarativeV2VerifierDerivationInputV1Error
> {
  return Result.gen(function* () {
    const budget = yield* decodeBudget("modulePathProjection", rawBudget);
    if (!isNonEmptyString(modulePath)) {
      return yield* Result.fail(derivationError(
        "modulePathProjection",
        "invalidInput",
      ));
    }

    const canonicalStringBytes = canonicalJsonStringUtf8ByteLength(modulePath);
    const exactPreflightFrameBytes = checkedAdd(
      MODULE_PATH_DOMAIN.byteLength,
      4,
      canonicalStringBytes,
    );
    if (
      exactPreflightFrameBytes === undefined ||
      exactPreflightFrameBytes > budget.maximumFrameBytes
    ) {
      return yield* Result.fail(
        exactPreflightFrameBytes === undefined
          ? derivationError("modulePathProjection", "invalidInput")
          : new DeclarativeV2VerifierDerivationInputV1Error({
            operation: "modulePathProjection",
            reason: "frameBytesExceeded",
            observed: exactPreflightFrameBytes,
            maximum: budget.maximumFrameBytes,
          }),
      );
    }

    const canonicalText = encodeCanonicalJson(modulePath, () => {
      throw new DeclarativeV2VerifierDerivationInvariantV1Defect({
        reason: "canonicalStringEncodingFailed",
      });
    });
    const canonicalBytes = UTF8_ENCODER.encode(canonicalText);
    const exactFrameBytes = checkedAdd(
      MODULE_PATH_DOMAIN.byteLength,
      4,
      canonicalBytes.byteLength,
    );
    if (exactFrameBytes === undefined || canonicalBytes.byteLength > U32_MAX) {
      return yield* Result.fail(derivationError(
        "modulePathProjection",
        "invalidInput",
      ));
    }
    if (exactFrameBytes > budget.maximumFrameBytes) {
      return yield* Result.fail(new DeclarativeV2VerifierDerivationInputV1Error({
        operation: "modulePathProjection",
        reason: "frameBytesExceeded",
        observed: exactFrameBytes,
        maximum: budget.maximumFrameBytes,
      }));
    }

    const bytes = new Uint8Array(exactFrameBytes);
    let offset = copyBytes(bytes, 0, MODULE_PATH_DOMAIN);
    writeU32Be(bytes, offset, canonicalBytes.byteLength);
    offset += 4;
    copyBytes(bytes, offset, canonicalBytes);
    return Object.freeze({
      bytes,
      usage: Object.freeze({ frameBytes: bytes.byteLength }),
    });
  });
}

export function buildDeclarativeV2CommandOutputManifestPreimageV1(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2CommandOutputManifestPreimageV1,
  DeclarativeV2VerifierDerivationInputV1Error
> {
  return Result.gen(function* () {
    const budget = yield* decodeBudget("commandOutputManifest", rawBudget);
    const captured = yield* captureCommandOutputInput(input);
    if (captured.evidence.length > U32_MAX) {
      return yield* Result.fail(derivationError(
        "commandOutputManifest",
        "invalidInput",
      ));
    }
    for (let index = 1; index < captured.evidence.length; index += 1) {
      if (
        compareEvidenceKey(
          captured.evidence[index - 1]!,
          captured.evidence[index]!,
        ) >= 0
      ) {
        return yield* Result.fail(derivationError(
          "commandOutputManifest",
          "outOfOrder",
        ));
      }
    }

    let byteLength = checkedAdd(
      COMMAND_OUTPUT_DOMAIN.byteLength,
      DECLARATIVE_V2_SHA256_BYTES_V1,
      1,
      8,
      4,
    );
    for (const evidence of captured.evidence) {
      byteLength = byteLength === undefined
        ? undefined
        : checkedAdd(byteLength, encodedEvidenceByteLength(evidence));
    }
    if (byteLength === undefined) {
      return yield* Result.fail(derivationError(
        "commandOutputManifest",
        "invalidInput",
      ));
    }
    if (byteLength > budget.maximumFrameBytes) {
      return yield* Result.fail(new DeclarativeV2VerifierDerivationInputV1Error({
        operation: "commandOutputManifest",
        reason: "frameBytesExceeded",
        observed: byteLength,
        maximum: budget.maximumFrameBytes,
      }));
    }

    const bytes = new Uint8Array(byteLength);
    let offset = copyBytes(bytes, 0, COMMAND_OUTPUT_DOMAIN);
    offset = copyBytes(bytes, offset, captured.attemptSha256);
    bytes[offset] = COMMAND_KIND_TAG[captured.commandKind];
    offset += 1;
    writeU64Be(bytes, offset, captured.sequence);
    offset += 8;
    writeU32Be(bytes, offset, captured.evidence.length);
    offset += 4;
    for (const evidence of captured.evidence) {
      offset = encodeEvidence(bytes, offset, evidence);
    }
    if (offset !== bytes.byteLength) {
      throw new DeclarativeV2VerifierDerivationInvariantV1Defect({
        reason: "canonicalStringEncodingFailed",
      });
    }
    return Object.freeze({
      bytes,
      evidence: captured.evidence,
      usage: Object.freeze({ frameBytes: bytes.byteLength }),
    });
  });
}

function decodeBudget(
  operation: DeclarativeV2VerifierDerivationInputV1Error["operation"],
  value: unknown,
): Result.Result<
  Readonly<DeclarativeV2VerifierDerivationBudgetV1>,
  DeclarativeV2VerifierDerivationInputV1Error
> {
  if (
    !isNonArrayRecord(value) ||
    Object.keys(value).length !== 1 ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return Result.fail(derivationError(operation, "invalidBudget"));
  }
  const maximumFrameBytes = ownDataValue(value, "maximumFrameBytes");
  if (!isNonNegativeSafeInteger(maximumFrameBytes)) {
    return Result.fail(derivationError(operation, "invalidBudget"));
  }
  return Result.succeed(Object.freeze({ maximumFrameBytes }));
}

function captureCommandOutputInput(
  value: unknown,
): Result.Result<
  Readonly<{
    readonly attemptSha256: Uint8Array;
    readonly commandKind: Exclude<DeclarativeV2CommandKindV1, "finalize">;
    readonly sequence: bigint;
    readonly evidence: readonly DeclarativeV2SettledEvidenceKeyV1[];
  }>,
  DeclarativeV2VerifierDerivationInputV1Error
> {
  if (
    !isNonArrayRecord(value) ||
    Object.keys(value).length !== 4 ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return Result.fail(derivationError(
      "commandOutputManifest",
      "invalidInput",
    ));
  }
  const attemptSha256 = ownDataValue(value, "attemptSha256");
  const commandKind = ownDataValue(value, "commandKind");
  const sequence = ownDataValue(value, "sequence");
  const evidence = ownDataValue(value, "evidence");
  if (
    !isUint8ArrayWithByteLength(
      attemptSha256,
      DECLARATIVE_V2_SHA256_BYTES_V1,
    ) ||
    !isCommandKind(commandKind) ||
    !isU64(sequence) ||
    !Array.isArray(evidence)
  ) {
    return Result.fail(derivationError(
      "commandOutputManifest",
      "invalidInput",
    ));
  }
  const capturedEvidence: DeclarativeV2SettledEvidenceKeyV1[] = [];
  for (const item of evidence) {
    const captured = captureEvidence(item);
    if (captured === undefined) {
      return Result.fail(derivationError(
        "commandOutputManifest",
        "invalidInput",
      ));
    }
    capturedEvidence.push(captured);
  }
  return Result.succeed(Object.freeze({
    attemptSha256: new Uint8Array(attemptSha256),
    commandKind,
    sequence,
    evidence: Object.freeze(capturedEvidence),
  }));
}

function captureEvidence(
  value: unknown,
): DeclarativeV2SettledEvidenceKeyV1 | undefined {
  if (
    !isNonArrayRecord(value) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return undefined;
  }
  const kind = ownDataValue(value, "kind");
  const frameSha256 = ownDataValue(value, "frameSha256");
  if (
    typeof kind !== "string" ||
    !isUint8ArrayWithByteLength(
      frameSha256,
      DECLARATIVE_V2_SHA256_BYTES_V1,
    )
  ) {
    return undefined;
  }
  const digest = new Uint8Array(frameSha256);
  switch (kind) {
    case "module_summary": {
      if (Object.keys(value).length !== 3) return undefined;
      const moduleOrdinal = ownDataValue(value, "moduleOrdinal");
      return isU64(moduleOrdinal)
        ? Object.freeze({ kind, moduleOrdinal, frameSha256: digest })
        : undefined;
    }
    case "import_edge": {
      if (Object.keys(value).length !== 4) return undefined;
      const moduleOrdinal = ownDataValue(value, "moduleOrdinal");
      const edgeOrdinal = ownDataValue(value, "edgeOrdinal");
      return isU64(moduleOrdinal) && isU64(edgeOrdinal)
        ? Object.freeze({
          kind,
          moduleOrdinal,
          edgeOrdinal,
          frameSha256: digest,
        })
        : undefined;
    }
    case "phase_page_manifest": {
      if (Object.keys(value).length !== 4) return undefined;
      const phase = ownDataValue(value, "phase");
      const pageOrdinal = ownDataValue(value, "pageOrdinal");
      return isPhase(phase) && isU64(pageOrdinal)
        ? Object.freeze({ kind, phase, pageOrdinal, frameSha256: digest })
        : undefined;
    }
    case "link_node": {
      if (Object.keys(value).length !== 4) return undefined;
      const moduleOrdinal = ownDataValue(value, "moduleOrdinal");
      const rowVersion = ownDataValue(value, "rowVersion");
      return isU64(moduleOrdinal) && isU64(rowVersion)
        ? Object.freeze({
          kind,
          moduleOrdinal,
          rowVersion,
          frameSha256: digest,
        })
        : undefined;
    }
    case "frontier_entry": {
      if (Object.keys(value).length !== 4) return undefined;
      const frontierSequence = ownDataValue(value, "frontierSequence");
      const rowVersion = ownDataValue(value, "rowVersion");
      return isU64(frontierSequence) && isU64(rowVersion)
        ? Object.freeze({
          kind,
          frontierSequence,
          rowVersion,
          frameSha256: digest,
        })
        : undefined;
    }
    case "registration": {
      if (Object.keys(value).length !== 3) return undefined;
      const registrationOrdinal = ownDataValue(
        value,
        "registrationOrdinal",
      );
      return isU64(registrationOrdinal)
        ? Object.freeze({ kind, registrationOrdinal, frameSha256: digest })
        : undefined;
    }
    case "diagnostic": {
      if (Object.keys(value).length !== 3) return undefined;
      const diagnosticOrdinal = ownDataValue(value, "diagnosticOrdinal");
      return isU64(diagnosticOrdinal)
        ? Object.freeze({ kind, diagnosticOrdinal, frameSha256: digest })
        : undefined;
    }
    default:
      return undefined;
  }
}

function encodeEvidence(
  output: Uint8Array,
  startingOffset: number,
  evidence: DeclarativeV2SettledEvidenceKeyV1,
): number {
  let offset = startingOffset;
  output[offset] = EVIDENCE_KIND_TAG[evidence.kind];
  offset += 1;
  switch (evidence.kind) {
    case "module_summary":
      writeU64Be(output, offset, evidence.moduleOrdinal);
      offset += 8;
      break;
    case "import_edge":
      writeU64Be(output, offset, evidence.moduleOrdinal);
      writeU64Be(output, offset + 8, evidence.edgeOrdinal);
      offset += 16;
      break;
    case "phase_page_manifest":
      output[offset] = PHASE_TAG[evidence.phase];
      writeU64Be(output, offset + 1, evidence.pageOrdinal);
      offset += 9;
      break;
    case "link_node":
      writeU64Be(output, offset, evidence.moduleOrdinal);
      writeU64Be(output, offset + 8, evidence.rowVersion);
      offset += 16;
      break;
    case "frontier_entry":
      writeU64Be(output, offset, evidence.frontierSequence);
      writeU64Be(output, offset + 8, evidence.rowVersion);
      offset += 16;
      break;
    case "registration":
      writeU64Be(output, offset, evidence.registrationOrdinal);
      offset += 8;
      break;
    case "diagnostic":
      writeU64Be(output, offset, evidence.diagnosticOrdinal);
      offset += 8;
      break;
  }
  return copyBytes(output, offset, evidence.frameSha256);
}

function encodedEvidenceByteLength(
  evidence: DeclarativeV2SettledEvidenceKeyV1,
): number {
  const keyBytes = evidence.kind === "phase_page_manifest"
    ? 9
    : evidence.kind === "import_edge" ||
        evidence.kind === "link_node" ||
        evidence.kind === "frontier_entry"
    ? 16
    : 8;
  return 1 + keyBytes + DECLARATIVE_V2_SHA256_BYTES_V1;
}

function compareEvidenceKey(
  left: DeclarativeV2SettledEvidenceKeyV1,
  right: DeclarativeV2SettledEvidenceKeyV1,
): number {
  const leftTag = EVIDENCE_KIND_TAG[left.kind];
  const rightTag = EVIDENCE_KIND_TAG[right.kind];
  if (leftTag !== rightTag) return leftTag - rightTag;
  switch (left.kind) {
    case "module_summary":
      return right.kind === left.kind
        ? compareBigint(left.moduleOrdinal, right.moduleOrdinal)
        : 0;
    case "import_edge":
      return right.kind === left.kind
        ? compareBigint(left.moduleOrdinal, right.moduleOrdinal) ||
          compareBigint(left.edgeOrdinal, right.edgeOrdinal)
        : 0;
    case "phase_page_manifest":
      return right.kind === left.kind
        ? PHASE_TAG[left.phase] - PHASE_TAG[right.phase] ||
          compareBigint(left.pageOrdinal, right.pageOrdinal)
        : 0;
    case "link_node":
      return right.kind === left.kind
        ? compareBigint(left.moduleOrdinal, right.moduleOrdinal) ||
          compareBigint(left.rowVersion, right.rowVersion)
        : 0;
    case "frontier_entry":
      return right.kind === left.kind
        ? compareBigint(left.frontierSequence, right.frontierSequence) ||
          compareBigint(left.rowVersion, right.rowVersion)
        : 0;
    case "registration":
      return right.kind === left.kind
        ? compareBigint(left.registrationOrdinal, right.registrationOrdinal)
        : 0;
    case "diagnostic":
      return right.kind === left.kind
        ? compareBigint(left.diagnosticOrdinal, right.diagnosticOrdinal)
        : 0;
  }
}

function compareBigint(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJsonStringUtf8ByteLength(value: string): number {
  let length = 2;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (
      codeUnit === 0x22 ||
      codeUnit === 0x5c ||
      codeUnit === 0x08 ||
      codeUnit === 0x09 ||
      codeUnit === 0x0a ||
      codeUnit === 0x0c ||
      codeUnit === 0x0d
    ) {
      length += 2;
    } else if (
      codeUnit < 0x20 ||
      codeUnit >= 0xd800 && codeUnit <= 0xdfff &&
        !(
          codeUnit <= 0xdbff &&
          index + 1 < value.length &&
          value.charCodeAt(index + 1) >= 0xdc00 &&
          value.charCodeAt(index + 1) <= 0xdfff
        )
    ) {
      length += 6;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff
    ) {
      length += 4;
      index += 1;
    } else if (codeUnit <= 0x7f) {
      length += 1;
    } else if (codeUnit <= 0x7ff) {
      length += 2;
    } else {
      length += 3;
    }
    if (!Number.isSafeInteger(length)) return Number.MAX_SAFE_INTEGER;
  }
  return length;
}

function checkedAdd(...values: readonly number[]): number | undefined {
  let result = 0;
  for (const value of values) {
    if (
      !isNonNegativeSafeInteger(value) ||
      result > Number.MAX_SAFE_INTEGER - value
    ) {
      return undefined;
    }
    result += value;
  }
  return result;
}

function copyBytes(
  target: Uint8Array,
  offset: number,
  source: Uint8Array,
): number {
  target.set(source, offset);
  return offset + source.byteLength;
}

function writeU32Be(output: Uint8Array, offset: number, value: number): void {
  output[offset] = (value >>> 24) & 0xff;
  output[offset + 1] = (value >>> 16) & 0xff;
  output[offset + 2] = (value >>> 8) & 0xff;
  output[offset + 3] = value & 0xff;
}

function writeU64Be(output: Uint8Array, offset: number, value: bigint): void {
  let remaining = value;
  for (let index = 7; index >= 0; index -= 1) {
    output[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

function isU64(value: unknown): value is bigint {
  return typeof value === "bigint" &&
    value >= 0n &&
    value <= DECLARATIVE_V2_MAX_SIGNED_INT64_V1;
}

function isCommandKind(
  value: unknown,
): value is Exclude<DeclarativeV2CommandKindV1, "finalize"> {
  return value === "source_page" ||
    value === "parse_module" ||
    value === "link_page" ||
    value === "registration_page";
}

function isPhase(value: unknown): value is DeclarativeV2VerifierPhaseV1 {
  return value === "source" ||
    value === "parse" ||
    value === "link" ||
    value === "registration" ||
    value === "verdict";
}

function ownDataValue(
  record: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && descriptor.enumerable &&
      "value" in descriptor
    ? descriptor.value
    : undefined;
}

function derivationError(
  operation: DeclarativeV2VerifierDerivationInputV1Error["operation"],
  reason: DeclarativeV2VerifierDerivationInputV1Error["reason"],
): DeclarativeV2VerifierDerivationInputV1Error {
  return new DeclarativeV2VerifierDerivationInputV1Error({
    operation,
    reason,
  });
}
