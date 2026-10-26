import { Effect, Result } from "effect";
import { Cart } from "@medusajs/cart/models";
import { CartModuleService } from "@medusajs/cart/services";
import { cartStaticResources } from "@medusajs/cart/static-manifest";
import { Module } from "@medusajs/utils/modules-sdk/module";
import { Modules } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceModule } from "../../module/definition";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { defineWorkflowModule } from "../../workflow/module";
import { makeReadCatalog } from "../../query/catalog";
import { moduleAliases } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { cartModels, captureCartMetadata } from "./schema";
import { decodeCartPaymentRead, prepareCartPaymentRead } from "./payment-read";
import { cartPaymentReadPolicy } from "./payment-receipt";

Module(Modules.CART, { service: CartModuleService });
export const makeCartPaymentReadCommands = Effect.fn("CartPayment.commands")(function* () {
  const metadata = yield* captureCartMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareCartPaymentRead(metadata.frame);
    const module = yield* defineCommerceModule({ name: "flarex-cart-payment-read", models: cartModels,
      profile: { name: "cart.payment-collection-read", capabilities: [], bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        return { owner, baseRepository: bound.repository, repository: model => model === Cart ? bound.repository : bound.denied };
      } }, extensions: {}, service: ({ binding, dependencies, context }) => {
        const native = new CartModuleService(dependencies, { scope: "internal" });
        return { service: { listAndCountCarts: async (...args: Parameters<CartModuleService["listAndCountCarts"]>) => {
          const value = await native.listAndCountCarts(...args);
          return binding.owner.run(Effect.fromResult(captureNativeNumericDto(value)));
        } }, context };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use);
    const count = commands.read("cartCountForPaymentCollection", commerceCommandPreparation("CartPayment.prepare")(decodeCartPaymentRead),
      ({ service, context }, input) => service.listAndCountCarts(input.filters, input.config ?? {}, context));
    const stored = yield* prepared.catalog.table("cart");
    const presentation = yield* makeReadCatalog([{ ...stored, columns: [...stored.columns, "total", "raw_total"] }], new Map());
    const joiner = cartStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const aliases = yield* moduleAliases(joiner);
    const policy = cartPaymentReadPolicy(prepared), admitted = [count];
    const workflow = yield* defineWorkflowModule({ name: Modules.CART, source: module.description, methods: {},
      graph: { aliases: aliases.filter(alias => alias.model === "Cart"), reads: [{ model: "Cart", command: count,
        table: yield* presentation.table("cart"), paths: [], selectedFieldsOnly: true,
        orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] }, logical: { ...policy, commands: admitted } });
    return { prepared, workflow, count, commands: admitted, logicalEventPolicy: () => policy };
  }));
});
