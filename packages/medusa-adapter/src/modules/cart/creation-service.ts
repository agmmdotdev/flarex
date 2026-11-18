import { Effect, Result, Schema } from "effect";
import type { ICartCreationOwnershipService } from "@medusajs/types/cart/creation";
import type { ModulePersistenceModel } from "@medusajs/framework/types";
import { cartCreationModels } from "@medusajs/cart/creation-models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { defineCartCreationPersistenceModule } from "./creation-module";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { captureCartCreationMetadata } from "./creation-schema";
import { prepareCartPaymentRead } from "./payment-read";
import { prepareCartCreationRepository } from "./creation-repository";
import { cartCreationPolicy } from "./creation-receipt";
import { CartCreates, CartCreationReceipt, decodeCartCreationResult, decodeCartCreationCompensation, decodeCartCreates, decodeCartCreationReceipt } from "./creation-input";

const createArguments = commerceDecoder(Schema.Tuple([CartCreates]), "invalidInput");
const compensateArguments = commerceDecoder(Schema.Tuple([CartCreationReceipt]), "invalidInput");

/** A distinct fresh twelve-model creation profile. Native Cart receives its
 * genuine generated internals and approved ownership store on one borrowed
 * manager; neither this factory nor the store starts or settles a transaction. */
export const makeCartCreationCommands = Effect.fn("CartCreation.commands")(function* () {
  const metadata = yield* captureCartCreationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const read = yield* prepareCartPaymentRead(metadata.frame, "creation");
    const prepared = yield* prepareCartCreationRepository(metadata.frame, read);
    const module = yield* defineCartCreationPersistenceModule({ name: "flarex-cart-creation", profile: "cart.creation-owned",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { owner, eventBus, store: bound.store, baseRepository: bound.repository, events: bound.mutationEvents,
          repository: (model: ModulePersistenceModel) => model === cartCreationModels.Cart ? bound.repository :
            model === cartCreationModels.Address ? bound.addressRepository : model === cartCreationModels.LineItem ? bound.lineItemRepository :
              model === cartCreationModels.CartCreationOperation ? bound.protocolRepositories.get("cart_creation_operation") ?? bound.denied :
              model === cartCreationModels.CartCreationCart ? bound.protocolRepositories.get("cart_creation_cart") ?? bound.denied :
              model === cartCreationModels.CartCreationAddress ? bound.protocolRepositories.get("cart_creation_address") ?? bound.denied : bound.denied };
      }, service: native => {
        const service: ICartCreationOwnershipService = { createCartsWithOwnership: native.createCartsWithOwnership.bind(native),
          compensateCartsCreation: native.compensateCartsCreation.bind(native) };
        return service;
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("CartCreation.prepare");
    const create = commands.write("cartCreateWithOwnership", prepare(decodeCartCreates),
      ({ service, context }, input) => service.createCartsWithOwnership(input, context));
    const compensate = commands.write("cartCompensateCreation", prepare(decodeCartCreationReceipt),
      ({ service, context }, input) => service.compensateCartsCreation(input, context));
    const policy = cartCreationPolicy(prepared);
    const creationObjects = ["cart", "address", "line_item", "line_item_tax_line", "line_item_adjustment", "cart_creation_operation", "cart_creation_cart", "cart_creation_address"];
    const createMethod = yield* defineWorkflowMethod({ command: create,
      arguments: createArguments, encode: ([input]) => input, output: decodeCartCreationResult,
      moduleEvents: creationObjects.map(objectName => buildModuleResourceEventName({ prefix: Modules.CART, objectName, action: "created" })) });
    const compensateMethod = yield* defineWorkflowMethod({ command: compensate,
      arguments: compensateArguments, encode: ([input]) => input, output: decodeCartCreationCompensation,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.CART, objectName: "cart", action: "deleted" }),
        buildModuleResourceEventName({ prefix: Modules.CART, objectName: "address", action: "deleted" }),
        buildModuleResourceEventName({ prefix: Modules.CART, objectName: "cart_creation_operation", action: "updated" })] });
    const admitted = [create, compensate];
    const workflow = yield* defineWorkflowModule({ name: Modules.CART, source: module.description, methods: {
      createCartsWithOwnership: createMethod, compensateCartsCreation: compensateMethod,
    }, graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { prepared, workflow, create, compensate, commands: admitted, withService: module.use, description: module.description, logicalEventPolicy: () => policy };
  }));
});
