import { randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform, type WorkflowData } from "@medusajs/workflows-sdk";
import { createPaymentSessionsWorkflow } from "@medusajs/core-flows/payment-collection/create-payment-session";
import { createCustomerAddressesWorkflow } from "@medusajs/core-flows/customer/create-addresses";
import { updateCustomerAddressesWorkflow } from "@medusajs/core-flows/customer/update-addresses";
import { deleteCustomerAddressesWorkflow } from "@medusajs/core-flows/customer/delete-addresses";
import { createPaymentAccountHolderStep } from "@medusajs/core-flows/payment-collection/create-payment-account-holder-step";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { compilePaymentCoreDefinition } from "../../src/modules/payment/schema";
import { compileCustomerCoreDefinition } from "../../src/modules/customer/schema";
import { compileCustomerAccountHolderLinkCoreDefinition } from "../../src/links/customer-account-holder-schema";
import { prepareCheckoutNativeLinkLifecycle } from "../../src/links/checkout-native-lifecycle";
import { prepareCustomerAccountNativeLinkResource } from "../../src/links/checkout-resource";
import { makePaymentLifecycleCommands } from "../../src/modules/payment/lifecycle-service";
import { makeCustomerAddressCommands } from "../../src/modules/customer/address-service";
import { CustomerPaymentSessionInput } from "../../src/modules/payment/account-input";
import { AddressCreateRoot } from "../../src/modules/customer/address-input";
import { prepareCustomerAddressCreationWorkflow, prepareCustomerAddressUpdateWorkflow, prepareCustomerAddressDeletionWorkflow } from "../../src/workflows/customer/addresses";
import { prepareCustomerPaymentSessionWorkflow, prepareCustomerPaymentSessionResources } from "../../src/workflows/payment/customer-session";
import { paymentFinanceCallLimit } from "../../src/workflows/payment/finance-configuration";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { createCoreNativeWorkflowFixture } from "./core-native-workflow-fixture";
import { orderFixtureHosts } from "./core-order-fixture";
import { customerRow } from "./customer-rows";
import { makePaymentFixtureLogger } from "./payment-fixture-data";

