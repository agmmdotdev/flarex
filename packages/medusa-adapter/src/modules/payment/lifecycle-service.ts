import { Effect, Result, Schema } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { Capture, Payment, PaymentCollection, PaymentSession, Refund, RefundReason } from "@medusajs/payment/models";
import { PaymentModuleService } from "@medusajs/payment/services";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { moduleAliases, relationPaths } from "../../local-graph/module";
import { localGraphDirectPath } from "../../local-graph/direct-paths";
import { decodeGraphCount } from "../../local-graph/query";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { capturePaymentMetadata, type paymentModels } from "./schema";
import { definePaymentPersistenceModule } from "./module";
import { preparePaymentSessionRepository } from "./repository";
import { paymentWorkflowLogger } from "./logger";
import { paymentCollectionPolicy } from "./collection-receipt";
import { decodePaymentRead, decodePaymentDelete, decodePaymentDeleteArguments, decodePaymentReadArguments,
  decodePaymentCreate, decodePaymentCreateArguments } from "./input";
import { decodeCollectionCreateArguments, decodeCollectionDeleteArguments, decodeCollectionUpdateArguments, decodeCollectionUpsertArguments,
  decodeCollectionCreates, decodeCollectionIds, decodeCollectionUpdate, decodeCollectionUpserts } from "./collection-input";
import { commerceDecoder } from "../../value/decoder";
import { decodeGraphList } from "../../local-graph/query";
import { decodePaymentAuthorization, decodePaymentAuthorizationArguments, decodePaymentCapture, decodePaymentCaptureArguments,
  decodePaymentRefund, decodePaymentRefundArguments, decodePaymentRetrieve, decodePaymentRetrieveArguments } from "./lifecycle-input";

