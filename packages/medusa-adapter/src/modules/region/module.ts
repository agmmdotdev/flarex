import { Country, Region } from "@medusajs/region/models";
import { RegionModuleService } from "@medusajs/region/services";
import { Modules } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineCommerceModule, type CommerceModuleRepositories } from "../../module/definition";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import type { commerceModuleEventBus } from "../../module/events";

const regionModels = [Region, Country] as const;

/** Native construction is shared; each read profile owns its repositories,
 * selectors, graph population and receipts. */
export function defineRegionReadModule<Binding extends CommerceModuleRepositories<typeof regionModels[number]> & {
  readonly eventBus: ReturnType<typeof commerceModuleEventBus>;
}>(configuration: {
  readonly name: string;
  readonly profile: string;
  readonly bind: (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => Binding;
}) {
  return defineCommerceModule({ name: configuration.name, models: regionModels,
    profile: { name: configuration.profile, capabilities: [], bind: configuration.bind }, extensions: {},
    service: ({ binding, dependencies, context }) => {
      const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
      const native = new RegionModuleService(container, { scope: "internal" });
      return { service: { listRegions: native.listRegions.bind(native), listAndCountRegions: native.listAndCountRegions.bind(native) }, context };
    },
  });
}
