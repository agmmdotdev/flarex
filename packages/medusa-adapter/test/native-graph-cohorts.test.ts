import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import type { JoinerRelationship, ModuleJoinerConfig } from "@medusajs/types";
import { createQuery, RemoteQuery, type RemoteQueryFetchRequest } from "@medusajs/modules-sdk/remote-query";
import { RemoteJoiner } from "@medusajs/orchestration/joiner";
import { InventoryLevelStockLocation, ProductVariantPriceSet } from "@medusajs/link-modules";
import { inventoryStaticResources } from "@medusajs/inventory/static-manifest";
import { stockLocationStaticResources } from "@medusajs/stock-location/static-manifest";
import { joinerConfig as productJoiner } from "@medusajs/product/joiner-config";
import { pricingStaticResources } from "@medusajs/pricing/static-manifest";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommerceTransactionError, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { prepareNativeCohorts } from "../src/local-graph/native-cohorts";
import type { ResolvedGraphDirectPath } from "../src/local-graph/direct-paths";
import type { GraphReadSelection } from "../src/local-graph/model";
import { decodeGraphCount } from "../src/local-graph/query";
import type { ResolvedGraphLinkEndpoint, ResolvedGraphRemotePath } from "../src/local-graph/remote-paths";

function selection(model: string, columns = ["id"], participant = defineAtomicCommerceParticipant(`cohort-${model}`)): GraphReadSelection {
  return { participant, read: { model, command: defineGraphReadCommand(`cohortRead${model}`, () => Effect.succeed([[], 0])),
    table: { name: model.toLowerCase(), columns, primaryKeys: ["id"], foreignKeys: columns.filter(column => column !== "id"), companions: {} },
    paths: [], orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount } };
}
const root = selection("Root"), target = selection("Target", ["id", "owner_id", "name"]), link = selection("Pair", ["id", "left_id", "right_id"]);
const service = (selected: GraphReadSelection) => ({ serviceName: selected.read.model.toLowerCase(), entity: selected.read.model,
  primaryKeys: [...selected.read.table.primaryKeys] });
function request(selected: GraphReadSelection, options: Readonly<{ parent?: string; property?: string; parentRead?: GraphReadSelection;
  key?: string; ids?: readonly string[]; relationship?: JoinerRelationship }> = {}): RemoteQueryFetchRequest {
  return { serviceName: selected.read.model.toLowerCase(), keyField: options.key ?? "id", ...(options.ids === undefined ? {} : { ids: [...options.ids] }),
    ...(options.relationship === undefined ? {} : { relationship: options.relationship }), filters: {}, options: { select: ["id"], relations: [], args: {} },
    expand: { property: options.property ?? "", parent: options.parent ?? "", serviceConfig: service(selected),
      ...(options.parentRead === undefined ? {} : { parentConfig: service(options.parentRead) }) } };
}
function remote(changes: Partial<ResolvedGraphRemotePath> = {}): ResolvedGraphRemotePath {
  return { root: root.read.model, path: "targets", sourceModel: root.read.model, sourceKey: "id", linkModel: link.read.model,
    sourceColumn: "left_id", targetColumn: "right_id", targetModel: target.read.model, targetKey: "id",
    source: root, link, target, maximumSources: 2, maximumLinks: 3, maximumTargets: 3, maximumPerSource: 2, ...changes };
}
function direct(changes: Partial<ResolvedGraphDirectPath> = {}): ResolvedGraphDirectPath {
  return { root: root.read.model, path: "details", sourceModel: root.read.model, sourceKey: "id", targetModel: target.read.model,
    targetKey: "owner_id", source: root, target, nullableSourceKey: false, many: true,
    maximumSources: 2, maximumTargets: 3, maximumPerSource: 2, ...changes };
}
function prepare(options: Readonly<{ root?: GraphReadSelection; fields?: readonly string[]; remote?: readonly ResolvedGraphRemotePath[];
  direct?: readonly ResolvedGraphDirectPath[]; endpoints?: readonly ResolvedGraphLinkEndpoint[] }> = {}) {
  return Result.getOrThrow(prepareNativeCohorts({ root: options.root ?? root, fields: options.fields ?? ["id", "targets.id"],
    remote: new Map((options.remote ?? [remote()]).map(path => [path.path, path])),
    direct: new Map((options.direct ?? []).map(path => [path.path, path])), endpoints: new Map((options.endpoints ?? []).map(path => [path.path, path])) }));
}
const linkRequest = (ids = ["left"]) => request(link, { parent: "_root", property: "target_link", parentRead: root, key: "left_id", ids,
  relationship: { serviceName: "pair", primaryKey: "left_id", foreignKey: "id", alias: "target_link", isList: true } });
