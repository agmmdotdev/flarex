import { Effect, Schema } from "effect";
import { createCustomerAddressesWorkflow } from "@medusajs/core-flows/customer/create-addresses";
import { updateCustomerAddressesWorkflow } from "@medusajs/core-flows/customer/update-addresses";
import { deleteCustomerAddressesWorkflow } from "@medusajs/core-flows/customer/delete-addresses";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { makeCustomerAddressCommands } from "../../modules/customer/address-service";
import { AddressCreateRoot, AddressUpdateRoot, AddressDeleteRoot } from "../../modules/customer/address-input";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { internalModuleWorkflowEvents } from "../../workflow/events";

type Customer = Effect.Success<ReturnType<typeof makeCustomerAddressCommands>>;
export interface CustomerAddressWorkflowOptions {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly customer: InstalledWorkflowModule<Customer["workflow"]> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}
const prepareParticipant = Effect.fn("CustomerAddress.prepareParticipant")(function* (input: CustomerAddressWorkflowOptions) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["customer"]));
  const source = workflowModuleDefinition(modules.customer.module)?.source;
  if (source?.name !== "flarex-customer-addresses" || source.profile !== "customer.address-management") return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.customer.logicalResources !== undefined || modules.customer.logicalPublication !== undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ customer: { module: modules.customer.module,
    methods: ["createCustomerAddresses", "listCustomerAddresses", "updateCustomerAddresses", "deleteCustomerAddresses"], graph: false } }, true));
  return { ...input, modules, resources, operationScheduling: "queued" as const, borrowedOperationScheduling: "queued" as const };
});
export const prepareCustomerAddressCreationWorkflow = Effect.fn("CustomerAddress.prepareCreation")(function* (input: CustomerAddressWorkflowOptions) {
  const options = yield* prepareParticipant(input), prepared = yield* Effect.fromResult(createCustomerAddressesWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, workflow: { name: "createCustomerAddressesWorkflow", resources: options.resources, prepared,
    input: AddressCreateRoot, output: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), events: internalModuleWorkflowEvents } });
});
export const prepareCustomerAddressUpdateWorkflow = Effect.fn("CustomerAddress.prepareUpdate")(function* (input: CustomerAddressWorkflowOptions) {
  const options = yield* prepareParticipant(input), prepared = yield* Effect.fromResult(updateCustomerAddressesWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, workflow: { name: "updateCustomerAddressesWorkflow", resources: options.resources, prepared,
    input: AddressUpdateRoot, output: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), events: internalModuleWorkflowEvents } });
});
export const prepareCustomerAddressDeletionWorkflow = Effect.fn("CustomerAddress.prepareDeletion")(function* (input: CustomerAddressWorkflowOptions) {
  const options = yield* prepareParticipant(input), prepared = yield* Effect.fromResult(deleteCustomerAddressesWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, workflow: { name: "deleteCustomerAddressesWorkflow", resources: options.resources, prepared,
    input: AddressDeleteRoot, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
