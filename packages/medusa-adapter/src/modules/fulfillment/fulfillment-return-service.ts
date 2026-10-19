import { Result, Schema } from "effect";
import type { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import type { Context } from "@medusajs/framework/types";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { PreparedCommerceModule } from "../../module/definition";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { defineWorkflowMethod } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { FulfillmentCreate, decodeFulfillmentCreate } from "./fulfillment-create-input";
import type { prepareFulfillmentCreationRepository } from "./fulfillment-create-repository";

type Native = Pick<FulfillmentModuleService, "createReturnFulfillment">;
const argumentsDecoder = commerceDecoder(Schema.Tuple([FulfillmentCreate]), "invalidInput");
export const bindFulfillmentReturnNativeService = (native: FulfillmentModuleService) => ({
  createReturnFulfillment: native.createReturnFulfillment.bind(native),
});

/** Only the existing local constructor opts in. Native creation, Option
 * retrieval, provider assignment and the retained cancellation remain native. */
export function prepareFulfillmentReturnCommands<Service extends { readonly service: Native; readonly context: Context }>(module: PreparedCommerceModule<Service>,
  prepared: Result.Result.Success<ReturnType<typeof prepareFulfillmentCreationRepository>>) {
  return Result.gen(function* () {
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("FulfillmentReturn.prepare");
    const createReturn = commands.write("fulfillmentCreateReturnForWorkflow", prepare(decodeFulfillmentCreate), async ({ service, context }, input) => {
      // The existing checked creation profile includes witnessed nullable
      // Address/Items and business dates beyond the authoring DTO.
      const result: unknown = await Reflect.apply(service.createReturnFulfillment, service, [input, context]);
      return result;
    });
    const event = (objectName: string, action: "created" | "updated") => buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName, action });
    const createReturnFulfillment = yield* defineWorkflowMethod({ command: createReturn, arguments: argumentsDecoder, encode: ([input]) => input,
      output: prepared.contracts.decodeOutput, moduleEvents: ["fulfillment_address", "fulfillment", "fulfillment_label", "fulfillment_item"]
        .map(name => event(name, "created")).concat(event("fulfillment", "updated")) });
    return { createReturn, commands: [createReturn], methods: { createReturnFulfillment } };
  });
}
