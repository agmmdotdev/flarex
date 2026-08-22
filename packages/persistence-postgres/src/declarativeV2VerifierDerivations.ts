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
  captureDeclarativeV2PageEvidenceKeyV1,
  compareDeclarativeV2PageEvidenceKeyV1,
  DeclarativeV2PageEvidenceKeyV1,
} from "flarex-protocol/internal/declarative-v2-verification-evidence-v1";
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
const COMMAND_OUTPUT_DOMAIN_V2 = UTF8_ENCODER.encode(
  "flarex.declarative-v2/command-output-manifest/v2\0",
);
const MINIMUM_SETTLED_EVIDENCE_BYTES = 33;

const COMMAND_KIND_TAG = {
  source_page: 1,
  parse_module: 2,
  link_page: 3,
  registration_page: 4,
} as const satisfies Readonly<Record<
  Exclude<DeclarativeV2CommandKindV1, "finalize">,
  number
>>;
const COMMAND_KIND_TAG_V2 = {
  ...COMMAND_KIND_TAG,
  finalize: 5,
} as const satisfies Readonly<Record<DeclarativeV2CommandKindV1, number>>;

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
  inert_object_reference: 8,
  deployment_analysis_projection: 9,
  deployment_codegen_analysis_projection: 10,
  static_finalization: 11,
} as const;

const REFERENCE_NAMESPACE_TAG = {
  source: 1,
  semantic: 2,
} as const;

