import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureShippingProfileDeletionMetadata, captureShippingProfileMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileShippingProfileCreationContracts, decodeShippingProfileCreates,
  decodeShippingProfilePhysicalDeletionIds } from "../src/modules/fulfillment/shipping-profile-create-input";
import { compileShippingProfileCreationOutput } from "../src/modules/fulfillment/shipping-profile-create-output";

let contracts: Result.Result.Success<ReturnType<typeof compileShippingProfileCreationContracts>>;
const stamp = "2026-10-18T00:00:00.000Z";
const scalar = { id: "sp-a", name: " Native Name ", type: " Mixed TYPE ", metadata: null,
  created_at: stamp, updated_at: stamp, deleted_at: null };
beforeAll(async () => { contracts = Result.getOrThrow(compileShippingProfileCreationContracts(
  (await Effect.runPromise(captureShippingProfileDeletionMetadata())).frame)); });

describe("native ShippingProfile creation metadata and presentation", () => {
  it("retains native strings, supplied identity and nullable/deep metadata within four roots", () => {
    for (const input of [[], [{ name: "", type: "" }], [{ id: "custom", name: " Raw ", type: " MiXeD ", metadata: null }],
      [{ name: "name", type: "default", metadata: { nested: [true, null, { count: 2 }] } }]])
      expect(Result.getOrThrow(decodeShippingProfileCreates(input))).toEqual(input);
    expect(Result.getOrThrow(decodeShippingProfilePhysicalDeletionIds(["z", "missing", "z", "မူရင်း"])))
      .toEqual(["z", "missing", "z", "မူရင်း"]);
    expect(contracts.defaults).toEqual({ metadata: null });
  });

  it("refuses managed, relationship, unknown and malformed creation fields", () => {
    const base = { name: "Name", type: "default" };
    for (const field of ["created_at", "updated_at", "deleted_at", "shipping_options", "shipping_option_id", "foreign"])
      expect(Result.isFailure(decodeShippingProfileCreates([{ ...base, [field]: null }]))).toBe(true);
    for (const input of [base, null, [{ ...base, id: "" }], [{ ...base, name: null }], [{ ...base, type: 1 }],
      [{ ...base, metadata: [] }], Array(5).fill(base)]) expect(Result.isFailure(decodeShippingProfileCreates(input))).toBe(true);
    for (const input of [undefined, null, "a", [""], [1], Array(5).fill("a")])
      expect(Result.isFailure(decodeShippingProfilePhysicalDeletionIds(input))).toBe(true);
  });

  it("requires full DML scalars and native empty inverse creation output", () => {
    expect(Object.keys(scalar).sort()).toEqual(contracts.profile.columns.map(column => column.name).sort());
    expect(Result.getOrThrow(contracts.decodeProfileRow(scalar))).toEqual(scalar);
    const original = structuredClone(scalar), output = { ...scalar, shipping_options: [] };
    expect(Result.getOrThrow(contracts.initializeRows([scalar]))).toEqual([output]); expect(scalar).toEqual(original);
    expect(Result.getOrThrow(contracts.decodeRows([output]))).toEqual([output]);
    for (const field of Object.keys(scalar)) {
      const missing: Record<string, unknown> = { ...scalar }; delete missing[field];
      expect(Result.isFailure(contracts.decodeProfileRow(missing))).toBe(true);
    }
    for (const value of [scalar, { ...output, shipping_options: null }, { ...output, shipping_options: [{ id: "invented" }] },
      { ...output, foreign: true }, { ...output, metadata: undefined }, { ...output, deleted_at: stamp }])
      expect(Result.isFailure(contracts.decodeRows([value]))).toBe(true);
    expect(Result.isFailure(contracts.decodeRows([output, output]))).toBe(true);
    expect(Result.isFailure(contracts.initializeRows([output]))).toBe(true);
  });

  it("shares native creation presentation with the older scalar repository without granting inverse authority", async () => {
    const metadata = (await Effect.runPromise(captureShippingProfileMetadata())).frame;
    const table = metadata.tables[0]; if (table === undefined) throw new Error("Missing native Profile");
    const output = Result.getOrThrow(compileShippingProfileCreationOutput(table, 256));
    expect(Result.getOrThrow(output.initializeRows([scalar]))).toEqual([{ ...scalar, shipping_options: [] }]);
    expect(Result.isFailure(compileShippingProfileCreationContracts(metadata))).toBe(true);
  });

  it("refuses metadata that changes inverse, nullable FK or native creation fields", async () => {
    const frame = (await Effect.runPromise(captureShippingProfileDeletionMetadata())).frame;
    const { profile, option } = contracts;
    for (const replacement of [
      { ...profile, relationships: [] },
      { ...profile, columns: profile.columns.map(column => column.name === "metadata" ? { ...column, nullable: false } : column) },
      { ...option, columns: option.columns.map(column => column.name === "shipping_profile_id" ? { ...column, nullable: false } : column) },
      { ...option, foreignKeys: option.foreignKeys.map(key => key.columns.includes("shipping_profile_id") ? { ...key, onDelete: "cascade" as const } : key) },
    ]) expect(Result.isFailure(compileShippingProfileCreationContracts({ ...frame,
      tables: frame.tables.map(table => table.name === replacement.name ? replacement : table) }))).toBe(true);
  });
});
