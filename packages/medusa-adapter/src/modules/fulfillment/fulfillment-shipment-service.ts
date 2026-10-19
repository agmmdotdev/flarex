import { Result, Schema } from "effect";
import type { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import type { Context } from "@medusajs/framework/types";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { PreparedCommerceModule } from "../../module/definition";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { defineWorkflowMethod } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { FulfillmentCreationId } from "./fulfillment-create-input";
import { decodeFulfillmentShipmentRead, decodeFulfillmentShipmentUpdate, decodeFulfillmentShipmentCommand } from "./fulfillment-shipment-input";
import type { prepareFulfillmentCreationRepository } from "./fulfillment-create-repository";

const readArguments = commerceDecoder(Schema.Tuple([FulfillmentCreationId, Schema.Unknown]), "invalidInput");
const updateArguments = commerceDecoder(Schema.Tuple([FulfillmentCreationId, Schema.Unknown]), "invalidInput");
type Native = Pick<FulfillmentModuleService, "retrieveFulfillment" | "updateFulfillment">;
export const bindFulfillmentShipmentNativeService = (native: FulfillmentModuleService) => ({
  retrieveFulfillment: native.retrieveFulfillment.bind(native), updateFulfillment: native.updateFulfillment.bind(native),
});

/** The existing local constructor opts in; the mixed Option composition keeps
 * its original method set and serializer contract. No second service exists. */
export function prepareFulfillmentShipmentCommands<Service extends { readonly service: Native; readonly context: Context }>(module: PreparedCommerceModule<Service>,
  prepared: Result.Result.Success<ReturnType<typeof prepareFulfillmentCreationRepository>>) {
  return Result.gen(function* () {
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("FulfillmentShipment.prepare");
    const retrieve = commands.read("fulfillmentRetrieveForWorkflow", prepare(decodeFulfillmentShipmentRead), async ({ service, context }, input) => {
      // Native FindConfig uses mutable DTO-key arrays; the checked runtime
      // projection contract deliberately owns its finite selected strings.
      const result: unknown = await Reflect.apply(service.retrieveFulfillment, service, [input.id, input.config, context]);
      return result;
    });
    const update = commands.write("fulfillmentUpdateForShipment", prepare(decodeFulfillmentShipmentCommand), async ({ service, context }, input) => {
      const result: unknown = await Reflect.apply(service.updateFulfillment, service, [input.id, input.update, context]);
      return result;
    });
    const retrieveFulfillment = yield* defineWorkflowMethod({ command: retrieve,
      arguments: input => Result.gen(function* () {
        const [id, config] = yield* readArguments(input), decoded = yield* decodeFulfillmentShipmentRead({ id, config });
        return [decoded.id, decoded.config] as const;
      }), encode: ([id, config]) => ({ id, ...(config === undefined ? {} : { config }) }), output: prepared.shipment.values.decodePreimage });
    const event = (objectName: string, action: "created" | "updated" | "deleted") => buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName, action });
    const updateFulfillment = yield* defineWorkflowMethod({ command: update,
      arguments: input => Result.gen(function* () {
        const [id, raw] = yield* updateArguments(input);
        return [id, yield* decodeFulfillmentShipmentUpdate(raw)] as const;
      }), encode: ([id, update]) => ({ id, update }), output: prepared.contracts.decodeOutput,
      moduleEvents: [event("fulfillment", "updated"), ...(["created", "updated", "deleted"] as const).map(action => event("fulfillment_label", action))] });
    return { retrieve, update, commands: [retrieve, update], methods: { retrieveFulfillment, updateFulfillment } };
  });
}
