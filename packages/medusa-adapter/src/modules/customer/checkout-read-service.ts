import { withNativeGraphMetadata } from "../../local-graph/native-metadata";
import { Effect, Result, Schema } from "effect";
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
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import type { CommerceRelations } from "../../query/relations";

const AddressRead = Schema.Struct({ ...ScalarIdRead.fields, config: Schema.optionalKey(Schema.Struct({
  ...ScalarIdRead.fields.config.schema.fields,
  relations: Schema.optionalKey(Schema.Array(Schema.Literal("addresses")).check(Schema.isMaxLength(1))),
})) });

/** Existing Customer identities participate read-only in native checkout.
 * AddressManagement opts in to its declared local Address population; this
 * read profile grants no Address or Group methods. */
export const makeCustomerCheckoutReadCommands = Effect.fn("Customer.checkoutRead")(function* (population: "scalar" | "addresses" = "scalar") {
  if (population !== "scalar" && population !== "addresses") return yield* Effect.fail(commerceError("unsupportedProfile"));
  const metadata = yield* captureCustomerMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const table = metadata.frame.tables.find(table => table.name === "customer");
    if (table === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const address = metadata.frame.tables.find(member => member.name === "customer_address");
    const relation = population === "addresses" ? describeToManyRelation(table, "addresses", metadata.frame.tables) : undefined;
    if (population === "addresses" && (address === undefined || relation?.join.type !== "hasMany" || relation.targetTable !== address.name ||
      relation.join.foreignKeys.length !== 1 || relation.join.foreignKeys[0] !== "customer_id"))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const relations: CommerceRelations = relation === undefined ? new Map() : new Map([[table.name, new Map([[relation.name, relation]])]]);
    const decodeRead = commerceDecoder(population === "addresses" ? AddressRead : ScalarIdRead, "invalidInput");
    const prepared = yield* prepareIdReadRepository(table, "Customer", address === undefined || relation === undefined ? [table] : [table, address],
      relations, [], "customerCountForCheckout", relation === undefined ? undefined : { hasManyPaths: [relation.name], decodeRead });
    const module = yield* defineCustomerPersistenceModule({ name: "flarex-customer-checkout-read", profile: "customer.checkout-read",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: model => model === Customer ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ listAndCountCustomers: native.listAndCountCustomers.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const count = commerceServiceCommands(module.use).read("customerCountForCheckout",
      commerceCommandPreparation("CustomerCheckout.prepare")(decodeRead),
      // SAFETY: the bounded scalar ABI is decoded above; DML owns runtime fields.
      ({ service, context }, args) => service.listAndCountCustomers(args.filters as CustomerTypes.FilterableCustomerProps | undefined,
        args.config as FindConfig<CustomerDTO> | undefined, context));
    const joiner = customerStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const aliases = (yield* moduleAliases(joiner)).filter(alias => alias.model === "Customer");
    const graph = yield* withNativeGraphMetadata(yield* scalarGraphDefinition(aliases, "Customer", count, prepared.table), [joiner], metadata.frame.tables);
    const workflow = yield* defineWorkflowModule({ name: Modules.CUSTOMER, source: module.description, methods: {}, graph,
      logical: { ...prepared.policy, commands: [count] } });
    return { prepared, workflow, count, commands: [count], logicalEventPolicy: () => prepared.policy };
  }));
});
