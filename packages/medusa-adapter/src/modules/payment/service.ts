import { Effect, Result, Schema } from "effect";
import { PaymentCollection, PaymentSession } from "@medusajs/payment/models";
import { PaymentModuleService } from "@medusajs/payment/services";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { Logger } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { defineComposedWorkflowResource } from "../../workflow/composed-resource";
import { moduleAliases, relationPaths } from "../../local-graph/module";
import { decodeGraphCount, decodeGraphList } from "../../local-graph/query";
import { commerceDecoder } from "../../value/decoder";
import { capturePaymentMetadata, type paymentModels } from "./schema";
import { definePaymentPersistenceModule } from "./module";
import { preparePaymentSessionRepository } from "./repository";
import { paymentSessionPolicy } from "./receipt";
import { decodePaymentCreate, decodePaymentCollectionCreate, decodePaymentDelete, decodePaymentRead,
  decodePaymentCreateArguments, decodePaymentDeleteArguments, decodePaymentReadArguments, PaymentCollectionCreate } from "./input";

const decodeNull = commerceDecoder(Schema.Null, "storedCorruption");
const decodeCollectionCreateArguments = commerceDecoder(Schema.Tuple([PaymentCollectionCreate]), "invalidInput");

export const makePaymentSessionCommands = Effect.fn("PaymentAdapter.sessionCommands")(function* (logger: Logger) {
  const metadata = yield* capturePaymentMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* preparePaymentSessionRepository(metadata.frame), policy = paymentSessionPolicy(prepared);
    const module = yield* definePaymentPersistenceModule({ bind: (ctx, owner) => {
      const bound = prepared.bind(ctx, owner);
      const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
        capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
      return { baseRepository: bound.collectionRepository, events: bound.mutationEvents, eventBus,
        repository: (model: typeof paymentModels[number]) =>
          model === PaymentCollection ? bound.collectionRepository : model === PaymentSession ? bound.sessionRepository : bound.denied };
    }, service: native => ({ createPaymentCollections: native.createPaymentCollections.bind(native),
      listAndCountPaymentCollections: native.listAndCountPaymentCollections.bind(native),
      createPaymentSession: native.createPaymentSession.bind(native), deletePaymentSession: native.deletePaymentSession.bind(native),
      listPaymentSessions: native.listPaymentSessions.bind(native) }) }, logger).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("PaymentSession.prepare");
    const createCollection = commands.write("paymentCollectionCreateForWorkflow", prepare(decodePaymentCollectionCreate),
      ({ service, context }, input) => service.createPaymentCollections(input, context));
    const create = commands.write("paymentSessionCreateForWorkflow", prepare(decodePaymentCreate),
      ({ service, context }, { payment_collection_id, ...data }) => service.createPaymentSession(payment_collection_id, data, context));
    const remove = commands.write("paymentSessionDeleteForWorkflow", prepare(decodePaymentDelete), async ({ service, context }, id) => {
      const value = await service.deletePaymentSession(id, context);
      if (value !== undefined) throw commerceError("storedCorruption"); return null;
    });
    const list = commands.read("paymentSessionListForWorkflow", prepare(decodePaymentRead),
      ({ service, context }, input) => service.listPaymentSessions(input.filters ?? {}, input.config ?? {}, context));
    const count = commands.read("paymentCollectionCountForSessions", prepare(decodePaymentRead),
      ({ service, context }, input) => service.listAndCountPaymentCollections(input.filters ?? {}, input.config ?? {}, context));
    const created = buildModuleResourceEventName({ prefix: Modules.PAYMENT, objectName: "payment_session", action: "created" });
    const updated = buildModuleResourceEventName({ prefix: Modules.PAYMENT, objectName: "payment_session", action: "updated" });
    const deleted = buildModuleResourceEventName({ prefix: Modules.PAYMENT, objectName: "payment_session", action: "deleted" });
    const createPaymentSession = yield* defineWorkflowMethod({ command: create, arguments: decodePaymentCreateArguments,
      encode: ([payment_collection_id, data]) => ({ payment_collection_id, ...data }), output: prepared.contracts.decodeSession, moduleEvents: [created, updated] });
    const createPaymentCollections = yield* defineWorkflowMethod({ command: createCollection, arguments: decodeCollectionCreateArguments,
      encode: ([data]) => data, output: prepared.contracts.decodeCreatedCollection,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.PAYMENT, objectName: "payment_collection", action: "created" })] });
    const deletePaymentSession = yield* defineWorkflowMethod({ command: remove, arguments: decodePaymentDeleteArguments,
      encode: ([id]) => id, output: value => decodeNull(value).pipe(Result.map(() => undefined)), moduleEvents: [deleted] });
    const listPaymentSessions = yield* defineWorkflowMethod({ command: list, arguments: decodePaymentReadArguments,
      encode: ([filters, config]) => ({ ...(filters === undefined ? {} : { filters }), ...(config === undefined ? {} : { config }) }), output: decodeGraphList });
    const table = yield* prepared.catalog.table(prepared.contracts.collection.name);
    const joiner = PaymentModuleService.prototype.__joinerConfig();
    const graph = { aliases: (yield* moduleAliases(joiner)).filter(alias => alias.model === "PaymentCollection"),
      reads: [{ model: "PaymentCollection", command: count, table, paths: yield* relationPaths(prepared.catalog, table.name, ["payment_sessions"]),
        orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] };
    const admitted = [createCollection, create, remove, list, count];
    const workflow = yield* defineWorkflowModule({ name: Modules.PAYMENT, source: module.description,
      methods: { createPaymentCollections, createPaymentSession, deletePaymentSession, listPaymentSessions }, graph, logical: { ...policy, commands: admitted } });
    const logMethods = { error: { arguments: commerceDecoder(Schema.Tuple([Schema.String]), "invalidInput"), output: decodeNull } };
    const loggerResource = yield* defineComposedWorkflowResource<typeof logMethods>({ identity: { profile: "payment-session-logger" }, dependencies: [],
      methods: logMethods, bind: () => ({ error: async message => { logger.error(message); return null; } }) });
    return { createCollection, create, remove, list, count, commands: admitted, workflow, loggerResource,
      withService: module.use, contracts: prepared.contracts, logicalEventPolicy: () => policy };
  }));
});
