import { Cause, Effect, Result, Schema } from "effect";
import { ProductSalesChannel, ProductShippingProfile, ProductVariantInventoryItem, ProductVariantPriceSet } from "@medusajs/link-modules";
import { MedusaError } from "@medusajs/utils/common/errors";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import type { CoreDatabase } from "@flarex/persistence-postgres/internal/core";
import type { PreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { commerceNativeRegistrations, makeCommerceNativeReadHost } from "@flarex/persistence-postgres/internal/commerce-native";
import { commerceCommandIdentity, defineAtomicCommerceParticipant, type AtomicCommerceParticipant, type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, isJsonObject, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { localGraphDirectPath, nativeLinkGraphDirectPaths } from "../local-graph/direct-paths";
import { nativeLinkGraphPaths } from "../local-graph/links";
import type { GraphModuleDefinition, GraphParticipant, GraphReadContext, GraphReadDefinition } from "../local-graph/model";
import { decodeGraphCount, decodeGraphList, prepareLocalGraph } from "../local-graph/query";
import { planGraphFields } from "../local-graph/fields";
import { projectRows } from "../query/projection";
import { prepareGraphKeys, prepareGraphKeyValidation, validateGraphKeys, validateGraphPrimaryKey } from "../local-graph/key-validation";
import { decodeCategoryProjection } from "../modules/product/category-projection";
import { decodeProductCategoryRead, decodeProductCollectionRead } from "../modules/product/service-input";
import type { ProductRuntimeMetadata } from "../modules/product/runtime-metadata";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { QueryLimit, QueryOffset } from "../query/decoder";
import { makeReadCatalog } from "../query/catalog";
import { captureInventoryMetadata } from "../modules/inventory/schema";
import type { ProductRequestCatalog } from "./product-request";

const decodeQuery = commerceDecoder(Schema.Struct({
  entity: Schema.Literals(["product", "product_sales_channel", "product_option", "variant", "product_variant_inventory_items", "product_type", "product_tag", "product_category", "product_collection", "sales_channel", "price_lists", "prices"]),
  fields: Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).check(Schema.isLengthBetween(1, 256)),
  filters: Schema.optionalKey(Schema.JsonObject),
  pagination: Schema.optionalKey(Schema.Struct({ take: Schema.optionalKey(QueryLimit), skip: Schema.optionalKey(QueryOffset),
    order: Schema.optionalKey(Schema.Record(Schema.String, Schema.Literals(["ASC", "DESC"]))) })),
  withDeleted: Schema.optionalKey(Schema.Boolean),
}), "unsupportedProfile");
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
const decodeCategoryToOne = commerceDecoder(Schema.NullOr(Schema.JsonObject), "storedCorruption");

const catalogRemoteSelection = (captured: Json) => Result.gen(function* () {
  const remote = (yield* decodeCatalogRemoteQuery(captured)).__value;
  const entity = "product_type" in remote ? "product_type" : "product_collection";
  const node = "product_type" in remote ? remote.product_type : remote.product_collection;
  const products = "product_collection" in remote ? remote.product_collection.products : undefined;
  return { entity, args: node.__args, fields: [...node.fields, ...products?.fields.map(field => "products." + field) ?? []] };
});

const flattenRemoteSelection = (root: typeof RemoteRoot.Type) => Result.gen(function* () {
  const fields = [...root.fields];
  const pending = Object.entries(root).filter(([key]) => key !== "fields" && key !== "__args" && key !== "isServiceAccess")
    .map(([path, node]) => ({ name: path, path, node, depth: 1 }));
  for (let index = 0; index < pending.length; index++) {
    const current = pending[index];
    if (current === undefined || current.depth > 8) return yield* Result.fail(commerceError("unsupportedProfile"));
    yield* decodeRemoteRelation(current.name);
    const node = yield* decodeVariantRemoteNode(current.node);
    const children = Object.entries(node).filter(([key]) => key !== "fields");
    if ((node.fields?.length ?? 0) === 0 && children.length === 0) return yield* Result.fail(commerceError("unsupportedProfile"));
    fields.push(...node.fields?.map(field => current.path + "." + field) ?? []);
    if (fields.length > 256) return yield* Result.fail(commerceError("unsupportedProfile"));
    pending.push(...children.map(([name, child]) => ({ name, path: current.path + "." + name, node: child, depth: current.depth + 1 })));
  }
  return { args: root.__args, fields };
});
const variantRemoteSelection = (captured: Json,
  admitProjection: (fields: readonly string[]) => Result.Result<void, CommerceTransactionError>) => Result.gen(function* () {
  const root = (yield* decodeVariantRemoteQuery(captured)).__value.product_variant;
  const selected = yield* flattenRemoteSelection(root);
  const query = yield* decodeQuery({ entity: "variant", fields: selected.fields });
  yield* admitProjection(query.fields);
  return { entity: "variant" as const, args: selected.args, fields: query.fields };
});

const associationRemoteSelection = (captured: Json,
  admitProjection: (entity: string, fields: readonly string[]) => Result.Result<void, CommerceTransactionError>) => Result.gen(function* () {
  const value = (yield* decodeAssociationRemoteQuery(captured)).__value;
  const [entity, root] = "product" in value ? ["product", value.product] as const
    : "variant" in value ? ["variant", value.variant] as const : "variants" in value ? ["variant", value.variants] as const
    : "sales_channel" in value ? ["sales_channel", value.sales_channel] as const
    : "price_lists" in value ? ["price_lists", value.price_lists] as const : ["prices", value.prices] as const;
  const selected = yield* flattenRemoteSelection(root);
  const query = yield* decodeQuery({ entity, fields: selected.fields });
  yield* admitProjection(entity, query.fields);
  return { entity, args: selected.args, fields: query.fields };
});

export const decodeProductCatalogRemoteQuery = (input: unknown) => captureCommerceInput(input).pipe(Result.flatMap(catalogRemoteSelection));
export const decodeProductVariantRemoteQuery = (input: unknown,
  admitProjection: (fields: readonly string[]) => Result.Result<void, CommerceTransactionError>) =>
  captureCommerceInput(input).pipe(Result.flatMap(captured => variantRemoteSelection(captured, admitProjection)));
export const decodeProductAssociationRemoteQuery = (input: unknown,
  admitProjection: (entity: string, fields: readonly string[]) => Result.Result<void, CommerceTransactionError>) =>
  captureCommerceInput(input).pipe(Result.flatMap(captured => associationRemoteSelection(captured, admitProjection)));

/** Category's native service owns tree hydration and its projected recursive
 * DTO. RemoteJoiner preserves a nested wildcard verbatim, while selected root
 * scalars still mask implicit hydration (e.g. parent_category_id alone). */
export function prepareCategoryRequestRead(read: GraphReadDefinition, participant: AtomicCommerceParticipant, metadata: ProductRuntimeMetadata) {
  const productJsonFields = metadata.product.table.columns.filter(column => column.type === "json").map(column => column.name);
  // The existing graph read's checked table/path metadata owns every field,
  // including Product scalars and the two service-hydrated Category relations.
  const admitProjection = (fields: readonly string[]) => decodeQuery({ entity: "product_category", fields }).pipe(
    Result.flatMap(selected => planGraphFields(read, selected.fields)), Result.map(() => undefined));
  const execute = Effect.fn("ProductRequest.categoryRead")(function* (context: GraphReadContext,
    query: Result.Result.Success<ReturnType<typeof decodeQuery>>, options?: unknown) {
    const fields = query.fields;
    const plan = yield* Effect.fromResult(planGraphFields(read, fields));
    const filters = (yield* Effect.fromResult(decodeProductCategoryRead({ filters: query.filters ?? {} }))).filters ?? {};
    const order = query.pagination?.order === undefined ? undefined : yield* Effect.fromResult(decodeCategoryOrder(query.pagination.order));
    if (query.withDeleted === true) return yield* commerceError("unsupportedProfile");
    const keyPlan = yield* Effect.fromResult(prepareGraphKeyValidation(read, filters, options));
    if (keyPlan !== undefined) yield* validateGraphPrimaryKey(keyPlan);
    const keys = keyPlan === undefined ? undefined : yield* Effect.fromResult(prepareGraphKeys(keyPlan));
    const skip = query.pagination?.skip ?? 0, take = query.pagination?.take ?? commerceLimits.catalogRows;
    if (keyPlan !== undefined && skip !== 0) return yield* commerceError("unsupportedProfile");
    const select = fields.includes("*") ? undefined : [...new Set([...fields, ...(keyPlan === undefined ? [] : [keyPlan.pkField])])];
    const hydratesTrees = filters.include_ancestors_tree === true || filters.include_descendants_tree === true ||
      plan.relations.some(path => path === "parent_category" || path === "category_children") || select?.includes("parent_category_id") === true;
    const nativeTreeScalars = new Set(["id", "mpath", "parent_category_id", ...fields.filter(field => !field.includes("."))]);
    const value = yield* context.call(participant, read.command, { filters, config: {
      ...(select === undefined ? {} : { select }), relations: plan.relations, skip, take,
      ...(order === undefined ? {} : { order }),
    } });
    // The command validates/restores the native undefined representation. JSON
    // HTTP responses omit those own undefined properties exactly as JSON.stringify.
    const decoded = yield* Effect.fromResult(decodeCategoryProjection(value));
    const captured = yield* Effect.fromResult(captureCommerceInput(decoded, undefined, () => {}));
    const [rows, count] = yield* Effect.fromResult(decodeGraphCount(captured));
    if (rows.length !== Math.min(take, Math.max(0, count - skip))) return yield* commerceError("storedCorruption");
    if (keyPlan !== undefined) {
      if (rows.length !== count) return yield* commerceError("unsupportedProfile");
      yield* validateGraphKeys({ uniqueIds: keys, resData: rows, expand: { serviceConfig: keyPlan.serviceConfig },
        pkField: keyPlan.pkField, options: keyPlan.options });
    }
    const masked = fields.includes("*") ? rows : yield* Effect.fromResult(planGraphFields(read, fields.filter(field => !field.includes("."))).pipe(
      Result.flatMap(mask => mask.project(rows))));
    const projected = masked.map(row => ({ ...row }));
    for (let index = 0; index < rows.length; index++) {
      const source = rows[index], target = projected[index];
      if (source === undefined || target === undefined) return yield* commerceError("storedCorruption");
      for (const child of plan.node.children) {
        const value = source[child.name];
        if (value === undefined && child.optional === true) continue;
        const related = child.many ? yield* Effect.fromResult(decodeGraphList(value))
          : yield* Effect.fromResult(decodeCategoryToOne(value));
        if (fields.includes(child.name + ".*") || related === null) { target[child.name] = related; continue; }
        // Native Category projection can omit a requested child scalar: tree
        // projection draws its scalars from the root select, and Product
        // unwrapping drops object-valued fields during tree hydration. The
        // native joiner's mask skips those absent fields rather than failing.
        const optionalFields = child.name === "products" ? hydratesTrees ? productJsonFields : []
          : fields.includes("*") ? [] : [...child.node.fields].filter(field => !nativeTreeScalars.has(field));
        const selections = yield* Effect.fromResult(projectRows(Array.isArray(related) ? related : [related],
          { ...child.node, optionalFields }));
        if (child.many) target[child.name] = selections.map(row => Object.keys(row).length === 0 ? null : row);
        else {
          const selected = selections[0];
          if (selected === undefined) return yield* commerceError("storedCorruption");
          if (Object.keys(selected).length === 0) delete target[child.name];
          else target[child.name] = selected;
        }
      }
    }
    return { data: projected, metadata: { count, skip, take } };
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
    product: productGraph, pricing: storePricing ?? { aliases: [...pricing.graph.aliases, ...catalog.runtimes.pricingReads.graph.aliases],
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
    return { source, participant, commands: [...new Set(module.reads.map(read => read.command))] };
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
  const graph = Effect.fn("ProductRequest.graph")(function* (value: unknown, options?: unknown) {
    const query = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(decodeQuery)));
    const checkedOptions = options === undefined ? undefined
      : yield* Effect.fromResult(captureCommerceInput(options).pipe(Result.flatMap(decodeOptions)));
    // Generic Core timestamp-order support does not activate this independent
    // Admin HTTP capability; retain the private Product profile's refusal.
    if (query.entity === "product" && (query.pagination?.order?.created_at !== undefined || query.pagination?.order?.updated_at !== undefined))
      return yield* commerceError("unsupportedProfile");
    if (query.entity === "product_collection") {
      // Admin's existing bounded profile retains scalar title/handle filters
      // and id-only ordering; Store's expanded owner admission is independent.
      if (Array.isArray(query.filters?.title) || Array.isArray(query.filters?.handle)) return yield* commerceError("unsupportedProfile");
      yield* Effect.fromResult(decodeProductCollectionRead({ filters: query.filters ?? {} }));
      if (query.pagination?.order !== undefined) yield* Effect.fromResult(decodeCollectionOrder(query.pagination.order));
    }
    // This owner has no untrusted callback or finalizer. A failed native read
    // stops the sequential graph, preserving the complete original Cause.
    let failure: Cause.Cause<CommerceTransactionError> | undefined;
    const context: GraphReadContext = {
      refuse: error => Effect.fail(error),
      recordFailure: cause => { failure ??= cause; return Result.succeed(failure); },
      call: Effect.fn("ProductRequest.readGroup")(function* (participant, command, args) {
        if (failure !== undefined) return yield* Effect.failCause(failure);
        const host = hosts.get(participant);
        if (host === undefined || !host.commands.has(command) || commerceCommandIdentity(command)?.mode !== "read")
          return yield* commerceError("invalidAuthority");
        if (!isJsonObject(args) || args.config === undefined || !isJsonObject(args.config)) return yield* commerceError("unsupportedProfile");
        return yield* host.read(command, { ...args, config: { ...args.config,
          ...(query.withDeleted === undefined ? {} : { withDeleted: query.withDeleted }) } });
      }),
    };
    const keyOptions = checkedOptions?.throwIfKeyNotFound === true ? { throwIfKeyNotFound: true } : undefined;
    if (query.entity === "product_category") return yield* categories.execute(context, query, keyOptions);
    const selected = query.entity === "variant" || query.entity === "product_variant_inventory_items" ? variants : prepared;
    // Native cache options are advisory. These protected reads always use Core.
    return yield* selected.graph.bind(context).graph({ entity: query.entity, fields: query.fields,
      filters: query.filters ?? {}, pagination: { take: query.pagination?.take ?? commerceLimits.catalogRows,
        skip: query.pagination?.skip ?? 0, ...(query.pagination?.order === undefined ? {} : { order: query.pagination.order }) } },
      keyOptions);
  }, presentProductReadFailure);
  const remoteQuery = Effect.fn("ProductRequest.remoteCatalogQuery")(function* (value: unknown) {
    const captured = yield* Effect.fromResult(captureCommerceInput(value));
    const remoteRoot = isJsonObject(captured) && isJsonObject(captured.__value ?? null) ? captured.__value : undefined;
    if (isJsonObject(captured) && captured.__value !== undefined && isJsonObject(captured.__value) && Object.hasOwn(captured.__value, "product_variant")) {
      const query = yield* Effect.fromResult(variantRemoteSelection(captured,
        fields => variants.graph.admitProjection("variant", fields)));
      const selected = yield* graph({ entity: query.entity, fields: query.fields, filters: query.args.filters });
      if (selected.data.length !== selected.metadata.count) return yield* commerceError("unsupportedProfile");
      return selected.data;
    }
    if (remoteRoot !== undefined && isJsonObject(remoteRoot) &&
      ["product", "variant", "variants", "sales_channel", "price_lists", "prices"].some(key => Object.hasOwn(remoteRoot, key))) {
      const query = yield* Effect.fromResult(associationRemoteSelection(captured, (entity, fields) =>
        (entity === "variant" ? variants : prepared).graph.admitProjection(entity, fields)));
      const selected = yield* graph({ entity: query.entity, fields: query.fields, filters: query.args.filters });
      if (selected.data.length !== selected.metadata.count) return yield* commerceError("unsupportedProfile");
      return selected.data;
    }
    const { entity, args, fields } = yield* Effect.fromResult(catalogRemoteSelection(captured));
    const selected = yield* graph({ entity, fields, filters: args.filters ?? {},
      pagination: { take: args.take ?? commerceLimits.catalogRows, skip: args.skip ?? 0,
        ...(args.order === undefined ? {} : { order: args.order }) } });
    if (args.take !== undefined || args.skip !== undefined) return { rows: selected.data, metadata: selected.metadata };
    // Callable native refetches have no paging envelope. Refuse an incomplete
    // result instead of silently presenting one page as the entire selection.
    if (selected.data.length !== selected.metadata.count) return yield* commerceError("unsupportedProfile");
    return selected.data;
  }, presentProductReadFailure);
  return Object.freeze({ graph, remoteQuery,
    admitCatalogRefetchFields: (entity: typeof CatalogEntity.Type, fields: readonly string[]) => entity === "product_category"
      ? categories.admitProjection(fields) : prepared.graph.admitProjection(entity, fields),
    admitProductRefetchFields: (fields: readonly string[]) => prepared.graph.admitProjection("product", fields),
    admitVariantRefetchFields: (fields: readonly string[]) => variants.graph.admitProjection("variant", fields),
    admitSalesChannelRefetchFields: (fields: readonly string[]) => prepared.graph.admitProjection("sales_channel", fields),
    admitPriceListRefetchFields: (fields: readonly string[]) => prepared.graph.admitProjection("price_lists", fields),
    close: Effect.forEach(closures, close => close, { discard: true }) });
});
