import type { PreparedCommerceModule } from "../../module/definition";
import type { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import type { Context } from "@medusajs/framework/types";
import { Effect, Result, Schema } from "effect";
import { Fulfillment } from "@medusajs/fulfillment/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { defineFulfillmentPersistenceModule, type FulfillmentPersistenceModel } from "./fulfillment-module";
import { captureFulfillmentCreationMetadata } from "./shipping-profile-schema";
import { FulfillmentCreate, FulfillmentCreationId, decodeFulfillmentCreate, decodeFulfillmentCancellationId } from "./fulfillment-create-input";
import { prepareFulfillmentCreationRepository } from "./fulfillment-create-repository";
import { fulfillmentCreationPolicy } from "./fulfillment-create-receipt";

const createArguments = commerceDecoder(Schema.Tuple([FulfillmentCreate]), "invalidInput");
const cancelArguments = commerceDecoder(Schema.Tuple([FulfillmentCreationId]), "invalidInput");

/** Only the genuine local Manual provider is installed. Native creation,
 * provider-result assignment, exception cleanup and cancellation stay native. */
export const makeLocalFulfillmentCreationCommands = Effect.fn("FulfillmentAdapter.createCommands")(function* () {
  const metadata = yield* captureFulfillmentCreationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareFulfillmentCreationRepository(metadata.frame);
    const module = yield* defineFulfillmentPersistenceModule({ name: "flarex-fulfillment-create", profile: "fulfillment-create", providers: "manual",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: (model: FulfillmentPersistenceModel) => model === Fulfillment ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: bindFulfillmentCreationNativeService,
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    return yield* prepareFulfillmentCreationCommands(module, prepared);
  }));
});

type FulfillmentNativeService = Pick<FulfillmentModuleService, "createFulfillment" | "cancelFulfillment">;
export const bindFulfillmentCreationNativeService = (native: FulfillmentModuleService) => ({
  createFulfillment: native.createFulfillment.bind(native), cancelFulfillment: native.cancelFulfillment.bind(native),
});
/** The standalone and explicit combined constructor share their actual native
 * command/method preparation and the same causal receipt owner. */
export function prepareFulfillmentCreationCommands<Service extends { readonly service: FulfillmentNativeService; readonly context: Context }>(module: PreparedCommerceModule<Service>,
  prepared: Result.Result.Success<ReturnType<typeof prepareFulfillmentCreationRepository>>) {
  return Result.gen(function* () {
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("FulfillmentCreation.prepare");
    const create = commands.write("fulfillmentCreateForWorkflow", prepare(decodeFulfillmentCreate), async ({ service, context }, input) => {
      // The native DTO understates witnessed nullable address/items and business
      // dates. This one checked foreign call invokes the original body intact.
      const result: unknown = await Reflect.apply(service.createFulfillment, service, [input, context]);
      return result;
    });
    const cancel = commands.write("fulfillmentCancelForWorkflow", prepare(decodeFulfillmentCancellationId),
      ({ service, context }, id) => service.cancelFulfillment(id, context));
    const event = (objectName: string, action: "created" | "updated") => buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName, action });
    const createFulfillment = yield* defineWorkflowMethod({ command: create, arguments: createArguments, encode: ([input]) => input,
      output: prepared.contracts.decodeOutput, moduleEvents: ["fulfillment_address", "fulfillment", "fulfillment_label", "fulfillment_item"].map(name => event(name, "created")).concat(event("fulfillment", "updated")) });
    const cancelFulfillment = yield* defineWorkflowMethod({ command: cancel, arguments: cancelArguments, encode: ([id]) => id,
      output: prepared.contracts.decodeOutput, moduleEvents: [event("fulfillment", "updated")] });
    const policy = fulfillmentCreationPolicy(prepared), admitted = [create, cancel];
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description, methods: { createFulfillment, cancelFulfillment },
      graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    const output = Schema.JsonObject.check(Schema.makeFilter(value => Result.isSuccess(prepared.contracts.decodeOutput(value)) || "Expected complete selected native Fulfillment DTO"));
    return { create, cancel, commands: admitted, workflow, contracts: prepared.contracts, withService: module.use,
      logicalEventPolicy: () => policy, output, decodeOutput: prepared.contracts.decodeOutput };
  });
}
