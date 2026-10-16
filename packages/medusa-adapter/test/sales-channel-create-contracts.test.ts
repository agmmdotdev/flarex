import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureSalesChannelMetadata } from "../src/modules/sales-channel/schema";
import { compileSalesChannelCreateContracts } from "../src/modules/sales-channel/create-input";

async function contracts() {
  const metadata = await Effect.runPromise(captureSalesChannelMetadata());
  const table = metadata.frame.tables[0];
  if (table === undefined) throw new Error("Missing native Sales Channel model");
  return { table, profile: Result.getOrThrow(compileSalesChannelCreateContracts(table)) };
}

const row = {
  id: "sc_native", name: "Native", description: null, is_disabled: false, metadata: null,
  created_at: "2026-10-16T00:00:00.000Z", updated_at: "2026-10-16T00:00:00.000Z", deleted_at: null,
};

describe("native Sales Channel creation contracts", () => {
  it("preserves omitted defaults and all admitted native scalar fields", async () => {
    const { profile } = await contracts();
    const values = [{ name: "" }, { id: "sc_given", name: "Web", description: "Public", is_disabled: true,
      metadata: { nested: [1, null, true] } }, { name: "Nullable", description: null, metadata: null }];
    const before = structuredClone(values);
    expect(Result.getOrThrow(profile.decodeArguments([values]))).toEqual([values]);
    expect(values).toEqual(before);
    expect(Result.getOrThrow(profile.decodeArguments([[{ name: "Defaults" }]])))
      .toEqual([[{ name: "Defaults" }]]);
  });

  it("retains the shared 256-row ceiling and requires the native argument array", async () => {
    const { profile } = await contracts();
    expect(Result.getOrThrow(profile.decodeArguments([[]]))).toEqual([[]]);
    const values = Array.from({ length: 256 }, (_, index) => ({ name: String(index) }));
    expect(Result.getOrThrow(profile.decodeArguments([values]))).toEqual([values]);
    for (const input of [[...values, { name: "overflow" }], { name: "scalar" }, null])
      expect(profile.decodeArguments([input])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(Result.isFailure(profile.decodeArguments([[], {}]))).toBe(true);
  });

  it("refuses unknown or managed fields and invalid native scalar representations", async () => {
    const { profile } = await contracts();
    for (const input of [{ name: "Web", extra: true }, { name: "Web", created_at: row.created_at },
      { name: "Web", updated_at: row.updated_at }, { name: "Web", deleted_at: null },
      { name: "Web", id: "" }, { name: "Web", id: null }, {}, { name: null },
      { name: "Web", description: false }, { name: "Web", is_disabled: null },
      { name: "Web", metadata: [] }, { name: "Web", metadata: "json" }])
      expect(profile.decodeArguments([[input]])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });

  it("validates complete checked-DML rows before returning native results", async () => {
    const { profile } = await contracts();
    expect(Result.getOrThrow(profile.decodeRows([row]))).toEqual([row]);
    expect(Result.getOrThrow(profile.decodeRows([]))).toEqual([]);
    for (const name of Object.keys(row)) {
      const incomplete: Record<string, unknown> = { ...row };
      delete incomplete[name];
      expect(profile.decodeRows([incomplete])).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    }
    for (const invalid of [{ ...row, extra: true }, { ...row, id: "" }, { ...row, is_disabled: "false" },
      { ...row, name: null }, { ...row, description: true }, { ...row, created_at: 1 },
      { ...row, updated_at: null }, { ...row, deleted_at: false }, { ...row, metadata: undefined }])
      expect(profile.decodeRows([invalid])).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });

  it("derives additional complete-row values from metadata and refuses incompatible model admission", async () => {
    const { table } = await contracts();
    const extended = { ...table, columns: [...table.columns,
      { name: "checked_flag", type: "boolean" as const, nullable: false, primaryKey: false, generated: false }] };
    const profile = Result.getOrThrow(compileSalesChannelCreateContracts(extended));
    expect(Result.isFailure(profile.decodeRows([row]))).toBe(true);
    expect(Result.isFailure(profile.decodeRows([{ ...row, checked_flag: "false" }]))).toBe(true);
    expect(Result.getOrThrow(profile.decodeRows([{ ...row, checked_flag: true }])))
      .toEqual([{ ...row, checked_flag: true }]);
    for (const model of [{ ...table, name: "different" },
      { ...table, columns: table.columns.filter(column => column.name !== "description") }])
      expect(compileSalesChannelCreateContracts(model)).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });
});
