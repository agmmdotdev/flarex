import { randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateShippingProfilesWorkflow } from "@medusajs/core-flows/fulfillment/update-shipping-profiles";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { compileServiceZoneCreationCoreDefinition, compileShippingProfileCoreDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { makeShippingProfileUpdateCommands } from "../../src/modules/fulfillment/shipping-profile-update-service";
import { ShippingProfileUpdateInput } from "../../src/modules/fulfillment/shipping-profile-update-input";
import { makeServiceZoneCreationCommands } from "../../src/modules/fulfillment/service-zone-create-service";
import { prepareServiceZoneCreationWorkflow } from "../../src/workflows/fulfillment/create-service-zones";
import { prepareShippingProfileUpdateWorkflow } from "../../src/workflows/fulfillment/update-shipping-profiles";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";
import { orderFixtureHosts } from "./core-order-fixture";
import { fulfillmentForestRows, serviceZoneDeletionGraph } from "./native-fulfillment-graph-fixture";

const native = Result.getOrThrow(updateShippingProfilesWorkflow.prepare());
const step = native.nodes.find(node => node.name === "update-shipping-profiles");
if (step?.kind !== "step" || step.compensation !== "transactionCovered" || step.compensate === undefined)
  throw new Error("Missing genuine ShippingProfile retained callback");
const invoke = step.invoke, compensate = step.compensate;
export const shippingProfileSeedTime = "2026-01-01T00:00:00.000Z";

export function shippingProfileUpdateSeed(id: string, metadata: JsonObject | null = { retained: true, remove: "old", nested: { old: true } }, deleted = false): JsonObject {
  return { id, name: " Original " + id + " ", type: "Original TYPE", metadata, created_at: shippingProfileSeedTime,
    updated_at: shippingProfileSeedTime, deleted_at: deleted ? shippingProfileSeedTime : null };
}

export async function prepareCoreShippingProfileUpdate(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  initial: readonly JsonObject[], shared?: CorePersistenceFixture) {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const [definition, eventDefinition, fulfillment] = await Effect.runPromise(Effect.all([
    compileShippingProfileCoreDefinition(target), compileCoreNativeEventStorageDefinition(target), makeShippingProfileUpdateCommands(),
  ]));
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition,
    ...(shared === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(shared) }), sources: [
      { name: "fulfillment", definition, initialCommands: fulfillment.commands,
        rows: initial.map(row => ({ table: "shipping_profile", row })) },
    ] });
  close(fixture.close);
  const { own, closeCaseHosts } = orderFixtureHosts(close);
  const execution = fixture.execution, installed = { module: fulfillment.workflow, nativeStorage: fixture.source("fulfillment") };
  const options: Parameters<typeof prepareShippingProfileUpdateWorkflow>[0] = { execution, fulfillment: installed,
    revision: "6".repeat(64), subscribers: [{ id: "native-shipping-profile-update", revision: "7".repeat(64) }] };
  const prepare = async (revision = options.revision) => own(await Effect.runPromise(prepareShippingProfileUpdateWorkflow({ ...options, revision })));
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["listShippingProfiles", "updateShippingProfiles", "upsertShippingProfiles"], graph: false } }, true));
  const prepareRoundtrip = async (lateFailure?: Error) => {
    const Output = Schema.Struct({ output: fulfillment.output, preimages: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)) });
    const roundtrip = createStep("probe-native-shipping-profile-update-roundtrip", resources.callback(async (input: typeof ShippingProfileUpdateInput.Type, context) => {
      const response = await invoke(input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine ShippingProfile StepResponse");
      await compensate(response.compensateInput, context);
      if (lateFailure !== undefined) throw lateFailure;
      return { output: response.output, preimages: response.compensateInput };
    }));
    const workflow = createWorkflow("probe-native-shipping-profile-update-roundtrip", (input: WorkflowData<typeof ShippingProfileUpdateInput.Type>) => new WorkflowResponse(roundtrip(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { fulfillment: installed },
      revision: options.revision, subscribers: options.subscribers,
      workflow: { name: "probeNativeShippingProfileUpdateRoundtrip", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: ShippingProfileUpdateInput, output: Output, events: internalModuleWorkflowEvents } })));
  };
  const prepareAbsentInverse = async () => {
    const undo = createStep("probe-native-shipping-profile-empty-inverses", resources.callback(async (_input: null, context) => {
      await compensate(undefined, context); await compensate([], context); return new StepResponse(null);
    }));
    const workflow = createWorkflow("probe-native-shipping-profile-empty-inverses", (input: WorkflowData<null>) => new WorkflowResponse(undo(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { fulfillment: installed },
      revision: options.revision, subscribers: options.subscribers,
      workflow: { name: "probeNativeShippingProfileEmptyInverses", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const read = (ids: readonly string[]) => fixture.readRows("fulfillment", ids);
  return { fixture, definition, fulfillment, installed, options, prepare, prepareRoundtrip, prepareAbsentInverse, closeCaseHosts, read,
    snapshot: fixture.snapshot };
}

/** The existing Service Zone and Profile profiles share the same issued source. */
export async function prepareCoreShippingProfileZoneComposition(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared: CorePersistenceFixture) {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const [definition, eventDefinition, zone, profile] = await Effect.runPromise(Effect.all([
    compileServiceZoneCreationCoreDefinition(target), compileCoreNativeEventStorageDefinition(target),
    makeServiceZoneCreationCommands(), makeShippingProfileUpdateCommands(),
  ]));
  const graph = serviceZoneDeletionGraph("zone-protected", { geos: 1, options: 1, rules: 1 });
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition, physical: await shareCoreNativeWorkflowPhysical(shared), sources: [
    { name: "fulfillment", definition, initialCommands: zone.commands, rows: fulfillmentForestRows([graph], true) },
  ] });
  close(fixture.close);
  const { own } = orderFixtureHosts(close);
  const execution = fixture.execution, nativeStorage = fixture.source("fulfillment");
  const create = own(await Effect.runPromise(prepareServiceZoneCreationWorkflow({ execution,
    modules: { fulfillment: { module: zone.workflow, nativeStorage } }, revision: "a".repeat(64),
    subscribers: [{ id: "native-service-zone-create", revision: "a".repeat(64) }] })));
  const update = own(await Effect.runPromise(prepareShippingProfileUpdateWorkflow({ execution,
    fulfillment: { module: profile.workflow, nativeStorage }, revision: "b".repeat(64),
    subscribers: [{ id: "native-service-zone-profile-update", revision: "b".repeat(64) }] })));
  return { fixture, create, update, protectedIds: graph.allIds };
}
