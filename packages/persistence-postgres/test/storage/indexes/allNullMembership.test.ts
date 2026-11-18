import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { AppOrderedIndexPhysicalSpecV1Schema } from "flarex-protocol/ordered-index";
import { lowerAppOrderedIndexPhysicalKeyV1 } from "../../../src/storage/indexes/appDeveloperIndexKeys";

const time = decodeAppCreationTimeV1(1);
const spec = Schema.decodeUnknownSync(AppOrderedIndexPhysicalSpecV1Schema)({
  kind: "appOrdered", specVersion: 1, accessPath: "developer", keyCodecVersion: 1,
  collation: "binaryUtf8", maxEncodedKeyBytes: 2048,
  orderedFields: [{ kind: "documentPath", path: "key" }, { kind: "systemCreationTime" }],
  tieBreaker: { kind: "separateRowIdentity", byteLength: 16 },
  predicate: { kind: "fieldsAreNull", fields: ["province", "retired"] },
});
const project = async (province: unknown, retired: unknown, key = "retained") => {
  const document = await canonicalizeAppDocumentV1({ tableId: decodeCatalogTableId(1),
    rowId: decodeAppRowIdHexV1("ab".repeat(16)), creationTime: time,
    fields: { key, ...(province === undefined ? {} : { province }), ...(retired === undefined ? {} : { retired }) } });
  return lowerAppOrderedIndexPhysicalKeyV1(spec, document, time);
};

describe("two-null ordered membership", () => {
  for (const province of [null, undefined, "province", false, 0]) for (const retired of [null, undefined, "deleted", false, 0])
    it(`requires explicit nulls (${String(province)}, ${String(retired)}) before key encoding`, async () => {
      if (province === null && retired === null) {
        expect(Result.getOrThrow(await project(province, retired))).not.toBeNull();
        expect(Result.isFailure(await project(province, retired, "x".repeat(8000)))).toBe(true);
      } else expect(Result.getOrThrow(await project(province, retired, "x".repeat(8000)))).toBeNull();
    });
});
