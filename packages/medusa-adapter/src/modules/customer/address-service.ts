import { Effect, Result, Schema } from "effect";
import { CustomerAddress } from "@medusajs/customer/models";
import { customerStaticResources } from "@medusajs/customer/static-manifest";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule, workflowModuleDefinition } from "../../workflow/module";
import { moduleAliases } from "../../local-graph/module";
import { localGraphDirectPath } from "../../local-graph/direct-paths";
import { decodeGraphCount, decodeGraphList } from "../../local-graph/query";
import { makeReadCatalog } from "../../query/catalog";
import { commerceDecoder } from "../../value/decoder";
import { ScalarId } from "../../repository/scalar-id-read";
import { captureCustomerMetadata } from "./schema";
import { defineCustomerPersistenceModule } from "./module";
import { prepareCustomerAddressRepository } from "./address-repository";
import { customerAddressPolicy } from "./address-receipt";
import { makeCustomerCheckoutReadCommands } from "./checkout-read-service";
import { AddressCreates, AddressRead, AddressNativePatch, AddressFilter, AddressIds, AddressUpdateOptions,
  decodeAddressCreates, decodeAddressIds, decodeAddressRead, decodeAddressUpdate } from "./address-input";

const decodeCreateArguments = commerceDecoder(Schema.Tuple([AddressCreates]), "invalidInput");
const UpdateSelector = Schema.Union([ScalarId, AddressFilter]);
const decodeUpdateArguments = commerceDecoder(Schema.Union([
  Schema.Tuple([UpdateSelector, AddressNativePatch]),
  Schema.Tuple([UpdateSelector, AddressNativePatch, Schema.Undefined, AddressUpdateOptions]),
]), "invalidInput");
const decodeDeleteArguments = commerceDecoder(Schema.Tuple([AddressIds]), "invalidInput");
const decodeListArguments = commerceDecoder(Schema.Union([Schema.Tuple([AddressFilter]), Schema.Tuple([AddressFilter, AddressRead.fields.config.schema])]), "invalidInput");
const decodeUpdateOutput = commerceDecoder(Schema.Union([Schema.JsonObject, Schema.Array(Schema.JsonObject)]), "storedCorruption");
const decodeNull = commerceDecoder(Schema.Null, "storedCorruption");

/** The genuine Customer service owns Address operations. Existing scalar
 * Customer reads are reused for the native account/session graph. */
export const makeCustomerAddressCommands = Effect.fn("Customer.addressCommands")(function* () {
  const metadata = yield* captureCustomerMetadata(), customer = yield* makeCustomerCheckoutReadCommands();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareCustomerAddressRepository(metadata.frame), addressPolicy = customerAddressPolicy(prepared);
    const module = yield* defineCustomerPersistenceModule({ name: "flarex-customer-addresses", profile: "customer.address-management",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: model => model === CustomerAddress ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ createCustomerAddresses: native.createCustomerAddresses.bind(native), updateCustomerAddresses: native.updateCustomerAddresses.bind(native),
        listCustomerAddresses: native.listCustomerAddresses.bind(native), listAndCountCustomerAddresses: native.listAndCountCustomerAddresses.bind(native),
        deleteCustomerAddresses: native.deleteCustomerAddresses.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("CustomerAddress.prepare");
    const create = commands.write("customerAddressesCreate", prepare(decodeAddressCreates), ({ service, context }, rows) => service.createCustomerAddresses(rows, context));
    const update = commands.write("customerAddressesUpdate", prepare(decodeAddressUpdate), ({ service, context }, input) => typeof input.selector === "string"
      ? service.updateCustomerAddresses(input.selector, input.update, context, input.options) : service.updateCustomerAddresses(input.selector, input.update, context, input.options));
    const remove = commands.write("customerAddressesDelete", prepare(decodeAddressIds), async ({ service, context }, ids) => {
      const result = await service.deleteCustomerAddresses(ids, context);
      if (result !== undefined) throw commerceError("storedCorruption"); return null;
    });
    const list = commands.read("customerAddressesList", prepare(decodeAddressRead), ({ service, context }, args) => service.listCustomerAddresses(args.filters, args.config, context));
    const count = commands.read("customerAddressesCount", prepare(decodeAddressRead), ({ service, context }, args) => service.listAndCountCustomerAddresses(args.filters, args.config, context));
    const event = (action: "created" | "updated" | "deleted") => buildModuleResourceEventName({ prefix: Modules.CUSTOMER, objectName: "customer_address", action });
    const createCustomerAddresses = yield* defineWorkflowMethod({ command: create, arguments: decodeCreateArguments, encode: ([rows]) => rows,
      output: decodeGraphList, moduleEvents: [event("created")] });
    const updateCustomerAddresses = yield* defineWorkflowMethod({ command: update, arguments: decodeUpdateArguments, encode: ([selector, update, , options]) =>
      ({ selector, update, ...(options === undefined ? {} : { options }) }),
      output: decodeUpdateOutput, moduleEvents: [event("updated")] });
    const deleteCustomerAddresses = yield* defineWorkflowMethod({ command: remove, arguments: decodeDeleteArguments, encode: ([ids]) => ids,
      output: value => decodeNull(value).pipe(Result.map(() => undefined)), moduleEvents: [event("deleted")] });
    const listCustomerAddresses = yield* defineWorkflowMethod({ command: list, arguments: decodeListArguments,
      encode: ([filters, config]) => ({ filters, ...(config === undefined ? {} : { config }) }), output: decodeGraphList });
    const joiner = customerStaticResources.joinerConfig, customerDefinition = workflowModuleDefinition(customer.workflow);
    if (joiner === undefined || customerDefinition === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const customerTable = metadata.frame.tables.find(table => table.name === "customer");
    const relation = customerTable === undefined ? undefined : describeToManyRelation(customerTable, "addresses", metadata.frame.tables);
    if (customerTable === undefined || relation === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const catalog = yield* makeReadCatalog([customer.prepared.table, prepared.readTable], new Map([[customerTable.name, new Map([[relation.name, relation]])]]));
    const direct = yield* localGraphDirectPath(catalog, customerTable.name, "Customer", "CustomerAddress", "addresses",
      { root: "Customer", path: "addresses", maximumSources: 4, maximumTargets: 4, maximumPerSource: 4 });
    const policy = { capture: addressPolicy.capture, validateLogicalCall: Effect.fn("CustomerAddress.routeCall")(function* (...args: Parameters<typeof addressPolicy.validateLogicalCall>) {
      return yield* (args[0].commandName === "customerCountForCheckout" ? customer.logicalEventPolicy() : addressPolicy).validateLogicalCall(...args);
    }) };
    const admitted = [...customer.commands, create, update, remove, list, count];
    const workflow = yield* defineWorkflowModule({ name: Modules.CUSTOMER, source: module.description,
      methods: { createCustomerAddresses, updateCustomerAddresses, deleteCustomerAddresses, listCustomerAddresses },
      graph: { aliases: (yield* moduleAliases(joiner)).filter(alias => ["Customer", "CustomerAddress"].includes(alias.model)),
        reads: [...customerDefinition.graph.reads, { model: "CustomerAddress", command: count, table: prepared.readTable, paths: [],
          selectedFieldsOnly: true, orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }], directPaths: [direct] },
      logical: { ...policy, commands: admitted } });
    return { workflow, prepared, commands: admitted, create, update, remove, list, count, logicalEventPolicy: () => policy };
  }));
});
