import { Cause, Effect, Result, Schema } from "effect";
import { ProductSalesChannel, ProductShippingProfile, ProductVariantInventoryItem, ProductVariantPriceSet } from "@medusajs/link-modules";
import { MedusaError } from "@medusajs/utils/common/errors";
import type { CoreDatabase } from "@flarex/persistence-postgres/internal/core";
import type { PreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { commerceNativeRegistrations, makeCommerceNativeReadHost } from "@flarex/persistence-postgres/internal/commerce-native";
import { commerceCommandIdentity, defineAtomicCommerceParticipant, type AtomicCommerceParticipant, type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, isJsonObject, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { nativeLinkGraphDirectPaths } from "../local-graph/direct-paths";
import { nativeLinkGraphPaths } from "../local-graph/links";
import type { GraphModuleDefinition, GraphParticipant, GraphReadContext } from "../local-graph/model";
import { prepareLocalGraph } from "../local-graph/query";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { QueryLimit, QueryOffset } from "../query/decoder";
import type { ProductRequestCatalog } from "./product-request";

const decodeQuery = commerceDecoder(Schema.Struct({
  entity: Schema.Literals(["product", "product_sales_channel"]),
  fields: Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).check(Schema.isLengthBetween(1, 256)),
  filters: Schema.optionalKey(Schema.JsonObject),
  pagination: Schema.optionalKey(Schema.Struct({ take: Schema.optionalKey(QueryLimit), skip: Schema.optionalKey(QueryOffset),
    order: Schema.optionalKey(Schema.Record(Schema.String, Schema.Literals(["ASC", "DESC"]))) })),
  withDeleted: Schema.optionalKey(Schema.Boolean),
}), "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({ throwIfKeyNotFound: Schema.optionalKey(Schema.Boolean) }), "unsupportedProfile");

/** Reuse the same native Link metadata and local graph planner as workflow
 * Query. Every row is returned by its original module's registered command. */
export const prepareProductRequestReadGraph = Effect.fn("ProductRequest.prepareReadGraph")(function* (catalog: ProductRequestCatalog) {
  const { product, pricing, inventory, stock, sales, fulfillment, productLinks, variantLinks } = catalog.runtimes;
  const root = product.metadata.product.model, variant = product.metadata.variant.model;
  const bounds = { maximumSources: 128, maximumLinks: 128, maximumTargets: 128, maximumPerSource: 128 };
  const remotePaths = yield* Effect.fromResult(nativeLinkGraphPaths(ProductSalesChannel, [{ root, path: "sales_channels", ...bounds }]));
  const shipping = yield* Effect.fromResult(nativeLinkGraphPaths(ProductShippingProfile, [{ root, path: "shipping_profile", ...bounds, maximumPerSource: 1 }]));
  const prices = yield* Effect.fromResult(nativeLinkGraphPaths(ProductVariantPriceSet,
    [{ root, path: "variants.price_set", ...bounds, maximumPerSource: 1 }], variant));
  const rich = yield* Effect.fromResult(nativeLinkGraphDirectPaths(ProductVariantInventoryItem,
    [{ root, path: "variants.inventory_items", maximumSources: 128, maximumTargets: 128, maximumPerSource: 128 }], variant));
  const richModel = rich[0]?.targetModel;
  if (richModel === undefined) return yield* commerceError("unsupportedProfile");
  const items = yield* Effect.fromResult(nativeLinkGraphDirectPaths(ProductVariantInventoryItem,
    [{ root, path: "variants.inventory_items.inventory", maximumSources: 128, maximumTargets: 128, maximumPerSource: 1 }], richModel));
  const definitions: Readonly<Record<string, GraphModuleDefinition>> = {
    product: product.graph, pricing: pricing.graph, inventory: inventory.graph,
    stock_location: stock.graph, sales_channel: sales.graph, fulfillment: fulfillment.graph,
    product_links: { ...productLinks.graph, remotePaths: [...remotePaths, ...shipping] },
    variant_links: { ...variantLinks.graph, remotePaths: prices, directPaths: [...rich, ...items] },
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
  const hosts = new Map<AtomicCommerceParticipant, { readonly commands: ReadonlySet<CommerceCommand>;
    readonly read: (command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError> }>();
  const closures: Effect.Effect<void>[] = [];
  for (const member of prepared.members) {
    if (member.commands.length === 0 || member.commands.some(command => commerceCommandIdentity(command)?.mode !== "read"))
      return yield* commerceError("invalidAuthority");
    const binding = yield* input.database.bindNative({ definition: member.source.definition,
      commands: yield* Effect.fromResult(commerceNativeRegistrations(member.commands, { readOnly: true })) });
    const host = yield* Effect.acquireRelease(makeCommerceNativeReadHost({ database: input.database, binding, hostRuntime: input.hostRuntime,
      commands: member.commands, initialization: member.source.initialization, identityAndAccessPolicy: input.identityAndAccessPolicy }), host => host.close);
    hosts.set(member.participant, { commands: new Set(member.commands), read: host.read });
    closures.push(host.close);
  }
  const graph = Effect.fn("ProductRequest.graph")(function* (value: unknown, options?: unknown) {
    const query = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(decodeQuery)));
    const checkedOptions = options === undefined ? undefined
      : yield* Effect.fromResult(captureCommerceInput(options).pipe(Result.flatMap(decodeOptions)));
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
    return yield* prepared.graph.bind(context).graph({ entity: query.entity, fields: query.fields,
      filters: query.filters ?? {}, pagination: { take: query.pagination?.take ?? commerceLimits.catalogRows,
        skip: query.pagination?.skip ?? 0, ...(query.pagination?.order === undefined ? {} : { order: query.pagination.order }) } },
      checkedOptions?.throwIfKeyNotFound === true ? { throwIfKeyNotFound: true } : undefined);
  }, work => work.pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error =>
    error.reason === "unsupportedProfile" || error.reason === "invalidInput" || error.reason === "limitExceeded"
      ? commerceError("adapterFailure", new MedusaError(MedusaError.Types.INVALID_DATA,
        "Product query is outside the private supported profile", undefined, undefined, { cause: error }))
      : error)))));
  return Object.freeze({ graph, admitProductRefetchFields: (fields: readonly string[]) => prepared.graph.admitProjection("product", fields),
    close: Effect.forEach(closures, close => close, { discard: true }) });
});
