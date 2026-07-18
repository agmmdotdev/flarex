import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CanonicalTransactionArgumentsBytesV1Schema,
  CanonicalTransactionAuthorizationGrantBytesV1Schema,
  MAX_TRANSACTION_ATTEMPT_FENCE,
  MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH,
  MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1,
  storedTransactionSessionScalarsEqualV1,
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionArgumentsSha256V1Schema,
  TransactionArtifactIdV1Schema,
  TransactionArtifactRuntimeV1Schema,
  TransactionAttemptFenceSchema,
  TransactionAuthorizationGrantSha256V1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionKindV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionPackageIdV1Schema,
  TransactionPolicyVersionV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
  TransactionSessionIdV1Schema,
  TransactionSessionLifecycleV1Schema,
  TransactionSessionProtocolVersionV1Schema,
  TransactionSourcePackageSha256HexV1Schema,
  type StoredTransactionSessionScalarsV1,
  type TransactionAttemptFence,
  type TransactionAuthorizationRevocationEpoch,
  type TransactionSessionIdV1,
  type TransactionSessionLifecycleV1,
} from "../src/transaction-session";

describe("transaction-session protocol", () => {
  it("compares exact stored session scalar evidence", () => {
    const actual = storedSessionScalars();
    const expected = storedSessionScalars();

    expect(storedTransactionSessionScalarsEqualV1(actual, expected)).toBe(true);
    expect(storedTransactionSessionScalarsEqualV1(actual, {
      ...expected,
      storageGeneration: "generation-b",
    })).toBe(false);

    for (const field of [
      "identityAccessPolicySha256",
      "validatedArgsSha256",
      "authorizationGrantSha256",
      "requestSha256",
    ] as const) {
      const changed = storedSessionScalars();
      changed[field][31] = 255;
      expect(storedTransactionSessionScalarsEqualV1(actual, changed)).toBe(
        false,
      );
    }
  });

  it("preserves native number equality for signed zero", () => {
    const actual = {
      ...storedSessionScalars(),
      updatedAtMilliseconds: 0,
    };
    const expected = {
      ...storedSessionScalars(),
      updatedAtMilliseconds: -0,
    };

    expect(Object.is(actual.updatedAtMilliseconds, expected.updatedAtMilliseconds))
      .toBe(false);
    expect(storedTransactionSessionScalarsEqualV1(actual, expected)).toBe(true);
  });

  it("preserves scalar and digest comparison evaluation order", () => {
    const scalarMismatchReads: string[] = [];
    const scalarMismatchActual = observeStoredSessionDigestReads(
      storedSessionScalars(),
      "actual",
      scalarMismatchReads,
    );
    const scalarMismatchExpected = observeStoredSessionDigestReads(
      {
        ...storedSessionScalars(),
        storageGeneration: "generation-b",
      },
      "expected",
      scalarMismatchReads,
    );

    expect(storedTransactionSessionScalarsEqualV1(
      scalarMismatchActual,
      scalarMismatchExpected,
    )).toBe(false);
    expect(scalarMismatchReads).toEqual([]);

    const observedDigest = observeByteReads(new Array<number>(32).fill(1));
    const digestMismatchActual = {
      ...storedSessionScalars(),
      identityAccessPolicySha256: observedDigest.bytes,
    };
    const digestMismatchExpected = storedSessionScalars();
    digestMismatchExpected.identityAccessPolicySha256[0] = 255;
    const digestReads: string[] = [];

    expect(storedTransactionSessionScalarsEqualV1(
      observeStoredSessionDigestReads(
        digestMismatchActual,
        "actual",
        digestReads,
      ),
      observeStoredSessionDigestReads(
        digestMismatchExpected,
        "expected",
        digestReads,
      ),
    )).toBe(false);
    expect(digestReads).toEqual([
      "actual:identityAccessPolicySha256",
      "expected:identityAccessPolicySha256",
    ]);
    expect(observedDigest.reads).toEqual(
      Array.from({ length: 32 }, (_unused, index) => index),
    );
  });

  it("keeps the native session UUID canonical and nominal", () => {
    const sessionId = TransactionSessionIdV1Schema.make(
      "018f22e2-58cc-7b2a-91d8-f3f3401a0874",
    );

    expectTypeOf(sessionId).toEqualTypeOf<TransactionSessionIdV1>();
    expectTypeOf<string>().not.toMatchTypeOf<TransactionSessionIdV1>();
    for (const invalid of [
      "",
      "018F22E2-58CC-7B2A-91D8-F3F3401A0874",
      "018f22e258cc7b2a91d8f3f3401a0874",
      "session_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
      1,
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(TransactionSessionIdV1Schema)(invalid),
      ).toThrow();
    }
  });

  it("closes lifecycle, function kind, runtime, and protocol version", () => {
    const accepted = [
      "created",
      "running",
      "finishing",
      "committing",
      "retrying",
      "committed",
      "aborted",
      "expired",
    ] as const;

    for (const lifecycle of accepted) {
      expect(TransactionSessionLifecycleV1Schema.make(lifecycle)).toBe(
        lifecycle,
      );
    }
    expect(() =>
      Schema.decodeUnknownSync(TransactionSessionLifecycleV1Schema)("failed"),
    ).toThrow();
    expect(TransactionFunctionKindV1Schema.make("mutation")).toBe("mutation");
    expect(() =>
      Schema.decodeUnknownSync(TransactionFunctionKindV1Schema)("query"),
    ).toThrow();
    expect(TransactionArtifactRuntimeV1Schema.make("dynamic-worker")).toBe(
      "dynamic-worker",
    );
    expect(TRANSACTION_SESSION_PROTOCOL_VERSION_V1).toBe(1);
    expect(() =>
      Schema.decodeUnknownSync(TransactionSessionProtocolVersionV1Schema)(2),
    ).toThrow();
    expectTypeOf<typeof accepted[number]>()
      .toEqualTypeOf<TransactionSessionLifecycleV1>();
  });

  it("bounds attempt fences and revocation epochs to PostgreSQL bigint", () => {
    const decodeFence = Schema.decodeUnknownSync(TransactionAttemptFenceSchema);
    const decodeEpoch = Schema.decodeUnknownSync(
      TransactionAuthorizationRevocationEpochSchema,
    );

    const fence = decodeFence(MAX_TRANSACTION_ATTEMPT_FENCE.toString());
    const epoch = decodeEpoch(
      MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH.toString(),
    );
    expect(fence).toBe(MAX_TRANSACTION_ATTEMPT_FENCE);
    expect(epoch).toBe(MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH);
    expectTypeOf(fence).toEqualTypeOf<TransactionAttemptFence>();
    expectTypeOf(epoch)
      .toEqualTypeOf<TransactionAuthorizationRevocationEpoch>();

    for (const invalid of [
      "0",
      "01",
      "-1",
      (MAX_TRANSACTION_ATTEMPT_FENCE + 1n).toString(),
      1n,
    ]) {
      expect(() => decodeFence(invalid)).toThrow();
    }
    for (const invalid of [
      "01",
      "-1",
      (MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH + 1n).toString(),
      0n,
    ]) {
      expect(() => decodeEpoch(invalid)).toThrow();
    }
  });

  it("validates immutable request pins without reusing legacy session IDs", () => {
    expect(TransactionPackageIdV1Schema.make("package_a")).toBe("package_a");
    expect(
      TransactionArtifactIdV1Schema.make(`artifact_${"a".repeat(32)}`),
    ).toBe(`artifact_${"a".repeat(32)}`);
    expect(
      TransactionSourcePackageSha256HexV1Schema.make("b".repeat(64)),
    ).toBe("b".repeat(64));
    expect(TransactionPolicyVersionV1Schema.make("policy_v1")).toBe(
      "policy_v1",
    );
    expect(TransactionRequestKeyV1Schema.make("request_internal_a")).toBe(
      "request_internal_a",
    );
    const maximumMultibyteRequestKey = "\u00e9".repeat(
      MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1 / 2,
    );
    expect(new TextEncoder().encode(maximumMultibyteRequestKey)).toHaveLength(
      MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1,
    );
    expect(TransactionRequestKeyV1Schema.make(maximumMultibyteRequestKey))
      .toBe(maximumMultibyteRequestKey);
    expect(() =>
      TransactionRequestKeyV1Schema.make(
        `${maximumMultibyteRequestKey}\u00e9`,
      ),
    ).toThrow();

    for (const invalid of ["", "   ", "\t\n", "bad\u0000text"]) {
      expect(() =>
        Schema.decodeUnknownSync(TransactionPackageIdV1Schema)(invalid),
      ).toThrow();
      expect(() =>
        Schema.decodeUnknownSync(TransactionRequestKeyV1Schema)(invalid),
      ).toThrow();
    }
    expect(() => TransactionArtifactIdV1Schema.make("artifact_a")).toThrow();
    expect(() =>
      TransactionSourcePackageSha256HexV1Schema.make("A".repeat(64)),
    ).toThrow();
  });

  it("separates canonical arguments, grant, and cryptographic match evidence", () => {
    const bytes = new Uint8Array([1]);
    const sha = new Uint8Array(32);

    expect(CanonicalTransactionArgumentsBytesV1Schema.make(bytes)).toEqual(
      bytes,
    );
    expect(
      CanonicalTransactionAuthorizationGrantBytesV1Schema.make(bytes),
    ).toEqual(bytes);
    expect(TransactionArgumentsSha256V1Schema.make(sha)).toEqual(sha);
    expect(TransactionAuthorizationGrantSha256V1Schema.make(sha)).toEqual(sha);
    expect(TransactionIdentityAccessPolicySha256V1Schema.make(sha)).toEqual(
      sha,
    );
    expect(TransactionRequestSha256V1Schema.make(sha)).toEqual(sha);

    expect(() =>
      CanonicalTransactionArgumentsBytesV1Schema.make(new Uint8Array()),
    ).toThrow();
    expect(() =>
      CanonicalTransactionAuthorizationGrantBytesV1Schema.make(
        new Uint8Array(),
      ),
    ).toThrow();
    for (const schema of [
      TransactionArgumentsSha256V1Schema,
      TransactionAuthorizationGrantSha256V1Schema,
      TransactionIdentityAccessPolicySha256V1Schema,
      TransactionRequestSha256V1Schema,
    ]) {
      expect(() => schema.make(new Uint8Array(31))).toThrow();
      expect(() => schema.make(new Uint8Array(33))).toThrow();
      expect(() =>
        Schema.decodeUnknownSync(schema)("identity:v1:0123456789abcdef"),
      ).toThrow();
    }
  });
});

