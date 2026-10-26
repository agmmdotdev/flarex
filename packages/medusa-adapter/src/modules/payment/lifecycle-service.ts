import { Effect, Result } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { Capture, Payment, PaymentCollection, PaymentSession, Refund, RefundReason } from "@medusajs/payment/models";
import { PaymentModuleService } from "@medusajs/payment/services";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { moduleAliases, relationPaths } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { capturePaymentMetadata, type paymentModels } from "./schema";
import { definePaymentPersistenceModule } from "./module";
import { preparePaymentSessionRepository } from "./repository";
import { paymentWorkflowLogger } from "./logger";
import { paymentLifecyclePolicy } from "./lifecycle-receipt";
import { decodePaymentRead, decodePaymentDelete, decodePaymentDeleteArguments } from "./input";
import { decodePaymentAuthorization, decodePaymentAuthorizationArguments, decodePaymentCapture, decodePaymentCaptureArguments,
  decodePaymentRefund, decodePaymentRefundArguments, decodePaymentRetrieve, decodePaymentRetrieveArguments } from "./lifecycle-input";

export const makePaymentLifecycleCommands = Effect.fn("PaymentAdapter.lifecycleCommands")(function* (logger: Logger) {
  const metadata = yield* capturePaymentMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* preparePaymentSessionRepository(metadata.frame), policy = paymentLifecyclePolicy(prepared);
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
        listAndCountPaymentCollections: native.listAndCountPaymentCollections.bind(native), listAndCountRefundReasons: native.listAndCountRefundReasons.bind(native) }),
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
    const event = (objectName: string, action: string) => buildModuleResourceEventName({ prefix: Modules.PAYMENT, objectName, action });
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
    const admitted = [authorize, capture, refund, cancel, retrieve, session, count, sessionCount, collectionCount, reasonCount];
    const workflow = yield* defineWorkflowModule({ name: Modules.PAYMENT, source: module.description,
      methods: { authorizePaymentSession, capturePayment, refundPayment, cancelPayment, retrievePayment, retrievePaymentSession },
      graph: { aliases: aliases.filter(alias => graphReads.some(read => read.model === alias.model)), reads: graphReads }, logical: { ...policy, commands: admitted } });
    return { authorize, capture, refund, cancel, retrieve, session, count, sessionCount, collectionCount, reasonCount, commands: admitted,
      workflow, loggerResource: yield* paymentWorkflowLogger(logger), withService: module.use, contracts: prepared.contracts, prepared, logicalEventPolicy: () => policy };
  }));
});
