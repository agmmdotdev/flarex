import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { validateAndNormalizeRules } from "@medusajs/fulfillment/rule-validation";
import { captureServiceZoneCreationMetadata, captureShippingProfileDeletionMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileShippingOptionRuleContracts, ShippingOptionRuleBatchInput, decodeShippingOptionRuleCreates,
  decodeShippingOptionRuleUpdates, decodeShippingOptionRuleIds } from "../src/modules/fulfillment/shipping-option-rule-input";

let contracts: Result.Result.Success<ReturnType<typeof compileShippingOptionRuleContracts>>;
const stamp = "2026-10-18T00:00:00.000Z";
const scalar = { id: "rule-a", attribute: " Raw Attribute ", operator: "eq", value: " Raw Value ", shipping_option_id: "option-a",
  created_at: stamp, updated_at: stamp, deleted_at: null };
beforeAll(async () => { contracts = Result.getOrThrow(compileShippingOptionRuleContracts(
  (await Effect.runPromise(captureServiceZoneCreationMetadata())).frame)); });

describe("native ShippingOptionRule structural and DML boundaries", () => {
  it("retains omitted/nullish branch inputs and raw duplicates without imposing disjointness", () => {
    const decode = Schema.decodeUnknownSync(ShippingOptionRuleBatchInput);
    for (const input of [{}, { create: null, update: null, delete: null }, { create: [], update: [], delete: [] },
      { create: [{ id: "same", attribute: "a", operator: "eq", value: true, shipping_option_id: "o" }],
        update: [{ id: "same", attribute: "a", operator: "eq", value: 1 }], delete: ["same", "missing", "same"] }])
      expect(decode(input)).toEqual(input);
    expect(Result.getOrThrow(decodeShippingOptionRuleUpdates([{ id: "z" }, { id: "a" }, { id: "z" }]))).toEqual([{ id: "z" }, { id: "a" }, { id: "z" }]);
    expect(Result.getOrThrow(decodeShippingOptionRuleIds(["မြန်မာ", "missing", "မြန်မာ"]))).toEqual(["မြန်မာ", "missing", "မြန်မာ"]);
  });

  it("leaves actual native business refusals and whole-array normalization order with Medusa", () => {
    for (const value of [false, 0, null, "", [], { opaque: true }]) {
      const input = [{ attribute: "a", operator: "eq", value }];
      expect(Result.getOrThrow(decodeShippingOptionRuleCreates(input))).toEqual(input);
      // SAFETY: this directly exercises wider native runtime values beyond the
      // public Rule alias; no structural assertion substitutes for validation.
      expect(() => validateAndNormalizeRules(input as Parameters<typeof validateAndNormalizeRules>[0])).toThrow();
    }
    const input = [{ attribute: "a", operator: "eq", value: true }, { attribute: "a", operator: "eq", value: false }];
    // SAFETY: same genuine wider runtime characterization as above.
    expect(() => validateAndNormalizeRules(input as unknown as Parameters<typeof validateAndNormalizeRules>[0])).toThrow();
    expect(input[0]?.value).toBe(true);
    const valid = [{ attribute: "a", operator: "eq", value: true }];
    // SAFETY: native normalization mutates a boolean into a string.
    validateAndNormalizeRules(valid as unknown as Parameters<typeof validateAndNormalizeRules>[0]);
    expect(valid[0]?.value).toBe("true");
  });

  it("refuses managed/relation/unknown keys and per-action envelopes above four", () => {
    for (const field of ["created_at", "updated_at", "deleted_at", "shipping_option", "foreign"])
      expect(Result.isFailure(decodeShippingOptionRuleCreates([{ attribute: "a", operator: "eq", value: "v", [field]: null }]))).toBe(true);
    for (const input of [null, {}, [{ id: "" }], [{ attribute: 1 }], Array(5).fill({})])
      expect(Result.isFailure(decodeShippingOptionRuleCreates(input))).toBe(true);
    expect(Result.isFailure(decodeShippingOptionRuleUpdates([{}]))).toBe(true);
    expect(Result.isFailure(decodeShippingOptionRuleIds(Array(5).fill("a")))).toBe(true);
  });

  it("validates full scalar returns before projected preimages and SDK empty markers", () => {
    expect(Result.getOrThrow(contracts.decodeRows([scalar]))).toEqual([scalar]);
    const { created_at: _created, updated_at: _updated, deleted_at: _deleted, ...preimage } = scalar;
    expect(Result.getOrThrow(contracts.decodePreimages([preimage]))).toEqual([preimage]);
    for (const key of Object.keys(scalar)) {
      const missing: Record<string, unknown> = { ...scalar }; delete missing[key];
      expect(Result.isFailure(contracts.decodeRows([missing]))).toBe(true);
    }
    for (const row of [{ ...scalar, foreign: 1 }, { ...scalar, operator: "invented" }, { ...scalar, shipping_option_id: null },
      { ...scalar, deleted_at: stamp }]) expect(Result.isFailure(contracts.decodeRows([row]))).toBe(true);
    expect(Result.isFailure(contracts.decodeRows([scalar, scalar]))).toBe(true);
    const decodeOutput = Schema.decodeUnknownSync(contracts.Output), marker = { __type: "Symbol(WorkflowWorkflowData)" };
    expect(decodeOutput({ created: [], deleted: marker, updated: marker })).toEqual({ created: [], deleted: marker, updated: marker });
    for (const output of [{ created: [] }, { created: [], updated: null, deleted: null },
      { created: [], updated: marker, deleted: { __type: "invented" } }]) expect(() => decodeOutput(output)).toThrow();
  });

  it("refuses changed required Option FK, ID prefix or incomplete source inventory", async () => {
    const frame = (await Effect.runPromise(captureServiceZoneCreationMetadata())).frame;
    expect(Result.isFailure(compileShippingOptionRuleContracts((await Effect.runPromise(captureShippingProfileDeletionMetadata())).frame))).toBe(true);
    for (const replacement of [
      { ...contracts.table, foreignKeys: [] },
      { ...contracts.table, foreignKeys: contracts.table.foreignKeys.map(fk => ({ ...fk, referencedTable: "shipping_profile" })) },
      { ...contracts.table, columns: contracts.table.columns.map(column => column.name === "shipping_option_id" ? { ...column, nullable: true } : column) },
      { ...contracts.table, columns: contracts.table.columns.map(column => column.name === "id" ? { ...column, options: { prefix: "other" } } : column) },
    ]) expect(Result.isFailure(compileShippingOptionRuleContracts({ ...frame,
      tables: frame.tables.map(table => table.name === replacement.name ? replacement : table) }))).toBe(true);
  });
});
