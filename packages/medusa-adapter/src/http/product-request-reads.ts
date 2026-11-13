import { Cause, Effect, Result, Schema } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { ProductSalesChannel, ProductShippingProfile, ProductVariantInventoryItem, ProductVariantPriceSet } from "@medusajs/link-modules";
import { MedusaError } from "@medusajs/utils/common/errors";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { ProductModuleService } from "@medusajs/product/services";
import type { CoreDatabase } from "@flarex/persistence-postgres/internal/core";
import type { PreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { commerceNativeRegistrations, makeCommerceNativeReadHost } from "@flarex/persistence-postgres/internal/commerce-native";
import { commerceCommandIdentity, defineAtomicCommerceParticipant, type AtomicCommerceParticipant, type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { localGraphDirectPath, nativeLinkGraphDirectPaths } from "../local-graph/direct-paths";
import { nativeLinkGraphPaths } from "../local-graph/links";
import type { GraphModuleDefinition, GraphParticipant, GraphReadContext, GraphReadDefinition } from "../local-graph/model";
import { prepareLocalGraph } from "../local-graph/query";
import { admitNativeQueryPaths, decodeNativeQueryGraphResult } from "../local-graph/native-bridge";
import { prepareNativeGraphInput } from "../local-graph/native-input";
import { withNativeGraphMetadata } from "../local-graph/native-metadata";
import { decodeProductCategoryRead, decodeProductCollectionRead } from "../modules/product/service-input";
import type { ProductRuntimeMetadata } from "../modules/product/runtime-metadata";
import { commerceDecoder } from "../value/decoder";
import { QueryLimit, QueryOffset } from "../query/decoder";
import { makeReadCatalog } from "../query/catalog";
import { captureInventoryMetadata } from "../modules/inventory/schema";
import type { ProductRequestCatalog } from "./product-request";

const ProductQuery = Schema.Struct({
  entity: Schema.Literals(["product", "product_sales_channel", "product_option", "variant", "product_variant_inventory_items", "product_type", "product_tag", "product_category", "product_collection", "sales_channel", "price_lists", "prices"]),
  fields: Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).check(Schema.isLengthBetween(1, 256)),
  filters: Schema.optionalKey(Schema.Union([Schema.JsonObject, Schema.Undefined])),
  pagination: Schema.optionalKey(Schema.Union([Schema.Struct({ take: Schema.optionalKey(Schema.UndefinedOr(QueryLimit)), skip: Schema.optionalKey(Schema.UndefinedOr(QueryOffset)),
    order: Schema.optionalKey(Schema.UndefinedOr(Schema.Record(Schema.String, Schema.Literals(["ASC", "DESC"])))) }),
    Schema.Undefined])),
  withDeleted: Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Undefined])),
  context: Schema.optionalKey(Schema.Union([Schema.Record(Schema.String, Schema.Never), Schema.Undefined])),
});
const decodeQuery = commerceDecoder(ProductQuery, "unsupportedProfile");
const decodeCategoryQuery = decodeQuery;
const decodeOptions = commerceDecoder(Schema.Struct({ throwIfKeyNotFound: Schema.optionalKey(Schema.Boolean),
  cache: Schema.optionalKey(Schema.Struct({ enable: Schema.Boolean })),
}), "unsupportedProfile");

