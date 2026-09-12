import { describe, expect, it, vi } from "vitest";
import { Link } from "@medusajs/modules-sdk/link";
import { generateEntityDefinition, getModuleService, LinkService, ProductSalesChannel } from "@medusajs/link-modules";
import { MedusaError } from "@medusajs/utils/common/errors";
import type { Context, DAL, ILinkModule, LoadedModule, ModuleJoinerRelationship } from "@medusajs/types";
import { Modules } from "@medusajs/framework/utils/portable";

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
function router(selectedRelationships = relationships, serviceName = joiner.serviceName) {
  // Deliberate observation boundary: native routing and pre-write checks execute;
  // the stub reports empty existing storage and records delegated tuples only.
  const list = vi.fn<ILinkModule["list"]>().mockResolvedValue([]);
  const create = vi.fn<ILinkModule["create"]>().mockResolvedValue([]);
  const loaded = { __joinerConfig: { ...joiner, relationships: selectedRelationships, serviceName }, __definition: {
    key: serviceName, defaultPackage: "@medusajs/link-modules", label: "Cardinality witness", isQueryable: true,
    defaultModuleDeclaration: { scope: "internal" as const },
  }, list, create } satisfies LoadedModule & Pick<ILinkModule, "list" | "create">;
  return { link: new Link([loaded]), list, create, loaded };
}

describe("native Link cardinality characterization (not stored-module support)", () => {
  it("generates active Product uniqueness without limiting profile reuse", () => {
    const generated = generateEntityDefinition(joiner, relationships[0], relationships[1]);
    expect(generated.properties).toMatchObject({ product_id: { primary: true }, shipping_profile_id: { primary: true }, id: { type: "string" } });
    expect(generated.indexes).toHaveLength(4);
    expect(generated.indexes.filter(index => "unique" in index && index.unique)).toEqual([
      expect.objectContaining({ properties: ["product_id"], unique: true,
        expression: expect.stringMatching(/^CREATE UNIQUE INDEX .*WHERE deleted_at IS NULL$/) }),
    ]);
  });

  it("refuses two different profiles for one Product before delegation", async () => {
    const { link, list, create } = router();
    await expect(link.create([pair("p", "a"), pair("p", "b")])).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: "Cannot create multiple links between 'product' and 'fulfillment'",
    });
    expect(list).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
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

  it("retains native stored-row predicates, tuple data, context and result order", async () => {
    const { link, list, create } = router();
    const context: Context = { transactionId: "native-context" };
    const data = { priority: 2 };
    const rows = [{ id: "second" }, { id: "first" }];
    create.mockResolvedValueOnce(rows);
    expect(await link.create([{ ...pair("p2", "a"), data }, pair("p1", "a")], context)).toEqual(rows);
    expect(list).toHaveBeenCalledExactlyOnceWith({ $or: [
      { shipping_profile_id: { $ne: "a" }, product_id: "p2" },
      { shipping_profile_id: { $ne: "a" }, product_id: "p1" },
    ] }, { take: 1 }, context);
    expect(create).toHaveBeenCalledExactlyOnceWith([["p2", "a", data], ["p1", "a"]], undefined, undefined, context);
    expect(list.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]!);
  });
});

function neutralRelationships(first: boolean | undefined, second: boolean | undefined): [ModuleJoinerRelationship, ModuleJoinerRelationship] {
  return [
    { serviceName: "left", primaryKey: "id", foreignKey: "left_id", alias: "left", ...(first === undefined ? {} : { hasMany: first }) },
    { serviceName: "right", primaryKey: "id", foreignKey: "right_id", alias: "right", ...(second === undefined ? {} : { hasMany: second }) },
  ];
}
const neutralPair = (left: string, right: string) => ({ left: { left_id: left }, right: { right_id: right } });

