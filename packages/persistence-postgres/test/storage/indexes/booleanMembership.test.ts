import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { AppOrderedIndexPhysicalSpecV1Schema } from "flarex-protocol/ordered-index";
import { Schema } from "effect";
import { lowerAppOrderedIndexPhysicalKeyV1 } from "../../../src/storage/indexes/appDeveloperIndexKeys";

const creationTime = decodeAppCreationTimeV1(1);
const spec = (value: boolean) => Schema.decodeUnknownSync(AppOrderedIndexPhysicalSpecV1Schema)({
  kind: "appOrdered", specVersion: 1, accessPath: "developer", keyCodecVersion: 1,
  collation: "binaryUtf8", maxEncodedKeyBytes: 2048,
  orderedFields: [{ kind: "documentPath", path: "parent" }, { kind: "systemCreationTime" }],
  tieBreaker: { kind: "separateRowIdentity", byteLength: 16 },
  predicate: { kind: "fieldIsNullAndBooleanEquals", nullField: "deleted_at", booleanField: "selected", value },
});
const document = (fields: Record<string, unknown>) => canonicalizeAppDocumentV1({
  tableId: decodeCatalogTableId(1), rowId: decodeAppRowIdHexV1("ab".repeat(16)), creationTime, fields,
});

describe("Boolean partial ordered membership", () => {
  it.each([true, false])("uses strict Boolean %s membership before key encoding", async value => {
    const physical = spec(value);
    const project = async (fields: Record<string, unknown>) => lowerAppOrderedIndexPhysicalKeyV1(physical, await document(fields), creationTime);
    const key = Result.getOrThrow(await project({ parent: "p", deleted_at: null, selected: value }));
    expect(key).not.toBeNull();
    for (const selected of [!value, String(value), Number(value), null, undefined]) {
      const fields = { parent: "x".repeat(8000), deleted_at: null, ...(selected === undefined ? {} : { selected }) };
      expect(Result.getOrThrow(await project(fields))).toBeNull();
    }
    for (const deleted_at of ["deleted", undefined])
      expect(Result.getOrThrow(await project({ parent: "x".repeat(8000), selected: value,
        ...(deleted_at === undefined ? {} : { deleted_at }) }))).toBeNull();
    expect(Result.isFailure(await project({ parent: "x".repeat(8000), deleted_at: null, selected: value }))).toBe(true);
    expect(Result.getOrThrow(await project({ parent: "p", deleted_at: null, selected: value }))).toBe(key);
  });
});
