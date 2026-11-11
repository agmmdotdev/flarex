import { Cause, Effect, Result, Schema } from "effect";
import type { Logger } from "@medusajs/framework/types";
import type { CoreDatabase, CoreNativeDefinition } from "@flarex/persistence-postgres/internal/core";
import type { PreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { commerceNativeRegistrations, makeCommerceNativeReadHost, type CommerceInitialization } from "@flarex/persistence-postgres/internal/commerce-native";
import { commerceCommandIdentity, defineAtomicCommerceParticipant, type AtomicCommerceParticipant, type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { GraphModuleDefinition, GraphReadContext } from "../local-graph/model";
import { prepareLocalGraph } from "../local-graph/query";
import { makeStoreCartReadCommands } from "../modules/store/cart-read-service";
import { compileStoreCoreDefinition } from "../modules/store/schema";
import { makeLocalRegionCartReadCommands } from "../modules/region/cart-read-service";
import { compileRegionCoreDefinition } from "../modules/region/schema";
import { makeCartCheckoutCommands } from "../modules/cart/payment-service";
import { compileCartCoreDefinition } from "../modules/cart/creation-schema";
import { makeCustomerStoreProductReadCommands } from "../modules/customer/store-product-read";
import { compileCustomerCoreDefinition } from "../modules/customer/schema";
import { prepareSalesChannelLocationLink } from "../links/sales-channel-location-service";
import { compileSalesChannelLocationLinkCoreDefinition } from "../links/sales-channel-location-schema";
import { makeTaxLinesCommands } from "../modules/tax/service";
import { compileTaxCoreDefinition } from "../modules/tax/schema";
import { decodeTaxLinesArguments, decodeTaxLinesOutput } from "../modules/tax/input";
import { workflowModuleDefinition } from "../workflow/module";
import { captureWorkflowCommandInput, captureWorkflowInput } from "../workflow/value";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { ScalarId } from "../repository/scalar-id-read";

const names = ["store", "region", "cart", "customer", "salesChannelLocation", "tax"] as const;
type Name = typeof names[number];
export type StoreProductContextInitializations = Readonly<Record<Name, CommerceInitialization>>;
export interface StoreProductContextReadSource {
  readonly name: Name;
  readonly definition: CoreNativeDefinition;
  readonly initialization: CommerceInitialization;
  readonly commands: readonly CommerceCommand[];
  readonly graph: GraphModuleDefinition;
}
export interface StoreProductContextReadMember {
  readonly source: StoreProductContextReadSource;
  readonly participant: AtomicCommerceParticipant;
  readonly module: GraphModuleDefinition;
  readonly commands: readonly CommerceCommand[];
}

/** Compile the six existing source owners before Core construction. Deployment
 * owns installation and the supplied initialization receipts. */
export const compileStoreProductContextReadCatalog = Effect.fn("StoreProductContextReads.compileCatalog")(function* (
  target: Readonly<{ scopeUuid: string; epochUuid: string }>,
  initialization: StoreProductContextInitializations,
  logger: Logger,
) {
  const store = yield* makeStoreCartReadCommands(), region = yield* makeLocalRegionCartReadCommands(),
    cart = yield* makeCartCheckoutCommands(), customer = yield* makeCustomerStoreProductReadCommands(),
    salesChannelLocation = yield* prepareSalesChannelLocationLink(), tax = yield* makeTaxLinesCommands(logger);
  const cartModule = workflowModuleDefinition(cart.workflow);
  if (cartModule === undefined) return yield* commerceError("invalidAuthority");
  const cartRead = cartModule.graph.reads.find(read => read.model === "Cart");
  if (cartRead === undefined || cartRead.command !== cart.count) return yield* commerceError("invalidAuthority");
  const cartGraph = { ...cartModule.graph, aliases: cartModule.graph.aliases.filter(alias => alias.model === "Cart"), reads: [cartRead] };
  const source = (name: Name, definition: CoreNativeDefinition, commands: readonly CommerceCommand[], graph: GraphModuleDefinition): StoreProductContextReadSource =>
    Object.freeze({ name, definition, initialization: Object.freeze({ ...initialization[name] }), commands: Object.freeze([...commands]), graph });
  const sources = Object.freeze({
    store: source("store", yield* compileStoreCoreDefinition(target), [store.count], store.graph),
    region: source("region", yield* compileRegionCoreDefinition(target), [region.count], region.graph),
    cart: source("cart", yield* compileCartCoreDefinition(target), [cart.count], cartGraph),
    customer: source("customer", yield* compileCustomerCoreDefinition(target), customer.commands, customer.graph),
    salesChannelLocation: source("salesChannelLocation", yield* compileSalesChannelLocationLinkCoreDefinition(target),
      [salesChannelLocation.count], salesChannelLocation.graph),
    tax: source("tax", yield* compileTaxCoreDefinition(target), [tax.getTaxLines], { aliases: [], reads: [] }),
  });
  const members: readonly StoreProductContextReadMember[] = names.map(name => ({ source: sources[name],
    participant: defineAtomicCommerceParticipant(`storeProductContext_${name}`), module: sources[name].graph, commands: sources[name].commands }));
  const graph = yield* Effect.fromResult(prepareLocalGraph(members.filter(member => member.source.name !== "tax")));
  return Object.freeze({ sources, members: Object.freeze(members), graph, taxCommand: tax.getTaxLines });
});
export type StoreProductContextReadCatalog = Effect.Success<ReturnType<typeof compileStoreProductContextReadCatalog>>;

const Ids = Schema.Union([ScalarId, Schema.Array(ScalarId).check(Schema.isLengthBetween(1, 8))]);
const Pagination = Schema.optionalKey(Schema.Struct({ take: Schema.Literal(4), skip: Schema.optionalKey(Schema.Literal(0)) }));
const decodeContextQuery = commerceDecoder(Schema.Union([
  Schema.Struct({ entity: Schema.Literal("cart"), fields: Schema.Array(Schema.Literals(["region_id", "shipping_address.*"])).check(Schema.isLengthBetween(1, 2), Schema.isUnique()),
    filters: Schema.Struct({ id: ScalarId }), pagination: Pagination }),
  Schema.Struct({ entity: Schema.Literal("store"), fields: Schema.Array(Schema.Literals(["id", "default_region_id"])).check(Schema.isLengthBetween(1, 2), Schema.isUnique()),
    filters: Schema.optionalKey(Schema.Record(Schema.String, Schema.Never)), pagination: Pagination }),
  Schema.Struct({ entity: Schema.Literal("region"), fields: Schema.Array(Schema.Literals(["id", "currency_code", "automatic_taxes"])).check(Schema.isLengthBetween(1, 3), Schema.isUnique()),
    filters: Schema.Struct({ id: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))) }), pagination: Pagination }),
  Schema.Struct({ entity: Schema.Literal("customer_group"), fields: Schema.Tuple([Schema.Literal("id")]),
    filters: Schema.Struct({ customers: Schema.Struct({ id: ScalarId }) }), pagination: Pagination }),
  Schema.Struct({ entity: Schema.Literal("sales_channel_locations"), fields: Schema.Tuple([Schema.Literal("stock_location_id")]),
    filters: Schema.Struct({ sales_channel_id: Ids }) }),
]), "unsupportedProfile");
export const decodeStoreProductContextQuery = (value: unknown) => captureCommerceInput(value).pipe(Result.flatMap(decodeContextQuery));
const decodeOptions = commerceDecoder(Schema.Struct({
  cache: Schema.optionalKey(Schema.Struct({ enable: Schema.optionalKey(Schema.Boolean),
    tags: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 512))).check(Schema.isMaxLength(8))) })),
  throwIfKeyNotFound: Schema.optionalKey(Schema.Boolean),
}), "unsupportedProfile");

