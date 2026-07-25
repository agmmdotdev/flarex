import { webcrypto } from "node:crypto";

import { copyBytes } from "@flarex/utils/bytes";
import { Cause, Effect, Exit, Result } from "effect";
import {
  encodeDeclarativeV2SemanticArtifactFrameV1,
} from "flarex-protocol/internal/declarative-v2-semantic-artifact-v1";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { describe, expect, it } from "vitest";

import {
  makeSemanticArtifactV1FinalizedContentReader,
} from "../src/semanticArtifactV1/FinalizedContentReader";
import {
  makeSemanticArtifactV1R2Store,
  type SemanticArtifactV1R2Bucket,
} from "../src/semanticArtifactV1/R2Store";
import {
  makeSemanticArtifactV1Sha256,
  type SemanticArtifactV1Sha256,
} from "../src/semanticArtifactV1/Sha256";
import {
  makeDeclarativeV2ContentReadBudgetTracker,
} from "../src/sourceArtifactV2/FinalizedContentReader";

const FRAME_BUDGET = {
  maximumFrameBytes: 100_000,
  maximumCanonicalBytes: 100_000,
};

describe("Semantic Artifact V1 finalized content reader", () => {
  it("reads canonical manifest-last semantic bytes and exact module paths", async () => {
    const fixture = await makeSemanticFixture("functions/main.js");
    const content = await Effect.runPromise(fixture.reader.read(
      fixture.rootDigest,
      fixture.sourceRootDigest,
      budgetTracker(),
    ));
    expect(content.records.map(record => record.kind)).toEqual([
      "header",
      "module",
      "schema",
    ]);
    expect(content.modules).toHaveLength(1);
    expect(content.modules[0]!.pathBytes).toEqual(
      new TextEncoder().encode("functions/main.js"),
    );
    expect(content.streamBytes).toEqual(fixture.streamBytes);
    expect(fixture.bucket.lookupCount).toBe(2);
    expect(fixture.bucket.bodyAccesses).toBe(2);
    expect(Object.isFrozen(content)).toBe(true);
    expect(Object.isFrozen(content.records)).toBe(true);
  });

  it("rejects a one-less metadata ceiling before the root body and hash", async () => {
    const fixture = await makeSemanticFixture("functions/main.js");
    fixture.hashCalls.value = 0;
    const exit = await Effect.runPromiseExit(fixture.reader.read(
      fixture.rootDigest,
      fixture.sourceRootDigest,
      budgetTracker({
        objectBodyBytes: BigInt(fixture.rootFrame.byteLength - 1),
      }),
    ));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(fixture.bucket.lookupCount).toBe(1);
    expect(fixture.bucket.bodyAccesses).toBe(0);
    expect(fixture.hashCalls.value).toBe(0);
  });

  it("does not settle earlier byte dimensions when metadata admission fails", async () => {
    const fixture = await makeSemanticFixture("functions/main.js");
    const tracker = budgetTracker({ hashBytes: 0n });
    const exit = await Effect.runPromiseExit(fixture.reader.read(
      fixture.rootDigest,
      fixture.sourceRootDigest,
      tracker,
    ));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(fixture.bucket.bodyAccesses).toBe(0);
    expect(fixture.hashCalls.value).toBe(0);
    expect(tracker.receipt().commandUsage).toMatchObject({
      objectBodyBytes: 0n,
      hashBytes: 0n,
      frameBytes: 0n,
      canonicalBytes: 0n,
    });
  });

  it("fails closed on source-root drift and noncanonical module paths", async () => {
    const fixture = await makeSemanticFixture("../main.js");
    const wrongSource = new Uint8Array(32).fill(0xaa);
    const sourceMismatch = await Effect.runPromiseExit(fixture.reader.read(
      fixture.rootDigest,
      wrongSource,
      budgetTracker(),
    ));
    expect(Exit.isFailure(sourceMismatch)).toBe(true);
    if (Exit.isSuccess(sourceMismatch)) throw new Error("Expected source mismatch.");
    expect(String(sourceMismatch.cause)).toContain(
      "SemanticArtifactV1FinalizedContentCorruptionError",
    );

    fixture.bucket.lookupCount = 0;
    fixture.bucket.bodyAccesses = 0;
    const pathMismatch = await Effect.runPromiseExit(fixture.reader.read(
      fixture.rootDigest,
      fixture.sourceRootDigest,
      budgetTracker(),
    ));
    expect(Exit.isFailure(pathMismatch)).toBe(true);
    if (Exit.isSuccess(pathMismatch)) throw new Error("Expected path mismatch.");
    expect(String(pathMismatch.cause)).toContain(
      "SemanticArtifactV1FinalizedContentCorruptionError",
    );
  });

  it("rejects compensating tree claims that disagree with semantic leaves", async () => {
    const fixture = await makeSemanticFixture(
      "functions/main.js",
      { contradictoryTreeClaims: true },
    );
    const exit = await Effect.runPromiseExit(fixture.reader.read(
      fixture.rootDigest,
      fixture.sourceRootDigest,
      budgetTracker(),
    ));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) throw new Error("Expected range corruption.");
    const error = Cause.findErrorOption(exit.cause);
    expect(error._tag).toBe("Some");
    if (error._tag === "Some") {
      expect(error.value).toMatchObject({
        _tag: "SemanticArtifactV1FinalizedContentCorruptionError",
        reason: "rangeMismatch",
        ordinal: 0n,
      });
    }
  });

  it("classifies hostile and non-intrinsic root digests as typed invalidRoot", async () => {
    const fixture = await makeSemanticFixture("functions/main.js");
    const proxied = new Proxy(new Uint8Array(32), {});
    const revoked = Proxy.revocable(new Uint8Array(32), {});
    revoked.revoke();
    const detached = new Uint8Array(32);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    const invalid = [
      Object.create(Uint8Array.prototype),
      proxied,
      revoked.proxy,
      detached,
      new Uint8Array(31),
    ];
    for (const candidate of invalid) {
      for (const [root, source] of [
        [candidate, fixture.sourceRootDigest],
        [fixture.rootDigest, candidate],
      ] as const) {
        const exit = await Effect.runPromiseExit(
          fixture.reader.read(root, source, budgetTracker()),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isSuccess(exit)) throw new Error("Expected invalid root.");
        const error = Cause.findErrorOption(exit.cause);
        expect(error._tag).toBe("Some");
        if (error._tag === "Some") {
          expect(error.value).toMatchObject({
            _tag: "SemanticArtifactV1FinalizedContentCorruptionError",
            reason: "invalidRoot",
          });
        }
      }
    }
    expect(fixture.bucket.lookupCount).toBe(0);
  });

  it("settles every semantic decoder receipt into cumulative V2 dimensions", async () => {
    const baseline = await makeSemanticFixture("functions/main.js");
    const baselineBudget = budgetTracker();
    await Effect.runPromise(baseline.reader.read(
      baseline.rootDigest,
      baseline.sourceRootDigest,
      baselineBudget,
    ));
    const usage = baselineBudget.receipt().commandUsage;
    expect(usage.tokenBytes).toBe(BigInt(baseline.streamBytes.byteLength));

    for (const dimension of [
      "calls",
      "tokenBytes",
      "canonicalBytes",
      "stringBytes",
      "schemaNodes",
      "nestingDepth",
      "parserStates",
      "tokens",
    ] as const) {
      expect(usage[dimension]).toBeGreaterThan(0n);
      const admitted = dimension === "stringBytes" ||
          dimension === "schemaNodes" ||
          dimension === "nestingDepth"
        ? BigInt(baseline.streamBytes.byteLength)
        : dimension === "tokens"
        ? 3n
        : usage[dimension];

      const exactFixture = await makeSemanticFixture("functions/main.js");
      await Effect.runPromise(exactFixture.reader.read(
        exactFixture.rootDigest,
        exactFixture.sourceRootDigest,
        budgetTracker({ [dimension]: admitted }),
      ));

      const oneLessFixture = await makeSemanticFixture("functions/main.js");
      const exit = await Effect.runPromiseExit(oneLessFixture.reader.read(
        oneLessFixture.rootDigest,
        oneLessFixture.sourceRootDigest,
        budgetTracker({ [dimension]: admitted - 1n }),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error(`Expected one-less ${dimension} failure.`);
      }
      const error = Cause.findErrorOption(exit.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some") {
        expect(error.value).toMatchObject({
          _tag: "DeclarativeV2ContentReadBudgetError",
          reason: "budgetExceeded",
          dimension,
        });
      }
      if (
        dimension === "stringBytes" ||
        dimension === "schemaNodes" ||
        dimension === "nestingDepth" ||
        dimension === "tokens"
      ) {
        expect(oneLessFixture.bucket.bodyAccesses).toBe(1);
      }
    }
  });
});

