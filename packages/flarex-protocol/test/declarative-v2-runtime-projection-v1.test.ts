import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  DECLARATIVE_V2_COLD_MATERIALIZATION_RECEIPT_CODEC_IDENTITY_V1,
  DECLARATIVE_V2_FUNCTION_GROUP_MANIFEST_CODEC_IDENTITY_V1,
  DECLARATIVE_V2_RUNTIME_PROJECTION_CODEC_IDENTITY_V1,
  DECLARATIVE_V2_RUNTIME_READINESS_POLICY_IDENTITY_V1,
  declarativeV2RuntimeArtifactObjectKeyV1,
  frameDeclarativeV2RuntimeRootSha256PreimageV1,
  makeDeclarativeV2RuntimeArtifactObjectReferenceV1,
} from
  "../src/declarative-v2-runtime-projection-v1";

const BUDGET = Object.freeze({
  maximumDigests: 8,
  maximumPreimageBytes: 1_024,
});

describe("Declarative V2 runtime-projection identities V1", () => {
  it("pins the private codec and readiness-policy spellings", () => {
    expect(DECLARATIVE_V2_RUNTIME_PROJECTION_CODEC_IDENTITY_V1).toBe(
      "flarex.declarative-v2/runtime-projection/v1",
    );
    expect(DECLARATIVE_V2_FUNCTION_GROUP_MANIFEST_CODEC_IDENTITY_V1).toBe(
      "flarex.declarative-v2/function-group-manifest/v1",
    );
    expect(
      DECLARATIVE_V2_COLD_MATERIALIZATION_RECEIPT_CODEC_IDENTITY_V1,
    ).toBe(
      "flarex.declarative-v2/cold-materialization-receipt/v1",
    );
    expect(DECLARATIVE_V2_RUNTIME_READINESS_POLICY_IDENTITY_V1).toBe(
      "flarex.readiness/runtime-projection-cold-materialization/v1",
    );
  });

  it("frames ordered roots with domain, group, count, and exact digests", () => {
    const first = Result.getOrThrow(
      frameDeclarativeV2RuntimeRootSha256PreimageV1(
        "runtimeProjectionModules",
        "transaction",
        [digest(1), digest(2)],
        BUDGET,
      ),
    );
    const replay = Result.getOrThrow(
      frameDeclarativeV2RuntimeRootSha256PreimageV1(
        "runtimeProjectionModules",
        "transaction",
        [digest(1), digest(2)],
        BUDGET,
      ),
    );
    const reordered = Result.getOrThrow(
      frameDeclarativeV2RuntimeRootSha256PreimageV1(
        "runtimeProjectionModules",
        "transaction",
        [digest(2), digest(1)],
        BUDGET,
      ),
    );
    const changedGroup = Result.getOrThrow(
      frameDeclarativeV2RuntimeRootSha256PreimageV1(
        "runtimeProjectionModules",
        "edge_action",
        [digest(1), digest(2)],
        BUDGET,
      ),
    );
    const changedDomain = Result.getOrThrow(
      frameDeclarativeV2RuntimeRootSha256PreimageV1(
        "functionGroupEntries",
        null,
        [digest(1), digest(2)],
        BUDGET,
      ),
    );
    expect(encodeBytesToLowercaseHex(first)).toBe(
      "666c617265782e6465636c617261746976652d76322f72756e74696d652d70726f6a656374696f6e2d6d6f64756c652d726f6f742f7631000000000b7472616e73616374696f6e0000000201010101010101010101010101010101010101010101010101010101010101010202020202020202020202020202020202020202020202020202020202020202",
    );
    expect(replay).toEqual(first);
    expect(reordered).not.toEqual(first);
    expect(changedGroup).not.toEqual(first);
    expect(changedDomain).not.toEqual(first);
  });

  it("pins content-addressed R2 keys and reference identity", () => {
    const digestValue = digest(0xab);
    const key = Result.getOrThrow(
      declarativeV2RuntimeArtifactObjectKeyV1(
        "runtime-projection-module",
        digestValue,
      ),
    );
    expect(key).toBe(
      `declarative-v2-runtime-artifact/v1/runtime-projection-module/${
        "ab".repeat(32)
      }`,
    );
    const reference = Result.getOrThrow(
      makeDeclarativeV2RuntimeArtifactObjectReferenceV1(
        "runtime-projection-module",
        digestValue,
        123,
      ),
    );
    expect(reference).toMatchObject({
      storeIdentity: "flarex.r2/declarative-v2-runtime-artifact/v1",
      kind: "runtime-projection-module",
      codecIdentity: "flarex.declarative-v2/runtime-projection/v1",
      objectKey: key,
      byteLength: 123n,
    });
    expect(reference.sha256).toEqual(digestValue);
    expect(Result.isFailure(
      makeDeclarativeV2RuntimeArtifactObjectReferenceV1(
        "function-group-entry",
        new Uint8Array(31),
        1,
      ),
    )).toBe(true);
  });

  it("rejects malformed digests and resource-budget overflow", () => {
    const malformed = frameDeclarativeV2RuntimeRootSha256PreimageV1(
      "runtimeProjectionModules",
      "transaction",
      [new Uint8Array(31)],
      BUDGET,
    );
    expect(Result.isFailure(malformed)).toBe(true);
    if (Result.isFailure(malformed)) {
      expect(malformed.failure).toMatchObject({
        reason: "invalidDigest",
        path: "digests[0]",
      });
    }
    const missingGroup = frameDeclarativeV2RuntimeRootSha256PreimageV1(
      "runtimeProjectionModules",
      null,
      [digest(1)],
      BUDGET,
    );
    expect(Result.isFailure(missingGroup)).toBe(true);
    const unexpectedGroup = frameDeclarativeV2RuntimeRootSha256PreimageV1(
      "functionGroupEntries",
      "transaction",
      [digest(1)],
      BUDGET,
    );
    expect(Result.isFailure(unexpectedGroup)).toBe(true);
    const excessive = frameDeclarativeV2RuntimeRootSha256PreimageV1(
      "runtimeProjectionModules",
      "transaction",
      [digest(1), digest(2)],
      { ...BUDGET, maximumDigests: 1 },
    );
    expect(Result.isFailure(excessive)).toBe(true);
    const inheritedKey = frameDeclarativeV2RuntimeRootSha256PreimageV1(
      "toString" as never,
      null,
      [],
      BUDGET,
    );
    expect(Result.isFailure(inheritedKey)).toBe(true);
  });
});

function digest(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}
