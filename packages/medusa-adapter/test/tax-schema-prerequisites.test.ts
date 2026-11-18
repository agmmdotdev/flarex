import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { TaxProvider, TaxRate, TaxRateRule, TaxRegion } from "@medusajs/tax/models";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { compileLogicalSourceIndexes, compileLogicalSourceUniqueConstraints } from "flarex-protocol/internal/logical-storage-requirements";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { decodeCompiledDml } from "../src/schema/compiled";
import { lowerDmlSchema } from "../src/schema/lower";
import { compileCompleteRow, compileRowProjection } from "../src/value/complete-row";

const models = [TaxProvider, TaxRate, TaxRateRule, TaxRegion];
const source = () => compileDmlSchema(models);
const checkedSource = () => Effect.runPromise(decodeCompiledDml(JSON.parse(JSON.stringify(source()))));

describe("complete genuine Tax DML prerequisites", () => {
  it("preserves the four native models, source checks and scalar float declaration", async () => {
    const original = source(), before = JSON.stringify(original);
    const checked = await Effect.runPromise(decodeCompiledDml(JSON.parse(before)));
    expect(checked.tables.map(table => table.name)).toEqual(["tax_provider", "tax_rate", "tax_rate_rule", "tax_region"]);
    expect(checked.tables.find(table => table.name === "tax_region")?.checks).toEqual([
      { name: "CK_tax_region_provider_top_level", expression: "parent_id IS NULL OR provider_id IS NULL" },
      { name: "CK_tax_region_country_top_level", expression: "parent_id IS NULL OR province_code IS NOT NULL" },
    ]);
    const rate = checked.tables.find(table => table.name === "tax_rate")?.columns.find(column => column.name === "rate");
    expect(rate).toMatchObject({ type: "float", nullable: true, primaryKey: false });
    expect(rate).not.toHaveProperty("defaultValue");
    expect(JSON.stringify(original)).toBe(before);
  });

  it("lowers native checks and all-null/Boolean indexes into scoped logical definitions", async () => {
    const checked = await checkedSource();
    const schema = Result.getOrThrow(normalizeRelationalSchema(lowerDmlSchema(checked.tables, "tax-schema-prerequisite")));
    const region = schema.tables.find(table => table.identity.tableId === "tax_region");
    expect(region?.constraints.filter(constraint => constraint.kind === "nullImplication")).toEqual([
      expect.objectContaining({ identity: expect.objectContaining({ constraintId: "CK_tax_region_country_top_level" }),
        nonNullColumn: expect.objectContaining({ tableId: "tax_region", columnId: "parent_id" }),
        requiredColumn: expect.objectContaining({ tableId: "tax_region", columnId: "province_code" }), required: "notNull",
        origin: { kind: "authored", sourceId: "CK_tax_region_country_top_level" } }),
      expect.objectContaining({ identity: expect.objectContaining({ constraintId: "CK_tax_region_provider_top_level" }),
        nonNullColumn: expect.objectContaining({ tableId: "tax_region", columnId: "parent_id" }),
        requiredColumn: expect.objectContaining({ tableId: "tax_region", columnId: "provider_id" }), required: "null",
        origin: { kind: "authored", sourceId: "CK_tax_region_provider_top_level" } }),
    ]);
    expect(region?.indexes.find(index => index.identity.indexId === "IDX_tax_region_unique_country_nullable_province")?.predicate)
      .toMatchObject({ kind: "allNull", columns: [{ columnId: "deleted_at" }, { columnId: "province_code" }] });
    const rates = schema.tables.find(table => table.identity.tableId === "tax_rate");
    expect(rates?.columns.find(column => column.identity.columnId === "rate"))
      .toMatchObject({ type: "real", nullable: true, default: { kind: "none" } });
    expect(rates?.indexes.find(index => index.identity.indexId === "IDX_single_default_region")?.predicate)
      .toMatchObject({ kind: "isNullAndBooleanEquals", nullColumn: { columnId: "deleted_at" }, booleanColumn: { columnId: "is_default" }, value: true });
    const logical = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.tax-schema-prerequisite", owner: "medusa",
      writeProfile: "tax-schema-prerequisite", evidence: { kind: "synthetic", sourceId: "genuine-tax-model-prerequisite" },
      definition: { kind: "relational", schema }, bindings: checked.tables.map(table => ({ kind: "definition", localName: table.name,
        table: { namespace: "medusa", logicalName: "tax-schema-prerequisite/" + table.name } })) }));
    const ordered = Result.getOrThrow(compileLogicalSourceIndexes(logical));
    const unique = Result.getOrThrow(compileLogicalSourceUniqueConstraints(logical));
    expect(unique.filter(item => item.physicalSpec.predicate?.kind === "fieldsAreNull"))
      .toMatchObject([{ localName: "tax_region", physicalSpec: { orderedFields: ["country_code"],
        predicate: { kind: "fieldsAreNull", fields: ["deleted_at", "province_code"] } } }]);
    expect(unique.filter(item => item.physicalSpec.predicate?.kind === "fieldIsNullAndBooleanEquals"))
      .toMatchObject([{ localName: "tax_rate", physicalSpec: { orderedFields: ["tax_region_id"],
        predicate: { kind: "fieldIsNullAndBooleanEquals", nullField: "deleted_at", booleanField: "is_default", value: true } } }]);
    expect(ordered.some(item => item.localName === "tax_rate" && item.physicalSpec.orderedFields.some(field =>
      field.kind === "documentPath" && field.path === "rate"))).toBe(false);
  });

  it("leaves referenced columns, duplicate-null predicates and check identities to neutral validation", async () => {
    const checked = await checkedSource();
    const mutate = (kind: "missingColumn" | "sameColumn" | "duplicateNull") => ({ tables: checked.tables.map(table => table.name !== "tax_region" ? table : {
      ...table,
      checks: kind === "duplicateNull" ? table.checks : [{ name: "neutral_bad_check", expression: kind === "sameColumn"
        ? "parent_id IS NULL OR parent_id IS NOT NULL" : "missing_id IS NULL OR province_code IS NOT NULL" }],
      indexes: kind !== "duplicateNull" ? table.indexes : table.indexes.map(index => index.name === "IDX_tax_region_unique_country_nullable_province"
        ? { ...index, where: "deleted_at IS NULL AND deleted_at IS NULL" } : index),
    }) });
    for (const kind of ["missingColumn", "sameColumn", "duplicateNull"] as const) {
      const metadata = await Effect.runPromise(decodeCompiledDml(mutate(kind)));
      expect(Result.isFailure(normalizeRelationalSchema(lowerDmlSchema(metadata.tables, "tax-invalid-" + kind)))).toBe(true);
    }
  });

  it("refuses every float default rather than coercing it to a binary64 literal", async () => {
    const checked = await checkedSource();
    for (const defaultValue of [0, 0.1, null, "0", false, {}]) {
      const input = { tables: checked.tables.map(table => table.name !== "tax_rate" ? table : { ...table,
        columns: table.columns.map(column => column.name === "rate" ? { ...column, defaultValue } : column),
      }) };
      expect(Result.isFailure(await Effect.runPromise(Effect.result(decodeCompiledDml(input))))).toBe(true);
    }
  });

  it("checks complete native Rate DTOs without changing their finite wire numbers", async () => {
    const checked = await checkedSource(), rate = checked.tables.find(table => table.name === "tax_rate");
    if (rate === undefined) throw new Error("Genuine TaxRate table missing");
    const complete = Result.getOrThrow(compileCompleteRow(rate)), projection = Result.getOrThrow(compileRowProjection(rate));
    const row = { id: "txr-schema", rate: 0.1, code: "NATIVE", name: "Native rate", is_default: true, is_combinable: false,
      tax_region_id: "txreg-schema", metadata: null, created_by: null, created_at: "2026-10-22T00:00:00.000Z",
      updated_at: "2026-10-22T00:00:00.000Z", deleted_at: null };
    expect(Object.keys(row).toSorted()).toEqual(rate.columns.map(column => column.name).toSorted());
    for (const value of [null, 0, 0.1, 1e-45, 1.00000006, 1.0000001, 3.4028235e38]) {
      expect(Result.getOrThrow(complete({ ...row, rate: value })).rate).toBe(value);
      expect(Result.getOrThrow(projection({ rate: value })).rate).toBe(value);
    }
    for (const value of [NaN, Infinity, -Infinity, "0.1", true, {}, []])
      expect(complete({ ...row, rate: value })).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    expect(Result.isFailure(complete({ ...row, unexpected: true }))).toBe(true);
    expect(Result.isFailure(complete({ id: row.id }))).toBe(true);
  });
});