class SemanticFixtureBucket implements SemanticArtifactV1R2Bucket {
  readonly objects = new Map<string, Uint8Array>();
  lookupCount = 0;
  bodyAccesses = 0;

  put(
    key: string,
    body: ArrayBuffer,
    _options: { readonly onlyIf: { readonly etagDoesNotMatch: string } },
  ): PromiseLike<unknown> {
    if (!this.objects.has(key)) {
      this.objects.set(key, copyBytes(new Uint8Array(body)));
    }
    return Promise.resolve({});
  }

  get(key: string): PromiseLike<unknown> {
    this.lookupCount += 1;
    const bytes = this.objects.get(key);
    if (bytes === undefined) return Promise.resolve(null);
    const owner = this;
    return Promise.resolve(Object.defineProperties({}, {
      size: { enumerable: true, value: bytes.byteLength },
      body: {
        enumerable: true,
        get() {
          owner.bodyAccesses += 1;
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(copyBytes(bytes));
              controller.close();
            },
          });
        },
      },
    }));
  }
}

async function makeSemanticFixture(
  modulePath: string,
  options: Readonly<{ readonly contradictoryTreeClaims?: boolean }> = {},
) {
  const bucket = new SemanticFixtureBucket();
  const hashCalls = { value: 0 };
  const sha256 = makeSemanticArtifactV1Sha256(input => {
    hashCalls.value += 1;
    return webcrypto.subtle.digest("SHA-256", input);
  });
  const store = makeSemanticArtifactV1R2Store(bucket, sha256);
  const streamBytes = new TextEncoder().encode(
    `{"kind":"header","version":1}\n` +
      `{"kind":"module","modulePath":${JSON.stringify(modulePath)}}\n` +
      `{"kind":"schema","schemaVersion":"1"}\n`,
  );
  let blockCount = 1n;
  let treeRootSha256: Uint8Array;
  if (options.contradictoryTreeClaims === true) {
    const split = streamBytes.indexOf(0x0a) + 1;
    const firstBytes = streamBytes.slice(0, split);
    const secondBytes = streamBytes.slice(split);
    const firstFrame = encode({
      kind: "semantic_block",
      blockOrdinal: 0n,
      firstByteOffset: 0n,
      bodyBytes: firstBytes,
      lineFeedCount: 1n,
    });
    const secondFrame = encode({
      kind: "semantic_block",
      blockOrdinal: 1n,
      firstByteOffset: BigInt(firstBytes.byteLength),
      bodyBytes: secondBytes,
      lineFeedCount: 2n,
    });
    const firstDigest = await digest(sha256, firstFrame);
    const secondDigest = await digest(sha256, secondFrame);
    await put(store, "block", firstDigest, firstFrame);
    await put(store, "block", secondDigest, secondFrame);
    const treeFrame = encode({
      kind: "semantic_tree",
      children: [
        {
          firstBlockOrdinal: 0n,
          blockCount: 1n,
          firstByteOffset: 0n,
          byteLength: BigInt(firstBytes.byteLength + 1),
          lineFeedCount: 2n,
          sha256: firstDigest,
        },
        {
          firstBlockOrdinal: 1n,
          blockCount: 1n,
          firstByteOffset: BigInt(firstBytes.byteLength + 1),
          byteLength: BigInt(secondBytes.byteLength - 1),
          lineFeedCount: 1n,
          sha256: secondDigest,
        },
      ],
    });
    treeRootSha256 = await digest(sha256, treeFrame);
    await put(store, "tree", treeRootSha256, treeFrame);
    blockCount = 2n;
  } else {
    const blockFrame = encode({
      kind: "semantic_block",
      blockOrdinal: 0n,
      firstByteOffset: 0n,
      bodyBytes: streamBytes,
      lineFeedCount: 3n,
    });
    treeRootSha256 = await digest(sha256, blockFrame);
    await put(store, "block", treeRootSha256, blockFrame);
  }

  const sourceRootDigest = new Uint8Array(32).fill(0x19);
  const rootFrame = encode({
    kind: "semantic_root",
    sourceArtifactCodecVersion: 1,
    sourceRootSha256: sourceRootDigest,
    semanticModelIdentity: "semantic-model-v1",
    semanticCodecIdentity: "semantic-codec-v1",
    semanticPolicyIdentity: "semantic-policy-v1",
    coreLanguageIdentity: "FlarexDeclarativeExecutableCoreV1",
    abiIdentity: "abi-v1",
    grammarIdentity: "grammar-v1",
    unicodeIdentity: "unicode-14",
    parserTableIdentity: "parser-table-v1",
    trustedToolingIdentity: "tooling-v1",
    ingressProtocolIdentity: "semantic-ingress-v1",
    ingressConfigurationIdentity: "semantic-ingress-config-v1",
    blockCount,
    streamByteLength: BigInt(streamBytes.byteLength),
    recordCount: 3n,
    treeRootSha256,
  });
  const rootDigest = await digest(sha256, rootFrame);
  await put(store, "root", rootDigest, rootFrame);
  bucket.lookupCount = 0;
  bucket.bodyAccesses = 0;
  hashCalls.value = 0;
  return {
    bucket,
    hashCalls,
    reader: makeSemanticArtifactV1FinalizedContentReader({ r2: store }),
    rootDigest,
    rootFrame,
    sourceRootDigest,
    streamBytes,
  };
}

