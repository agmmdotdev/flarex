import { Effect, Result, Schema } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform, type WorkflowData } from "@medusajs/workflows-sdk";
import { createPaymentSessionsWorkflow } from "@medusajs/core-flows/payment-collection/create-payment-session";
import { deletePaymentSessionsWorkflow } from "@medusajs/core-flows/payment-collection/delete-payment-sessions";
import { createPaymentSessionStep } from "@medusajs/core-flows/payment-collection/create-payment-session-step";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { capturePrivateCanonicalValue, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { compilePaymentDefinition } from "../../src/modules/payment/schema";
import { makePaymentSessionCommands } from "../../src/modules/payment/service";
import { PaymentSessionCreate, PaymentSessionRootInput, PaymentSessionIds, PaymentCollectionCreate } from "../../src/modules/payment/input";
import { preparePaymentSessionDeletionWorkflow } from "../../src/workflows/payment/delete-sessions";
import { preparePaymentSessionCreationWorkflow } from "../../src/workflows/payment/create-session";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

const stamp = "2026-10-23T00:00:00.000Z";
export const paymentCollectionId = "pay_col_sessions";
export function paymentSessionSeed(id: string, data: JsonObject = {}): { table: string; row: JsonObject } {
  return { table: "payment_session", row: { id, payment_collection_id: paymentCollectionId, currency_code: "usd", amount: "12.5",
    raw_amount: { value: "12.5", precision: 20 }, provider_id: "pp_system_default", data, context: null,
    status: "pending", authorized_at: null, metadata: null, created_at: stamp, updated_at: stamp, deleted_at: null } };
}
export async function prepareLogicalPaymentSessions(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  sessions: readonly { table: string; row: JsonObject }[] = [], shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const definition = await Effect.runPromise(compilePaymentDefinition());
  const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.payment", owner: "medusa", writeProfile: "medusa.payment",
    evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
  }));
  const configuration = { additionalSources: [source] };
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? configuration : { ...configuration, ...shared });
  const errors: string[] = [];
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
    progress() {}, error: message => { errors.push(String(message)); }, failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {}, http() {}, info() {}, warn() {}, log() {} };
  const payment = await Effect.runPromise(makePaymentSessionCommands(logger));
  const initial = [{ table: "payment_collection", row: { id: paymentCollectionId, currency_code: "usd", amount: "12.5", raw_amount: { value: "12.5", precision: 20 },
    authorized_amount: null, raw_authorized_amount: null, captured_amount: null, raw_captured_amount: null,
    refunded_amount: null, raw_refunded_amount: null, completed_at: null, status: "not_paid", metadata: null,
    created_at: stamp, updated_at: stamp, deleted_at: null } }, ...sessions];
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: initial }, 1_048_576,
    { invalidInput: () => new Error("Invalid Payment seed"), hashFailure: cause => new Error("Payment seed hash", { cause }) }));
  const input = { ...fixture.hostInput, commands: payment.commands, identityAndAccessPolicy: { profile: "logical-payment-session-initialization" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "payment-session-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: initial.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializer = await Effect.runPromise(makeCommerceHost(input));
  try { await Effect.runPromise(initializer.initialize(initial)); } finally { await Effect.runPromise(initializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const modules = { payment: { module: payment.workflow, logicalStorage: input.logicalStorage } };
  const options = { execution, modules, logger: payment.loggerResource, revision: "b".repeat(64), subscribers: [{ id: "native-payment-sessions", revision: "c".repeat(64) }] };
  const prepareDelete = async () => { const host = await Effect.runPromise(preparePaymentSessionDeletionWorkflow(options)); close(() => Effect.runPromise(host.close)); return host; };
  const prepareCreate = async () => { const host = await Effect.runPromise(preparePaymentSessionCreationWorkflow(options)); close(() => Effect.runPromise(host.close)); return host; };
  const prepareCreateCollection = async () => {
    const selected = Result.getOrThrow(prepareWorkflowResources({ payment: { module: payment.workflow,
      methods: ["createPaymentCollections"], graph: false } }, true));
    const step = createStep("probe-native-payment-collection", selected.callback(async (data: typeof PaymentCollectionCreate.Type, context) =>
      new StepResponse(await context.resources.payment.createPaymentCollections(data))));
    const flow = createWorkflow("probe-native-payment-collection", (data: WorkflowData<typeof PaymentCollectionCreate.Type>) => new WorkflowResponse(step(data)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, revision: options.revision, subscribers: options.subscribers,
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name: "probePaymentCollectionCreate", resources: selected,
        prepared: Result.getOrThrow(flow.prepare()), input: PaymentCollectionCreate, output: Schema.JsonObject, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareCreateStep = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ payment: { module: payment.workflow,
      methods: ["createPaymentSession", "deletePaymentSession", "listPaymentSessions"], graph: false } }, true, { logger: payment.loggerResource }));
    const flow = createWorkflow("probe-native-payment-session-creation", (data: WorkflowData<typeof PaymentSessionCreate.Type>) =>
      new WorkflowResponse(createPaymentSessionStep(data)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, revision: options.revision, subscribers: options.subscribers,
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name: "probeNativePaymentSessionCreation", resources,
        prepared: Result.getOrThrow(flow.prepare()), input: PaymentSessionCreate, output: Schema.JsonObject, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ payment: { module: payment.workflow,
    methods: ["createPaymentSession", "deletePaymentSession", "listPaymentSessions"], graph: true } }, true, { logger: payment.loggerResource }));
  const prepareLateFailure = async () => {
    const flow = createWorkflow("probe-payment-late-failure", (data: WorkflowData<typeof PaymentSessionRootInput.Type>) => {
      const session = createPaymentSessionsWorkflow.runAsStep({ input: data });
      return new WorkflowResponse(transform(session, () => { throw new Error("Late parent failure after genuine Payment root"); }));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, revision: options.revision, subscribers: options.subscribers,
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name: "probePaymentLateFailure", resources,
        prepared: Result.getOrThrow(flow.prepare()), input: PaymentSessionRootInput, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const deletion = Result.getOrThrow(deletePaymentSessionsWorkflow.prepare()).nodes.find(node => node.name === "delete-payment-sessions");
  if (deletion?.kind !== "step" || deletion.compensate === undefined) throw new Error("Missing native Payment deletion inverse");
  const invokeDeletion = deletion.invoke, compensateDeletion = deletion.compensate;
  const prepareRetainedDeletion = async (inverse = false) => {
    const step = createStep("probe-payment-retained-deletion", resources.callback(async (data: unknown, context) => {
      if (inverse) { await compensateDeletion(data, context); return new StepResponse(null); }
      const response = await invokeDeletion({ ids: Schema.decodeUnknownSync(PaymentSessionIds)(data) }, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine Payment deletion response");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }));
    const flow = createWorkflow("probe-payment-retained-deletion", (data: WorkflowData<unknown>) => new WorkflowResponse(step(data)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, revision: options.revision, subscribers: options.subscribers,
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name: "probePaymentRetainedDeletion", resources,
        prepared: Result.getOrThrow(flow.prepare()), input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareRetainedCreation = async (inverse = false) => {
    const native = createWorkflow("probe-payment-creation-callback", (data: WorkflowData<typeof PaymentSessionCreate.Type>) => new WorkflowResponse(createPaymentSessionStep(data)));
    const creation = Result.getOrThrow(native.prepare()).nodes.find(node => node.name === "create-payment-session");
    if (creation?.kind !== "step" || creation.compensate === undefined) throw new Error("Missing native Payment creation inverse");
    const invoke = creation.invoke, compensate = creation.compensate;
    const step = createStep("probe-payment-retained-creation", resources.callback(async (data: unknown, context) => {
      if (inverse) { await compensate(data, context); return new StepResponse(null); }
      const response = await invoke(Schema.decodeUnknownSync(PaymentSessionCreate)(data), context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine Payment creation response");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }));
    const flow = createWorkflow("probe-payment-retained-creation", (data: WorkflowData<unknown>) => new WorkflowResponse(step(data)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, revision: options.revision, subscribers: options.subscribers,
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name: "probePaymentRetainedCreation", resources,
        prepared: Result.getOrThrow(flow.prepare()), input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const read = async () => {
    const inventory = await logicalCurrencyInventory(fixture), rows: JsonObject[] = [], scope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    for (const current of inventory.rows) {
      if (current.scopeUuid !== scope) continue;
      const revision = inventory.revisions.find(row => row.scopeUuid === scope && row.tableId === current.tableId && row.commitSeq === current.commitSeq &&
        Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (revision === undefined || revision.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: revision.valueBytes, sha256: revision.valueSha256, profile: "appDocument" });
      const row = Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson);
      if (typeof row.id === "string" && (row.id === paymentCollectionId || row.id.startsWith("payses"))) rows.push(projectNativeRow(row));
    }
    return rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };
  return { fixture, payment, options, modules, execution, errors, prepareDelete, prepareCreate, prepareCreateCollection, prepareCreateStep, prepareLateFailure, prepareRetainedDeletion, prepareRetainedCreation,
    read, snapshot: () => logicalCurrencyInventory(fixture) };
}
