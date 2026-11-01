import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { compileTaxCoreDefinition } from "../../../medusa-adapter/src/modules/tax/schema";
import { encodeDocumentId } from "flarex-protocol/document-id";
import type { CoreTableDefinition } from "../../src/core/api";
import { coreNativePolicyForTable } from "../../src/core/nativePolicy";
import { CoreNativeEligibilitySchema, coreNativeConstraintAccessFields, coreNativeEligibilityMatches,
  coreNativeEligibilityTerms, type CoreNativeEligibility } from "../../src/core/nativePolicyTypes";
import { coreNativeUniqueValues, planCoreNativeQuery } from "../../src/core/nativeQuery";

const target = { scopeUuid: "a2000000-0000-4000-8000-000000000001", epochUuid: "a2000000-0000-4000-8000-000000000002" };
const schemaId = Result.getOrThrow(encodeDocumentId(532, new Uint8Array(16).fill(5)));

describe("bounded native conditional eligibility", () => {
  it("retains the exact single-null stored shape and confines new conjunction grammar", () => {
    const decode = Schema.decodeUnknownResult(CoreNativeEligibilitySchema);
    const old = { field: "deleted_at", value: null };
    expect(Result.getOrThrow(decode(old))).toEqual(old);
    const all: CoreNativeEligibility = { all: [{ field: "deleted_at", value: null }, { field: "selected", value: true }] };
    expect(Result.getOrThrow(decode(all))).toEqual(all);
    expect(coreNativeEligibilityTerms(all)).toEqual(all.all);
    expect(coreNativeEligibilityMatches(all, { deleted_at: null, selected: true })).toBe(true);
    expect(coreNativeEligibilityMatches(all, { deleted_at: null, selected: false })).toBe(false);
    expect(coreNativeEligibilityMatches(all, { selected: true })).toBe(false);
    const allNull = { all: [{ field: "deleted_at", value: null }, { field: "parent_id", value: null }] };
    expect(Result.getOrThrow(decode(allNull))).toEqual(allNull);
    const text: CoreNativeEligibility = { all: [{ field: "deleted_at", value: null }, { field: "status", value: "active" }] };
    expect(Result.getOrThrow(decode(text))).toEqual(text);
    expect(coreNativeEligibilityTerms(text)).toEqual(text.all);
    expect(coreNativeEligibilityMatches(text, { deleted_at: null, status: "active" })).toBe(true);
    expect(coreNativeEligibilityMatches(text, { deleted_at: null, status: "draft" })).toBe(false);
    expect(coreNativeEligibilityMatches(text, { status: "active" })).toBe(false);
    expect(coreNativeEligibilityMatches(text, { deleted_at: "2026-11-01T00:00:00.000Z", status: "active" })).toBe(false);
    for (const input of [
      { field: "selected", value: true },
      { all: [{ field: "deleted_at", value: null }] },
      { all: [{ field: "deleted_at", value: null }, { field: "deleted_at", value: null }] },
      { all: [{ field: "selected", value: true }, { field: "other", value: false }] },
      { field: "status", value: "active" },
      { all: [{ field: "deleted_at", value: null }, { field: "status", value: "active" }, { field: "other", value: null }] },
      { all: [{ field: "deleted_at", value: null }, { field: "deleted_at", value: "active" }] },
      { all: [{ field: "status", value: "active" }, { field: "deleted_at", value: null }] },
      { all: [{ field: "deleted_at", value: null }, { field: "status", value: 1 }] },
      { all: [{ field: "deleted_at", value: null }, { field: "status", value: { eq: "active" } }] },
      { all: [{ field: "deleted_at", value: null }, { field: "status", value: "active", extra: true }] },
      { all: [{ field: "deleted_at", value: null }, { field: "status", value: "active" }], extra: true },
    ]) expect(Result.isFailure(decode(input))).toBe(true);
  });

  it("keeps a text eligibility prefix separate from nullable business keys", () => {
    const constraint = { descriptor: "live-alias", fields: ["alias"], indexName: "live_alias", nullsDistinct: true,
      eligibility: { all: [{ field: "deleted_at", value: null }, { field: "status", value: "active" }] } } as const;
    expect(coreNativeConstraintAccessFields(constraint)).toEqual(["deleted_at", "status", "alias"]);
    expect(coreNativeConstraintAccessFields({ ...constraint, fields: ["status", "alias"] })).toEqual(["deleted_at", "status", "alias"]);
    expect(Result.getOrThrow(coreNativeUniqueValues(constraint, { deleted_at: null, status: "active", alias: "shared" }))).toEqual(["shared"]);
    expect(Result.getOrThrow(coreNativeUniqueValues(constraint, { deleted_at: null, status: "active", alias: null }))).toBeNull();
    expect(Result.getOrThrow(coreNativeUniqueValues(constraint, { deleted_at: null, status: "draft", alias: "shared" }))).toBeNull();
  });

  it("lowers genuine Tax all-null and active-default constraints independently of key nullness", async () => {
    const definition = await Effect.runPromise(compileTaxCoreDefinition(target));
    const region = definition.tables.find(table => table.localName === "tax_region");
    const rootCountry = region?.uniqueConstraints.find(constraint => constraint.fields.length === 1
      && constraint.fields[0] === "country_code");
    expect(rootCountry?.eligibility).toEqual({ all: [{ field: "deleted_at", value: null }, { field: "province_code", value: null }] });
    if (rootCountry === undefined) throw new Error("Missing genuine nullable-province constraint");
    expect(coreNativeConstraintAccessFields(rootCountry)).toEqual(["deleted_at", "province_code", "country_code"]);
    expect(Result.getOrThrow(coreNativeUniqueValues(rootCountry,
      { country_code: "us", province_code: null, deleted_at: null }))).toEqual(["us"]);
    expect(Result.getOrThrow(coreNativeUniqueValues(rootCountry,
      { country_code: null, province_code: null, deleted_at: null }))).toBeNull();
    expect(Result.getOrThrow(coreNativeUniqueValues(rootCountry,
      { country_code: "us", province_code: "ca", deleted_at: null }))).toBeNull();

    const rate = definition.tables.find(table => table.localName === "tax_rate");
    const schema = definition.schema.tables.find(table => table.tableName === rate?.name);
    if (rate === undefined || schema === undefined) throw new Error("Missing genuine Tax Rate schema");
    const selected: CoreTableDefinition = { name: rate.name, number: 10001, tabletId: new Uint8Array(16), namespace: null,
      state: "active", nativePolicy: coreNativePolicyForTable(definition, rate, "active", schemaId),
      indexes: schema.indexes.map((index, position) => ({ name: index.indexDescriptor, fields: index.fields,
        ref: { id: Uint8Array.of(position + 1) } })) };
    const activeDefault = rate.uniqueConstraints.find(constraint => constraint.eligibility !== undefined && "all" in constraint.eligibility);
    if (activeDefault === undefined) throw new Error("Missing genuine active-default constraint");
    expect(coreNativeConstraintAccessFields(activeDefault)).toEqual(["deleted_at", "is_default", "tax_region_id"]);
    expect(Result.getOrThrow(coreNativeUniqueValues(activeDefault,
      { deleted_at: null, is_default: true, tax_region_id: "region" }))).toEqual(["region"]);
    expect(Result.getOrThrow(coreNativeUniqueValues(activeDefault,
      { deleted_at: null, is_default: false, tax_region_id: "region" }))).toBeNull();
    expect(Result.getOrThrow(planCoreNativeQuery(selected,
      { deleted_at: null, is_default: true, tax_region_id: "region" }))).toMatchObject({ kind: "unique", values: ["region"] });
    expect(Result.getOrThrow(planCoreNativeQuery(selected,
      { deleted_at: null, is_default: false, tax_region_id: "region" })).kind).not.toBe("unique");
  });
});
