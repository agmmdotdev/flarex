import { Effect, Result } from "effect";
import { Customer } from "@medusajs/customer/models";
import { customerStaticResources } from "@medusajs/customer/static-manifest";
import { Modules } from "@medusajs/framework/utils/portable";
import type { CustomerTypes, FindConfig, CustomerDTO } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { ScalarIdRead } from "../../repository/scalar-id-read";
import { prepareIdReadRepository } from "../../repository/id-read";
import { moduleAliases, scalarGraphDefinition } from "../../local-graph/module";
import { captureCustomerMetadata } from "./schema";
import { defineCustomerPersistenceModule } from "./module";

/** Existing Customer identities and scalars participate read-only in native
 * checkout. Saved Customer Address and Group methods receive no authority. */
export const makeCustomerCheckoutReadCommands = Effect.fn("Customer.checkoutRead")(function* () {
  const metadata = yield* captureCustomerMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const table = metadata.frame.tables.find(table => table.name === "customer");
    if (table === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const prepared = yield* prepareIdReadRepository(table, "Customer", [table], new Map(), [], "customerCountForCheckout");
    const module = yield* defineCustomerPersistenceModule({ name: "flarex-customer-checkout-read", profile: "customer.checkout-read",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: model => model === Customer ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ listAndCountCustomers: native.listAndCountCustomers.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const count = commerceServiceCommands(module.use).read("customerCountForCheckout",
      commerceCommandPreparation("CustomerCheckout.prepare")(commerceDecoder(ScalarIdRead, "invalidInput")),
      // SAFETY: the bounded scalar ABI is decoded above; DML owns runtime fields.
      ({ service, context }, args) => service.listAndCountCustomers(args.filters as CustomerTypes.FilterableCustomerProps | undefined,
        args.config as FindConfig<CustomerDTO> | undefined, context));
    const joiner = customerStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const aliases = (yield* moduleAliases(joiner)).filter(alias => alias.model === "Customer");
    const graph = yield* scalarGraphDefinition(aliases, "Customer", count, prepared.table);
    const workflow = yield* defineWorkflowModule({ name: Modules.CUSTOMER, source: module.description, methods: {}, graph,
      logical: { ...prepared.policy, commands: [count] } });
    return { prepared, workflow, count, commands: [count], logicalEventPolicy: () => prepared.policy };
  }));
});
