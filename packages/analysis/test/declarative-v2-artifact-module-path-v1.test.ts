import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Result } from "effect";
import {
  decodeDeclarativeV2ArtifactModulePathV1,
} from "flarex-protocol/internal/declarative-v2-artifact-module-path-v1";
import { describe, expect, test } from "vitest";

import {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATH_MAX_ADDRESSABLE_BYTES_V1,
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  makeDeclarativeV2ArtifactModulePathFactoryV1,
  type DeclarativeV2ArtifactModulePathV1Error,
  type DeclarativeV2ArtifactModulePathFactoryV1,
  type DeclarativeV2ArtifactModulePathHandleV1,
} from "../src/declarativeV2ArtifactModulePathV1";

const UTF8_ENCODER = new TextEncoder();
const PACKAGE_ROOT = resolve(import.meta.dirname, "..");

function createPath(
  spelling: string,
  factory: DeclarativeV2ArtifactModulePathFactoryV1 =
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  chunks: ReadonlyArray<Uint8Array> = [UTF8_ENCODER.encode(spelling)],
  maximumBytes = UTF8_ENCODER.encode(spelling).byteLength,
): Result.Result<
  DeclarativeV2ArtifactModulePathHandleV1,
  DeclarativeV2ArtifactModulePathV1Error
> {
  const created = factory.create(chunks.length + 2, maximumBytes, maximumBytes);
  if (Result.isFailure(created)) return Result.fail(created.failure);
  for (const chunk of chunks) {
    const stepped = factory.step(created.success, chunk, 1_024);
    if (Result.isFailure(stepped)) return Result.fail(stepped.failure);
    if (stepped.success.consumedBytes !== chunk.byteLength) {
      throw new Error("test module-path driver did not consume its chunk");
    }
  }
  const finished = factory.finish(created.success, 1);
  if (Result.isFailure(finished)) return Result.fail(finished.failure);
  if ("status" in finished.success) {
    throw new Error("test module-path driver unexpectedly remained pending");
  }
  return Result.succeed(finished.success);
}

function ownedBytes(
  handle: DeclarativeV2ArtifactModulePathHandleV1,
  factory: DeclarativeV2ArtifactModulePathFactoryV1 =
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
): Uint8Array {
  const length = factory.byteLength(handle);
  if (Result.isFailure(length)) throw length.failure;
  const bytes = new Uint8Array(length.success);
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = factory.byteAt(handle, index);
    if (Result.isFailure(byte) || byte.success === undefined) {
      throw new Error("test module-path reader lost an owned byte");
    }
    bytes[index] = byte.success;
  }
  return bytes;
}

