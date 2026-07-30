import { webcrypto } from "node:crypto";
import { Effect } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import {
  decodeApplicationRevisionRegistrationRequestKeyV1,
  deriveApplicationRevisionRegistrationClaimSha256V1,
  deriveSchemaBindingSha256V1,
  deriveSystemExecutionArtifactSha256V1,
  deriveSystemFunctionIdentityV1,
  deriveSystemSourcePackageSha256V1,
} from "../src/applicationRevisionRegistrationIdentitiesV1";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";

const FUNCTION_BUDGET = Object.freeze({
  maximumFunctionsVisited: 16,
  maximumValidatorNodesVisited: 256,
  maximumCanonicalUtf8BytesMaterialized: 64_000,
});

describe("application revision registration V1 identities", () => {
  beforeAll(() => {
    if (globalThis.crypto === undefined) {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: webcrypto,
      });
    }
  });

  it("pins source-package and sorted execution-artifact identity vectors", async () => {
    const packageSha256 = await Effect.runPromise(
      deriveSystemSourcePackageSha256V1(digest(0x11)),
    );
    const first = await Effect.runPromise(
      deriveSystemExecutionArtifactSha256V1({
        packageSha256,
        executionPath: "_flarex/execution.js",
        moduleBindings: [
          {
            logicalModulePath: "orders",
            artifactModulePath: "orders.js",
          },
          {
            logicalModulePath: "accounts",
            artifactModulePath: "accounts.js",
          },
        ],
      }),
    );
    const reordered = await Effect.runPromise(
      deriveSystemExecutionArtifactSha256V1({
        packageSha256,
        executionPath: "_flarex/execution.js",
        moduleBindings: [
          {
            logicalModulePath: "accounts",
            artifactModulePath: "accounts.js",
          },
          {
            logicalModulePath: "orders",
            artifactModulePath: "orders.js",
          },
        ],
      }),
    );
    const perturbed = await Effect.runPromise(
      deriveSystemExecutionArtifactSha256V1({
        packageSha256,
        executionPath: "_flarex/other.js",
        moduleBindings: [
          {
            logicalModulePath: "accounts",
            artifactModulePath: "accounts.js",
          },
          {
            logicalModulePath: "orders",
            artifactModulePath: "orders.js",
          },
        ],
      }),
    );

    expect(encodeBytesToLowercaseHex(packageSha256)).toMatchInlineSnapshot(`"3ff810c92b40b93a3e2fbcd03c9c80a7eceab3944fb7902cb51da9afede38bf4"`);
    expect(encodeBytesToLowercaseHex(first)).toMatchInlineSnapshot(`"f962df9cb64f275215e9335228a61befce6eb53f6d1d17217d6bb334d3331b46"`);
    expect(reordered).toEqual(first);
    expect(perturbed).not.toEqual(first);
  });

  it("pins explicit handler and validator projections independently", async () => {
    const base = await Effect.runPromise(
      deriveSystemFunctionIdentityV1(functionMetadata(), FUNCTION_BUDGET),
    );
    const validatorChanged = await Effect.runPromise(
      deriveSystemFunctionIdentityV1(
        functionMetadata({ args: { type: "string" } }),
        FUNCTION_BUDGET,
      ),
    );
    const handlerChanged = await Effect.runPromise(
      deriveSystemFunctionIdentityV1(
        functionMetadata({ kind: "query" }),
        FUNCTION_BUDGET,
      ),
    );

    expect(
      encodeBytesToLowercaseHex(base.functionMetadataSha256),
    ).toMatchInlineSnapshot(`"4991040ebce08a8a843636e07e6fb3e520a814f093d39d5e2c85763ebf0eddf3"`);
    expect(
      encodeBytesToLowercaseHex(base.declaredHandlerSetSha256),
    ).toMatchInlineSnapshot(`"82cf877f8a21bd647f85fbf559a4c988c190fdf14c6a9898d377ea2c1b94b9b4"`);
    expect(
      encodeBytesToLowercaseHex(base.validatorRootSha256),
    ).toMatchInlineSnapshot(`"e7d07fe54fdfacf767705407a0baaf68b5f49223c10c75138cf6fc41832defd6"`);
    expect(validatorChanged.functionMetadataSha256)
      .not.toEqual(base.functionMetadataSha256);
    expect(validatorChanged.validatorRootSha256)
      .not.toEqual(base.validatorRootSha256);
    expect(validatorChanged.declaredHandlerSetSha256)
      .toEqual(base.declaredHandlerSetSha256);
    expect(handlerChanged.functionMetadataSha256)
      .not.toEqual(base.functionMetadataSha256);
    expect(handlerChanged.declaredHandlerSetSha256)
      .not.toEqual(base.declaredHandlerSetSha256);
    expect(handlerChanged.validatorRootSha256)
      .toEqual(base.validatorRootSha256);
  });

  it("pins schema-binding and complete registration-claim vectors", async () => {
    const schemaBindingSha256 = await Effect.runPromise(
      deriveSchemaBindingSha256V1({
        deploymentId: "deployment_orders",
        schemaVersionId: `dv2_schema_${"12".repeat(32)}`,
        version: 7,
        manifestCodecVersion: 1,
        manifestByteLength: 123n,
        schemaArtifactSha256: digest(0x12),
      }),
    );
    const claim = claimInput(schemaBindingSha256);
    const registrationInputSha256 = await Effect.runPromise(
      deriveApplicationRevisionRegistrationClaimSha256V1(claim),
    );
    const perturbed = await Effect.runPromise(
      deriveApplicationRevisionRegistrationClaimSha256V1({
        ...claim,
        registrationFrameCount: claim.registrationFrameCount + 1n,
      }),
    );

    expect(
      encodeBytesToLowercaseHex(schemaBindingSha256),
    ).toMatchInlineSnapshot(`"88925bee14b52aec0a1adbd5dac945e54db702dfdfa2b93d4c4348c3e63fe958"`);
    expect(
      encodeBytesToLowercaseHex(registrationInputSha256),
    ).toMatchInlineSnapshot(`"83a7334d5aabc79009b1149cf5cef8907d8d7dbbb03dca1d114c1fb75dc58ab4"`);
    expect(perturbed).not.toEqual(registrationInputSha256);
  });

  it("retains an exact bounded request-key spelling at runtime", () => {
    expect(decodeApplicationRevisionRegistrationRequestKeyV1("  request  "))
      .toMatchObject({ success: "  request  " });
    expect(decodeApplicationRevisionRegistrationRequestKeyV1(" \t "))
      .toMatchObject({ failure: { reason: "blank" } });
    expect(decodeApplicationRevisionRegistrationRequestKeyV1("a\0b"))
      .toMatchObject({ failure: { reason: "nul" } });
    expect(decodeApplicationRevisionRegistrationRequestKeyV1("x".repeat(1_025)))
      .toMatchObject({
        failure: { reason: "tooLong", maximumUtf8Bytes: 1_024 },
      });
  });
});

