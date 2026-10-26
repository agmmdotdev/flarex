import { Effect, Result, Schema } from "effect";
import { Address, Cart } from "@medusajs/cart/models";
import { CartModuleService } from "@medusajs/cart/services";
import { cartStaticResources } from "@medusajs/cart/static-manifest";
import { Module } from "@medusajs/utils/modules-sdk/module";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceModule } from "../../module/definition";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { commerceModuleEventBus } from "../../module/events";
import { commerceDecoder } from "../../value/decoder";
import { makeReadCatalog } from "../../query/catalog";
import { moduleAliases } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { cartModels, captureCartMetadata } from "./schema";
import { CartPaymentRead, decodeCartPaymentRead, prepareCartPaymentRead } from "./payment-read";
import { cartPaymentReadPolicy } from "./payment-receipt";
import { prepareCartCompletionRepository } from "./completion-repository";
import { cartCompletionPolicy } from "./completion-receipt";
import { CartCompletionUpdates, EmptyCartAddresses, EmptyCartAddressRead, decodeCartCompletionUpdates,
  decodeEmptyCartAddressRead, decodeEmptyCartAddresses } from "./completion-input";

const readArguments = commerceDecoder(Schema.Tuple([CartPaymentRead.fields.filters, CartPaymentRead.fields.config.schema]), "invalidInput");
const completionArguments = commerceDecoder(Schema.Tuple([CartCompletionUpdates]), "invalidInput");
const addressReadArguments = commerceDecoder(Schema.Union([
  Schema.Tuple([EmptyCartAddressRead.fields.filters]), Schema.Tuple([EmptyCartAddressRead.fields.filters, EmptyCartAddressRead.fields.config.schema]),
]), "invalidInput");
const addressUpdateArguments = commerceDecoder(Schema.Tuple([EmptyCartAddresses]), "invalidInput");
const decodeCartRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");

Module(Modules.CART, { service: CartModuleService });
const makeCartCommands = Effect.fn("Cart.commands")(function* (profile: "payment" | "completion") {
  const metadata = yield* captureCartMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const read = yield* prepareCartPaymentRead(metadata.frame);
    const completion = profile === "completion" ? yield* prepareCartCompletionRepository(read) : undefined;
    const prepared = completion ?? read;
    const bind = completion?.bind ?? ((...args: Parameters<typeof read.bind>) => {
      const bound = read.bind(...args);
      return { ...bound, addressRepository: bound.denied };
    });
    const module = yield* defineCommerceModule({ name: profile === "payment" ? "flarex-cart-payment-read" : "flarex-cart-completion", models: cartModels,
      profile: { name: profile === "payment" ? "cart.payment-collection-read" : "cart.checkout-completion", capabilities: [], bind: (ctx, owner) => {
        const bound = bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { owner, eventBus, baseRepository: bound.repository, events: bound.mutationEvents,
          repository: model => model === Cart ? bound.repository : model === Address ? bound.addressRepository : bound.denied };
      } }, extensions: {}, service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new CartModuleService(container, { scope: "internal" });
        return { service: { listAndCountCarts: async (...args: Parameters<CartModuleService["listAndCountCarts"]>) => {
          const value = await native.listAndCountCarts(...args);
          return binding.owner.run(Effect.fromResult(captureNativeNumericDto(value)));
        }, listCarts: async (...args: Parameters<CartModuleService["listCarts"]>) => {
          const value = await native.listCarts(...args);
          return binding.owner.run(Effect.fromResult(captureNativeNumericDto(value)));
        }, updateCarts: native.updateCarts.bind(native), listAddresses: native.listAddresses.bind(native),
        updateAddresses: native.updateAddresses.bind(native) }, context };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use);
    const prepare = commerceCommandPreparation("Cart.prepare");
    const count = commands.read(profile === "payment" ? "cartCountForPaymentCollection" : "cartCountForCheckout", prepare(decodeCartPaymentRead),
      ({ service, context }, input) => service.listAndCountCarts(input.filters, input.config ?? {}, context));
    const list = commands.read("cartListForCheckout", prepare(decodeCartPaymentRead),
      ({ service, context }, input) => service.listCarts(input.filters, input.config ?? {}, context));
    const complete = commands.write("cartCompleteForCheckout", prepare(decodeCartCompletionUpdates),
      ({ service, context }, input) => Reflect.apply(service.updateCarts, service, [input, undefined, context]));
    const addresses = commands.read("cartAddressesForCheckout", prepare(decodeEmptyCartAddressRead),
      ({ service, context }, input) => service.listAddresses(input.filters, input.config ?? {}, context));
    const updateAddresses = commands.write("cartEmptyAddressesUpdateForCheckout", prepare(decodeEmptyCartAddresses),
      ({ service, context }, input) => service.updateAddresses(input, context));
    const stored = yield* prepared.catalog.table("cart");
    const presentation = yield* makeReadCatalog([{ ...stored, columns: [...stored.columns, "total", "raw_total"] }], new Map());
    const joiner = cartStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const aliases = yield* moduleAliases(joiner);
    const policy = completion === undefined ? cartPaymentReadPolicy(read) : cartCompletionPolicy(completion);
    const admitted = completion === undefined ? [count] : [count, list, complete, addresses, updateAddresses];
    const methods = completion === undefined ? {} : {
      listCarts: yield* defineWorkflowMethod({ command: list, arguments: readArguments,
        encode: ([filters, config]) => ({ filters, ...(config === undefined ? {} : { config }) }), output: decodeCartRows }),
      updateCarts: yield* defineWorkflowMethod({ command: complete, arguments: completionArguments,
        encode: ([input]) => input, output: decodeCartRows,
        moduleEvents: [buildModuleResourceEventName({ prefix: Modules.CART, objectName: "cart", action: "updated" })] }),
      listAddresses: yield* defineWorkflowMethod({ command: addresses, arguments: addressReadArguments,
        encode: ([filters, config]) => ({ filters, ...(config === undefined ? {} : { config }) }), output: decodeEmptyCartAddresses }),
      updateAddresses: yield* defineWorkflowMethod({ command: updateAddresses, arguments: addressUpdateArguments,
        encode: ([input]) => input, output: decodeEmptyCartAddresses }),
    };
    const workflow = yield* defineWorkflowModule({ name: Modules.CART, source: module.description, methods,
      graph: { aliases: aliases.filter(alias => alias.model === "Cart"), reads: [{ model: "Cart", command: count,
        table: yield* presentation.table("cart"), paths: [], selectedFieldsOnly: true,
        orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] }, logical: { ...policy, commands: admitted } });
    return { prepared, workflow, count, list, complete, addresses, updateAddresses, commands: admitted, logicalEventPolicy: () => policy };
  }));
});
export const makeCartPaymentReadCommands = () => makeCartCommands("payment");
export const makeCartCompletionCommands = () => makeCartCommands("completion");