const CatalogEntity = Schema.Literals(["product_type", "product_tag", "product_category", "product_collection"]);
const ScalarField = Schema.String.check(Schema.isLengthBetween(1, 256), Schema.isPattern(/^[a-zA-Z_][a-zA-Z0-9_]*$/));
const BoundedRemoteFields = Schema.Array(Schema.Union([ScalarField, Schema.Literal("*")])).check(Schema.isMaxLength(256));
const RemoteFields = BoundedRemoteFields.check(Schema.isUnique());
const RemoteArguments = Schema.Struct({ filters: Schema.optionalKey(Schema.JsonObject),
    skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit),
    order: Schema.optionalKey(Schema.Record(ScalarField, Schema.Literals(["ASC", "DESC"]))),
});
const decodeCatalogRemoteQuery = commerceDecoder(Schema.Union([
  Schema.Struct({ __value: Schema.Struct({ product_type: Schema.Struct({ fields: RemoteFields,
    isServiceAccess: Schema.Literal(false), __args: RemoteArguments }) }) }),
  // This is the actual remoteQueryObjectFromString producer's bounded local
  // Collection->Products shape. Nested arguments/filters are not admitted.
  Schema.Struct({ __value: Schema.Struct({ product_collection: Schema.Struct({ fields: RemoteFields,
    isServiceAccess: Schema.Literal(false), __args: RemoteArguments,
    products: Schema.optionalKey(Schema.Struct({ fields: RemoteFields.check(Schema.isMinLength(1)) })),
  }) }) }),
]), "unsupportedProfile");
// Only the native Variant refetch producer is admitted here. Child nodes have
// no arguments or service capability; their field/path authority remains the
// existing prepared graph's checked metadata, rather than a second allowlist.
const decodeRemoteRelation = commerceDecoder(ScalarField, "unsupportedProfile");
// The native producer appends duplicate selections after alias remapping.
// Preserve them for the graph planner; they still consume the same field budget.
const RemoteNodeMember = Schema.Union([Schema.JsonObject, BoundedRemoteFields, Schema.Boolean]);
const decodeVariantRemoteNode = commerceDecoder(Schema.StructWithRest(
  Schema.Struct({ fields: Schema.optionalKey(BoundedRemoteFields), __args: Schema.optionalKey(Schema.Never),
    isServiceAccess: Schema.optionalKey(Schema.Never) }),
  [Schema.Record(Schema.String, RemoteNodeMember)],
), "unsupportedProfile");
const decodeVariantRemoteQuery = commerceDecoder(Schema.Struct({ __value: Schema.Struct({
  product_variant: Schema.StructWithRest(Schema.Struct({ fields: BoundedRemoteFields,
    isServiceAccess: Schema.Literal(false),
    __args: Schema.Struct({ filters: Schema.Struct({ id: Schema.String.check(Schema.isLengthBetween(1, 256)) }) }),
  }), [Schema.Record(Schema.String, RemoteNodeMember)]),
}) }), "unsupportedProfile");
const RemoteRoot = Schema.StructWithRest(Schema.Struct({ fields: BoundedRemoteFields,
  isServiceAccess: Schema.Literal(false), __args: Schema.Struct({ filters: Schema.JsonObject }) }),
  [Schema.Record(Schema.String, RemoteNodeMember)]);
const decodeAssociationRemoteQuery = commerceDecoder(Schema.Struct({ __value: Schema.Union([
  Schema.Struct({ product: RemoteRoot }), Schema.Struct({ variant: RemoteRoot }), Schema.Struct({ variants: RemoteRoot }),
  Schema.Struct({ sales_channel: RemoteRoot }), Schema.Struct({ price_lists: RemoteRoot }), Schema.Struct({ prices: RemoteRoot }),
]) }), "unsupportedProfile");
const decodeCategoryOrder = commerceDecoder(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])),
  rank: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) }), "unsupportedProfile");
const decodeCollectionOrder = commerceDecoder(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) }), "unsupportedProfile");

const nativeProductMetadata = {
  servicesConfig: [ProductModuleService.prototype.__joinerConfig()],
  entitiesMap: new Map<string, unknown>(), entityRelations: new Map<string, ReadonlyMap<string, string>>(),
};
const admitRemoteRoot = (allowed: readonly string[]) => (name: string, service: boolean) =>
  !service && allowed.includes(name) ? Result.succeed(undefined) : Result.fail(commerceError("unsupportedProfile"));

/** Validate the bounded producer grammar without interpreting its selections. */
const admitRemoteChildren = (root: typeof RemoteRoot.Type) => Result.gen(function* () {
  let fieldCount = root.fields.length;
  const pending = Object.entries(root).filter(([key]) => key !== "fields" && key !== "__args" && key !== "isServiceAccess")
    .map(([name, node]) => ({ name, node, depth: 1 }));
  for (let index = 0; index < pending.length; index++) {
    const current = pending[index];
    if (current === undefined || current.depth > 8 || pending.length > 256) return yield* Result.fail(commerceError("unsupportedProfile"));
    yield* decodeRemoteRelation(current.name);
    const node = yield* decodeVariantRemoteNode(current.node);
    const children = Object.entries(node).filter(([key]) => key !== "fields");
    if ((node.fields?.length ?? 0) === 0 && children.length === 0) return yield* Result.fail(commerceError("unsupportedProfile"));
    fieldCount += node.fields?.length ?? 0;
    if (fieldCount > 256) return yield* Result.fail(commerceError("unsupportedProfile"));
    pending.push(...children.map(([name, child]) => ({ name, node: child, depth: current.depth + 1 })));
  }
});

