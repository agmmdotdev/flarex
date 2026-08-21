import {
  bytesEqualFullScan,
  copyBytes,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import { Data, Result } from "effect";
import { hasOnlyPairedSurrogates, utf8ByteLength } from "./canonical-utf8";
import { isCanonicalIsoTimestamp } from "./iso-timestamp";

export const DECLARATIVE_V2_SEMANTIC_ARTIFACT_CODEC_VERSION_V1 = 1 as const;
export const DECLARATIVE_V2_SEMANTIC_ARTIFACT_SHA256_BYTES_V1 = 32 as const;
export const DECLARATIVE_V2_SEMANTIC_ARTIFACT_BLOCK_FRAME_OVERHEAD_BYTES_V1 =
  85 as const;
export const DECLARATIVE_V2_SEMANTIC_ARTIFACT_MAX_SIGNED_INT64_V1 =
  9_223_372_036_854_775_807n;

const UTF8_ENCODER = new TextEncoder();
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const U32_MAX = 0xffff_ffff;
const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(
  Uint8Array.prototype,
);
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;

const DOMAINS = Object.freeze({
  block: "flarex.declarative-v2/semantic-artifact-block/v1\0",
  tree: "flarex.declarative-v2/semantic-artifact-tree/v1\0",
  root: "flarex.declarative-v2/semantic-artifact-root/v1\0",
  attempt: "flarex.declarative-v2/semantic-artifact-attempt/v1\0",
  selector: "flarex.declarative-v2/semantic-artifact-selector/v1\0",
});

export interface DeclarativeV2SemanticArtifactFrameBudgetV1 {
  readonly maximumFrameBytes: number;
  readonly maximumCanonicalBytes: number;
}

export interface DeclarativeV2SemanticArtifactFrameUsageV1 {
  readonly frameBytes: number;
  readonly canonicalBytes: number;
}

export interface DeclarativeV2SemanticArtifactBlockFrameV1 {
  readonly kind: "semantic_block";
  readonly blockOrdinal: bigint;
  readonly firstByteOffset: bigint;
  readonly bodyBytes: Uint8Array;
  readonly lineFeedCount: bigint;
}

export interface DeclarativeV2SemanticArtifactTreeChildV1 {
  readonly firstBlockOrdinal: bigint;
  readonly blockCount: bigint;
  readonly firstByteOffset: bigint;
  readonly byteLength: bigint;
  readonly lineFeedCount: bigint;
  readonly sha256: Uint8Array;
}

export interface DeclarativeV2SemanticArtifactTreeFrameV1 {
  readonly kind: "semantic_tree";
  readonly children: readonly [
    DeclarativeV2SemanticArtifactTreeChildV1,
    DeclarativeV2SemanticArtifactTreeChildV1,
  ];
}

export interface DeclarativeV2SemanticArtifactRootFrameV1 {
  readonly kind: "semantic_root";
  readonly sourceArtifactCodecVersion: number;
  readonly sourceRootSha256: Uint8Array;
  readonly semanticModelIdentity: string;
  readonly semanticCodecIdentity: string;
  readonly semanticPolicyIdentity: string;
  readonly coreLanguageIdentity: string;
  readonly abiIdentity: string;
  readonly grammarIdentity: string;
  readonly unicodeIdentity: string;
  readonly parserTableIdentity: string;
  readonly trustedToolingIdentity: string;
  readonly ingressProtocolIdentity: string;
  readonly ingressConfigurationIdentity: string;
  readonly blockCount: bigint;
  readonly streamByteLength: bigint;
  readonly recordCount: bigint;
  readonly treeRootSha256: Uint8Array;
}

export interface DeclarativeV2SemanticArtifactAttemptFrameV1 {
  readonly kind: "semantic_attempt";
  readonly projectId: string;
  readonly deploymentId: string;
  readonly deploymentCreatedAt: string;
  readonly semanticUploadId: string;
  readonly sourceArtifactCodecVersion: number;
  readonly sourceUploadId: string;
  readonly sourceGeneration: bigint;
  readonly sourceMutationFence: bigint;
  readonly sourceRootSha256: Uint8Array;
  readonly sourceSelectorSha256: Uint8Array;
  readonly semanticArtifactCodecVersion: number;
  readonly semanticGeneration: bigint;
  readonly semanticMutationFence: bigint;
  readonly semanticModelIdentity: string;
  readonly semanticCodecIdentity: string;
  readonly semanticPolicyIdentity: string;
  readonly semanticIngressProtocolIdentity: string;
  readonly semanticIngressConfigurationIdentity: string;
  readonly ceilingsSha256: Uint8Array;
}

export interface DeclarativeV2SemanticArtifactSelectorFrameV1 {
  readonly kind: "semantic_selector";
  readonly semanticArtifactCodecVersion: number;
  readonly attemptIdentitySha256: Uint8Array;
  readonly semanticRootSha256: Uint8Array;
}

export type DeclarativeV2SemanticArtifactFrameV1 =
  | DeclarativeV2SemanticArtifactBlockFrameV1
  | DeclarativeV2SemanticArtifactTreeFrameV1
  | DeclarativeV2SemanticArtifactRootFrameV1
  | DeclarativeV2SemanticArtifactAttemptFrameV1
  | DeclarativeV2SemanticArtifactSelectorFrameV1;

export class DeclarativeV2SemanticArtifactCodecV1Error extends Data.TaggedError(
  "DeclarativeV2SemanticArtifactCodecV1Error",
)<{
  readonly reason:
    | "invalidBudget"
    | "invalidInput"
    | "frameBytesExceeded"
    | "canonicalBytesExceeded"
    | "malformedStoredBytes"
    | "nonCanonicalStoredBytes";
  readonly field?: string;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export interface DeclarativeV2SemanticArtifactEncodedV1<T> {
  readonly value: T;
  readonly canonicalBytes: Uint8Array;
  readonly usage: DeclarativeV2SemanticArtifactFrameUsageV1;
}

export function measureDeclarativeV2SemanticArtifactRootOrSelectorFrameV1(
  input:
    | DeclarativeV2SemanticArtifactRootFrameV1
    | DeclarativeV2SemanticArtifactSelectorFrameV1,
  budget: unknown,
): Result.Result<
  DeclarativeV2SemanticArtifactFrameUsageV1,
  DeclarativeV2SemanticArtifactCodecV1Error
> {
  return Result.gen(function* () {
    const capturedBudget = yield* captureBudget(budget);
    if (!isNonArrayRecord(input)) return yield* invalid("input");
    if (input.kind !== "semantic_root" && input.kind !== "semantic_selector") {
      return yield* invalid("kind");
    }
    const frame = yield* captureFrame(input, capturedBudget.maximumFrameBytes);
    const usage = Object.freeze({
      frameBytes: frameBytesFor(frame),
      canonicalBytes: canonicalBytesFor(frame),
    });
    if (usage.frameBytes > capturedBudget.maximumFrameBytes) {
      return yield* failBudget(
        "frameBytesExceeded",
        usage.frameBytes,
        capturedBudget.maximumFrameBytes,
      );
    }
    if (usage.canonicalBytes > capturedBudget.maximumCanonicalBytes) {
      return yield* failBudget(
        "canonicalBytesExceeded",
        usage.canonicalBytes,
        capturedBudget.maximumCanonicalBytes,
      );
    }
    return usage;
  });
}

export function encodeDeclarativeV2SemanticArtifactFrameV1(
  input: unknown,
  budget: unknown,
): Result.Result<
  DeclarativeV2SemanticArtifactEncodedV1<DeclarativeV2SemanticArtifactFrameV1>,
  DeclarativeV2SemanticArtifactCodecV1Error
> {
  return Result.gen(function* () {
    const capturedBudget = yield* captureBudget(budget);
    const frame = yield* captureFrame(input, capturedBudget.maximumFrameBytes);
    const canonicalByteLength = canonicalBytesFor(frame);
    const frameByteLength = frameBytesFor(frame);
    if (frameByteLength > capturedBudget.maximumFrameBytes) {
      return yield* failBudget(
        "frameBytesExceeded",
        frameByteLength,
        capturedBudget.maximumFrameBytes,
      );
    }
    if (canonicalByteLength > capturedBudget.maximumCanonicalBytes) {
      return yield* failBudget(
        "canonicalBytesExceeded",
        canonicalByteLength,
        capturedBudget.maximumCanonicalBytes,
      );
    }
    const canonicalBytes = encodeCapturedFrame(frame);
    return Object.freeze({
      value: ownFrame(frame),
      canonicalBytes: copyBytes(canonicalBytes),
      usage: Object.freeze({
        frameBytes: canonicalBytes.byteLength,
        canonicalBytes: canonicalByteLength,
      }),
    });
  });
}

export function decodeDeclarativeV2SemanticArtifactFrameV1(
  input: unknown,
  budget: unknown,
): Result.Result<
  DeclarativeV2SemanticArtifactEncodedV1<DeclarativeV2SemanticArtifactFrameV1>,
  DeclarativeV2SemanticArtifactCodecV1Error
> {
  return Result.gen(function* () {
    const capturedBudget = yield* captureBudget(budget);
    const inputByteLength = intrinsicUint8ArrayByteLength(input);
    if (inputByteLength === undefined) {
      return yield* invalid("input");
    }
    if (inputByteLength === 0) {
      return yield* Result.fail(new DeclarativeV2SemanticArtifactCodecV1Error({
        reason: "malformedStoredBytes",
      }));
    }
    if (inputByteLength > capturedBudget.maximumFrameBytes) {
      return yield* failBudget(
        "frameBytesExceeded",
        inputByteLength,
        capturedBudget.maximumFrameBytes,
      );
    }
    // SAFETY: the intrinsic byte-length check above proved input is a
    // Uint8Array with a visible, bounded length.
    const bytes = copyBytes(input as Uint8Array);
    const decoded = yield* parseFrame(bytes, capturedBudget.maximumCanonicalBytes);
    const reencoded = encodeCapturedFrame(decoded.frame);
    if (!bytesEqualFullScan(bytes, reencoded)) {
      return yield* Result.fail(new DeclarativeV2SemanticArtifactCodecV1Error({
        reason: "nonCanonicalStoredBytes",
      }));
    }
    return Object.freeze({
      value: ownFrame(decoded.frame),
      canonicalBytes: copyBytes(bytes),
      usage: Object.freeze({
        frameBytes: bytes.byteLength,
        canonicalBytes: decoded.canonicalBytes,
      }),
    });
  });
}

export function declarativeV2SemanticArtifactEmptyTreePreimageV1(
  budget: unknown,
): Result.Result<
  DeclarativeV2SemanticArtifactEncodedV1<Uint8Array>,
  DeclarativeV2SemanticArtifactCodecV1Error
> {
  return Result.gen(function* () {
    const capturedBudget = yield* captureBudget(budget);
    const frameByteLength = domainByteLength(DOMAINS.tree) + 8;
    if (frameByteLength > capturedBudget.maximumFrameBytes) {
      return yield* failBudget(
        "frameBytesExceeded",
        frameByteLength,
        capturedBudget.maximumFrameBytes,
      );
    }
    const bytes = concat([domainBytes(DOMAINS.tree), u32Bytes(1), u32Bytes(0)]);
    return Object.freeze({
      value: copyBytes(bytes),
      canonicalBytes: copyBytes(bytes),
      usage: Object.freeze({ frameBytes: bytes.byteLength, canonicalBytes: 0 }),
    });
  });
}

function captureBudget(
  value: unknown,
): Result.Result<
  DeclarativeV2SemanticArtifactFrameBudgetV1,
  DeclarativeV2SemanticArtifactCodecV1Error
> {
  if (
    !isNonArrayRecord(value) ||
    !isNonNegativeSafeInteger(value.maximumFrameBytes) ||
    !isNonNegativeSafeInteger(value.maximumCanonicalBytes)
  ) {
    return Result.fail(new DeclarativeV2SemanticArtifactCodecV1Error({
      reason: "invalidBudget",
    }));
  }
  return Result.succeed(Object.freeze({
    maximumFrameBytes: value.maximumFrameBytes,
    maximumCanonicalBytes: value.maximumCanonicalBytes,
  }));
}

function captureFrame(
  value: unknown,
  maximumFrameBytes: number,
): Result.Result<
  DeclarativeV2SemanticArtifactFrameV1,
  DeclarativeV2SemanticArtifactCodecV1Error
> {
  if (!isNonArrayRecord(value) || typeof value.kind !== "string") return invalid("kind");
  switch (value.kind) {
    case "semantic_block":
      return Result.gen(function* () {
        const blockOrdinal = yield* captureU64(value.blockOrdinal, "blockOrdinal");
        const firstByteOffset = yield* captureU64(value.firstByteOffset, "firstByteOffset");
        const bodyBytes = yield* captureBytes(
          value.bodyBytes,
          "bodyBytes",
          false,
          maximumFrameBytes,
        );
        const lineFeedCount = yield* captureU64(value.lineFeedCount, "lineFeedCount");
        if (countLineFeeds(bodyBytes) !== lineFeedCount) return yield* invalid("lineFeedCount");
        return Object.freeze({
          kind: "semantic_block" as const,
          blockOrdinal,
          firstByteOffset,
          bodyBytes,
          lineFeedCount,
        });
      });
    case "semantic_tree":
      return Result.gen(function* () {
        if (!Array.isArray(value.children) || value.children.length !== 2) {
          return yield* invalid("children");
        }
        const first = yield* captureTreeChild(value.children[0], "children[0]");
        const second = yield* captureTreeChild(value.children[1], "children[1]");
        if (
          second.firstBlockOrdinal !== first.firstBlockOrdinal + first.blockCount ||
          second.firstByteOffset !== first.firstByteOffset + first.byteLength
        ) {
          return yield* invalid("children");
        }
        return Object.freeze({
          kind: "semantic_tree" as const,
          // SAFETY: captureTreeChild validated both children above, so the
          // pair satisfies the two-child tuple contract.
          children: Object.freeze([first, second]) as readonly [
            DeclarativeV2SemanticArtifactTreeChildV1,
            DeclarativeV2SemanticArtifactTreeChildV1,
          ],
        });
      });
    case "semantic_root":
      return captureRoot(value);
    case "semantic_attempt":
      return captureAttempt(value);
    case "semantic_selector":
      return Result.gen(function* () {
        const semanticArtifactCodecVersion = yield* captureU32(
          value.semanticArtifactCodecVersion,
          "semanticArtifactCodecVersion",
        );
        if (
          semanticArtifactCodecVersion !==
            DECLARATIVE_V2_SEMANTIC_ARTIFACT_CODEC_VERSION_V1
        ) return yield* invalid("semanticArtifactCodecVersion");
        return Object.freeze({
          kind: "semantic_selector" as const,
          semanticArtifactCodecVersion,
          attemptIdentitySha256: yield* captureDigest(
            value.attemptIdentitySha256,
            "attemptIdentitySha256",
          ),
          semanticRootSha256: yield* captureDigest(
            value.semanticRootSha256,
            "semanticRootSha256",
          ),
        });
      });
    default:
      return invalid("kind");
  }
}

function captureRoot(
  value: Readonly<Record<PropertyKey, unknown>>,
): Result.Result<
  DeclarativeV2SemanticArtifactRootFrameV1,
  DeclarativeV2SemanticArtifactCodecV1Error
> {
  return Result.gen(function* () {
    const sourceArtifactCodecVersion = yield* captureU32(
      value.sourceArtifactCodecVersion,
      "sourceArtifactCodecVersion",
    );
    if (sourceArtifactCodecVersion !== 1) return yield* invalid("sourceArtifactCodecVersion");
    return Object.freeze({
      kind: "semantic_root" as const,
      sourceArtifactCodecVersion,
      sourceRootSha256: yield* captureDigest(value.sourceRootSha256, "sourceRootSha256"),
      semanticModelIdentity: yield* captureString(
        value.semanticModelIdentity,
        "semanticModelIdentity",
      ),
      semanticCodecIdentity: yield* captureString(
        value.semanticCodecIdentity,
        "semanticCodecIdentity",
      ),
      semanticPolicyIdentity: yield* captureString(
        value.semanticPolicyIdentity,
        "semanticPolicyIdentity",
      ),
      coreLanguageIdentity: yield* captureString(
        value.coreLanguageIdentity,
        "coreLanguageIdentity",
      ),
      abiIdentity: yield* captureString(value.abiIdentity, "abiIdentity"),
      grammarIdentity: yield* captureString(value.grammarIdentity, "grammarIdentity"),
      unicodeIdentity: yield* captureString(value.unicodeIdentity, "unicodeIdentity"),
      parserTableIdentity: yield* captureString(
        value.parserTableIdentity,
        "parserTableIdentity",
      ),
      trustedToolingIdentity: yield* captureString(
        value.trustedToolingIdentity,
        "trustedToolingIdentity",
      ),
      ingressProtocolIdentity: yield* captureString(
        value.ingressProtocolIdentity,
        "ingressProtocolIdentity",
      ),
      ingressConfigurationIdentity: yield* captureString(
        value.ingressConfigurationIdentity,
        "ingressConfigurationIdentity",
      ),
      blockCount: yield* captureU64(value.blockCount, "blockCount"),
      streamByteLength: yield* captureU64(value.streamByteLength, "streamByteLength"),
      recordCount: yield* captureU64(value.recordCount, "recordCount"),
      treeRootSha256: yield* captureDigest(value.treeRootSha256, "treeRootSha256"),
    });
  });
}

function captureAttempt(
  value: Readonly<Record<PropertyKey, unknown>>,
): Result.Result<
  DeclarativeV2SemanticArtifactAttemptFrameV1,
  DeclarativeV2SemanticArtifactCodecV1Error
> {
  return Result.gen(function* () {
    const sourceArtifactCodecVersion = yield* captureU32(
      value.sourceArtifactCodecVersion,
      "sourceArtifactCodecVersion",
    );
    const semanticArtifactCodecVersion = yield* captureU32(
      value.semanticArtifactCodecVersion,
      "semanticArtifactCodecVersion",
    );
    if (sourceArtifactCodecVersion !== 1) return yield* invalid("sourceArtifactCodecVersion");
    if (
      semanticArtifactCodecVersion !== DECLARATIVE_V2_SEMANTIC_ARTIFACT_CODEC_VERSION_V1
    ) return yield* invalid("semanticArtifactCodecVersion");
    const deploymentCreatedAt = yield* captureString(
      value.deploymentCreatedAt,
      "deploymentCreatedAt",
    );
    if (!isCanonicalIsoTimestamp(deploymentCreatedAt)) {
      return yield* invalid("deploymentCreatedAt");
    }
    return Object.freeze({
      kind: "semantic_attempt" as const,
      projectId: yield* captureString(value.projectId, "projectId"),
      deploymentId: yield* captureString(value.deploymentId, "deploymentId"),
      deploymentCreatedAt,
      semanticUploadId: yield* captureString(value.semanticUploadId, "semanticUploadId"),
      sourceArtifactCodecVersion,
      sourceUploadId: yield* captureString(value.sourceUploadId, "sourceUploadId"),
      sourceGeneration: yield* captureU64(value.sourceGeneration, "sourceGeneration"),
      sourceMutationFence: yield* captureU64(
        value.sourceMutationFence,
        "sourceMutationFence",
      ),
      sourceRootSha256: yield* captureDigest(value.sourceRootSha256, "sourceRootSha256"),
      sourceSelectorSha256: yield* captureDigest(
        value.sourceSelectorSha256,
        "sourceSelectorSha256",
      ),
      semanticArtifactCodecVersion,
      semanticGeneration: yield* captureU64(
        value.semanticGeneration,
        "semanticGeneration",
      ),
      semanticMutationFence: yield* captureU64(
        value.semanticMutationFence,
        "semanticMutationFence",
      ),
      semanticModelIdentity: yield* captureString(
        value.semanticModelIdentity,
        "semanticModelIdentity",
      ),
      semanticCodecIdentity: yield* captureString(
        value.semanticCodecIdentity,
        "semanticCodecIdentity",
      ),
      semanticPolicyIdentity: yield* captureString(
        value.semanticPolicyIdentity,
        "semanticPolicyIdentity",
      ),
      semanticIngressProtocolIdentity: yield* captureString(
        value.semanticIngressProtocolIdentity,
        "semanticIngressProtocolIdentity",
      ),
      semanticIngressConfigurationIdentity: yield* captureString(
        value.semanticIngressConfigurationIdentity,
        "semanticIngressConfigurationIdentity",
      ),
      ceilingsSha256: yield* captureDigest(value.ceilingsSha256, "ceilingsSha256"),
    });
  });
}

function captureTreeChild(
  value: unknown,
  field: string,
): Result.Result<
  DeclarativeV2SemanticArtifactTreeChildV1,
  DeclarativeV2SemanticArtifactCodecV1Error
> {
  if (!isNonArrayRecord(value)) return invalid(field);
  return Result.gen(function* () {
    const blockCount = yield* captureU64(value.blockCount, `${field}.blockCount`);
    if (blockCount < 1n) return yield* invalid(`${field}.blockCount`);
    return Object.freeze({
      firstBlockOrdinal: yield* captureU64(
        value.firstBlockOrdinal,
        `${field}.firstBlockOrdinal`,
      ),
      blockCount,
      firstByteOffset: yield* captureU64(
        value.firstByteOffset,
        `${field}.firstByteOffset`,
      ),
      byteLength: yield* captureU64(value.byteLength, `${field}.byteLength`),
      lineFeedCount: yield* captureU64(
        value.lineFeedCount,
        `${field}.lineFeedCount`,
      ),
      sha256: yield* captureDigest(value.sha256, `${field}.sha256`),
    });
  });
}

function encodeCapturedFrame(frame: DeclarativeV2SemanticArtifactFrameV1): Uint8Array {
  switch (frame.kind) {
    case "semantic_block":
      return concat([
        domainBytes(DOMAINS.block),
        u32Bytes(1),
        u64Bytes(frame.blockOrdinal),
        u64Bytes(frame.firstByteOffset),
        lengthBytes(frame.bodyBytes),
        u64Bytes(frame.lineFeedCount),
      ]);
    case "semantic_tree":
      return concat([
        domainBytes(DOMAINS.tree),
        u32Bytes(1),
        u32Bytes(2),
        ...frame.children.flatMap(child => [
          u64Bytes(child.firstBlockOrdinal),
          u64Bytes(child.blockCount),
          u64Bytes(child.firstByteOffset),
          u64Bytes(child.byteLength),
          u64Bytes(child.lineFeedCount),
          child.sha256,
        ]),
      ]);
    case "semantic_root":
      return concat([
        domainBytes(DOMAINS.root),
        u32Bytes(1),
        u32Bytes(frame.sourceArtifactCodecVersion),
        frame.sourceRootSha256,
        ...rootStrings(frame).map(stringBytes),
        u64Bytes(frame.blockCount),
        u64Bytes(frame.streamByteLength),
        u64Bytes(frame.recordCount),
        frame.treeRootSha256,
      ]);
    case "semantic_attempt":
      return concat([
        domainBytes(DOMAINS.attempt),
        u32Bytes(1),
        stringBytes(frame.projectId),
        stringBytes(frame.deploymentId),
        stringBytes(frame.deploymentCreatedAt),
        stringBytes(frame.semanticUploadId),
        u32Bytes(frame.sourceArtifactCodecVersion),
        stringBytes(frame.sourceUploadId),
        u64Bytes(frame.sourceGeneration),
        u64Bytes(frame.sourceMutationFence),
        frame.sourceRootSha256,
        frame.sourceSelectorSha256,
        u32Bytes(frame.semanticArtifactCodecVersion),
        u64Bytes(frame.semanticGeneration),
        u64Bytes(frame.semanticMutationFence),
        stringBytes(frame.semanticModelIdentity),
        stringBytes(frame.semanticCodecIdentity),
        stringBytes(frame.semanticPolicyIdentity),
        stringBytes(frame.semanticIngressProtocolIdentity),
        stringBytes(frame.semanticIngressConfigurationIdentity),
        frame.ceilingsSha256,
      ]);
    case "semantic_selector":
      return concat([
        domainBytes(DOMAINS.selector),
        u32Bytes(1),
        u32Bytes(frame.semanticArtifactCodecVersion),
        frame.attemptIdentitySha256,
        frame.semanticRootSha256,
      ]);
  }
}

function parseFrame(
  bytes: Uint8Array,
  maximumCanonicalBytes: number,
): Result.Result<
  { readonly frame: DeclarativeV2SemanticArtifactFrameV1; readonly canonicalBytes: number },
  DeclarativeV2SemanticArtifactCodecV1Error
> {
  try {
    const cursor = new Cursor(bytes, maximumCanonicalBytes);
    const domain = cursor.domain();
    const version = cursor.u32();
    if (version !== 1) throw new ParseFailure();
    let frame: DeclarativeV2SemanticArtifactFrameV1;
    if (domain === DOMAINS.block) {
      const blockOrdinal = cursor.u64();
      const firstByteOffset = cursor.u64();
      const bodyBytes = cursor.bytes(false);
      const lineFeedCount = cursor.u64();
      frame = {
        kind: "semantic_block",
        blockOrdinal,
        firstByteOffset,
        bodyBytes,
        lineFeedCount,
      };
    } else if (domain === DOMAINS.tree) {
      if (cursor.u32() !== 2) throw new ParseFailure();
      const first = cursor.treeChild();
      const second = cursor.treeChild();
      frame = { kind: "semantic_tree", children: [first, second] };
    } else if (domain === DOMAINS.root) {
      frame = {
        kind: "semantic_root",
        sourceArtifactCodecVersion: cursor.u32(),
        sourceRootSha256: cursor.digest(),
        semanticModelIdentity: cursor.string(),
        semanticCodecIdentity: cursor.string(),
        semanticPolicyIdentity: cursor.string(),
        coreLanguageIdentity: cursor.string(),
        abiIdentity: cursor.string(),
        grammarIdentity: cursor.string(),
        unicodeIdentity: cursor.string(),
        parserTableIdentity: cursor.string(),
        trustedToolingIdentity: cursor.string(),
        ingressProtocolIdentity: cursor.string(),
        ingressConfigurationIdentity: cursor.string(),
        blockCount: cursor.u64(),
        streamByteLength: cursor.u64(),
        recordCount: cursor.u64(),
        treeRootSha256: cursor.digest(),
      };
    } else if (domain === DOMAINS.attempt) {
      frame = {
        kind: "semantic_attempt",
        projectId: cursor.string(),
        deploymentId: cursor.string(),
        deploymentCreatedAt: cursor.string(),
        semanticUploadId: cursor.string(),
        sourceArtifactCodecVersion: cursor.u32(),
        sourceUploadId: cursor.string(),
        sourceGeneration: cursor.u64(),
        sourceMutationFence: cursor.u64(),
        sourceRootSha256: cursor.digest(),
        sourceSelectorSha256: cursor.digest(),
        semanticArtifactCodecVersion: cursor.u32(),
        semanticGeneration: cursor.u64(),
        semanticMutationFence: cursor.u64(),
        semanticModelIdentity: cursor.string(),
        semanticCodecIdentity: cursor.string(),
        semanticPolicyIdentity: cursor.string(),
        semanticIngressProtocolIdentity: cursor.string(),
        semanticIngressConfigurationIdentity: cursor.string(),
        ceilingsSha256: cursor.digest(),
      };
    } else if (domain === DOMAINS.selector) {
      frame = {
        kind: "semantic_selector",
        semanticArtifactCodecVersion: cursor.u32(),
        attemptIdentitySha256: cursor.digest(),
        semanticRootSha256: cursor.digest(),
      };
    } else {
      throw new ParseFailure();
    }
    cursor.eof();
    const captured = captureFrame(frame, bytes.byteLength);
    if (Result.isFailure(captured)) throw new ParseFailure();
    return Result.succeed({
      frame: captured.success,
      canonicalBytes: cursor.canonicalBytes,
    });
  } catch (cause) {
    if (cause instanceof CanonicalBudgetFailure) {
      return failBudget(
        "canonicalBytesExceeded",
        cause.observed,
        cause.maximum,
      );
    }
    return Result.fail(new DeclarativeV2SemanticArtifactCodecV1Error({
      reason: "malformedStoredBytes",
    }));
  }
}

class ParseFailure extends Error {}
class CanonicalBudgetFailure extends Error {
  constructor(readonly observed: number, readonly maximum: number) {
    super();
  }
}

class Cursor {
  offset = 0;
  canonicalBytes = 0;
  constructor(readonly bytesValue: Uint8Array, readonly maximumCanonicalBytes: number) {}
  take(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytesValue.length) {
      throw new ParseFailure();
    }
    const result = this.bytesValue.slice(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
  u32(): number {
    const bytes = this.take(4);
    return ((bytes[0]! * 0x1000000) + (bytes[1]! << 16) + (bytes[2]! << 8) + bytes[3]!) >>> 0;
  }
  u64(): bigint {
    const bytes = this.take(8);
    let result = 0n;
    for (const byte of bytes) result = (result << 8n) | BigInt(byte);
    if (result > DECLARATIVE_V2_SEMANTIC_ARTIFACT_MAX_SIGNED_INT64_V1) {
      throw new ParseFailure();
    }
    return result;
  }
  bytes(canonical: boolean): Uint8Array {
    const length = this.u32();
    if (canonical) {
      const next = this.canonicalBytes + length;
      if (!Number.isSafeInteger(next) || next > this.maximumCanonicalBytes) {
        throw new CanonicalBudgetFailure(next, this.maximumCanonicalBytes);
      }
      this.canonicalBytes = next;
    }
    return this.take(length);
  }
  string(): string {
    const bytes = this.bytes(true);
    let value: string;
    try {
      value = FATAL_UTF8_DECODER.decode(bytes);
    } catch {
      throw new ParseFailure();
    }
    if (!isNonEmptyString(value) || !bytesEqualFullScan(bytes, UTF8_ENCODER.encode(value))) {
      throw new ParseFailure();
    }
    return value;
  }
  digest(): Uint8Array {
    return this.take(DECLARATIVE_V2_SEMANTIC_ARTIFACT_SHA256_BYTES_V1);
  }
  domain(): string {
    const bytes = this.bytes(false);
    let value: string;
    try {
      value = FATAL_UTF8_DECODER.decode(bytes);
    } catch {
      throw new ParseFailure();
    }
    if (!bytesEqualFullScan(bytes, UTF8_ENCODER.encode(value))) throw new ParseFailure();
    return value;
  }
  treeChild(): DeclarativeV2SemanticArtifactTreeChildV1 {
    return {
      firstBlockOrdinal: this.u64(),
      blockCount: this.u64(),
      firstByteOffset: this.u64(),
      byteLength: this.u64(),
      lineFeedCount: this.u64(),
      sha256: this.digest(),
    };
  }
  eof(): void {
    if (this.offset !== this.bytesValue.byteLength) throw new ParseFailure();
  }
}

function captureU32(
  value: unknown,
  field: string,
): Result.Result<number, DeclarativeV2SemanticArtifactCodecV1Error> {
  return isNonNegativeSafeInteger(value) && value <= U32_MAX
    ? Result.succeed(value)
    : invalid(field);
}

function captureU64(
  value: unknown,
  field: string,
): Result.Result<bigint, DeclarativeV2SemanticArtifactCodecV1Error> {
  return typeof value === "bigint" && value >= 0n &&
      value <= DECLARATIVE_V2_SEMANTIC_ARTIFACT_MAX_SIGNED_INT64_V1
    ? Result.succeed(value)
    : invalid(field);
}

function captureString(
  value: unknown,
  field: string,
): Result.Result<string, DeclarativeV2SemanticArtifactCodecV1Error> {
  if (
    !isNonEmptyString(value) ||
    !hasOnlyPairedSurrogates(value) ||
    utf8ByteLength(value) > U32_MAX
  ) {
    return invalid(field);
  }
  return Result.succeed(value);
}

function captureDigest(
  value: unknown,
  field: string,
): Result.Result<Uint8Array, DeclarativeV2SemanticArtifactCodecV1Error> {
  return isUint8ArrayWithByteLength(
      value,
      DECLARATIVE_V2_SEMANTIC_ARTIFACT_SHA256_BYTES_V1,
    )
    ? Result.succeed(copyBytes(value))
    : invalid(field);
}

function captureBytes(
  value: unknown,
  field: string,
  allowEmpty: boolean,
  maximumFrameBytes: number,
): Result.Result<Uint8Array, DeclarativeV2SemanticArtifactCodecV1Error> {
  const byteLength = intrinsicUint8ArrayByteLength(value);
  if (byteLength === undefined) {
    return invalid(field);
  }
  if ((!allowEmpty && byteLength === 0) || byteLength > U32_MAX) {
    return invalid(field);
  }
  const minimumFrameBytes = checkedLength(
    domainByteLength(DOMAINS.block),
    4 + 8 + 8 + 4 + byteLength + 8,
  );
  if (minimumFrameBytes > maximumFrameBytes) {
    return failBudget("frameBytesExceeded", minimumFrameBytes, maximumFrameBytes);
  }
  // SAFETY: the intrinsic byte-length check above proved value is a
  // Uint8Array with a visible, bounded length.
  return Result.succeed(copyBytes(value as Uint8Array));
}

function intrinsicUint8ArrayByteLength(value: unknown): number | undefined {
  if (!isUint8Array(value) || TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined) {
    return undefined;
  }
  try {
    const byteLength: unknown = Reflect.apply(
      TYPED_ARRAY_BYTE_LENGTH_GETTER,
      value,
      [],
    );
    return typeof byteLength === "number" ? byteLength : undefined;
  } catch {
    return undefined;
  }
}

function invalid<T = never>(
  field: string,
): Result.Result<T, DeclarativeV2SemanticArtifactCodecV1Error> {
  return Result.fail(new DeclarativeV2SemanticArtifactCodecV1Error({
    reason: "invalidInput",
    field,
  }));
}

function failBudget<T = never>(
  reason: "frameBytesExceeded" | "canonicalBytesExceeded",
  observed: number,
  maximum: number,
): Result.Result<T, DeclarativeV2SemanticArtifactCodecV1Error> {
  return Result.fail(new DeclarativeV2SemanticArtifactCodecV1Error({
    reason,
    observed,
    maximum,
  }));
}

function domainBytes(domain: string): Uint8Array {
  return lengthBytes(UTF8_ENCODER.encode(domain));
}

function stringBytes(value: string): Uint8Array {
  return lengthBytes(UTF8_ENCODER.encode(value));
}

function lengthBytes(bytes: Uint8Array): Uint8Array {
  return concat([u32Bytes(bytes.byteLength), bytes]);
}

function u32Bytes(value: number): Uint8Array {
  const output = new Uint8Array(4);
  const view = new DataView(output.buffer);
  view.setUint32(0, value, false);
  return output;
}

function u64Bytes(value: bigint): Uint8Array {
  const output = new Uint8Array(8);
  let remaining = value;
  for (let index = 7; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return output;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  if (!Number.isSafeInteger(length)) throw new Error("Semantic frame length overflow.");
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function canonicalBytesFor(frame: DeclarativeV2SemanticArtifactFrameV1): number {
  switch (frame.kind) {
    case "semantic_block":
    case "semantic_tree":
    case "semantic_selector":
      return 0;
    case "semantic_root":
      return rootStrings(frame).reduce(
        (sum, value) => sum + utf8ByteLength(value),
        0,
      );
    case "semantic_attempt":
      return [
        frame.projectId,
        frame.deploymentId,
        frame.deploymentCreatedAt,
        frame.semanticUploadId,
        frame.sourceUploadId,
        frame.semanticModelIdentity,
        frame.semanticCodecIdentity,
        frame.semanticPolicyIdentity,
        frame.semanticIngressProtocolIdentity,
        frame.semanticIngressConfigurationIdentity,
      ].reduce((sum, value) => sum + utf8ByteLength(value), 0);
  }
}

function frameBytesFor(frame: DeclarativeV2SemanticArtifactFrameV1): number {
  switch (frame.kind) {
    case "semantic_block":
      return checkedLength(
        domainByteLength(DOMAINS.block),
        4 + 8 + 8 + 4 + frame.bodyBytes.byteLength + 8,
      );
    case "semantic_tree":
      return checkedLength(domainByteLength(DOMAINS.tree), 4 + 4 + (2 * 72));
    case "semantic_root":
      return checkedLength(
        domainByteLength(DOMAINS.root),
        4 + 4 + 32 + stringsFrameByteLength(rootStrings(frame)) + 24 + 32,
      );
    case "semantic_attempt":
      return checkedLength(
        domainByteLength(DOMAINS.attempt),
        4 +
          stringsFrameByteLength([
            frame.projectId,
            frame.deploymentId,
            frame.deploymentCreatedAt,
            frame.semanticUploadId,
          ]) +
          4 +
          stringFrameByteLength(frame.sourceUploadId) +
          16 +
          64 +
          4 +
          16 +
          stringsFrameByteLength([
            frame.semanticModelIdentity,
            frame.semanticCodecIdentity,
            frame.semanticPolicyIdentity,
            frame.semanticIngressProtocolIdentity,
            frame.semanticIngressConfigurationIdentity,
          ]) +
          32,
      );
    case "semantic_selector":
      return checkedLength(domainByteLength(DOMAINS.selector), 4 + 4 + 64);
  }
}

function domainByteLength(domain: string): number {
  return 4 + utf8ByteLength(domain);
}

function stringFrameByteLength(value: string): number {
  return checkedLength(4, utf8ByteLength(value));
}

function stringsFrameByteLength(values: readonly string[]): number {
  return values.reduce((sum, value) => checkedLength(sum, stringFrameByteLength(value)), 0);
}

function checkedLength(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new Error("Semantic frame length overflow.");
  return sum;
}

function rootStrings(frame: DeclarativeV2SemanticArtifactRootFrameV1): readonly string[] {
  return [
    frame.semanticModelIdentity,
    frame.semanticCodecIdentity,
    frame.semanticPolicyIdentity,
    frame.coreLanguageIdentity,
    frame.abiIdentity,
    frame.grammarIdentity,
    frame.unicodeIdentity,
    frame.parserTableIdentity,
    frame.trustedToolingIdentity,
    frame.ingressProtocolIdentity,
    frame.ingressConfigurationIdentity,
  ];
}

function countLineFeeds(bytes: Uint8Array): bigint {
  let count = 0n;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] === 0x0a) count += 1n;
  }
  return count;
}

function ownFrame(
  frame: DeclarativeV2SemanticArtifactFrameV1,
): DeclarativeV2SemanticArtifactFrameV1 {
  switch (frame.kind) {
    case "semantic_block":
      return Object.freeze({ ...frame, bodyBytes: copyBytes(frame.bodyBytes) });
    case "semantic_tree":
      {
        const first = frame.children[0];
        const second = frame.children[1];
        const children = Object.freeze([
          Object.freeze({ ...first, sha256: copyBytes(first.sha256) }),
          Object.freeze({ ...second, sha256: copyBytes(second.sha256) }),
        ] as const);
      return Object.freeze({
        ...frame,
        children,
      });
      }
    case "semantic_root":
      return Object.freeze({
        ...frame,
        sourceRootSha256: copyBytes(frame.sourceRootSha256),
        treeRootSha256: copyBytes(frame.treeRootSha256),
      });
    case "semantic_attempt":
      return Object.freeze({
        ...frame,
        sourceRootSha256: copyBytes(frame.sourceRootSha256),
        sourceSelectorSha256: copyBytes(frame.sourceSelectorSha256),
        ceilingsSha256: copyBytes(frame.ceilingsSha256),
      });
    case "semantic_selector":
      return Object.freeze({
        ...frame,
        attemptIdentitySha256: copyBytes(frame.attemptIdentitySha256),
        semanticRootSha256: copyBytes(frame.semanticRootSha256),
      });
  }
}
