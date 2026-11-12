import { Cause, Effect, Result, Schema, Scope } from "effect";
import { asValue, type AwilixContainer } from "@medusajs/deps/awilix-portable";
import type { Logger } from "@medusajs/framework/types";
import type { MedusaRequest } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/utils/common/errors";
import { Modules } from "@medusajs/utils/modules-sdk/definition";
import { makeCoreSchemaBundle, type CoreDatabase } from "@flarex/persistence-postgres/internal/core";
import type { PreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { compileCoreNativeEventStorageDefinition, defineAtomicCommerceNativeSource, makeAtomicCommerceNativeHost,
  commerceNativeRegistrations, makeCommerceNativeReadHost, type CommerceInitialization } from "@flarex/persistence-postgres/internal/commerce-native";
import { commerceCommandIdentity, defineAtomicCommerceParticipant, type AtomicCommerceEvents,
  type AtomicCommerceParticipant, type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareLocalGraph } from "../local-graph/query";
import type { GraphReadContext } from "../local-graph/model";
import { cartCreationCoreDefinitions, makeCartCreationRuntimes } from "../workflows/cart/creation-runtimes";
import { cartCreationModuleNames, prepareCartCreationModules } from "../workflows/cart/creation-graph";
import { prepareCreateCartWorkflow, type CartCreationHooks } from "../workflows/cart/create-cart";
import { prepareCartMutationWorkflows, type CartMutationHooks } from "../workflows/cart/mutations";
import { prepareCartPromotionsWorkflow } from "../workflows/cart/promotions";
import { captureInstalledWorkflowModules, type AtomicWorkflowExecution } from "../workflow/host";
import { workflowModuleDefinition } from "../workflow/module";
import { commerceDecoder } from "../value/decoder";
import { ScalarId } from "../repository/scalar-id-read";
import { captureCommerceInput } from "../value/input";
import { compileStoreRequestReadCatalog, makeStoreRequestReads } from "./store-request-reads";
import { runProductRequestPromise } from "./product-request";

type NativeName = typeof cartCreationModuleNames[number];
export type StoreCartRequestInitializations = Readonly<{
  native: Readonly<Record<NativeName, CommerceInitialization>>;
  auth: Parameters<typeof compileStoreRequestReadCatalog>[1];
}>;

/** Definitions and genuine native construction precede source admission. */
export const compileStoreCartRequestCatalog = Effect.fn("StoreCartRequest.compileCatalog")(function* (
  target: Readonly<{ scopeUuid: string; epochUuid: string }>, initialization: StoreCartRequestInitializations, logger: Logger,
) {
  const runtimes = yield* makeCartCreationRuntimes(logger, "cart-mutations");
  const definitions = yield* cartCreationCoreDefinitions(target);
  const nativeSources = [];
  for (const name of cartCreationModuleNames) {
    const logical = workflowModuleDefinition(runtimes.workflows[name])?.logical;
    if (logical === undefined) return yield* commerceError("invalidAuthority");
    const source = yield* Effect.fromResult(defineAtomicCommerceNativeSource(name, definitions[name]));
    nativeSources.push(Object.freeze({ name, definition: definitions[name], source, commands: logical.commands,
      initialization: Object.freeze({ ...initialization.native[name] }) }));
  }
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(Object.fromEntries(nativeSources.map(source =>
    [source.name, { module: runtimes.workflows[source.name], nativeStorage: source.source }])), cartCreationModuleNames));
  const auth = yield* compileStoreRequestReadCatalog(target, initialization.auth);
  const sources = Object.freeze([...nativeSources, ...Object.entries(auth).map(([name, source]) => ({ name, ...source }))]);
  const eventDefinition = yield* compileCoreNativeEventStorageDefinition(target);
  const bundle = yield* makeCoreSchemaBundle({ sources: [...sources.map(source => ({ kind: "native" as const, definition: source.definition })),
    { kind: "native", definition: eventDefinition }] });
  return Object.freeze({ target: Object.freeze({ ...target }), runtimes, modules, nativeSources: Object.freeze(nativeSources), auth, sources, eventDefinition, bundle });
});
export type StoreCartRequestCatalog = Effect.Success<ReturnType<typeof compileStoreCartRequestCatalog>>;

