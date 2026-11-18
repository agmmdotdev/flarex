import { Customer, CustomerAddress, CustomerGroup, CustomerGroupCustomer } from "@medusajs/customer/models";
import { CustomerModuleService } from "@medusajs/customer/services";
import { Module } from "@medusajs/utils/modules-sdk/module";
import { Modules } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineCommerceModule, type CommerceModuleRepositories } from "../../module/definition";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import type { commerceModuleEventBus } from "../../module/events";

/** Native registration owns Customer naming, linkable keys and event source. */
Module(Modules.CUSTOMER, { service: CustomerModuleService });
const customerModels = [Customer, CustomerAddress, CustomerGroup, CustomerGroupCustomer] as const;

/** One genuine four-model Customer construction owner. Selected profiles
 * supply their exact admitted and denied repositories and public methods. */
export function defineCustomerPersistenceModule<
  Binding extends CommerceModuleRepositories<typeof customerModels[number]> & {
    readonly eventBus: ReturnType<typeof commerceModuleEventBus>;
  },
  Service,
>(configuration: {
  readonly name: string;
  readonly profile: string;
  readonly bind: (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => Binding;
  readonly service: (native: CustomerModuleService) => Service;
}) {
  return defineCommerceModule({ name: configuration.name, models: customerModels,
    profile: { name: configuration.profile, capabilities: [], bind: configuration.bind }, extensions: {},
    service: ({ binding, dependencies, context }) => {
      const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
      const native = new CustomerModuleService(container, { scope: "internal" });
      return { service: configuration.service(native), context };
    },
  });
}