const stamp = "2026-10-28T00:00:00.000Z";
export const accountCustomer = "cus-account-workflow", accountCollection = "paycol-customer-account";
export async function prepareCoreCustomerAccounts(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const { logger } = makePaymentFixtureLogger();
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const [customerDefinition, paymentDefinition, linkDefinition, eventDefinition, customer, payment, links] =
    await Effect.runPromise(Effect.all([
      compileCustomerCoreDefinition(target), compilePaymentCoreDefinition(target),
      compileCustomerAccountHolderLinkCoreDefinition(target), compileCoreNativeEventStorageDefinition(target),
      makeCustomerAddressCommands(), makePaymentLifecycleCommands(logger), prepareCheckoutNativeLinkLifecycle("customer-account"),
    ]));
  const fixture = await createCoreNativeWorkflowFixture(driver, {
    eventDefinition,
    sources: [
      { name: "customer", definition: customerDefinition, initialCommands: customer.commands, rows: [
        customerRow(accountCustomer, "accounts@example.invalid", true),
        customerRow("cus-other-account", "other-accounts@example.invalid", true),
        customerRow("cus-account-empty", "empty-accounts@example.invalid", true),
      ] },
      { name: "payment", definition: paymentDefinition, initialCommands: payment.commands, rows: [
        { table: "payment_collection", row: { id: accountCollection, currency_code: "usd", amount: "12.5", raw_amount: { value: "12.5", precision: 20 },
          authorized_amount: null, raw_authorized_amount: null, captured_amount: null, raw_captured_amount: null, refunded_amount: null, raw_refunded_amount: null,
          completed_at: null, status: "not_paid", metadata: null, created_at: stamp, updated_at: stamp, deleted_at: null } },
      ] },
      { name: "customer_account_holder_links", definition: linkDefinition, initialCommands: links.commands, rows: [] },
    ],
  });
  close(fixture.close);
  const { own: keep, closeCaseHosts } = orderFixtureHosts(close);
  const modules = { customer: { module: customer.workflow, nativeStorage: fixture.source("customer") },
    payment: { module: payment.workflow, nativeStorage: fixture.source("payment") },
    customer_account_holder_links: { module: links.workflow, nativeStorage: fixture.source("customer_account_holder_links") } };
  const execution = fixture.execution;
  const link = Result.getOrThrow(prepareCustomerAccountNativeLinkResource(links.native));
  const options = { execution, modules, logger: payment.loggerResource, link, revision: "c".repeat(64), subscribers: [{ id: "customer-accounts", revision: "d".repeat(64) }] };
  const addressOptions = { execution, modules: { customer: modules.customer }, revision: options.revision, subscribers: options.subscribers };
  const addresses = {
    create: async () => keep(await Effect.runPromise(prepareCustomerAddressCreationWorkflow(addressOptions))),
    update: async () => keep(await Effect.runPromise(prepareCustomerAddressUpdateWorkflow(addressOptions))),
    delete: async () => keep(await Effect.runPromise(prepareCustomerAddressDeletionWorkflow(addressOptions))),
  };
  const prepareSession = async () => keep(await Effect.runPromise(prepareCustomerPaymentSessionWorkflow(options)));
  const resources = Result.getOrThrow(prepareWorkflowResources({
    payment: { module: payment.workflow, methods: ["createAccountHolder", "deleteAccountHolder", "createPaymentSession", "deletePaymentSession", "listPaymentSessions"], graph: true },
    customer: { module: customer.workflow, methods: ["createCustomerAddresses", "listCustomerAddresses", "updateCustomerAddresses", "deleteCustomerAddresses"], graph: true },
    customer_account_holder_links: { module: links.workflow, methods: ["nativeCreate", "nativeList", "nativeDismiss"], graph: true, expose: false },
  }, true, { logger: payment.loggerResource, link }));
  const lateSession = async () => {
    const resources = Result.getOrThrow(prepareCustomerPaymentSessionResources(modules, payment.loggerResource, link));
    const flow = createWorkflow("probe-customer-session-late-failure", (input: WorkflowData<typeof CustomerPaymentSessionInput.Type>) => {
      const output = createPaymentSessionsWorkflow.runAsStep({ input });
      return new WorkflowResponse(transform(output, () => { throw new Error("Late Customer account/session parent failure"); }));
    });
    return keep(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeCustomerSessionLateFailure", resources, prepared: Result.getOrThrow(flow.prepare()), input: CustomerPaymentSessionInput, output: Schema.Json,
        events: internalModuleWorkflowEvents } })));
  };
  const defaultSession = async () => {
    const resources = Result.getOrThrow(prepareCustomerPaymentSessionResources(modules, payment.loggerResource, link));
    return keep(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeCustomerSessionDefaultAllowance", resources, prepared: Result.getOrThrow(createPaymentSessionsWorkflow.prepare()),
        input: CustomerPaymentSessionInput, output: Schema.Json, events: internalModuleWorkflowEvents } })));
  };
  const lateAddress = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ customer: { module: customer.workflow,
      methods: ["createCustomerAddresses", "listCustomerAddresses", "updateCustomerAddresses", "deleteCustomerAddresses"], graph: false } }, true));
    const flow = createWorkflow("probe-customer-address-late-failure", (input: WorkflowData<typeof AddressCreateRoot.Type>) => {
      const output = createCustomerAddressesWorkflow.runAsStep({ input });
      return new WorkflowResponse(transform(output, () => { throw new Error("Late Customer Address parent failure"); }));
    });
    return keep(await Effect.runPromise(prepareAtomicWorkflowHost({ ...addressOptions, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeCustomerAddressLateFailure", resources, prepared: Result.getOrThrow(flow.prepare()), input: AddressCreateRoot, output: Schema.Json,
        events: internalModuleWorkflowEvents } })));
  };
  const retained = async (kind: "create" | "update" | "delete" | "account" | "billing" | "shipping", inverse = false, failAfter = false) => {
    const nativeAccount = createWorkflow("probe-native-account-holder", () => new WorkflowResponse(createPaymentAccountHolderStep({
      provider_id: "pp_system_default", context: { customer: { id: accountCustomer, email: "accounts@example.invalid" } },
    })));
    const prepared = kind === "account" ? nativeAccount.prepare() : kind === "create" || kind === "billing" || kind === "shipping" ? createCustomerAddressesWorkflow.prepare()
      : kind === "update" ? updateCustomerAddressesWorkflow.prepare() : deleteCustomerAddressesWorkflow.prepare();
    const name = kind === "account" ? "create-payment-account-holder" : kind === "billing" || kind === "shipping"
      ? "maybe-unset-default-" + kind + "-customer-addresses" : kind + "-customer-addresses";
    const node = Result.getOrThrow(prepared).nodes.find(node => node.name === name);
    if (node?.kind !== "step" || node.compensate === undefined) throw new Error("Missing actual native retained callback " + name);
    const invoke = node.invoke, compensate = node.compensate, label = kind + (inverse ? "-inverse" : "-forward") + (failAfter ? "-fail" : "");
    const step = createStep("probe-retained-customer-account-" + label, resources.callback(async (input: unknown, context) => {
      if (inverse) {
        await Reflect.apply(compensate, undefined, [input, context]);
        if (failAfter) throw new Error("Late retained Customer account inverse failure");
        return new StepResponse(null);
      }
      const response = await Reflect.apply(invoke, undefined, [input, context]);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine native compensation marker");
      return new StepResponse({ output: response.output ?? null, retained: response.compensateInput ?? null });
    }));
    const flow = createWorkflow("probe-retained-customer-account-" + label, (input: WorkflowData<unknown>) => new WorkflowResponse(step(input)));
    return keep(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeRetainedCustomerAccount-" + label, resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.Json, output: Schema.Json,
        events: internalModuleWorkflowEvents } })));
  };
  return { fixture, customer, payment, addresses, prepareSession, lateSession, defaultSession, lateAddress, retained, closeCaseHosts,
    read: fixture.readRows, snapshot: fixture.snapshot };
}
