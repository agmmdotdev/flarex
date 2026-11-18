import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { getSelectsAndRelationsFromObjectArray } from "@medusajs/framework/utils/portable";
import { captureShippingProfileDeletionMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileShippingOptionTypeUpdateContracts, decodeShippingOptionTypeUpdateInput, decodeShippingOptionTypeUpdateUpserts } from "../src/modules/fulfillment/shipping-option-type-update-input";
import { nativePreimageSelection } from "../src/workflow/preimage";

let contracts: Result.Result.Success<ReturnType<typeof compileShippingOptionTypeUpdateContracts>>;
const stamp = "2026-10-18T00:00:00.000Z";
const row = { id: "a", label: "Label", code: "custom", description: null, created_at: stamp, updated_at: stamp, deleted_at: null };
beforeAll(async () => {
  contracts = Result.getOrThrow(compileShippingOptionTypeUpdateContracts((await Effect.runPromise(captureShippingProfileDeletionMetadata())).frame));
});

describe("native ShippingOptionType update admission", () => {
  it("retains raw selector operands, ID retargeting, empty patches and native strings", () => {
    for (const input of [{ selector: { id: [] }, update: {} }, { selector: { id: ["c", "a", "c", "missing"] }, update: { id: "outside", label: "  ", code: "CuStOm", description: null } },
      { selector: { id: "a" }, update: { label: "", code: "", description: "" } }])
      expect(Result.getOrThrow(decodeShippingOptionTypeUpdateInput(input))).toEqual(input);
    expect(Result.getOrThrow(decodeShippingOptionTypeUpdateInput({ selector: { id: "a" }, update: { label: undefined, description: undefined } })))
      .toEqual({ selector: { id: "a" }, update: {} });
  });
  it("refuses broad selectors, excess raw operands, managed fields and nested writes", () => {
    for (const input of [{ selector: {}, update: {} }, { selector: { id: Array(5).fill("a") }, update: {} },
      { selector: { label: "Label" }, update: {} }, { selector: { id: "a" }, update: { label: null } },
      { selector: { id: "a" }, update: { metadata: {} } }, { selector: { id: "a" }, update: { created_at: stamp } },
      { selector: { id: "a" }, update: { shipping_options: [] } }]) expect(Result.isFailure(decodeShippingOptionTypeUpdateInput(input))).toBe(true);
  });
  it("admits bounded partial/full native upserts preserving duplicate IDs", () => {
    const input = [{ id: "a", label: "first" }, { id: "a", label: "last" }, { id: "missing", label: "New", code: "NEW", description: null }];
    expect(Result.getOrThrow(decodeShippingOptionTypeUpdateUpserts(input))).toEqual(input);
    expect(Result.getOrThrow(decodeShippingOptionTypeUpdateUpserts([{ id: "a", code: undefined }]))).toEqual([{ id: "a" }]);
    for (const malformed of [[{}], [{ label: "New", code: "NEW" }], [{ id: "a", updated_at: stamp }], [{ id: "a", deleted_at: null }], Array(5).fill({ id: "a" })])
      expect(Result.isFailure(decodeShippingOptionTypeUpdateUpserts(malformed))).toBe(true);
  });
  it("distinguishes complete active output, real projected preimages and physical upsert output", () => {
    expect(Result.getOrThrow(contracts.decodeRows([row]))).toEqual([row]);
    expect(Result.getOrThrow(contracts.decodePreimages([{ id: "a", description: null }]))).toEqual([{ id: "a", description: null }]);
    expect(Result.getOrThrow(contracts.decodePreimages([{ id: "a" }]))).toEqual([{ id: "a" }]);
    const deleted = { ...row, deleted_at: stamp };
    expect(Result.getOrThrow(contracts.decodeUpsertRows([deleted, deleted]))).toEqual([deleted, deleted]);
    for (const malformed of [[deleted], [row, row], [{ ...row, shipping_options: [] }]]) expect(Result.isFailure(contracts.decodeRows(malformed))).toBe(true);
    for (const field of Object.keys(row)) {
      const missing: Record<string, unknown> = { ...row }; delete missing[field];
      expect(Result.isFailure(contracts.decodeRows([missing]))).toBe(true);
      expect(Result.isFailure(contracts.decodeUpsertRows([missing]))).toBe(true);
    }
    for (const malformed of [[{}], [{ id: "a", code: 1 }], [{ id: "a", unknown: true }], [{ id: "a", deleted_at: stamp }]])
      expect(Result.isFailure(contracts.decodePreimages(malformed))).toBe(true);
  });
  it("uses native select derivation while retaining identity in exact scalar projections", () => {
    const read = { table: { name: "shipping_option_type", columns: contracts.table.columns.map(column => column.name), primaryKeys: ["id"], foreignKeys: [], companions: {} }, paths: [] };
    for (const [patch, fields] of [[{}, ["id"]], [{ description: null }, ["id", "description"]], [{ id: "outside", label: "New", code: "CUSTOM" }, ["id", "label", "code"]]] as const) {
      const selection = getSelectsAndRelationsFromObjectArray([patch]);
      expect(nativePreimageSelection({ select: selection.selects, relations: selection.relations }, read)).toEqual({ select: fields, relations: [] });
    }
  });
});
