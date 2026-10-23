import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { archiveOrderWorkflow } from "@medusajs/core-flows/order/archive-orders";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { canonicalizeJsonOutcome } from "../../../persistence-postgres/src/values/jsonOutcome";
import { fxSystemIdempotency } from "../../../persistence-postgres/src/database/schema";
import { compileOrderDefinition } from "../../src/modules/order/schema";
import { makeOrderArchiveCommands } from "../../src/modules/order/service";
import { OrderArchiveInput, OrderArchiveStatuses, decodeOrderArchiveIds, decodeOrderArchiveStatuses } from "../../src/modules/order/input";
import { prepareOrderArchiveWorkflow } from "../../src/workflows/order/archive-orders";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents, orderedWorkflowIdEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

export type OrderInitialRow = Readonly<{ table: string; row: JsonObject }>;
export const orderArchiveStamp = "2020-02-03T04:05:06.000Z";
export const orderArchiveIds = ["order173-d", "order173-b", "order173-c", "order173-a"] as const;
export type OrderArchiveWorkflowInput = typeof OrderArchiveInput.Type;
const native = Result.getOrThrow(archiveOrderWorkflow.prepare());
const node = native.nodes.find(value => value.name === "archive-orders");
if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
  throw new Error("Missing genuine retained native Order archive callbacks");
const retained = { invoke: node.invoke, compensate: node.compensate };

/** Explicit existing native serial values. This seed grants no Order creation
 * or serial allocation capability and contains no fixture business algorithm. */
export function orderArchiveRows(): readonly OrderInitialRow[] {
  return orderArchiveIds.map((id, index) => ({ table: "order", row: {
    id, display_id: 300 + index, custom_display_id: "existing-" + id, region_id: "reg-existing", customer_id: "cus-existing",
    version: index + 1, sales_channel_id: "sc-existing", status: index === 1 ? "canceled" : index === 2 ? "draft" : "completed",
    is_draft_order: index === 2, email: `existing-${index}@example.invalid`, currency_code: index % 2 ? "eur" : "usd",
    locale: "en-US", no_notification: index % 2 === 0, metadata: { ordinal: index, preserved: { owner: id } },
    canceled_at: index === 1 ? orderArchiveStamp : null, shipping_address_id: null, billing_address_id: null,
    created_at: orderArchiveStamp, updated_at: orderArchiveStamp, deleted_at: null,
  } }));
}

