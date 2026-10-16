import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureSalesChannelMetadata } from "../src/modules/sales-channel/schema";
import { commerceDecoder } from "../src/value/decoder";
import { SalesChannelUpdateInput, compileSalesChannelUpdateContracts } from "../src/modules/sales-channel/update-input";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";

const decode = commerceDecoder(SalesChannelUpdateInput, "invalidInput");
const row = { id: "sc_native", name: "Web", description: null, is_disabled: false, metadata: { keep: true },
  created_at: "2026-10-16T00:00:00.000Z", updated_at: "2026-10-16T00:00:00.000Z", deleted_at: null };
async function contracts() {
  const metadata = await Effect.runPromise(captureSalesChannelMetadata());
  const table = metadata.frame.tables[0];
  if (table === undefined) throw new Error("Missing native Sales Channel model");
  return Result.getOrThrow(compileSalesChannelUpdateContracts(table));
}

describe("bounded native Sales Channel selector update contracts", () => {
  it("preserves empty selectors/updates and native scalar selector combinations", () => {
    const values = [
      { selector: {}, update: {} },
      { selector: { id: ["sc_b", "sc_a"], name: ["Web", "Retail"], is_disabled: false },
        update: { name: "", description: null, is_disabled: true, metadata: { drop: "", nested: { keep: true } } } },
      { selector: { id: "sc_a", name: "Web", is_disabled: true }, update: { description: "", metadata: null } },
      { selector: { id: [], name: [] }, update: { metadata: {} } },
    ];
    const before = structuredClone(values);
    for (const value of values) expect(Result.getOrThrow(decode(value))).toEqual(value);
    expect(values).toEqual(before);
    expect(Result.isSuccess(decode({ selector: { id: ["a", "b", "c", "d"] }, update: {} }))).toBe(true);
    expect(Result.isSuccess(decode({ selector: { name: ["a", "b", "c", "d"] }, update: {} }))).toBe(true);
  });

  it("refuses unsupported selectors, operators, managed fields and malformed values", () => {
    const selectors: unknown[] = [{ id: ["a", "b", "c", "d", "e"] }, { name: ["a", "b", "c", "d", "e"] },
      { id: "" }, { id: null }, { name: null }, { is_disabled: "false" }, { q: "search" },
      { id: { $ne: "sc_a" } }, { $or: [{ id: "sc_a" }] }, { metadata: {} }];
    for (const selector of selectors) expect(decode({ selector, update: {} }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    const updates: unknown[] = [{ id: "sc_a" }, { created_at: row.created_at }, { updated_at: row.updated_at },
      { deleted_at: null }, { extra: true }, { name: null }, { description: false }, { is_disabled: null },
      { metadata: [] }, { metadata: "object" }];
    for (const update of updates) expect(decode({ selector: {}, update }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(Result.isFailure(decode({ selector: {}, update: {}, extra: true }))).toBe(true);
  });

  it("preserves genuine absent output separately from complete native scalar rows", async () => {
    const profile = await contracts();
    expect(Result.getOrThrow(profile.decodeOutput({ kind: "absent" }))).toBeUndefined();
    expect(Result.getOrThrow(profile.decodeOutput({ kind: "present", value: row }))).toEqual(row);
    for (const value of [null, [], [row], { ...row, is_disabled: "false" }, { ...row, extra: true }])
      expect(profile.decodeOutput({ kind: "present", value })).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    for (const key of Object.keys(row)) {
      const incomplete: Record<string, Json> = { ...row };
      delete incomplete[key];
      expect(Result.isFailure(profile.decodeOutput({ kind: "present", value: incomplete }))).toBe(true);
    }
    for (const value of [row, null, { kind: "absent", value: row }, { kind: "present" }])
      expect(Result.isFailure(profile.decodeOutput(value))).toBe(true);
  });

  it("checks selected preimage keys and DML values without fabricating missing fields", async () => {
    const profile = await contracts();
    const values = [{ id: "sc_a" }, { id: "sc_b", name: "Web", metadata: null }, row];
    expect(Result.getOrThrow(profile.decodePreimages(values))).toEqual(values);
    expect(Result.getOrThrow(profile.decodePreimages([]))).toEqual([]);
    for (const value of [[{ name: "Missing key" }], [{ id: "" }], [{ id: "sc_a", extra: true }],
      [{ id: "sc_a", is_disabled: "false" }], [{ id: "sc_a", updated_at: null }],
      Array.from({ length: 5 }, (_, index) => ({ id: String(index) }))])
      expect(profile.decodePreimages(value)).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });
});
