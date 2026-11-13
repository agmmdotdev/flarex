import { Cause, Effect, Result, Schema, Scope } from "effect";
import { asValue, type AwilixContainer } from "@medusajs/deps/awilix-portable";
import type { Logger } from "@medusajs/framework/types";
import type { MedusaRequest } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/utils/common/errors";
import { Modules } from "@medusajs/utils/modules-sdk/definition";
import { makeCoreSchemaBundle, type CoreDatabase, type CoreNativeDefinition } from "@flarex/persistence-postgres/internal/core";
import type { PreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { compileCoreNativeEventStorageDefinition, defineAtomicCommerceNativeSource, makeAtomicCommerceNativeHost,
  commerceNativeRegistrations, makeCommerceNativeReadHost, type CommerceInitialization } from "@flarex/persistence-postgres/internal/commerce-native";
import { commerceCommandIdentity, defineAtomicCommerceParticipant, type AtomicCommerceEvents,
  type AtomicCommerceParticipant, type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, defaultCommerceResources, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareLocalGraph } from "../local-graph/query";
import { prepareNativeReadRegistry } from "../local-graph/native-registry";
import type { GraphParticipant, GraphReadContext } from "../local-graph/model";
import { makeCartCreationRuntimes, type CartCreationRuntimes } from "../workflows/cart/creation-runtimes";
import { prepareCartCreationModules, type CartCreationModules } from "../workflows/cart/creation-graph";
import { prepareCreateCartWorkflow, type CartCreationHooks } from "../workflows/cart/create-cart";
import { prepareCartMutationWorkflows, type CartMutationHooks } from "../workflows/cart/mutations";
import { prepareCartPromotionsWorkflow } from "../workflows/cart/promotions";
import { prepareCartTaxesWorkflow } from "../workflows/cart/taxes";
import { cartShippingCoreDefinitions, cartShippingModuleNames, makeCartShippingLinkRuntimes, prepareCartShippingModules, type CartShippingLinks } from "../workflows/cart/shipping-graph";
import { prepareCartShippingWorkflows } from "../workflows/cart/shipping";
import { makeStorePaymentRuntimes, prepareStorePaymentWorkflows } from "../workflows/payment/store";
import { makeStoreCheckoutRuntimes } from "../workflows/cart/checkout-runtimes";
import { prepareStoreCheckoutModules, storeCheckoutModuleNames, type StoreCheckoutModules } from "../workflows/cart/checkout-graph";
import { prepareStoreCompleteCartWorkflow } from "../workflows/cart/complete-cart";
import { prepareStoreOrderReadWorkflows } from "../workflows/order/store-reads";
import { makeStoreOrderReadCommands } from "../modules/order/store-read-service";
import { storeOrderReadCommandMs, storeOrderReadResources } from "../modules/order/store-read-input";
import { makeStoreOrderPaymentReadCommands } from "../modules/payment/store-order-read-service";
import { makeFulfillmentStoreOrderReadCommands } from "../modules/fulfillment/store-order-read-service";
import { prepareStoreOrderPaymentCollectionLinkRead } from "../links/order-payment-collection-service";
import { compileOrderFulfillmentLinkCoreDefinition } from "../links/order-fulfillment-schema";
import { prepareOrderFulfillmentLinkRead } from "../links/order-fulfillment-service";
import { compileOrderCoreDefinition } from "../modules/order/schema";
import { compileOrderCartLinkCoreDefinition } from "../links/order-cart-schema";
import { compileOrderPaymentCollectionLinkCoreDefinition } from "../links/order-payment-collection-schema";
import { compileOrderPromotionLinkCoreDefinition } from "../links/order-promotion-schema";
import { compileCustomerAccountHolderLinkCoreDefinition } from "../links/customer-account-holder-schema";
import { captureInstalledWorkflowModules, type AtomicWorkflowExecution, type OrdinaryNativeInstalledWorkflowModule } from "../workflow/host";
import { workflowModuleDefinition } from "../workflow/module";
import { commerceDecoder } from "../value/decoder";
import { ScalarId } from "../repository/scalar-id-read";
import { captureCommerceInput } from "../value/input";
import { compileStoreRequestReadCatalog, makeStoreRequestReads } from "./store-request-reads";
import { runCompletedCartRequestPromise } from "./store-cart-completion";
import { runProductRequestPromise } from "./product-request";

type NativeName = typeof cartShippingModuleNames[number];
const completionSourceNames = ["order", "order_cart_links", "order_payment_collection_links", "order_promotion_links"] as const;
type CompletionSourceName = typeof completionSourceNames[number];
// Three auth readers, twenty commerce readers (Store/Tax need no read lease),
// Twelve native mutation roots and five named Store Order readers share the
// same generation budget. GET workflows create no durable root or outcome.
export const storeCartRequestHostLimits = Object.freeze({ maximumHosts: 40, maximumPreparedBytes: 8 * 1024 * 1024 });
export const storeCartRequestModuleNames = [...cartShippingModuleNames, "customer_account_holder_links", ...completionSourceNames, "order_fulfillment_links"] as const;
export const storeCartRequestCoreDefinitions = Effect.fn("StoreCartRequest.compileDefinitions")(function* (
  target: Readonly<{ scopeUuid: string; epochUuid: string }>,
) {
  return { ...yield* cartShippingCoreDefinitions(target),
    customer_account_holder_links: yield* compileCustomerAccountHolderLinkCoreDefinition(target),
    order: yield* compileOrderCoreDefinition(target, "generate"),
    order_cart_links: yield* compileOrderCartLinkCoreDefinition(target),
    order_payment_collection_links: yield* compileOrderPaymentCollectionLinkCoreDefinition(target),
    order_promotion_links: yield* compileOrderPromotionLinkCoreDefinition(target),
    order_fulfillment_links: yield* compileOrderFulfillmentLinkCoreDefinition(target) };
});
export type StoreCartRequestInitializations = Readonly<{
  native: Readonly<Record<typeof storeCartRequestModuleNames[number], CommerceInitialization>>;
  auth: Parameters<typeof compileStoreRequestReadCatalog>[1];
}>;
interface CatalogSource {
  readonly name: string;
  readonly definition: CoreNativeDefinition;
  readonly commands: readonly CommerceCommand[];
  readonly initialization: CommerceInitialization;
}
interface StoreCartRequestRuntimes extends CartCreationRuntimes {
  readonly workflows: CartCreationRuntimes["workflows"] & Effect.Success<ReturnType<typeof makeCartShippingLinkRuntimes>>;
}
const makeStoreOrderReadRuntimes = Effect.fn("StoreOrderRequest.makeRuntimes")(function* (logger: Logger) {
  return { order: yield* makeStoreOrderReadCommands(), payment: yield* makeStoreOrderPaymentReadCommands(logger),
    fulfillment: yield* makeFulfillmentStoreOrderReadCommands(),
    order_payment_collection_links: yield* prepareStoreOrderPaymentCollectionLinkRead(),
    order_fulfillment_links: yield* prepareOrderFulfillmentLinkRead() };
});
export interface StoreCartRequestCatalog {
  readonly target: Readonly<{ scopeUuid: string; epochUuid: string }>;
  readonly runtimes: StoreCartRequestRuntimes;
  readonly completionRuntimes: Effect.Success<ReturnType<typeof makeStoreCheckoutRuntimes>>;
  readonly completionModules: StoreCheckoutModules;
  readonly completionSources: readonly (CatalogSource & { readonly name: CompletionSourceName; readonly source: Result.Result.Success<ReturnType<typeof defineAtomicCommerceNativeSource>> })[];
  readonly paymentRuntimes: Effect.Success<ReturnType<typeof makeStorePaymentRuntimes>>;
  readonly paymentAccountSource: CatalogSource & { readonly source: Result.Result.Success<ReturnType<typeof defineAtomicCommerceNativeSource>> };
  readonly orderReadRuntimes: Effect.Success<ReturnType<typeof makeStoreOrderReadRuntimes>>;
  readonly orderFulfillmentSource: CatalogSource & { readonly source: Result.Result.Success<ReturnType<typeof defineAtomicCommerceNativeSource>> };
  readonly modules: CartCreationModules;
  readonly shippingLinks: Readonly<Record<keyof CartShippingLinks, OrdinaryNativeInstalledWorkflowModule>>;
  readonly nativeSources: readonly (CatalogSource & { readonly name: NativeName; readonly source: Result.Result.Success<ReturnType<typeof defineAtomicCommerceNativeSource>> })[];
  readonly auth: Effect.Success<ReturnType<typeof compileStoreRequestReadCatalog>>;
  readonly sources: readonly CatalogSource[];
  readonly eventDefinition: CoreNativeDefinition;
  readonly bundle: Effect.Success<ReturnType<typeof makeCoreSchemaBundle>>;
}

/** Definitions and genuine native construction precede source admission. */
export const compileStoreCartRequestCatalog = Effect.fn("StoreCartRequest.compileCatalog")(function* (
  target: Readonly<{ scopeUuid: string; epochUuid: string }>, initialization: StoreCartRequestInitializations, logger: Logger,
) {
  const base = yield* makeCartCreationRuntimes(logger, "cart-mutations", "cart-shipping");
  const runtimes = { ...base, workflows: { ...base.workflows, ...yield* makeCartShippingLinkRuntimes() } };
  const definitions = yield* storeCartRequestCoreDefinitions(target);
  const paymentRuntimes = yield* makeStorePaymentRuntimes();
  const completionRuntimes = yield* makeStoreCheckoutRuntimes(logger);
  const orderReadRuntimes = yield* makeStoreOrderReadRuntimes(logger);
  const sourceCommands = (name: string, original: readonly CommerceCommand[]) => Result.gen(function* () {
    const completion = Object.entries(completionRuntimes.workflows).find(([key]) => key === name)?.[1];
    const extra = completion === undefined ? [] : workflowModuleDefinition(completion)?.logical?.commands;
    const orderRead = Object.entries(orderReadRuntimes).find(([key]) => key === name)?.[1];
    const reads = orderRead === undefined ? [] : workflowModuleDefinition(orderRead.workflow)?.logical?.commands;
    if (extra === undefined || reads === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    const selected = new Map<string, CommerceCommand>();
    for (const command of [...original, ...extra, ...reads]) {
      const identity = commerceCommandIdentity(command);
      if (identity === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
      const prior = selected.get(identity.name);
      if (prior !== undefined && commerceCommandIdentity(prior)?.mode !== identity.mode) return yield* Result.fail(commerceError("invalidAuthority"));
      if (prior === undefined) selected.set(identity.name, command);
    }
    return [...selected.values()];
  });
  const accountDefinition = workflowModuleDefinition(paymentRuntimes.customerAccountHolder.workflow)?.logical;
  if (accountDefinition === undefined) return yield* commerceError("invalidAuthority");
  const paymentAccountSource = { name: "customer_account_holder_links", definition: definitions.customer_account_holder_links,
    commands: yield* Effect.fromResult(sourceCommands("customer_account_holder_links", accountDefinition.commands)), initialization: Object.freeze({ ...initialization.native.customer_account_holder_links }),
    source: yield* Effect.fromResult(defineAtomicCommerceNativeSource("customer_account_holder_links", definitions.customer_account_holder_links)) };
  const nativeSources = [];
  for (const name of cartShippingModuleNames) {
    const logical = workflowModuleDefinition(runtimes.workflows[name])?.logical;
    if (logical === undefined) return yield* commerceError("invalidAuthority");
    const source = yield* Effect.fromResult(defineAtomicCommerceNativeSource(name, definitions[name]));
    nativeSources.push(Object.freeze({ name, definition: definitions[name], source, commands: yield* Effect.fromResult(sourceCommands(name, logical.commands)),
      initialization: Object.freeze({ ...initialization.native[name] }) }));
  }
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(Object.fromEntries(nativeSources.map(source =>
    [source.name, { module: runtimes.workflows[source.name], nativeStorage: source.source }])), cartShippingModuleNames));
  const { location_fulfillment_set_links, shipping_option_price_set_links, ...modules } = installed;
  const shippingLinks = { location_fulfillment_set_links, shipping_option_price_set_links };
  const completionSources = [];
  for (const name of completionSourceNames) {
    const logical = workflowModuleDefinition(completionRuntimes.workflows[name])?.logical;
    if (logical === undefined) return yield* commerceError("invalidAuthority");
    completionSources.push({ name, definition: definitions[name], commands: yield* Effect.fromResult(sourceCommands(name, logical.commands)),
      initialization: Object.freeze({ ...initialization.native[name] }),
      source: yield* Effect.fromResult(defineAtomicCommerceNativeSource(name, definitions[name])) });
  }
  const orderFulfillmentSource = { name: "order_fulfillment_links", definition: definitions.order_fulfillment_links,
    commands: orderReadRuntimes.order_fulfillment_links.commands,
    initialization: Object.freeze({ ...initialization.native.order_fulfillment_links }),
    source: yield* Effect.fromResult(defineAtomicCommerceNativeSource("order_fulfillment_links", definitions.order_fulfillment_links)) };
  const commerceSources = [...nativeSources, paymentAccountSource, ...completionSources, orderFulfillmentSource];
  const completionEntries = [];
  for (const name of storeCheckoutModuleNames) {
    const source = commerceSources.find(source => source.name === name);
    if (source === undefined) return yield* commerceError("invalidAuthority");
    completionEntries.push([name, { module: completionRuntimes.workflows[name], nativeStorage: source.source }]);
  }
  const completionModules = yield* Effect.fromResult(captureInstalledWorkflowModules(Object.fromEntries(completionEntries), storeCheckoutModuleNames));
  const auth = yield* compileStoreRequestReadCatalog(target, initialization.auth);
  const sources = Object.freeze([...commerceSources, ...Object.entries(auth).map(([name, source]) => ({ name, ...source }))]);
  const eventDefinition = yield* compileCoreNativeEventStorageDefinition(target);
  const bundle = yield* makeCoreSchemaBundle({ sources: [...sources.map(source => ({ kind: "native" as const, definition: source.definition })),
    { kind: "native", definition: eventDefinition }] });
  const result: StoreCartRequestCatalog = Object.freeze({ target: Object.freeze({ ...target }), runtimes, paymentRuntimes, paymentAccountSource, completionRuntimes, completionModules, completionSources,
    orderReadRuntimes, orderFulfillmentSource, modules, shippingLinks, nativeSources: Object.freeze(nativeSources), auth, sources, eventDefinition, bundle });
  return result;
});

const Scalar = Schema.String.check(Schema.isBetweenLength(1, 256), Schema.isPattern(/^[a-zA-Z_][a-zA-Z0-9_]*$/));
const Fields = Schema.Array(Schema.Union([Scalar, Schema.Literal("*")])).check(Schema.isMaxLength(256));
const ChildName = Scalar.check(Schema.makeFilter(key => !["fields", "__args", "isServiceAccess"].includes(key)));
interface RemoteNode { readonly fields?: readonly string[]; readonly [key: string]: unknown }
const nodeAtDepth = (remaining: number): Schema.Codec<RemoteNode> => Schema.StructWithRest(Schema.Struct({ fields: Schema.optionalKey(Fields),
  __args: Schema.optionalKey(Schema.Never), isServiceAccess: Schema.optionalKey(Schema.Never) }),
  [Schema.Record(ChildName, remaining === 0 ? Schema.Never : Schema.suspend(() => nodeAtDepth(remaining - 1)))]).check(
    Schema.makeFilter(value => (value.fields?.length ?? 0) > 0 || Object.keys(value).some(key => key !== "fields")));
const Node = nodeAtDepth(7);
const RemoteRootMembers = { fields: Fields, isServiceAccess: Schema.Literal(false) };
const CartRemoteRoot = Schema.StructWithRest(Schema.Struct({
  ...RemoteRootMembers, __args: Schema.Struct({ filters: Schema.Struct({ id: ScalarId }) }),
}), [Schema.Record(ChildName, Node)]);
const CollectionLinkRemoteRoot = Schema.StructWithRest(Schema.Struct({
  ...RemoteRootMembers, __args: Schema.Struct({ filters: Schema.Struct({ cart_id: ScalarId }) }),
}), [Schema.Record(ChildName, Node)]);
const decodeCartRemoteRoot = commerceDecoder(CartRemoteRoot, "unsupportedProfile");
const decodeCollectionLinkRemoteRoot = commerceDecoder(CollectionLinkRemoteRoot, "unsupportedProfile");
const decodeRemoteEnvelope = commerceDecoder(Schema.Struct({ __value: Schema.Record(Schema.Literals(["cart", "api_key", "cart_payment_collection"]),
  Schema.optionalKey(Schema.JsonObject)).check(Schema.makeFilter(value => Object.keys(value).length === 1)) }), "unsupportedProfile");
const commerceEntity = Schema.is(Schema.Struct({ entity: Schema.Literals(["payment_collection", "order"]) }));
const GraphFields = Schema.Array(Schema.String.check(Schema.isBetweenLength(1, 256))).check(Schema.isMaxLength(256));
const decodeCommerceGraphQuery = commerceDecoder(Schema.Struct({ entity: Schema.Literals(["payment_collection", "order"]), fields: GraphFields,
  filters: Schema.Struct({ id: ScalarId }), pagination: Schema.optionalKey(Schema.Never), withDeleted: Schema.optionalKey(Schema.Never),
  context: Schema.optionalKey(Schema.Never) }), "unsupportedProfile");

/** HTTP presentation maps only admitted input/profile refusals, preserving Causes. */
const presentCartFailure = <A, R>(work: Effect.Effect<A, CommerceTransactionError, R>) => work.pipe(
  Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error =>
    error.reason === "unsupportedProfile" || error.reason === "invalidInput" || error.reason === "limitExceeded"
      ? commerceError("adapterFailure", new MedusaError(MedusaError.Types.INVALID_DATA,
        "Cart request is outside the private supported profile", undefined, undefined, { cause: error })) : error))));

