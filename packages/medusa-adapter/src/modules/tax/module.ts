import { TaxProvider, TaxRate, TaxRateRule, TaxRegion } from "@medusajs/tax/models";
import { TaxModuleService, TaxProviderService } from "@medusajs/tax/services";
import SystemTaxService from "@medusajs/tax/providers/system";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { Module } from "@medusajs/utils/modules-sdk/module";
import { Modules } from "@medusajs/framework/utils/portable";
import type { Logger, ModulePersistenceAdapter } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { defineCommerceModule, type CommerceModuleRepositories } from "../../module/definition";
import type { commerceModuleEventBus } from "../../module/events";

Module(Modules.TAX, { service: TaxModuleService });
const taxModels = [TaxProvider, TaxRate, TaxRateRule, TaxRegion] as const;
export type TaxPersistenceModel = typeof taxModels[number];

/** The native provider resolver keeps its genuine missing-registration branch.
 * The only provider registered is one stateless native SystemTax instance per
 * immutable preparation; repository/container state stays request-local. */
export function defineTaxPersistenceModule<
  Binding extends CommerceModuleRepositories<TaxPersistenceModel> & {
    readonly eventBus: ReturnType<typeof commerceModuleEventBus>;
  },
  Service,
>(configuration: {
  readonly name: string;
  readonly profile: string;
  readonly bind: (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => Binding;
  readonly service: (native: TaxModuleService) => Service;
}, logger: Logger) {
  const system = new SystemTaxService();
  return defineCommerceModule({ name: configuration.name, models: taxModels,
    profile: { name: configuration.profile, capabilities: ["taxProviderService"], bind: configuration.bind },
    extensions: { taxProviderService: { mode: "replace", requires: ["taxProviderService"], create: ({ binding, persistence }) => {
      const container = createContainer<ConstructorParameters<typeof TaxProviderService>[0] & { readonly modulePersistenceAdapter: ModulePersistenceAdapter }>();
      container.register({ logger: asValue(logger), taxProviderRepository: asValue(binding.repository(TaxProvider)),
        modulePersistenceAdapter: asValue(persistence), tp_system: asValue(system) });
      return new TaxProviderService(container.cradle);
    } } },
    service: ({ binding, dependencies, context }) => {
      const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
      const native = new TaxModuleService(container, { scope: "internal" });
      return { service: configuration.service(native), context };
    },
  });
}
