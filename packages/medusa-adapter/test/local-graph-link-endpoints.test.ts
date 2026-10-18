import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { defineAtomicCommerceParticipant, type AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureShippingOptionPriceSetLinkMetadata } from "../src/links/shipping-option-price-set-schema";
import { captureVariantInventoryLinkMetadata } from "../src/composition/product-variant-inventory-schema";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { nativeLinkGraphEndpoints, nativeLinkGraphServices, type GraphLinkEndpoint } from "../src/local-graph/links";
import { prepareLocalGraph, decodeGraphCount } from "../src/local-graph/query";
import type { GraphModuleDefinition, GraphParticipant } from "../src/local-graph/model";
import { defineWorkflowModule, workflowModuleDefinition } from "../src/workflow/module";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/support/effectTestRuntime";

const linkParticipant = defineAtomicCommerceParticipant("direct-link-rows");
const priceParticipant = defineAtomicCommerceParticipant("direct-link-price-sets");
const foreignParticipant = defineAtomicCommerceParticipant("direct-link-foreign");
const linkRead = defineGraphReadCommand("directLinkRows", () => Effect.succeed([[], 0]));
const priceRead = defineGraphReadCommand("directLinkPriceSets", () => Effect.succeed([[], 0]));
const table = { name: "price_set", columns: ["id", "title", "secret"], primaryKeys: ["id"], foreignKeys: [], companions: {} };
const childTable = { name: "price", columns: ["id", "price_set_id", "amount", "secret"], primaryKeys: ["id"], foreignKeys: ["price_set_id"], companions: {} };
let metadata: Effect.Success<ReturnType<typeof captureShippingOptionPriceSetLinkMetadata>>;
let endpoints: readonly GraphLinkEndpoint[];
let service: string;
beforeAll(async () => {
  metadata = await runEffect(captureShippingOptionPriceSetLinkMetadata());
  endpoints = Result.getOrThrow(nativeLinkGraphEndpoints(metadata.joiner, [{ path: "price_set", maximumSources: 4, maximumTargets: 4 }]));
  service = Schema.decodeUnknownSync(Schema.String)(metadata.joiner.serviceName);
});

