import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Result } from "effect";

import {
  DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
  DECLARATIVE_V2_SHA256_BYTES_V1,
  type DeclarativeV2CommandKindV1,
  type DeclarativeV2VerifierPhaseV1,
} from "./declarative-v2-physical-v1";

const UTF8_ENCODER = new TextEncoder();
const PAGE_EVIDENCE_ROOT_DOMAIN = UTF8_ENCODER.encode(
  "flarex.declarative-v2/page-evidence-root/v1\0",
);
const PAGE_EVIDENCE_ROOT_VERSION = 1;
const U32_MAX = 0xffff_ffff;
const MINIMUM_EVIDENCE_BYTES = 33;

const COMMAND_KIND_TAG = {
  source_page: 1,
  parse_module: 2,
  link_page: 3,
  registration_page: 4,
  finalize: 5,
} as const satisfies Readonly<Record<DeclarativeV2CommandKindV1, number>>;

const COMMAND_KIND_FROM_TAG = [
  undefined,
  "source_page",
  "parse_module",
  "link_page",
  "registration_page",
  "finalize",
] as const;

const PHASE_TAG = {
  source: 1,
  parse: 2,
  link: 3,
  registration: 4,
  verdict: 5,
} as const satisfies Readonly<Record<DeclarativeV2VerifierPhaseV1, number>>;

const PHASE_FROM_TAG = [
  undefined,
  "source",
  "parse",
  "link",
  "registration",
  "verdict",
] as const;

const DISPOSITION_TAG = {
  continuation: 1,
  completion: 2,
} as const;
const DISPOSITION_FROM_TAG = [
  undefined,
  "continuation",
  "completion",
] as const;

const REFERENCE_NAMESPACE_TAG = {
  source: 1,
  semantic: 2,
} as const;
const REFERENCE_NAMESPACE_FROM_TAG = [
  undefined,
  "source",
  "semantic",
] as const;

const REFERENCE_OBJECT_KIND_TAG = {
  block: 1,
  tree: 2,
  root: 3,
} as const;
const REFERENCE_OBJECT_KIND_FROM_TAG = [
  undefined,
  "block",
  "tree",
  "root",
] as const;

const EVIDENCE_KIND_TAG = {
  inert_object_reference: 1,
  module_summary: 2,
  import_edge: 3,
  link_node: 4,
  frontier_entry: 5,
  registration: 6,
  diagnostic: 7,
  deployment_analysis_projection: 8,
  deployment_codegen_analysis_projection: 9,
  static_finalization: 10,
} as const;

export type DeclarativeV2PageDispositionV1 =
  | "continuation"
  | "completion";

export type DeclarativeV2InertObjectReferenceNamespaceV1 =
  | "source"
  | "semantic";

export type DeclarativeV2InertObjectReferenceKindV1 =
  | "block"
  | "tree"
  | "root";

/**
 * A canonical commitment to caller-captured object coordinates. It proves only
 * integrity of this sequence. It does not prove that an object exists, is
 * finalized, was authenticated, or is authorized for reading.
 */
export interface DeclarativeV2InertObjectReferenceEvidenceV1 {
  readonly kind: "inert_object_reference";
  readonly namespace: DeclarativeV2InertObjectReferenceNamespaceV1;
  readonly objectKind: DeclarativeV2InertObjectReferenceKindV1;
  readonly firstItemOrdinal: bigint;
  readonly itemCount: bigint;
  readonly bodyByteLength: bigint;
  readonly objectSha256: Uint8Array;
}

export type DeclarativeV2PageEvidenceKeyV1 =
  | Readonly<DeclarativeV2InertObjectReferenceEvidenceV1>
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
  }>
  | Readonly<{
    readonly kind: "deployment_analysis_projection";
    readonly frameSha256: Uint8Array;
  }>
  | Readonly<{
    readonly kind: "deployment_codegen_analysis_projection";
    readonly frameSha256: Uint8Array;
  }>
  | Readonly<{
    readonly kind: "static_finalization";
    readonly frameSha256: Uint8Array;
  }>;

