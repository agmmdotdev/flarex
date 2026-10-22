import { Result } from "effect";
import { TaxProvider, TaxRate, TaxRateRule, TaxRegion } from "@medusajs/tax/models";
import { TaxModuleService, TaxProviderService } from "@medusajs/tax/services";
import SystemTaxService from "@medusajs/tax/providers/system";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { Module } from "@medusajs/utils/modules-sdk/module";
import { Modules } from "@medusajs/framework/utils/portable";
import type { Logger, ModulePersistenceAdapter } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { defineCommerceModule } from "../../module/definition";
import { commerceModuleEventBus } from "../../module/events";
import { prepareTaxLinesRepository } from "./repository";

Module(Modules.TAX, { service: TaxModuleService });

/** The native provider resolver keeps its genuine missing-registration branch.
 * The only provider registered is one stateless native SystemTax instance per
 * immutable preparation; repository/container state stays request-local. */
export function defineTaxLinesPersistenceModule(metadata: Parameters<typeof prepareTaxLinesRepository>[0], logger: Logger) {
  return Result.gen(function* () {
    const prepared = yield* prepareTaxLinesRepository(metadata), system = new SystemTaxService();
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
        capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
      return { ...bound, baseRepository: bound.repository,
        repository: (model: typeof TaxProvider | typeof TaxRate | typeof TaxRateRule | typeof TaxRegion) =>
          model === TaxRegion ? bound.regionRepository : model === TaxRate ? bound.rateRepository : bound.denied,
        events: bound.mutationEvents, eventBus };
    };
    const module = yield* defineCommerceModule({ name: "flarex-tax-item-lines", models: [TaxProvider, TaxRate, TaxRateRule, TaxRegion],
      profile: { name: "tax.itemTaxLines", capabilities: ["taxProviderService"], bind },
      extensions: { taxProviderService: { mode: "replace", requires: ["taxProviderService"], create: ({ binding, persistence }) => {
        const container = createContainer<ConstructorParameters<typeof TaxProviderService>[0] & { readonly modulePersistenceAdapter: ModulePersistenceAdapter }>();
        container.register({ logger: asValue(logger), taxProviderRepository: asValue(binding.denied),
          modulePersistenceAdapter: asValue(persistence), tp_system: asValue(system) });
        return new TaxProviderService(container.cradle);
      } } },
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new TaxModuleService(container, { scope: "internal" });
        return { native, context };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    return { module, prepared };
  });
}