const Scalar = Schema.String.check(Schema.isLengthBetween(1, 256), Schema.isPattern(/^[a-zA-Z_][a-zA-Z0-9_]*$/));
const decodeRelation = commerceDecoder(Scalar, "unsupportedProfile");
const Fields = Schema.Array(Schema.Union([Scalar, Schema.Literal("*")])).check(Schema.isMaxLength(256));
const NodeMember = Schema.Union([Schema.JsonObject, Fields, Schema.Boolean]);
const decodeNode = commerceDecoder(Schema.StructWithRest(Schema.Struct({ fields: Schema.optionalKey(Fields),
  __args: Schema.optionalKey(Schema.Never), isServiceAccess: Schema.optionalKey(Schema.Never) }),
  [Schema.Record(Schema.String, NodeMember)]), "unsupportedProfile");
const decodeCartRemote = commerceDecoder(Schema.Struct({ __value: Schema.Struct({ cart: Schema.StructWithRest(Schema.Struct({
  fields: Fields, isServiceAccess: Schema.Literal(false), __args: Schema.Struct({ filters: Schema.Struct({ id: ScalarId }) }),
}), [Schema.Record(Schema.String, NodeMember)]) }) }), "unsupportedProfile");
const decodeRemoteEnvelope = commerceDecoder(Schema.Struct({ __value: Schema.Record(Schema.Literals(["cart", "api_key"]),
  Schema.optionalKey(Schema.JsonObject)) }), "unsupportedProfile");

