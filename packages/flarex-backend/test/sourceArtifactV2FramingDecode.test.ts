import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeSourceArtifactV2BlockFrame,
  decodeSourceArtifactV2CompletedRootFrame,
  decodeSourceArtifactV2ModuleFrame,
  decodeSourceArtifactV2TreeNodeFrame,
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  SOURCE_ARTIFACT_V2_SIGNED_INT64_MAX,
  sourceArtifactV2BlockFrame,
  sourceArtifactV2CompletedRootFrame,
  sourceArtifactV2ModuleFrame,
  sourceArtifactV2TreeNodeFrame,
  type SourceArtifactV2FrameDecodeBudget,
  type SourceArtifactV2FrameDecodeError,
} from "../src/sourceArtifactV2/Framing";

const FRAME_BUDGET = { maximumFrameBytesMaterialized: 100_000 };
const DECODE_BUDGET = {
  maximumInputBytesMaterialized: 100_000,
  maximumCanonicalBytesMaterialized: 100_000,
  maximumFrameBytesMaterialized: 100_000,
} satisfies SourceArtifactV2FrameDecodeBudget;
const DIGEST_A = new Uint8Array(32).fill(0x11);
const DIGEST_B = new Uint8Array(32).fill(0x22);

describe("source artifact v2 persisted frame decoders", () => {
  it("round-trips all five stored frame families through their sole builders", () => {
    const source = frame(sourceArtifactV2BlockFrame(
      "source", SOURCE_ARTIFACT_V2_SIGNED_INT64_MAX, Uint8Array.of(1, 2, 3), FRAME_BUDGET,
    ));
    const sourceMap = frame(sourceArtifactV2BlockFrame(
      "sourceMap", 0n, Uint8Array.of(4, 5), FRAME_BUDGET,
    ));
    const tree = frame(sourceArtifactV2TreeNodeFrame(
      "module",
      { firstOrdinal: 0n, count: 1n, digest: DIGEST_A },
      { firstOrdinal: 1n, count: 2n, digest: DIGEST_B },
      FRAME_BUDGET,
    ));
    const module = frame(sourceArtifactV2ModuleFrame({
      ordinal: 0n,
      path: "mod\u0000\ud83d\ude00",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION | SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
      sourceByteLength: 3n,
      sourceBlockCount: 1n,
      sourceTreeDigest: DIGEST_A,
      sourceMapByteLength: 2n,
      sourceMapBlockCount: 1n,
      sourceMapTreeDigest: DIGEST_B,
    }, FRAME_BUDGET));
    const root = frame(sourceArtifactV2CompletedRootFrame({
      moduleCount: 2n,
      functionModuleCount: 1n,
      totalSourceBytes: 3n,
      totalSourceMapBytes: 2n,
      moduleTreeDigest: DIGEST_A,
      executionPath: "mod\u0000\ud83d\ude00",
      schemaPath: "schema.js",
      authPath: null,
    }, FRAME_BUDGET));

    const decodedSource = decoded(decodeSourceArtifactV2BlockFrame(
      "source", source, DECODE_BUDGET,
    ));
    expect(decodedSource.value).toMatchObject({
      kind: "source",
      blockIndex: SOURCE_ARTIFACT_V2_SIGNED_INT64_MAX,
    });
    expect([...decodedSource.value.bytes]).toEqual([1, 2, 3]);
    expect(decoded(decodeSourceArtifactV2BlockFrame(
      "sourceMap", sourceMap, DECODE_BUDGET,
    )).value.kind).toBe("sourceMap");
    expect(decoded(decodeSourceArtifactV2TreeNodeFrame(
      "module", tree, DECODE_BUDGET,
    )).value).toMatchObject({ totalCount: 3n, right: { firstOrdinal: 1n, count: 2n } });
    expect(decoded(decodeSourceArtifactV2ModuleFrame(module, DECODE_BUDGET)).value)
      .toMatchObject({ path: "mod\u0000\ud83d\ude00", environment: "isolate" });
    expect(decoded(decodeSourceArtifactV2CompletedRootFrame(root, DECODE_BUDGET)).value)
      .toMatchObject({ executionPath: "mod\u0000\ud83d\ude00", schemaPath: "schema.js" });
  });

  it("charges exact cumulative input, canonical, and re-encoded frame bytes", () => {
    const bytes = frame(sourceArtifactV2ModuleFrame({
      ordinal: 0n,
      path: "a",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      sourceByteLength: 1n,
      sourceBlockCount: 1n,
      sourceTreeDigest: DIGEST_A,
      sourceMapByteLength: 0n,
      sourceMapBlockCount: 0n,
      sourceMapTreeDigest: null,
    }, FRAME_BUDGET));
    const exact = {
      maximumInputBytesMaterialized: bytes.byteLength,
      maximumCanonicalBytesMaterialized: 6,
      maximumFrameBytesMaterialized: bytes.byteLength,
    } satisfies SourceArtifactV2FrameDecodeBudget;
    expect(decoded(decodeSourceArtifactV2ModuleFrame(bytes, exact)).receipt).toEqual({
      inputBytesMaterialized: bytes.byteLength,
      canonicalBytesMaterialized: 6,
      frameBytesMaterialized: bytes.byteLength,
    });
    for (const budget of [
      { ...exact, maximumInputBytesMaterialized: bytes.byteLength - 1 },
      { ...exact, maximumCanonicalBytesMaterialized: 5 },
      { ...exact, maximumFrameBytesMaterialized: bytes.byteLength - 1 },
    ]) expect(failed(decodeSourceArtifactV2ModuleFrame(bytes, budget)).reason).toBe("invalidBudget");
    expect(failed(decodeSourceArtifactV2ModuleFrame(bytes, {
      ...exact,
      maximumCanonicalBytesMaterialized: -1,
    })).reason).toBe("invalidBudget");
  });

  it("rejects every truncated prefix and any trailing byte for every stored family", () => {
    const frames = fixtures();
    const decoders: ReadonlyArray<(
      bytes: Uint8Array,
    ) => Result.Result<unknown, SourceArtifactV2FrameDecodeError>> = [
      (bytes: Uint8Array) => decodeSourceArtifactV2BlockFrame("source", bytes, DECODE_BUDGET),
      (bytes: Uint8Array) => decodeSourceArtifactV2BlockFrame("sourceMap", bytes, DECODE_BUDGET),
      (bytes: Uint8Array) => decodeSourceArtifactV2TreeNodeFrame("source", bytes, DECODE_BUDGET),
      (bytes: Uint8Array) => decodeSourceArtifactV2ModuleFrame(bytes, DECODE_BUDGET),
      (bytes: Uint8Array) => decodeSourceArtifactV2CompletedRootFrame(bytes, DECODE_BUDGET),
    ];
    for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
      const bytes = frames[frameIndex]!;
      const decode = decoders[frameIndex]!;
      for (let length = 0; length < bytes.byteLength; length += 1) {
        expect(Result.isFailure(decode(bytes.slice(0, length)))).toBe(true);
      }
      expect(failed(decode(concat(bytes, Uint8Array.of(0)))).reason).toBe("trailingBytes");
    }
  });

  it("rejects wrong domains, kinds, versions, tags, counters, and redundant ranges", () => {
    const [source, sourceMap, tree, module, root] = fixtures();
    expect(failed(decodeSourceArtifactV2BlockFrame("source", sourceMap, DECODE_BUDGET)).reason)
      .toBe("wrongDomain");
    expect(failed(decodeSourceArtifactV2TreeNodeFrame("module", tree, DECODE_BUDGET)).reason)
      .toBe("invalidTag");

    const invalidCounter = source.slice();
    invalidCounter.fill(0xff, asciiLength("flarex.source-artifact-v2.source-block.v1\0"),
      asciiLength("flarex.source-artifact-v2.source-block.v1\0") + 8);
    expect(failed(decodeSourceArtifactV2BlockFrame(
      "source", invalidCounter, DECODE_BUDGET,
    )).reason).toBe("invalidCounter");

    const badTotal = tree.slice();
    badTotal[badTotal.byteLength - 1] ^= 1;
    expect(failed(decodeSourceArtifactV2TreeNodeFrame(
      "source", badTotal, DECODE_BUDGET,
    )).reason).toBe("invalidRange");

    const moduleDomainLength = asciiLength("flarex.source-artifact-v2.module.v1\0");
    const pathLength = new DataView(module.buffer, module.byteOffset, module.byteLength)
      .getUint32(moduleDomainLength + 8, false);
    const environmentOffset = moduleDomainLength + 8 + 4 + pathLength;
    const badEnvironment = module.slice();
    badEnvironment[environmentOffset] = 2;
    expect(failed(decodeSourceArtifactV2ModuleFrame(
      badEnvironment, DECODE_BUDGET,
    )).reason).toBe("invalidEnvironment");
    const badRoles = module.slice();
    badRoles[environmentOffset + 1] = 0;
    expect(failed(decodeSourceArtifactV2ModuleFrame(badRoles, DECODE_BUDGET)).reason)
      .toBe("invalidRoles");
    const badMapTag = module.slice();
    badMapTag[badMapTag.byteLength - 1] = 2;
    expect(failed(decodeSourceArtifactV2ModuleFrame(badMapTag, DECODE_BUDGET)).reason)
      .toBe("invalidTag");

    const presentMap = frame(sourceArtifactV2ModuleFrame({
      ordinal: 0n,
      path: "a",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      sourceByteLength: 1n,
      sourceBlockCount: 1n,
      sourceTreeDigest: DIGEST_A,
      sourceMapByteLength: 1n,
      sourceMapBlockCount: 1n,
      sourceMapTreeDigest: DIGEST_B,
    }, FRAME_BUDGET));
    const zeroPresentMapLength = presentMap.slice();
    const presentMapTagOffset = environmentOffset + 2 + 8 + 8 + 32;
    zeroPresentMapLength.fill(0, presentMapTagOffset + 1, presentMapTagOffset + 9);
    expect(failed(decodeSourceArtifactV2ModuleFrame(
      zeroPresentMapLength, DECODE_BUDGET,
    )).reason).toBe("inconsistentFields");

    const rootDomainLength = asciiLength("flarex.source-artifact-v2.completed-root.v1\0");
    const badVersion = root.slice();
    badVersion[rootDomainLength + 3] = 2;
    expect(failed(decodeSourceArtifactV2CompletedRootFrame(
      badVersion, DECODE_BUDGET,
    )).reason).toBe("invalidVersion");
    expect(failed(decodeSourceArtifactV2CompletedRootFrame(
      module, DECODE_BUDGET,
    )).reason).toBe("wrongDomain");

    const executionLengthOffset = rootDomainLength + 4 + 8 + 8 + 8 + 8 + 32;
    const executionLength = new DataView(root.buffer, root.byteOffset, root.byteLength)
      .getUint32(executionLengthOffset, false);
    const schemaTagOffset = executionLengthOffset + 4 + executionLength;
    const badOptionalTag = root.slice();
    badOptionalTag[schemaTagOffset] = 2;
    expect(failed(decodeSourceArtifactV2CompletedRootFrame(
      badOptionalTag, DECODE_BUDGET,
    )).reason).toBe("invalidTag");
  });

  it("requires fatal UTF-8 and canonical JSON-string spellings", () => {
    const canonical = frame(sourceArtifactV2ModuleFrame({
      ordinal: 0n,
      path: "a",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      sourceByteLength: 1n,
      sourceBlockCount: 1n,
      sourceTreeDigest: DIGEST_A,
      sourceMapByteLength: 0n,
      sourceMapBlockCount: 0n,
      sourceMapTreeDigest: null,
    }, FRAME_BUDGET));
    const domainLength = asciiLength("flarex.source-artifact-v2.module.v1\0");
    const pathOffset = domainLength + 8 + 4;
    const invalidUtf8 = canonical.slice();
    invalidUtf8[pathOffset + 1] = 0xff;
    expect(failed(decodeSourceArtifactV2ModuleFrame(invalidUtf8, DECODE_BUDGET)).reason)
      .toBe("invalidCanonicalString");

    const noncanonicalPath = new TextEncoder().encode('"\\u0061"');
    const noncanonical = concat(
      canonical.slice(0, domainLength + 8),
      u32(noncanonicalPath.byteLength),
      noncanonicalPath,
      canonical.slice(pathOffset + 3),
    );
    expect(failed(decodeSourceArtifactV2ModuleFrame(noncanonical, DECODE_BUDGET)).reason)
      .toBe("invalidCanonicalString");
  });

  it("owns input bytes and ignores caller iterators, species, proxies, and detached views", () => {
    const original = frame(sourceArtifactV2BlockFrame(
      "source", 0n, Uint8Array.of(1, 2, 3), FRAME_BUDGET,
    ));
    const caller = original.slice();
    Object.defineProperty(caller, Symbol.iterator, {
      value: () => { throw new Error("iterator must not run"); },
    });
    Object.defineProperty(caller, "constructor", {
      value: { [Symbol.species]: class extends Uint8Array {} },
    });
    const result = decoded(decodeSourceArtifactV2BlockFrame("source", caller, DECODE_BUDGET));
    caller.fill(0);
    expect([...result.value.bytes]).toEqual([1, 2, 3]);
    result.value.bytes.fill(9);
    expect([...caller.slice(-3)]).toEqual([0, 0, 0]);

    expect(failed(decodeSourceArtifactV2BlockFrame(
      "source", new Proxy(original, {}), DECODE_BUDGET,
    )).reason).toBe("invalidBytes");
    const detached = original.slice();
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(failed(decodeSourceArtifactV2BlockFrame(
      "source", detached, DECODE_BUDGET,
    )).reason).toBe("invalidBytes");
  });
});