/** Own read hosts for this live Core generation. These sources do not acquire
 * persistence authority during a request or expose workflow mutation facades. */
export const makeStoreProductContextReads = Effect.fn("StoreProductContextReads.make")(function* (input: Readonly<{
  database: CoreDatabase; hostRuntime: PreparedHostRuntime; catalog: StoreProductContextReadCatalog; identityAndAccessPolicy: Json;
}>) {
  const hosts = new Map<AtomicCommerceParticipant, { readonly commands: ReadonlySet<CommerceCommand>;
    readonly read: (command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError> }>();
  const members = [], closures: Effect.Effect<void>[] = [];
  for (const member of input.catalog.members) {
    const commands = [...member.commands];
    if (commands.length === 0 || commands.some(command => commerceCommandIdentity(command)?.mode !== "read"))
      return yield* commerceError("invalidAuthority");
    const binding = yield* input.database.bindNative({ definition: member.source.definition,
      commands: yield* Effect.fromResult(commerceNativeRegistrations(commands, { readOnly: true })) });
    const host = yield* Effect.acquireRelease(makeCommerceNativeReadHost({ database: input.database, binding,
      hostRuntime: input.hostRuntime, commands, initialization: member.source.initialization,
      identityAndAccessPolicy: input.identityAndAccessPolicy }), acquired => acquired.close);
    hosts.set(member.participant, { commands: new Set(commands), read: host.read });
    members.push(Object.freeze({ ...member, read: host.read })); closures.push(host.close);
  }
  const taxHost = members.find(member => member.source.name === "tax");
  if (taxHost === undefined) return yield* commerceError("invalidAuthority");
  const getTaxLines = Effect.fn("StoreProductContextReads.getTaxLines")(function* (...args: readonly unknown[]) {
    const [items, context] = yield* Effect.fromResult(captureWorkflowInput(args, "preserveOwnUndefined").pipe(Result.flatMap(decodeTaxLinesArguments)));
    const envelope = yield* Effect.fromResult(captureWorkflowCommandInput({ items, context }));
    return yield* Effect.fromResult(decodeTaxLinesOutput(yield* taxHost.read(input.catalog.taxCommand, envelope)));
  });
  const graph = Effect.fn("StoreProductContextReads.graph")(function* (value: unknown, options?: unknown) {
    const query = yield* Effect.fromResult(decodeStoreProductContextQuery(value));
    const checked = options === undefined ? undefined
      : yield* Effect.fromResult(captureCommerceInput(options).pipe(Result.flatMap(decodeOptions)));
    let failure: Cause.Cause<CommerceTransactionError> | undefined;
    const context: GraphReadContext = {
      refuse: error => Effect.fail(error),
      recordFailure: cause => { failure ??= cause; return Result.succeed(failure); },
      call: Effect.fn("StoreProductContextReads.readGroup")(function* (participant, command, args) {
        if (failure !== undefined) return yield* Effect.failCause(failure);
        const host = hosts.get(participant);
        if (host === undefined || !host.commands.has(command)) return yield* commerceError("invalidAuthority");
        return yield* host.read(command, args);
      }),
    };
    // Cache hints remain advisory; all data is read through the protected host.
    const result = yield* input.catalog.graph.bind(context).graph({ entity: query.entity, fields: [...query.fields],
      filters: query.filters ?? {}, pagination: { take: query.entity === "sales_channel_locations" ? 256 : 4, skip: 0 } },
    checked?.throwIfKeyNotFound === true ? { throwIfKeyNotFound: true } : undefined);
    if (result.data.length !== result.metadata.count) return yield* commerceError("limitExceeded");
    return result;
  });
  return Object.freeze({ sources: input.catalog.sources, members: Object.freeze(members), query: Object.freeze({ graph }),
    tax: Object.freeze({ getTaxLines }), close: Effect.forEach(closures, close => close, { discard: true }) });
});
export type StoreProductContextReads = Effect.Success<ReturnType<typeof makeStoreProductContextReads>>;
