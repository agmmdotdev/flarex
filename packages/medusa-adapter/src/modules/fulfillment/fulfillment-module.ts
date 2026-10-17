import { Fulfillment, FulfillmentAddress, FulfillmentItem, FulfillmentLabel, FulfillmentProvider, FulfillmentSet, GeoZone, ServiceZone,
  ShippingOption, ShippingOptionRule, ShippingOptionType, ShippingProfile } from "@medusajs/fulfillment/models";
import { FulfillmentModuleService, FulfillmentProviderService } from "@medusajs/fulfillment/services";
import { Modules } from "@medusajs/framework/utils/portable";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineCommerceModule, type CommerceModuleRepositories } from "../../module/definition";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import type { commerceModuleEventBus } from "../../module/events";

const fulfillmentModels = [FulfillmentAddress, Fulfillment, FulfillmentItem, FulfillmentLabel, FulfillmentProvider, FulfillmentSet,
  GeoZone, ServiceZone, ShippingOption, ShippingOptionRule, ShippingOptionType, ShippingProfile] as const;
export type FulfillmentPersistenceModel = typeof fulfillmentModels[number];

/** One genuine Fulfillment constructor closure. Each selected model profile
 * still selects its own repository and exact native service methods. */
export function defineFulfillmentPersistenceModule<
  Binding extends CommerceModuleRepositories<FulfillmentPersistenceModel> & {
    readonly eventBus: ReturnType<typeof commerceModuleEventBus>;
    readonly denied: DAL.RepositoryService;
  },
  Service,
>(configuration: {
  readonly name: string;
  readonly profile: string;
  readonly bind: (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => Binding;
  readonly service: (native: FulfillmentModuleService) => Service;
}) {
  return defineCommerceModule({ name: configuration.name, models: fulfillmentModels,
    profile: { name: configuration.profile, capabilities: [], bind: configuration.bind },
    extensions: { fulfillmentProviderService: { mode: "replace", create: ({ binding, persistence }) => {
      const container = { fulfillmentProviderRepository: binding.denied, modulePersistenceAdapter: persistence };
      return new FulfillmentProviderService(container);
    } } },
    service: ({ binding, dependencies, context }) => {
      // The native constructor forwards the container to MedusaService even
      // though its local dependency declaration omits the inherited event bus.
      const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
      const native = new FulfillmentModuleService(container, { scope: "internal" });
      return { service: configuration.service(native), context };
    },
  });
}
