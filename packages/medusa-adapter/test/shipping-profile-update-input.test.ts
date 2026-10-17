import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { getSelectsAndRelationsFromObjectArray } from "@medusajs/framework/utils/portable";
import { captureShippingProfileMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileShippingProfileUpdateContracts, decodeShippingProfileUpdateInput, decodeShippingProfileUpdateUpserts } from "../src/modules/fulfillment/shipping-profile-update-input";
import { nativePreimageSelection } from "../src/workflow/preimage";

let contracts: Result.Result.Success<ReturnType<typeof compileShippingProfileUpdateContracts>>;
const stamp = "2026-10-17T00:00:00.000Z";
const row = { id: "sp-a", name: "Name", type: "custom", metadata: null, created_at: stamp, updated_at: stamp, deleted_at: null };
beforeAll(async () => {
  contracts = Result.getOrThrow(compileShippingProfileUpdateContracts((await Effect.runPromise(captureShippingProfileMetadata())).frame));
});

describe("native ShippingProfile update admission", () => {
  it("retains raw selector membership, empty patches and native business strings", () => {
    for (const input of [{ selector: { id: [] }, update: {} }, { selector: { id: ["sp-b", "missing", "sp-a", "sp-b"] },
      update: { name: "  ", type: "CuStOm", metadata: { keep: true, remove: "" } } },
      { selector: { id: "sp-a" }, update: { name: "", type: "", metadata: {} } },
      { selector: { id: "sp-a" }, update: { metadata: null } }])
      expect(Result.getOrThrow(decodeShippingProfileUpdateInput(input))).toEqual(input);
    expect(Result.getOrThrow(decodeShippingProfileUpdateInput({ selector: { id: "sp-a" }, update: { name: undefined, metadata: undefined } })))
      .toEqual({ selector: { id: "sp-a" }, update: {} });
  });
  it("refuses broad selectors, excess raw operands, managed fields and relationships", () => {
    for (const input of [{ selector: {}, update: {} }, { selector: { id: Array(5).fill("sp-a") }, update: {} },
      { selector: { name: "Name" }, update: {} }, { selector: { id: "sp-a" }, update: { name: null } },
      { selector: { id: "sp-a" }, update: { metadata: [] } }, { selector: { id: "sp-a" }, update: { created_at: stamp } },
      { selector: { id: "sp-a" }, update: { shipping_options: [] } }])
      expect(Result.isFailure(decodeShippingProfileUpdateInput(input))).toBe(true);
  });
  it("admits only bounded existing-ID inverse inputs while retaining native repeated IDs", () => {
    const input = [{ id: "sp-a", type: "first" }, { id: "sp-a", type: "last" }];
    expect(Result.getOrThrow(decodeShippingProfileUpdateUpserts(input))).toEqual(input);
    expect(Result.getOrThrow(decodeShippingProfileUpdateUpserts([{ id: "sp-a", metadata: undefined }]))).toEqual([{ id: "sp-a" }]);
    for (const malformed of [[{}], [{ name: "Create", type: "custom" }], [{ id: "sp-a", updated_at: stamp }],
      [{ id: "sp-a", deleted_at: null }], Array(5).fill({ id: "sp-a" })])
      expect(Result.isFailure(decodeShippingProfileUpdateUpserts(malformed))).toBe(true);
  });
  it("requires complete DML results before projection and checks projected identity and values", () => {
    expect(Result.getOrThrow(contracts.decodeRows([row]))).toEqual([row]);
    expect(Result.getOrThrow(contracts.decodePreimages([{ id: row.id, type: "custom" }]))).toEqual([{ id: row.id, type: "custom" }]);
    for (const field of Object.keys(row)) {
      const missing: Record<string, unknown> = { ...row }; delete missing[field];
      expect(Result.isFailure(contracts.decodeRows([missing]))).toBe(true);
    }
    for (const malformed of [[{ ...row, extra: true }], [{ ...row, type: null }], [{ ...row, deleted_at: stamp }], [row, row],
      [{ ...row, created_at: 1 }], [{ id: row.id, type: 1 }], [{}]])
      expect(Result.isFailure(contracts.decodePreimages(malformed))).toBe(true);
  });
  it("uses the genuine native helper and shared scalar preimage selection for metadata caveats", () => {
    const read = { table: { name: "shipping_profile", columns: contracts.table.columns.map(column => column.name),
      primaryKeys: ["id"], foreignKeys: [], companions: {} }, paths: [] };
    for (const [patch, fields] of [[{}, ["id"]], [{ metadata: {} }, ["id"]],
      [{ metadata: { keep: true, nested: { replace: true } } }, ["id"]], [{ metadata: null }, ["id", "metadata"]],
      [{ name: "New", type: "custom" }, ["id", "name", "type"]]] as const) {
      const selection = getSelectsAndRelationsFromObjectArray([patch]);
      expect(nativePreimageSelection({ select: selection.selects, relations: selection.relations }, read))
        .toEqual({ select: fields, relations: [] });
    }
  });
});
