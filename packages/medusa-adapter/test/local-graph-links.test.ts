import { promiseFailureObserver } from "./support/promise-failure-observer";
import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defineAtomicCommerceParticipant, type AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureVariantInventoryLinkMetadata } from "../src/composition/product-variant-inventory-schema";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { nativeLinkGraphPaths } from "../src/local-graph/links";
import { ShippingOptionPriceSet } from "@medusajs/link-modules";
import type { ModuleJoinerConfig } from "@medusajs/framework/types";
import { prepareLocalGraph, decodeGraphCount } from "../src/local-graph/query";
import type { GraphModuleDefinition, GraphParticipant, GraphRemotePath } from "../src/local-graph/model";
import { defineWorkflowModule, workflowModuleDefinition } from "../src/workflow/module";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/support/effectTestRuntime";
import { ProductModuleService } from "@medusajs/product/services";
import { inventoryStaticResources } from "@medusajs/inventory/static-manifest";
import { fulfillmentStaticResources } from "@medusajs/fulfillment/static-manifest";
import { pricingStaticResources } from "@medusajs/pricing/static-manifest";
import { declaredNativeGraph, nativeGraphFixture } from "./support/declared-native-graph";

const productParticipant = defineAtomicCommerceParticipant("graph-link-product");
const inventoryParticipant = defineAtomicCommerceParticipant("graph-link-inventory");
const linkParticipant = defineAtomicCommerceParticipant("graph-link-edges");
const variantRead = defineGraphReadCommand("graphLinkVariants", () => Effect.succeed([[], 0]));
const inventoryRead = defineGraphReadCommand("graphLinkItems", () => Effect.succeed([[], 0]));
const linkRead = defineGraphReadCommand("graphLinkEdges", () => Effect.succeed([[], 0]));
let metadata: Effect.Success<ReturnType<typeof captureVariantInventoryLinkMetadata>>;
let paths: readonly GraphRemotePath[];
beforeAll(async () => {
  metadata = await runEffect(captureVariantInventoryLinkMetadata());
  paths = Result.getOrThrow(nativeLinkGraphPaths(metadata.joiner, [
    { root: "ProductVariant", path: "inventory", maximumSources: 4, maximumLinks: 8, maximumTargets: 8, maximumPerSource: 2 },
    { root: "ProductVariant", path: "inventory.variants", maximumSources: 8, maximumLinks: 32, maximumTargets: 32, maximumPerSource: 4 },
  ]));
});

function participants(remotePaths: readonly GraphRemotePath[] = paths): GraphParticipant[] {
  const endpoint = (model: string, alias: string, command: typeof variantRead, config: ModuleJoinerConfig | undefined): GraphModuleDefinition => {
    if (config === undefined) throw new Error("Missing actual endpoint native metadata");
    return declaredNativeGraph({
    aliases: [{ name: alias, model }], reads: [{ model, command,
      table: { name: alias, columns: ["id", "title"], primaryKeys: ["id"], foreignKeys: [], companions: {} },
      paths: [], orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }],
    }, [config], []);
  };
  const link = paths[0];
  if (link === undefined) throw new Error("Missing native Link path");
  return [
    { participant: productParticipant, module: endpoint("ProductVariant", "variant", variantRead, ProductModuleService.prototype.__joinerConfig()) },
    { participant: inventoryParticipant, module: endpoint("InventoryItem", "inventory_item", inventoryRead, inventoryStaticResources.joinerConfig) },
    { participant: linkParticipant, module: declaredNativeGraph({ aliases: [{ name: "variant_inventory_link", model: link.linkModel }],
      reads: [{ model: link.linkModel, command: linkRead,
        table: { name: metadata.frame.name, columns: metadata.frame.columns.map(column => column.name),
          primaryKeys: metadata.frame.columns.filter(column => column.primaryKey).map(column => column.name), foreignKeys: [], companions: {} },
        paths: [], orderable: [link.sourceColumn], uniqueOrder: [], multipleOrder: false, decode: decodeGraphCount }], remotePaths }, [metadata.joiner], [metadata.frame]) },
  ];
}
type Call = { readonly participant: Parameters<AtomicCommerceContext["call"]>[0]; readonly command: Parameters<AtomicCommerceContext["call"]>[1]; readonly args: Json };
function context(responses: readonly Json[], calls: Call[] = []): AtomicCommerceContext {
  let index = 0;
  return { eventGroupId: "unit-link-graph", checkpoint: Effect.void, recordFailure: promiseFailureObserver(),
    capture: () => Effect.fail(commerceError("unsupportedProfile")), emit: () => Effect.fail(commerceError("unadmittedEvent")), refuse: Effect.fail,
    clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")),
    call: (participant, command, args) => {
      calls.push({ participant, command, args });
      const value = responses[index++];
      return value === undefined ? Effect.fail(commerceError("storedCorruption")) : Effect.succeed(value);
    },
  };
}
const query = (fields: string[] = ["id", "inventory.id", "inventory.variants.id"]) => ({ entity: "variant", fields,
  filters: { id: ["v1", "v2"] }, pagination: { take: 4, skip: 0 } });