const cartSelection = (value: unknown) => Result.gen(function* () {
  const root = (yield* captureCommerceInput(value).pipe(Result.flatMap(decodeCartRemote))).__value.cart;
  const fields = [...root.fields];
  const queue = Object.entries(root).filter(([name]) => !["fields", "__args", "isServiceAccess"].includes(name))
    .map(([name, node]) => ({ name, path: name, node, depth: 1 }));
  for (let index = 0; index < queue.length; index++) {
    const member = queue[index];
    if (member === undefined || member.depth > 8 || queue.length > 256) return yield* Result.fail(commerceError("unsupportedProfile"));
    yield* decodeRelation(member.name);
    const node = yield* decodeNode(member.node);
    const children = Object.entries(node).filter(([name]) => name !== "fields");
    if ((node.fields?.length ?? 0) === 0 && children.length === 0) return yield* Result.fail(commerceError("unsupportedProfile"));
    fields.push(...(node.fields ?? []).map(field => `${member.path}.${field}`));
    if (fields.length > 256) return yield* Result.fail(commerceError("unsupportedProfile"));
    queue.push(...children.map(([name, child]) => ({ name, path: `${member.path}.${name}`, node: child, depth: member.depth + 1 })));
  }
  return { fields, filters: root.__args.filters };
});

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
  const members = [];
  const hosts = new Map<AtomicCommerceParticipant, { readonly commands: ReadonlySet<CommerceCommand>;
    readonly read: (command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError> }>();
  const closures: Effect.Effect<void>[] = [];
  for (const source of input.catalog.nativeSources) {
    const definition = workflowModuleDefinition(selected.modules[source.name].module);
    if (definition === undefined) return yield* commerceError("invalidAuthority");
    const commands = [...new Set(definition.graph.reads.map(read => read.command))];
    const participant = defineAtomicCommerceParticipant(`storeCartRead_${source.name}`);
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
  const auth = yield* makeStoreRequestReads({ ...input, catalog: input.catalog.auth });
  const generationScope = yield* Effect.scope;
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: input.identityAndAccessPolicy,
    prepare: composition => Scope.provide(generationScope)(Effect.acquireRelease(makeAtomicCommerceNativeHost({ ...composition,
      database: input.database, hostRuntime: input.hostRuntime, bundle: input.catalog.bundle, sources: input.catalog.nativeSources,
      eventStorage: { definition: input.catalog.eventDefinition } }), host => host.close)),
  };
  const workflow = yield* prepareCreateCartWorkflow({ execution, modules: input.catalog.modules,
    salesChannelRead: input.catalog.runtimes.salesChannelRead, link: input.catalog.runtimes.link, logger: input.catalog.runtimes.logger,
    revision: input.revision, subscribers: input.subscribers, ...(input.hooks === undefined ? {} : { hooks: input.hooks }) });
  const mutations = yield* prepareCartMutationWorkflows({ execution, modules: input.catalog.modules,
    salesChannelRead: input.catalog.runtimes.salesChannelRead, link: input.catalog.runtimes.link, logger: input.catalog.runtimes.logger,
    revision: input.revision, subscribers: input.subscribers, ...(input.mutationHooks === undefined ? {} : { hooks: input.mutationHooks }) });
  const promotions = yield* prepareCartPromotionsWorkflow({ execution, modules: input.catalog.modules,
    salesChannelRead: input.catalog.runtimes.salesChannelRead, link: input.catalog.runtimes.link, logger: input.catalog.runtimes.logger,
    revision: input.revision, subscribers: input.subscribers });
  const admitCartRefetchFields = (fields: readonly string[]): void => {
    Result.getOrThrowWith(graph.admitProjection("cart", fields), cause => new MedusaError(MedusaError.Types.INVALID_DATA,
      "The private Cart profile requires supported response fields before execution.", undefined, undefined, { cause }));
  };
  const runWorkflow = Effect.fn("StoreCartRequest.runWorkflow")(function* (name: string, value: unknown) {
    const captured = yield* Effect.fromResult(captureCommerceInput(value));
    switch (name) {
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
      default: return yield* commerceError("unsupportedProfile");
    }
  }, presentCartFailure);
  const remoteQuery = Effect.fn("StoreCartRequest.remoteQuery")(function* (value: unknown) {
    const envelope = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(decodeRemoteEnvelope)));
    if (envelope.__value.api_key !== undefined) return yield* auth.remoteQuery(value);
    const query = yield* Effect.fromResult(cartSelection(value));
    yield* Effect.fromResult(graph.admitProjection("cart", query.fields));
    let failure: Cause.Cause<CommerceTransactionError> | undefined;
    const context: GraphReadContext = { refuse: error => Effect.fail(error),
      recordFailure: cause => { failure ??= cause; return Result.succeed(failure); },
      call: Effect.fn("StoreCartRequest.readGroup")(function* (participant, command, args) {
        if (failure !== undefined) return yield* Effect.failCause(failure);
        const host = hosts.get(participant);
        if (host === undefined || !host.commands.has(command)) return yield* commerceError("invalidAuthority");
        return yield* host.read(command, args);
      }),
    };
    return (yield* graph.bind(context).native({ entity: "cart", fields: query.fields, filters: query.filters,
      pagination: { take: 4, skip: 0 } })).data;
  }, presentCartFailure);
  return Object.freeze({ admitCartRefetchFields, runWorkflow, remoteQuery, query: auth.query,
    close: Effect.forEach(closures, close => close, { discard: true }).pipe(Effect.ensuring(auth.close), Effect.ensuring(workflow.close),
      Effect.ensuring(Effect.forEach(Object.values(mutations), host => host.close, { discard: true })), Effect.ensuring(promotions.close)) });
});
export type StoreCartRequestRuntime = Effect.Success<ReturnType<typeof makeStoreCartRequestRuntime>>;

/** Native Promise callbacks own detached DTOs and retain authoritative full Causes. */
export const makeStoreCartRequestScopeFactory = Effect.fn("StoreCartRequest.makeScopeFactory")(function* (input: Readonly<{
  runtime: StoreCartRequestRuntime; container: AwilixContainer;
}>) {
  const container = yield* Effect.acquireRelease(Effect.sync(() => input.container.createScope().register({
    [Modules.WORKFLOW_ENGINE]: asValue({ run: (name: string, options: Readonly<{ input: unknown }>) =>
      runProductRequestPromise(input.runtime.runWorkflow(name, options.input)) }),
    remoteQuery: asValue((query: unknown) => runProductRequestPromise(input.runtime.remoteQuery(query))),
    query: asValue({ graph: (query: unknown, options?: unknown) => runProductRequestPromise(input.runtime.query.graph(query, options)) }),
  })), scope => Effect.promise(() => scope.dispose()));
  return Object.freeze({ createRequestScope: (): MedusaRequest["scope"] => container.createScope() });
});
