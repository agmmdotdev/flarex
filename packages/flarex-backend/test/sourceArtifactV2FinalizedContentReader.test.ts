import { copyBytes } from "@flarex/utils/bytes";
import { Cause, Effect, Exit, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { describe, expect, it } from "vitest";

import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  sourceArtifactV2BlockFrame,
  sourceArtifactV2CompletedRootFrame,
  sourceArtifactV2ModuleFrame,
} from "../src/sourceArtifactV2/Framing";
import {
  makeDeclarativeV2ContentReadBudgetTracker,
  makeSourceArtifactV2FinalizedContentReader,
} from "../src/sourceArtifactV2/FinalizedContentReader";
import {
  makeSourceArtifactV2R2Store,
  type SourceArtifactV2R2Bucket,
} from "../src/sourceArtifactV2/R2Store";
import {
  makeSourceArtifactV2Sha256,
  type SourceArtifactV2Sha256,
} from "../src/sourceArtifactV2/Sha256";

const FRAME_BUDGET = { maximumFrameBytesMaterialized: 100_000 };

describe("Source Artifact V2 finalized content reader", () => {
  it("reads one canonical module through metadata-first admitted R2 access", async () => {
    const fixture = await makeSourceFixture();
    const tracker = budgetTracker();
    const content = await Effect.runPromise(
      fixture.reader.read(fixture.rootDigest, tracker),
    );
    expect(content.root.moduleCount).toBe(1n);
    expect(content.modules).toHaveLength(1);
    expect(content.modules[0]).toMatchObject({
      ordinal: 0,
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION |
        SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
    });
    expect(content.modules[0]!.pathBytes).toEqual(
      new TextEncoder().encode("functions/main.js"),
    );
    expect(content.modules[0]!.sourceBytes).toEqual(
      new TextEncoder().encode("export default function main() {}"),
    );
    expect(fixture.bucket.bodyAccesses).toBe(3);
    expect(fixture.bucket.lookupCount).toBe(3);
    expect(Object.isFrozen(content)).toBe(true);
    expect(Object.isFrozen(content.modules)).toBe(true);
  });

  it("rejects a one-less metadata budget before body access and hashing", async () => {
    const fixture = await makeSourceFixture();
    fixture.bucket.bodyAccesses = 0;
    fixture.bucket.lookupCount = 0;
    fixture.hashCalls.value = 0;
    const tracker = budgetTracker({
      objectBodyBytes: BigInt(fixture.rootFrame.byteLength - 1),
    });
    const exit = await Effect.runPromiseExit(
      fixture.reader.read(fixture.rootDigest, tracker),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(fixture.bucket.lookupCount).toBe(1);
    expect(fixture.bucket.bodyAccesses).toBe(0);
    expect(fixture.hashCalls.value).toBe(0);
  });

  it("does not settle earlier byte dimensions when metadata admission fails", async () => {
    const fixture = await makeSourceFixture();
    const tracker = budgetTracker({ hashBytes: 0n });
    const exit = await Effect.runPromiseExit(
      fixture.reader.read(fixture.rootDigest, tracker),
    );
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

  it("fails closed on a noncanonical module path without minting path authority", async () => {
    const fixture = await makeSourceFixture("../main.js");
    const exit = await Effect.runPromiseExit(
      fixture.reader.read(fixture.rootDigest, budgetTracker()),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) throw new Error("Expected invalid path failure.");
    expect(String(exit.cause)).toContain(
      "SourceArtifactV2FinalizedContentCorruptionError",
    );
  });

  it("classifies hostile and non-intrinsic root digests as typed invalidRoot", async () => {
    const fixture = await makeSourceFixture();
    const proxied = new Proxy(new Uint8Array(32), {});
    const revoked = Proxy.revocable(new Uint8Array(32), {});
    revoked.revoke();
    const detached = new Uint8Array(32);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    for (const candidate of [
      Object.create(Uint8Array.prototype),
      proxied,
      revoked.proxy,
      detached,
      new Uint8Array(31),
    ]) {
      const exit = await Effect.runPromiseExit(
        fixture.reader.read(candidate, budgetTracker()),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) throw new Error("Expected invalid root.");
      const error = Cause.findErrorOption(exit.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some") {
        expect(error.value).toMatchObject({
          _tag: "SourceArtifactV2FinalizedContentCorruptionError",
          reason: "invalidRoot",
        });
      }
    }
    expect(fixture.bucket.lookupCount).toBe(0);
  });
});

class SourceFixtureBucket implements SourceArtifactV2R2Bucket {
  readonly objects = new Map<string, Uint8Array>();
  lookupCount = 0;
  bodyAccesses = 0;

  put(
    key: string,
    value: ArrayBuffer,
    _options: { readonly onlyIf: { readonly etagDoesNotMatch: string } },
  ): PromiseLike<unknown> {
    if (!this.objects.has(key)) {
      this.objects.set(key, copyBytes(new Uint8Array(value)));
    }
    return Promise.resolve({});
  }

  get(key: string): PromiseLike<unknown> {
    this.lookupCount += 1;
    const bytes = this.objects.get(key);
    if (bytes === undefined) return Promise.resolve(null);
    const owner = this;
    return Promise.resolve(Object.defineProperties({}, {
      size: {
        enumerable: true,
        value: bytes.byteLength,
      },
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

async function makeSourceFixture(path = "functions/main.js") {
  const bucket = new SourceFixtureBucket();
  const hashCalls = { value: 0 };
  const sha256 = makeSourceArtifactV2Sha256(input => {
    hashCalls.value += 1;
    return crypto.subtle.digest("SHA-256", input);
  });
  const store = makeSourceArtifactV2R2Store(bucket, sha256);
  const sourceBytes = new TextEncoder().encode(
    "export default function main() {}",
  );
  const sourceFrame = success(sourceArtifactV2BlockFrame(
    "source",
    0n,
    sourceBytes,
    FRAME_BUDGET,
  )).bytes;
  const sourceDigest = await digest(sha256, sourceFrame);
  await put(store, "source-block", sourceDigest, sourceFrame);

  const moduleFrame = success(sourceArtifactV2ModuleFrame({
    ordinal: 0n,
    path,
    roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION |
      SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
    sourceByteLength: BigInt(sourceBytes.byteLength),
    sourceBlockCount: 1n,
    sourceTreeDigest: sourceDigest,
    sourceMapByteLength: 0n,
    sourceMapBlockCount: 0n,
    sourceMapTreeDigest: null,
  }, FRAME_BUDGET)).bytes;
  const moduleDigest = await digest(sha256, moduleFrame);
  await put(store, "module", moduleDigest, moduleFrame);

  const rootFrame = success(sourceArtifactV2CompletedRootFrame({
    moduleCount: 1n,
    functionModuleCount: 1n,
    totalSourceBytes: BigInt(sourceBytes.byteLength),
    totalSourceMapBytes: 0n,
    moduleTreeDigest: moduleDigest,
    executionPath: path,
    schemaPath: null,
    authPath: null,
  }, FRAME_BUDGET)).bytes;
  const rootDigest = await digest(sha256, rootFrame);
  await put(store, "completed-root", rootDigest, rootFrame);
  bucket.lookupCount = 0;
  bucket.bodyAccesses = 0;
  hashCalls.value = 0;
  return {
    bucket,
    hashCalls,
    rootDigest,
    rootFrame,
    reader: makeSourceArtifactV2FinalizedContentReader({ r2: store }),
  };
}

async function put(
  store: ReturnType<typeof makeSourceArtifactV2R2Store>,
  kind: Parameters<typeof store.putImmutable>[0],
  digestBytes: Uint8Array,
  bytes: Uint8Array,
) {
  await Effect.runPromise(store.putImmutable(kind, digestBytes, bytes, {
    maximumBodyBytes: bytes.byteLength,
    maximumHashBytes: bytes.byteLength,
  }));
}

async function digest(
  sha256: SourceArtifactV2Sha256,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  return await Effect.runPromise(sha256(bytes, {
    maximumInputBytes: bytes.byteLength,
  }));
}

function success<A, E>(value: Result.Result<A, E>): A {
  if (Result.isFailure(value)) throw value.failure;
  return value.success;
}

function budgetTracker(
  overrides: Partial<Record<
    (typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2)[number],
    bigint
  >> = {},
) {
  const ceilings = budgetFrame("attempt_ceilings", overrides);
  const command = budgetFrame("command_budget", overrides);
  const usage = budgetFrame("attempt_usage", {}, 0n);
  const result = makeDeclarativeV2ContentReadBudgetTracker({
    ceilings,
    usage,
    command,
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
