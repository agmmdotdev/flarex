import { expect, it } from "vitest";
import { Result } from "effect";
import type { Json } from "flarex-protocol/json";
import { planLogicalInitializationBatches } from "../../../src/frameworks/commerceTransaction/initializationRows";

it("preserves target-bound row order and only batches adjacent table entries", () => {
  const input: Json = [{ table: "parent", row: { id: "a" } }, { table: "parent", row: { id: "b" } },
    { table: "child", row: { id: "c", parent_id: "a" } }, { table: "parent", row: { id: "d" } }];
  const before = structuredClone(input);
  expect(Result.getOrThrow(planLogicalInitializationBatches(input, ["parent", "child"]))).toEqual([
    { table: "parent", rows: [{ id: "a" }, { id: "b" }] },
    { table: "child", rows: [{ id: "c", parent_id: "a" }] },
    { table: "parent", rows: [{ id: "d" }] },
  ]);
  expect(input).toEqual(before);
  expect(Result.getOrThrow(planLogicalInitializationBatches([], ["parent", "child"]))).toEqual([]);
});

it("checks every target and strict envelope before any batch can be executed", () => {
  const malformed: readonly Json[] = [[{ id: "flat" }], [{ table: "parent", row: { id: "a" }, extra: true }],
    [{ table: "parent" }], [{ table: "parent", row: [] }], [{ table: 1, row: {} }]];
  for (const input of malformed)
    expect(planLogicalInitializationBatches(input, ["parent", "child"]))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  expect(planLogicalInitializationBatches([{ table: "parent", row: { id: "a" } },
    { table: "outside", row: { id: "b" } }], ["parent", "child"]))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
});

it("retains the existing dataset row ceiling without interpreting module row values", () => {
  const entries = Array.from({ length: 256 }, (_, index) => ({ table: "parent", row: { id: String(index), nested: { preserve: null } } }));
  expect(Result.getOrThrow(planLogicalInitializationBatches(entries, ["parent", "child"]))[0]?.rows).toEqual(entries.map(entry => entry.row));
  expect(planLogicalInitializationBatches([...entries, { table: "parent", row: { id: "overflow", nested: { preserve: null } } }],
    ["parent", "child"])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
});