export async function prepareLogicalOrderArchive(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly OrderInitialRow[] = orderArchiveRows(),
  shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const definition = await Effect.runPromise(compileOrderDefinition());
  const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.order", owner: "medusa", writeProfile: "medusa.order",
    evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })) }));
  const configuration = { additionalSources: [source] };
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? configuration : { ...configuration, ...shared });
  const order = await Effect.runPromise(makeOrderArchiveCommands());
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows },
    1_048_576, { invalidInput: () => new Error("Invalid existing Order seed"), hashFailure: cause => new Error("Order seed hash", { cause }) }));
  const input = { ...fixture.hostInput, commands: order.commands, identityAndAccessPolicy: { profile: "logical-order-archive-initialization" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "order-archive-existing-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializer = await Effect.runPromise(makeCommerceHost(input));
  try { await Effect.runPromise(initializer.initialize(rows)); } finally { await Effect.runPromise(initializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const modules = { order: { module: order.workflow, logicalStorage: input.logicalStorage } }, revision = "3".repeat(64);
  const options: Parameters<typeof prepareOrderArchiveWorkflow>[0] = { execution, modules, revision,
    subscribers: [{ id: "native-order-archive-173", revision }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ order: { module: order.workflow,
    methods: ["listOrders", "archive", "updateOrders"], graph: false } }, true));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { hosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepare = async () => own(await Effect.runPromise(prepareOrderArchiveWorkflow(options)));
  const prepareForward = async (roundtrip = false) => {
    const step = createStep("probe173-real-archive-forward", resources.callback(async (value: OrderArchiveWorkflowInput, context) => {
      const response = await retained.invoke(value, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine Order archive StepResponse");
      const statuses = Result.getOrThrow(decodeOrderArchiveStatuses(response.compensateInput));
      if (roundtrip) await retained.compensate(response.compensateInput, context);
      return { output: response.output, statuses };
    }));
    const flow = createWorkflow("probe173-real-archive-forward-root", (value: WorkflowData<OrderArchiveWorkflowInput>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderArchiveForward", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderArchiveInput,
        output: Schema.Struct({ output: order.contracts.Output, statuses: OrderArchiveStatuses }), events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async () => {
    const step = createStep("probe173-real-archive-inverse", resources.callback(async (statuses: typeof OrderArchiveStatuses.Type, context) => {
      await retained.compensate(statuses, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe173-real-archive-inverse-root", (value: WorkflowData<typeof OrderArchiveStatuses.Type>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderArchiveInverse", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderArchiveStatuses,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const lateFailure = new Error("Late parent failure after genuine native Order archive");
  const prepareLateFailure = async () => {
    const fail = createStep("probe173-late-order-parent", resources.callback(async (_output: unknown) => { throw lateFailure; }));
    const flow = createWorkflow("probe173-late-order-parent-root", (value: WorkflowData<OrderArchiveWorkflowInput>) =>
      new WorkflowResponse(fail(archiveOrderWorkflow.runAsStep({ input: value }))));
    const events = orderedWorkflowIdEvents("order.archived", Effect.fn("OrderProbe.archivedIds")(function* (calls) {
      const archived = calls.calls(order.workflow.methods.archive);
      if (archived.length !== 1) throw new Error("Missing genuine Order archive call");
      return yield* Effect.fromResult(decodeOrderArchiveIds(archived[0]?.input));
    }));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderArchiveLateParent", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderArchiveInput,
        output: order.contracts.Output, events } })));
  };
  const snapshot = () => logicalCurrencyInventory(fixture);
  const read = async (selected?: readonly string[]) => {
    const inventory = await snapshot(), output: JsonObject[] = [];
    const scopeUuid = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    for (const row of inventory.rows) {
      if (row.scopeUuid !== scopeUuid) continue;
      const version = inventory.revisions.find(value => value.scopeUuid === row.scopeUuid && value.tableId === row.tableId &&
        value.commitSeq === row.commitSeq && Buffer.from(value.rowId).equals(Buffer.from(row.rowId)));
      if (version === undefined || version.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: version.valueBytes, sha256: version.valueSha256, profile: "appDocument" });
      const value = projectNativeRow(Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson));
      if (typeof value.id === "string" && (selected === undefined ? value.id.startsWith("order173-") : selected.includes(value.id))) output.push(value);
    }
    return output.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  };
  /** Fault only one genuine committed JSON result using its canonical owner.
   * Request identity, commit linkage, rows and events remain untouched. Restore
   * the original evidence even when the replay assertion fails. */
  const withStoredOrderResult = async (key: string, value: unknown, work: () => Promise<void>) => {
    const db = fixture.persistence.drizzle, scopeUuid = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    const requestKey = Schema.decodeUnknownSync(TransactionRequestKeyV1Schema)(key);
    const match = and(eq(fxSystemIdempotency.scopeUuid, scopeUuid), eq(fxSystemIdempotency.requestKey, requestKey));
    const [original] = await db.select().from(fxSystemIdempotency).where(match);
    if (original?.resultState !== "available" || original.resultEncoding !== "json" || original.resultBytes === null
      || original.resultSha256 === null || original.resultSemanticBytes === null) throw new Error("Missing genuine committed Order JSON result");
    const canonical = Result.getOrThrow(canonicalizeJsonOutcome(value)), bytes = canonical.canonicalBytes;
    await db.update(fxSystemIdempotency).set({ resultBytes: bytes, resultSha256: createHash("sha256").update(bytes).digest(),
      resultSemanticBytes: canonical.semanticSizeBytes }).where(match);
    try { await work(); }
    finally { await db.update(fxSystemIdempotency).set({ resultBytes: original.resultBytes,
      resultSha256: original.resultSha256, resultSemanticBytes: original.resultSemanticBytes }).where(match); }
  };
  return { fixture, definition, order, options, modules, execution, resources, lateFailure, prepare, prepareForward, prepareInverse,
    prepareLateFailure, closeCaseHosts, snapshot, read, withStoredOrderResult };
}
