import { Effect, Result } from "effect";
import { Customer } from "@medusajs/customer/models";
import { customerStaticResources } from "@medusajs/customer/static-manifest";
import { Modules } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule } from "../../workflow/module";
import { moduleAliases, relationPaths } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import { captureCustomerMetadata } from "./schema";
import { defineCustomerPersistenceModule } from "./module";
import { makeCustomerSelectionCommands } from "./service";
import { prepareCustomerCartCreationRead, decodeCustomerCartCreationRead } from "./cart-creation-read";
import { customerCartCreationReadPolicy } from "./cart-creation-receipt";

/** One Customer participant combines the existing native selection commands
 * with the genuine counted graph read. Group membership is read-only; no new
 * mutation method or Customer participant is introduced. */
export const makeCustomerCartCreationCommands = Effect.fn("Customer.cartCreationCommands")(function* () {
  const metadata = yield* captureCustomerMetadata(), selection = yield* makeCustomerSelectionCommands();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareCustomerCartCreationRead(metadata.frame);
    const module = yield* defineCustomerPersistenceModule({ name: "flarex-customer-cart-creation", profile: "customer.cart-creation",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: model => model === Customer ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ listAndCountCustomers: native.listAndCountCustomers.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const count = commerceServiceCommands(module.use).read("customerCountForCartCreation",
      commerceCommandPreparation("CustomerCartCreation.prepare")(decodeCustomerCartCreationRead),
      ({ service, context }, input) => Reflect.apply(service.listAndCountCustomers, service, [input.filters, input.config, context]));
    const readPolicy = customerCartCreationReadPolicy(prepared), selectionPolicy = selection.logicalEventPolicy();
    const policy = { capture: selectionPolicy.capture, allowStorageInsertionOrder: true as const, validateLogicalCall: Effect.fn("Customer.routeCartCreationCall")(function* (...args: Parameters<typeof readPolicy.validateLogicalCall>) {
      return yield* (args[0].commandName === "customerCountForCartCreation" ? readPolicy : selectionPolicy).validateLogicalCall(...args);
    }) };
    const joiner = customerStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const aliases = (yield* moduleAliases(joiner)).filter(alias => alias.model === "Customer"), commands = [...selection.commands, count];
    const paths = yield* relationPaths(prepared.catalog, prepared.customer.name, ["groups"], { nativeFields: true });
    const workflow = yield* defineWorkflowModule({ name: Modules.CUSTOMER, source: module.description, methods: selection.workflow.methods,
      graph: { aliases, reads: [{ model: "Customer", command: count, table: prepared.table, paths,
        selectedFieldsOnly: true, orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] },
      logical: { ...policy, commands } });
    return { ...selection, workflow, commands, prepared, count, logicalEventPolicy: () => policy };
  }));
});
