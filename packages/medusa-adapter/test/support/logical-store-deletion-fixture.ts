import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteStoresWorkflow } from "@medusajs/core-flows/store/delete-stores";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { makeStoreDeletionCommands } from "../../src/modules/store/delete-service";
import { makeStoreGuardCommands } from "../../src/modules/store/service";
import { prepareStoreDeletionLinkResource } from "../../src/links/store-deletion";
import { prepareStoreDeletionWorkflow, StoreDeletionInput } from "../../src/workflows/store/delete";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

const revision = (name: string) => createHash("sha256").update(name).digest("hex");
const stamp = "2026-10-17T00:00:00.000Z";
export type StoreDeletionInitialRow = Readonly<{ table: string; row: JsonObject }>;

/** Canonical fixture data, not an admitted native Store creation operation. */
export function storeDeletionGraph(prefix: string, count = 1, currencyCount = 1, localeCount = 1,
  history: Readonly<{ currencies?: number; locales?: number; stores?: boolean }> = {}) {
  const stores = Array.from({ length: count }, (_, index) => `${prefix}-store-${index}`);
  const currencies = stores.flatMap(id => Array.from({ length: currencyCount }, (_, index) => `${id}-currency-${index}`));
  const locales = stores.flatMap(id => Array.from({ length: localeCount }, (_, index) => `${id}-locale-${index}`));
  const managed = (deleted: boolean) => ({ created_at: stamp, updated_at: stamp, deleted_at: deleted ? stamp : null });
  const rows: StoreDeletionInitialRow[] = stores.flatMap(id => [
    { table: "store", row: { id, name: id, default_sales_channel_id: "protected-channel",
      default_region_id: "protected-region", default_location_id: "protected-location",
      metadata: { fixture: prefix }, ...managed(history.stores === true) } },
    ...Array.from({ length: currencyCount }, (_, index) => ({ table: "store_currency", row: {
      id: `${id}-currency-${index}`, store_id: id, currency_code: `currency-${index}`,
      is_default: index === 0, ...managed(index < (history.currencies ?? 0)) } })),
    ...Array.from({ length: localeCount }, (_, index) => ({ table: "store_locale", row: {
      id: `${id}-locale-${index}`, store_id: id, locale_code: `locale-${index}`,
      ...managed(index < (history.locales ?? 0)) } })),
  ]);
  return { stores, currencies, locales, rows };
}

const deletion = Result.getOrThrow(deleteStoresWorkflow.prepare());
function nativeCompensator(name: string) {
  const node = deletion.nodes.find(node => node.name === name);
  if (node === undefined || node.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing retained native Store compensator " + name);
  return node.compensate;
}
const restoreStores = nativeCompensator("delete-stores"), restoreLinks = nativeCompensator("remove-remote-links");

export async function prepareLogicalStoreDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly StoreDeletionInitialRow[], options?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const fixture = await logicalCurrencyFixture(driver, close, options === undefined ? { includeStore: true }
    : { includeStore: true, resource: options.resource, fixtureIdentity: options.fixtureIdentity });
  const store = await Effect.runPromise(makeStoreDeletionCommands());
  const definition = fixture.storeDefinition;
  if (definition === undefined) throw new Error("Missing complete native Store definition");
  // Seed all parents before either child family. Adjacent canonical rows share
  // the existing initializer's bounded batch; graph interleaving would spend
  // its call budget repeatedly switching among these same three tables.
  const orderedRows = ["store", "store_currency", "store_locale"].flatMap(table => rows.filter(value => value.table === table));
  if (orderedRows.length !== rows.length) throw new Error("Unknown Store fixture table");
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1,
    rows: orderedRows.map(value => ({ table: value.table, row: value.row })) }, 1_048_576,
  { invalidInput: () => new Error("Invalid Store deletion seed"), hashFailure: cause => new Error("Store seed hash", { cause }) }));
  const hostInput = { ...fixture.hostInput, commands: store.commands,
    identityAndAccessPolicy: { profile: "logical-store-deletion-initialization" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: "medusa.store", writeProfile: "medusa.store", schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "store-deletion-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializer = await Effect.runPromise(makeCommerceHost(hostInput));
  try { await Effect.runPromise(initializer.initialize(orderedRows.map(value => ({ table: value.table, row: value.row })))); }
  finally { await Effect.runPromise(initializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const modules = { store: { module: store.workflow, logicalStorage: hostInput.logicalStorage } };
  const link = Result.getOrThrow(prepareStoreDeletionLinkResource());
  const workflowOptions = { execution, modules, link, revision: revision("native-store-deletion"),
    subscribers: [{ id: "native-store-deletion", revision: "a".repeat(64) }] };
  const prepare = async (selectedRevision = workflowOptions.revision) => {
    const host = await Effect.runPromise(prepareStoreDeletionWorkflow({ ...workflowOptions, revision: selectedRevision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const readDefaultChannelGuard = async () => {
    const guard = await Effect.runPromise(makeStoreGuardCommands());
    const host = await Effect.runPromise(makeCommerceHost({ ...hostInput, commands: guard.commands }));
    try {
      return await Effect.runPromise(host.read(guard.list, { filters: { default_sales_channel_id: ["protected-channel"] },
        config: { select: ["default_sales_channel_id"] } }));
    } finally { await Effect.runPromise(host.close); }
  };
  // Explicitly invoke retained native callbacks in a fresh atomic probe. The
  // production atomic runtime does not independently invoke compensators.
  const prepareRestore = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({
      store: { module: store.workflow, methods: ["softDeleteStores", "restoreStores"], graph: false },
    }, true, { link }));
    const restore = createStep("invoke-retained-store-compensators", resources.callback(async (input: typeof StoreDeletionInput.Type, context) => {
      await restoreStores([...input.ids], context);
      await restoreLinks({ store: { store_id: [...input.ids] } }, context);
      return new StepResponse(null);
    }));
    const workflow = createWorkflow("probe-retained-store-compensation", (input: WorkflowData<typeof StoreDeletionInput.Type>) =>
      new WorkflowResponse(restore(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, operationScheduling: "queued",
      revision: revision("retained-store-compensation-probe"), subscribers: [{ id: "retained-store-compensation-probe", revision: "b".repeat(64) }],
      workflow: { name: "probeRetainedStoreCompensation", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: StoreDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  /** Read committed canonical evidence only; grants no Store service method. */
  const read = async (ids: readonly string[], withDeleted = true) => {
    const inventory = await logicalCurrencyInventory(fixture), selected = new Set(ids);
    const found: JsonObject[] = [];
    for (const current of inventory.rows) {
      if (current.scopeUuid !== projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid) continue;
      const value = inventory.revisions.find(row => row.scopeUuid === current.scopeUuid && row.tableId === current.tableId
        && row.commitSeq === current.commitSeq && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (value === undefined || value.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: value.valueBytes,
        sha256: value.valueSha256, profile: "appDocument" });
      const row = Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson);
      if (typeof row.id === "string" && selected.has(row.id) && (withDeleted || row.deleted_at === null)) found.push(row);
    }
    return found.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  };
  return { fixture, store, options: workflowOptions, prepare, prepareRestore, read, readDefaultChannelGuard,
    snapshot: () => logicalCurrencyInventory(fixture) };
}