function encode(
  frame: Parameters<typeof encodeDeclarativeV2SemanticArtifactFrameV1>[0],
): Uint8Array {
  const result = encodeDeclarativeV2SemanticArtifactFrameV1(
    frame,
    FRAME_BUDGET,
  );
  if (Result.isFailure(result)) throw result.failure;
  return result.success.canonicalBytes;
}

async function put(
  store: ReturnType<typeof makeSemanticArtifactV1R2Store>,
  kind: Parameters<typeof store.putImmutable>[0],
  digestBytes: Uint8Array,
  bytes: Uint8Array,
) {
  await Effect.runPromise(store.putImmutable(kind, digestBytes, bytes, {
    maximumCalls: 6,
    maximumBodyBytes: bytes.byteLength * 5,
    maximumHashBytes: bytes.byteLength * 2,
  }));
}

async function digest(
  sha256: SemanticArtifactV1Sha256,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  return await Effect.runPromise(sha256(bytes, {
    maximumInputBytes: bytes.byteLength,
  }));
}

function budgetTracker(
  overrides: Partial<Record<
    (typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2)[number],
    bigint
  >> = {},
) {
  const result = makeDeclarativeV2ContentReadBudgetTracker({
    ceilings: budgetFrame("attempt_ceilings", overrides),
    usage: budgetFrame("attempt_usage", {}, 0n),
    command: budgetFrame("command_budget", overrides),
  });
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function budgetFrame(
  kind: DeclarativeV2VerifierBudgetFrameV2["kind"],
  overrides: Partial<Record<
    (typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2)[number],
    bigint
  >>,
  fallback = 1_000_000n,
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze(Object.fromEntries([
    ["kind", kind],
    ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
      dimension,
      overrides[dimension] ?? fallback,
    ]),
  ])) as DeclarativeV2VerifierBudgetFrameV2;
}
