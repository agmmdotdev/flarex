import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { captureTaxMetadata } from "../src/modules/tax/schema";
import { compileTaxRegionCreationContracts } from "../src/modules/tax/region-create-input";
import { compileTaxRateCreationContracts } from "../src/modules/tax/rate-create-input";
import { captureCommerceInput } from "../src/value/input";

let contracts: Result.Result.Success<ReturnType<typeof compileTaxRegionCreationContracts>>;
const managed = { created_at: "2026-10-24T00:00:00.000Z", updated_at: "2026-10-24T00:00:00.000Z", deleted_at: null };
const decode = (input: unknown) => captureCommerceInput(input).pipe(Result.flatMap(contracts.decodeInput));
const regionOutput = () => {
  return { id: "txreg-contract", country_code: " us ", province_code: null, metadata: null, created_by: null,
    ...managed, children: [], tax_rates: [] };
};

beforeAll(async () => {
  contracts = Result.getOrThrow(compileTaxRegionCreationContracts((await Effect.runPromise(captureTaxMetadata())).frame));
});

describe("bounded native Tax Region creation contracts", () => {
  it("admits empty and four-Region/four-Rate/eight-Rule inputs without changing native values", () => {
    expect(Result.getOrThrow(decode([]))).toEqual([]);
    const roots = Array.from({ length: 4 }, (_, index) => ({
      country_code: ` X-${index} `, province_code: " Province ", created_by: "region-creator", metadata: { nested: [index, null] },
      default_tax_rate: { id: `txr-${index}`, tax_region_id: "native-overwrites", name: "Rate", code: "", rate: 16777217,
        is_default: false, is_combinable: true, created_by: "native-overwrites", ...managed,
        rules: [{ reference: "product", reference_id: "prod-one", tax_rate_id: "native-overwrites", created_by: "native-overwrites" },
          { reference: "", reference_id: "", metadata: { ordinal: index } }] },
    }));
    const original = structuredClone(roots), actual = Result.getOrThrow(decode(roots));
    expect(actual).toEqual(original); expect(roots).toEqual(original);
    expect(actual[0]).not.toBe(roots[0]); expect(actual[0]?.default_tax_rate).not.toBe(roots[0]?.default_tax_rate);
  });

  it.each([
    ["missing country", {}], ["null country", { country_code: null }], ["numeric country", { country_code: 42 }],
    ["null parent", { country_code: "US", parent_id: null }],
    ["missing required Rate values", { country_code: "US", default_tax_rate: {} }],
    ["null required Rate values", { country_code: "US", default_tax_rate: { name: null, code: null } }],
    ["malformed scalar siblings", { country_code: "US", id: 3, metadata: [], default_tax_rate: { name: {}, code: 4, rate: "bad", is_combinable: [] } }],
    ["null Rules", { country_code: "US", default_tax_rate: { rules: null } }],
    ["object Rules", { country_code: "US", default_tax_rate: { rules: { not: "an array" } } }],
    ["string Rules", { country_code: "US", default_tax_rate: { rules: "native-map-failure" } }],
    ["malformed Rule scalars", { country_code: "US", default_tax_rate: { rules: [{ reference: false, reference_id: null }, null] } }],
    ["null default Rate", { country_code: "US", default_tax_rate: null }],
  ])("leaves %s to native normalization or actual complete-row acceptance", (_name, value) => {
    expect(Result.getOrThrow(decode([value]))).toEqual([value]);
  });

  it.each([
    ["scalar root", { country_code: "US" }], ["null root", null], ["null Region", [null]],
    ["fifth Region", Array.from({ length: 5 }, () => ({ country_code: "US" }))],
    ["non-object default Rate", [{ country_code: "US", default_tax_rate: 1 }]],
    ["third Rule", [{ country_code: "US", default_tax_rate: { rules: [{}, {}, {}] } }]],
    ["unknown Region scalar", [{ country_code: "US", extra: 1 }]],
    ["unknown Rate scalar", [{ country_code: "US", default_tax_rate: { extra: 1 } }]],
    ["unknown Rule scalar", [{ country_code: "US", default_tax_rate: { rules: [{ extra: 1 }] } }]],
  ])("refuses the unsupported %s boundary", (_name, value) => {
    expect(Result.isFailure(decode(value))).toBe(true);
    expect(Result.isFailure(Schema.decodeUnknownResult(contracts.Input, { onExcessProperty: "error" })(value))).toBe(true);
  });

  it("keeps bounded capture outside the decoder and never evaluates caller getters", () => {
    let called = false;
    const value = { country_code: "US", default_tax_rate: { get rules() { called = true; return []; } } };
    expect(Result.isFailure(decode([value]))).toBe(true); expect(called).toBe(false);
    const omissions: string[][] = [];
    const captured = captureCommerceInput([{ country_code: "US", created_by: undefined,
      default_tax_rate: { created_by: undefined, rules: [] } }], undefined, path => omissions.push([...path]));
    const actual = Result.getOrThrow(captured.pipe(Result.flatMap(contracts.decodeInput)));
    expect(actual).toEqual([{ country_code: "US", default_tax_rate: { rules: [] } }]);
    expect(omissions).toEqual([["0", "created_by"], ["0", "default_tax_rate", "created_by"]]);
  });

  it("validates full scalar output while preserving native omitted nullable references and empty collections", () => {
    const omitted = regionOutput(), explicit = { ...omitted, parent_id: null, provider_id: "tp-persisted" };
    expect(Result.getOrThrow(contracts.decodeOutput([omitted, explicit, omitted]))).toEqual([omitted, explicit, omitted]);
    const actual = Result.getOrThrow(contracts.decodeOutput([omitted]));
    expect(actual[0]?.id).toBe("txreg-contract");
    expect(Object.hasOwn(actual[0] ?? {}, "parent_id")).toBe(false);
    expect(Object.hasOwn(actual[0] ?? {}, "provider_id")).toBe(false);
    const { children: _children, tax_rates: _rates, ...scalar } = omitted;
    expect(Result.getOrThrow(contracts.decodeRegionRow({ ...scalar, parent_id: null, provider_id: null })).id).toBe("txreg-contract");
    expect(contracts.regionDefaults).toEqual({ province_code: null, metadata: null, created_by: null, provider_id: null, parent_id: null });
  });

  it("rejects corrupted scalar bodies and relation population before returning output", () => {
    const output = regionOutput(), { metadata: _metadata, ...missing } = output;
    for (const value of [[missing], [{ ...output, country_code: 1 }], [{ ...output, provider_id: 2 }],
      [{ ...output, children: [{ id: "txreg-child" }] }], [{ ...output, tax_rates: [{ id: "txr-child" }] }],
      [{ ...output, extra: true }], [{ ...output, created_at: null }], [{ ...output, id: "" }],
      Array.from({ length: 5 }, () => output)]) {
      expect(Result.isFailure(contracts.decodeOutput(value))).toBe(true);
      expect(Result.isFailure(Schema.decodeUnknownResult(contracts.Output)(value))).toBe(true);
    }
    const { children: _children, tax_rates: _rates, ...stored } = output;
    expect(Result.isFailure(contracts.decodeRegionRow(stored))).toBe(true);
    expect(Result.getOrThrow(contracts.decodeRegionRow({ ...stored, parent_id: null, provider_id: null })).id).toBe("txreg-contract");
  });

  it("keeps Provider support read-only and decodes its complete DML row", () => {
    const provider = { id: "tp-persisted", is_enabled: false, ...managed };
    expect(Result.getOrThrow(contracts.decodeProviderRow(provider))).toEqual(provider);
    expect(Result.isFailure(contracts.decodeProviderRow({ ...provider, is_enabled: 1 }))).toBe(true);
    const { is_enabled: _enabled, ...missing } = provider;
    expect(Result.isFailure(contracts.decodeProviderRow(missing))).toBe(true);
  });

  it("uses exact retained requests and bounds the complete current inverse beyond the forward graph", async () => {
    expect(Result.getOrThrow(contracts.decodePhysicalIds(["root", "root"]))).toEqual(["root", "root"]);
    expect(Result.getOrThrow(contracts.decodePhysicalIds([]))).toEqual([]);
    expect(Result.isFailure(contracts.decodePhysicalIds(["1", "2", "3", "4", "5"]))).toBe(true);
    expect(Result.isFailure(contracts.decodePhysicalSelection({ $or: [{ id: "root" }], deleted_at: null }))).toBe(true);
    expect(contracts.entities.map(entity => [entity.model, entity.maximum])).toEqual([["TaxRegion", 8], ["TaxRate", 8], ["TaxRateRule", 16]]);
    expect(contracts.entities.some(entity => entity.model === "TaxProvider")).toBe(false);
    const metadata = (await Effect.runPromise(captureTaxMetadata())).frame;
    expect(Result.isFailure(compileTaxRegionCreationContracts({ ...metadata,
      tables: metadata.tables.filter(table => table.name !== "tax_provider") }))).toBe(true);
    expect(Result.isFailure(compileTaxRegionCreationContracts({ ...metadata, tables: metadata.tables.map(table => table.name === "tax_region"
      ? { ...table, foreignKeys: table.foreignKeys.filter(key => key.referencedTable !== "tax_region") } : table) }))).toBe(true);
    const independent = Result.getOrThrow(compileTaxRateCreationContracts(metadata));
    expect(Result.isFailure(independent.decodeInput([0, 1, 2].map(index => ({ tax_region_id: `txreg-${index}`, name: "Rate", code: "" }))))).toBe(true);
  });
});