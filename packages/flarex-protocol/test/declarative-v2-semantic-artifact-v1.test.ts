import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Result } from "effect";
import {
  decodeDeclarativeV2SemanticArtifactFrameV1,
  declarativeV2SemanticArtifactEmptyTreePreimageV1,
  encodeDeclarativeV2SemanticArtifactFrameV1,
  measureDeclarativeV2SemanticArtifactRootOrSelectorFrameV1,
  type DeclarativeV2SemanticArtifactFrameV1,
} from "../src/declarative-v2-semantic-artifact-v1";

const digest = (value: number) => new Uint8Array(32).fill(value);
const budget = { maximumFrameBytes: 16_384, maximumCanonicalBytes: 8_192 };

const fixtures: readonly DeclarativeV2SemanticArtifactFrameV1[] = [
  {
    kind: "semantic_block",
    blockOrdinal: 0n,
    firstByteOffset: 0n,
    bodyBytes: new TextEncoder().encode("{}\n"),
    lineFeedCount: 1n,
  },
  {
    kind: "semantic_tree",
    children: [
      {
        firstBlockOrdinal: 0n,
        blockCount: 1n,
        firstByteOffset: 0n,
        byteLength: 3n,
        lineFeedCount: 1n,
        sha256: digest(1),
      },
      {
        firstBlockOrdinal: 1n,
        blockCount: 1n,
        firstByteOffset: 3n,
        byteLength: 4n,
        lineFeedCount: 1n,
        sha256: digest(2),
      },
    ],
  },
  {
    kind: "semantic_root",
    sourceArtifactCodecVersion: 1,
    sourceRootSha256: digest(3),
    semanticModelIdentity: "semantic-model-v1",
    semanticCodecIdentity: "semantic-codec-v1",
    semanticPolicyIdentity: "semantic-policy-v1",
    coreLanguageIdentity: "FlarexDeclarativeExecutableCoreV1",
    abiIdentity: "abi-v1",
    grammarIdentity: "grammar-es2022-unicode14-v1",
    unicodeIdentity: "unicode-14",
    parserTableIdentity: "parser-table-v1",
    trustedToolingIdentity: "tooling-v1",
    ingressProtocolIdentity: "semantic-ingress-v1",
    ingressConfigurationIdentity: "semantic-ingress-config-v1",
    blockCount: 2n,
    streamByteLength: 7n,
    recordCount: 2n,
    treeRootSha256: digest(4),
  },
  {
    kind: "semantic_attempt",
    projectId: "project",
    deploymentId: "deployment",
    deploymentCreatedAt: "2026-07-24T00:00:00.000Z",
    semanticUploadId: "semantic-upload",
    sourceArtifactCodecVersion: 1,
    sourceUploadId: "source-upload",
    sourceGeneration: 2n,
    sourceMutationFence: 3n,
    sourceRootSha256: digest(5),
    sourceSelectorSha256: digest(6),
    semanticArtifactCodecVersion: 1,
    semanticGeneration: 4n,
    semanticMutationFence: 5n,
    semanticModelIdentity: "semantic-model-v1",
    semanticCodecIdentity: "semantic-codec-v1",
    semanticPolicyIdentity: "semantic-policy-v1",
    semanticIngressProtocolIdentity: "semantic-ingress-v1",
    semanticIngressConfigurationIdentity: "semantic-ingress-config-v1",
    ceilingsSha256: digest(7),
  },
  {
    kind: "semantic_selector",
    semanticArtifactCodecVersion: 1,
    attemptIdentitySha256: digest(8),
    semanticRootSha256: digest(9),
  },
];

