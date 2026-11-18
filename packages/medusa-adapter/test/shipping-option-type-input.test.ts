import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureShippingProfileDeletionMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileShippingOptionTypeCreationContracts, decodeShippingOptionTypeCreates,
  decodeShippingOptionTypePhysicalDeletionIds } from "../src/modules/fulfillment/shipping-option-type-input";

let contracts: Result.Result.Success<ReturnType<typeof compileShippingOptionTypeCreationContracts>>;
const stamp = "2026-10-18T00:00:00.000Z";
const scalar = { id: "sotype-a", label: " Native Label ", description: null, code: " Raw CODE ", created_at: stamp, updated_at: stamp, deleted_at: null };
beforeAll(async () => { contracts = Result.getOrThrow(compileShippingOptionTypeCreationContracts(
  (await Effect.runPromise(captureShippingProfileDeletionMetadata())).frame)); });

describe("metadata-derived native ShippingOptionType creation admission", () => {
  it("retains native scalar strings, nullable description, supplied IDs and zero-to-four inputs", () => {
    for (const input of [[], [{ label: "", code: "" }], [{ id: "custom-id", label: " Raw Label ", code: " Mixed CODE ", description: null }],
      [{ label: "A", code: "repeated", description: "" }, { label: "A", code: "repeated", description: "Value" }]])
      expect(Result.getOrThrow(decodeShippingOptionTypeCreates(input))).toEqual(input);
    expect(Result.getOrThrow(decodeShippingOptionTypePhysicalDeletionIds(["b", "a", "b", "missing"]))).toEqual(["b", "a", "b", "missing"]);
  });

  it("rejects unknown, managed and relationship fields without imposing a code uniqueness policy", () => {
    const base = { label: "Type", code: "code" };
    for (const field of ["created_at", "updated_at", "deleted_at", "shipping_options", "shipping_option", "shipping_option_id", "metadata"])
      expect(Result.isFailure(decodeShippingOptionTypeCreates([{ ...base, [field]: null }]))).toBe(true);
    for (const input of [[{ ...base, label: null }], [{ ...base, code: null }], [{ ...base, description: 1 }], [{ ...base, id: "" }],
      [{ ...base, foreign: true }], Array(5).fill(base), base, null]) expect(Result.isFailure(decodeShippingOptionTypeCreates(input))).toBe(true);
    for (const input of [undefined, null, "a", [""], [1], Array(5).fill("a")])
      expect(Result.isFailure(decodeShippingOptionTypePhysicalDeletionIds(input))).toBe(true);
  });

  it("derives the exact stored scalar row and nullable default from the installed native DML", () => {
    expect(Object.keys(scalar).sort()).toEqual(contracts.table.columns.map(column => column.name).sort());
    expect(contracts.table.foreignKeys).toEqual([]); expect(contracts.defaults).toEqual({ description: null });
    expect(Result.getOrThrow(contracts.decodeRow(scalar))).toEqual(scalar);
    for (const field of Object.keys(scalar)) {
      const missing: Record<string, unknown> = { ...scalar }; delete missing[field]; expect(Result.isFailure(contracts.decodeRow(missing))).toBe(true);
    }
    for (const invalid of [{ ...scalar, label: null }, { ...scalar, description: 1 }, { ...scalar, code: false }, { ...scalar, created_at: 1 },
      { ...scalar, deleted_at: false }, { ...scalar, shipping_options: [] }, { ...scalar, unknown: true }])
      expect(Result.isFailure(contracts.decodeRow(invalid))).toBe(true);
  });

  it("requires the complete native empty inverse result and initializes detached rows through the extracted helper", () => {
    const original = structuredClone(scalar), output = { ...scalar, shipping_options: [] };
    expect(Result.getOrThrow(contracts.initializeRows([scalar]))).toEqual([output]); expect(scalar).toEqual(original);
    expect(Result.getOrThrow(contracts.decodeRows([output]))).toEqual([output]);
    expect(Result.getOrThrow(contracts.decodeRows([output, output]))).toEqual([output, output]);
    for (const invalid of [[scalar], [{ ...output, shipping_options: null }], [{ ...output, shipping_options: [{ id: "fake" }] }],
      [{ ...output, foreign: true }], [{ ...output, deleted_at: stamp }]])
      expect(Result.isFailure(contracts.decodeRows(invalid))).toBe(true);
    expect(Result.isFailure(contracts.initializeRows([{ ...scalar, shipping_options: [] }]))).toBe(true);
  });

  it("fails closed on changed native relationship, FK, cascade and field metadata", async () => {
    const frame = (await Effect.runPromise(captureShippingProfileDeletionMetadata())).frame;
    const table = frame.tables.find(table => table.name === "shipping_option_type");
    if (table === undefined) throw new Error("Missing native Type table");
    for (const changed of [{ ...table, relationships: [] }, { ...table, relationships: table.relationships.map(relation => ({ ...relation, cascadeDelete: true })) },
      { ...table, columns: table.columns.map(column => column.name === "description" ? { ...column, nullable: false } : column) }])
      expect(Result.isFailure(compileShippingOptionTypeCreationContracts({ ...frame, tables: frame.tables.map(value => value.name === table.name ? changed : value) }))).toBe(true);
  });
});
