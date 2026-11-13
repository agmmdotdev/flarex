import { promiseFailureObserver } from "./support/promise-failure-observer";
import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { InventoryLevelStockLocation } from "@medusajs/link-modules";
import { defineAtomicCommerceParticipant, type AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureVariantInventoryLinkMetadata } from "../src/composition/product-variant-inventory-schema";
import { defineGraphReadCommand, type GraphReadCommand } from "../src/local-graph/commands";
import { localGraphDirectPath, nativeLinkGraphDirectPaths, type GraphDirectPath } from "../src/local-graph/direct-paths";
import type { GraphParticipant, GraphReadDefinition } from "../src/local-graph/model";
import { decodeGraphCount, prepareLocalGraph } from "../src/local-graph/query";
import { makeReadCatalog, type ReadTable } from "../src/query/catalog";
import { defineWorkflowModule, workflowModuleDefinition } from "../src/workflow/module";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/support/effectTestRuntime";
import { ProductModuleService } from "@medusajs/product/services";
import { inventoryStaticResources } from "@medusajs/inventory/static-manifest";
import { stockLocationStaticResources } from "@medusajs/stock-location/static-manifest";
import type { ModuleJoinerConfig } from "@medusajs/types";
import { declaredNativeGraph, nativeGraphFixture } from "./support/declared-native-graph";

const product = defineAtomicCommerceParticipant("direct-graph-product");
const links = defineAtomicCommerceParticipant("direct-graph-links");
const inventory = defineAtomicCommerceParticipant("direct-graph-inventory");
const location = defineAtomicCommerceParticipant("direct-graph-location");
const outsider = defineAtomicCommerceParticipant("direct-graph-outsider");
const variantRead = defineGraphReadCommand("directGraphVariants", () => Effect.succeed([[], 0]));
const linkRead = defineGraphReadCommand("directGraphLinks", () => Effect.succeed([[], 0]));
const itemRead = defineGraphReadCommand("directGraphItems", () => Effect.succeed([[], 0]));
const levelRead = defineGraphReadCommand("directGraphLevels", () => Effect.succeed([[], 0]));
const locationRead = defineGraphReadCommand("directGraphLocations", () => Effect.succeed([[], 0]));
const table = (name: string, columns: string[], foreignKeys: string[] = []): ReadTable => ({
  name, columns, foreignKeys, primaryKeys: ["id"], companions: {},
});
const variants = table("variant", ["id", "title"]);
const edgeRows = table("variant_inventory", ["id", "variant_id", "inventory_item_id", "required_quantity"], ["variant_id", "inventory_item_id"]);
const items = table("inventory_item", ["id", "title"]);
const levels = table("inventory_level", ["id", "inventory_item_id", "location_id", "stocked_quantity"], ["inventory_item_id", "location_id"]);
const locations = table("stock_location", ["id", "name"]);
const bounds = { maximumSources: 4, maximumTargets: 8, maximumPerSource: 2 };
let paths: readonly GraphDirectPath[];
let linkModel: string;
let linkConfig: ModuleJoinerConfig;

beforeAll(async () => {
  const metadata = await runEffect(captureVariantInventoryLinkMetadata());
  linkConfig = metadata.joiner;
  const rich = Result.getOrThrow(nativeLinkGraphDirectPaths(metadata.joiner,
    [{ root: "ProductVariant", path: "inventory_items", ...bounds }], "ProductVariant"));
  const first = rich[0];
  if (first === undefined) throw new Error("Missing native rich Link path");
  linkModel = first.targetModel;
  const endpoint = Result.getOrThrow(nativeLinkGraphDirectPaths(metadata.joiner,
    [{ root: "ProductVariant", path: "inventory_items.inventory", ...bounds, maximumSources: 8, maximumPerSource: 1 }], linkModel));
  const catalog = Result.getOrThrow(makeReadCatalog([items, levels], new Map([[items.name, new Map([["location_levels", {
    name: "location_levels", sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"], targetTable: levels.name,
    join: { type: "hasMany" as const, foreignKeys: ["inventory_item_id"] },
  }]])]])));
  const local = Result.getOrThrow(localGraphDirectPath(catalog, items.name, "InventoryItem", "InventoryLevel", "location_levels", {
    root: "ProductVariant", path: "inventory_items.inventory.location_levels", ...bounds, maximumSources: 8, maximumTargets: 16, maximumPerSource: 4,
  }));
  const readonly = Result.getOrThrow(nativeLinkGraphDirectPaths(InventoryLevelStockLocation, [{ root: "ProductVariant",
    path: "inventory_items.inventory.location_levels.stock_locations", maximumSources: 16, maximumTargets: 4, maximumPerSource: 1,
  }], "InventoryLevel"));
  paths = [...rich, ...endpoint, local, ...readonly];
});

