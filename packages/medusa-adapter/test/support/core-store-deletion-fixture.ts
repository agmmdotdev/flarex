import { createHash, randomUUID } from "node:crypto";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileStoreCoreDefinition } from "../../src/modules/store/schema";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteStoresWorkflow } from "@medusajs/core-flows/store/delete-stores";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { makeStoreDeletionCommands } from "../../src/modules/store/delete-service";
import { makeStoreGuardCommands } from "../../src/modules/store/service";
import { prepareStoreDeletionLinkResource } from "../../src/links/store-deletion";
import { prepareStoreDeletionWorkflow, StoreDeletionInput } from "../../src/workflows/store/delete";

const revision = (name: string) => createHash("sha256").update(name).digest("hex");
export { storeDeletionGraph } from "./core-store-graph";
import type { StoreDeletionInitialRow } from "./core-store-graph";

const deletion = Result.getOrThrow(deleteStoresWorkflow.prepare());
function nativeCompensator(name: string) {
  const node = deletion.nodes.find(node => node.name === name);
  if (node === undefined || node.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing retained native Store compensator " + name);
  return node.compensate;
}
const restoreStores = nativeCompensator("delete-stores"), restoreLinks = nativeCompensator("remove-remote-links");

export async function prepareCoreStoreDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly StoreDeletionInitialRow[], options: Readonly<{ physical?: CorePersistenceFixture }> = {}) {
  const store = await Effect.runPromise(makeStoreDeletionCommands());
  // Seed all parents before either child family. Adjacent canonical rows share
  // the existing initializer's bounded batch; graph interleaving would spend
  // its call budget repeatedly switching among these same three tables.
  const orderedRows = ["store", "store_currency", "store_locale"].flatMap(table => rows.filter(value => value.table === table));
  if (orderedRows.length !== rows.length) throw new Error("Unknown Store fixture table");
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const definition = await Effect.runPromise(compileStoreCoreDefinition(target));
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const physical = options.physical === undefined ? undefined : await shareCoreNativeWorkflowPhysical(options.physical);
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition, sources: [
    { name: "store", definition, initialCommands: store.commands, rows: orderedRows },
  ], ...(physical === undefined ? {} : { physical }) });
  close(fixture.close);
  const execution = fixture.execution;
  const modules = { store: { module: store.workflow, nativeStorage: fixture.source("store") } };
  const link = Result.getOrThrow(prepareStoreDeletionLinkResource());
  const workflowOptions = { execution, modules, link, revision: revision("native-store-deletion"),
    subscribers: [{ id: "native-store-deletion", revision: "a".repeat(64) }] };
  const prepare = async (selectedRevision = workflowOptions.revision) => {
    const host = await Effect.runPromise(prepareStoreDeletionWorkflow({ ...workflowOptions, revision: selectedRevision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const readDefaultChannelGuard = async () => {
    const guard = await Effect.runPromise(makeStoreGuardCommands());
    const host = await fixture.run(fixture.openReadHost("store", guard.commands));
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
  const read = async (ids: readonly string[], withDeleted = true) =>
    (await fixture.readRows("store", ids)).filter(row => withDeleted || row.deleted_at === null);
  return { fixture, store, options: workflowOptions, prepare, prepareRestore, read, readDefaultChannelGuard,
    snapshot: fixture.snapshot };
}
