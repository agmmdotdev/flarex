import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createLocationFulfillmentSetWorkflow } from "@medusajs/core-flows/stock-location/create-location-fulfillment-set";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { makeFulfillmentSetCreationCommands } from "../../src/modules/fulfillment/fulfillment-set-create-service";
import { prepareLocationFulfillmentSetLink } from "../../src/links/location-fulfillment-set-service";
import { prepareLocationFulfillmentSetCreationWorkflow, LocationFulfillmentSetCreationInput } from "../../src/workflows/stock-location/create-location-fulfillment-set";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { locationFulfillmentSetCreationResources } from "../../src/workflow/policy";
import { projectNativeRow } from "../../src/repository/result";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

const prepared = Result.getOrThrow(createLocationFulfillmentSetWorkflow.prepare());
function retained(name: string) {
  const node = prepared.nodes.find(node => node.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine native linked-creation retained callback: " + name);
  return node.compensate;
}
const undoCreate = retained("create-fulfillment-sets"), undoAssociation = retained("associate-fulfillment-sets-with-location-step");
const stamp = "2026-10-18T00:00:00.000Z";
const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
export const linkedCreationLocations = { active: "sloc137-active", historical: "sloc137-historical", missing: "sloc137-missing" };

export async function prepareLogicalLocationFulfillmentSetCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const configuration = { includeShippingProfile: true, includeServiceZoneCreation: true,
    includeStockLocation: true, includeLocationFulfillmentSetLink: true };
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? configuration : { ...configuration, ...shared });
  const fulfillment = await Effect.runPromise(makeFulfillmentSetCreationCommands());
  const link = await Effect.runPromise(prepareLocationFulfillmentSetLink()), stock = await Effect.runPromise(makeStockLocationCommands());
  const fulfillmentDefinition = fixture.shippingProfileDefinition, linkDefinition = fixture.locationFulfillmentSetLinkDefinition,
    stockDefinition = fixture.stockLocationDefinition;
  if (fulfillmentDefinition === undefined || fulfillmentDefinition.schema.tables.length !== 8 || linkDefinition === undefined || stockDefinition === undefined)
    throw new Error("Missing authenticated Location/Fulfillment/Link composition");
  const initialize = async (key: string, definition: typeof fulfillmentDefinition, commands: LogicalCommerceHostInput<unknown>["commands"],
    rows: readonly { readonly table: string; readonly row: JsonObject }[]) => {
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows }, 1_048_576,
      { invalidInput: () => new Error("Invalid linked-creation seed"), hashFailure: cause => new Error("Linked creation seed hash", { cause }) }));
    const input = { ...fixture.hostInput, commands, identityAndAccessPolicy: { profile: key + ".linked-create-test" },
      logicalStorage: { ...fixture.hostInput.logicalStorage,
        source: { sourceKey: key, writeProfile: key, schema: definition.schema, evidence: definition.provenance },
        initialization: { stepId: key.toLowerCase() + ".linked-create-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length } },
    } satisfies LogicalCommerceHostInput<unknown>;
    const host = await Effect.runPromise(makeCommerceHost(input));
    try { await Effect.runPromise(host.initialize(rows)); } finally { await Effect.runPromise(host.close); }
    return input.logicalStorage;
  };
  const fulfillmentStorage = await initialize("medusa.shippingProfile", fulfillmentDefinition, fulfillment.commands, [
    { table: "fulfillment_set", row: { id: "set137-reserved", name: "Reserved Set137", type: "shipping", metadata: null, ...managed } },
    { table: "fulfillment_set", row: { id: "set137-history", name: "Reusable Set137", type: "shipping", metadata: null, ...managed, deleted_at: stamp } },
  ]);
  const linkStorage = await initialize("medusa.link.locationFulfillmentSet", linkDefinition, link.commands, []);
  await initialize("medusa.stockLocation", stockDefinition, stock.commands, [
    { table: "stock_location", row: { id: linkedCreationLocations.active, name: "Active", address_id: null, metadata: null, ...managed } },
    { table: "stock_location", row: { id: linkedCreationLocations.historical, name: "Historical", address_id: null, metadata: null, ...managed, deleted_at: stamp } },
  ]);
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const modules = { fulfillment: { module: fulfillment.workflow, logicalStorage: fulfillmentStorage, logicalResources: locationFulfillmentSetCreationResources },
    locationLinks: { module: link.workflow, logicalStorage: linkStorage, logicalResources: locationFulfillmentSetCreationResources } };
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
      await undoAssociation(actual.association, context);
      await undoCreate(actual.creation, context);
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
  const read = async () => {
    const inventory = await logicalCurrencyInventory(fixture), scope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    const result: JsonObject[] = [];
    for (const current of inventory.rows) {
      if (current.scopeUuid !== scope) continue;
      const revision = inventory.revisions.find(row => row.scopeUuid === scope && row.tableId === current.tableId && row.commitSeq === current.commitSeq
        && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (revision === undefined || revision.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: revision.valueBytes, sha256: revision.valueSha256, profile: "appDocument" });
      const row = Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson);
      if (typeof row.id === "string") result.push(projectNativeRow(row));
    }
    return result;
  };
  return { fixture, fulfillment, link, options, modules, execution, resources, prepare, prepareRoundtrip, read,
    snapshot: () => logicalCurrencyInventory(fixture) };
}