function participants(selected: readonly GraphLinkEndpoint[] = endpoints): GraphParticipant[] {
  const endpoint = endpoints[0];
  if (endpoint === undefined) throw new Error("Missing native Link endpoint");
  const keys = metadata.frame.columns.filter(column => column.primaryKey).map(column => column.name);
  const price: GraphModuleDefinition = { aliases: [{ name: "price_set", model: "PriceSet" }], reads: [{ model: "PriceSet", command: priceRead, table,
    paths: [{ path: "prices", table: childTable, many: true, sourceFields: ["id"] }], orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] };
  const link: GraphModuleDefinition = { aliases: [{ name: "shipping_price_link", model: endpoint.root }],
    services: Result.getOrThrow(nativeLinkGraphServices(metadata.joiner)), reads: [{ model: endpoint.root, command: linkRead,
      table: { name: metadata.frame.name, columns: metadata.frame.columns.map(column => column.name), primaryKeys: keys, foreignKeys: [], companions: {} },
      paths: [], orderable: keys, uniqueOrder: [], multipleOrder: true, decode: decodeGraphCount }], linkEndpoints: selected };
  return [{ participant: linkParticipant, module: link }, { participant: priceParticipant, module: price }];
}
type Call = { readonly participant: Parameters<AtomicCommerceContext["call"]>[0]; readonly command: Parameters<AtomicCommerceContext["call"]>[1]; readonly args: Json };
function context(responses: readonly Json[], calls: Call[] = []): AtomicCommerceContext {
  let index = 0;
  return { eventGroupId: "direct-link-endpoint-test", checkpoint: Effect.void,
    capture: () => Effect.fail(commerceError("unsupportedProfile")), emit: () => Effect.fail(commerceError("unadmittedEvent")), refuse: Effect.fail,
    clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")),
    call: (participant, command, args) => {
      calls.push({ participant, command, args });
      const value = responses[index++];
      return value === undefined ? Effect.fail(commerceError("storedCorruption")) : Effect.succeed(value);
    },
  };
}
const query = (fields = ["shipping_option_id", "price_set.prices.amount"]) => ({ service, fields,
  filters: { shipping_option_id: ["so-a", "so-b"] }, pagination: { take: 4 } });
const graph = (selected: readonly GraphLinkEndpoint[] = endpoints) => Result.getOrThrow(prepareLocalGraph(participants(selected)));
const roots: Json = [[{ shipping_option_id: "so-a", price_set_id: "ps-a", id: "link-a" },
  { shipping_option_id: "so-b", price_set_id: "ps-b", id: "link-b" }], 2];
const targets: Json = [[{ id: "ps-b", title: "second", secret: "hidden", prices: [{ id: "price-b", price_set_id: "ps-b", amount: "20", secret: "hidden" }] },
  { id: "ps-a", title: "first", secret: "hidden", prices: [{ id: "price-a", price_set_id: "ps-a", amount: "10", secret: "hidden" }] }], 2];

describe("native direct Link-root endpoint graph reads", () => {
  it("derives exact to-one endpoint keys from both Shipping Pricing and Variant Inventory native metadata", async () => {
    expect(endpoints).toEqual([{ root: expect.any(String), path: "price_set", sourceKey: "price_set_id", targetModel: "PriceSet", targetKey: "id",
      maximumSources: 4, maximumTargets: 4 }]);
    const inventory = await runEffect(captureVariantInventoryLinkMetadata());
    const paths = Result.getOrThrow(nativeLinkGraphEndpoints(inventory.joiner, [
      { path: "inventory", maximumSources: 8, maximumTargets: 8 }, { path: "variant", maximumSources: 8, maximumTargets: 4 },
    ]));
    expect(paths).toEqual([
      { root: expect.any(String), path: "inventory", sourceKey: "inventory_item_id", targetModel: "InventoryItem", targetKey: "id", maximumSources: 8, maximumTargets: 8 },
      { root: expect.any(String), path: "variant", sourceKey: "variant_id", targetModel: "ProductVariant", targetKey: "id", maximumSources: 8, maximumTargets: 4 },
    ]);
    expect(paths[0]?.root).toBe(paths[1]?.root);
  });

  it("uses the same direct endpoint owner for a native Variant Inventory Link", async () => {
    const inventory = await runEffect(captureVariantInventoryLinkMetadata()), selected = Result.getOrThrow(nativeLinkGraphEndpoints(inventory.joiner,
      [{ path: "inventory", maximumSources: 8, maximumTargets: 8 }]));
    const endpoint = selected[0]; if (endpoint === undefined) throw new Error("Missing native Inventory endpoint");
    const inventoryRead = defineGraphReadCommand("directLinkInventoryEndpoint", () => Effect.succeed([[], 0]));
    const selectedParticipants: GraphParticipant[] = [
      { participant: linkParticipant, module: { aliases: [{ name: "variant_inventory_link", model: endpoint.root }],
        services: Result.getOrThrow(nativeLinkGraphServices(inventory.joiner)), linkEndpoints: selected,
        reads: [{ model: endpoint.root, command: linkRead,
          table: { name: inventory.frame.name, columns: inventory.frame.columns.map(column => column.name),
            primaryKeys: inventory.frame.columns.filter(column => column.primaryKey).map(column => column.name), foreignKeys: [], companions: {} },
          paths: [], orderable: ["variant_id"], uniqueOrder: [], multipleOrder: true, decode: decodeGraphCount }] } },
      { participant: foreignParticipant, module: { aliases: [{ name: "inventory_item", model: "InventoryItem" }], reads: [{ model: "InventoryItem", command: inventoryRead,
        table: { name: "inventory_item", columns: ["id", "sku"], primaryKeys: ["id"], foreignKeys: [], companions: {} }, paths: [],
        orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] } },
    ];
    const prepared = Result.getOrThrow(prepareLocalGraph(selectedParticipants)), calls: Call[] = [];
    const result = await runEffect(prepared.bind(context([[[{ variant_id: "variant-a", inventory_item_id: "item-a" }], 1],
      [[{ id: "item-a", sku: "native-sku" }], 1]], calls)).service({ service: inventory.joiner.serviceName, fields: ["variant_id", "inventory.sku"],
      filters: { variant_id: ["variant-a"] }, pagination: { take: 8 } }));
    expect(result.data).toEqual([{ variant_id: "variant-a", inventory_item_id: "item-a", inventory: { id: "item-a", sku: "native-sku" } }]);
    expect(calls.map(call => call.command)).toEqual([linkRead, inventoryRead]);
    expect(calls[1]?.args).toEqual({ filters: { id: ["item-a"] },
      config: { select: ["id", "sku"], relations: [], order: { id: "ASC" }, skip: 0, take: 8 } });
  });

  it("refuses missing, duplicated and ambiguous native endpoint aliases and invalid bounds", () => {
    const selection = [{ path: "price_set", maximumSources: 4, maximumTargets: 4 }];
    expect(Result.isFailure(nativeLinkGraphEndpoints(metadata.joiner, [{ path: "missing", maximumSources: 4, maximumTargets: 4 }]))).toBe(true);
    expect(Result.isFailure(nativeLinkGraphEndpoints(metadata.joiner, [...selection, ...selection]))).toBe(true);
    const duplicate = structuredClone(metadata.joiner), relation = duplicate.relationships?.find(item => item.alias === "price_set");
    if (relation === undefined || duplicate.relationships === undefined) throw new Error("Missing authentic native Pricing relation");
    duplicate.relationships = [...duplicate.relationships, relation];
    expect(Result.isFailure(nativeLinkGraphEndpoints(duplicate, selection))).toBe(true);
    const missing = structuredClone(metadata.joiner); missing.relationships = [];
    expect(Result.isFailure(nativeLinkGraphEndpoints(missing, selection))).toBe(true);
    const ambiguous = structuredClone(metadata.joiner);
    ambiguous.alias = [...(Array.isArray(ambiguous.alias) ? ambiguous.alias : []), { name: "foreign", entity: "ForeignLink" }];
    expect(Result.isFailure(nativeLinkGraphEndpoints(ambiguous, selection))).toBe(true);
    for (const bounds of [{ maximumSources: 0, maximumTargets: 4 }, { maximumSources: 4, maximumTargets: 129 }])
      expect(Result.isFailure(nativeLinkGraphEndpoints(metadata.joiner, [{ path: "price_set", ...bounds }]))).toBe(true);
  });

  it("captures module endpoint definitions immutably and leaves ordinary modules without this capability", () => {
    const [link, price] = participants();
    if (link === undefined || price === undefined) throw new Error("Missing direct Link module fixture");
    const mutable = endpoints.map(endpoint => ({ ...endpoint }));
    const module = Result.getOrThrow(defineWorkflowModule({ name: "direct_link", source: { name: "direct-link", profile: "unit" }, methods: {},
      graph: { ...link.module, linkEndpoints: mutable } }));
    const ordinary = Result.getOrThrow(defineWorkflowModule({ name: "direct_price", source: { name: "direct-price", profile: "unit" }, methods: {}, graph: price.module }));
    const first = mutable[0]; if (first === undefined) throw new Error("Missing endpoint snapshot");
    first.sourceKey = "foreign"; first.maximumTargets = 1; mutable.length = 0;
    const captured = workflowModuleDefinition(module)?.graph.linkEndpoints;
    expect(captured).toEqual(endpoints); expect(Object.isFrozen(captured)).toBe(true); expect(Object.isFrozen(captured?.[0])).toBe(true);
    expect(workflowModuleDefinition(ordinary)?.graph).not.toHaveProperty("linkEndpoints");
  });

  it("resolves a native service-name Link root once and preserves nested to-one objects with local child rows", async () => {
    const calls: Call[] = [], responses = [roots, targets], original = structuredClone(responses);
    expect(await runEffect(graph().bind(context(responses, calls)).service(query()))).toEqual({
      data: [{ shipping_option_id: "so-a", price_set_id: "ps-a", price_set: { id: "ps-a", prices: [{ id: "price-a", amount: "10" }] } },
        { shipping_option_id: "so-b", price_set_id: "ps-b", price_set: { id: "ps-b", prices: [{ id: "price-b", amount: "20" }] } }],
      metadata: { count: 2, skip: 0, take: 4 },
    });
    expect(calls.map(call => call.command)).toEqual([linkRead, priceRead]);
    expect(calls.map(call => call.participant)).toEqual([linkParticipant, priceParticipant]);
    expect(calls[0]?.args).toEqual({ filters: { shipping_option_id: ["so-a", "so-b"] },
      config: { select: ["shipping_option_id", "price_set_id"], relations: [], order: { shipping_option_id: "ASC" }, skip: 0, take: 4 } });
    expect(calls[1]?.args).toEqual({ filters: { id: ["ps-a", "ps-b"] },
      config: { select: ["id", "title", "secret"], relations: ["prices"], order: { id: "ASC" }, skip: 0, take: 4 } });
    expect(responses).toEqual(original);
  });

  it("masks helper keys and unselected values in ordinary graph projection", async () => {
    const calls: Call[] = [];
    expect((await runEffect(graph().bind(context([roots, targets], calls)).graph({ entity: "shipping_price_link",
      fields: ["price_set.prices.amount"], filters: { shipping_option_id: ["so-a", "so-b"] }, pagination: { take: 4 } }))).data).toEqual([
      { price_set: { prices: [{ amount: "10" }] } }, { price_set: { prices: [{ amount: "20" }] } },
    ]);
    expect(calls.map(call => call.command)).toEqual([linkRead, priceRead]);
    expect(calls[0]?.args).toMatchObject({ config: { select: ["shipping_option_id", "price_set_id"], relations: [] } });
  });

  it("fetches a declared endpoint source column even when a neutral Link view has an independent identity", async () => {
    const selected = participants(), link = selected[0];
    if (link === undefined) throw new Error("Missing direct Link source fixture");
    const source = link.module.reads[0]; if (source === undefined) throw new Error("Missing direct Link read");
    selected[0] = { ...link, module: { ...link.module, reads: [{ ...source,
      table: { ...source.table, primaryKeys: ["id"], foreignKeys: ["price_set_id"] }, orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false }] } };
    const prepared = Result.getOrThrow(prepareLocalGraph(selected)), calls: Call[] = [];
    expect((await runEffect(prepared.bind(context([[[{ id: "link-a", price_set_id: "ps-a" }], 1],
      [[{ id: "ps-a", title: "one" }], 1]], calls)).graph({ entity: "shipping_price_link", fields: ["price_set.title"],
      filters: { id: ["link-a"] }, pagination: { take: 4 } }))).data).toEqual([{ price_set: { title: "one" } }]);
    expect(calls[0]?.args).toEqual({ filters: { id: ["link-a"] },
      config: { select: ["id", "price_set_id"], relations: [], order: { id: "ASC" }, skip: 0, take: 4 } });
  });

  it("deduplicates a shared target identity and does not issue an additional Link read", async () => {
    const calls: Call[] = [];
    const response: Json = [[{ id: "ps-a", title: "shared" }], 1];
    const result = await runEffect(graph().bind(context([[[{ shipping_option_id: "so-a", price_set_id: "ps-a" },
      { shipping_option_id: "so-b", price_set_id: "ps-a" }], 2], response], calls)).service(query(["price_set.title"])));
    expect(result.data).toEqual([{ price_set_id: "ps-a", price_set: { id: "ps-a", title: "shared" } },
      { price_set_id: "ps-a", price_set: { id: "ps-a", title: "shared" } }]);
    expect(calls).toHaveLength(2); expect(calls[1]?.args).toMatchObject({ filters: { id: ["ps-a"] } });
  });

  it("keeps scalar-only queries local and omits endpoint calls for an empty Link set", async () => {
    const calls: Call[] = [];
    expect((await runEffect(graph().bind(context([roots], calls)).service(query(["shipping_option_id"])))).data)
      .toEqual([{ shipping_option_id: "so-a" }, { shipping_option_id: "so-b" }]);
    expect(calls.map(call => call.command)).toEqual([linkRead]);
    const emptyCalls: Call[] = [];
    expect((await runEffect(graph().bind(context([[[], 0]], emptyCalls)).service(query()))).data).toEqual([]);
    expect(emptyCalls).toHaveLength(1);
  });

  it("attaches null for absent targets and refuses malformed Link endpoint identities", async () => {
    const only: Json = [[{ shipping_option_id: "so-a", price_set_id: "gone" }], 1];
    expect((await runEffect(graph().bind(context([only, [[], 0]])).service(query(["shipping_option_id", "price_set.title"])))).data)
      .toEqual([{ shipping_option_id: "so-a", price_set_id: "gone", price_set: null }]);
    for (const row of [{ shipping_option_id: "so-a" }, { shipping_option_id: "so-a", price_set_id: null },
      { shipping_option_id: "so-a", price_set_id: 7 }])
      expect(await runEffectFailure(graph().bind(context([[[row], 1]])).service(query()))).toMatchObject({ reason: "storedCorruption" });
  });

  it("requires complete, unique, requested target identities and native nested return shapes", async () => {
    const root: Json = [[{ shipping_option_id: "so-a", price_set_id: "ps-a" }], 1];
    const invalid: Json[] = [[[], 1], [[{ id: "ps-a" }], 2], [[{ id: "outside", title: "foreign" }], 1],
      [[{ id: "ps-a", title: "first" }, { id: "ps-a", title: "duplicate" }], 2], [[{ title: "missing identity" }], 1],
      [[{ id: "ps-a", prices: {} }], 1], [[{ id: "ps-a", prices: [{ id: "price", secret: "missing selected amount" }] }], 1]];
    for (const target of invalid)
      expect(await runEffectFailure(graph().bind(context([root, target])).service(query()))).toMatchObject({ reason: "storedCorruption" });
  });

  it("enforces source, distinct-target and complete target maxima before attachment", async () => {
    const sourceBound = endpoints.map(endpoint => ({ ...endpoint, maximumSources: 1 }));
    const targetBound = endpoints.map(endpoint => ({ ...endpoint, maximumTargets: 1 }));
    for (const selected of [sourceBound, targetBound]) {
      const calls: Call[] = [];
      expect(await runEffectFailure(graph(selected).bind(context([roots], calls)).service(query()))).toMatchObject({ reason: "unsupportedProfile" });
      expect(calls).toHaveLength(1);
    }
    const small = endpoints.map(endpoint => ({ ...endpoint, maximumTargets: 2 }));
    const root: Json = [[{ shipping_option_id: "so-a", price_set_id: "ps-a" }], 1];
    expect(await runEffectFailure(graph(small).bind(context([root, [[], 3]])).service(query()))).toMatchObject({ reason: "unsupportedProfile" });
  });

  it("refuses missing, ambiguous, foreign-owned and wrongly keyed composition endpoints", () => {
    const valid = participants(), link = valid[0], price = valid[1], endpoint = endpoints[0];
    if (link === undefined || price === undefined || endpoint === undefined) throw new Error("Incomplete direct Link fixture");
    const target = price.module.reads[0], source = link.module.reads[0];
    if (target === undefined || source === undefined) throw new Error("Missing native read fixtures");
    const duplicateTarget: GraphParticipant = { participant: foreignParticipant, module: { aliases: [{ name: "other_price_set", model: "PriceSet" }], reads: [target] } };
    const foreign: GraphParticipant = { participant: foreignParticipant, module: { aliases: [], reads: [], linkEndpoints: endpoints } };
    const wrongKey: GraphParticipant = { ...price, module: { ...price.module, reads: [{ ...target,
      table: { ...target.table, primaryKeys: ["title"] }, orderable: ["id", "title"], uniqueOrder: ["id", "title"] }] } };
    const collision: GraphParticipant = { ...link, module: { ...link.module, reads: [{ ...source,
      paths: [{ path: "price_set", table, many: false, sourceFields: ["price_set_id"] }] }] } };
    for (const selected of [[link], [...valid, duplicateTarget], [link, wrongKey], [collision, price],
      [{ ...link, module: { ...link.module, linkEndpoints: [] } }, price, foreign],
      participants([...endpoints, ...endpoints]), participants([{ ...endpoint, sourceKey: "foreign" }]),
      participants([{ ...endpoint, targetKey: "title" }]), participants([{ ...endpoint, root: "MissingLink" }])])
      expect(Result.isFailure(prepareLocalGraph(selected))).toBe(true);
  });

  it("captures graph endpoint admission before callers mutate metadata and rejects unknown selected fields", async () => {
    const mutable = endpoints.map(endpoint => ({ ...endpoint })), prepared = graph(mutable), first = mutable[0];
    if (first === undefined) throw new Error("Missing direct endpoint");
    first.maximumTargets = 1; first.sourceKey = "secret"; mutable.length = 0;
    expect((await runEffect(prepared.bind(context([roots, targets])).service(query()))).data).toHaveLength(2);
    const calls: Call[] = [];
    expect(await runEffectFailure(prepared.bind(context([], calls)).service(query(["price_set.unknown"]))))
      .toMatchObject({ reason: "unsupportedProfile" });
    expect(calls).toEqual([]);
  });
});
