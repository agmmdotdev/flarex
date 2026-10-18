import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defineAtomicCommerceParticipant, type AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureVariantInventoryLinkMetadata } from "../src/composition/product-variant-inventory-schema";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { nativeLinkGraphPaths } from "../src/local-graph/links";
import { prepareLocalGraph, decodeGraphCount } from "../src/local-graph/query";
import type { GraphModuleDefinition, GraphParticipant, GraphRemotePath } from "../src/local-graph/model";
import { defineWorkflowModule, workflowModuleDefinition } from "../src/workflow/module";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/support/effectTestRuntime";

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
  const endpoint = (model: string, alias: string, command: typeof variantRead): GraphModuleDefinition => ({
    aliases: [{ name: alias, model }], reads: [{ model, command,
      table: { name: alias, columns: ["id", "title"], primaryKeys: ["id"], foreignKeys: [], companions: {} },
      paths: [], orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }],
  });
  const link = paths[0];
  if (link === undefined) throw new Error("Missing native Link path");
  return [
    { participant: productParticipant, module: endpoint("ProductVariant", "variant", variantRead) },
    { participant: inventoryParticipant, module: endpoint("InventoryItem", "inventory_item", inventoryRead) },
    { participant: linkParticipant, module: { aliases: [{ name: "variant_inventory_link", model: link.linkModel }],
      reads: [{ model: link.linkModel, command: linkRead,
        table: { name: metadata.frame.name, columns: metadata.frame.columns.map(column => column.name),
          primaryKeys: metadata.frame.columns.filter(column => column.primaryKey).map(column => column.name), foreignKeys: [], companions: {} },
        paths: [], orderable: [link.sourceColumn], uniqueOrder: [], multipleOrder: false, decode: decodeGraphCount }], remotePaths } },
  ];
}
type Call = { readonly participant: Parameters<AtomicCommerceContext["call"]>[0]; readonly command: Parameters<AtomicCommerceContext["call"]>[1]; readonly args: Json };
function context(responses: readonly Json[], calls: Call[] = []): AtomicCommerceContext {
  let index = 0;
  return { eventGroupId: "unit-link-graph", checkpoint: Effect.void,
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
  filters: { id: ["v1", "v2"] }, pagination: { take: 4 } });
const graph = (remotePaths: readonly GraphRemotePath[] = paths) => Result.getOrThrow(prepareLocalGraph(participants(remotePaths)));

describe("native Link-derived local graph paths", () => {
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
    expect(await runEffect(graph().bind(context(results, calls)).graph(query(["title", "inventory.title", "inventory.variants.title"])))).toEqual({
      data: [{ title: "first", inventory: [{ title: "two", variants: [{ title: "first" }] },
        { title: "one", variants: [{ title: "second" }, { title: "first" }] }] },
      { title: "second", inventory: [{ title: "one", variants: [{ title: "second" }, { title: "first" }] }] }],
      metadata: { count: 2, skip: 0, take: 4 },
    });
    expect(calls.map(call => call.command)).toEqual([variantRead, linkRead, inventoryRead, linkRead, variantRead]);
    expect(calls.map(call => call.participant)).toEqual([productParticipant, linkParticipant, inventoryParticipant, linkParticipant, productParticipant]);
    expect(calls.map(call => call.args)).toEqual([
      { filters: { id: ["v1", "v2"] }, config: { select: ["title", "id"], relations: [], order: { id: "ASC" }, skip: 0, take: 4 } },
      { filters: { variant_id: ["v1", "v2"] }, config: { select: ["variant_id", "inventory_item_id"], relations: [], order: { variant_id: "ASC" }, skip: 0, take: 8 } },
      { filters: { id: ["i2", "i1"] }, config: { select: ["title", "id"], relations: [], order: { id: "ASC" }, skip: 0, take: 8 } },
      { filters: { inventory_item_id: ["i1", "i2"] }, config: { select: ["inventory_item_id", "variant_id"], relations: [], order: { variant_id: "ASC" }, skip: 0, take: 32 } },
      { filters: { id: ["v2", "v1"] }, config: { select: ["title", "id"], relations: [], order: { id: "ASC" }, skip: 0, take: 32 } },
    ]);
    expect(results).toEqual(original);
  });

  it("preserves empty and missing endpoint grouping without inventing related rows", async () => {
    const emptyCalls: Call[] = [];
    expect((await runEffect(graph().bind(context([[[], 0]], emptyCalls)).graph(query()))).data).toEqual([]);
    expect(emptyCalls).toHaveLength(1);
    const absentCalls: Call[] = [];
    const absent: Json[] = [[[ { id: "v1" } ], 1], [[], 0]];
    expect((await runEffect(graph().bind(context(absent, absentCalls)).graph(query()))).data).toEqual([{ id: "v1", inventory: [] }]);
    expect(absentCalls).toHaveLength(2);
    const missing: Json[] = [[[ { id: "v1" } ], 1], [[{ variant_id: "v1", inventory_item_id: "gone" }], 1], [[], 0]];
    expect((await runEffect(graph().bind(context(missing)).graph(query()))).data).toEqual([{ id: "v1", inventory: [] }]);
  });

  it("keeps scalar queries local when remote paths are not selected", async () => {
    const calls: Call[] = [];
    expect((await runEffect(graph().bind(context([[[{ id: "v1", title: "first" }], 1]], calls)).graph(query(["title"])))).data)
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
      .graph({ ...query(), filters: { id: roots.map(root => root.id) } }));
    expect(result.data).toEqual(roots.map(root => ({ id: root.id, inventory: direct.filter(edge => edge.variant_id === root.id).map(edge => ({
      id: edge.inventory_item_id, variants: inverse.filter(owner => owner.inventory_item_id === edge.inventory_item_id).map(owner => ({ id: owner.variant_id })),
    })) })));
    expect(calls).toHaveLength(5);
    expect(calls[3]?.args).toMatchObject({ config: { take: 32 } });
    expect(calls[4]?.args).toMatchObject({ filters: { id: targets.map(target => target.id) }, config: { take: 32 } });
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
      expect(await runEffectFailure(graph(entry.paths).bind(context(entry.results)).graph(input))).toMatchObject({ reason: entry.reason });
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
    for (const results of cases) expect(await runEffectFailure(graph().bind(context(results)).graph(query())))
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
    expect((await runEffect(prepared.bind(context(responses)).graph(query(["inventory.title"])))).data)
      .toEqual([{ inventory: [{ title: "one" }, { title: "two" }] }]);
    expect(await runEffectFailure(prepared.bind(context([])).graph(query(["inventory.secret"])))).toHaveProperty("reason", "unsupportedProfile");
  });
});
