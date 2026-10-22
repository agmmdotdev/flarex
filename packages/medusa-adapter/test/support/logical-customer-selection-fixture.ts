import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { findOrCreateCustomerStep } from "@medusajs/core-flows/cart/find-or-create-customer";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { compileCustomerDefinition } from "../../src/modules/customer/schema";
import { makeCustomerSelectionCommands } from "../../src/modules/customer/service";
import { prepareCustomerSelectionWorkflow, CustomerSelectionInput } from "../../src/workflows/cart/customer-selection";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

export type CustomerInitialRow = Readonly<{ table: string; row: JsonObject }>;
const stamp = "2026-10-22T00:00:00.000Z", managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
export function customerRow(id: string, email: string | null, has_account = false, deleted = false): CustomerInitialRow {
  return { table: "customer", row: { id, company_name: null, first_name: null, last_name: null, email, phone: null,
    has_account, metadata: null, created_by: null, ...managed, ...(deleted ? { deleted_at: stamp } : {}) } };
}
export function customerDescendants(prefix: string, count: number, deleted = false): readonly CustomerInitialRow[] {
  const rows: CustomerInitialRow[] = [customerRow(prefix, prefix + "@example.invalid", false, deleted)];
  for (let index = 0; index < count; index++) {
    const history = index % 2 === 1 ? { deleted_at: stamp } : {};
    rows.push({ table: "customer_group", row: { id: prefix + "-group-" + index, name: prefix + " group " + index,
      metadata: null, created_by: null, ...managed } });
    rows.push({ table: "customer_address", row: { id: prefix + "-address-" + index, customer_id: prefix,
      address_name: null, is_default_shipping: false, is_default_billing: false, company: null, first_name: null, last_name: null,
      address_1: null, address_2: null, city: null, country_code: null, province: null, postal_code: null, phone: null,
      metadata: null, ...managed, ...history } });
    rows.push({ table: "customer_group_customer", row: { id: prefix + "-membership-" + index, customer_id: prefix,
      customer_group_id: prefix + "-group-" + index, created_by: null, metadata: null, ...managed, ...history } });
  }
  return rows;
}
export const customerSelectionInitial: readonly CustomerInitialRow[] = [
  customerRow("cus-account", "account@example.invalid", true), customerRow("cus-guest", "guest@example.invalid"),
  customerRow("cus-target", "target@example.invalid"), customerRow("cus-deleted", "deleted@example.invalid", false, true),
  customerRow("cus-z-mixed-account", "mixed@example.invalid", true), customerRow("cus-a-mixed-guest", "mixed@example.invalid"),
  customerRow("cus-z-guest-last", "account-first@example.invalid"), customerRow("cus-a-account-first", "account-first@example.invalid", true),
  customerRow("cus-null-email", null),
];

const native = createWorkflow("probe-customer-native-selection", (input: WorkflowData<typeof CustomerSelectionInput.Type>) =>
  new WorkflowResponse(findOrCreateCustomerStep(input)));
const retained = Result.getOrThrow(native.prepare()).nodes.find(node => node.name === "find-or-create-customer");
if (retained?.kind !== "step" || retained.compensation !== "transactionCovered" || retained.compensate === undefined)
  throw new Error("Missing genuine Customer selection retained inverse");
const compensate = retained.compensate;

/** Complete four-model native metadata is enrolled in the existing logical
 * installation owner. Initial rows grant no general Customer CRUD surface. */
export async function prepareLogicalCustomerSelection(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly CustomerInitialRow[] = customerSelectionInitial,
  shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const definition = await Effect.runPromise(compileCustomerDefinition());
  const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.customer", owner: "medusa",
    writeProfile: "medusa.customer", evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
  }));
  const configuration = { additionalSources: [source] };
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? configuration : { ...configuration, ...shared });
  const customer = await Effect.runPromise(makeCustomerSelectionCommands());
  const order = ["customer", "customer_group", "customer_address", "customer_group_customer"];
  const initial = order.flatMap(table => rows.filter(value => value.table === table));
  if (initial.length !== rows.length) throw new Error("Unknown Customer seed table");
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: initial },
    1_048_576, { invalidInput: () => new Error("Invalid Customer seed"), hashFailure: cause => new Error("Customer seed hash", { cause }) }));
  const input = { ...fixture.hostInput, commands: customer.commands,
    identityAndAccessPolicy: { profile: "logical-customer-selection-initialization" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "customer-selection-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: initial.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializer = await Effect.runPromise(makeCommerceHost(input));
  try { await Effect.runPromise(initializer.initialize(initial)); } finally { await Effect.runPromise(initializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const installed = { module: customer.workflow, logicalStorage: input.logicalStorage }, modules = { customer: installed };
  const options = { execution, modules, revision: createHash("sha256").update("native-customer-selection-162").digest("hex"),
    subscribers: [{ id: "native-customer-selection", revision: "d".repeat(64) }] };
  const prepare = async () => {
    const host = await Effect.runPromise(prepareCustomerSelectionWorkflow(options)); close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ customer: { module: customer.workflow,
    methods: ["retrieveCustomer", "listCustomers", "createCustomers", "deleteCustomers"], graph: false } }, true, undefined, { absent: ["caching"] }));
  const prepareRoundtrip = async (actualRetained: () => unknown, lateFailure = false) => {
    const undo = createStep("probe-native-customer-retained-inverse", resources.callback(async (_input: null, context) => {
      await compensate(actualRetained(), context);
      if (lateFailure) throw new Error("Late genuine Customer retained inverse failure");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-native-customer-selection-roundtrip", (value: WorkflowData<typeof CustomerSelectionInput.Type>) => {
      const output = findOrCreateCustomerStep(value), inverse = undo(transform(output, () => null));
      return new WorkflowResponse(transform({ output, inverse }, ({ output }) => output));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, revision: options.revision, subscribers: options.subscribers,
      operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeNativeCustomerSelectionRoundtrip", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: CustomerSelectionInput, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareInverse = async (lateFailure = false) => {
    const undo = createStep("probe-native-customer-physical-inverse", resources.callback(async (id: string, context) => {
      // A separately labelled physical closure probe, not evidence that this
      // seeded generation was created by an earlier workflow invocation.
      await compensate({ customer: { id }, customerWasCreated: true }, context);
      if (lateFailure) throw new Error("Late genuine Customer physical inverse failure"); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-native-customer-physical-inverse", (id: WorkflowData<string>) => new WorkflowResponse(undo(id)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, revision: options.revision, subscribers: options.subscribers,
      operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeNativeCustomerPhysicalInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.String, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const read = async (ids: readonly string[]) => {
    const inventory = await logicalCurrencyInventory(fixture), selected = new Set(ids), output: JsonObject[] = [];
    const scope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    for (const current of inventory.rows) {
      if (current.scopeUuid !== scope) continue;
      const record = inventory.revisions.find(row => row.scopeUuid === scope && row.tableId === current.tableId && row.commitSeq === current.commitSeq
        && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (record === undefined || record.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: record.valueBytes, sha256: record.valueSha256, profile: "appDocument" });
      const row = Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson);
      if (typeof row.id === "string" && selected.has(row.id)) output.push(projectNativeRow(row));
    }
    return output.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };
  return { fixture, definition, customer, installed, modules, options, execution, prepare, prepareRoundtrip, prepareInverse, read,
    snapshot: () => logicalCurrencyInventory(fixture) };
}
