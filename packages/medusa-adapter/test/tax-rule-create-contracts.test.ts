import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureTaxMetadata } from "../src/modules/tax/schema";
import { compileTaxRuleCreationContracts, decodeTaxRulePhysicalDeletionIds } from "../src/modules/tax/rule-create-input";
import { captureCommerceInput } from "../src/value/input";

let contracts: Result.Result.Success<ReturnType<typeof compileTaxRuleCreationContracts>>;
const managed = { created_at: "2026-10-22T00:00:00.000Z", updated_at: "2026-10-22T00:00:00.000Z", deleted_at: null };
const input = { tax_rate_id: "txr-contract", reference: "product", reference_id: "prod-contract" };
const output = { ...input, id: "txrule-contract", metadata: null, created_by: null, ...managed };
const decode = (value: unknown) => captureCommerceInput(value).pipe(Result.flatMap(contracts.decodeInput));
beforeAll(async () => { contracts = Result.getOrThrow(compileTaxRuleCreationContracts((await Effect.runPromise(captureTaxMetadata())).frame)); });

describe("bounded genuine standalone Tax Rule creation contracts", () => {
  it("admits empty and eight-Rule/four-parent inputs without changing caller values", () => {
    expect(Result.getOrThrow(decode([]))).toEqual([]);
    const rows = Array.from({ length: 8 }, (_, index) => ({ ...input, tax_rate_id: `txr-${index % 4}`,
      reference: index % 2 ? "" : "arbitrary-reference", reference_id: index ? `ref-${index}` : "",
      metadata: { nested: { ordinal: index }, list: [null, "x", 1] }, created_by: `creator-${index}` }));
    const original = structuredClone(rows), decoded = Result.getOrThrow(decode(rows));
    expect(decoded).toEqual(original); expect(rows).toEqual(original); expect(decoded[0]).not.toBe(rows[0]);
    expect(decoded[0]?.metadata).not.toBe(rows[0]?.metadata);
  });
  it("retains native managed fields, nulls and the standalone Rule creator", () => {
    const rows = [{ ...input, id: "txrule-supplied", ...managed, metadata: null, created_by: "rule-creator" }];
    expect(Result.getOrThrow(decode(rows))).toEqual(rows);
  });
  it.each([
    ["non-array", input], ["null root", null], ["ninth Rule", Array.from({ length: 9 }, () => input)],
    ["fifth parent", Array.from({ length: 5 }, (_, index) => ({ ...input, tax_rate_id: `txr-${index}` }))],
    ["missing parent", [{ reference: "product", reference_id: "prod" }]],
    ["missing reference", [{ tax_rate_id: "txr", reference_id: "prod" }]],
    ["missing reference ID", [{ tax_rate_id: "txr", reference: "product" }]],
    ["null parent", [{ ...input, tax_rate_id: null }]], ["null reference", [{ ...input, reference: null }]],
    ["null reference ID", [{ ...input, reference_id: null }]], ["invalid managed ID", [{ ...input, id: 12 }]],
    ["invalid created timestamp", [{ ...input, created_at: 12 }]], ["invalid deletion timestamp", [{ ...input, deleted_at: true }]],
    ["invalid creator", [{ ...input, created_by: 3 }]],
    ["unknown field", [{ ...input, unknown: true }]], ["parent relation alias", [{ ...input, tax_rate: "txr" }]],
  ])("refuses %s before native workflow invocation", (_name, value) => { expect(Result.isFailure(decode(value))).toBe(true); });
  it("refuses accessors without evaluating caller code", () => {
    let invoked = false;
    const row = { ...input, get metadata() { invoked = true; return null; } };
    expect(Result.isFailure(decode([row]))).toBe(true); expect(invoked).toBe(false);
  });
  it("preserves native general JSON metadata including arrays and scalar values", () => {
    for (const metadata of [null, [], "native metadata", 3, true, { nested: [null, "x"] }]) {
      expect(Result.getOrThrow(decode([{ ...input, metadata }]))).toEqual([{ ...input, metadata }]);
      expect(Result.getOrThrow(contracts.decodeOutput([{ ...output, metadata }]))).toEqual([{ ...output, metadata }]);
    }
  });
  it("requires complete positional native Rule output with no parent relation", () => {
    expect(Result.getOrThrow(contracts.decodeOutput([output]))).toEqual([output]);
    expect(Result.getOrThrow(contracts.decodeOutput([output, output]))).toEqual([output, output]);
    const { metadata: _metadata, ...incomplete } = output;
    for (const value of [[incomplete], [{ ...output, unknown: true }],
      [{ ...output, tax_rate: { id: input.tax_rate_id } }], [{ ...output, created_at: false }]])
      expect(Result.isFailure(contracts.decodeOutput(value))).toBe(true);
  });
  it("bounds retained IDs and authenticates the genuine Rule metadata and parent relation", async () => {
    expect(Result.getOrThrow(decodeTaxRulePhysicalDeletionIds([]))).toEqual([]);
    expect(Result.isFailure(decodeTaxRulePhysicalDeletionIds(Array.from({ length: 9 }, (_, index) => `rule-${index}`)))).toBe(true);
    const metadata = (await Effect.runPromise(captureTaxMetadata())).frame;
    expect(Result.isFailure(compileTaxRuleCreationContracts({ ...metadata,
      tables: metadata.tables.filter(table => table.name !== "tax_rate_rule") }))).toBe(true);
  });
});