const catalogRemoteSelection = (captured: unknown) => Result.gen(function* () {
  const remote = (yield* decodeCatalogRemoteQuery(captured)).__value;
  const node = "product_type" in remote ? remote.product_type : remote.product_collection;
  const native = yield* prepareNativeGraphInput(captured, nativeProductMetadata, admitRemoteRoot(["product_type", "product_collection"]));
  return { entity: native.entity, args: node.__args, fields: native.fields };
});
const variantRemoteSelection = (captured: unknown,
  admitProjection: (fields: readonly string[]) => Result.Result<void, CommerceTransactionError>) => Result.gen(function* () {
  const root = (yield* decodeVariantRemoteQuery(captured)).__value.product_variant;
  yield* admitRemoteChildren(root);
  const native = yield* prepareNativeGraphInput(captured, nativeProductMetadata, admitRemoteRoot(["product_variant"]));
  yield* admitProjection(native.fields);
  return { entity: native.entity, args: root.__args, fields: native.fields };
});
const associationRemoteSelection = (captured: unknown,
  admitProjection: (entity: string, fields: readonly string[]) => Result.Result<void, CommerceTransactionError>) => Result.gen(function* () {
  const value = (yield* decodeAssociationRemoteQuery(captured)).__value;
  const root = "product" in value ? value.product : "variant" in value ? value.variant : "variants" in value ? value.variants
    : "sales_channel" in value ? value.sales_channel : "price_lists" in value ? value.price_lists : value.prices;
  yield* admitRemoteChildren(root);
  const native = yield* prepareNativeGraphInput(captured, nativeProductMetadata,
    admitRemoteRoot(["product", "variant", "variants", "sales_channel", "price_lists", "prices"]));
  yield* admitProjection(native.entity, native.fields);
  return { entity: native.entity, args: root.__args, fields: native.fields };
});

export const decodeProductCatalogRemoteQuery = (input: unknown) => admitNativeQueryPaths(input).pipe(Result.flatMap(catalogRemoteSelection));
export const decodeProductVariantRemoteQuery = (input: unknown,
  admitProjection: (fields: readonly string[]) => Result.Result<void, CommerceTransactionError>) =>
  admitNativeQueryPaths(input).pipe(Result.flatMap(captured => variantRemoteSelection(captured, admitProjection)));
export const decodeProductAssociationRemoteQuery = (input: unknown,
  admitProjection: (entity: string, fields: readonly string[]) => Result.Result<void, CommerceTransactionError>) =>
  admitNativeQueryPaths(input).pipe(Result.flatMap(captured => associationRemoteSelection(captured, admitProjection)));

/** Category retains its named tree capability. All normalization, expansion and
 * presentation execute in the same genuine native Query as other reads. */
export function prepareCategoryRequestRead(read: GraphReadDefinition, participant: AtomicCommerceParticipant, metadata: ProductRuntimeMetadata) {
  const prepared = withNativeGraphMetadata({ aliases: [{ name: "product_category", model: read.model }], reads: [read] },
    nativeProductMetadata.servicesConfig, metadata.tables).pipe(Result.flatMap(module => prepareLocalGraph([{ participant, module }])));
  const admitProjection = (fields: readonly string[]) => prepared.pipe(Result.flatMap(graph => graph.admitProjection("product_category", fields)));
  const execute = Effect.fn("ProductRequest.categoryRead")(function* (context: GraphReadContext,
    input: unknown, options?: unknown) {
    const query = yield* Effect.fromResult(decodeCategoryQuery(input));
    if (query.entity !== "product_category" || query.withDeleted === true) return yield* commerceError("unsupportedProfile");
    yield* Effect.fromResult(decodeProductCategoryRead({ filters: query.filters ?? {} }));
    if (query.pagination?.order !== undefined) yield* Effect.fromResult(decodeCategoryOrder(query.pagination.order));
    yield* Effect.fromResult(admitProjection(query.fields));
    const graph = yield* Effect.fromResult(prepared);
    return yield* Effect.fromResult(decodeNativeQueryGraphResult(yield* graph.bind(context).nativeGraph(query, options)));
  });
  return { admitProjection, execute };
}
/** Preserve the complete read Cause while projecting admitted query refusals to HTTP. */
export function presentProductReadFailure<A, R>(work: Effect.Effect<A, CommerceTransactionError, R>) {
  return work.pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error =>
    error.reason === "unsupportedProfile" || error.reason === "invalidInput" || error.reason === "limitExceeded"
      ? commerceError("adapterFailure", new MedusaError(MedusaError.Types.INVALID_DATA,
        "Product query is outside the private supported profile", undefined, undefined, { cause: error }))
      : error))));
}