describe("Declarative V2 Semantic Artifact V1 codec", () => {
  it("round-trips all frame families with stable golden digests", () => {
    const vectors = fixtures.map(frame => {
      const encoded = encodeDeclarativeV2SemanticArtifactFrameV1(frame, budget);
      expect(Result.isSuccess(encoded)).toBe(true);
      if (Result.isFailure(encoded)) throw encoded.failure;
      if (frame.kind === "semantic_root" || frame.kind === "semantic_selector") {
        const measured = measureDeclarativeV2SemanticArtifactRootOrSelectorFrameV1(
          frame,
          budget,
        );
        expect(Result.isSuccess(measured)).toBe(true);
        if (Result.isFailure(measured)) throw measured.failure;
        expect(measured.success).toEqual(encoded.success.usage);
      }
      const decoded = decodeDeclarativeV2SemanticArtifactFrameV1(
        encoded.success.canonicalBytes,
        budget,
      );
      expect(Result.isSuccess(decoded)).toBe(true);
      if (Result.isFailure(decoded)) throw decoded.failure;
      expect(decoded.success.canonicalBytes).toEqual(encoded.success.canonicalBytes);
      return {
        kind: frame.kind,
        bytes: encoded.success.canonicalBytes.byteLength,
        sha256: createHash("sha256").update(encoded.success.canonicalBytes).digest("hex"),
      };
    });
    expect(vectors).toEqual([
      {
        kind: "semantic_block",
        bytes: 88,
        sha256: "22d2230ce187b5410c03506a1c8fb56c873e636dca375d71a3907d89ded81a18",
      },
      {
        kind: "semantic_tree",
        bytes: 204,
        sha256: "577cc335b2e7a0619fdd16a27755b08159f8e073c297aba5e471331e4f11494c",
      },
      {
        kind: "semantic_root",
        bytes: 390,
        sha256: "f2f005bbd244c9823f3c92104a79c7cfa957926907309efbfdcf5fcb545bfe78",
      },
      {
        kind: "semantic_attempt",
        bytes: 401,
        sha256: "2a8f14708c58bb66232df9e196092686842910883e3115c4194aa7933de4ff51",
      },
      {
        kind: "semantic_selector",
        bytes: 128,
        sha256: "ab093cf1d325b96ac66ca2a66500de5452f54ee5dd0f2f3462905de4e9e02767",
      },
    ]);
  });

  it("pins the empty-tree preimage", () => {
    const encoded = declarativeV2SemanticArtifactEmptyTreePreimageV1(budget);
    expect(Result.isSuccess(encoded)).toBe(true);
    if (Result.isFailure(encoded)) throw encoded.failure;
    expect(encoded.success.canonicalBytes.byteLength).toBe(60);
    expect(createHash("sha256").update(encoded.success.canonicalBytes).digest("hex"))
      .toBe("b3d8d822592d026405e151850fc56c847db64a609ca1d6067bfa8b2b8d829db6");
  });

  it("rejects every truncation, trailing bytes, noncanonical UTF-8, and one-less budgets", () => {
    for (const frame of fixtures) {
      const encoded = encodeDeclarativeV2SemanticArtifactFrameV1(frame, budget);
      if (Result.isFailure(encoded)) throw encoded.failure;
      for (let length = 0; length < encoded.success.canonicalBytes.byteLength; length += 1) {
        expect(Result.isFailure(
          decodeDeclarativeV2SemanticArtifactFrameV1(
            encoded.success.canonicalBytes.slice(0, length),
            budget,
          ),
        )).toBe(true);
      }
      const trailing = new Uint8Array(encoded.success.canonicalBytes.byteLength + 1);
      trailing.set(encoded.success.canonicalBytes);
      expect(Result.isFailure(
        decodeDeclarativeV2SemanticArtifactFrameV1(trailing, budget),
      )).toBe(true);
      expect(Result.isSuccess(
        decodeDeclarativeV2SemanticArtifactFrameV1(encoded.success.canonicalBytes, {
          maximumFrameBytes: encoded.success.canonicalBytes.byteLength,
          maximumCanonicalBytes: encoded.success.usage.canonicalBytes,
        }),
      )).toBe(true);
      expect(Result.isFailure(
        decodeDeclarativeV2SemanticArtifactFrameV1(encoded.success.canonicalBytes, {
          maximumFrameBytes: encoded.success.canonicalBytes.byteLength - 1,
          maximumCanonicalBytes: encoded.success.usage.canonicalBytes,
        }),
      )).toBe(true);
      if (encoded.success.usage.canonicalBytes > 0) {
        expect(Result.isFailure(
          decodeDeclarativeV2SemanticArtifactFrameV1(encoded.success.canonicalBytes, {
            maximumFrameBytes: encoded.success.canonicalBytes.byteLength,
            maximumCanonicalBytes: encoded.success.usage.canonicalBytes - 1,
          }),
        )).toBe(true);
      }
    }
  });

  it("owns caller bytes and rejects inconsistent block/tree evidence", () => {
    const body = new TextEncoder().encode("{}\n");
    const encoded = encodeDeclarativeV2SemanticArtifactFrameV1({
      kind: "semantic_block",
      blockOrdinal: 0n,
      firstByteOffset: 0n,
      bodyBytes: body,
      lineFeedCount: 1n,
    }, budget);
    if (Result.isFailure(encoded)) throw encoded.failure;
    body.fill(0xff);
    expect((encoded.success.value as { bodyBytes: Uint8Array }).bodyBytes)
      .toEqual(new TextEncoder().encode("{}\n"));
    expect(Result.isFailure(encodeDeclarativeV2SemanticArtifactFrameV1({
      ...fixtures[0],
      lineFeedCount: 0n,
    }, budget))).toBe(true);
    const tree = fixtures[1];
    if (tree?.kind !== "semantic_tree") throw new Error("fixture");
    expect(Result.isFailure(encodeDeclarativeV2SemanticArtifactFrameV1({
      ...tree,
      children: [tree.children[0], {
        ...tree.children[1],
        firstBlockOrdinal: 2n,
      }],
    }, budget))).toBe(true);
  });

  it("uses intrinsic byte ownership and fails hostile or detached inputs closed", () => {
    const body = new TextEncoder().encode("{}\n");
    Object.defineProperty(body, "byteLength", {
      configurable: true,
      get: () => {
        throw new Error("own byteLength must not run");
      },
    });
    Object.defineProperty(body, Symbol.iterator, {
      configurable: true,
      value: () => {
        throw new Error("iterator must not run");
      },
    });
    const encoded = encodeDeclarativeV2SemanticArtifactFrameV1({
      kind: "semantic_block",
      blockOrdinal: 0n,
      firstByteOffset: 0n,
      bodyBytes: body,
      lineFeedCount: 1n,
    }, budget);
    expect(Result.isSuccess(encoded)).toBe(true);

    expect(Result.isFailure(encodeDeclarativeV2SemanticArtifactFrameV1({
      kind: "semantic_block",
      blockOrdinal: 0n,
      firstByteOffset: 0n,
      bodyBytes: new Proxy(new Uint8Array(1), {}),
      lineFeedCount: 0n,
    }, budget))).toBe(true);

    const detached = new Uint8Array([1]);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(Result.isFailure(encodeDeclarativeV2SemanticArtifactFrameV1({
      kind: "semantic_block",
      blockOrdinal: 0n,
      firstByteOffset: 0n,
      bodyBytes: detached,
      lineFeedCount: 0n,
    }, budget))).toBe(true);
    expect(Result.isFailure(
      decodeDeclarativeV2SemanticArtifactFrameV1(
        new Proxy(new Uint8Array(1), {}),
        budget,
      ),
    )).toBe(true);
    expect(Result.isFailure(
      decodeDeclarativeV2SemanticArtifactFrameV1(detached, budget),
    )).toBe(true);
  });

  it("rejects strings whose UTF-8 encoding would replace isolated surrogates", () => {
    const root = fixtures[2];
    if (root?.kind !== "semantic_root") throw new Error("fixture");
    for (const semanticModelIdentity of ["\ud800x", "x\udc00"]) {
      expect(Result.isFailure(encodeDeclarativeV2SemanticArtifactFrameV1({
        ...root,
        semanticModelIdentity,
      }, budget))).toBe(true);
    }
  });
});
