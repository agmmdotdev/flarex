import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { AppOrderedIndexPhysicalSpecV1Schema } from "flarex-protocol/ordered-index";
import { lowerAppOrderedIndexPhysicalKeyV1 } from "../../../src/storage/indexes/appDeveloperIndexKeys";
import { logicalValueRequiresNotNull } from "../../../src/storage/documents/logicalDocuments/query";

const time = decodeAppCreationTimeV1(1);
const spec = (mixed: boolean) => Schema.decodeUnknownSync(AppOrderedIndexPhysicalSpecV1Schema)({
  kind: "appOrdered", specVersion: 1, accessPath: "developer", keyCodecVersion: 1,
  collation: "binaryUtf8", maxEncodedKeyBytes: 2048,
  orderedFields: [{ kind: "documentPath", path: "key" }, { kind: "systemCreationTime" }],
  tieBreaker: { kind: "separateRowIdentity", byteLength: 16 },
  predicate: mixed ? { kind: "fieldIsNullAndNotNull", nullField: "retired", notNullField: "nested.value" }
    : { kind: "fieldIsNotNull", field: "nested.value" },
});
const project = async (mixed: boolean, value: unknown, retired: unknown, key = "key") => {
  const document = await canonicalizeAppDocumentV1({ tableId: decodeCatalogTableId(1),
    rowId: decodeAppRowIdHexV1("ab".repeat(16)), creationTime: time,
    fields: { key, ...(value === undefined ? {} : { nested: { value } }), ...(retired === undefined ? {} : { retired }) } });
  return lowerAppOrderedIndexPhysicalKeyV1(spec(mixed), document, time);
};

describe("non-null ordered membership", () => {
  for (const mixed of [false, true]) for (const value of [undefined, null, false, 0, "", "present", [], {}])
    for (const retired of [undefined, null, "retired"])
      it(`excludes missing and preserves non-null values (${mixed}, ${String(value)}, ${String(retired)})`, async () => {
        const included = value !== undefined && value !== null && (!mixed || retired === null);
        expect(Result.getOrThrow(await project(mixed, value, retired))).toEqual(included ? expect.any(String) : null);
        const tooLarge = await project(mixed, value, retired, "x".repeat(8000));
        if (included) expect(Result.isFailure(tooLarge)).toBe(true);
        else expect(Result.getOrThrow(tooLarge)).toBeNull();
      });

  it("excludes a missing nested segment rather than negating the null helper", async () => {
    for (const nested of [null, false, "scalar", {}]) {
      const document = await canonicalizeAppDocumentV1({ tableId: decodeCatalogTableId(1),
        rowId: decodeAppRowIdHexV1("ab".repeat(16)), creationTime: time, fields: { key: "key", nested, retired: null } });
      expect(Result.getOrThrow(lowerAppOrderedIndexPhysicalKeyV1(spec(false), document, time))).toBeNull();
      expect(Result.getOrThrow(lowerAppOrderedIndexPhysicalKeyV1(spec(true), document, time))).toBeNull();
    }
  });

  it("requires scalar equality or a lower bound that excludes null for read eligibility", () => {
    for (const value of [undefined, null, { lt: "z" }, { lte: 1 }, { gte: null }, { gte: null, lt: "z" }])
      expect(logicalValueRequiresNotNull(value)).toBe(false);
    for (const value of [false, 0, "", { gt: null }, { gt: false }, { gte: false }, { gte: 0 }, { gte: "" }])
      expect(logicalValueRequiresNotNull(value)).toBe(true);
  });
});
