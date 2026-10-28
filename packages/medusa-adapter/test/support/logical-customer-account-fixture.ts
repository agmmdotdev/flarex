import { Effect, Result, Schema } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform, type WorkflowData } from "@medusajs/workflows-sdk";
import { createPaymentSessionsWorkflow } from "@medusajs/core-flows/payment-collection/create-payment-session";
import { createCustomerAddressesWorkflow } from "@medusajs/core-flows/customer/create-addresses";
import { updateCustomerAddressesWorkflow } from "@medusajs/core-flows/customer/update-addresses";
import { deleteCustomerAddressesWorkflow } from "@medusajs/core-flows/customer/delete-addresses";
import { createPaymentAccountHolderStep } from "@medusajs/core-flows/payment-collection/create-payment-account-holder-step";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { capturePrivateCanonicalValue, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { compilePaymentDefinition } from "../../src/modules/payment/schema";
import { compileCustomerDefinition } from "../../src/modules/customer/schema";
import { compileCustomerAccountHolderLinkDefinition } from "../../src/links/customer-account-holder-schema";
import { prepareCheckoutNativeLinkLifecycle } from "../../src/links/checkout-native-lifecycle";
import { prepareCustomerAccountNativeLinkResource } from "../../src/links/checkout-resource";
import { makePaymentLifecycleCommands } from "../../src/modules/payment/lifecycle-service";
import { makeCustomerAddressCommands } from "../../src/modules/customer/address-service";
import { CustomerPaymentSessionInput } from "../../src/modules/payment/account-input";
import { AddressCreateRoot } from "../../src/modules/customer/address-input";
import { prepareCustomerAddressCreationWorkflow, prepareCustomerAddressUpdateWorkflow, prepareCustomerAddressDeletionWorkflow } from "../../src/workflows/customer/addresses";
import { prepareCustomerPaymentSessionWorkflow, prepareCustomerPaymentSessionResources } from "../../src/workflows/payment/customer-session";
import { paymentFinanceCallLimit } from "../../src/workflows/payment/finance-configuration";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { customerRow } from "./logical-customer-selection-fixture";

const stamp = "2026-10-28T00:00:00.000Z";
export const accountCustomer = "cus-account-workflow", accountCollection = "paycol-customer-account";
export async function prepareLogicalCustomerAccounts(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const definitions = await Promise.all([Effect.runPromise(compileCustomerDefinition()), Effect.runPromise(compilePaymentDefinition()), Effect.runPromise(compileCustomerAccountHolderLinkDefinition())]);
  const keys = ["customer", "payment", "customer_account_holder_links"] as const;
  const sources = [];
  for (const [index, definition] of definitions.entries()) sources.push(await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa." + keys[index],
    owner: "medusa", writeProfile: "medusa." + keys[index], evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
  })));
  const fixture = await logicalCurrencyFixture(driver, close, { additionalSources: sources });
  const errors: string[] = [];
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: value => value,
    progress() {}, error: value => { errors.push(String(value)); }, failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {}, http() {}, info() {}, warn() {}, log() {} };
  const customer = await Effect.runPromise(makeCustomerAddressCommands()), payment = await Effect.runPromise(makePaymentLifecycleCommands(logger)),
    links = await Effect.runPromise(prepareCheckoutNativeLinkLifecycle("customer-account"));
  const commands = [customer.commands, payment.commands, links.commands];
  const initial: ReadonlyArray<ReadonlyArray<{ readonly table: string; readonly row: JsonObject }>> = [
    [customerRow(accountCustomer, "accounts@example.invalid", true), customerRow("cus-other-account", "other-accounts@example.invalid", true),
      customerRow("cus-account-empty", "empty-accounts@example.invalid", true)],
    [{ table: "payment_collection", row: { id: accountCollection, currency_code: "usd", amount: "12.5", raw_amount: { value: "12.5", precision: 20 },
      authorized_amount: null, raw_authorized_amount: null, captured_amount: null, raw_captured_amount: null, refunded_amount: null, raw_refunded_amount: null,
      completed_at: null, status: "not_paid", metadata: null, created_at: stamp, updated_at: stamp, deleted_at: null } }], [],
  ];
  const storage = [];
  for (const [index, definition] of definitions.entries()) {
    const source = sources[index], rows = initial[index], selectedCommands = commands[index];
    if (source === undefined || rows === undefined || selectedCommands === undefined) throw new Error("Missing Customer account source");
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows }, 1_048_576,
      { invalidInput: () => new Error("Invalid Customer account seed"), hashFailure: cause => new Error("Customer account seed hash", { cause }) }));
    const input = { ...fixture.hostInput, commands: selectedCommands, identityAndAccessPolicy: { profile: "customer-account-initialization" },
      logicalStorage: { ...fixture.hostInput.logicalStorage, source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: definition.schema, evidence: definition.provenance },
        initialization: { stepId: "customer-account-" + index, datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length } },
    } satisfies LogicalCommerceHostInput<unknown>;
    const initializer = await Effect.runPromise(makeCommerceHost(input));
    try { await Effect.runPromise(initializer.initialize(rows)); } finally { await Effect.runPromise(initializer.close); }
    storage.push(input.logicalStorage);
  }
  const [customerStorage, paymentStorage, linkStorage] = storage;
  if (customerStorage === undefined || paymentStorage === undefined || linkStorage === undefined) throw new Error("Missing installed Customer account sources");
  const modules = { customer: { module: customer.workflow, logicalStorage: customerStorage }, payment: { module: payment.workflow, logicalStorage: paymentStorage },
    customer_account_holder_links: { module: links.workflow, logicalStorage: linkStorage } };
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy, prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const link = Result.getOrThrow(prepareCustomerAccountNativeLinkResource(links.native));
  const options = { execution, modules, logger: payment.loggerResource, link, revision: "c".repeat(64), subscribers: [{ id: "customer-accounts", revision: "d".repeat(64) }] };
  const hosts: Array<() => Promise<void>> = []; close(async () => { for (const release of hosts.reverse()) await release(); });
  const keep = <Host extends { readonly close: Effect.Effect<void> }>(host: Host) => { hosts.push(() => Effect.runPromise(host.close)); return host; };
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
  const read = async () => {
    const inventory = await logicalCurrencyInventory(fixture), rows: JsonObject[] = [], scope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    for (const current of inventory.rows) {
      if (current.scopeUuid !== scope) continue;
      const revision = inventory.revisions.find(row => row.scopeUuid === scope && row.tableId === current.tableId && row.commitSeq === current.commitSeq && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (revision === undefined || revision.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: revision.valueBytes, sha256: revision.valueSha256, profile: "appDocument" });
      const row = Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson);
      if (typeof row.id === "string") rows.push(projectNativeRow(row));
    }
    return rows;
  };
  return { fixture, options, modules, customer, payment, links, addresses, prepareSession, lateSession, defaultSession, lateAddress, retained, resources, keep, read,
    snapshot: () => logicalCurrencyInventory(fixture), errors };
}
