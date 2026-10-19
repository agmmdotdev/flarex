import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { makeReadCatalog } from "../src/query/catalog";
import { compileProjection, projectRows, type ProjectionPolicy } from "../src/query/projection";
import type { CommerceRelations } from "../src/query/relations";

const relations: CommerceRelations = new Map([["parents", new Map([["children", {
  name: "children", sourcePrimaryKeys: ["id"], targetTable: "children", targetPrimaryKeys: ["id"],
  join: { type: "hasMany", foreignKeys: ["parent_id"] },
}]])]]);
const catalog = Result.getOrThrow(makeReadCatalog([
  { name: "parents", columns: ["id", "title"], primaryKeys: ["id"], foreignKeys: [], companions: {} },
  { name: "children", columns: ["id", "parent_id", "amount", "raw_amount"], primaryKeys: ["id"], foreignKeys: ["parent_id"], companions: { amount: "raw_amount" } },
], relations));
const leaf: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map() };
const policy: ProjectionPolicy = { ...leaf, allowedPaths: ["children"], selectableRelations: ["children"],
  nested: new Map([["children", { ...leaf, allowWildcard: true }]]) };

describe("explicit checked-column projection wildcard", () => {
  it("projects complete admitted child rows without exposing unselected parent fields", () => {
    const plan = Result.getOrThrow(compileProjection(catalog, "parents", ["id", "children.*"], ["children"], policy));
    expect(plan.storageFields).toEqual(["id"]);
    expect(Result.getOrThrow(projectRows([{ id: "p", title: "private parent", children: [
      { id: "c", parent_id: "p", amount: "1.25", raw_amount: { value: "1.25", precision: 20 } },
    ] }], plan.node))).toEqual([{ id: "p", children: [
      { id: "c", parent_id: "p", amount: "1.25", raw_amount: { value: "1.25", precision: 20 } },
    ] }]);
  });

  it("keeps wildcard admission local to the explicitly selected table policy", () => {
    const strict: ProjectionPolicy = { ...policy, nested: new Map([["children", leaf]]) };
    for (const result of [
      compileProjection(catalog, "parents", ["*"], [], policy),
      compileProjection(catalog, "parents", ["children.*"], ["children"], strict),
      compileProjection(catalog, "parents", ["children.*"], [], policy),
    ]) expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });

  it("does not let a wildcard hide unknown fields or traverse undeclared relationships", () => {
    for (const fields of [["children.*", "children.unknown"], ["children.*", "unknown"], ["children.*", "children.other.*"]])
      expect(compileProjection(catalog, "parents", fields, ["children"], policy))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(compileProjection(catalog, "parents", ["children.*"], ["children", "children.other"], policy))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });
});
