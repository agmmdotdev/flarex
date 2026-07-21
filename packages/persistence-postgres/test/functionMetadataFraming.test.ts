import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  TransactionArtifactIdV1Schema,
  TransactionArtifactRuntimeV1Schema,
  TransactionPackageIdV1Schema,
} from "flarex-protocol/transaction-session";

import {
  frameFunctionMetadataChainStepSha256PreimageV1,
  frameFunctionMetadataCompletedPackageSha256PreimageV1,
  frameFunctionMetadataEmptyChainSha256PreimageV1,
  frameFunctionMetadataPathSha256PreimageV1,
  frameFunctionMetadataPublicationKeySha256PreimageV1,
  frameFunctionMetadataRowSha256PreimageV1,
  FunctionMetadataFramingBudgetV1Error,
  FunctionMetadataFramingCounterOverflowV1Error,
  FunctionMetadataFramingInputV1Error,
  type FunctionMetadataFramingV1Error,
  type FunctionMetadataPublicationKeyPinsV1,
} from "../src/functionMetadataFraming";
import { encodeFunctionMetadataSetV1 } from "../src/functionMetadataCodec";
import { hashFunctionMetadataSha256V1 } from
  "../src/functionMetadataSha256";
import { runEffect } from "./effectTestRuntime";

const LARGE_BUDGET = { maximumFrameBytesMaterialized: 1_000_000 };
const SIGNED_INT64_MAX = 9_223_372_036_854_775_807n;
const SOURCE_DIGEST = bytesFromRange(0, 32);
const MANIFEST_DIGEST = bytesFromRange(32, 32);

const PUBLICATION_PINS = {
  packageId: Schema.decodeUnknownSync(TransactionPackageIdV1Schema)("pkg-main"),
  artifactRuntime: Schema.decodeUnknownSync(TransactionArtifactRuntimeV1Schema)(
    "dynamic-worker",
  ),
  artifactId: Schema.decodeUnknownSync(TransactionArtifactIdV1Schema)(
    "artifact_0123456789abcdef0123456789abcdef",
  ),
  sourcePackageSha256: SOURCE_DIGEST,
  schemaVersionId: decodeCatalogSchemaVersionId("schema-v1"),
  schemaManifestCodecVersion: 1,
  schemaManifestByteLength: 123n,
  schemaManifestSha256: MANIFEST_DIGEST,
  functionMetadataCodecVersion: 1,
} satisfies FunctionMetadataPublicationKeyPinsV1;