const REFERENCE_OBJECT_KIND_TAG = {
  block: 1,
  tree: 2,
  root: 3,
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
  | DeclarativeV2PageEvidenceKeyV1
  | Readonly<{
    readonly kind: "phase_page_manifest";
    readonly phase: DeclarativeV2VerifierPhaseV1;
    readonly pageOrdinal: bigint;
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

export interface DeclarativeV2CommandOutputManifestInputV2 {
  readonly attemptSha256: Uint8Array;
  readonly commandKind: DeclarativeV2CommandKindV1;
  readonly sequence: bigint;
  readonly evidence: readonly DeclarativeV2SettledEvidenceKeyV1[];
}

export interface DeclarativeV2CommandOutputManifestPreimageV2 {
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
    const captured = yield* captureCommandOutputInput(
      input,
      budget.maximumFrameBytes,
    );
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

export function buildDeclarativeV2CommandOutputManifestPreimageV2(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2CommandOutputManifestPreimageV2,
  DeclarativeV2VerifierDerivationInputV1Error
> {
  return Result.gen(function* () {
    const budget = yield* decodeBudget("commandOutputManifest", rawBudget);
    const captured = yield* captureCommandOutputInputV2(
      input,
      budget.maximumFrameBytes,
    );
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
      COMMAND_OUTPUT_DOMAIN_V2.byteLength,
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
    let offset = copyBytes(bytes, 0, COMMAND_OUTPUT_DOMAIN_V2);
    offset = copyBytes(bytes, offset, captured.attemptSha256);
    bytes[offset] = COMMAND_KIND_TAG_V2[captured.commandKind];
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
  maximumFrameBytes: number,
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
  if (evidence.length > U32_MAX) {
    return Result.fail(derivationError(
      "commandOutputManifest",
      "invalidInput",
    ));
  }
  const minimumFrameBytes = checkedAdd(
    COMMAND_OUTPUT_DOMAIN.byteLength,
    DECLARATIVE_V2_SHA256_BYTES_V1,
    1,
    8,
    4,
    evidence.length * MINIMUM_SETTLED_EVIDENCE_BYTES,
  );
  if (minimumFrameBytes === undefined) {
    return Result.fail(derivationError(
      "commandOutputManifest",
      "invalidInput",
    ));
  }
  if (minimumFrameBytes > maximumFrameBytes) {
    return Result.fail(new DeclarativeV2VerifierDerivationInputV1Error({
      operation: "commandOutputManifest",
      reason: "frameBytesExceeded",
      observed: minimumFrameBytes,
      maximum: maximumFrameBytes,
    }));
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

function captureCommandOutputInputV2(
  value: unknown,
  maximumFrameBytes: number,
): Result.Result<
  Readonly<{
    readonly attemptSha256: Uint8Array;
    readonly commandKind: DeclarativeV2CommandKindV1;
    readonly sequence: bigint;
    readonly evidence: readonly DeclarativeV2SettledEvidenceKeyV1[];
  }>,
  DeclarativeV2VerifierDerivationInputV1Error
> {
  if (
    !isNonArrayRecord(value) ||
    !hasExactOwnEnumerableDataKeysV2(value, [
      "attemptSha256",
      "commandKind",
      "sequence",
      "evidence",
    ])
  ) {
    return Result.fail(derivationError(
      "commandOutputManifest",
      "invalidInput",
    ));
  }
  const attemptSha256 = ownDataValueV2(value, "attemptSha256");
  const commandKind = ownDataValueV2(value, "commandKind");
  const sequence = ownDataValueV2(value, "sequence");
  const evidence = ownDataValueV2(value, "evidence");
  const evidenceLength = arrayLengthV2(evidence);
  if (
    !isUint8ArrayWithByteLength(
      attemptSha256,
      DECLARATIVE_V2_SHA256_BYTES_V1,
    ) ||
    !isCommandKindV2(commandKind) ||
    !isU64(sequence) ||
    evidenceLength === undefined ||
    evidenceLength > U32_MAX
  ) {
    return Result.fail(derivationError(
      "commandOutputManifest",
      "invalidInput",
    ));
  }
  const minimumFrameBytes = checkedAdd(
    COMMAND_OUTPUT_DOMAIN_V2.byteLength,
    DECLARATIVE_V2_SHA256_BYTES_V1,
    1,
    8,
    4,
    evidenceLength * MINIMUM_SETTLED_EVIDENCE_BYTES,
  );
  if (minimumFrameBytes === undefined) {
    return Result.fail(derivationError(
      "commandOutputManifest",
      "invalidInput",
    ));
  }
  if (minimumFrameBytes > maximumFrameBytes) {
    return Result.fail(new DeclarativeV2VerifierDerivationInputV1Error({
      operation: "commandOutputManifest",
      reason: "frameBytesExceeded",
      observed: minimumFrameBytes,
      maximum: maximumFrameBytes,
    }));
  }
  if (!hasExactArrayElementsV2(evidence, evidenceLength)) {
    return Result.fail(derivationError(
      "commandOutputManifest",
      "invalidInput",
    ));
  }
  const capturedEvidence: DeclarativeV2SettledEvidenceKeyV1[] = [];
  for (let index = 0; index < evidenceLength; index += 1) {
    const item = ownDataValueV2(evidence, String(index));
    const captured = captureEvidenceV2(item);
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

function captureEvidenceV2(
  value: unknown,
): DeclarativeV2SettledEvidenceKeyV1 | undefined {
  if (!isNonArrayRecord(value)) return undefined;
  const kind = ownDataValueV2(value, "kind");
  if (kind === "phase_page_manifest") {
    if (
      !hasExactOwnEnumerableDataKeysV2(value, [
        "kind",
        "phase",
        "pageOrdinal",
        "frameSha256",
      ])
    ) {
      return undefined;
    }
    const frameSha256 = ownDataValueV2(value, "frameSha256");
    const phase = ownDataValueV2(value, "phase");
    const pageOrdinal = ownDataValueV2(value, "pageOrdinal");
    return isUint8ArrayWithByteLength(
        frameSha256,
        DECLARATIVE_V2_SHA256_BYTES_V1,
      ) &&
        isPhase(phase) &&
        isU64(pageOrdinal)
      ? Object.freeze({
        kind,
        phase,
        pageOrdinal,
        frameSha256: new Uint8Array(frameSha256),
      })
      : undefined;
  }
  try {
    const captured = captureDeclarativeV2PageEvidenceKeyV1(value);
    return Result.isFailure(captured) ||
        !hasExactOwnEnumerableDataKeysV2(
          value,
          Object.keys(captured.success),
        )
      ? undefined
      : captured.success;
  } catch {
    return undefined;
  }
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
  if (kind === "phase_page_manifest") {
    const frameSha256 = ownDataValue(value, "frameSha256");
    const phase = ownDataValue(value, "phase");
    const pageOrdinal = ownDataValue(value, "pageOrdinal");
    return Object.keys(value).length === 4 &&
        isUint8ArrayWithByteLength(
          frameSha256,
          DECLARATIVE_V2_SHA256_BYTES_V1,
        ) &&
        isPhase(phase) &&
        isU64(pageOrdinal)
      ? Object.freeze({
        kind,
        phase,
        pageOrdinal,
        frameSha256: new Uint8Array(frameSha256),
      })
      : undefined;
  }
  const captured = captureDeclarativeV2PageEvidenceKeyV1(value);
  return Result.isFailure(captured) ? undefined : captured.success;
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
    case "inert_object_reference":
      output[offset] = REFERENCE_NAMESPACE_TAG[evidence.namespace];
      output[offset + 1] = REFERENCE_OBJECT_KIND_TAG[evidence.objectKind];
      writeU64Be(output, offset + 2, evidence.firstItemOrdinal);
      writeU64Be(output, offset + 10, evidence.itemCount);
      writeU64Be(output, offset + 18, evidence.bodyByteLength);
      offset += 26;
      return copyBytes(output, offset, evidence.objectSha256);
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
    case "deployment_analysis_projection":
    case "deployment_codegen_analysis_projection":
    case "static_finalization":
      break;
  }
  return copyBytes(output, offset, evidence.frameSha256);
}

function encodedEvidenceByteLength(
  evidence: DeclarativeV2SettledEvidenceKeyV1,
): number {
  const keyBytes = evidence.kind === "phase_page_manifest"
    ? 9
    : evidence.kind === "inert_object_reference"
    ? 26
    : evidence.kind === "import_edge" ||
        evidence.kind === "link_node" ||
        evidence.kind === "frontier_entry"
    ? 16
    : evidence.kind === "deployment_analysis_projection" ||
        evidence.kind === "deployment_codegen_analysis_projection" ||
        evidence.kind === "static_finalization"
    ? 0
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
  if (left.kind === "phase_page_manifest") {
    return right.kind === left.kind
      ? PHASE_TAG[left.phase] - PHASE_TAG[right.phase] ||
        compareBigint(left.pageOrdinal, right.pageOrdinal)
      : 0;
  }
  return right.kind === "phase_page_manifest"
    ? 0
    : compareDeclarativeV2PageEvidenceKeyV1(left, right);
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

function isCommandKindV2(
  value: unknown,
): value is DeclarativeV2CommandKindV1 {
  return isCommandKind(value) || value === "finalize";
}

function isPhase(value: unknown): value is DeclarativeV2VerifierPhaseV1 {
  return value === "source" ||
    value === "parse" ||
    value === "link" ||
    value === "registration" ||
    value === "verdict";
}

function ownDataValueV2<T extends object>(
  record: T,
  key: PropertyKey,
): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor !== undefined &&
        descriptor.enumerable &&
        "value" in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function hasExactOwnEnumerableDataKeysV2<T extends object>(
  record: T,
  expected: readonly string[],
): boolean {
  try {
    const keys = Reflect.ownKeys(record);
    return keys.length === expected.length &&
      keys.every((key) =>
        typeof key === "string" &&
        expected.includes(key) &&
        ownDataValueV2(record, key) !== undefined
      );
  } catch {
    return false;
  }
}

function arrayLengthV2(value: unknown): number | undefined {
  if (!Array.isArray(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "length");
    return descriptor !== undefined &&
        "value" in descriptor &&
        isNonNegativeSafeInteger(descriptor.value)
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function hasExactArrayElementsV2(
  value: unknown,
  length: number,
): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1) return false;
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(
        value,
        String(index),
      );
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return false;
      }
    }
    return keys.some((key) => key === "length");
  } catch {
    return false;
  }
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
