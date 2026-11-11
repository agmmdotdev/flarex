import { Cause, Effect, Result, Schema } from "effect";
import { asValue, type AwilixContainer } from "@medusajs/deps/awilix-portable";
import type { Logger } from "@medusajs/framework/types";
import type { MedusaRequest } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/utils/common/errors";
import { Modules } from "@medusajs/utils/modules-sdk/definition";
import { makeCoreSchemaBundle, type CoreDatabase } from "@flarex/persistence-postgres/internal/core";
import type { PreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { commerceNativeRegistrations, makeCommerceNativeReadHost } from "@flarex/persistence-postgres/internal/commerce-native";
import { commerceCommandIdentity, type AtomicCommerceParticipant, type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { GraphReadContext } from "../local-graph/model";
import { makeLocalPricingCommands } from "../modules/pricing/service";
import { StorePricingContext } from "../modules/pricing/input";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { QueryLimit, QueryOffset } from "../query/decoder";
import { decodeProductCollectionRead, decodeProductNamedRead } from "../modules/product/service-input";
import { decodeProductCollectionOrder } from "../modules/product/collection-read";
import { compileProductRequestCatalog, runProductRequestPromise } from "./product-request";
import { prepareCategoryRequestRead, prepareProductRequestReadGraph, presentProductReadFailure } from "./product-request-reads";
import { compileStoreRequestReadCatalog, makeStoreRequestReads } from "./store-request-reads";
import { compileStoreProductContextReadCatalog, makeStoreProductContextReads, type StoreProductContextInitializations } from "./store-product-context-reads";

/** Definition production precedes Core admission. The bootstrap owner supplies
 * exact initialization receipts; HTTP never installs or initializes sources. */
export const compileStoreProductRequestCatalog = Effect.fn("StoreProductRequest.compileCatalog")(function* (
  target: Readonly<{ scopeUuid: string; epochUuid: string }>,
  initialization: Readonly<{ auth: Parameters<typeof compileStoreRequestReadCatalog>[1]; context: StoreProductContextInitializations }>,
  logger: Logger,
) {
  const product = yield* compileProductRequestCatalog(target);
  const pricing = yield* makeLocalPricingCommands("store-product-read");
  const auth = yield* compileStoreRequestReadCatalog(target, initialization.auth);
  const context = yield* compileStoreProductContextReadCatalog(target, initialization.context, logger);
  const sources = Object.freeze([...product.sources.map(source => source.name === "pricing"
    ? Object.freeze({ ...source, commands: pricing.commands }) : source),
  ...Object.entries(auth).map(([name, source]) => Object.freeze({ name, ...source })), ...Object.values(context.sources)]);
  const bundle = yield* makeCoreSchemaBundle({ sources: [...sources.map(source => ({ kind: "native" as const, definition: source.definition })),
    { kind: "native", definition: product.eventDefinition }] });
  return Object.freeze({ target: product.target, product, pricing, auth, context, sources, bundle, eventDefinition: product.eventDefinition });
});
export type StoreProductRequestCatalog = Effect.Success<ReturnType<typeof compileStoreProductRequestCatalog>>;

const TaggedPricingContext = Schema.Struct({ __type: Schema.Literal("QueryContext"), ...StorePricingContext.fields });
const decodeContexts = commerceDecoder(Schema.Struct({
  variants: Schema.optionalKey(Schema.Struct({ calculated_price: TaggedPricingContext })),
}), "unsupportedProfile");

/** Pinned toRemoteQuery strips the structural QueryContext tag and forwards
 * the remaining context on this selected alias. No generic context dispatch. */
export const normalizeStoreProductQueryContext = (value: unknown) => Result.gen(function* () {
  const context = yield* captureCommerceInput(value).pipe(Result.flatMap(decodeContexts));
  if (context.variants === undefined) return {};
  const { __type: _tag, ...pricing } = context.variants.calculated_price;
  return { "variants.calculated_price": pricing };
});

const decodeProductQuery = commerceDecoder(Schema.Struct({
  entity: Schema.Literals(["product", "product_collection", "product_tag", "product_type", "product_category", "product_sales_channel", "product_variant_inventory_items", "sales_channels"]),
  fields: Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).check(Schema.isLengthBetween(1, 256)),
  filters: Schema.optionalKey(Schema.JsonObject), context: Schema.optionalKey(Schema.JsonObject),
  pagination: Schema.optionalKey(Schema.Struct({ take: Schema.optionalKey(QueryLimit), skip: Schema.optionalKey(QueryOffset),
    order: Schema.optionalKey(Schema.Record(Schema.String, Schema.Literals(["ASC", "DESC"]))) })),
}), "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({
  cache: Schema.optionalKey(Schema.Struct({ enable: Schema.optionalKey(Schema.Boolean),
    tags: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 512))).check(Schema.isMaxLength(8))) })),
  locale: Schema.optionalKey(Schema.String.check(Schema.isLengthBetween(1, 256))),
  throwIfKeyNotFound: Schema.optionalKey(Schema.Boolean),
}), "unsupportedProfile");
const decodeEntity = commerceDecoder(Schema.StructWithRest(Schema.Struct({ entity: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]), "unsupportedProfile");
const decodeRemoteEntity = commerceDecoder(Schema.Struct({ __value: Schema.Record(Schema.Literals(["region", "currency"]), Schema.optionalKey(Schema.JsonObject)) }), "unsupportedProfile");

/** Each native remote service read keeps its independent protected operation.
 * Seventeen bounded read hosts belong to the live Core generation, not requests. */
export const makeStoreProductRequestReads = Effect.fn("StoreProductRequest.makeReads")(function* (input: Readonly<{
  database: CoreDatabase; hostRuntime: PreparedHostRuntime; catalog: StoreProductRequestCatalog; identityAndAccessPolicy: Json;
}>) {
  const prepared = yield* prepareProductRequestReadGraph(input.catalog.product, true, input.catalog.pricing.graph);
  const productMember = prepared.members.find(member => member.source.name === "product");
  const categoryRead = input.catalog.product.runtimes.product.graph.reads.find(read => read.model === input.catalog.product.runtimes.product.metadata.category.model);
  if (productMember === undefined || categoryRead === undefined) return yield* commerceError("invalidAuthority");
  const categories = prepareCategoryRequestRead(categoryRead, productMember.participant, input.catalog.product.runtimes.product.metadata);
  const auth = yield* makeStoreRequestReads({ ...input, catalog: input.catalog.auth });
  const contexts = yield* makeStoreProductContextReads({ ...input, catalog: input.catalog.context });
  const hosts = new Map<AtomicCommerceParticipant, { readonly commands: ReadonlySet<CommerceCommand>;
    readonly read: (command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError> }>();
  const closures: Effect.Effect<void>[] = [];
  for (const member of prepared.members) {
    const commands = [...member.commands];
    if (commands.length === 0 || commands.some(command => commerceCommandIdentity(command)?.mode !== "read"))
      return yield* commerceError("invalidAuthority");
    const binding = yield* input.database.bindNative({ definition: member.source.definition,
      commands: yield* Effect.fromResult(commerceNativeRegistrations(commands, { readOnly: true })) });
    const host = yield* Effect.acquireRelease(makeCommerceNativeReadHost({ database: input.database, binding, hostRuntime: input.hostRuntime,
      commands, initialization: member.source.initialization, identityAndAccessPolicy: input.identityAndAccessPolicy }), host => host.close);
    hosts.set(member.participant, { commands: new Set(commands), read: host.read }); closures.push(host.close);
  }
  const graph = Effect.fn("StoreProductRequest.graph")(function* (value: unknown, options?: unknown) {
    const captured = yield* Effect.fromResult(captureCommerceInput(value));
    const { entity } = yield* Effect.fromResult(decodeEntity(captured));
    if (entity === "api_key") return yield* auth.query.graph(captured, options);
    if (["store", "region", "cart", "customer_group", "sales_channel_locations"].includes(entity))
      return yield* contexts.query.graph(captured, options);
    const query = yield* Effect.fromResult(decodeProductQuery(captured));
    const checked = options === undefined ? undefined
      : yield* Effect.fromResult(captureCommerceInput(options).pipe(Result.flatMap(decodeOptions)));
    if (query.entity === "product_tag" || query.entity === "product_type")
      yield* Effect.fromResult(decodeProductNamedRead({ filters: query.filters ?? {} }));
    if (query.entity === "product_collection") {
      yield* Effect.fromResult(decodeProductCollectionRead({ filters: query.filters ?? {} }));
      if (query.pagination?.order !== undefined) yield* Effect.fromResult(decodeProductCollectionOrder(query.pagination.order));
      // The pinned Collection route supplies no Product publication/channel
      // filters. Refuse traversal in this private Store profile before reading;
      // ordinary Admin Collection relation capabilities remain module-owned.
      if (query.fields.some(field => field === "products" || field.startsWith("products.")))
        return yield* commerceError("unsupportedProfile");
    }
    const contextMap = yield* Effect.fromResult(normalizeStoreProductQueryContext(query.context ?? {}));
    let failure: Cause.Cause<CommerceTransactionError> | undefined;
    const context: GraphReadContext = {
      refuse: error => Effect.fail(error), recordFailure: cause => { failure ??= cause; return Result.succeed(failure); },
      call: Effect.fn("StoreProductRequest.readGroup")(function* (participant, command, args) {
        if (failure !== undefined) return yield* Effect.failCause(failure);
        const host = hosts.get(participant);
        if (host === undefined || !host.commands.has(command)) return yield* commerceError("invalidAuthority");
        return yield* host.read(command, args);
      }),
    };
    const keyOptions = checked?.throwIfKeyNotFound === true ? { throwIfKeyNotFound: true } : undefined;
    if (query.entity === "product_category") {
      if (Object.keys(contextMap).length !== 0) return yield* commerceError("unsupportedProfile");
      return yield* categories.execute(context, { ...query, entity: "product_category" }, keyOptions);
    }
    // Locale is admitted and propagated by HTTP. This composition explicitly
    // refuses enabled Translation; the disabled native query branch is a no-op.
    return yield* prepared.graph.bind(context).graph({ entity: query.entity === "sales_channels" ? "sales_channel" : query.entity,
      fields: query.fields, filters: query.filters ?? {}, context: contextMap,
      pagination: { take: query.pagination?.take ?? commerceLimits.catalogRows, skip: query.pagination?.skip ?? 0,
        ...(query.pagination?.order === undefined ? {} : { order: query.pagination.order }) } },
    keyOptions);
  }, presentProductReadFailure);
  const index = Effect.fn("StoreProductRequest.index")(function* (_value: unknown, _options?: unknown) {
    return yield* commerceError("adapterFailure", new MedusaError(MedusaError.Types.INVALID_DATA,
      "Index Engine queries are outside the private Store Product profile"));
  });
  const remoteQuery = Effect.fn("StoreProductRequest.remoteQuery")(function* (value: unknown) {
    const captured = yield* Effect.fromResult(captureCommerceInput(value));
    const envelope = yield* Effect.fromResult(decodeRemoteEntity(captured));
    return envelope.__value.region === undefined ? yield* auth.remoteQuery(captured) : yield* contexts.remoteQuery(captured);
  });
  return Object.freeze({ query: Object.freeze({ graph, index }), remoteQuery, tax: contexts.tax,
    admitProductFields: (fields: readonly string[]) => prepared.graph.admitProjection("product", fields),
    close: Effect.forEach(closures, close => close, { discard: true }).pipe(Effect.andThen(contexts.close), Effect.andThen(auth.close)) });
});
export type StoreProductRequestReads = Effect.Success<ReturnType<typeof makeStoreProductRequestReads>>;

export const makeStoreProductRequestScopeFactory = Effect.fn("StoreProductRequest.makeScopeFactory")(function* (input: Readonly<{
  reads: StoreProductRequestReads; container: AwilixContainer;
}>) {
  const container = yield* Effect.acquireRelease(Effect.sync(() => input.container.createScope().register({
    query: asValue({ graph: (value: unknown, options?: unknown) => runProductRequestPromise(input.reads.query.graph(value, options)),
      index: (value: unknown, options?: unknown) => runProductRequestPromise(input.reads.query.index(value, options)) }),
    remoteQuery: asValue((value: unknown) => runProductRequestPromise(input.reads.remoteQuery(value))),
    [Modules.TAX]: asValue({ getTaxLines: (...args: readonly unknown[]) => runProductRequestPromise(presentProductReadFailure(input.reads.tax.getTaxLines(...args))) }),
  })), scope => Effect.promise(() => scope.dispose()));
  return Object.freeze({ createRequestScope: (): MedusaRequest["scope"] => container.createScope() });
});