export const makePaymentLifecycleCommands = Effect.fn("PaymentAdapter.lifecycleCommands")(function* (logger: Logger) {
  const metadata = yield* capturePaymentMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* preparePaymentSessionRepository(metadata.frame), policy = paymentCollectionPolicy(prepared);
    const module = yield* definePaymentPersistenceModule({ name: "flarex-payment-lifecycle", profile: "payment.system-lifecycle",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources, capture: message => bound.bridge.current().captureLocalEvent(message),
          check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.collectionRepository, events: bound.mutationEvents, eventBus,
          repository: (model: typeof paymentModels[number]) => model === PaymentCollection ? bound.collectionRepository :
            model === PaymentSession ? bound.sessionRepository : model === Payment ? bound.paymentRepository :
              model === Capture ? bound.captureRepository : model === Refund ? bound.refundRepository : model === RefundReason ? bound.reasonRepository : bound.denied };
      }, service: native => ({ authorizePaymentSession: native.authorizePaymentSession.bind(native), capturePayment: native.capturePayment.bind(native),
        refundPayment: native.refundPayment.bind(native), cancelPayment: native.cancelPayment.bind(native),
        retrievePayment: native.retrievePayment.bind(native), retrievePaymentSession: native.retrievePaymentSession.bind(native),
        listAndCountPayments: native.listAndCountPayments.bind(native), listAndCountPaymentSessions: native.listAndCountPaymentSessions.bind(native),
        listAndCountPaymentCollections: native.listAndCountPaymentCollections.bind(native), listAndCountRefundReasons: native.listAndCountRefundReasons.bind(native),
        createPaymentCollections: native.createPaymentCollections.bind(native), listPaymentCollections: native.listPaymentCollections.bind(native),
        updatePaymentCollections: native.updatePaymentCollections.bind(native), upsertPaymentCollections: native.upsertPaymentCollections.bind(native),
        deletePaymentCollections: native.deletePaymentCollections.bind(native), createPaymentSession: native.createPaymentSession.bind(native),
        deletePaymentSession: native.deletePaymentSession.bind(native), listPaymentSessions: native.listPaymentSessions.bind(native) }),
    }, logger).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("PaymentLifecycle.prepare");
    const authorize = commands.write("paymentSessionAuthorizeForWorkflow", prepare(decodePaymentAuthorization),
      ({ service, context }, input) => service.authorizePaymentSession(input.id, input.context ?? {}, context));
    const capture = commands.write("paymentCaptureForWorkflow", prepare(decodePaymentCapture),
      ({ service, context }, input) => service.capturePayment(input, context));
    const refund = commands.write("paymentRefundForWorkflow", prepare(decodePaymentRefund),
      ({ service, context }, input) => service.refundPayment(input, context));
    const cancel = commands.write("paymentCancelForWorkflow", prepare(decodePaymentDelete),
      ({ service, context }, id) => service.cancelPayment(id, context));
    const retrieve = commands.read("paymentRetrieveForWorkflow", prepare(decodePaymentRetrieve),
      ({ service, context }, input) => service.retrievePayment(input.id, input.config ?? {}, context));
    const session = commands.read("paymentSessionRetrieveForAuthorization", prepare(decodePaymentRetrieve),
      ({ service, context }, input) => service.retrievePaymentSession(input.id, input.config ?? {}, context));
    const count = commands.read("paymentCountForLifecycle", prepare(decodePaymentRead),
      ({ service, context }, input) => service.listAndCountPayments(input.filters ?? {}, input.config ?? {}, context));
    const sessionCount = commands.read("paymentSessionCountForLifecycle", prepare(decodePaymentRead),
      ({ service, context }, input) => service.listAndCountPaymentSessions(input.filters ?? {}, input.config ?? {}, context));
    const collectionCount = commands.read("paymentCollectionCountForLifecycle", prepare(decodePaymentRead),
      ({ service, context }, input) => service.listAndCountPaymentCollections(input.filters ?? {}, input.config ?? {}, context));
    const reasonCount = commands.read("refundReasonCountForLifecycle", prepare(decodePaymentRead),
      ({ service, context }, input) => service.listAndCountRefundReasons(input.filters ?? {}, input.config ?? {}, context));
    const creates = commands.write("paymentCollectionsCreate", prepare(decodeCollectionCreates),
      ({ service, context }, input) => service.createPaymentCollections(input, context));
    const updates = commands.write("paymentCollectionsUpdate", prepare(decodeCollectionUpdate),
      // Native DTO metadata omits null, while the DML and retained preimages
      // include it. The command schema and complete-row receipt own this ABI.
      async ({ service, context }, input) => await Reflect.apply(service.updatePaymentCollections, service, [input.selector, input.update, context]));
    const upserts = commands.write("paymentCollectionsUpsert", prepare(decodeCollectionUpserts),
      async ({ service, context }, input) => await Reflect.apply(service.upsertPaymentCollections, service, [input, context]));
    const deletes = commands.write("paymentCollectionsDelete", prepare(decodeCollectionIds),
      async ({ service, context }, input) => { await service.deletePaymentCollections(input, context); return null; });
    const collections = commands.read("paymentCollectionsList", prepare(decodePaymentRead),
      ({ service, context }, input) => service.listPaymentCollections(input.filters ?? {}, input.config ?? {}, context));
    const sessionCreate = commands.write("paymentSessionCreateForWorkflow", prepare(decodePaymentCreate),
      ({ service, context }, { payment_collection_id, ...data }) => service.createPaymentSession(payment_collection_id, data, context));
    const sessionDelete = commands.write("paymentSessionDeleteForWorkflow", prepare(decodePaymentDelete),
      async ({ service, context }, input) => { await service.deletePaymentSession(input, context); return null; });
    const sessions = commands.read("paymentSessionListForWorkflow", prepare(decodePaymentRead),
      ({ service, context }, input) => service.listPaymentSessions(input.filters ?? {}, input.config ?? {}, context));
    const event = (objectName: string, action: string) => buildModuleResourceEventName({ prefix: Modules.PAYMENT, objectName, action });
    const createPaymentCollections = yield* defineWorkflowMethod({ command: creates,
      arguments: decodeCollectionCreateArguments, encode: ([input]) => input,
      output: decodeGraphList, moduleEvents: [event("payment_collection", "created")] });
    const updatePaymentCollections = yield* defineWorkflowMethod({ command: updates,
      arguments: decodeCollectionUpdateArguments,
      encode: ([selector, update]) => ({ selector, update }), output: decodeGraphList, moduleEvents: [event("payment_collection", "updated")] });
    const upsertPaymentCollections = yield* defineWorkflowMethod({ command: upserts,
      arguments: decodeCollectionUpsertArguments, encode: ([input]) => input,
      output: decodeGraphList, moduleEvents: [event("payment_collection", "updated")] });
    const decodeNull = commerceDecoder(Schema.Null, "storedCorruption");
    const deletePaymentCollections = yield* defineWorkflowMethod({ command: deletes,
      arguments: decodeCollectionDeleteArguments, encode: ([input]) => input,
      output: input => decodeNull(input).pipe(Result.map(() => undefined)), moduleEvents: [event("payment_collection", "deleted")] });
    const encodeRead = ([filters, config]: Result.Result.Success<ReturnType<typeof decodePaymentReadArguments>>) =>
      ({ ...(filters === undefined ? {} : { filters }), ...(config === undefined ? {} : { config }) });
    const listPaymentCollections = yield* defineWorkflowMethod({ command: collections, arguments: decodePaymentReadArguments, encode: encodeRead, output: decodeGraphList });
    const createPaymentSession = yield* defineWorkflowMethod({ command: sessionCreate, arguments: decodePaymentCreateArguments,
      encode: ([payment_collection_id, data]) => ({ payment_collection_id, ...data }), output: prepared.contracts.decodeSessionOutput,
      moduleEvents: [event("payment_session", "created"), event("payment_session", "updated")] });
    const deletePaymentSession = yield* defineWorkflowMethod({ command: sessionDelete, arguments: decodePaymentDeleteArguments,
      encode: ([id]) => id, output: input => decodeNull(input).pipe(Result.map(() => undefined)), moduleEvents: [event("payment_session", "deleted")] });
    const listPaymentSessions = yield* defineWorkflowMethod({ command: sessions, arguments: decodePaymentReadArguments, encode: encodeRead, output: decodeGraphList });
    const authorizePaymentSession = yield* defineWorkflowMethod({ command: authorize, arguments: decodePaymentAuthorizationArguments,
      encode: ([id, context]) => ({ id, context }), output: prepared.contracts.decodePaymentOutput,
      moduleEvents: [event("payment_session", "updated"), event("payment", "created"), event("payment_collection", "updated"), event("capture", "created"), event("payment", "updated")] });
    const capturePayment = yield* defineWorkflowMethod({ command: capture, arguments: decodePaymentCaptureArguments,
      encode: ([input]) => input, output: prepared.contracts.decodePaymentOutput,
      moduleEvents: [event("capture", "created"), event("capture", "deleted"), event("payment", "updated"), event("payment_collection", "updated")] });
    const refundPayment = yield* defineWorkflowMethod({ command: refund, arguments: decodePaymentRefundArguments,
      encode: ([input]) => input, output: prepared.contracts.decodePaymentOutput,
      moduleEvents: [event("refund", "created"), event("refund", "deleted"), event("payment", "updated"), event("payment_collection", "updated")] });
    const cancelPayment = yield* defineWorkflowMethod({ command: cancel, arguments: decodePaymentDeleteArguments,
      encode: ([id]) => id, output: prepared.contracts.decodePaymentOutput, moduleEvents: [event("payment", "updated")] });
    const encodeRetrieve = ([id, config]: Result.Result.Success<ReturnType<typeof decodePaymentRetrieveArguments>>) => ({ id, ...(config === undefined ? {} : { config }) });
    const retrievePayment = yield* defineWorkflowMethod({ command: retrieve, arguments: decodePaymentRetrieveArguments, encode: encodeRetrieve,
      output: prepared.contracts.decodePaymentOutput });
    const retrievePaymentSession = yield* defineWorkflowMethod({ command: session, arguments: decodePaymentRetrieveArguments, encode: encodeRetrieve,
      output: prepared.contracts.decodeSessionOutput });
    const aliases = yield* moduleAliases(PaymentModuleService.prototype.__joinerConfig());
    const graphReads: Array<GraphModuleDefinition["reads"][number]> = [];
    for (const [model, table, command, paths] of [
      ["Payment", prepared.contracts.payment, count, ["captures", "refunds", "payment_collection"]],
      ["PaymentSession", prepared.contracts.session, sessionCount, ["payment", "payment.captures"]],
      ["PaymentCollection", prepared.contracts.collection, collectionCount, ["payment_sessions", "payments", "payments.captures", "payments.refunds"]],
      ["RefundReason", prepared.contracts.reason, reasonCount, []],
    ] as const) graphReads.push({ model, command, table: yield* prepared.catalog.table(table.name), paths: yield* relationPaths(prepared.catalog, table.name, paths),
      selectedFieldsOnly: true, orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount });
    const admitted = [authorize, capture, refund, cancel, retrieve, session, count, sessionCount, collectionCount, reasonCount,
      creates, updates, upserts, deletes, collections, sessionCreate, sessionDelete, sessions];
    const workflow = yield* defineWorkflowModule({ name: Modules.PAYMENT, source: module.description,
      methods: { authorizePaymentSession, capturePayment, refundPayment, cancelPayment, retrievePayment, retrievePaymentSession,
        createPaymentCollections, updatePaymentCollections, upsertPaymentCollections, deletePaymentCollections, listPaymentCollections,
        createPaymentSession, deletePaymentSession, listPaymentSessions },
      graph: { aliases: aliases.filter(alias => graphReads.some(read => read.model === alias.model)), reads: graphReads }, logical: { ...policy, commands: admitted } });
    const cartCollectionWorkflow = yield* defineWorkflowModule({ name: Modules.PAYMENT,
      source: { ...module.description, profile: "payment.cart-collection-lifecycle" },
      methods: { createPaymentCollections, updatePaymentCollections, upsertPaymentCollections, deletePaymentCollections, listPaymentCollections,
        createPaymentSession, deletePaymentSession, listPaymentSessions },
      graph: { aliases: aliases.filter(alias => graphReads.some(read => read.model === alias.model)), reads: graphReads,
        directPaths: [yield* localGraphDirectPath(prepared.catalog, prepared.contracts.collection.name, "PaymentCollection", "PaymentSession", "payment_sessions", {
          root: "Cart", path: "payment_collection.payment_sessions", maximumSources: 4, maximumTargets: 4, maximumPerSource: 4,
        })] }, logical: { ...policy, commands: admitted } });
    return { cartCollectionWorkflow, authorize, capture, refund, cancel, retrieve, session, count, sessionCount, collectionCount, reasonCount,
      creates, updates, upserts, deletes, collections, sessionCreate, sessionDelete, sessions, commands: admitted,
      workflow, loggerResource: yield* paymentWorkflowLogger(logger), withService: module.use, contracts: prepared.contracts, prepared, logicalEventPolicy: () => policy };
  }));
});