/** Reuse the same native Link metadata and local graph planner as workflow
 * Query. Every row is returned by its original module's registered command. */
export const prepareProductRequestReadGraph = Effect.fn("ProductRequest.prepareReadGraph")(function* (
  catalog: ProductRequestCatalog, variantProfile = false, storePricing?: GraphModuleDefinition,
) {
  const { product, pricing, inventory, stock, sales, fulfillment, productLinks, variantLinks } = catalog.runtimes;
  const root = product.metadata.product.model, variant = product.metadata.variant.model;
  const bounds = { maximumSources: 128, maximumLinks: 128, maximumTargets: 128, maximumPerSource: 128 };
  const directBounds = { maximumSources: 128, maximumTargets: 128, maximumPerSource: 128 };
  const remotePaths = yield* Effect.fromResult(nativeLinkGraphPaths(ProductSalesChannel, [{ root, path: "sales_channels", ...bounds }]));
  const shipping = yield* Effect.fromResult(nativeLinkGraphPaths(ProductShippingProfile, [{ root, path: "shipping_profile", ...bounds, maximumPerSource: 1 }]));
  const prices = yield* Effect.fromResult(nativeLinkGraphPaths(ProductVariantPriceSet,
    (storePricing === undefined ? ["variants.price_set"] : ["variants.price_set", "variants.prices", "variants.calculated_price"])
      .map(path => ({ root, path, ...bounds, maximumPerSource: 1 })), variant));
  const rich = yield* Effect.fromResult(nativeLinkGraphDirectPaths(ProductVariantInventoryItem,
    [{ root, path: "variants.inventory_items", maximumSources: 128, maximumTargets: 128, maximumPerSource: 128 }], variant));
  const richModel = rich[0]?.targetModel;
  if (richModel === undefined) return yield* commerceError("unsupportedProfile");
  const items = yield* Effect.fromResult(nativeLinkGraphDirectPaths(ProductVariantInventoryItem,
    [{ root, path: "variants.inventory_items.inventory", maximumSources: 128, maximumTargets: 128, maximumPerSource: 1 }], richModel));
  const variantPrices = variantProfile ? yield* Effect.fromResult(nativeLinkGraphPaths(ProductVariantPriceSet,
    [{ root: variant, path: "price_set", ...bounds, maximumPerSource: 1 }])) : [];
  const variantRich = variantProfile ? yield* Effect.fromResult(nativeLinkGraphDirectPaths(ProductVariantInventoryItem,
    [{ root: variant, path: "inventory_items", ...directBounds }], variant)) : [];
  const variantItems = variantProfile ? yield* Effect.fromResult(nativeLinkGraphDirectPaths(ProductVariantInventoryItem,
    [{ root: variant, path: "inventory_items.inventory", ...directBounds, maximumPerSource: 1 },
      { root: richModel, path: "inventory", ...directBounds, maximumPerSource: 1 },
      { root: richModel, path: "variant", ...directBounds, maximumPerSource: 1 }], richModel)) : [];
  const inventoryGraph = variantProfile ? catalog.runtimes.inventoryReads.graph : inventory.graph;
  const inventoryPaths = [];
  if (variantProfile) {
    const metadata = yield* captureInventoryMetadata();
    const item = metadata.frame.tables.find(table => table.name === "inventory_item");
    const level = metadata.frame.tables.find(table => table.name === "inventory_level");
    const itemRead = inventoryGraph.reads.find(read => read.table.name === item?.name);
    const levelRead = inventoryGraph.reads.find(read => read.table.name === level?.name);
    if (item === undefined || level === undefined || itemRead === undefined || levelRead === undefined)
      return yield* commerceError("unsupportedProfile");
    const relation = describeToManyRelation(item, "location_levels", metadata.frame.tables);
    if (relation === undefined) return yield* commerceError("unsupportedProfile");
    const readCatalog = yield* Effect.fromResult(makeReadCatalog(inventoryGraph.reads.map(read => read.table),
      new Map([[item.name, new Map([[relation.name, relation]])]])));
    for (const selection of [{ root: variant, path: "inventory_items.inventory.location_levels" },
      { root: richModel, path: "inventory.location_levels" }]) inventoryPaths.push(yield* Effect.fromResult(
      localGraphDirectPath(readCatalog, item.name, itemRead.model, levelRead.model, relation.name, { ...selection, ...directBounds })));
  }
  // Native Store enrichment consumes the authentic remote-join identity even
  // when the caller selected only the calculated-price alias.
  const productGraph: GraphModuleDefinition = storePricing === undefined ? product.graph : {
    ...product.storeGraph, reads: product.storeGraph.reads.map(read => read.model === root ? { ...read, nativeFields: true } : read),
  };
  const definitions: Readonly<Record<string, GraphModuleDefinition>> = {
    product: productGraph, pricing: storePricing ?? { ...pricing.graph, aliases: [...pricing.graph.aliases, ...catalog.runtimes.pricingReads.graph.aliases],
      reads: [...pricing.graph.reads, ...catalog.runtimes.pricingReads.graph.reads] }, inventory: { ...inventoryGraph, directPaths: inventoryPaths },
    stock_location: stock.graph, sales_channel: sales.graph, fulfillment: fulfillment.graph,
    product_links: { ...productLinks.graph, remotePaths: [...remotePaths, ...shipping] },
    variant_links: { ...variantLinks.graph, remotePaths: [...prices, ...variantPrices], directPaths: [...rich, ...items, ...variantRich, ...variantItems] },
  };
  const participants: GraphParticipant[] = [];
  const members = catalog.sources.map(source => {
    const module = definitions[source.name];
    if (module === undefined) return undefined;
    const participant = defineAtomicCommerceParticipant(`productRead_${source.name}`);
    participants.push({ participant, module });
    return { source, participant, module, commands: [...new Set(module.reads.map(read => read.command))] };
  });
  if (members.some(member => member === undefined)) return yield* commerceError("invalidAuthority");
  const graph = yield* Effect.fromResult(prepareLocalGraph(participants));
  return { graph, members: members.filter(member => member !== undefined) };
});