const targetRequest = (ids = ["right"]) => request(target, { parent: "_root.target_link", property: "target", parentRead: link, ids,
  relationship: { serviceName: "target", entity: "Target", primaryKey: "id", foreignKey: "right_id", alias: "target" } });
const admit = (result: Result.Result<void, CommerceTransactionError>) => expect(Result.getOrThrow(result)).toBeUndefined();
const reason = (result: Result.Result<void, CommerceTransactionError>) => Result.match(result, { onFailure: error => error.reason, onSuccess: () => "accepted" });

describe("native raw cohort admission", () => {
  it("counts source rows before native ID deduplication, including checked local parents", () => {
    expect(reason(prepare().observe(request(root), root, [{ id: "same" }, { id: "same" }, { id: "same" }]))).toBe("unsupportedProfile");
    const item = selection("Item", ["id"], root.participant);
    const cart: GraphReadSelection = { ...root, read: { ...root.read, paths: [{ path: "items", many: true, table: item.read.table }] } };
    const edge = remote({ path: "items.targets", sourceModel: item.read.model, source: item });
    const prepared = prepare({ root: cart, fields: ["items.targets.id"], remote: [edge] });
    expect(reason(prepared.observe(request(cart), cart, [{ id: "cart", items: [{ id: "same" }, { id: "same" }, { id: "same" }] }]))).toBe("unsupportedProfile");
  });

  it("admits complete raw Link and target cohorts without attaching or changing any DTO", () => {
    const prepared = prepare(), parents = [{ id: "left" }, { id: "other" }];
    const links = [{ left_id: "left", right_id: "right" }, { left_id: "other", right_id: "right" }, { left_id: "other", right_id: "second" }];
    const rows = [{ id: "right", name: "One" }, { id: "second", name: "Two" }], before = structuredClone({ parents, links, rows });
    admit(prepared.observe(request(root), root, parents));
    admit(prepared.observe(linkRequest(["left", "other"]), link, links));
    admit(prepared.observe(targetRequest(["right", "second"]), target, rows));
    expect({ parents, links, rows }).toEqual(before);
    expect(parents[0]).not.toHaveProperty("targets");
  });

  it.each([
    { changes: { maximumLinks: 1 }, rows: [{ left_id: "left", right_id: "one" }, { left_id: "left", right_id: "two" }] },
    { changes: { maximumPerSource: 1 }, rows: [{ left_id: "left", right_id: "one" }, { left_id: "left", right_id: "two" }] },
    { changes: { maximumTargets: 1 }, rows: [{ left_id: "left", right_id: "one" }, { left_id: "left", right_id: "two" }] },
  ])("enforces raw Link, per-source and distinct target bounds ($changes)", ({ changes, rows }) => {
    const prepared = prepare({ remote: [remote(changes)] });
    admit(prepared.observe(request(root), root, [{ id: "left" }]));
    expect(reason(prepared.observe(linkRequest(), link, rows))).toBe("unsupportedProfile");
  });

  it("applies the minimum bound across native canonical suffix aliases", () => {
    const prepared = prepare({ fields: ["prices.id", "calculated_price.total"], remote: [
      remote({ path: "prices", canonicalPath: "target_link.target", targetSuffix: "prices", outputMany: true, maximumPerSource: 2 }),
      remote({ path: "calculated_price", canonicalPath: "target_link.target", targetSuffix: "calculated_price", maximumPerSource: 1 }),
    ] });
    admit(prepared.observe(request(root), root, [{ id: "left" }]));
    expect(reason(prepared.observe(linkRequest(), link, [{ left_id: "left", right_id: "one" }, { left_id: "left", right_id: "two" }]))).toBe("unsupportedProfile");
  });

  it.each([
    { rows: [{ left_id: "foreign", right_id: "right" }] }, { rows: [{ left_id: "left" }] }, { rows: [{ right_id: "right" }] },
  ])("refuses missing and out-of-selection Link keys", ({ rows }) => {
    const prepared = prepare();
    admit(prepared.observe(request(root), root, [{ id: "left" }]));
    expect(reason(prepared.observe(linkRequest(), link, rows))).toBe("storedCorruption");
  });

  it.each([{ rows: [{}] }, { rows: [{ id: "foreign" }] }, { rows: [{ id: "right" }, { id: "right" }] }])("refuses missing, foreign and duplicate remote target identities", ({ rows }) => {
    const prepared = prepare();
    admit(prepared.observe(request(root), root, [{ id: "left" }]));
    admit(prepared.observe(linkRequest(), link, [{ left_id: "left", right_id: "right" }]));
    expect(reason(prepared.observe(targetRequest(), target, rows))).toBe("storedCorruption");
  });

  it("leaves absent referenced targets to the native relation-missing policy", () => {
    const prepared = prepare();
    admit(prepared.observe(request(root), root, [{ id: "left" }]));
    admit(prepared.observe(linkRequest(), link, [{ left_id: "left", right_id: "right" }]));
    admit(prepared.observe(targetRequest(), target, []));
  });

  it("authenticates actual parent path, issued read, requested IDs and directional rich-Link keys", () => {
    const prepared = prepare();
    admit(prepared.observe(request(root), root, [{ id: "left" }]));
    const ordinary = linkRequest();
    for (const changed of [
      { ...ordinary, keyField: "right_id" }, { ...ordinary, ids: ["foreign"] },
      { ...ordinary, expand: { ...ordinary.expand, parent: "_root.unrelated" } },
      { ...ordinary, expand: { ...ordinary.expand, parentConfig: { ...service(root), serviceName: "foreign" } } },
    ]) expect(reason(prepared.observe(changed, link, [{ left_id: "left", right_id: "right" }]))).toBe("invalidAuthority");
    expect(reason(prepared.observe(ordinary, selection("Pair", ["id", "left_id", "right_id"]), []))).toBe("invalidAuthority");
    admit(prepared.observe(ordinary, link, [{ left_id: "left", right_id: "right" }]));
  });

  it("keeps direct inverse foreign-key cardinality separate from unique endpoint keys", () => {
    const prepared = prepare({ fields: ["details.id"], remote: [], direct: [direct()] });
    admit(prepared.observe(request(root), root, [{ id: "left" }]));
    const read = request(target, { parent: "_root", property: "details", parentRead: root, key: "owner_id", ids: ["left"],
      relationship: { serviceName: "target", primaryKey: "id", foreignKey: "owner_id", alias: "details", inverse: true, isList: true } });
    admit(prepared.observe(read, target, [{ id: "one", owner_id: "left" }, { id: "two", owner_id: "left" }]));
    const overflow = prepare({ fields: ["details.id"], remote: [], direct: [direct({ maximumPerSource: 1 })] });
    admit(overflow.observe(request(root), root, [{ id: "left" }]));
    expect(reason(overflow.observe(read, target, [{ id: "one", owner_id: "left" }, { id: "two", owner_id: "left" }]))).toBe("unsupportedProfile");
  });

  it("admits and bounds same-service direct descendants in the raw parent fetch", () => {
    const localTarget = { ...target, participant: root.participant };
    const prepared = prepare({ fields: ["details.id"], remote: [], direct: [direct({ target: localTarget })] });
    admit(prepared.observe(request(root), root, [{ id: "left", details: [{ id: "one", owner_id: "left" }] }]));
    const overflow = prepare({ fields: ["details.id"], remote: [], direct: [direct({ target: localTarget, maximumPerSource: 1 })] });
    expect(reason(overflow.observe(request(root), root, [{ id: "left", details: [{ id: "one", owner_id: "left" }, { id: "two", owner_id: "left" }] }]))).toBe("unsupportedProfile");
    const grand = selection("Grand", ["id", "owner_id"], root.participant);
    const nested: ResolvedGraphDirectPath = { ...direct(), path: "details.grand", source: localTarget, sourceModel: localTarget.read.model,
      target: grand, targetModel: grand.read.model, maximumPerSource: 1 };
    const deep = prepare({ fields: ["details.grand.id"], remote: [], direct: [direct({ target: localTarget }), nested] });
    expect(reason(deep.observe(request(root), root, [{ id: "left", details: [{ id: "one", owner_id: "left",
      grand: [{ id: "a", owner_id: "one" }, { id: "b", owner_id: "one" }] }] }]))).toBe("unsupportedProfile");
  });

  it("admits selected hydrated DTOs while retaining carried keys, exact per-parent bounds and independent-fetch proofs", () => {
    const localTarget = { ...target, participant: root.participant };
    const hydrated = (changes: Partial<ResolvedGraphDirectPath> = {}) => prepare({ fields: ["details.name"], remote: [],
      direct: [direct({ target: localTarget, ...changes })] });
    admit(hydrated().observe(request(root), root, [{ id: "left", details: [{ name: "Selected" }] }]));
    for (const child of [{ owner_id: "other", name: "Selected" }, { owner_id: null }, { owner_id: 1 }])
      expect(reason(hydrated().observe(request(root), root, [{ id: "left", details: [child] }]))).toBe("storedCorruption");
    expect(reason(hydrated({ maximumPerSource: 1 }).observe(request(root), root,
      [{ id: "left", details: [{ name: "One" }, { name: "Two" }] }]))).toBe("unsupportedProfile");
    expect(reason(hydrated({ maximumTargets: 2 }).observe(request(root), root, [
      { id: "left", details: [{ name: "One" }, { name: "Two" }] }, { id: "other", details: [{ name: "Three" }] },
    ]))).toBe("unsupportedProfile");
    // Duplicate selected identities never collapse the actual parent arrays.
    expect(reason(hydrated({ maximumPerSource: 1 }).observe(request(root), root,
      [{ id: "left", details: [{ id: "same" }, { id: "same" }] }]))).toBe("unsupportedProfile");
    const independent = prepare({ fields: ["details.name"], remote: [], direct: [direct()] });
    admit(independent.observe(request(root), root, [{ id: "left" }]));
    const fetch = request(target, { parent: "_root", property: "details", parentRead: root, key: "owner_id", ids: ["left"],
      relationship: { serviceName: "target", primaryKey: "id", foreignKey: "owner_id", alias: "details", inverse: true, isList: true } });
    expect(reason(independent.observe(fetch, target, [{ name: "Selected" }]))).toBe("storedCorruption");
    const grand = selection("Grand", ["id"]);
    const outgoing: ResolvedGraphDirectPath = { ...direct(), path: "details.grand", source: localTarget, sourceModel: localTarget.read.model,
      target: grand, targetModel: grand.read.model, sourceKey: "id", targetKey: "id", many: false, maximumPerSource: 1 };
    const chained = prepare({ fields: ["details.grand.id"], remote: [], direct: [direct({ target: localTarget }), outgoing] });
    expect(reason(chained.observe(request(root), root, [{ id: "left", details: [{ name: "Missing outgoing key" }] }]))).toBe("storedCorruption");
  });

  it("keeps nullable source keys and endpoint identity bounds exact", () => {
    const parent = selection("Owner", ["id", "target_id"]);
    const endpoint: ResolvedGraphLinkEndpoint = { root: parent.read.model, path: "target", sourceKey: "target_id", targetModel: target.read.model,
      targetKey: "id", target, maximumSources: 2, maximumTargets: 1 };
    const prepared = prepare({ root: parent, fields: ["target.id"], remote: [], endpoints: [endpoint] });
    admit(prepared.observe(request(parent), parent, [{ id: "owner", target_id: "right" }]));
    const read = request(target, { parent: "_root", property: "target", parentRead: parent, ids: ["right"],
      relationship: { serviceName: "target", primaryKey: "id", foreignKey: "target_id", alias: "target" } });
    admit(prepared.observe(read, target, [{ id: "right" }]));
    const nullable = prepare({ fields: ["details.id"], remote: [], direct: [direct({ nullableSourceKey: true })] });
    admit(nullable.observe(request(root), root, [{ id: null }]));
    const tooMany = prepare({ root: parent, fields: ["target.id"], remote: [], endpoints: [endpoint] });
    expect(reason(tooMany.observe(request(parent), parent, [{ id: "one", target_id: "right" }, { id: "two", target_id: "other" }]))).toBe("unsupportedProfile");
  });

  it("checks the next edge's parent bound on the raw target observation", () => {
    const next = remote({ path: "targets.others", source: target, sourceModel: target.read.model, maximumSources: 1 });
    const prepared = prepare({ fields: ["targets.others.id"], remote: [remote(), next] });
    admit(prepared.observe(request(root), root, [{ id: "left" }]));
    admit(prepared.observe(linkRequest(), link, [{ left_id: "left", right_id: "one" }, { left_id: "left", right_id: "two" }]));
    expect(reason(prepared.observe(targetRequest(["one", "two"]), target, [{ id: "one" }, { id: "two" }]))).toBe("unsupportedProfile");
  });

  it("keeps observation state invocation-local and ignores unselected edge cohorts", () => {
    const first = prepare(), second = prepare();
    admit(first.observe(request(root), root, [{ id: "left" }]));
    expect(reason(second.observe(linkRequest(), link, []))).toBe("invalidAuthority");
    const scalar = prepare({ fields: ["id"] });
    admit(scalar.observe(request(root), root, [{ id: "one" }, { id: "two" }, { id: "three" }]));
    expect(reason(scalar.observe(linkRequest(), link, []))).toBe("invalidAuthority");
  });

  it("observes genuine native hidden Link descriptors while RemoteJoiner alone attaches the result", async () => {
    const configs: ModuleJoinerConfig[] = [
      { ...service(root), alias: [{ name: "roots", entity: "Root" }] },
      { ...service(target), alias: [{ name: "targets", entity: "Target" }] },
      { ...service(link), isLink: true, alias: [{ name: "pairs", entity: "Pair" }],
        relationships: [{ serviceName: "root", entity: "Root", primaryKey: "id", foreignKey: "left_id", alias: "root" },
          { serviceName: "target", entity: "Target", primaryKey: "id", foreignKey: "right_id", alias: "target" }],
        extends: [{ serviceName: "root", entity: "Root", relationship: { serviceName: "pair", primaryKey: "left_id", foreignKey: "id", alias: "target_link", isList: true },
          fieldAlias: { targets: { path: "target_link.target", isList: true } } }] },
    ];
    const prepared = prepare(), calls: string[] = [];
    const selections = new Map([["root", root], ["pair", link], ["target", target]]);
    const rows = new Map<string, readonly JsonObject[]>([["root", [{ id: "left" }]], ["pair", [{ left_id: "left", right_id: "right" }]],
      ["target", [{ id: "right", name: "Native" }]]]);
    const native = createQuery({ remoteQuery: new RemoteQuery({ servicesConfig: configs, entitiesMap: new Map(), entityRelations: new Map(), remoteFetchData: async request => {
      const selected = selections.get(request.serviceName), raw = rows.get(request.serviceName);
      if (selected === undefined || raw === undefined) throw new Error("Unexpected native fixture service");
      Result.getOrThrow(prepared.observe(request, selected, raw));
      calls.push(request.serviceName);
      return { data: structuredClone([...raw]) };
    } }) });
    expect(await native.graph({ entity: "roots", fields: ["id", "targets.id", "targets.name"] }))
      .toEqual({ data: [{ id: "left", targets: [{ id: "right", name: "Native" }] }], metadata: undefined });
    expect(calls).toEqual(["root", "pair", "target"]);
    expect(rows.get("root")).toEqual([{ id: "left" }]);
  });

  it("keeps genuine Inventory parent provenance through hydrated Levels and the readonly StockLocation edge", async () => {
    const inventoryConfig = inventoryStaticResources.joinerConfig, stockConfig = stockLocationStaticResources.joinerConfig;
    const inventoryName = inventoryConfig?.serviceName, stockName = stockConfig?.serviceName;
    if (inventoryConfig === undefined || stockConfig === undefined || inventoryName === undefined || stockName === undefined)
      throw new Error("Missing genuine Inventory/StockLocation metadata");
    const item = selection("InventoryItem"), level = selection("InventoryLevel", ["id", "inventory_item_id", "location_id"], item.participant);
    const stock = selection("StockLocation");
    const itemRead: GraphReadSelection = { ...item, read: { ...item.read, paths: [{ path: "location_levels", many: true, table: level.read.table }] } };
    const local: ResolvedGraphDirectPath = { root: "InventoryItem", path: "location_levels", sourceModel: "InventoryItem", sourceKey: "id",
      source: itemRead, targetModel: "InventoryLevel", targetKey: "inventory_item_id", target: level,
      nullableSourceKey: false, many: true, maximumSources: 2, maximumTargets: 4, maximumPerSource: 4 };
    const readonly: ResolvedGraphDirectPath = { root: "InventoryItem", path: "location_levels.stock_locations", sourceModel: "InventoryLevel",
      sourceKey: "location_id", source: level, targetModel: "StockLocation", targetKey: "id", target: stock,
      nullableSourceKey: false, many: true, maximumSources: 2, maximumTargets: 2, maximumPerSource: 1 };
    const run = async (forgedParent = false, maximumSources = 2, nativeSelectedLevels = false) => {
      const admitted = prepare({ root: itemRead, fields: ["id", "location_levels.stock_locations.id"], remote: [],
        direct: [local, { ...readonly, maximumSources }] });
      const calls: string[] = [];
      const native = createQuery({ remoteQuery: new RemoteQuery({ servicesConfig: [inventoryConfig, InventoryLevelStockLocation, stockConfig],
        entitiesMap: new Map(), entityRelations: new Map([["InventoryItem", new Map([["location_levels", "InventoryLevel"]])]]),
        remoteFetchData: async request => {
          calls.push(request.serviceName);
          const isItem = request.serviceName === inventoryName;
          if (!isItem && request.serviceName !== stockName) throw new Error("Unexpected native Inventory fixture read");
          if (isItem) expect(request.groupedParentContexts).toEqual([
            { path: "_root", serviceName: inventoryName, entity: "InventoryItem" },
            { path: "_root.location_levels", serviceName: inventoryName, entity: "InventoryItem" },
          ]);
          const levels = nativeSelectedLevels ? [{ location_id: "site", stocked_quantity: 3, reserved_quantity: 0,
            raw_stocked_quantity: { value: "3", precision: 20 }, raw_reserved_quantity: { value: "0", precision: 20 }, available_quantity: 3 }]
            : [{ id: "first", inventory_item_id: "item", location_id: "site" }, { id: "second", inventory_item_id: "item", location_id: "site" }];
          const rows = isItem ? [{ id: "item", location_levels: levels }] : [{ id: "site" }];
          let observed = request;
          if (forgedParent && !isItem) {
            const parentConfig = request.expand.parentConfig;
            if (parentConfig === undefined) throw new Error("Missing actual native Inventory parent descriptor");
            observed = { ...request, expand: { ...request.expand, parentConfig: { ...parentConfig, entity: "InventoryLevel" } } };
          }
          Result.getOrThrow(admitted.observe(observed, isItem ? itemRead : stock, rows));
          if (!isItem) expect(request.expand.parentConfig?.entity).toBe("InventoryItem");
          return { data: structuredClone(rows) };
        } }) });
      const result = await native.graph({ entity: "inventory_item", fields: ["id", "location_levels.stock_locations.id"] });
      return { result, calls };
    };
    expect(await run()).toEqual({ result: { data: [{ id: "item", location_levels: [
      { location_id: "site", stock_locations: [{ id: "site" }] }, { location_id: "site", stock_locations: [{ id: "site" }] },
    ] }], metadata: undefined }, calls: [inventoryName, stockName] });
    await expect(run(true)).rejects.toMatchObject({ reason: "invalidAuthority" });
    await expect(run(false, 1)).rejects.toMatchObject({ reason: "unsupportedProfile" });
    expect(await run(false, 2, true)).toEqual({ result: { data: [{ id: "item", location_levels: [
      { location_id: "site", stock_locations: [{ id: "site" }] },
    ] }], metadata: undefined }, calls: [inventoryName, stockName] });
  });

  it("authenticates genuine Product local Variant rebinding before the native Pricing Link fetch", async () => {
    const productConfig = productJoiner, pricingConfig = pricingStaticResources.joinerConfig;
    const productName = productConfig?.serviceName, pricingName = pricingConfig?.serviceName, linkName = ProductVariantPriceSet.serviceName;
    if (productConfig === undefined || pricingConfig === undefined || productName === undefined || pricingName === undefined || linkName === undefined)
      throw new Error("Missing genuine Product/Variant Pricing metadata");
    const product = selection("Product"), variant = selection("ProductVariant", ["id"], product.participant);
    const productRead: GraphReadSelection = { ...product, read: { ...product.read,
      paths: [{ path: "variants", many: true, table: variant.read.table }] } };
    const pair = selection("LinkProductVariantPriceSet", ["variant_id", "price_set_id"]), priceSet = selection("PriceSet");
    const edge: ResolvedGraphRemotePath = { root: "Product", path: "variants.price_set", sourceModel: "ProductVariant", sourceKey: "id",
      source: variant, linkModel: pair.read.model, link: pair, sourceColumn: "variant_id", targetColumn: "price_set_id",
      targetModel: "PriceSet", targetKey: "id", target: priceSet, many: false,
      maximumSources: 2, maximumLinks: 2, maximumTargets: 2, maximumPerSource: 1 };
    const run = async (forgedParent = false, maximumSources = 2, withSecond = false) => {
      const admitted = prepare({ root: productRead, fields: ["id", "variants.id", "variants.price_set.id"], remote: [{ ...edge, maximumSources }] });
      const calls: string[] = [];
      const native = createQuery({ remoteQuery: new RemoteQuery({ servicesConfig: [productConfig, ProductVariantPriceSet, pricingConfig],
        entitiesMap: new Map(), entityRelations: new Map([["Product", new Map([["variants", "ProductVariant"]])]]),
        remoteFetchData: async request => {
          calls.push(request.serviceName);
          const selected = request.serviceName === productName ? productRead : request.serviceName === linkName ? pair : priceSet;
          if (request.serviceName !== productName && request.serviceName !== linkName && request.serviceName !== pricingName)
            throw new Error("Unexpected native Product fixture read");
          if (selected === productRead) expect(request.groupedParentContexts).toEqual([
            { path: "_root", serviceName: productName, entity: "Product" },
            { path: "_root.variants", serviceName: productName, entity: "ProductVariant" },
          ]);
          const variants = [{ id: "variant" }, ...withSecond ? [{ id: "second" }] : []];
          const rows = selected === productRead ? [{ id: "product", variants }]
            : selected === pair ? variants.map(variant => ({ variant_id: variant.id, price_set_id: "set-" + variant.id }))
            : variants.map(variant => ({ id: "set-" + variant.id }));
          let observed = request;
          if (selected === pair) {
            const parentConfig = request.expand.parentConfig;
            if (parentConfig === undefined) throw new Error("Missing actual native Variant parent descriptor");
            expect(parentConfig.entity).toBe("ProductVariant");
            if (forgedParent) observed = { ...request, expand: { ...request.expand, parentConfig: { ...parentConfig, entity: "Product" } } };
          }
          Result.getOrThrow(admitted.observe(observed, selected, rows));
          return { data: structuredClone(rows) };
        } }) });
      return { result: await native.graph({ entity: "product", fields: ["id", "variants.id", "variants.price_set.id"] }), calls };
    };
    expect(await run()).toEqual({ result: { data: [{ id: "product", variants: [{ id: "variant", price_set: { id: "set-variant" } }] }], metadata: undefined },
      calls: [productName, linkName, pricingName] });
    await expect(run(true)).rejects.toMatchObject({ reason: "invalidAuthority" });
    await expect(run(false, 1, true)).rejects.toMatchObject({ reason: "unsupportedProfile" });
  });

  it("keeps native grouped-owner evidence detached and scoped to the actual parsed expand", async () => {
    const pricing = pricingStaticResources.joinerConfig;
    if (pricing === undefined) throw new Error("Missing genuine Pricing metadata");
    const roots: ReturnType<RemoteJoiner["getGroupedParentContexts"]>[] = [];
    const joiner = new RemoteJoiner([productJoiner, ProductVariantPriceSet, pricing], async expand => {
      const contexts = joiner.getGroupedParentContexts(expand), before = structuredClone(contexts);
      expect(contexts.length).toBeGreaterThan(0);
      for (const context of contexts) context.entity = "changed snapshot";
      expect(joiner.getGroupedParentContexts(expand)).toEqual(before);
      expect(joiner.getGroupedParentContexts({ ...expand })).toEqual([]);
      if (expand.property === "") roots.push(before);
      const rows = expand.serviceConfig.serviceName === productJoiner.serviceName ? [{ id: "product", variants: [{ id: "variant" }] }]
        : expand.serviceConfig.serviceName === ProductVariantPriceSet.serviceName ? [{ variant_id: "variant", price_set_id: "set" }] : [{ id: "set" }];
      return { data: rows };
    }, { autoCreateServiceNameAlias: false });
    await joiner.query({ alias: "product", fields: ["id"], expands: [
      { property: "variants", fields: ["id"] }, { property: "variants.price_set", fields: ["id"] },
    ] });
    await joiner.query({ alias: "product", fields: ["id"] });
    expect(roots).toEqual([
      [{ path: "_root", serviceName: productJoiner.serviceName, entity: "Product" },
        { path: "_root.variants", serviceName: productJoiner.serviceName, entity: "ProductVariant" }],
      [{ path: "_root", serviceName: productJoiner.serviceName, entity: "Product" }],
    ]);
  });
});
