import { randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createLocationFulfillmentSetWorkflow } from "@medusajs/core-flows/stock-location/create-location-fulfillment-set";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileStockLocationCoreDefinition } from "../../src/modules/stock-location/schema";
import { compileServiceZoneCreationCoreDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { compileLocationFulfillmentSetLinkCoreDefinition } from "../../src/links/location-fulfillment-set-schema";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { makeFulfillmentSetCreationCommands } from "../../src/modules/fulfillment/fulfillment-set-create-service";
import { prepareLocationFulfillmentSetLink } from "../../src/links/location-fulfillment-set-service";
import { prepareLocationFulfillmentSetCreationWorkflow, LocationFulfillmentSetCreationInput } from "../../src/workflows/stock-location/create-location-fulfillment-set";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { locationFulfillmentSetCreationResources } from "../../src/workflow/policy";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";

const prepared = Result.getOrThrow(createLocationFulfillmentSetWorkflow.prepare());
function retained(name: string) {
  const node = prepared.nodes.find(node => node.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine native linked-creation retained callback: " + name);
  return node.compensate;
}
const undoCreate = retained("create-fulfillment-sets"), undoAssociation = retained("associate-fulfillment-sets-with-location-step");
const stamp = "2026-10-18T00:00:00.000Z", managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
export const linkedCreationLocations = { active: "sloc137-active", historical: "sloc137-historical", missing: "sloc137-missing" };

export async function prepareCoreLocationFulfillmentSetCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Readonly<{ physical: CorePersistenceFixture }>) {
  const target = Object.freeze({ scopeUuid: randomUUID(), epochUuid: randomUUID() });
  const fulfillmentDefinition = await Effect.runPromise(compileServiceZoneCreationCoreDefinition(target));
  const linkDefinition = await Effect.runPromise(compileLocationFulfillmentSetLinkCoreDefinition(target));
  const stockDefinition = await Effect.runPromise(compileStockLocationCoreDefinition(target));
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const fulfillment = await Effect.runPromise(makeFulfillmentSetCreationCommands());
  const link = await Effect.runPromise(prepareLocationFulfillmentSetLink()), stock = await Effect.runPromise(makeStockLocationCommands());
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition,
    ...(shared === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(shared.physical) }),
    sources: [
      { name: "fulfillment", definition: fulfillmentDefinition, initialCommands: fulfillment.commands, rows: [
        { table: "fulfillment_set", row: { id: "set137-reserved", name: "Reserved Set137", type: "shipping", metadata: null, ...managed } },
        { table: "fulfillment_set", row: { id: "set137-history", name: "Reusable Set137", type: "shipping", metadata: null, ...managed, deleted_at: stamp } },
      ] },
      { name: "locationLinks", initializationStepId: "location-links-initial", definition: linkDefinition, initialCommands: link.commands, rows: [] },
      { name: "stock_location", definition: stockDefinition, initialCommands: stock.commands, rows: [
        { table: "stock_location", row: { id: linkedCreationLocations.active, name: "Active", address_id: null, metadata: null, ...managed } },
        { table: "stock_location", row: { id: linkedCreationLocations.historical, name: "Historical", address_id: null, metadata: null, ...managed, deleted_at: stamp } },
      ] },
    ],
  });
  close(fixture.close);
  const execution = fixture.execution;
  const modules = {
    fulfillment: { module: fulfillment.workflow, nativeStorage: fixture.source("fulfillment"), logicalResources: locationFulfillmentSetCreationResources },
    locationLinks: { module: link.workflow, nativeStorage: fixture.source("locationLinks"), logicalResources: locationFulfillmentSetCreationResources },
  };
  const options = { execution, modules, link: link.resource, revision: "7".repeat(64), subscribers: [{ id: "native-linked-set-create", revision: "7".repeat(64) }] };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareLocationFulfillmentSetCreationWorkflow({ ...options, revision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({
    fulfillment: { module: fulfillment.workflow, methods: ["createFulfillmentSets", "deleteFulfillmentSets"], graph: false },
    locationLinks: { module: link.workflow, methods: ["create", "list", "dismiss"], graph: false, expose: false },
  }, true, { link: link.resource }));
  const prepareRoundtrip = async (actualRetained: () => { readonly creation: unknown; readonly association: unknown }, lateFailure = false) => {
    const undo = createStep("probe-linked-set-actual-retained-inverse", resources.callback(async (_input: null, context) => {
      const actual = actualRetained();
      await undoAssociation(actual.association, context); await undoCreate(actual.creation, context);
      if (lateFailure) throw new Error("Late genuine linked Set inverse failure");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-linked-set-root-and-retained-inverse", (value: WorkflowData<typeof LocationFulfillmentSetCreationInput.Type>) => {
      const root = createLocationFulfillmentSetWorkflow.runAsStep({ input: value });
      return new WorkflowResponse(undo(transform(root, () => null)));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued",
      requestCallLimit: locationFulfillmentSetCreationResources.calls, requestEventLimit: locationFulfillmentSetCreationResources.eventMessages,
      workflow: { name: "probeLinkedSetRootAndRetainedInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: LocationFulfillmentSetCreationInput, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  return { fixture, fulfillment, link, options, modules, execution, resources, prepare, prepareRoundtrip,
    read: () => fixture.readRows(), snapshot: () => fixture.snapshot() };
}
