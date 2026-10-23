import { PaymentProvider } from "@medusajs/payment/models";
import { PaymentModuleService, PaymentProviderService } from "@medusajs/payment/services";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { Modules } from "@medusajs/framework/utils/portable";
import { Module } from "@medusajs/utils/modules-sdk/module";
import type { Logger, ModulePersistenceAdapter } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { defineCommerceModule, type CommerceModuleRepositories } from "../../module/definition";
import type { commerceModuleEventBus } from "../../module/events";
import { paymentModels } from "./schema";

Module(Modules.PAYMENT, { service: PaymentModuleService });
export function definePaymentPersistenceModule<Binding extends CommerceModuleRepositories<typeof paymentModels[number]> & {
  readonly eventBus: ReturnType<typeof commerceModuleEventBus>;
}, Service>(configuration: { readonly bind: (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => Binding;
  readonly service: (native: PaymentModuleService) => Service }, logger: Logger) {
  return defineCommerceModule({ name: "flarex-payment-sessions", models: paymentModels,
    profile: { name: "payment.system-sessions", capabilities: ["paymentProviderService"], bind: configuration.bind },
    extensions: { paymentProviderService: { mode: "replace", requires: ["paymentProviderService"], create: ({ binding, persistence }) => {
      const container = createContainer<ConstructorParameters<typeof PaymentProviderService>[0] & { readonly modulePersistenceAdapter: ModulePersistenceAdapter }>();
      container.register({ logger: asValue(logger), paymentProviderRepository: asValue(binding.repository(PaymentProvider)),
        modulePersistenceAdapter: asValue(persistence), pp_system_default: asValue(new SystemPaymentProvider({})) });
      return new PaymentProviderService(container.cradle);
    } } },
    service: ({ binding, dependencies, context }) => {
      const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
      return { service: configuration.service(new PaymentModuleService(container, { scope: "internal" })), context };
    },
  });
}
