import { Effect, Result, Schema } from "effect";
import { Customer, CustomerAddress, CustomerGroup, CustomerGroupCustomer } from "@medusajs/customer/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { captureCustomerMetadata } from "./schema";
import { defineCustomerPersistenceModule } from "./module";
import { prepareCustomerSelectionRepository } from "./repository";
import { customerSelectionPolicy } from "./receipt";
import { decodeCustomerRetrieve, decodeCustomerList, decodeCustomerCreate, decodeCustomerDelete,
  decodeCustomerRetrieveArguments, decodeCustomerListArguments, decodeCustomerCreateArguments, decodeCustomerDeleteArguments } from "./input";

const decodeNull = commerceDecoder(Schema.Null, "storedCorruption");

/** One genuine four-model Customer service. Only the methods exercised by the
 * native Cart selection step are exposed to the authenticated workflow. */
export const makeCustomerSelectionCommands = Effect.fn("CustomerAdapter.selectionCommands")(function* () {
  const metadata = yield* captureCustomerMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareCustomerSelectionRepository(metadata.frame);
    const module = yield* defineCustomerPersistenceModule({ name: "flarex-customer-selection", profile: "customer.selection",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: typeof Customer | typeof CustomerAddress | typeof CustomerGroup | typeof CustomerGroupCustomer) =>
            model === Customer ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ retrieveCustomer: native.retrieveCustomer.bind(native), listCustomers: native.listCustomers.bind(native),
        createCustomers: native.createCustomers.bind(native), deleteCustomers: native.deleteCustomers.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("CustomerSelection.prepare");
    const retrieveForWorkflow = commands.read("customerRetrieveForWorkflow", prepare(decodeCustomerRetrieve),
      ({ service, context }, { id }) => service.retrieveCustomer(id, {}, context));
    const listForWorkflow = commands.read("customerListForWorkflow", prepare(decodeCustomerList),
      ({ service, context }, filters) => service.listCustomers(filters, {}, context));
    const createForWorkflow = commands.write("customerCreateForWorkflow", prepare(decodeCustomerCreate),
      ({ service, context }, data) => service.createCustomers(data, context));
    const deleteForWorkflow = commands.write("customerDeleteForWorkflow", prepare(decodeCustomerDelete),
      async ({ service, context }, id) => {
        const result = await service.deleteCustomers(id, context);
        if (result !== undefined) throw commerceError("storedCorruption");
        return null;
      });
    const retrieveCustomer = yield* defineWorkflowMethod({ command: retrieveForWorkflow, arguments: decodeCustomerRetrieveArguments,
      encode: ([id]) => ({ id }), output: prepared.contracts.decodeRow });
    const listCustomers = yield* defineWorkflowMethod({ command: listForWorkflow, arguments: decodeCustomerListArguments,
      encode: ([filters]) => filters, output: prepared.contracts.decodeRows });
    const createCustomers = yield* defineWorkflowMethod({ command: createForWorkflow, arguments: decodeCustomerCreateArguments,
      encode: ([data]) => data, output: prepared.contracts.decodeCreatedRow,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.CUSTOMER, objectName: "customer", action: "created" })] });
    const deleteCustomers = yield* defineWorkflowMethod({ command: deleteForWorkflow, arguments: decodeCustomerDeleteArguments,
      encode: ([id]) => id, output: value => decodeNull(value).pipe(Result.map(() => undefined)),
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.CUSTOMER, objectName: "customer", action: "deleted" })] });
    const admitted = [retrieveForWorkflow, listForWorkflow, createForWorkflow, deleteForWorkflow], policy = customerSelectionPolicy(prepared);
    const workflow = yield* defineWorkflowModule({ name: Modules.CUSTOMER, source: module.description,
      methods: { retrieveCustomer, listCustomers, createCustomers, deleteCustomers }, graph: { aliases: [], reads: [] },
      logical: { ...policy, commands: admitted } });
    return { retrieveForWorkflow, listForWorkflow, createForWorkflow, deleteForWorkflow, commands: admitted, workflow,
      withService: module.use, logicalEventPolicy: () => policy, contracts: prepared.contracts };
  }));
});