describe("native batch cardinality uses relationship metadata, not module names", () => {
  it.each([
    { first: true, second: true, constrainLeft: false, constrainRight: false },
    { first: true, second: false, constrainLeft: true, constrainRight: false },
    { first: false, second: true, constrainLeft: false, constrainRight: true },
    { first: false, second: false, constrainLeft: true, constrainRight: true },
    { first: undefined, second: undefined, constrainLeft: true, constrainRight: true },
  ])("enforces first=$first second=$second in both directions", async ({ first, second, constrainLeft, constrainRight }) => {
    for (const { input, conflict } of [
      { input: [neutralPair("x", "a"), neutralPair("x", "b")], conflict: constrainLeft },
      { input: [neutralPair("x", "a"), neutralPair("y", "a")], conflict: constrainRight },
    ]) {
      const { link, create, list } = router(neutralRelationships(first, second));
      if (conflict) {
        await expect(link.create(input)).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA });
        expect(create).not.toHaveBeenCalled();
        expect(list).not.toHaveBeenCalled();
      } else {
        await link.create(input);
        expect(create).toHaveBeenCalledTimes(1);
        expect(list).toHaveBeenCalledTimes(first && second ? 0 : 1);
      }
    }
    const { link, create } = router(neutralRelationships(first, second));
    await link.create([neutralPair("x", "a"), neutralPair("x", "a")]);
    expect(create).toHaveBeenCalledExactlyOnceWith([["x", "a"], ["x", "a"]], undefined, undefined, {});
  });

  it("retains one-to-one refusal for a stored exact pair", async () => {
    const { link, list, create } = router(neutralRelationships(false, false));
    list.mockResolvedValueOnce([{ left_id: "x", right_id: "a" }]);
    await expect(link.create(neutralPair("x", "a"))).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA });
    expect(list).toHaveBeenCalledExactlyOnceWith({ $or: [{ $or: [{ left_id: "x" }, { right_id: "a" }] }] }, { take: 1 }, {});
    expect(create).not.toHaveBeenCalled();
  });

  it("does not create an earlier valid service when a later service conflicts", async () => {
    const first = router();
    const later = router(neutralRelationships(true, false), "neutralLink");
    const link = new Link([first.loaded, later.loaded]);
    await expect(link.create([pair("x", "a"), neutralPair("x", "a"), neutralPair("x", "b")])).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA });
    expect(first.list).toHaveBeenCalledTimes(1);
    expect(first.create).not.toHaveBeenCalled();
    expect(later.create).not.toHaveBeenCalled();
  });

  it("isolates services and invocations, preserving grouping and flattened results", async () => {
    const first = router();
    const later = router(neutralRelationships(true, false), "neutralLink");
    const link = new Link([first.loaded, later.loaded]);
    first.create.mockResolvedValue([{ id: "first" }]);
    later.create.mockResolvedValue([{ id: "later" }]);
    expect(await link.create([pair("x", "a"), neutralPair("x", "b"), pair("y", "a")])).toEqual([{ id: "first" }, { id: "later" }]);
    expect(first.create).toHaveBeenCalledExactlyOnceWith([["x", "a"], ["y", "a"]], undefined, undefined, {});
    expect(later.create).toHaveBeenCalledExactlyOnceWith([["x", "b"]], undefined, undefined, {});
    await link.create(neutralPair("x", "c"));
    expect(later.create).toHaveBeenCalledTimes(2);
  });

  it("does nothing for an empty batch", async () => {
    const { link, list, create } = router();
    expect(await link.create([])).toEqual([]);
    expect(list).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each([true, false])("compares compound primary tuples structurally with first.hasMany=$0", async (firstHasMany) => {
    const selected = neutralRelationships(firstHasMany, false);
    selected[0] = { ...selected[0], foreignKey: "part_one,part_two" };
    const compoundPair = (one: string, two: string, right: string) => ({ left: { part_one: one, part_two: two }, right: { right_id: right } });
    const { link, create } = router(selected);
    await link.create([compoundPair("x,y", "z", "a"), compoundPair("x", "y,z", "b"), compoundPair("x,y", "z", "a")]);
    expect(create).toHaveBeenCalledExactlyOnceWith([[["x,y", "z"], "a"], [["x", "y,z"], "b"], [["x,y", "z"], "a"]], undefined, undefined, {});
    create.mockClear();
    await expect(link.create([compoundPair("x,y", "z", "a"), compoundPair("x,y", "z", "b")])).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA });
    expect(create).not.toHaveBeenCalled();
    if (!firstHasMany) {
      await expect(link.create([compoundPair("x,y", "z", "a"), compoundPair("x", "y,z", "a")])).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA });
      expect(create).not.toHaveBeenCalled();
    }
  });
});

