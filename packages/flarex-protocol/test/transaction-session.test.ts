import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CanonicalTransactionArgumentsBytesV1Schema,
  CanonicalTransactionAuthorizationGrantBytesV1Schema,
  MAX_TRANSACTION_ATTEMPT_FENCE,
  MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH,
  MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1,
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
  type TransactionAttemptFence,
  type TransactionAuthorizationRevocationEpoch,
  type TransactionSessionIdV1,
  type TransactionSessionLifecycleV1,
} from "../src/transaction-session";

describe("transaction-session protocol", () => {
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
