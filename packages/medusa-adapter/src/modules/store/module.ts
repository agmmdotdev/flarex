import { Store, StoreCurrency, StoreLocale } from "@medusajs/store/models";
import { StoreModuleService } from "@medusajs/store/services";
import { Module } from "@medusajs/utils/modules-sdk/module";
import { Modules } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineCommerceModule, type CommerceModuleRepositories } from "../../module/definition";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import type { commerceModuleEventBus } from "../../module/events";

/** Native module registration owns Store naming, linkable keys and event source. */
Module(Modules.STORE, { service: StoreModuleService });
const storeModels = [Store, StoreCurrency, StoreLocale] as const;

/** One native Store construction owner; each profile still binds only its
 * admitted repositories and exposes its own exact public method subset. */
export function defineStorePersistenceModule<
  Binding extends CommerceModuleRepositories<typeof storeModels[number]> & {
    readonly eventBus: ReturnType<typeof commerceModuleEventBus>;
  },
  Service,
>(configuration: {
  readonly name: string;
  readonly profile: string;
  readonly bind: (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => Binding;
  readonly service: (native: StoreModuleService) => Service;
}) {
  return defineCommerceModule({ name: configuration.name, models: storeModels,
    profile: { name: configuration.profile, capabilities: [], bind: configuration.bind }, extensions: {},
    service: ({ binding, dependencies, context }) => {
      const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
      const native = new StoreModuleService(container, { scope: "internal" });
      return { service: configuration.service(native), context };
    },
  });
}
