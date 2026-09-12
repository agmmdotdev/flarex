import { describe, expect, it, vi } from "vitest";
import { Link } from "@medusajs/modules-sdk/link";
import { generateEntityDefinition } from "@medusajs/link-modules";
import type { ILinkModule, LoadedModule, ModuleJoinerRelationship } from "@medusajs/types";

// Authored router fixture matching the pinned ProductShippingProfile cardinality.
// This does not promote Fulfillment or install a ShippingProfile storage adapter.
const relationships: [ModuleJoinerRelationship, ModuleJoinerRelationship] = [
  { serviceName: "product", primaryKey: "id", foreignKey: "product_id", alias: "product", hasMany: true },
  { serviceName: "fulfillment", primaryKey: "id", foreignKey: "shipping_profile_id", alias: "shipping_profile" },
];
const joiner = { serviceName: "productShippingProfile", isLink: true, relationships,
  primaryKeys: ["id", "product_id", "shipping_profile_id"],
  databaseConfig: { tableName: "product_shipping_profile", idPrefix: "prodsp" },
};
const pair = (product: string, profile: string) => ({ product: { product_id: product }, fulfillment: { shipping_profile_id: profile } });
function router() {
  // Deliberate observation boundary: native routing and pre-write checks execute;
  // the stub reports empty existing storage and records delegated tuples only.
  const list = vi.fn<ILinkModule["list"]>().mockResolvedValue([]);
  const create = vi.fn<ILinkModule["create"]>().mockResolvedValue([]);
  const loaded = { __joinerConfig: joiner, __definition: {
    key: joiner.serviceName, defaultPackage: "@medusajs/link-modules", label: "Cardinality witness", isQueryable: true,
    defaultModuleDeclaration: { scope: "internal" as const },
  }, list, create } satisfies LoadedModule & Pick<ILinkModule, "list" | "create">;
  return { link: new Link([loaded]), list, create };
}

describe("native Link cardinality characterization (not stored-module support)", () => {
  it("delegates contradictory same-batch profiles after checking only existing rows", async () => {
    const { link, list, create } = router();
    await link.create([pair("p", "a"), pair("p", "b")]);
    expect(list).toHaveBeenCalledExactlyOnceWith({ $or: [
      { shipping_profile_id: { $ne: "a" }, product_id: "p" },
      { shipping_profile_id: { $ne: "b" }, product_id: "p" },
    ] }, { take: 1 }, {});
    expect(create).toHaveBeenCalledExactlyOnceWith([["p", "a"], ["p", "b"]], undefined, undefined, {});
    expect(list.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]!);
    const generated = generateEntityDefinition(joiner, relationships[0], relationships[1]);
    expect(generated.properties).toMatchObject({ product_id: { primary: true }, shipping_profile_id: { primary: true }, id: { type: "string" } });
    expect(generated.indexes).toHaveLength(4);
    for (const index of generated.indexes) {
      expect(index).not.toHaveProperty("unique", true);
      expect(index.expression ?? "").not.toMatch(/CREATE UNIQUE INDEX/i);
    }
  });

  it.fails("known gap: refuses two different profiles for one Product before delegation", async () => {
    const { link } = router();
    await expect(link.create([pair("p", "a"), pair("p", "b")])).rejects.toThrow("Cannot create multiple links");
  });

  it.each([
    { title: "exact duplicate pair", input: [pair("p", "a"), pair("p", "a")], tuples: [["p", "a"], ["p", "a"]] },
    { title: "multiple Products sharing a profile", input: [pair("p1", "a"), pair("p2", "a")], tuples: [["p1", "a"], ["p2", "a"]] },
  ])("delegates $title without an in-batch rewrite", async ({ input, tuples }) => {
    const { link, create } = router();
    await link.create(input);
    expect(create).toHaveBeenCalledExactlyOnceWith(tuples, undefined, undefined, {});
  });

  it("checks a repeated same-pair attachment each time and refuses a reported existing conflict", async () => {
    const { link, create, list } = router();
    await link.create(pair("p", "a"));
    await link.create(pair("p", "a"));
    expect(list).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(2);
    list.mockResolvedValueOnce([{ product_id: "p", shipping_profile_id: "a" }]);
    await expect(link.create(pair("p", "b"))).rejects.toThrow("Cannot create multiple links between 'product' and 'fulfillment'");
    expect(create).toHaveBeenCalledTimes(2);
  });
});