describe("Declarative V2 artifact module path V1", () => {
  test.each([
    "a.js",
    "functions/example.js",
    "functions/မြန်မာ.js",
    "é/λ",
  ])("retains the exact canonical spelling for %s", (spelling) => {
    const encoded = UTF8_ENCODER.encode(spelling);
    for (let split = 0; split <= encoded.byteLength; split += 1) {
      const result = createPath(
        spelling,
        DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
        [encoded.subarray(0, split), encoded.subarray(split)],
      );
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(ownedBytes(result.success)).toEqual(encoded);
      }
    }
  });

  test.each([
    "",
    "/a.js",
    "a.js/",
    "a//b.js",
    "./a.js",
    "../a.js",
    "a/./b.js",
    "a/../b.js",
    ".",
    "..",
    String.raw`a\b.js`,
  ])("rejects the noncanonical spelling %j", (spelling) => {
    const result = createPath(spelling);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe("invalidPath");
    }
  });

  test.each([
    "a.js",
    "functions/example.js",
    "functions/မြန်မာ.js",
    "é/λ",
    "",
    "/a.js",
    "a.js/",
    "a//b.js",
    "./a.js",
    "../a.js",
    "a/./b.js",
    "a/../b.js",
    ".",
    "..",
    String.raw`a\b.js`,
  ])("matches the protocol string verdict for %j", (spelling) => {
    const incremental = createPath(spelling);
    const protocol = decodeDeclarativeV2ArtifactModulePathV1(spelling);
    expect(Result.isSuccess(incremental)).toBe(Result.isSuccess(protocol));
    if (Result.isSuccess(incremental) && Result.isSuccess(protocol)) {
      expect(new TextDecoder("utf-8", { fatal: true }).decode(
        ownedBytes(incremental.success),
      )).toBe(protocol.success);
    }
  });

  test.each(["a/\ud800", "\ud800"])(
    "rejects the ill-formed source spelling %j before UTF-8 normalization",
    (spelling) => {
      expect(Result.isFailure(
        decodeDeclarativeV2ArtifactModulePathV1(spelling),
      )).toBe(true);
      expect(new TextDecoder().decode(UTF8_ENCODER.encode(spelling))).not.toBe(
        spelling,
      );
    },
  );

  test.each([
    new Uint8Array([0x80]),
    new Uint8Array([0xc0, 0x80]),
    new Uint8Array([0xe0, 0x80, 0x80]),
    new Uint8Array([0xed, 0xa0, 0x80]),
    new Uint8Array([0xf4, 0x90, 0x80, 0x80]),
    new Uint8Array([0xf0, 0x9f, 0x92]),
  ])("rejects malformed or truncated UTF-8 %#", (bytes) => {
    const created = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
      3,
      bytes.byteLength,
      bytes.byteLength,
    );
    if (Result.isFailure(created)) throw created.failure;
    const stepped = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
      created.success,
      bytes,
      1_024,
    );
    if (Result.isFailure(stepped)) {
      expect(stepped.failure.reason).toBe("invalidPath");
      return;
    }
    const finished = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.finish(
      created.success,
      1,
    );
    expect(Result.isFailure(finished)).toBe(true);
    if (Result.isFailure(finished)) {
      expect(finished.failure.reason).toBe("invalidPath");
    }
  });

  test("uses exact byte and call ceilings with zero/one/max allowances", () => {
    const bytes = UTF8_ENCODER.encode("a.js");
    const created = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
      4,
      bytes.byteLength,
      bytes.byteLength,
    );
    if (Result.isFailure(created)) throw created.failure;
    const zero = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
      created.success,
      bytes,
      0,
    );
    if (Result.isFailure(zero)) throw zero.failure;
    expect(zero.success).toMatchObject({
      consumedBytes: 0,
      transitionCount: 0,
    });
    expect(zero.success.deltaUsage).toEqual({
      calls: 0n,
      stringBytes: 0n,
      outputBytes: 0n,
      transitions: 0n,
    });
    const one = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
      created.success,
      bytes,
      1,
    );
    if (Result.isFailure(one)) throw one.failure;
    expect(one.success).toMatchObject({
      consumedBytes: 1,
      transitionCount: 1,
    });
    const rest = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
      created.success,
      bytes.subarray(1),
      1_024,
    );
    if (Result.isFailure(rest)) throw rest.failure;
    expect(rest.success.usage).toMatchObject({
      calls: 3n,
      stringBytes: BigInt(bytes.byteLength),
      outputBytes: BigInt(bytes.byteLength),
      transitions: BigInt(bytes.byteLength),
    });
    const pending = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.finish(
      created.success,
      0,
    );
    expect(pending).toMatchObject({
      success: {
        status: "pending",
        transitionCount: 0,
      },
    });
    const finished = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.finish(
      created.success,
      1,
    );
    expect(Result.isSuccess(finished)).toBe(true);
    if (Result.isSuccess(finished) && !("status" in finished.success)) {
      expect(
        DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.usage(finished.success),
      ).toEqual(Result.succeed({
        calls: 4n,
        stringBytes: BigInt(bytes.byteLength),
        outputBytes: BigInt(bytes.byteLength),
        transitions: BigInt(bytes.byteLength + 1),
      }));
    }

    const exhaustedCalls = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
      2,
      bytes.byteLength,
      bytes.byteLength,
    );
    if (Result.isFailure(exhaustedCalls)) throw exhaustedCalls.failure;
    const exactStep = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
      exhaustedCalls.success,
      bytes,
      1_024,
    );
    if (Result.isFailure(exactStep)) throw exactStep.failure;
    expect(
      DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.finish(
        exhaustedCalls.success,
        1,
      ),
    ).toMatchObject({
      failure: {
        reason: "budgetExceeded",
        dimension: "calls",
        observed: 3n,
        maximum: 2n,
      },
    });

    const invalidAllowance = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
      3,
      bytes.byteLength,
      bytes.byteLength,
    );
    if (Result.isFailure(invalidAllowance)) throw invalidAllowance.failure;
    const rejected = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
      invalidAllowance.success,
      bytes,
      1_025,
    );
    expect(Result.isFailure(rejected)).toBe(true);
    expect(
      DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
        invalidAllowance.success,
        bytes,
        1,
      ),
    ).toMatchObject({
      failure: { reason: "closed" },
    });
  });

  test.each(["stringBytes", "outputBytes"] as const)(
    "precharges the %s exact-plus-one boundary",
    (dimension) => {
      const bytes = UTF8_ENCODER.encode("a.js");
      const maximumStringBytes = dimension === "stringBytes"
        ? bytes.byteLength - 1
        : bytes.byteLength;
      const maximumOutputBytes = dimension === "outputBytes"
        ? bytes.byteLength - 1
        : bytes.byteLength;
      const created = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
        3,
        maximumStringBytes,
        maximumOutputBytes,
      );
      if (Result.isFailure(created)) throw created.failure;
      const stepped = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
        created.success,
        bytes,
        1_024,
      );
      expect(Result.isFailure(stepped)).toBe(true);
      if (Result.isFailure(stepped)) {
        expect(stepped.failure).toMatchObject({
          operation: "step",
          reason: "budgetExceeded",
          dimension,
          observed: BigInt(bytes.byteLength),
          maximum: BigInt(bytes.byteLength - 1),
        });
      }
    },
  );

  test.each(["stringBytes", "outputBytes"] as const)(
    "pins the %s representation ceiling before allocation",
    (dimension) => {
      const exact = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
        1,
        dimension === "stringBytes"
          ? DECLARATIVE_V2_ARTIFACT_MODULE_PATH_MAX_ADDRESSABLE_BYTES_V1
          : 0,
        dimension === "outputBytes"
          ? DECLARATIVE_V2_ARTIFACT_MODULE_PATH_MAX_ADDRESSABLE_BYTES_V1
          : 0,
      );
      expect(Result.isSuccess(exact)).toBe(true);
      const plusOne = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
        1,
        dimension === "stringBytes"
          ? DECLARATIVE_V2_ARTIFACT_MODULE_PATH_MAX_ADDRESSABLE_BYTES_V1 + 1
          : 0,
        dimension === "outputBytes"
          ? DECLARATIVE_V2_ARTIFACT_MODULE_PATH_MAX_ADDRESSABLE_BYTES_V1 + 1
          : 0,
      );
      expect(plusOne).toMatchObject({
        failure: {
          operation: "create",
          reason: "addressabilityExceeded",
          dimension,
          observed: BigInt(
            DECLARATIVE_V2_ARTIFACT_MODULE_PATH_MAX_ADDRESSABLE_BYTES_V1 + 1,
          ),
          maximum: BigInt(
            DECLARATIVE_V2_ARTIFACT_MODULE_PATH_MAX_ADDRESSABLE_BYTES_V1,
          ),
        },
      });
    },
  );

  test("keeps host allocation failure in the typed boundary", () => {
    const result = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
      1,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    expect(result).toMatchObject({
      failure: {
        operation: "create",
        reason: "addressabilityExceeded",
        dimension: "outputBytes",
      },
    });
  });

  test("keeps composed and decomposed Unicode spellings distinct", () => {
    const composed = createPath("é.js");
    const decomposed = createPath("e\u0301.js");
    if (Result.isFailure(composed)) throw composed.failure;
    if (Result.isFailure(decomposed)) throw decomposed.failure;
    expect(ownedBytes(composed.success)).not.toEqual(
      ownedBytes(decomposed.success),
    );
  });

  test("has byte-identical restart, replay, and two-cold receipts", () => {
    const first = createPath("functions/replay.js");
    const second = createPath("functions/replay.js");
    if (Result.isFailure(first)) throw first.failure;
    if (Result.isFailure(second)) throw second.failure;
    expect(ownedBytes(first.success)).toEqual(ownedBytes(second.success));
    expect(
      DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.usage(first.success),
    ).toEqual(
      DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.usage(second.success),
    );
  });

  test("owns bytes and rejects forged, copied, revoked, and cross-factory handles", () => {
    const bytes = UTF8_ENCODER.encode("functions/owned.js");
    const created = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
      3,
      bytes.byteLength,
      bytes.byteLength,
    );
    if (Result.isFailure(created)) throw created.failure;
    const stepped = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
      created.success,
      bytes,
      1_024,
    );
    if (Result.isFailure(stepped)) throw stepped.failure;
    bytes.fill(0x78);
    const finished = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.finish(
      created.success,
      1,
    );
    if (Result.isFailure(finished) || "status" in finished.success) {
      throw new Error("owned path did not finish");
    }
    expect(new TextDecoder().decode(ownedBytes(finished.success))).toBe(
      "functions/owned.js",
    );
    expect(
      DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.capture({
        _tag: "DeclarativeV2ArtifactModulePathHandleV1",
      }),
    ).toMatchObject({ failure: { reason: "invalidInput" } });
    expect(
      DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.capture({
        ...finished.success,
      }),
    ).toMatchObject({ failure: { reason: "invalidInput" } });
    const foreignFactory = makeDeclarativeV2ArtifactModulePathFactoryV1();
    const foreign = createPath("foreign.js", foreignFactory);
    if (Result.isFailure(foreign)) throw foreign.failure;
    expect(
      DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.capture(foreign.success),
    ).toMatchObject({ failure: { reason: "invalidInput" } });
    const revoked = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.revoke(
      finished.success,
    );
    if (Result.isFailure(revoked)) throw revoked.failure;
    expect(
      DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.byteLength(finished.success),
    ).toMatchObject({ failure: { reason: "closed" } });
  });

  test("fails hostile byte proxies and accessor-bearing handle impostors without dispatch", () => {
    const bytes = UTF8_ENCODER.encode("hostile.js");
    const created = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
      3,
      bytes.byteLength,
      bytes.byteLength,
    );
    if (Result.isFailure(created)) throw created.failure;
    const proxied = new Proxy(bytes, {});
    expect(
      DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
        created.success,
        proxied,
        1,
      ),
    ).toMatchObject({ failure: { reason: "invalidInput" } });

    let reads = 0;
    const impostor = Object.defineProperty({}, "_tag", {
      get() {
        reads += 1;
        throw new Error("must not dispatch");
      },
    });
    expect(
      DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.capture(impostor),
    ).toMatchObject({ failure: { reason: "invalidInput" } });
    expect(reads).toBe(0);
  });

  test("keeps source and semantic spellings unequal unless every byte matches", () => {
    const source = createPath("functions/source.js");
    const matchingSemantic = createPath("functions/source.js");
    const mismatchingSemantic = createPath("functions/semantic.js");
    if (
      Result.isFailure(source) ||
      Result.isFailure(matchingSemantic) ||
      Result.isFailure(mismatchingSemantic)
    ) {
      throw new Error("comparison fixtures did not validate");
    }
    expect(ownedBytes(source.success)).toEqual(
      ownedBytes(matchingSemantic.success),
    );
    expect(ownedBytes(source.success)).not.toEqual(
      ownedBytes(mismatchingSemantic.success),
    );
  });

  test("is package-private and uses no path-normalization helper", async () => {
    const [source, root, internal] = await Promise.all([
      readFile(
        resolve(
          PACKAGE_ROOT,
          "src/declarativeV2ArtifactModulePathV1.ts",
        ),
        "utf8",
      ),
      readFile(resolve(PACKAGE_ROOT, "src/index.ts"), "utf8"),
      readFile(
        resolve(PACKAGE_ROOT, "src/declarativeV2VerifierV1.ts"),
        "utf8",
      ),
    ]);
    expect(root).not.toContain("declarativeV2ArtifactModulePathV1");
    expect(root).not.toContain("DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1");
    expect(internal).toContain("DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1");
    expect(internal).toContain("makeDeclarativeV2ArtifactModulePathFactoryV1");
    expect(source).not.toMatch(/\.normalize\s*\(/u);
    expect(source).not.toContain("path.normalize");
    expect(source).not.toContain("TextDecoder");
    expect(source).not.toMatch(/\.split\s*\(/u);
    expect(source).not.toMatch(/\.join\s*\(/u);
  });
});