export interface DeclarativeV2PageEvidenceRootFrameV1 {
  readonly attemptSha256: Uint8Array;
  readonly commandKind: DeclarativeV2CommandKindV1;
  readonly sequence: bigint;
  readonly phase: DeclarativeV2VerifierPhaseV1;
  readonly disposition: DeclarativeV2PageDispositionV1;
  readonly pageOrdinal: bigint;
  readonly firstItemOrdinal: bigint;
  readonly itemCount: bigint;
  readonly previousPageSha256: Uint8Array | null;
  readonly evidence: readonly DeclarativeV2PageEvidenceKeyV1[];
}

export interface DeclarativeV2PageEvidenceRootBudgetV1 {
  readonly maximumFrameBytes: number;
}

export interface DeclarativeV2PageEvidenceRootUsageV1 {
  readonly frameBytes: number;
}

export interface DeclarativeV2EncodedPageEvidenceRootV1 {
  readonly frame: DeclarativeV2PageEvidenceRootFrameV1;
  readonly canonicalBytes: Uint8Array;
  readonly usage: DeclarativeV2PageEvidenceRootUsageV1;
}

export class DeclarativeV2PageEvidenceRootV1Error extends Data.TaggedError(
  "DeclarativeV2PageEvidenceRootV1Error",
)<{
  readonly operation: "encode" | "decode";
  readonly reason:
    | "invalidBudget"
    | "invalidInput"
    | "frameBytesExceeded"
    | "invalidStoredBytes"
    | "nonCanonicalBytes"
    | "outOfOrder";
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export function encodeDeclarativeV2PageEvidenceRootV1(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2EncodedPageEvidenceRootV1,
  DeclarativeV2PageEvidenceRootV1Error
> {
  return Result.gen(function* () {
    const budget = yield* decodeBudget("encode", rawBudget);
    const frame = yield* captureFrame(
      "encode",
      input,
      budget.maximumFrameBytes,
    );
    const byteLength = encodedFrameByteLength(frame);
    if (byteLength === undefined) {
      return yield* Result.fail(error("encode", "invalidInput"));
    }
    if (byteLength > budget.maximumFrameBytes) {
      return yield* Result.fail(new DeclarativeV2PageEvidenceRootV1Error({
        operation: "encode",
        reason: "frameBytesExceeded",
        observed: byteLength,
        maximum: budget.maximumFrameBytes,
      }));
    }
    const bytes = new Uint8Array(byteLength);
    let offset = copyBytes(bytes, 0, PAGE_EVIDENCE_ROOT_DOMAIN);
    writeU32Be(bytes, offset, PAGE_EVIDENCE_ROOT_VERSION);
    offset += 4;
    offset = copyBytes(bytes, offset, frame.attemptSha256);
    bytes[offset] = COMMAND_KIND_TAG[frame.commandKind];
    offset += 1;
    writeU64Be(bytes, offset, frame.sequence);
    offset += 8;
    bytes[offset] = PHASE_TAG[frame.phase];
    bytes[offset + 1] = DISPOSITION_TAG[frame.disposition];
    offset += 2;
    writeU64Be(bytes, offset, frame.pageOrdinal);
    writeU64Be(bytes, offset + 8, frame.firstItemOrdinal);
    writeU64Be(bytes, offset + 16, frame.itemCount);
    offset += 24;
    if (frame.previousPageSha256 === null) {
      bytes[offset] = 0;
      offset += 1;
    } else {
      bytes[offset] = 1;
      offset += 1;
      offset = copyBytes(bytes, offset, frame.previousPageSha256);
    }
    writeU32Be(bytes, offset, frame.evidence.length);
    offset += 4;
    for (const evidence of frame.evidence) {
      offset = encodeEvidence(bytes, offset, evidence);
    }
    if (offset !== bytes.byteLength) {
      throw new Error("Declarative V2 page-evidence encoding invariant failed.");
    }
    return Object.freeze({
      frame,
      canonicalBytes: bytes,
      usage: Object.freeze({ frameBytes: bytes.byteLength }),
    });
  });
}

export function decodeDeclarativeV2PageEvidenceRootV1(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2EncodedPageEvidenceRootV1,
  DeclarativeV2PageEvidenceRootV1Error
> {
  return Result.gen(function* () {
    const budget = yield* decodeBudget("decode", rawBudget);
    if (!isUint8Array(input)) {
      return yield* Result.fail(error("decode", "invalidInput"));
    }
    const visibleLength = input.byteLength;
    if (visibleLength < PAGE_EVIDENCE_ROOT_DOMAIN.byteLength + 76) {
      return yield* Result.fail(error("decode", "invalidStoredBytes"));
    }
    if (visibleLength > budget.maximumFrameBytes) {
      return yield* Result.fail(new DeclarativeV2PageEvidenceRootV1Error({
        operation: "decode",
        reason: "frameBytesExceeded",
        observed: visibleLength,
        maximum: budget.maximumFrameBytes,
      }));
    }
    const bytes = new Uint8Array(input);
    const parsed = yield* parseFrame(bytes);
    const encoded = yield* encodeDeclarativeV2PageEvidenceRootV1(parsed, {
      maximumFrameBytes: visibleLength,
    }).pipe(Result.mapError(() => error("decode", "invalidStoredBytes")));
    if (!bytesEqualFullScan(bytes, encoded.canonicalBytes)) {
      return yield* Result.fail(error("decode", "nonCanonicalBytes"));
    }
    return Object.freeze({
      frame: encoded.frame,
      canonicalBytes: new Uint8Array(encoded.canonicalBytes),
      usage: Object.freeze({ frameBytes: visibleLength }),
    });
  });
}

export function compareDeclarativeV2PageEvidenceKeyV1(
  left: DeclarativeV2PageEvidenceKeyV1,
  right: DeclarativeV2PageEvidenceKeyV1,
): number {
  const kindOrder = EVIDENCE_KIND_TAG[left.kind] -
    EVIDENCE_KIND_TAG[right.kind];
  if (kindOrder !== 0 || left.kind !== right.kind) return kindOrder;
  switch (left.kind) {
    case "inert_object_reference":
      return right.kind === left.kind
        ? REFERENCE_NAMESPACE_TAG[left.namespace] -
            REFERENCE_NAMESPACE_TAG[right.namespace] ||
          REFERENCE_OBJECT_KIND_TAG[left.objectKind] -
            REFERENCE_OBJECT_KIND_TAG[right.objectKind] ||
          compareBigint(left.firstItemOrdinal, right.firstItemOrdinal) ||
          compareBigint(left.itemCount, right.itemCount) ||
          compareBigint(left.bodyByteLength, right.bodyByteLength) ||
          compareBytes(left.objectSha256, right.objectSha256)
        : 0;
    case "module_summary":
      return right.kind === left.kind
        ? compareBigint(left.moduleOrdinal, right.moduleOrdinal)
        : 0;
    case "import_edge":
      return right.kind === left.kind
        ? compareBigint(left.moduleOrdinal, right.moduleOrdinal) ||
          compareBigint(left.edgeOrdinal, right.edgeOrdinal)
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
    case "deployment_analysis_projection":
    case "deployment_codegen_analysis_projection":
    case "static_finalization":
      return right.kind === left.kind
        ? compareBytes(left.frameSha256, right.frameSha256)
        : 0;
  }
}

export function captureDeclarativeV2PageEvidenceKeyV1(
  input: unknown,
): Result.Result<
  DeclarativeV2PageEvidenceKeyV1,
  DeclarativeV2PageEvidenceRootV1Error
> {
  const captured = captureEvidence(input);
  return captured === undefined
    ? Result.fail(error("encode", "invalidInput"))
    : Result.succeed(captured);
}

function captureFrame(
  operation: "encode" | "decode",
  value: unknown,
  maximumFrameBytes?: number,
): Result.Result<
  DeclarativeV2PageEvidenceRootFrameV1,
  DeclarativeV2PageEvidenceRootV1Error
> {
  if (
    !isNonArrayRecord(value) ||
    Object.keys(value).length !== 10 ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return Result.fail(error(operation, "invalidInput"));
  }
  const attemptSha256 = ownDataValue(value, "attemptSha256");
  const commandKind = ownDataValue(value, "commandKind");
  const sequence = ownDataValue(value, "sequence");
  const phase = ownDataValue(value, "phase");
  const disposition = ownDataValue(value, "disposition");
  const pageOrdinal = ownDataValue(value, "pageOrdinal");
  const firstItemOrdinal = ownDataValue(value, "firstItemOrdinal");
  const itemCount = ownDataValue(value, "itemCount");
  const previousPageSha256 = ownDataValue(value, "previousPageSha256");
  const evidence = ownDataValue(value, "evidence");
  if (
    !isUint8ArrayWithByteLength(
      attemptSha256,
      DECLARATIVE_V2_SHA256_BYTES_V1,
    ) ||
    !isCommandKind(commandKind) ||
    !isU64(sequence) ||
    !isPhase(phase) ||
    !isDisposition(disposition) ||
    !isU64(pageOrdinal) ||
    !isU64(firstItemOrdinal) ||
    !isPositiveU64(itemCount) ||
    !isNullableDigest(previousPageSha256) ||
    (pageOrdinal === 0n) !== (previousPageSha256 === null) ||
    !Array.isArray(evidence) ||
    evidence.length > U32_MAX
  ) {
    return Result.fail(error(operation, "invalidInput"));
  }
  if (maximumFrameBytes !== undefined) {
    const minimumFrameBytes = checkedAdd(
      PAGE_EVIDENCE_ROOT_DOMAIN.byteLength,
      4,
      32,
      1,
      8,
      1,
      1,
      8,
      8,
      8,
      1,
      previousPageSha256 === null ? 0 : 32,
      4,
      evidence.length * MINIMUM_EVIDENCE_BYTES,
    );
    if (minimumFrameBytes === undefined) {
      return Result.fail(error(operation, "invalidInput"));
    }
    if (minimumFrameBytes > maximumFrameBytes) {
      return Result.fail(new DeclarativeV2PageEvidenceRootV1Error({
        operation,
        reason: "frameBytesExceeded",
        observed: minimumFrameBytes,
        maximum: maximumFrameBytes,
      }));
    }
  }
  const capturedEvidence: DeclarativeV2PageEvidenceKeyV1[] = [];
  for (const item of evidence) {
    const captured = captureEvidence(item);
    if (captured === undefined) {
      return Result.fail(error(operation, "invalidInput"));
    }
    if (
      capturedEvidence.length > 0 &&
      compareDeclarativeV2PageEvidenceKeyV1(
          capturedEvidence[capturedEvidence.length - 1]!,
          captured,
        ) >= 0
    ) {
      return Result.fail(error(operation, "outOfOrder"));
    }
    capturedEvidence.push(captured);
  }
  return Result.succeed(Object.freeze({
    attemptSha256: new Uint8Array(attemptSha256),
    commandKind,
    sequence,
    phase,
    disposition,
    pageOrdinal,
    firstItemOrdinal,
    itemCount,
    previousPageSha256: previousPageSha256 === null
      ? null
      : new Uint8Array(previousPageSha256),
    evidence: Object.freeze(capturedEvidence),
  }));
}

function captureEvidence(
  value: unknown,
): DeclarativeV2PageEvidenceKeyV1 | undefined {
  if (
    !isNonArrayRecord(value) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return undefined;
  }
  const kind = ownDataValue(value, "kind");
  if (kind === "inert_object_reference") {
    if (Object.keys(value).length !== 7) return undefined;
    const namespace = ownDataValue(value, "namespace");
    const objectKind = ownDataValue(value, "objectKind");
    const firstItemOrdinal = ownDataValue(value, "firstItemOrdinal");
    const itemCount = ownDataValue(value, "itemCount");
    const bodyByteLength = ownDataValue(value, "bodyByteLength");
    const objectSha256 = ownDataValue(value, "objectSha256");
    return isReferenceNamespace(namespace) &&
        isReferenceObjectKind(objectKind) &&
        isU64(firstItemOrdinal) &&
        isPositiveU64(itemCount) &&
        isPositiveU64(bodyByteLength) &&
        isUint8ArrayWithByteLength(
          objectSha256,
          DECLARATIVE_V2_SHA256_BYTES_V1,
        )
      ? Object.freeze({
        kind,
        namespace,
        objectKind,
        firstItemOrdinal,
        itemCount,
        bodyByteLength,
        objectSha256: new Uint8Array(objectSha256),
      })
      : undefined;
  }
  const frameSha256 = ownDataValue(value, "frameSha256");
  if (
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
        ? Object.freeze({ kind, moduleOrdinal, edgeOrdinal, frameSha256: digest })
        : undefined;
    }
    case "link_node": {
      if (Object.keys(value).length !== 4) return undefined;
      const moduleOrdinal = ownDataValue(value, "moduleOrdinal");
      const rowVersion = ownDataValue(value, "rowVersion");
      return isU64(moduleOrdinal) && isU64(rowVersion)
        ? Object.freeze({ kind, moduleOrdinal, rowVersion, frameSha256: digest })
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
      const registrationOrdinal = ownDataValue(value, "registrationOrdinal");
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
    case "deployment_analysis_projection":
    case "deployment_codegen_analysis_projection":
    case "static_finalization":
      return Object.keys(value).length === 2
        ? Object.freeze({ kind, frameSha256: digest })
        : undefined;
    default:
      return undefined;
  }
}

function parseFrame(
  bytes: Uint8Array,
): Result.Result<
  DeclarativeV2PageEvidenceRootFrameV1,
  DeclarativeV2PageEvidenceRootV1Error
> {
  const minimumLength = PAGE_EVIDENCE_ROOT_DOMAIN.byteLength + 76;
  if (
    bytes.byteLength < minimumLength ||
    !bytesEqualAt(bytes, 0, PAGE_EVIDENCE_ROOT_DOMAIN)
  ) {
    return Result.fail(error("decode", "invalidStoredBytes"));
  }
  let offset = PAGE_EVIDENCE_ROOT_DOMAIN.byteLength;
  const version = readU32Be(bytes, offset);
  offset += 4;
  if (version !== PAGE_EVIDENCE_ROOT_VERSION) {
    return Result.fail(error("decode", "invalidStoredBytes"));
  }
  const attemptSha256 = readBytes(bytes, offset, 32);
  offset += 32;
  const commandKind = COMMAND_KIND_FROM_TAG[bytes[offset] ?? 0];
  offset += 1;
  const sequence = readU64Be(bytes, offset);
  offset += 8;
  const phase = PHASE_FROM_TAG[bytes[offset] ?? 0];
  const disposition = DISPOSITION_FROM_TAG[bytes[offset + 1] ?? 0];
  offset += 2;
  const pageOrdinal = readU64Be(bytes, offset);
  const firstItemOrdinal = readU64Be(bytes, offset + 8);
  const itemCount = readU64Be(bytes, offset + 16);
  offset += 24;
  const previousTag = bytes[offset];
  offset += 1;
  let previousPageSha256: Uint8Array | null;
  if (previousTag === 0) {
    previousPageSha256 = null;
  } else if (previousTag === 1) {
    const previous = readBytes(bytes, offset, 32);
    if (previous === undefined) {
      return Result.fail(error("decode", "invalidStoredBytes"));
    }
    previousPageSha256 = previous;
    offset += 32;
  } else {
    return Result.fail(error("decode", "invalidStoredBytes"));
  }
  const evidenceCount = readU32Be(bytes, offset);
  offset += 4;
  if (
    attemptSha256 === undefined ||
    commandKind === undefined ||
    phase === undefined ||
    disposition === undefined ||
    sequence === undefined ||
    pageOrdinal === undefined ||
    firstItemOrdinal === undefined ||
    itemCount === undefined ||
    evidenceCount === undefined
  ) {
    return Result.fail(error("decode", "invalidStoredBytes"));
  }
  const evidence: DeclarativeV2PageEvidenceKeyV1[] = [];
  for (let index = 0; index < evidenceCount; index += 1) {
    const parsed = parseEvidence(bytes, offset);
    if (parsed === undefined) {
      return Result.fail(error("decode", "invalidStoredBytes"));
    }
    evidence.push(parsed.evidence);
    offset = parsed.nextOffset;
  }
  if (offset !== bytes.byteLength) {
    return Result.fail(error("decode", "invalidStoredBytes"));
  }
  return captureFrame("decode", {
    attemptSha256,
    commandKind,
    sequence,
    phase,
    disposition,
    pageOrdinal,
    firstItemOrdinal,
    itemCount,
    previousPageSha256,
    evidence,
  });
}

function parseEvidence(
  bytes: Uint8Array,
  startingOffset: number,
): Readonly<{
  readonly evidence: DeclarativeV2PageEvidenceKeyV1;
  readonly nextOffset: number;
}> | undefined {
  const tag = bytes[startingOffset];
  let offset = startingOffset + 1;
  if (tag === EVIDENCE_KIND_TAG.inert_object_reference) {
    const namespace = REFERENCE_NAMESPACE_FROM_TAG[bytes[offset] ?? 0];
    const objectKind = REFERENCE_OBJECT_KIND_FROM_TAG[bytes[offset + 1] ?? 0];
    const firstItemOrdinal = readU64Be(bytes, offset + 2);
    const itemCount = readU64Be(bytes, offset + 10);
    const bodyByteLength = readU64Be(bytes, offset + 18);
    const objectSha256 = readBytes(bytes, offset + 26, 32);
    if (
      namespace === undefined ||
      objectKind === undefined ||
      firstItemOrdinal === undefined ||
      itemCount === undefined ||
      bodyByteLength === undefined ||
      objectSha256 === undefined
    ) {
      return undefined;
    }
    return Object.freeze({
      evidence: Object.freeze({
        kind: "inert_object_reference" as const,
        namespace,
        objectKind,
        firstItemOrdinal,
        itemCount,
        bodyByteLength,
        objectSha256,
      }),
      nextOffset: offset + 58,
    });
  }
  const kind = evidenceKindFromTag(tag);
  if (kind === undefined) return undefined;
  if (
    kind === "deployment_analysis_projection" ||
    kind === "deployment_codegen_analysis_projection" ||
    kind === "static_finalization"
  ) {
    const frameSha256 = readBytes(bytes, offset, 32);
    return frameSha256 === undefined
      ? undefined
      : Object.freeze({
        evidence: Object.freeze({ kind, frameSha256 }),
        nextOffset: offset + 32,
      });
  }
  const first = readU64Be(bytes, offset);
  if (first === undefined) return undefined;
  offset += 8;
  const hasSecond = kind === "import_edge" ||
    kind === "link_node" ||
    kind === "frontier_entry";
  const second = hasSecond ? readU64Be(bytes, offset) : undefined;
  if (hasSecond && second === undefined) return undefined;
  if (hasSecond) offset += 8;
  const frameSha256 = readBytes(bytes, offset, 32);
  if (frameSha256 === undefined) return undefined;
  const evidence = kind === "module_summary"
    ? { kind, moduleOrdinal: first, frameSha256 }
    : kind === "import_edge"
    ? { kind, moduleOrdinal: first, edgeOrdinal: second!, frameSha256 }
    : kind === "link_node"
    ? { kind, moduleOrdinal: first, rowVersion: second!, frameSha256 }
    : kind === "frontier_entry"
    ? { kind, frontierSequence: first, rowVersion: second!, frameSha256 }
    : kind === "registration"
    ? { kind, registrationOrdinal: first, frameSha256 }
    : { kind, diagnosticOrdinal: first, frameSha256 };
  return Object.freeze({
    evidence: Object.freeze(evidence) as DeclarativeV2PageEvidenceKeyV1,
    nextOffset: offset + 32,
  });
}

function encodeEvidence(
  output: Uint8Array,
  startingOffset: number,
  evidence: DeclarativeV2PageEvidenceKeyV1,
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

function encodedFrameByteLength(
  frame: DeclarativeV2PageEvidenceRootFrameV1,
): number | undefined {
  let byteLength = checkedAdd(
    PAGE_EVIDENCE_ROOT_DOMAIN.byteLength,
    4,
    32,
    1,
    8,
    1,
    1,
    8,
    8,
    8,
    1,
    frame.previousPageSha256 === null ? 0 : 32,
    4,
  );
  for (const evidence of frame.evidence) {
    byteLength = byteLength === undefined
      ? undefined
      : checkedAdd(byteLength, encodedEvidenceByteLength(evidence));
  }
  return byteLength;
}

function encodedEvidenceByteLength(
  evidence: DeclarativeV2PageEvidenceKeyV1,
): number {
  if (evidence.kind === "inert_object_reference") return 59;
  if (
    evidence.kind === "deployment_analysis_projection" ||
    evidence.kind === "deployment_codegen_analysis_projection" ||
    evidence.kind === "static_finalization"
  ) {
    return 33;
  }
  return evidence.kind === "import_edge" ||
      evidence.kind === "link_node" ||
      evidence.kind === "frontier_entry"
    ? 49
    : 41;
}

function decodeBudget(
  operation: "encode" | "decode",
  value: unknown,
): Result.Result<
  Readonly<DeclarativeV2PageEvidenceRootBudgetV1>,
  DeclarativeV2PageEvidenceRootV1Error
> {
  if (
    !isNonArrayRecord(value) ||
    Object.keys(value).length !== 1 ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return Result.fail(error(operation, "invalidBudget"));
  }
  const maximumFrameBytes = ownDataValue(value, "maximumFrameBytes");
  return isNonNegativeSafeInteger(maximumFrameBytes)
    ? Result.succeed(Object.freeze({ maximumFrameBytes }))
    : Result.fail(error(operation, "invalidBudget"));
}

function evidenceKindFromTag(
  tag: number | undefined,
): Exclude<
  DeclarativeV2PageEvidenceKeyV1["kind"],
  "inert_object_reference"
> | undefined {
  switch (tag) {
    case 2:
      return "module_summary";
    case 3:
      return "import_edge";
    case 4:
      return "link_node";
    case 5:
      return "frontier_entry";
    case 6:
      return "registration";
    case 7:
      return "diagnostic";
    case 8:
      return "deployment_analysis_projection";
    case 9:
      return "deployment_codegen_analysis_projection";
    case 10:
      return "static_finalization";
    default:
      return undefined;
  }
}

function isCommandKind(value: unknown): value is DeclarativeV2CommandKindV1 {
  return value === "source_page" ||
    value === "parse_module" ||
    value === "link_page" ||
    value === "registration_page" ||
    value === "finalize";
}

function isPhase(value: unknown): value is DeclarativeV2VerifierPhaseV1 {
  return value === "source" ||
    value === "parse" ||
    value === "link" ||
    value === "registration" ||
    value === "verdict";
}

function isDisposition(
  value: unknown,
): value is DeclarativeV2PageDispositionV1 {
  return value === "continuation" || value === "completion";
}

function isReferenceNamespace(
  value: unknown,
): value is DeclarativeV2InertObjectReferenceNamespaceV1 {
  return value === "source" || value === "semantic";
}

function isReferenceObjectKind(
  value: unknown,
): value is DeclarativeV2InertObjectReferenceKindV1 {
  return value === "block" || value === "tree" || value === "root";
}

function isNullableDigest(value: unknown): value is Uint8Array | null {
  return value === null ||
    isUint8ArrayWithByteLength(value, DECLARATIVE_V2_SHA256_BYTES_V1);
}

function isU64(value: unknown): value is bigint {
  return typeof value === "bigint" &&
    value >= 0n &&
    value <= DECLARATIVE_V2_MAX_SIGNED_INT64_V1;
}

function isPositiveU64(value: unknown): value is bigint {
  return isU64(value) && value > 0n;
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

function compareBigint(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < left.byteLength; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return left.byteLength - right.byteLength;
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

function readU32Be(bytes: Uint8Array, offset: number): number | undefined {
  if (offset > bytes.byteLength - 4) return undefined;
  return (
    (bytes[offset]! * 0x100_0000) +
    ((bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!)
  ) >>> 0;
}

function readU64Be(bytes: Uint8Array, offset: number): bigint | undefined {
  if (offset > bytes.byteLength - 8) return undefined;
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(bytes[offset + index]!);
  }
  return value <= DECLARATIVE_V2_MAX_SIGNED_INT64_V1 ? value : undefined;
}

function readBytes(
  bytes: Uint8Array,
  offset: number,
  length: number,
): Uint8Array | undefined {
  if (offset > bytes.byteLength - length) return undefined;
  return bytes.slice(offset, offset + length);
}

function bytesEqualAt(
  bytes: Uint8Array,
  offset: number,
  expected: Uint8Array,
): boolean {
  if (offset > bytes.byteLength - expected.byteLength) return false;
  for (let index = 0; index < expected.byteLength; index += 1) {
    if (bytes[offset + index] !== expected[index]) return false;
  }
  return true;
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

function error(
  operation: "encode" | "decode",
  reason: DeclarativeV2PageEvidenceRootV1Error["reason"],
): DeclarativeV2PageEvidenceRootV1Error {
  return new DeclarativeV2PageEvidenceRootV1Error({ operation, reason });
}
