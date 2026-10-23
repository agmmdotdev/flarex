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
import { OrderChangeCancellationInput, OrderChangeCancellationPreimage, OrderChangeCancellationRead,
  decodeOrderChangeCancellationInput, decodeOrderChangeCancellationPreimage, decodeOrderChangeCancellationRead } from "./change-cancellation-input";
import { prepareOrderChangeCancellationRepository } from "./change-cancellation-repository";
import { orderChangeCancellationPolicy } from "./change-cancellation-receipt";

const decodeReadArguments = commerceDecoder(Schema.Tuple([OrderChangeCancellationRead.fields.id, OrderChangeCancellationRead.fields.config]), "invalidInput");
const decodeCancelArguments = commerceDecoder(Schema.Tuple([OrderChangeCancellationInput]), "invalidInput");
const decodeRestoreArguments = commerceDecoder(Schema.Tuple([OrderChangeCancellationPreimage]), "invalidInput");
const decodeNull = commerceDecoder(Schema.Null, "storedCorruption");

/** One existing Change per native root, with a separate exact inverse method.
 * The genuine Order service retains guard and metadata business behavior. */
export const makeOrderChangeCancellationCommands = Effect.fn("OrderChange.cancellationCommands")(function* () {
  const metadata = yield* captureOrderMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareOrderChangeCancellationRepository(metadata.frame);
    const module = yield* defineOrderPersistenceModule({ name: "flarex-order-change-cancellation", profile: "order.changeCancellation",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message),
          check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: model => model === OrderChange ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ retrieveOrderChange: native.retrieveOrderChange.bind(native), cancelOrderChange: native.cancelOrderChange.bind(native),
        restoreOrderChangeCancellation: native.restoreOrderChangeCancellation.bind(native) })
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("OrderChangeCancellation.prepare");
    const retrieveForWorkflow = commands.read("orderChangeRetrieveForCancellation", prepare(decodeOrderChangeCancellationRead), async ({ service, context }, input) => {
      const result: unknown = await Reflect.apply(service.retrieveOrderChange, service, [input.id, input.config, context]);
      return result;
    });
    const cancelForWorkflow = commands.write("orderChangeCancel", prepare(decodeOrderChangeCancellationInput), async ({ service, context }, input) => {
      const result: unknown = await service.cancelOrderChange(input, context);
      if (result !== undefined) throw commerceError("storedCorruption");
      return null;
    });
    const restoreForWorkflow = commands.write("orderChangeRestoreCancellation", prepare(decodeOrderChangeCancellationPreimage), async ({ service, context }, input) => {
      const result: unknown = await service.restoreOrderChangeCancellation(input, context);
      return result;
    });
    const updated = buildModuleResourceEventName({ prefix: Modules.ORDER, objectName: "order_change", action: "updated" });
    const retrieveOrderChange = yield* defineWorkflowMethod({ command: retrieveForWorkflow, arguments: decodeReadArguments,
      encode: ([id, config]) => ({ id, config }), output: prepared.contracts.decodeSelected });
    const cancelOrderChange = yield* defineWorkflowMethod({ command: cancelForWorkflow, arguments: decodeCancelArguments,
      encode: ([data]) => data, output: value => decodeNull(value).pipe(Result.map(() => undefined)), moduleEvents: [updated] });
    const restoreOrderChangeCancellation = yield* defineWorkflowMethod({ command: restoreForWorkflow, arguments: decodeRestoreArguments,
      encode: ([data]) => data, output: prepared.contracts.decodeOutput, moduleEvents: [updated] });
    const admitted = [retrieveForWorkflow, cancelForWorkflow, restoreForWorkflow], policy = orderChangeCancellationPolicy(prepared);
    const workflow = yield* defineWorkflowModule({ name: Modules.ORDER, source: module.description,
      methods: { retrieveOrderChange, cancelOrderChange, restoreOrderChangeCancellation }, graph: { aliases: [], reads: [] },
      logical: { ...policy, commands: admitted } });
    return { retrieveForWorkflow, cancelForWorkflow, restoreForWorkflow, commands: admitted, source: module.description, workflow,
      withService: module.use, prepared, contracts: prepared.contracts, logicalEventPolicy: () => policy };
  }));
});