describe("native Link storage metadata and tuple authority", () => {
  it.each([
    [true, true, []], [true, false, ["left_id"]], [false, true, ["right_id"]],
    [false, false, ["left_id", "right_id"]], [undefined, undefined, ["left_id", "right_id"]],
  ] as const)("generates endpoint uniqueness for %s/%s", (first, second, expected) => {
    const selected = neutralRelationships(first, second);
    const generated = generateEntityDefinition({ ...joiner, relationships: selected }, selected[0], selected[1]);
    expect(generated.indexes.filter(index => "unique" in index && index.unique)
      .flatMap(index => index.properties)).toEqual(expected);
    expect(generated.properties).toMatchObject({ left_id: { primary: true }, right_id: { primary: true } });
    expect(generated.properties.id).not.toHaveProperty("primary");
  });

  it("preserves the exact many-to-many ProductSalesChannel generated metadata", () => {
    const [first, second] = ProductSalesChannel.relationships ?? [];
    if (!first || !second) throw new Error("Missing native relationships");
    const generated = generateEntityDefinition(ProductSalesChannel, first, second);
    expect(generated).toMatchSnapshot();
    expect(generated.indexes.every(index => !("unique" in index))).toBe(true);
  });

  function service() {
    const unused = () => { throw new Error("Unexpected repository operation"); };
    const create = vi.fn<DAL.RepositoryService["create"]>().mockResolvedValue([]);
    const repository: DAL.RepositoryService = { create,
      // Native DAL lets callers select the serialization type; this fixture's
      // create always returns an empty row array and exercises no projection.
      serialize: async <Output extends object | object[]>() => [] as Output,
      getFreshManager: unused, getActiveManager: unused, transaction: unused, find: unused, findAndCount: unused,
      update: unused, delete: unused, upsert: unused, upsertWithReplace: unused, softDelete: unused, restore: unused };
    const emit = vi.fn().mockResolvedValue(undefined);
    const Service = getModuleService(joiner);
    const native = new Service({ baseRepository: repository, linkService: new LinkService({ linkRepository: repository }),
      primaryKey: "left_id", foreignKey: "right_id", extraFields: ["note"], entityName: "LinkNeutral", serviceName: "neutral",
      [Modules.EVENT_BUS]: { emit, subscribe: unused, unsubscribe: unused, releaseGroupedEvents: unused, clearGroupedEvents: unused } }, { scope: "internal" });
    return { native, create, emit, context: { manager: {}, transactionManager: {} } satisfies Context };
  }

  it.each([{ left_id: "x" }, { left_id: "different" }, { right_id: "a" }, { right_id: "different" }])(
    "rejects reserved extra fields before repository writes or events: %j", async extra => {
      const { native, create, emit, context } = service();
      await expect(native.create([["valid", "valid", {}], ["x", "a", extra]], undefined, undefined, context)).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA, message: "Link extra data cannot replace endpoint fields",
      });
      expect(create).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

  it("preserves ordinary extra data and supplied IDs", async () => {
    const { native, create, context } = service();
    await native.create("x", "a", { id: "chosen", note: "native extra" }, context);
    expect(create).toHaveBeenCalledExactlyOnceWith([{ left_id: "x", right_id: "a", id: "chosen", note: "native extra" }],
      { transactionManager: context.transactionManager });
  });
});
