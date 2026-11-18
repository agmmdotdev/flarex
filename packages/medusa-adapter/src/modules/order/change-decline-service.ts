import { Effect, Result, Schema } from "effect";
import { OrderChange } from "@medusajs/order/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { defineOrderPersistenceModule } from "./module";
import { captureOrderMetadata } from "./schema";
import { OrderChangeDeclineInput, OrderChangeDeclinePreimage, OrderChangeDeclineRead,
  decodeOrderChangeDeclineInput, decodeOrderChangeDeclinePreimage, decodeOrderChangeDeclineRead } from "./change-decline-input";
import { prepareOrderChangeDeclineRepository } from "./change-decline-repository";
import { orderChangeDeclinePolicy } from "./change-decline-receipt";

const decodeReadArguments = commerceDecoder(Schema.Tuple([OrderChangeDeclineRead.fields.id, OrderChangeDeclineRead.fields.config]), "invalidInput");
const decodeDeclineArguments = commerceDecoder(Schema.Tuple([OrderChangeDeclineInput]), "invalidInput");
const decodeRestoreArguments = commerceDecoder(Schema.Tuple([OrderChangeDeclinePreimage]), "invalidInput");
const decodeNull = commerceDecoder(Schema.Null, "storedCorruption");

/** One existing Change per native root, with a separate exact inverse method.
 * The genuine Order service retains guard and metadata business behavior. */
export const makeOrderChangeDeclineCommands = Effect.fn("OrderChange.declineCommands")(function* () {
  const metadata = yield* captureOrderMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareOrderChangeDeclineRepository(metadata.frame);
    const module = yield* defineOrderPersistenceModule({ name: "flarex-order-change-decline", profile: "order.changeDecline",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message),
          check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: model => model === OrderChange ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ retrieveOrderChange: native.retrieveOrderChange.bind(native), declineOrderChange: native.declineOrderChange.bind(native),
        restoreOrderChangeDecline: native.restoreOrderChangeDecline.bind(native) })
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("OrderChangeDecline.prepare");
    const retrieveForWorkflow = commands.read("orderChangeRetrieveForDecline", prepare(decodeOrderChangeDeclineRead), async ({ service, context }, input) => {
      const result: unknown = await Reflect.apply(service.retrieveOrderChange, service, [input.id, input.config, context]);
      return result;
    });
    const declineForWorkflow = commands.write("orderChangeDecline", prepare(decodeOrderChangeDeclineInput), async ({ service, context }, input) => {
      const result: unknown = await service.declineOrderChange(input, context);
      if (result !== undefined) throw commerceError("storedCorruption");
      return null;
    });
    const restoreForWorkflow = commands.write("orderChangeRestoreDecline", prepare(decodeOrderChangeDeclinePreimage), async ({ service, context }, input) => {
      const result: unknown = await service.restoreOrderChangeDecline(input, context);
      return result;
    });
    const updated = buildModuleResourceEventName({ prefix: Modules.ORDER, objectName: "order_change", action: "updated" });
    const retrieveOrderChange = yield* defineWorkflowMethod({ command: retrieveForWorkflow, arguments: decodeReadArguments,
      encode: ([id, config]) => ({ id, config }), output: prepared.contracts.decodeSelected });
    const declineOrderChange = yield* defineWorkflowMethod({ command: declineForWorkflow, arguments: decodeDeclineArguments,
      encode: ([data]) => data, output: value => decodeNull(value).pipe(Result.map(() => undefined)), moduleEvents: [updated] });
    const restoreOrderChangeDecline = yield* defineWorkflowMethod({ command: restoreForWorkflow, arguments: decodeRestoreArguments,
      encode: ([data]) => data, output: prepared.contracts.decodeOutput, moduleEvents: [updated] });
    const admitted = [retrieveForWorkflow, declineForWorkflow, restoreForWorkflow], policy = orderChangeDeclinePolicy(prepared);
    const workflow = yield* defineWorkflowModule({ name: Modules.ORDER, source: module.description,
      methods: { retrieveOrderChange, declineOrderChange, restoreOrderChangeDecline }, graph: { aliases: [], reads: [] },
      logical: { ...policy, commands: admitted } });
    return { retrieveForWorkflow, declineForWorkflow, restoreForWorkflow, commands: admitted, source: module.description, workflow,
      withService: module.use, prepared, contracts: prepared.contracts, logicalEventPolicy: () => policy };
  }));
});
