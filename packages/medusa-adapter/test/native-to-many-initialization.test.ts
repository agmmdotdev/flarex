import { describe, expect, it } from "vitest";
import { fillEmptyToManyRelations } from "@medusajs/drizzle/relation-query";

describe("native zero-to-many creation result initialization", () => {
  const descriptors = new Map<string, { readonly relationship: { readonly type: "hasMany" | "manyToMany" | "belongsTo" } }>([
    ["children", { relationship: { type: "hasMany" } }],
    ["tags", { relationship: { type: "manyToMany" } }],
    ["parent", { relationship: { type: "belongsTo" } }],
  ]);

  it("initializes absent to-many fields independently without creating to-one data", () => {
    const rows: Record<string, unknown>[] = [{ id: "one" }, { id: "two" }];
    expect(fillEmptyToManyRelations(rows, descriptors)).toBeUndefined();
    expect(rows).toEqual([
      { id: "one", children: [], tags: [] },
      { id: "two", children: [], tags: [] },
    ]);
    expect(rows[0]?.children).not.toBe(rows[1]?.children);
    expect(rows[0]?.children).not.toBe(rows[0]?.tags);
  });

  it("preserves already present relation values and their identities", () => {
    const children = [{ id: "existing-child" }];
    const tags: unknown[] = [];
    const rows = [{ id: "one", children, tags }, { id: "two", children: null, tags: undefined }];
    fillEmptyToManyRelations(rows, descriptors);
    expect(rows[0]?.children).toBe(children);
    expect(rows[0]?.tags).toBe(tags);
    expect(rows[1]?.children).toBeNull();
    expect(rows[1]).toHaveProperty("tags", undefined);
  });

  it("retains the native presence check for inherited relation fields", () => {
    const row = { id: "one" };
    const inherited = [{ id: "inherited-child" }];
    Object.setPrototypeOf(row, { children: inherited });
    fillEmptyToManyRelations([row], descriptors);
    expect(Object.hasOwn(row, "children")).toBe(false);
    expect(Reflect.get(row, "children")).toBe(inherited);
    expect(Reflect.get(row, "tags")).toEqual([]);
  });

  it("preserves empty input and leaves relationless result objects unchanged", () => {
    const row = { id: "one" };
    fillEmptyToManyRelations([], descriptors);
    fillEmptyToManyRelations([row], new Map());
    expect(row).toEqual({ id: "one" });
  });
});