const graph = (remotePaths: readonly GraphRemotePath[] = paths) => nativeGraphFixture(Result.getOrThrow(prepareLocalGraph(participants(remotePaths))));

describe("native Link-derived local graph paths", () => {
  it("groups authenticated suffix aliases without requiring a synthetic public endpoint alias", () => {
    const neutral: ModuleJoinerConfig = { serviceName: "left_right", isLink: true,
      alias: [{ name: ["pairs"], entity: "Pair" }], primaryKeys: ["id", "left_id", "right_id"],
      relationships: [{ serviceName: "left", entity: "Left", primaryKey: "id", foreignKey: "left_id", alias: "left" },
        { serviceName: "right", entity: "Right", primaryKey: "id", foreignKey: "right_id", alias: "right" }],
      extends: [{ serviceName: "left", entity: "Left", relationship: { serviceName: "left_right", primaryKey: "left_id", foreignKey: "id", alias: "right_link" },
        fieldAlias: { details: { path: "right_link.right.details" }, calculation: { path: "right_link.right.calculation", forwardArgumentsOnPath: ["right_link.right"] } } }] };
    const selection = { root: "Left", path: "details", maximumSources: 4, maximumLinks: 4, maximumTargets: 4, maximumPerSource: 1 };
    expect(Result.getOrThrow(nativeLinkGraphPaths(neutral, [selection, { ...selection, path: "calculation" }]))).toMatchObject([
      { path: "details", canonicalPath: "right_link.right", targetSuffix: "details", sourceModel: "Left", targetModel: "Right" },
      { path: "calculation", canonicalPath: "right_link.right", targetSuffix: "calculation", forwardArgumentsOnPath: ["right_link.right"] },
    ]);
    const ambiguous = structuredClone(neutral), extension = ambiguous.extends?.[0];
    if (extension === undefined) throw new Error("Missing neutral suffix extension");
    extension.fieldAlias = { ...extension.fieldAlias, right: "right_link.right", duplicate: "right_link.right" };
    expect(Result.isFailure(nativeLinkGraphPaths(ambiguous, [selection]))).toBe(true);
    const foreign = structuredClone(neutral), forwarded = foreign.extends?.[0];
    if (forwarded === undefined) throw new Error("Missing neutral forwarding extension");
    forwarded.fieldAlias = { calculation: { path: "right_link.right.calculation", forwardArgumentsOnPath: ["foreign_link.right"] } };
    expect(Result.isFailure(nativeLinkGraphPaths(foreign, [{ ...selection, path: "calculation" }]))).toBe(true);
  });
  it("preserves the real Shipping Option PriceSet suffix-only aliases", () => {
    const selection = { root: "ShippingOption", path: "prices", maximumSources: 4, maximumLinks: 4, maximumTargets: 4, maximumPerSource: 1 };
    expect(Result.getOrThrow(nativeLinkGraphPaths(ShippingOptionPriceSet, [selection, { ...selection, path: "calculated_price" }]))).toMatchObject([
      { path: "prices", canonicalPath: "price_set_link.price_set", targetSuffix: "prices", outputMany: true },
      { path: "calculated_price", canonicalPath: "price_set_link.price_set", targetSuffix: "calculated_price", forwardArgumentsOnPath: ["price_set_link.price_set"] },
    ]);
  });
  it.each(["neutral", "shipping"])("preserves missing list and singleton suffix semantics for %s Link metadata", async kind => {
    const neutral: ModuleJoinerConfig = { serviceName: "left_right", isLink: true,
      alias: [{ name: "pairs", entity: "Pair" }], primaryKeys: ["left_id", "right_id"],
      relationships: [{ serviceName: "left", entity: "Left", primaryKey: "id", foreignKey: "left_id", alias: "left" },
        { serviceName: "right", entity: "Right", primaryKey: "id", foreignKey: "right_id", alias: "right" }],
      extends: [{ serviceName: "left", entity: "Left", relationship: { serviceName: "left_right", primaryKey: "left_id", foreignKey: "id", alias: "right_link" },
        fieldAlias: { details: { path: "right_link.right.details", isList: true }, calculation: { path: "right_link.right.calculation" } } }] };
    const names = kind === "shipping" ? ["prices", "calculated_price"] as const : ["details", "calculation"] as const;
    const selected = Result.getOrThrow(nativeLinkGraphPaths(kind === "shipping" ? ShippingOptionPriceSet : neutral, names.map(path => ({
      root: kind === "shipping" ? "ShippingOption" : "Left", path, maximumSources: 4, maximumLinks: 4, maximumTargets: 4, maximumPerSource: 1,
    }))));
    const first = selected[0];
    if (first === undefined) throw new Error("Missing authenticated suffix path");
    const sourceConfig = kind === "shipping" ? fulfillmentStaticResources.joinerConfig
      : { serviceName: "left", primaryKeys: ["id"], alias: [{ name: "source", entity: "Left", args: { methodSuffix: "Lefts" } }] };
    const targetConfig = kind === "shipping" ? pricingStaticResources.joinerConfig
      : { serviceName: "right", primaryKeys: ["id"], alias: [{ name: "target", entity: "Right", args: { methodSuffix: "Rights" } }] };
    if (sourceConfig === undefined || targetConfig === undefined) throw new Error("Missing genuine suffix endpoint metadata");
    const sourceAlias = kind === "shipping" ? "shipping_option" : "source";
    const scalar = (name: string) => ({ name, columns: ["id"], primaryKeys: ["id"], foreignKeys: [], companions: {} });
    const read = (model: string, command: typeof variantRead, table = scalar(model.toLowerCase())) => ({ model, command, table,
      paths: [], orderable: [table.primaryKeys[0]!], uniqueOrder: table.primaryKeys.length === 1 ? table.primaryKeys : [], multipleOrder: false, decode: decodeGraphCount });
    const modules: GraphParticipant[] = [
      { participant: productParticipant, module: declaredNativeGraph({ aliases: [{ name: sourceAlias, model: first.sourceModel }], reads: [read(first.sourceModel, variantRead)] }, [sourceConfig], []) },
      { participant: inventoryParticipant, module: declaredNativeGraph({ aliases: [{ name: "target", model: first.targetModel }], reads: [{ ...read(first.targetModel, inventoryRead),
        paths: [{ path: names[0], table: scalar("detail"), many: true, sourceFields: ["id"] },
          { path: names[1], table: scalar("calculation"), many: false, optional: true, sourceFields: ["id"] }] }] }, [targetConfig],
        [{ name: first.targetModel.toLowerCase(), relationships: [
          { name: names[0], type: "hasMany", targetModel: "Detail", targetTable: "detail", nullable: false, cascadeDelete: false, cascadeDetach: false },
          { name: names[1], type: "hasOne", targetModel: "Calculation", targetTable: "calculation", nullable: true, cascadeDelete: false, cascadeDetach: false },
        ] }]) },
      { participant: linkParticipant, module: declaredNativeGraph({ aliases: [{ name: "pairs", model: first.linkModel }], remotePaths: selected,
        reads: [read(first.linkModel, linkRead, { name: "pairs", columns: [first.sourceColumn, first.targetColumn],
          primaryKeys: [first.sourceColumn, first.targetColumn], foreignKeys: [], companions: {} })] }, [kind === "shipping" ? ShippingOptionPriceSet : neutral], []) },
    ];
    const graph = nativeGraphFixture(Result.getOrThrow(prepareLocalGraph(modules)));
    const input = { entity: sourceAlias, fields: ["id", `${names[0]}.id`, `${names[1]}.id`], pagination: { take: 4, skip: 0 } };
    const roots = [[{ id: "linked" }, { id: "unlinked" }], 2] satisfies Json;
    const links = [[{ [first.sourceColumn]: "linked", [first.targetColumn]: "target" }], 1] satisfies Json;
    const target = { id: "target", [names[0]]: [{ id: "detail" }], [names[1]]: { id: "calculation" } };
    const calls: Call[] = [];
    expect((await runEffect(graph.bind(context([roots, links, [[target], 1]], calls)).nativeGraph(input))).data)
      .toEqual([{ id: "linked", [names[0]]: [{ id: "detail" }], [names[1]]: { id: "calculation" } }, { id: "unlinked", [names[0]]: [] }]);
    expect(calls.map(call => call.command)).toEqual([variantRead, linkRead, inventoryRead]);
    expect((await runEffect(graph.bind(context([roots, [[], 0]])).nativeGraph(input))).data)
      .toEqual([{ id: "linked", [names[0]]: [] }, { id: "unlinked", [names[0]]: [] }]);
    expect((await runEffect(graph.bind(context([roots, links, [[], 0]])).nativeGraph(input))).data)
      .toEqual([{ id: "linked", [names[0]]: [] }, { id: "unlinked", [names[0]]: [] }]);
    const nativeNull = await runEffect(graph.bind(context([roots, links, [[{ ...target, [names[0]]: null }], 1]])).nativeGraph(input));
    expect(nativeNull.data).toEqual([{ id: "linked", [names[0]]: [null], [names[1]]: { id: "calculation" } },
      { id: "unlinked", [names[0]]: [], [names[1]]: undefined }]);
  });
  it("captures workflow module paths before composition and keeps ordinary modules unchanged", () => {
    const selected = participants(), endpoint = selected[0], link = selected[2];
    if (endpoint === undefined || link === undefined) throw new Error("Missing graph fixture");
    const mutable = paths.map(path => ({ ...path }));
    const module = Result.getOrThrow(defineWorkflowModule({ name: "link_module", source: { name: "test", profile: "test" },
      methods: {}, graph: { ...link.module, remotePaths: mutable } }));
    const plain = Result.getOrThrow(defineWorkflowModule({ name: "endpoint_module", source: { name: "test", profile: "test" },
      methods: {}, graph: endpoint.module }));
    mutable[0]!.maximumLinks = 1; mutable.length = 0;
    expect(workflowModuleDefinition(module)?.graph.remotePaths).toEqual(paths);
    expect(workflowModuleDefinition(plain)?.graph).not.toHaveProperty("remotePaths");
  });
  it("derives both directions from the canonical extends and relationship metadata", () => {
    expect(paths).toMatchObject([
      { root: "ProductVariant", path: "inventory", sourceModel: "ProductVariant", sourceKey: "id", sourceColumn: "variant_id",
        targetModel: "InventoryItem", targetKey: "id", targetColumn: "inventory_item_id" },
      { root: "ProductVariant", path: "inventory.variants", sourceModel: "InventoryItem", sourceKey: "id", sourceColumn: "inventory_item_id",
        targetModel: "ProductVariant", targetKey: "id", targetColumn: "variant_id" },
    ]);
    expect(paths[0]?.linkModel).toBe(paths[1]?.linkModel);
    expect(Result.isFailure(nativeLinkGraphPaths(metadata.joiner, [{ root: "ProductVariant", path: "missing",
      maximumSources: 4, maximumLinks: 8, maximumTargets: 8, maximumPerSource: 2 }]))).toBe(true);
    const changed = structuredClone(metadata.joiner);
    changed.extends = [];
    expect(Result.isFailure(nativeLinkGraphPaths(changed, [{ root: "ProductVariant", path: "inventory",
      maximumSources: 4, maximumLinks: 8, maximumTargets: 8, maximumPerSource: 2 }]))).toBe(true);
  });

  it("traverses two hops with authenticated reads, native pivot order and the caller's projection", async () => {
    const calls: Call[] = [];
    const results: Json[] = [
      [[{ id: "v1", title: "first", secret: "hidden" }, { id: "v2", title: "second" }], 2],
      [[{ variant_id: "v1", inventory_item_id: "i2" }, { variant_id: "v1", inventory_item_id: "i1" }, { variant_id: "v2", inventory_item_id: "i1" }], 3],
      [[{ id: "i1", title: "one" }, { id: "i2", title: "two" }], 2],
      [[{ inventory_item_id: "i1", variant_id: "v2" }, { inventory_item_id: "i1", variant_id: "v1" }, { inventory_item_id: "i2", variant_id: "v1" }], 3],
      [[{ id: "v1", title: "first" }, { id: "v2", title: "second" }], 2],
    ];
    const original = structuredClone(results);
    expect(await runEffect(graph().bind(context(results, calls)).nativeGraph(query(["title", "inventory.title", "inventory.variants.title"])))).toEqual({
      data: [{ id: "v1", title: "first", inventory: [{ id: "i2", title: "two", variants: [{ id: "v1", title: "first" }] },
        { id: "i1", title: "one", variants: [{ id: "v2", title: "second" }, { id: "v1", title: "first" }] }] },
      { id: "v2", title: "second", inventory: [{ id: "i1", title: "one", variants: [{ id: "v2", title: "second" }, { id: "v1", title: "first" }] }] }],
      metadata: { count: 2, skip: 0, take: 4 },
    });
    expect(calls.map(call => call.command)).toEqual([variantRead, linkRead, inventoryRead, linkRead, variantRead]);
    expect(calls.map(call => call.participant)).toEqual([productParticipant, linkParticipant, inventoryParticipant, linkParticipant, productParticipant]);
    expect(calls.map(call => call.args)).toEqual([
      { filters: { id: ["v1", "v2"] }, config: { select: ["title", "id"], relations: [], skip: 0, take: 4 } },
      { filters: { variant_id: ["v1", "v2"] }, config: { select: ["variant_id", "inventory_item_id"], relations: [], skip: 0, take: 256 } },
      { filters: { id: ["i2", "i1"] }, config: { select: ["title", "id"], relations: [], skip: 0, take: 256 } },
      { filters: { inventory_item_id: ["i2", "i1"] }, config: { select: ["inventory_item_id", "variant_id"], relations: [], skip: 0, take: 256 } },
      { filters: { id: ["v1", "v2"] }, config: { select: ["title", "id"], relations: [], skip: 0, take: 256 } },
    ]);
    expect(results).toEqual(original);
  });

  it("preserves empty and missing endpoint grouping without inventing related rows", async () => {
    const emptyCalls: Call[] = [];
    expect((await runEffect(graph().bind(context([[[], 0]], emptyCalls)).nativeGraph(query()))).data).toEqual([]);
    expect(emptyCalls).toHaveLength(1);
    const absentCalls: Call[] = [];
    const absent: Json[] = [[[ { id: "v1" } ], 1], [[], 0]];
    expect((await runEffect(graph().bind(context(absent, absentCalls)).nativeGraph(query()))).data).toEqual([{ id: "v1", inventory: [] }]);
    expect(absentCalls).toHaveLength(2);
    const missing: Json[] = [[[ { id: "v1" } ], 1], [[{ variant_id: "v1", inventory_item_id: "gone" }], 1], [[], 0]];
    expect((await runEffect(graph().bind(context(missing)).nativeGraph(query()))).data).toEqual([{ id: "v1", inventory: [undefined] }]);
  });

  it("keeps scalar queries local when remote paths are not selected", async () => {
    const calls: Call[] = [];
    expect((await runEffect(graph().bind(context([[[{ id: "v1", title: "first" }], 1]], calls)).nativeGraph(query(["title"])))).data)
      .toEqual([{ title: "first" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toMatchObject({ config: { select: ["title"], relations: [] } });
  });

  it("reads all thirty-two inverse edges and twenty-eight distinct Variant endpoints", async () => {
    const roots = Array.from({ length: 4 }, (_, index) => ({ id: "selected" + index }));
    const items = Array.from({ length: 8 }, (_, index) => ({ id: "item" + index }));
    const direct = items.map((item, index) => ({ variant_id: roots[Math.floor(index / 2)]!.id, inventory_item_id: item.id }));
    const inverse = items.flatMap((item, index) => [
      { inventory_item_id: item.id, variant_id: roots[Math.floor(index / 2)]!.id },
      ...Array.from({ length: 3 }, (_, owner) => ({ inventory_item_id: item.id, variant_id: "external" + index + "_" + owner })),
    ]);
    const targets = [...new Set(inverse.map(edge => edge.variant_id))].map(id => ({ id }));
    expect(targets).toHaveLength(28);
    const calls: Call[] = [];
    const result = await runEffect(graph().bind(context([[roots, 4], [direct, 8], [items, 8], [inverse, 32], [targets, 28]], calls))
      .nativeGraph({ ...query(), filters: { id: roots.map(root => root.id) } }));
    expect(result.data).toEqual(roots.map(root => ({ id: root.id, inventory: direct.filter(edge => edge.variant_id === root.id).map(edge => ({
      id: edge.inventory_item_id, variants: inverse.filter(owner => owner.inventory_item_id === edge.inventory_item_id).map(owner => ({ id: owner.variant_id })),
    })) })));
    expect(calls).toHaveLength(5);
    expect(calls[3]?.args).toMatchObject({ config: { take: 256 } });
    expect(calls[4]?.args).toMatchObject({ filters: { id: targets.map(target => target.id) }, config: { take: 256 } });
  });

  it("refuses source, link, target and per-source maxima before incomplete attachment", async () => {
    const cases: Array<{ paths?: readonly GraphRemotePath[]; results: Json[]; reason: string; take?: number }> = [
      { results: [[Array.from({ length: 5 }, (_, index) => ({ id: "v" + index })), 5]], reason: "unsupportedProfile", take: 8 },
      { results: [[[{ id: "v1" }], 1], [Array.from({ length: 9 }, (_, index) => ({ variant_id: "v1", inventory_item_id: "i" + index })), 9]], reason: "unsupportedProfile" },
      { results: [[[{ id: "v1" }], 1], [[{ variant_id: "v1", inventory_item_id: "i1" }, { variant_id: "v1", inventory_item_id: "i2" },
        { variant_id: "v1", inventory_item_id: "i3" }], 3]], reason: "unsupportedProfile" },
      { paths: paths.map(path => path.path === "inventory" ? { ...path, maximumTargets: 1 } : path),
        results: [[[{ id: "v1" }], 1], [[{ variant_id: "v1", inventory_item_id: "i1" }, { variant_id: "v1", inventory_item_id: "i2" }], 2]], reason: "unsupportedProfile" },
      { results: [[[{ id: "v1" }], 1], [[{ variant_id: "v1", inventory_item_id: "i1" }], 1], [[{ id: "i1" }], 1],
        [Array.from({ length: 5 }, (_, index) => ({ inventory_item_id: "i1", variant_id: "v" + index })), 5]], reason: "unsupportedProfile" },
    ];
    for (const entry of cases) {
      const input = entry.take === undefined ? query() : { ...query(), pagination: { take: entry.take } };
      expect(await runEffectFailure(graph(entry.paths).bind(context(entry.results)).nativeGraph(input))).toMatchObject({ reason: entry.reason });
    }
  });

  it("refuses truncated, malformed and foreign Link or endpoint results", async () => {
    const root: Json = [[{ id: "v1" }], 1];
    const links: Json = [[{ variant_id: "v1", inventory_item_id: "i1" }], 1];
    const cases: Json[][] = [
      [root, [[], 1]],
      [root, [[{ variant_id: "v1" }], 1]],
      [root, [[{ variant_id: 5, inventory_item_id: "i1" }], 1]],
      [root, [[{ variant_id: "outside", inventory_item_id: "i1" }], 1]],
      [root, links, [[], 1]],
      [root, links, [[{ title: "missing key" }], 1]],
      [root, links, [[{ id: "outside" }], 1]],
      [root, links, [[{ id: "i1" }, { id: "i1" }], 2]],
    ];
    for (const results of cases) expect(await runEffectFailure(graph().bind(context(results)).nativeGraph(query())))
      .toMatchObject({ reason: "storedCorruption" });
  });

  it("rejects absent, ambiguous and foreign participant bindings and missing prefixes", () => {
    const valid = participants();
    const product = valid[0], inventory = valid[1], link = valid[2];
    if (product === undefined || inventory === undefined || link === undefined) throw new Error("Incomplete graph fixture");
    const first = inventory.module.reads[0];
    if (first === undefined) throw new Error("Missing Inventory graph fixture");
    const ambiguous = { participant: inventoryParticipant, module: { aliases: [{ name: "other_item", model: "InventoryItem" }], reads: [first] } };
    const foreign = { participant: productParticipant, module: { aliases: [], reads: [], remotePaths: paths } };
    for (const selected of [
      [product, link],
      [...valid, ambiguous],
      [product, inventory, { ...link, module: { ...link.module, remotePaths: paths.filter(path => path.path.includes(".")) } }],
      [...valid.map(entry => entry === link ? { ...entry, module: { ...entry.module, remotePaths: [] } } : entry), foreign],
    ]) {
      expect(Result.isFailure(prepareLocalGraph(selected))).toBe(true);
    }
  });

  it("captures remote path metadata and field admission before callers mutate it", async () => {
    const mutable = paths.map(path => ({ ...path }));
    const prepared = graph(mutable);
    mutable[0]!.maximumLinks = 1;
    mutable[0]!.targetColumn = "secret";
    mutable.length = 0;
    const responses: Json[] = [[[{ id: "v1" }], 1], [[{ variant_id: "v1", inventory_item_id: "i1" }, { variant_id: "v1", inventory_item_id: "i2" }], 2],
      [[{ id: "i1", title: "one" }, { id: "i2", title: "two" }], 2]];
    expect((await runEffect(prepared.bind(context(responses)).nativeGraph(query(["inventory.title"])))).data)
      .toEqual([{ id: "v1", inventory: [{ id: "i1", title: "one" }, { id: "i2", title: "two" }] }]);
    expect(await runEffectFailure(prepared.bind(context([])).nativeGraph(query(["inventory.secret"])))).toHaveProperty("reason", "unsupportedProfile");
  });
});
