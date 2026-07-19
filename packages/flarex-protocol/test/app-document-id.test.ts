import { Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AppDocumentIdV1Error,
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytes,
  appRowIdHexV1FromBytesResult,
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdV1,
  decodeAppDocumentIdentityV1,
  decodeAppDocumentIdentityV1Result,
  decodeAppRowIdHexV1,
  requireAppDocumentIdentityV1ForTable,
  requireAppDocumentIdentityV1ForTableResult,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "../src/app-document-id";
import {
  AppDocumentSystemFieldV1Error,
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
  verifyAppDocumentEvidenceV1,
  type AppCreationTimeV1,
} from "../src/app-document";
import { decodeCatalogTableId } from "../src/catalog";

const tableId = decodeCatalogTableId(1);
const otherTableId = decodeCatalogTableId(2);
const rowId = decodeAppRowIdHexV1("00112233445566778899aabbccddeeff");
const documentId = "1:00112233-4455-6677-8899-aabbccddeeff";

describe("replacement app document identity v1", () => {
  it("keeps public and physical identities nominal", () => {
    expectTypeOf<AppDocumentIdV1>().toMatchTypeOf<string>();
    expectTypeOf<string>().not.toMatchTypeOf<AppDocumentIdV1>();
    expectTypeOf<AppRowIdHexV1>().toMatchTypeOf<string>();
    expectTypeOf<AppDocumentIdV1>().not.toEqualTypeOf<AppRowIdHexV1>();
    expectTypeOf<AppCreationTimeV1>().toMatchTypeOf<number>();
    expectTypeOf<number>().not.toMatchTypeOf<AppCreationTimeV1>();
  });

  it("round-trips positive table IDs and generator-neutral UUID bytes", () => {
    for (const value of [
      documentId,
      "1:018f22e2-58cc-7b2a-91d8-f3f3401a0874",
      "2147483647:00000000-0000-0000-0000-000000000000",
    ]) {
      const identity = decodeAppDocumentIdentityV1(value);
      expect(identity.id).toBe(value);
      expect(appDocumentIdV1FromRowIdentity(identity)).toBe(value);
      expect(Object.isFrozen(identity)).toBe(true);
    }

    expect(decodeAppDocumentIdV1(documentId)).toBe(documentId);
    expect(decodeAppDocumentIdentityV1(documentId)).toEqual({
      id: documentId,
      tableId,
      rowId,
    });
  });

  it("rejects permissive legacy and non-canonical forms", () => {
    for (const value of [
      "0:00112233-4455-6677-8899-aabbccddeeff",
      "01:00112233-4455-6677-8899-aabbccddeeff",
      "+1:00112233-4455-6677-8899-aabbccddeeff",
      "1e0:00112233-4455-6677-8899-aabbccddeeff",
      "2147483648:00112233-4455-6677-8899-aabbccddeeff",
      "9007199254740992:00112233-4455-6677-8899-aabbccddeeff",
      "1:ada",
      "1:00112233445566778899aabbccddeeff",
      "1:00112233-4455-6677-8899-AABBCCDDEEFF",
      "1:00112233-4455-6677-8899-aabbccddeeff:extra",
      " 1:00112233-4455-6677-8899-aabbccddeeff",
      1,
      null,
    ]) {
      expect(() => decodeAppDocumentIdentityV1(value)).toThrow(
        AppDocumentIdV1Error,
      );
      expect(() => decodeAppDocumentIdV1(value)).toThrow();
    }
  });

  it("rejects table confusion with a typed issue", () => {
    expect(() =>
      requireAppDocumentIdentityV1ForTable(documentId, otherTableId),
    ).toThrowError(
      expect.objectContaining({
        issue: {
          reason: "tableMismatch",
          expectedTableId: otherTableId,
          actualTableId: tableId,
        },
      }),
    );

    const result = requireAppDocumentIdentityV1ForTableResult(
      documentId,
      otherTableId,
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(AppDocumentIdV1Error);
      expect(result.failure.issue).toEqual({
        reason: "tableMismatch",
        expectedTableId: otherTableId,
        actualTableId: tableId,
      });
    }
  });

  it("exposes identity decoding as a typed Result with a throwing facade", () => {
    const decoded = decodeAppDocumentIdentityV1Result(documentId);
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success).toEqual({ id: documentId, tableId, rowId });
      expect(Object.isFrozen(decoded.success)).toBe(true);
    }

    const invalid = decodeAppDocumentIdentityV1Result(
      "2147483648:00112233-4455-6677-8899-aabbccddeeff",
    );
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isFailure(invalid)) {
      expect(invalid.failure).toBeInstanceOf(AppDocumentIdV1Error);
      expect(invalid.failure.issue).toEqual({
        reason: "invalidTableId",
        value: "2147483648",
      });
    }
  });

  it("converts exact row bytes defensively", () => {
    const source = Uint8Array.from({ length: 16 }, (_, index) => index);
    const decoded = appRowIdHexV1FromBytesResult(source);
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success).toBe("000102030405060708090a0b0c0d0e0f");
    }
    const hex = appRowIdHexV1FromBytes(source);
    source.fill(255);
    expect(hex).toBe("000102030405060708090a0b0c0d0e0f");

    const first = appRowIdHexV1ToBytes(hex);
    const second = appRowIdHexV1ToBytes(hex);
    first.fill(255);
    expect(second).toEqual(Uint8Array.from({ length: 16 }, (_, index) => index));
    expect(() => appRowIdHexV1FromBytes(new Uint8Array(15))).toThrow(
      AppDocumentIdV1Error,
    );
    const invalid = appRowIdHexV1FromBytesResult(new Uint8Array(15));
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isFailure(invalid)) {
      expect(invalid.failure).toBeInstanceOf(AppDocumentIdV1Error);
      expect(invalid.failure.issue.reason).toBe("invalidRowId");
    }

    const spoofedLength = new Uint8Array(1);
    Object.defineProperty(spoofedLength, "byteLength", { value: 16 });
    expect(spoofedLength.byteLength).toBe(16);
    expect(() => appRowIdHexV1FromBytes(spoofedLength)).toThrow(
      AppDocumentIdV1Error,
    );

    const proxied = new Proxy(new Uint8Array(16), {
      get(value, key) {
        return Reflect.get(value, key, value);
      },
    });
    expect(proxied.byteLength).toBe(16);
    expect(() => appRowIdHexV1FromBytes(proxied)).toThrow(
      AppDocumentIdV1Error,
    );
    expect(Result.isFailure(appRowIdHexV1FromBytesResult(proxied))).toBe(true);
  });
});