function functionMetadata(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    functions: [{
      path: "orders:place",
      kind: "mutation",
      visibility: "public",
      args: { type: "any" },
      returns: null,
      route: null,
      partition: null,
      ...overrides,
    }],
  };
}

function claimInput(schemaBindingSha256: Uint8Array) {
  return {
    scopeId: "scope_61000000-0000-0000-0000-000000000001",
    candidateSha256: digest(1),
    attemptSha256: digest(2),
    semanticAttemptIdentitySha256: digest(3),
    sequence: 4n,
    reservationSha256: digest(5),
    producerRequestSha256: digest(6),
    canonicalCommandByteLength: 789n,
    freshAuthenticatedInputSha256: digest(7),
    commandInputSha256: digest(8),
    rangeAndPredecessorTailsSha256: digest(9),
    analyzerIdentitySha256: digest(10),
    verifierIdentitySha256: digest(11),
    outputManifestSha256: digest(12),
    receiptSha256: digest(13),
    nextProgressSha256: digest(14),
    registrationRootSha256: digest(15),
    registrationFrameCount: 1n,
    sourceCodecIdentity: "flarex.source-artifact-v2/codec-v1",
    packageSha256: digest(16),
    artifactRuntimeIdentity: "dynamic-worker",
    artifactSha256: digest(17),
    schemaVersionId: `dv2_schema_${"12".repeat(32)}`,
    schemaVersion: 7,
    manifestCodecVersion: 1,
    manifestByteLength: 123n,
    schemaArtifactSha256: digest(18),
    schemaBindingSha256,
    functionMetadataCodecVersion: 1,
    functionMetadataByteLength: 321n,
    functionMetadataSha256: digest(19),
    validatorRootSha256: digest(20),
    declaredHandlerSetSha256: digest(21),
  } as const;
}

function digest(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}
