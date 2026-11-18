import type { ModulePersistenceModel } from "@medusajs/framework/types";
import type { CartCreationStore } from "@medusajs/cart/creation";
import { cartCreationModels } from "@medusajs/cart/creation-models";
import { CartModuleService } from "@medusajs/cart/services";
import { Module } from "@medusajs/utils/modules-sdk/module";
import { Modules } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineCommerceModule, type CommerceModuleRepositories, type PreparedCommerceModule, type CommerceModuleDefinitionError } from "../../module/definition";
import type { Result } from "effect";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import type { commerceModuleEventBus } from "../../module/events";

Module(Modules.CART, { service: CartModuleService });
type NamedModel<Name extends string> = ModulePersistenceModel & { readonly name: Uncapitalize<Name> };
const models: readonly [NamedModel<"Cart">, NamedModel<"Address">, NamedModel<"LineItem">, NamedModel<"CreditLine">,
  NamedModel<"LineItemTaxLine">, NamedModel<"LineItemAdjustment">, NamedModel<"ShippingMethod">,
  NamedModel<"ShippingMethodTaxLine">, NamedModel<"ShippingMethodAdjustment">, NamedModel<"CartCreationOperation">,
  NamedModel<"CartCreationCart">, NamedModel<"CartCreationAddress">] = [cartCreationModels.Cart, cartCreationModels.Address, cartCreationModels.LineItem,
  cartCreationModels.CreditLine, cartCreationModels.LineItemTaxLine, cartCreationModels.LineItemAdjustment,
  cartCreationModels.ShippingMethod, cartCreationModels.ShippingMethodTaxLine, cartCreationModels.ShippingMethodAdjustment,
  cartCreationModels.CartCreationOperation, cartCreationModels.CartCreationCart, cartCreationModels.CartCreationAddress];

/** One genuine constructor for fresh twelve-model Cart profiles. Each selected
 * profile supplies its admitted repositories and public method closure. */
export function defineCartCreationPersistenceModule<
  Binding extends CommerceModuleRepositories<ModulePersistenceModel> & {
    readonly owner: CommercePromiseOwner;
    readonly store: CartCreationStore;
    readonly eventBus: ReturnType<typeof commerceModuleEventBus>;
  },
  Service,
>(configuration: {
  readonly name: string;
  readonly profile: string;
  readonly bind: (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => Binding;
  readonly service: (native: CartModuleService, owner: CommercePromiseOwner) => Service;
}): Result.Result<PreparedCommerceModule<{ readonly service: Service; readonly context: {
  readonly manager: CommerceCommandContext["manager"]; readonly transactionManager: CommerceCommandContext["manager"];
} }>, CommerceModuleDefinitionError> {
  return defineCommerceModule({ name: configuration.name, models,
    profile: { name: configuration.profile, capabilities: [], bind: configuration.bind }, extensions: {},
    service: ({ binding, dependencies, context }) => {
      const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
      const native = new CartModuleService(container, { scope: "internal" }, binding.store);
      return { service: configuration.service(native, binding.owner), context };
    },
  });
}