describe("trusted app document system fields v1", () => {
  it("injects and verifies identity, creation time, and canonical evidence", async () => {
    const creationTime = decodeAppCreationTimeV1(1_725_000_000_000.25);
    const canonical = await canonicalizeAppDocumentV1({
      tableId,
      rowId,
      creationTime,
      fields: {
        title: "before\u0000after",
        count: 9_007_199_254_740_993n,
        bytes: new Uint8Array([0, 127, 255]).buffer,
      },
    });

    expect(canonical.value).toMatchObject({
      _id: documentId,
      _creationTime: creationTime,
      title: "before\u0000after",
      count: 9_007_199_254_740_993n,
    });
    await expect(
      verifyAppDocumentEvidenceV1({
        tableId,
        rowId,
        creationTime,
        codecVersion: canonical.codecVersion,
        valueJson: canonical.valueJson,
        canonicalBytes: canonical.canonicalBytes,
        sha256: canonical.sha256,
      }),
    ).resolves.toEqual(canonical);
  });

  it("rejects developer-authored or mismatched trusted fields", async () => {
    const creationTime = decodeAppCreationTimeV1(10.5);
    await expect(
      canonicalizeAppDocumentV1({
        tableId,
        rowId,
        creationTime,
        fields: { _id: documentId, title: "forged" },
      }),
    ).rejects.toBeInstanceOf(AppDocumentSystemFieldV1Error);

    const canonical = await canonicalizeAppDocumentV1({
      tableId,
      rowId,
      creationTime,
      fields: { title: "valid" },
    });
    await expect(
      verifyAppDocumentEvidenceV1({
        tableId,
        rowId,
        creationTime: decodeAppCreationTimeV1(11),
        codecVersion: canonical.codecVersion,
        valueJson: canonical.valueJson,
        canonicalBytes: canonical.canonicalBytes,
        sha256: canonical.sha256,
      }),
    ).rejects.toMatchObject({
      issue: { reason: "creationTimeMismatch" },
    });
  });

  it("rejects invalid trusted creation times", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => decodeAppCreationTimeV1(value)).toThrow();
    }
  });
});
