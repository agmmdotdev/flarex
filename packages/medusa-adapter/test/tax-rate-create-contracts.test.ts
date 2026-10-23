import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureTaxMetadata } from "../src/modules/tax/schema";
import { compileTaxRateCreationContracts, decodeTaxRatePhysicalDeletionIds } from "../src/modules/tax/rate-create-input";
import { captureCommerceInput } from "../src/value/input";

let contracts: Result.Result.Success<ReturnType<typeof compileTaxRateCreationContracts>>;
const managed = { created_at: "2026-10-22T00:00:00.000Z", updated_at: "2026-10-22T00:00:00.000Z", deleted_at: null };
const input = { tax_region_id: "txreg-contract", name: "Contract Rate", code: "" };
const output = { ...input, id: "txr-contract", rate: null, is_default: false, is_combinable: false,
  metadata: null, created_by: null, ...managed, rules: [] };
const decode = (value: unknown) => captureCommerceInput(value).pipe(Result.flatMap(contracts.decodeInput));

beforeAll(async () => { contracts = Result.getOrThrow(compileTaxRateCreationContracts((await Effect.runPromise(captureTaxMetadata())).frame)); });

describe("bounded genuine Tax Rate creation contracts", () => {
  it("admits empty and complete four-Rate/eight-Rule input without changing caller values", () => {
    expect(Result.getOrThrow(decode([]))).toEqual([]);
    const rows = Array.from({ length: 4 }, (_, index) => ({ ...input, tax_region_id: `txreg-${index % 2}`,
      rate: 16777217, metadata: { nested: { ordinal: index }, list: [null, "x", 1] }, created_by: "parent-creator",
      rules: [{ reference: "product", reference_id: "prod-one", created_by: "child-creator", metadata: { child: index } },
        { reference: "", reference_id: "" }] }));
    const original = structuredClone(rows), decoded = Result.getOrThrow(decode(rows));
    expect(decoded).toEqual(original); expect(rows).toEqual(original);
    expect(decoded[0]).not.toBe(rows[0]); expect(decoded[0]?.rules).not.toBe(rows[0]?.rules);
  });

  it("retains supplied native IDs, timestamp strings, nulls and Boolean choices", () => {
    const rows = [{ ...input, id: "txr-supplied", ...managed, rate: null, is_default: true, is_combinable: true,
      created_by: null, metadata: null, rules: [{ id: "txrule-supplied", ...managed, reference: "product", reference_id: "prod-one" }] }];
    expect(Result.getOrThrow(decode(rows))).toEqual(rows);
  });

  it.each([
    ["non-array", input], ["null root", null], ["fifth Rate", Array.from({ length: 5 }, () => input)],
    ["third Region", [0, 1, 2].map(index => ({ ...input, tax_region_id: `txreg-${index}` }))],
    ["third Rule", [{ ...input, rules: Array.from({ length: 3 }, (_, index) => ({ reference: "product", reference_id: `prod-${index}` })) }]],
    ["missing code", [{ tax_region_id: input.tax_region_id, name: input.name }]],
    ["null code", [{ ...input, code: null }]], ["null Rules", [{ ...input, rules: null }]],
    ["missing Rule reference", [{ ...input, rules: [{ reference_id: "prod-one" }] }]],
    ["invalid Boolean", [{ ...input, is_default: "false" }]], ["invalid scalar", [{ ...input, rate: "1.2" }]],
    ["NaN", [{ ...input, rate: NaN }]], ["infinity", [{ ...input, rate: Infinity }]],
    ["invalid managed ID", [{ ...input, id: 12 }]], ["invalid metadata", [{ ...input, metadata: [] }]],
    ["unknown parent field", [{ ...input, unknown: true }]],
    ["unknown Rule field", [{ ...input, rules: [{ reference: "product", reference_id: "prod-one", unknown: true }] }]],
  ])("refuses %s before native workflow invocation", (_name, value) => {
    expect(Result.isFailure(decode(value))).toBe(true);
  });

  it("refuses accessors without evaluating caller code", () => {
    let invoked = false;
    const row = { ...input, get rate() { invoked = true; return 1; } };
    expect(Result.isFailure(decode([row]))).toBe(true); expect(invoked).toBe(false);
  });

  it("requires complete native immediate output and exactly empty Rule DTO relations", () => {
    expect(Result.getOrThrow(contracts.decodeOutput([output]))).toEqual([output]);
    expect(Result.getOrThrow(contracts.decodeOutput([output, output]))).toEqual([output, output]);
    const { metadata: _metadata, ...incomplete } = output;
    for (const value of [[incomplete], [{ ...output, unknown: true }],
      [{ ...output, rules: [{ id: "txrule-unexpected" }] }], [{ ...output, rate: Infinity }],
      [{ ...output, created_at: false }]]) expect(Result.isFailure(contracts.decodeOutput(value))).toBe(true);
  });

  it("keeps a bounded exact retained ID array and authenticates genuine Rate/Rule metadata", async () => {
    expect(Result.getOrThrow(decodeTaxRatePhysicalDeletionIds([]))).toEqual([]);
    expect(Result.isFailure(decodeTaxRatePhysicalDeletionIds(["one", "two", "three", "four", "five"]))).toBe(true);
    const metadata = (await Effect.runPromise(captureTaxMetadata())).frame;
    expect(Result.isFailure(compileTaxRateCreationContracts({ ...metadata,
      tables: metadata.tables.filter(table => table.name !== "tax_rate_rule") }))).toBe(true);
  });
});
