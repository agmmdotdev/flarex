import { Result } from "effect";
import { expect } from "vitest";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { APP_UNIQUE_KEY_CODEC_IDENTITY_V1, APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1 } from "flarex-protocol/app-unique-constraint-definition";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../../../src/storage/unique/appUniqueConstraintDefinitions";
import { lowerCanonicalAppUniqueConstraintV1Result } from "../../../src/storage/unique/appUniqueConstraintCommitV1";

export const conditionalUniqueSpec = decodeAppUniqueConstraintPhysicalSpecV1({
  kind: "appUniqueConstraint", specVersion: 1, orderedFields: ["name"], sparse: false,
  predicate: { kind: "fieldIsNull", field: "deleted_at" },
  localePolicy: { kind: "none" }, keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1, keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
});

/** Only pure lowering is tested with alternate specs; no synthetic definition enters storage. */
export async function conditionalProjectionCases(definition: LocatedAppUniqueConstraintDefinitionV1) {
  const project = async (fields: Record<string, unknown>, spec = definition.physicalSpec) => {
    const document = await canonicalizeAppDocumentV1({ tableId: definition.tableId,
      rowId: decodeAppRowIdHexV1("ab".repeat(16)), creationTime: decodeAppCreationTimeV1(1), fields });
    return lowerCanonicalAppUniqueConstraintV1Result({ ...definition, physicalSpec: spec }, document);
  };
  for (const fields of [{ name: "shirt" }, { name: "shirt", deleted_at: "2026-01-01" },
    { name: "x".repeat(8000), deleted_at: "x".repeat(8000) }]) {
    expect(Result.getOrThrow(await project(fields))).toMatchObject({ kind: "omitted", reason: "predicateExcluded" });
  }
  expect(Result.isFailure(await project({ name: "x".repeat(8000), deleted_at: null }))).toBe(true);
  expect(Result.getOrThrow(await project({ name: "shirt", deleted_at: null })).kind).toBe("claim");
  for (const sparse of [false, true]) {
    const spec = decodeAppUniqueConstraintPhysicalSpecV1({ ...definition.physicalSpec,
      orderedFields: ["name", "nullable_key"], nullsDistinct: true, sparse });
    expect(Result.getOrThrow(await project({ name: "x".repeat(8000), nullable_key: null, deleted_at: null }, spec)))
      .toMatchObject({ kind: "omitted", reason: "nullDistinct" });
    expect(Result.getOrThrow(await project({ name: "shirt", deleted_at: null }, spec)))
      .toMatchObject(sparse ? { kind: "omitted", reason: "sparseMissing" } : { kind: "claim" });
  }
  const { predicate: _predicate, ...nativeSpec } = conditionalUniqueSpec;
  const native = decodeAppUniqueConstraintPhysicalSpecV1(nativeSpec);
  expect(Result.getOrThrow(await project({ name: null }, native)).kind).toBe("claim");
  const allNull = decodeAppUniqueConstraintPhysicalSpecV1({ ...definition.physicalSpec,
    orderedFields: ["name"], predicate: { kind: "fieldsAreNull", fields: ["deleted_at", "province"] } });
  expect(Result.getOrThrow(await project({ name: "shirt", deleted_at: null, province: null }, allNull)).kind).toBe("claim");
  for (const fields of [
    { name: "x".repeat(8000), deleted_at: null }, { name: "x".repeat(8000), province: null },
    { name: "x".repeat(8000), deleted_at: "deleted", province: null },
    { name: "x".repeat(8000), deleted_at: null, province: "province" },
  ]) expect(Result.getOrThrow(await project(fields, allNull))).toMatchObject({ kind: "omitted", reason: "predicateExcluded" });
  expect(Result.isFailure(await project({ name: "x".repeat(8000), deleted_at: null, province: null }, allNull))).toBe(true);
  for (const value of [true, false]) {
    const booleanSpec = decodeAppUniqueConstraintPhysicalSpecV1({ ...definition.physicalSpec,
      orderedFields: ["name"], predicate: { kind: "fieldIsNullAndBooleanEquals",
        nullField: "deleted_at", booleanField: "selected", value } });
    expect(Result.getOrThrow(await project({ name: "shirt", deleted_at: null, selected: value }, booleanSpec)).kind).toBe("claim");
    for (const selected of [!value, String(value), Number(value), null, undefined]) {
      expect(Result.getOrThrow(await project({ name: "x".repeat(8000), deleted_at: null,
        ...(selected === undefined ? {} : { selected }) }, booleanSpec)))
        .toMatchObject({ kind: "omitted", reason: "predicateExcluded" });
    }
    expect(Result.getOrThrow(await project({ name: "x".repeat(8000), deleted_at: "deleted", selected: value }, booleanSpec)))
      .toMatchObject({ kind: "omitted", reason: "predicateExcluded" });
    expect(Result.isFailure(await project({ name: "x".repeat(8000), deleted_at: null, selected: value }, booleanSpec))).toBe(true);
  }
}