function storedSessionScalars(): StoredTransactionSessionScalarsV1 {
  return {
    lifecycle: "finishing",
    storageGeneration: "generation-a",
    storageGenerationFence: 2n,
    packageId: "package-a",
    artifactRuntime: "dynamic-worker",
    artifactId: `artifact_${"a".repeat(32)}`,
    sourcePackageHash: "b".repeat(64),
    executionModule: "_flarex/execution.js",
    functionPath: "lessons:create",
    functionKind: "mutation",
    schemaVersionId: "schema-a",
    policyVersion: "policy-a",
    identityAccessPolicySha256: new Uint8Array(32).fill(1),
    validatedArgsValueCodecVersion: 1,
    validatedArgsCanonicalByteLength: 16,
    validatedArgsSha256: new Uint8Array(32).fill(2),
    authorizationGrantId: "grant-a",
    authorizationGrantValueCodecVersion: 1,
    authorizationGrantCanonicalByteLength: 32,
    authorizationGrantSha256: new Uint8Array(32).fill(3),
    authorizationRevocationEpoch: 4n,
    authorizationGrantExpiresAtMilliseconds: 10_000,
    requestKey: "request-a",
    requestSha256: new Uint8Array(32).fill(4),
    protocolVersion: 1,
    hardExpiresAtMilliseconds: 10_000,
    createdAtMilliseconds: 1_000,
    updatedAtMilliseconds: 2_000,
  };
}

function observeStoredSessionDigestReads(
  value: StoredTransactionSessionScalarsV1,
  label: string,
  reads: string[],
): StoredTransactionSessionScalarsV1 {
  return new Proxy(value, {
    get(target, property, receiver) {
      if (
        property === "identityAccessPolicySha256" ||
        property === "validatedArgsSha256" ||
        property === "authorizationGrantSha256" ||
        property === "requestSha256"
      ) {
        reads.push(`${label}:${property}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function observeByteReads(values: ReadonlyArray<number>): {
  readonly bytes: Uint8Array;
  readonly reads: ReadonlyArray<number>;
} {
  const reads: number[] = [];
  const target = new Uint8Array(values);
  const bytes = new Proxy(target, {
    get(value, property) {
      if (
        typeof property === "string" &&
        /^(?:0|[1-9][0-9]*)$/.test(property)
      ) {
        reads.push(Number(property));
      }
      return Reflect.get(value, property, value);
    },
  });
  return { bytes, reads };
}