function read(model: string, command: GraphReadCommand, selected: ReadTable): GraphReadDefinition {
  return { model, command, table: selected, paths: [], orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount };
}
function participants(selected: readonly GraphDirectPath[] = paths): GraphParticipant[] {
  const inventoryConfig = inventoryStaticResources.joinerConfig, locationConfig = stockLocationStaticResources.joinerConfig;
  if (inventoryConfig === undefined || locationConfig === undefined) throw new Error("Missing genuine Inventory/StockLocation native metadata");
  return [
    { participant: product, module: declaredNativeGraph({ aliases: [{ name: "variant", model: "ProductVariant" }], reads: [read("ProductVariant", variantRead, variants)] },
      [ProductModuleService.prototype.__joinerConfig()], []) },
    { participant: links, module: declaredNativeGraph({ aliases: [{ name: "variant_inventory", model: linkModel }], reads: [read(linkModel, linkRead, edgeRows)],
      directPaths: selected.filter(path => path.sourceModel === linkModel || path.targetModel === linkModel) }, [linkConfig], []) },
    { participant: inventory, module: declaredNativeGraph({ aliases: [{ name: "inventory_item", model: "InventoryItem" }, { name: "inventory_level", model: "InventoryLevel" }],
      reads: [{ ...read("InventoryItem", itemRead, items), paths: [{ path: "location_levels", table: levels, many: true,
        sourceFields: ["id"], targetFields: ["inventory_item_id"] }] }, read("InventoryLevel", levelRead, levels)],
      directPaths: selected.filter(path => path.sourceModel === "InventoryItem" || path.sourceModel === "InventoryLevel") }, [inventoryConfig, InventoryLevelStockLocation],
      [{ name: items.name, relationships: [{ name: "location_levels", type: "hasMany", targetModel: "InventoryLevel", targetTable: levels.name,
        nullable: false, cascadeDelete: false, cascadeDetach: false }] }, { name: levels.name, relationships: [] }]) },
    { participant: location, module: declaredNativeGraph({ aliases: [{ name: "stock_location", model: "StockLocation" }], reads: [read("StockLocation", locationRead, locations)] }, [locationConfig], []) },
  ];
}
type Call = { readonly participant: Parameters<AtomicCommerceContext["call"]>[0]; readonly command: Parameters<AtomicCommerceContext["call"]>[1]; readonly args: Json };
function context(responses: readonly Json[], calls: Call[] = []): AtomicCommerceContext {
  let index = 0;
  return { eventGroupId: "direct-graph", checkpoint: Effect.void, recordFailure: promiseFailureObserver(),
    capture: () => Effect.fail(commerceError("unsupportedProfile")), emit: () => Effect.fail(commerceError("unadmittedEvent")),
    clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")), refuse: Effect.fail,
    call: (participant, command, args) => {
      calls.push({ participant, command, args });
      const response = responses[index++];
      return response === undefined ? Effect.fail(commerceError("storedCorruption")) : Effect.succeed(response);
    },
  };
}
const query = (fields = ["title", "inventory_items.required_quantity", "inventory_items.inventory.title",
  "inventory_items.inventory.location_levels.stocked_quantity", "inventory_items.inventory.location_levels.stock_locations.name"]) => ({
  entity: "variant", fields, filters: { id: ["v1", "v2"] }, pagination: { take: 4, skip: 0 },
});
const graph = (selected: readonly GraphDirectPath[] = paths) => nativeGraphFixture(Result.getOrThrow(prepareLocalGraph(participants(selected))));