/** One native mutation owner; Remote Query keeps independent protected service reads. */
export const makeStoreCartRequestRuntime = Effect.fn("StoreCartRequest.makeRuntime")(function* (input: Readonly<{
  database: CoreDatabase; hostRuntime: PreparedHostRuntime; catalog: StoreCartRequestCatalog; identityAndAccessPolicy: Json;
  revision: string; subscribers: AtomicCommerceEvents["subscribers"]; hooks?: CartCreationHooks; mutationHooks?: CartMutationHooks;
}>) {
  const selected = yield* prepareCartCreationModules(input.catalog.modules, input.catalog.runtimes.salesChannelRead);
  const cartGraphModules = yield* Effect.fromResult(prepareCartShippingModules(selected.modules, input.catalog.shippingLinks));
  const completionModules = yield* prepareStoreCheckoutModules(input.catalog.completionModules);
  const graphModules = { ...cartGraphModules, order: completionModules.order, order_payment_collection_links: completionModules.order_payment_collection_links };
  const members: GraphParticipant[] = [];
  const publicParticipants = new Map<string, AtomicCommerceParticipant>();
  const hosts = new Map<AtomicCommerceParticipant, { readonly commands: ReadonlySet<CommerceCommand>;
    readonly read: (command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError> }>();
  const closures: Effect.Effect<void>[] = [];
  for (const source of [...input.catalog.nativeSources, ...input.catalog.completionSources.filter(source => source.name === "order" || source.name === "order_payment_collection_links")]) {
    // No public Cart or Shipping path reaches Store. Native creation retains
    // its separate Store participant; this read facade needs no Store lease.
    if (source.name === "store") continue;
    const member = Object.entries(graphModules).find(([name]) => name === source.name)?.[1];
    const definition = member === undefined ? undefined : workflowModuleDefinition(member.module);
    if (definition === undefined) return yield* commerceError("invalidAuthority");
    const commands = [...new Set(definition.graph.reads.map(read => read.command))];
    const participant = defineAtomicCommerceParticipant(`storeCartRead_${source.name}`);
    publicParticipants.set(source.name, participant);
    members.push({ participant, module: definition.graph });
    if (commands.length === 0) continue;
    if (commands.some(command => commerceCommandIdentity(command)?.mode !== "read")) return yield* commerceError("invalidAuthority");
    const binding = yield* input.database.bindNative({ definition: source.definition,
      commands: yield* Effect.fromResult(commerceNativeRegistrations(commands, { readOnly: true })) });
    const host = yield* Effect.acquireRelease(makeCommerceNativeReadHost({ database: input.database, binding, hostRuntime: input.hostRuntime,
      commands, initialization: source.initialization, identityAndAccessPolicy: input.identityAndAccessPolicy }), host => host.close);
    hosts.set(participant, { commands: new Set(commands), read: host.read }); closures.push(host.close);
  }
  const graph = yield* Effect.fromResult(prepareLocalGraph(members));
  const registry = yield* Effect.fromResult(prepareNativeReadRegistry(members));
  const productParticipant = publicParticipants.get("product");
  if (productParticipant === undefined) return yield* commerceError("invalidAuthority");
  const orderMembers = members.filter(member => member.participant === productParticipant);
  for (const [name, runtime] of Object.entries(input.catalog.orderReadRuntimes)) {
    const source = input.catalog.sources.find(source => source.name === name);
    const definition = workflowModuleDefinition(runtime.workflow);
    if (source === undefined || definition === undefined) return yield* commerceError("invalidAuthority");
    const commands = [...new Set(definition.graph.reads.map(read => read.command))];
    if (commands.length === 0 || commands.some(command => commerceCommandIdentity(command)?.mode !== "read"))
      return yield* commerceError("invalidAuthority");
    const participant = defineAtomicCommerceParticipant(`storeOrderRead_${name}`);
    orderMembers.push({ participant, module: definition.graph });
    const binding = yield* input.database.bindNative({ definition: source.definition,
      commands: yield* Effect.fromResult(commerceNativeRegistrations(commands, { readOnly: true })) });
    // Named readers retain a finite source working set, including off-page
    // candidates inspected for count. Other readers keep their ordinary limits.
    const host = yield* Effect.acquireRelease(makeCommerceNativeReadHost({ database: input.database, binding, hostRuntime: input.hostRuntime,
      commands, initialization: source.initialization, identityAndAccessPolicy: input.identityAndAccessPolicy,
      resources: storeOrderReadResources,
      requestCommandMs: storeOrderReadCommandMs,
      nativeLimits: { maxIdentities: source.definition.tables.length * defaultCommerceResources.queryRows,
        maxDocumentBytes: commerceLimits.rowBytes } }), host => host.close);
    hosts.set(participant, { commands: new Set(commands), read: host.read }); closures.push(host.close);
  }
  const orderGraph = yield* Effect.fromResult(prepareLocalGraph(orderMembers, storeOrderReadResources));
  const readContext = (): GraphReadContext => {
    let failure: Cause.Cause<CommerceTransactionError> | undefined;
    return { refuse: error => Effect.fail(error),
      recordFailure: cause => { failure ??= cause; return Result.succeed(failure); },
      call: Effect.fn("StoreCartRequest.readGroup")(function* (participant, command, args) {
        if (failure !== undefined) return yield* Effect.failCause(failure);
        const host = hosts.get(participant);
        if (host === undefined || !host.commands.has(command)) return yield* commerceError("invalidAuthority");
        return yield* host.read(command, args);
      }),
    };
  };
  const auth = yield* makeStoreRequestReads({ ...input, catalog: input.catalog.auth,
    readSalesChannels: (request, owner) => registry.bind(readContext())(request, owner) });
  const orderReads = yield* prepareStoreOrderReadWorkflows({
    graph: (value, options) => orderGraph.bind(readContext()).nativeGraph(value, options),
    remoteQuery: (value, options) => orderGraph.bind(readContext()).remoteQuery(value, options),
  });
  const generationScope = yield* Effect.scope;
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: input.identityAndAccessPolicy,
    prepare: composition => Scope.provide(generationScope)(Effect.acquireRelease(makeAtomicCommerceNativeHost({ ...composition,
      database: input.database, hostRuntime: input.hostRuntime, bundle: input.catalog.bundle,
      sources: [...input.catalog.nativeSources, input.catalog.paymentAccountSource, ...input.catalog.completionSources],
      eventStorage: { definition: input.catalog.eventDefinition } }), host => host.close)),
  };
  const workflow = yield* prepareCreateCartWorkflow({ execution, modules: input.catalog.modules,
    salesChannelRead: input.catalog.runtimes.salesChannelRead, link: input.catalog.runtimes.link, logger: input.catalog.runtimes.logger,
    revision: input.revision, subscribers: input.subscribers, ...(input.hooks === undefined ? {} : { hooks: input.hooks }) });
  const mutations = yield* prepareCartMutationWorkflows({ execution, modules: input.catalog.modules,
    shippingLinks: input.catalog.shippingLinks,
    salesChannelRead: input.catalog.runtimes.salesChannelRead, link: input.catalog.runtimes.link, logger: input.catalog.runtimes.logger,
    revision: input.revision, subscribers: input.subscribers, ...(input.mutationHooks === undefined ? {} : { hooks: input.mutationHooks }) });
  const promotions = yield* prepareCartPromotionsWorkflow({ execution, modules: input.catalog.modules,
    salesChannelRead: input.catalog.runtimes.salesChannelRead, link: input.catalog.runtimes.link, logger: input.catalog.runtimes.logger,
    revision: input.revision, subscribers: input.subscribers });
  const taxes = yield* prepareCartTaxesWorkflow({ execution, modules: input.catalog.modules,
    salesChannelRead: input.catalog.runtimes.salesChannelRead, revision: input.revision, subscribers: input.subscribers });
  const shipping = yield* prepareCartShippingWorkflows({ execution, modules: input.catalog.modules, shippingLinks: input.catalog.shippingLinks,
    salesChannelRead: input.catalog.runtimes.salesChannelRead, link: input.catalog.runtimes.link, logger: input.catalog.runtimes.logger,
    revision: input.revision, subscribers: input.subscribers });
  const nativeSource = Effect.fn("StoreCartRequest.nativeSource")(function* (name: NativeName) {
    const source = input.catalog.nativeSources.find(source => source.name === name);
    if (source === undefined) return yield* commerceError("invalidAuthority");
    return source.source;
  });
  const paymentRuntimes = input.catalog.paymentRuntimes;
  const payments = yield* prepareStorePaymentWorkflows({ execution, modules: {
    cart: { module: paymentRuntimes.cart.workflow, nativeStorage: yield* nativeSource("cart") },
    payment: { module: input.catalog.runtimes.workflows.payment, nativeStorage: yield* nativeSource("payment") },
    cart_payment_collection_links: { module: paymentRuntimes.cartPaymentCollection.workflow, nativeStorage: yield* nativeSource("cart_payment_collection_links") },
    customer: { module: paymentRuntimes.customer.workflow, nativeStorage: yield* nativeSource("customer") },
    customer_account_holder_links: { module: paymentRuntimes.customerAccountHolder.workflow, nativeStorage: input.catalog.paymentAccountSource.source },
  }, customerAccountLink: paymentRuntimes.customerAccountLink, logger: input.catalog.runtimes.logger,
  revision: input.revision, subscribers: input.subscribers });
  const completion = yield* prepareStoreCompleteCartWorkflow({ execution, modules: input.catalog.completionModules,
    link: input.catalog.completionRuntimes.link, logger: input.catalog.completionRuntimes.logger,
    revision: input.revision, subscribers: input.subscribers });
  const admitOrderRefetchFields = (fields: readonly string[]): void => {
    Result.getOrThrowWith(graph.admitProjection("order", fields), cause => new MedusaError(MedusaError.Types.INVALID_DATA,
      "The private completion profile requires supported Order response fields before execution.", undefined, undefined, { cause }));
  };
  const admitOrderReadFields = (fields: readonly string[], _kind: "detail" | "list"): void => {
    Result.getOrThrowWith(orderGraph.admitProjection("order", fields), cause =>
      new MedusaError(MedusaError.Types.INVALID_DATA, "The private Store Order profile requires supported response fields.", undefined, undefined, { cause }));
  };
  const admitShippingOptionFields = (fields: readonly string[]): void => {
    Result.getOrThrowWith(graph.admitProjection("shipping_options", [...new Set(["id", ...fields])]), cause => new MedusaError(MedusaError.Types.INVALID_DATA,
      "The private Shipping profile requires supported response fields before execution.", undefined, undefined, { cause }));
  };
  const admitCartRefetchFields = (fields: readonly string[]): void => {
    Result.getOrThrowWith(graph.admitProjection("cart", fields), cause => new MedusaError(MedusaError.Types.INVALID_DATA,
      "The private Cart profile requires supported response fields before execution.", undefined, undefined, { cause }));
  };
  const admitPaymentCollectionFields = (fields: readonly string[]): void => {
    const admitted = Result.gen(function* () {
      yield* graph.admitProjection("payment_collection", fields);
      yield* graph.admitProjection("cart_payment_collection", fields.map(field => `payment_collection.${field}`));
    });
    Result.getOrThrowWith(admitted, cause => new MedusaError(MedusaError.Types.INVALID_DATA,
      "The private Payment profile requires supported response fields before execution.", undefined, undefined, { cause }));
  };
  const runWorkflow = Effect.fn("StoreCartRequest.runWorkflow")(function* (name: string, value: unknown) {
    if (name === "get-order-detail") return { result: yield* orderReads.detail(value) };
    if (name === "get-orders-list") return { result: yield* orderReads.list(value) };
    const captured = yield* Effect.fromResult(captureCommerceInput(value));
    switch (name) {
      case "complete-cart": {
        const args = yield* Effect.fromResult(completion.decodeInput(captured));
        return { result: yield* completion.run(completion.newRequestKey(), args) };
      }
      case "create-cart": {
        const args = yield* Effect.fromResult(workflow.decodeInput(captured));
        return { result: yield* workflow.run(workflow.newRequestKey(), args) };
      }
      case "update-cart": {
        const args = yield* Effect.fromResult(mutations.updateCart.decodeInput(captured));
        return { result: yield* mutations.updateCart.run(mutations.updateCart.newRequestKey(), args) };
      }
      case "add-to-cart": {
        const args = yield* Effect.fromResult(mutations.addLineItem.decodeInput(captured));
        return { result: yield* mutations.addLineItem.run(mutations.addLineItem.newRequestKey(), args) };
      }
      case "update-line-item-in-cart": {
        const args = yield* Effect.fromResult(mutations.updateLineItem.decodeInput(captured));
        return { result: yield* mutations.updateLineItem.run(mutations.updateLineItem.newRequestKey(), args) };
      }
      case "delete-line-items": {
        const args = yield* Effect.fromResult(mutations.deleteLineItems.decodeInput(captured));
        return { result: yield* mutations.deleteLineItems.run(mutations.deleteLineItems.newRequestKey(), args) };
      }
      case "update-cart-promotions": {
        const args = yield* Effect.fromResult(promotions.decodeInput(captured));
        return { result: yield* promotions.run(promotions.newRequestKey(), args) };
      }
      case "update-tax-lines": {
        const args = yield* Effect.fromResult(taxes.decodeInput(captured));
        return { result: yield* taxes.run(taxes.newRequestKey(), args) };
      }
      case "list-shipping-options-for-cart": {
        const args = yield* Effect.fromResult(shipping.listShippingOptions.decodeInput(captured));
        return { result: yield* shipping.listShippingOptions.run(shipping.listShippingOptions.newRequestKey(), args) };
      }
      case "add-shipping-method-to-cart": {
        const args = yield* Effect.fromResult(shipping.addShippingMethod.decodeInput(captured));
        return { result: yield* shipping.addShippingMethod.run(shipping.addShippingMethod.newRequestKey(), args) };
      }
      case "create-payment-collection-for-cart": {
        const args = yield* Effect.fromResult(payments.createCollection.decodeInput(captured));
        return { result: yield* payments.createCollection.run(payments.createCollection.newRequestKey(), args) };
      }
      case "create-payment-sessions": {
        const args = yield* Effect.fromResult(payments.createSessions.decodeInput(captured));
        return { result: yield* payments.createSessions.run(payments.createSessions.newRequestKey(), args) };
      }
      default: return yield* commerceError("unsupportedProfile");
    }
  }, presentCartFailure);
  const remoteQuery = Effect.fn("StoreCartRequest.remoteQuery")(function* (value: unknown) {
    const envelope = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(decodeRemoteEnvelope)));
    if (envelope.__value.api_key !== undefined) return yield* auth.remoteQuery(value);
    if (envelope.__value.cart_payment_collection === undefined) yield* Effect.fromResult(decodeCartRemoteRoot(envelope.__value.cart));
    else yield* Effect.fromResult(decodeCollectionLinkRemoteRoot(envelope.__value.cart_payment_collection));
    return yield* graph.bind(readContext()).remoteQuery(envelope);
  }, presentCartFailure);
  const queryGraph = Effect.fn("StoreCartRequest.queryGraph")(function* (value: unknown, options?: unknown) {
    const captured = yield* Effect.fromResult(captureCommerceInput(value));
    if (!commerceEntity(captured)) return yield* auth.query.graph(value, options);
    if (options !== undefined) return yield* commerceError("unsupportedProfile");
    const query = yield* Effect.fromResult(decodeCommerceGraphQuery(captured));
    return yield* graph.bind(readContext()).nativeGraph(query);
  }, presentCartFailure);
  return Object.freeze({ admitCartRefetchFields, admitShippingOptionFields, admitPaymentCollectionFields, admitOrderRefetchFields, admitOrderReadFields, runWorkflow, remoteQuery, query: Object.freeze({ graph: queryGraph }),
    close: Effect.forEach(closures, close => close, { discard: true }).pipe(Effect.ensuring(auth.close), Effect.ensuring(workflow.close), Effect.ensuring(completion.close),
      Effect.ensuring(Effect.forEach(Object.values(mutations), host => host.close, { discard: true })), Effect.ensuring(promotions.close), Effect.ensuring(taxes.close),
      Effect.ensuring(Effect.forEach(Object.values(shipping), host => host.close, { discard: true })),
      Effect.ensuring(Effect.forEach(Object.values(payments), host => host.close, { discard: true }))) });
});
export type StoreCartRequestRuntime = Effect.Success<ReturnType<typeof makeStoreCartRequestRuntime>>;

/** Native Promise callbacks own detached DTOs and retain authoritative full Causes. */
export const makeStoreCartRequestScopeFactory = Effect.fn("StoreCartRequest.makeScopeFactory")(function* (input: Readonly<{
  runtime: StoreCartRequestRuntime; container: AwilixContainer;
}>) {
  const container = yield* Effect.acquireRelease(Effect.sync(() => input.container.createScope().register({
    [Modules.WORKFLOW_ENGINE]: asValue({ run: (name: string, options: Readonly<{ input: unknown; throwOnError?: boolean }>) =>
      name === "complete-cart" && options.throwOnError === false
        ? runCompletedCartRequestPromise(input.runtime.runWorkflow(name, options.input))
        : runProductRequestPromise(input.runtime.runWorkflow(name, options.input)) }),
    remoteQuery: asValue((query: unknown) => runProductRequestPromise(input.runtime.remoteQuery(query))),
    query: asValue({ graph: (query: unknown, options?: unknown) => runProductRequestPromise(input.runtime.query.graph(query, options)) }),
  })), scope => Effect.promise(() => scope.dispose()));
  return Object.freeze({ createRequestScope: (): MedusaRequest["scope"] => container.createScope() });
});
