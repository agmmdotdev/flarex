import { Effect, Result } from "effect";
import { Fulfillment, FulfillmentProvider, FulfillmentSet, ServiceZone, ShippingOption } from "@medusajs/fulfillment/models";
import { Modules } from "@medusajs/framework/utils/portable";
import type { DAL } from "@medusajs/framework/types";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceModuleEventBus } from "../../module/events";
import { commerceRepositoryContext } from "../../repository/context";
import { commerceMutationEvents } from "../../repository/mutation-events";
import { captureCommerceInput } from "../../value/input";
import { defineWorkflowModule, workflowModuleDefinition } from "../../workflow/module";
import { defineFulfillmentPersistenceModule, type FulfillmentPersistenceModel } from "./fulfillment-module";
import { captureFulfillmentCreationMetadata } from "./shipping-profile-schema";
import { prepareShippingOptionCreationRepository } from "./shipping-option-create-repository";
import { prepareFulfillmentCreationRepository } from "./fulfillment-create-repository";
import { bindShippingOptionCreationNativeService, prepareShippingOptionCreationCommands } from "./shipping-option-create-service";
import { bindFulfillmentCreationNativeService, prepareFulfillmentCreationCommands } from "./fulfillment-create-service";

/** This finite native composition has one DML discriminator: location_id is
 * required only on its Fulfillment result root. The selected repositories
 * continue to own complete DTO validation and serialization. */
export function compileFulfillmentOptionSerializerSelection(
  fulfillment: Result.Result.Success<ReturnType<typeof prepareFulfillmentCreationRepository>>["contracts"]["fulfillment"]["table"],
  optionEntities: Result.Result.Success<ReturnType<typeof prepareShippingOptionCreationRepository>>["contracts"]["entities"],
) {
  return Result.gen(function* () {
    const location = fulfillment.columns.find(column => column.name === "location_id");
    if (fulfillment.name !== "fulfillment" || location?.type !== "text" || location.nullable ||
      optionEntities.some(entity => entity.table.columns.some(column => column.name === "location_id")))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    return (input: Json) => Result.gen(function* () {
      const rows = Array.isArray(input) ? input : [input], first = rows[0];
      const fulfillmentRoot = isJsonObject(first) && Object.hasOwn(first, "location_id");
      if (rows.some(row => !isJsonObject(row) || Object.hasOwn(row, "location_id") !== fulfillmentRoot))
        return yield* Result.fail(commerceError("storedCorruption"));
      return fulfillmentRoot;
    });
  });
}

/** Explicit same-root native composition. One actual module constructor owns
 * the existing two repository capabilities, one PromiseOwner, manager bridge
 * and event subscriber owner. Standalone detachment profiles expose no new
 * Fulfillment methods, and installing twelve tables grants neither profile. */
export const makeLocalFulfillmentShippingOptionReferenceDetachmentCommands = Effect.fn("FulfillmentAdapter.shippingOptionReferenceDetachment")(function* () {
  const metadata = yield* captureFulfillmentCreationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const optionRepository = yield* prepareShippingOptionCreationRepository(metadata.frame, "reference-detachment"),
      fulfillmentRepository = yield* prepareFulfillmentCreationRepository(metadata.frame);
    const selectSerializer = yield* compileFulfillmentOptionSerializerSelection(fulfillmentRepository.contracts.fulfillment.table,
      optionRepository.contracts.entities);
    const module = yield* defineFulfillmentPersistenceModule({ name: "flarex-fulfillment-shipping-option-reference-detachment",
      profile: "fulfillment-shipping-option-reference-detachment", providers: "manual",
      bind: (ctx, owner) => {
        const shared = { bridge: commerceRepositoryContext(ctx, owner), events: commerceMutationEvents(owner) },
          option = optionRepository.bind(ctx, owner, shared), fulfillment = fulfillmentRepository.bind(ctx, owner, shared);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => shared.bridge.current().captureLocalEvent(message), check: work => shared.bridge.checked(ctx, work), refuse: option.refuse });
        const baseRepository: DAL.RepositoryService = { ...option.repository,
          serialize: <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> => {
            if (input === undefined) return option.repository.serialize<Output>(input, options);
            // location_id is a required scalar of this selected native
            // Fulfillment root and belongs to none of the Option/availability
            // models. Preserve each model's existing serializer, including
            // Fulfillment Item numeric projection; do not recreate its DTO.
            const selected = shared.bridge.checked(ctx, Effect.gen(function* () {
              const value = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
              const fulfillmentRoot = yield* Effect.fromResult(selectSerializer(value));
              return { value, fulfillmentRoot };
            }));
            return owner.run(selected).then(({ value, fulfillmentRoot }) =>
              (fulfillmentRoot ? fulfillment.repository : option.repository).serialize<Output>(value, options));
          },
        };
        return { baseRepository, repository: (model: FulfillmentPersistenceModel) => model === Fulfillment ? fulfillment.repository
          : model === ShippingOption ? option.repository : model === ServiceZone ? option.zoneRepository : model === FulfillmentSet ? option.setRepository
            : model === FulfillmentProvider ? option.providerRepository : option.denied,
          events: option.mutationEvents, eventBus, denied: option.denied };
      }, service: native => ({ ...bindShippingOptionCreationNativeService(native), ...bindFulfillmentCreationNativeService(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const option = yield* prepareShippingOptionCreationCommands(module, optionRepository),
      fulfillment = yield* prepareFulfillmentCreationCommands(module, fulfillmentRepository),
      optionDefinition = workflowModuleDefinition(option.workflow);
    if (optionDefinition === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    const optionPolicy = option.logicalEventPolicy(), fulfillmentPolicy = fulfillment.logicalEventPolicy(),
      optionNames = new Set(option.commands.map(command => commerceCommandIdentity(command)?.name)),
      fulfillmentNames = new Set(fulfillment.commands.map(command => commerceCommandIdentity(command)?.name));
    const policy = {
      capture: Effect.fn("FulfillmentReferenceDetachment.captureEvent")(function* (input: unknown) {
        const value = yield* Effect.fromResult(captureCommerceInput(input));
        if (!isJsonObject(value)) return yield* Effect.fail(commerceError("unadmittedEvent"));
        const metadata = value.metadata;
        if (metadata === undefined || !isJsonObject(metadata)) return yield* Effect.fail(commerceError("unadmittedEvent"));
        return yield* (typeof metadata.object === "string" && ["fulfillment", "fulfillment_address", "fulfillment_item", "fulfillment_label"].includes(metadata.object)
          ? fulfillmentPolicy.capture(value) : optionPolicy.capture(value));
      }),
      validateLogicalCall: Effect.fn("FulfillmentReferenceDetachment.validateCall")(function* (
        call: Parameters<typeof optionPolicy.validateLogicalCall>[0], activity: Parameters<typeof optionPolicy.validateLogicalCall>[1],
      ) {
        if (optionNames.has(call.commandName)) return yield* optionPolicy.validateLogicalCall(call, activity);
        if (fulfillmentNames.has(call.commandName)) return yield* fulfillmentPolicy.validateLogicalCall(call, activity);
        return yield* Effect.fail(commerceError("receiptMismatch"));
      }),
    };
    const commands = [...option.commands, ...fulfillment.commands];
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { ...option.workflow.methods, ...fulfillment.workflow.methods }, graph: optionDefinition.graph,
      logical: { ...policy, commands, detachDeletedReferences: true } });
    return { option, fulfillment, commands, workflow, withService: module.use, logicalEventPolicy: () => policy };
  }));
});