describe("authenticated direct local graph paths", () => {
  it("derives rich rows, to-one endpoints, local levels and read-only arrays from their owners", () => {
    expect(paths).toMatchObject([
      { sourceModel: "ProductVariant", sourceKey: "id", targetModel: linkModel, targetKey: "variant_id", many: true, nativeFields: true },
      { sourceModel: linkModel, sourceKey: "inventory_item_id", targetModel: "InventoryItem", targetKey: "id", many: false, nativeFields: true },
      { sourceModel: "InventoryItem", sourceKey: "id", targetModel: "InventoryLevel", targetKey: "inventory_item_id", many: true },
      { sourceModel: "InventoryLevel", sourceKey: "location_id", targetModel: "StockLocation", targetKey: "id", many: true, nativeFields: true },
    ]);
    expect(paths[2]).not.toHaveProperty("nativeFields");
    expect(Result.isFailure(nativeLinkGraphDirectPaths(InventoryLevelStockLocation, [{ root: "ProductVariant", path: "missing", ...bounds }], "InventoryLevel"))).toBe(true);
    expect(Result.isFailure(nativeLinkGraphDirectPaths(InventoryLevelStockLocation, [{ root: "ProductVariant", path: "stock_locations", ...bounds }], "InventoryItem"))).toBe(true);
  });

  it("dispatches every hop to its genuine command and preserves rich rows, grouping and field masks", async () => {
    const calls: Call[] = [];
    const responses: Json[] = [
      [[{ id: "v1", title: "first" }, { id: "v2", title: "second" }], 2],
      [[{ id: "e2", variant_id: "v1", inventory_item_id: "i2", required_quantity: 3 },
        { id: "e1", variant_id: "v1", inventory_item_id: "i1", required_quantity: 2 },
        { id: "e3", variant_id: "v2", inventory_item_id: "i1", required_quantity: 1 }], 3],
      [[{ id: "i1", title: "one", location_levels: [{ id: "l1", inventory_item_id: "i1", location_id: "s1", stocked_quantity: 7 }] },
        { id: "i2", title: "two", location_levels: [{ id: "l2", inventory_item_id: "i2", location_id: "s1", stocked_quantity: 4 }] }], 2],
      [[{ id: "s1", name: "Shared" }], 1],
    ];
    const original = structuredClone(responses);
    const result = await runEffect(graph().bind(context(responses, calls)).nativeGraph(query()));
    const one = { id: "i1", title: "one", location_levels: [{ location_id: "s1", stocked_quantity: 7, stock_locations: [{ id: "s1", name: "Shared" }] }] };
    const two = { id: "i2", title: "two", location_levels: [{ location_id: "s1", stocked_quantity: 4, stock_locations: [{ id: "s1", name: "Shared" }] }] };
    expect(result).toEqual({ data: [
      { id: "v1", title: "first", inventory_items: [{ variant_id: "v1", inventory_item_id: "i2", required_quantity: 3, inventory: two },
        { variant_id: "v1", inventory_item_id: "i1", required_quantity: 2, inventory: one }] },
      { id: "v2", title: "second", inventory_items: [{ variant_id: "v2", inventory_item_id: "i1", required_quantity: 1, inventory: one }] },
    ], metadata: { count: 2, skip: 0, take: 4 } });
    expect(calls.map(call => call.command)).toEqual([variantRead, linkRead, itemRead, locationRead]);
    expect(calls.map(call => call.participant)).toEqual([product, links, inventory, location]);
    expect(calls.map(call => call.args)).toEqual([
      { filters: { id: ["v1", "v2"] }, config: { select: ["title", "id"], relations: [], skip: 0, take: 4 } },
      { filters: { variant_id: ["v1", "v2"] }, config: { select: ["required_quantity", "variant_id", "inventory_item_id"], relations: [], skip: 0, take: 256 } },
      { filters: { id: ["i2", "i1"] }, config: { select: ["title", "id", "location_levels.stocked_quantity", "location_levels.location_id"], relations: ["location_levels"], skip: 0, take: 256 } },
      { filters: { id: ["s1"] }, config: { select: ["name", "id"], relations: [], skip: 0, take: 256 } },
    ]);
    expect(responses).toEqual(original);
  });

  it("retains a rich row when its endpoint is missing and omits the to-one property", async () => {
    const calls: Call[] = [];
    const result = await runEffect(graph().bind(context([
      [[{ id: "v1", title: "Variant" }], 1],
      [[{ variant_id: "v1", inventory_item_id: "deleted", required_quantity: 2 }], 1], [[], 0],
    ], calls)).nativeGraph(query(["title", "inventory_items.required_quantity", "inventory_items.inventory.title"])));
    expect(result.data).toEqual([{ id: "v1", title: "Variant", inventory_items: [{ variant_id: "v1", inventory_item_id: "deleted", required_quantity: 2, inventory: undefined }] }]);
    expect(calls).toHaveLength(3);
    expect(calls[2]?.command).toBe(itemRead);
  });

  it("retains native endpoint join keys without exposing a rich Link row's storage ID", async () => {
    const selected = participants().map(entry => entry.participant === product
      ? { ...entry, module: { ...entry.module, reads: entry.module.reads.map(definition => ({ ...definition, nativeFields: true as const })) } }
      : entry);
    const prepared = nativeGraphFixture(Result.getOrThrow(prepareLocalGraph(selected)));
    const result = await runEffect(prepared.bind(context([
      [[{ id: "v1" }], 1], [[{ id: "private-link-id", variant_id: "v1", inventory_item_id: "i1", required_quantity: 2 }], 1],
      [[{ id: "i1", title: "Item" }], 1],
    ])).nativeGraph(query(["inventory_items.required_quantity", "inventory_items.inventory.title"])));
    expect(result.data).toEqual([{ id: "v1", inventory_items: [{ variant_id: "v1", inventory_item_id: "i1", required_quantity: 2,
      inventory: { id: "i1", title: "Item" } }] }]);
  });

  it("keeps a missing read-only scalar-FK endpoint as an empty array", async () => {
    const result = await runEffect(graph().bind(context([
      [[{ id: "v1" }], 1], [[{ variant_id: "v1", inventory_item_id: "i1" }], 1],
      [[{ id: "i1", location_levels: [{ id: "l1", inventory_item_id: "i1", location_id: "deleted" }] }], 1], [[], 0],
    ])).nativeGraph(query(["inventory_items.inventory.location_levels.stock_locations.name"])));
    expect(result.data).toEqual([{ id: "v1", inventory_items: [{ variant_id: "v1", inventory_item_id: "i1",
      inventory: { id: "i1", location_levels: [{ location_id: "deleted", stock_locations: [] }] } }] }]);
  });

  it("skips empty cohorts without borrowing unrelated commands", async () => {
    for (const entry of [
      { responses: [[[], 0]], expected: [], calls: 1 },
      { responses: [[[{ id: "v1" }], 1], [[], 0]], expected: [{ id: "v1", inventory_items: [] }], calls: 2 },
    ] satisfies Array<{ responses: Json[]; expected: Json; calls: number }>) {
      const calls: Call[] = [];
      expect((await runEffect(graph().bind(context(entry.responses, calls)).nativeGraph(query(["inventory_items.inventory.title"])))).data).toEqual(entry.expected);
      expect(calls).toHaveLength(entry.calls);
    }
  });

  it("enforces source cohorts across every sibling rather than resetting limits per parent", async () => {
    const selected = paths.map(path => path.path === "inventory_items.inventory" ? { ...path, maximumSources: 2 } : path);
    const calls: Call[] = [];
    expect(await runEffectFailure(graph(selected).bind(context([
      [[{ id: "v1" }, { id: "v2" }], 2],
      [[{ variant_id: "v1", inventory_item_id: "i1" }, { variant_id: "v1", inventory_item_id: "i2" },
        { variant_id: "v2", inventory_item_id: "i3" }], 3],
    ], calls)).nativeGraph(query(["inventory_items.inventory.title"])))).toMatchObject({ reason: "unsupportedProfile" });
    expect(calls.map(call => call.command)).toEqual([variantRead, linkRead]);
  });

  it("refuses incomplete counts, out-of-cohort rows and malformed join keys", async () => {
    const root: Json = [[{ id: "v1" }], 1];
    const edge: Json = [[{ variant_id: "v1", inventory_item_id: "i1" }], 1];
    const cases: Json[][] = [
      [root, [[], 1]],
      [root, [[{ variant_id: "foreign", inventory_item_id: "i1" }], 1]],
      [root, [[{ variant_id: 4, inventory_item_id: "i1" }], 1]],
      [root, [[{ variant_id: "v1" }], 1]],
      [root, edge, [[], 1]],
      [root, edge, [[{ id: "foreign", title: "outside" }], 1]],
      [root, edge, [[{ title: "missing key" }], 1]],
    ];
    for (const responses of cases) expect(await runEffectFailure(graph().bind(context(responses))
      .nativeGraph(query(["inventory_items.inventory.title"])))).toMatchObject({ reason: "storedCorruption" });
  });

  it("refuses target, per-source and one-cardinality overruns", async () => {
    const root: Json = [[{ id: "v1" }], 1];
    const edge: Json = [[{ variant_id: "v1", inventory_item_id: "i1" }], 1];
    const cases: Json[][] = [
      [root, [Array.from({ length: 9 }, () => ({ variant_id: "v1", inventory_item_id: "i1" })), 9]],
      [root, [Array.from({ length: 3 }, () => ({ variant_id: "v1", inventory_item_id: "i1" })), 3], [[{ id: "i1", title: "one" }], 1]],
      [root, edge, [[{ id: "i1", title: "one" }, { id: "i1", title: "duplicate" }], 2]],
    ];
    for (const responses of cases) expect(await runEffectFailure(graph().bind(context(responses))
      .nativeGraph(query(["inventory_items.inventory.title"])))).toMatchObject({ reason: "unsupportedProfile" });
  });

  it("authenticates declarers, endpoint bindings and every path prefix before dispatch", () => {
    const valid = participants();
    const first = paths[0];
    if (first === undefined) throw new Error("Missing direct fixture");
    const changed = (selected: readonly GraphDirectPath[]) => participants(selected);
    const cases = [
      valid.filter(entry => entry.participant !== location),
      [...valid.map(entry => ({ ...entry, module: { ...entry.module, directPaths: [] } })),
        { participant: outsider, module: { aliases: [], reads: [], directPaths: paths } }],
      changed(paths.filter(path => path.path !== "inventory_items")),
      changed(paths.map(path => path.path === "inventory_items.inventory" ? { ...path, sourceModel: "InventoryItem", sourceKey: "id" } : path)),
      changed([{ ...first, sourceKey: "secret" }, ...paths.slice(1)]),
      changed([{ ...first, targetKey: "secret" }, ...paths.slice(1)]),
      changed([first, ...paths]),
    ];
    for (const selected of cases) expect(Result.isFailure(prepareLocalGraph(selected))).toBe(true);
  });

  it("captures path metadata in graph and workflow definitions before caller mutation", async () => {
    const mutable = paths.map(path => ({ ...path }));
    const prepared = graph(mutable);
    const link = participants(mutable).find(entry => entry.participant === links);
    if (link === undefined) throw new Error("Missing direct Link fixture");
    const modulePaths = mutable.filter(path => path.sourceModel === linkModel || path.targetModel === linkModel);
    const module = Result.getOrThrow(defineWorkflowModule({ name: "direct_links", source: { name: "test", profile: "test" }, methods: {},
      graph: { ...link.module, directPaths: modulePaths } }));
    const expected = structuredClone(modulePaths);
    mutable[0]!.maximumTargets = 1;
    mutable[0]!.targetKey = "secret";
    mutable.length = 0;
    modulePaths.length = 0;
    expect(workflowModuleDefinition(module)?.graph.directPaths).toEqual(expected);
    const calls: Call[] = [];
    expect((await runEffect(prepared.bind(context([
      [[{ id: "v1" }], 1], [[{ variant_id: "v1", inventory_item_id: "i1", required_quantity: 2 },
        { variant_id: "v1", inventory_item_id: "i2", required_quantity: 3 }], 2],
    ], calls)).nativeGraph(query(["inventory_items.required_quantity"])))).data)
      .toEqual([{ id: "v1", inventory_items: [{ variant_id: "v1", required_quantity: 2 }, { variant_id: "v1", required_quantity: 3 }] }]);
    expect(calls[1]?.args).toMatchObject({ config: { take: 256 } });
    const refused: Call[] = [];
    expect(await runEffectFailure(prepared.bind(context([], refused)).nativeGraph(query(["inventory_items.secret"])))).toMatchObject({ reason: "unsupportedProfile" });
    expect(refused).toEqual([]);
  });
});