/** Native RemoteJoiner performs independent service read groups. Preserve that
 * lifecycle with protected native read hosts; this graph promises no snapshot
 * shared across Product, Link, Pricing and Inventory service calls. */
export const makeProductRequestReads = Effect.fn("ProductRequest.makeReads")(function* (input: Readonly<{
  database: CoreDatabase; hostRuntime: PreparedHostRuntime; catalog: ProductRequestCatalog; identityAndAccessPolicy: Json;
}>) {
  const prepared = yield* prepareProductRequestReadGraph(input.catalog);
  const variants = yield* prepareProductRequestReadGraph(input.catalog, true);
  const productMember = prepared.members.find(member => member.source.name === "product");
  const categoryRead = input.catalog.runtimes.product.graph.reads.find(read => read.model === input.catalog.runtimes.product.metadata.category.model);
  if (productMember === undefined || categoryRead === undefined) return yield* commerceError("invalidAuthority");
  const categories = prepareCategoryRequestRead(categoryRead, productMember.participant, input.catalog.runtimes.product.metadata);
  const hosts = new Map<AtomicCommerceParticipant, { readonly commands: ReadonlySet<CommerceCommand>;
    readonly read: (command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError> }>();
  const closures: Effect.Effect<void>[] = [];
  for (const member of prepared.members) {
    const variantMember = variants.members.find(candidate => candidate.source === member.source);
    if (variantMember === undefined) return yield* commerceError("invalidAuthority");
    const commands = [...new Set([...member.commands, ...variantMember.commands])];
    if (commands.length === 0 || commands.some(command => commerceCommandIdentity(command)?.mode !== "read"))
      return yield* commerceError("invalidAuthority");
    const binding = yield* input.database.bindNative({ definition: member.source.definition,
      commands: yield* Effect.fromResult(commerceNativeRegistrations(commands, { readOnly: true })) });
    const host = yield* Effect.acquireRelease(makeCommerceNativeReadHost({ database: input.database, binding, hostRuntime: input.hostRuntime,
      commands, initialization: member.source.initialization, identityAndAccessPolicy: input.identityAndAccessPolicy }), host => host.close);
    hosts.set(member.participant, { commands: new Set(member.commands), read: host.read });
    hosts.set(variantMember.participant, { commands: new Set(variantMember.commands), read: host.read });
    closures.push(host.close);
  }
  const contextFor = (): GraphReadContext => {
    let failure: Cause.Cause<CommerceTransactionError> | undefined;
    return {
      refuse: error => Effect.fail(error),
      recordFailure: cause => { failure ??= cause; return Result.succeed(failure); },
      call: Effect.fn("ProductRequest.readGroup")(function* (participant, command, args) {
        if (failure !== undefined) return yield* Effect.failCause(failure);
        const host = hosts.get(participant);
        if (host === undefined || !host.commands.has(command) || commerceCommandIdentity(command)?.mode !== "read")
          return yield* commerceError("invalidAuthority");
        return yield* host.read(command, args);
      }),
    };
  };
  const graph = Effect.fn("ProductRequest.graph")(function* (value: unknown, options?: unknown) {
    const query = yield* Effect.fromResult(admitNativeQueryPaths(value).pipe(Result.flatMap(decodeQuery)));
    const checkedOptions = options === undefined ? undefined
      : yield* Effect.fromResult(admitNativeQueryPaths(options).pipe(Result.flatMap(decodeOptions)));
    if (query.entity === "product" && (query.pagination?.order?.created_at !== undefined || query.pagination?.order?.updated_at !== undefined))
      return yield* commerceError("unsupportedProfile");
    if (query.entity === "product_collection") {
      if (Array.isArray(query.filters?.title) || Array.isArray(query.filters?.handle)) return yield* commerceError("unsupportedProfile");
      yield* Effect.fromResult(decodeProductCollectionRead({ filters: query.filters ?? {} }));
      if (query.pagination?.order !== undefined) yield* Effect.fromResult(decodeCollectionOrder(query.pagination.order));
    }
    const context = contextFor();
    if (query.entity === "product_category") return yield* categories.execute(context, query, checkedOptions);
    const selected = query.entity === "variant" || query.entity === "product_variant_inventory_items" ? variants : prepared;
    return yield* Effect.fromResult(decodeNativeQueryGraphResult(yield* selected.graph.bind(context).nativeGraph(query, checkedOptions)));
  }, presentProductReadFailure);
  const remoteQuery = Effect.fn("ProductRequest.remoteQuery")(function* (value: unknown) {
    const captured = yield* Effect.fromResult(admitNativeQueryPaths(value));
    const remoteRoot = isNonArrayRecord(captured) && isNonArrayRecord(captured.__value) ? captured.__value : undefined;
    let selected = prepared;
    if (remoteRoot !== undefined && Object.hasOwn(remoteRoot, "product_variant")) {
      yield* Effect.fromResult(variantRemoteSelection(captured, fields => variants.graph.admitProjection("variant", fields)));
      selected = variants;
    } else if (remoteRoot !== undefined && ["product", "variant", "variants", "sales_channel", "price_lists", "prices"].some(key => Object.hasOwn(remoteRoot, key))) {
      const variantSelection = Object.hasOwn(remoteRoot, "variant") || Object.hasOwn(remoteRoot, "variants");
      selected = variantSelection ? variants : prepared;
      yield* Effect.fromResult(associationRemoteSelection(captured, (entity, fields) => selected.graph.admitProjection(entity, fields)));
    } else {
      const query = yield* Effect.fromResult(catalogRemoteSelection(captured));
      yield* Effect.fromResult(prepared.graph.admitProjection(query.entity, query.fields));
    }
    return yield* selected.graph.bind(contextFor()).remoteQuery(captured);
  }, presentProductReadFailure);  return Object.freeze({ graph, remoteQuery,
    admitCatalogRefetchFields: (entity: typeof CatalogEntity.Type, fields: readonly string[]) => entity === "product_category"
      ? categories.admitProjection(fields) : prepared.graph.admitProjection(entity, fields),
    admitProductRefetchFields: (fields: readonly string[]) => prepared.graph.admitProjection("product", fields),
    admitVariantRefetchFields: (fields: readonly string[]) => variants.graph.admitProjection("variant", fields),
    admitSalesChannelRefetchFields: (fields: readonly string[]) => prepared.graph.admitProjection("sales_channel", fields),
    admitPriceListRefetchFields: (fields: readonly string[]) => prepared.graph.admitProjection("price_lists", fields),
    close: Effect.forEach(closures, close => close, { discard: true }) });
});