describe("Function Metadata V1 SHA-256 preimage framing", () => {
  it("matches exact golden vectors and one-NUL ASCII domain separators", async () => {
    const path = success(frameFunctionMetadataPathSha256PreimageV1(
      "mod\0\ud800😀:run",
      LARGE_BUDGET,
    ));
    const row = success(frameFunctionMetadataRowSha256PreimageV1(
      new Uint8Array([0, 1, 255]),
      LARGE_BUDGET,
    ));
    const empty = success(
      frameFunctionMetadataEmptyChainSha256PreimageV1(LARGE_BUDGET),
    );
    const step = success(frameFunctionMetadataChainStepSha256PreimageV1({
      previousChainSha256: await sha256(empty),
      ordinal: 0n,
      canonicalRowBytesTotal: 0n,
      functionPathSha256: await sha256(path),
      functionRowSha256: await sha256(row),
      canonicalRowByteLength: 3n,
    }, LARGE_BUDGET));
    const publication = success(
      frameFunctionMetadataPublicationKeySha256PreimageV1(
        PUBLICATION_PINS,
        LARGE_BUDGET,
      ),
    );
    const completed = success(
      frameFunctionMetadataCompletedPackageSha256PreimageV1({
        publicationKeySha256: await sha256(publication),
        functionCount: 2n,
        canonicalRowBytesTotal: 456n,
        finalRowChainSha256: await sha256(empty),
      }, LARGE_BUDGET),
    );

    expect(hex(path)).toBe(
      "666c617265782e70616d2e66756e6374696f6e2d6d657461646174612e706174682e763100" +
        "0000000000000019226d6f645c75303030305c7564383030f09f98803a72756e22",
    );
    expect(hex(row)).toBe(
      "666c617265782e70616d2e66756e6374696f6e2d6d657461646174612e726f772e763100" +
        "00000000000000030001ff",
    );
    expect(hex(empty)).toBe(
      "666c617265782e70616d2e66756e6374696f6e2d6d657461646174612e636861696e2d736565642e763100",
    );
    expect(hex(step.canonicalBytes)).toBe(
      "666c617265782e70616d2e66756e6374696f6e2d6d657461646174612e636861696e2d7374" +
        "65702e763100285c6deca25c6de4b70c2215cd8df13680fb9a96ebf528157df4eec173a308" +
        "9f000000000000000035dbd3650bd271449e3632a30dc93f0a93ea732e8bef19b61ff8a41a" +
        "e6c1e9be314a443ee2cabcfeecba032f6109ef177ee289f6c5dd397f6f9e9843bf164c7400" +
        "00000000000003",
    );
    expect(step.nextOrdinal).toBe(1n);
    expect(step.nextCanonicalRowBytesTotal).toBe(3n);
    expect(hex(publication)).toBe(
      "666c617265782e70616d2e7061636b6167652d7075626c69636174696f6e2d6b65792e763100" +
        "000000000000000a22706b672d6d61696e2201000000000000002b2261727469666163745f" +
        "3031323334353637383961626364656630313233343536373839616263646566220001020304" +
        "05060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f000000000000000b2273" +
        "6368656d612d76312200000001000000000000007b202122232425262728292a2b2c2d2e2f" +
        "303132333435363738393a3b3c3d3e3f00000001",
    );
    expect(hex(completed)).toBe(
      "666c617265782e70616d2e7061636b6167652d636f6d706c6574652e763100f372c4f1b4df" +
        "f258f477107199cc5ade7b054c49d5c8a283fca71bba4c0122470000000000000002000000" +
        "00000001c8285c6deca25c6de4b70c2215cd8df13680fb9a96ebf528157df4eec173a3089f",
    );
    expect(hex(await sha256(path))).toBe(
      "35dbd3650bd271449e3632a30dc93f0a93ea732e8bef19b61ff8a41ae6c1e9be",
    );
    expect(hex(await sha256(row))).toBe(
      "314a443ee2cabcfeecba032f6109ef177ee289f6c5dd397f6f9e9843bf164c74",
    );
    expect(hex(await sha256(empty))).toBe(
      "285c6deca25c6de4b70c2215cd8df13680fb9a96ebf528157df4eec173a3089f",
    );
    expect(hex(await sha256(step.canonicalBytes))).toBe(
      "973498b24c27b8ed11396fcddf2374befb2dbcc72a3924700db48c98c57cbeca",
    );
    expect(hex(await sha256(publication))).toBe(
      "f372c4f1b4dff258f477107199cc5ade7b054c49d5c8a283fca71bba4c012247",
    );
    expect(hex(await sha256(completed))).toBe(
      "5e0d1a4f9321f6db9708d449d69989e433ca7f581272243a9c883d096a2f8c1e",
    );

    for (const [frame, separator] of [
      [path, "flarex.pam.function-metadata.path.v1"],
      [row, "flarex.pam.function-metadata.row.v1"],
      [empty, "flarex.pam.function-metadata.chain-seed.v1"],
      [step.canonicalBytes, "flarex.pam.function-metadata.chain-step.v1"],
      [publication, "flarex.pam.package-publication-key.v1"],
      [completed, "flarex.pam.package-complete.v1"],
    ] as const) {
      const domain = new TextEncoder().encode(`${separator}\0`);
      expect(frame.slice(0, domain.length)).toEqual(domain);
      expect(frame[domain.length - 1]).toBe(0);
      expect([...domain].filter((byte) => byte === 0)).toHaveLength(1);
    }
  });

  it("advances zero-based row chains across functions from different modules", async () => {
    const metadata = success(encodeFunctionMetadataSetV1({
      functions: [
        { path: "beta:second", kind: "query" },
        { path: "alpha:first", kind: "mutation" },
      ],
    }, {
      maximumFunctionsVisited: 2,
      maximumValidatorNodesVisited: 10,
      maximumCanonicalUtf8BytesMaterialized: 100_000,
    }));
    expect(metadata.functions.map((item) => item.metadata.executionModule))
      .toEqual(["alpha", "beta"]);

    let chain = await sha256(success(
      frameFunctionMetadataEmptyChainSha256PreimageV1(LARGE_BUDGET),
    ));
    let ordinal = 0n;
    let total = 0n;
    for (const item of metadata.functions) {
      const pathDigest = await sha256(success(
        frameFunctionMetadataPathSha256PreimageV1(
          item.metadata.functionPath,
          LARGE_BUDGET,
        ),
      ));
      const rowDigest = await sha256(success(
        frameFunctionMetadataRowSha256PreimageV1(
          item.canonicalBytes,
          LARGE_BUDGET,
        ),
      ));
      const step = success(frameFunctionMetadataChainStepSha256PreimageV1({
        previousChainSha256: chain,
        ordinal,
        canonicalRowBytesTotal: total,
        functionPathSha256: pathDigest,
        functionRowSha256: rowDigest,
        canonicalRowByteLength: BigInt(item.canonicalBytes.byteLength),
      }, LARGE_BUDGET));
      const chainStepDomain = new TextEncoder().encode(
        "flarex.pam.function-metadata.chain-step.v1\0",
      );
      expect(step.canonicalBytes.slice(0, chainStepDomain.byteLength)).toEqual(
        chainStepDomain,
      );
      ordinal = step.nextOrdinal;
      total = step.nextCanonicalRowBytesTotal;
      chain = await sha256(step.canonicalBytes);
    }
    expect(ordinal).toBe(2n);
    expect(total).toBe(BigInt(metadata.functions.reduce(
      (sum, item) => sum + item.canonicalBytes.byteLength,
      0,
    )));
    expect(hex(chain)).toBe(
      "57042cdecdd33f99525fc0f4e0a3a969b34e684e7c1810d330eb1da1d68e3ac0",
    );

    type PackageHasExecutionModule =
      "executionModule" extends keyof FunctionMetadataPublicationKeyPinsV1
        ? true
        : false;
    const packageHasExecutionModule: PackageHasExecutionModule = false;
    expect(packageHasExecutionModule).toBe(false);
    const publicationText = new TextDecoder().decode(success(
      frameFunctionMetadataPublicationKeySha256PreimageV1(
        PUBLICATION_PINS,
        LARGE_BUDGET,
      ),
    ));
    expect(publicationText).not.toContain("alpha");
    expect(publicationText).not.toContain("beta");
  });

  it("encodes U32BE and signed-int64-bounded U64BE values exactly", () => {
    const digest = new Uint8Array(32);
    const completed = success(
      frameFunctionMetadataCompletedPackageSha256PreimageV1({
        publicationKeySha256: digest,
        functionCount: 0n,
        canonicalRowBytesTotal: SIGNED_INT64_MAX,
        finalRowChainSha256: digest,
      }, LARGE_BUDGET),
    );
    const separatorLength = new TextEncoder().encode(
      "flarex.pam.package-complete.v1\0",
    ).byteLength;
    expect(hex(completed.slice(separatorLength + 32, separatorLength + 48)))
      .toBe("00000000000000007fffffffffffffff");

    const publication = success(
      frameFunctionMetadataPublicationKeySha256PreimageV1({
        ...PUBLICATION_PINS,
        schemaManifestCodecVersion: 0x0102_0304,
        schemaManifestByteLength: SIGNED_INT64_MAX,
        functionMetadataCodecVersion: 0xa0b0_c0d0,
      }, LARGE_BUDGET),
    );
    expect(hex(publication)).toContain("010203047fffffffffffffff");
    expect(hex(publication).endsWith("a0b0c0d0")).toBe(true);
  });

  it("rejects invalid digest lengths, counters, codec versions, and overflow", () => {
    const digest = new Uint8Array(32);
    const invalidDigest = frameFunctionMetadataCompletedPackageSha256PreimageV1({
      publicationKeySha256: new Uint8Array(31),
      functionCount: 0n,
      canonicalRowBytesTotal: 0n,
      finalRowChainSha256: digest,
    }, LARGE_BUDGET);
    expectFailure(invalidDigest, FunctionMetadataFramingInputV1Error, {
      field: "publicationKeySha256",
      reason: "invalidDigestLength",
    });

    for (const counter of [-1n, SIGNED_INT64_MAX + 1n, 1]) {
      const invalidCounter = frameFunctionMetadataCompletedPackageSha256PreimageV1({
        publicationKeySha256: digest,
        functionCount: counter,
        canonicalRowBytesTotal: 0n,
        finalRowChainSha256: digest,
      }, LARGE_BUDGET);
      expectFailure(invalidCounter, FunctionMetadataFramingInputV1Error, {
        field: "functionCount",
        reason: "invalidCounter",
      });
    }

    for (const codecVersion of [-1, 1.5, 0x1_0000_0000]) {
      const invalidCodec = frameFunctionMetadataPublicationKeySha256PreimageV1({
        ...PUBLICATION_PINS,
        functionMetadataCodecVersion: codecVersion,
      }, LARGE_BUDGET);
      expectFailure(invalidCodec, FunctionMetadataFramingInputV1Error, {
        field: "functionMetadataCodecVersion",
        reason: "invalidCodecVersion",
      });
    }

    const ordinalOverflow = frameFunctionMetadataChainStepSha256PreimageV1({
      previousChainSha256: digest,
      ordinal: SIGNED_INT64_MAX,
      canonicalRowBytesTotal: 0n,
      functionPathSha256: digest,
      functionRowSha256: digest,
      canonicalRowByteLength: 0n,
    }, LARGE_BUDGET);
    expectFailure(
      ordinalOverflow,
      FunctionMetadataFramingCounterOverflowV1Error,
      { field: "nextOrdinal", left: SIGNED_INT64_MAX, right: 1n },
    );

    const totalOverflow = frameFunctionMetadataChainStepSha256PreimageV1({
      previousChainSha256: digest,
      ordinal: 0n,
      canonicalRowBytesTotal: SIGNED_INT64_MAX,
      functionPathSha256: digest,
      functionRowSha256: digest,
      canonicalRowByteLength: 1n,
    }, LARGE_BUDGET);
    expectFailure(
      totalOverflow,
      FunctionMetadataFramingCounterOverflowV1Error,
      { field: "canonicalRowBytesTotal", left: SIGNED_INT64_MAX, right: 1n },
    );
  });

  it("enforces exact and +1 caller materialization budgets", () => {
    const baseline = success(frameFunctionMetadataPathSha256PreimageV1(
      "messages:send",
      LARGE_BUDGET,
    ));
    expect(success(frameFunctionMetadataPathSha256PreimageV1(
      "messages:send",
      { maximumFrameBytesMaterialized: baseline.byteLength },
    ))).toEqual(baseline);
    expectFailure(
      frameFunctionMetadataPathSha256PreimageV1(
        "messages:send",
        { maximumFrameBytesMaterialized: baseline.byteLength - 1 },
      ),
      FunctionMetadataFramingBudgetV1Error,
      {
        observed: baseline.byteLength,
        maximum: baseline.byteLength - 1,
      },
    );

    for (const maximumFrameBytesMaterialized of [0, -1, 1.5]) {
      expectFailure(
        frameFunctionMetadataEmptyChainSha256PreimageV1({
          maximumFrameBytesMaterialized,
        }),
        FunctionMetadataFramingInputV1Error,
        { reason: "invalidBudget" },
      );
    }
    const inheritedBudget: unknown = Object.create({
      maximumFrameBytesMaterialized: baseline.byteLength,
    });
    expectFailure(
      frameFunctionMetadataEmptyChainSha256PreimageV1(inheritedBudget),
      FunctionMetadataFramingInputV1Error,
      { reason: "invalidBudget" },
    );
    let accessorVisited = false;
    const accessorBudget: object = {};
    Object.defineProperty(accessorBudget, "maximumFrameBytesMaterialized", {
      get() {
        accessorVisited = true;
        throw new Error("budget accessor must not execute");
      },
    });
    expectFailure(
      frameFunctionMetadataEmptyChainSha256PreimageV1(accessorBudget),
      FunctionMetadataFramingInputV1Error,
      { reason: "invalidBudget" },
    );
    expect(accessorVisited).toBe(false);
  });

  it("owns every output frame without mutating or aliasing caller bytes", () => {
    const row = new Uint8Array([4, 5, 6]);
    const first = success(frameFunctionMetadataRowSha256PreimageV1(
      row,
      LARGE_BUDGET,
    ));
    const original = new Uint8Array(first);
    row.fill(9);
    expect(first).toEqual(original);
    first.fill(7);
    expect(row).toEqual(new Uint8Array([9, 9, 9]));

    const sourceDigest = new Uint8Array(SOURCE_DIGEST);
    const manifestDigest = new Uint8Array(MANIFEST_DIGEST);
    const publication = success(
      frameFunctionMetadataPublicationKeySha256PreimageV1({
        ...PUBLICATION_PINS,
        sourcePackageSha256: sourceDigest,
        schemaManifestSha256: manifestDigest,
      }, LARGE_BUDGET),
    );
    const publicationCopy = new Uint8Array(publication);
    sourceDigest.fill(255);
    manifestDigest.fill(255);
    expect(publication).toEqual(publicationCopy);

    const transferable = new Uint8Array([1, 2, 3]);
    structuredClone(transferable, { transfer: [transferable.buffer] });
    expectFailure(
      frameFunctionMetadataRowSha256PreimageV1(transferable, LARGE_BUDGET),
      FunctionMetadataFramingInputV1Error,
      { field: "canonicalRowBytes", reason: "invalidBytes" },
    );

    let speciesConstructionCount = 0;
    class InflatingSpecies extends Uint8Array {
      constructor(length: number) {
        super(length + 7);
        speciesConstructionCount += 1;
      }
    }
    class HostileBytes extends Uint8Array {
      static get [Symbol.species](): typeof InflatingSpecies {
        return InflatingSpecies;
      }
    }
    const hostileRow = new HostileBytes([4, 5, 6]);
    Object.defineProperty(hostileRow, Symbol.iterator, {
      value() {
        throw new Error("caller iterator must not execute");
      },
    });
    expect(success(frameFunctionMetadataRowSha256PreimageV1(
      hostileRow,
      LARGE_BUDGET,
    ))).toEqual(original);
    const hostileDigest = new HostileBytes(SOURCE_DIGEST);
    expect(success(frameFunctionMetadataPublicationKeySha256PreimageV1({
      ...PUBLICATION_PINS,
      sourcePackageSha256: hostileDigest,
    }, LARGE_BUDGET))).toEqual(publicationCopy);
    expect(speciesConstructionCount).toBe(0);
  });
});

function success<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function expectFailure<E extends FunctionMetadataFramingV1Error>(
  result: Result.Result<unknown, FunctionMetadataFramingV1Error>,
  constructor: abstract new (...args: never[]) => E,
  expected: Partial<E>,
): void {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure).toBeInstanceOf(constructor);
    expect(result.failure).toMatchObject(expected);
  }
}

async function sha256(input: Uint8Array): Promise<Uint8Array> {
  return runEffect(hashFunctionMetadataSha256V1(input, {
    maximumInputBytes: input.byteLength,
  }));
}

function hex(input: Uint8Array): string {
  return Buffer.from(input).toString("hex");
}

function bytesFromRange(start: number, length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => start + index);
}