function fixtures(): readonly [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
  return [
    frame(sourceArtifactV2BlockFrame("source", 0n, Uint8Array.of(1), FRAME_BUDGET)),
    frame(sourceArtifactV2BlockFrame("sourceMap", 0n, Uint8Array.of(2), FRAME_BUDGET)),
    frame(sourceArtifactV2TreeNodeFrame(
      "source",
      { firstOrdinal: 0n, count: 1n, digest: DIGEST_A },
      { firstOrdinal: 1n, count: 1n, digest: DIGEST_B },
      FRAME_BUDGET,
    )),
    frame(sourceArtifactV2ModuleFrame({
      ordinal: 0n,
      path: "a",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      sourceByteLength: 1n,
      sourceBlockCount: 1n,
      sourceTreeDigest: DIGEST_A,
      sourceMapByteLength: 0n,
      sourceMapBlockCount: 0n,
      sourceMapTreeDigest: null,
    }, FRAME_BUDGET)),
    frame(sourceArtifactV2CompletedRootFrame({
      moduleCount: 1n,
      functionModuleCount: 0n,
      totalSourceBytes: 1n,
      totalSourceMapBytes: 0n,
      moduleTreeDigest: DIGEST_A,
      executionPath: "a",
      schemaPath: null,
      authPath: null,
    }, FRAME_BUDGET)),
  ];
}

function frame<E>(result: Result.Result<{ readonly bytes: Uint8Array }, E>): Uint8Array {
  if (Result.isFailure(result)) throw result.failure;
  return result.success.bytes;
}

function decoded<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function failed<A>(result: Result.Result<A, { readonly reason: string }>): {
  readonly reason: string;
} {
  if (Result.isSuccess(result)) throw new Error("Expected decoder failure.");
  return result.failure;
}

function concat(...parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function asciiLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
