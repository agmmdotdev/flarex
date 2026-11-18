import { createHash, randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateShippingOptionTypesWorkflow } from "@medusajs/core-flows/shipping-options/update-shipping-option-types";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { compileServiceZoneCreationCoreDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { makeShippingOptionTypeUpdateCommands } from "../../src/modules/fulfillment/shipping-option-type-update-service";
import { ShippingOptionTypeUpdateInput, ShippingOptionTypeUpsertRows } from "../../src/modules/fulfillment/shipping-option-type-update-input";
import { prepareShippingOptionTypeUpdateWorkflow, type ShippingOptionTypeUpdateHooks } from "../../src/workflows/fulfillment/update-shipping-option-types";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";
import { orderFixtureHosts } from "./core-order-fixture";
import { shippingProfileOptionParents, shippingProfileDeletionSeedTime } from "./shipping-profile-seeds";

const revision = (name: string) => createHash("sha256").update(name).digest("hex");
export const shippingOptionTypeUpdateSeedTime = shippingProfileDeletionSeedTime;
const managed = (deleted = false) => ({ created_at: shippingOptionTypeUpdateSeedTime, updated_at: shippingOptionTypeUpdateSeedTime,
  deleted_at: deleted ? shippingOptionTypeUpdateSeedTime : null });
export const shippingOptionTypeUpdateLinkedIds = { active: "sotype-update-linked", historical: "sotype-update-historical" } as const;
export function shippingOptionTypeUpdateSeed(id: string, deleted = false): JsonObject {
  return { id, label: " Original " + id + " ", description: " Original description ", code: " Native CODE ", ...managed(deleted) };
}
const native = Result.getOrThrow(updateShippingOptionTypesWorkflow.prepare());
const retained = native.nodes.find(node => node.name === "update-shipping-option-types");
if (retained?.kind !== "step" || retained.compensation !== "transactionCovered" || retained.compensate === undefined)
  throw new Error("Missing genuine ShippingOptionType retained update/inverse");
const invoke = retained.invoke, compensate = retained.compensate;

/** Every observed mutation runs genuine native Fulfillment methods. */
export async function prepareCoreShippingOptionTypeUpdate(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  initial: readonly JsonObject[], shared?: CorePersistenceFixture) {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const [definition, eventDefinition, fulfillment] = await Effect.runPromise(Effect.all([
    compileServiceZoneCreationCoreDefinition(target), compileCoreNativeEventStorageDefinition(target), makeShippingOptionTypeUpdateCommands(),
  ]));
  const supplied = [...shippingProfileOptionParents,
    ...[...initial, ...Object.values(shippingOptionTypeUpdateLinkedIds).map(id => shippingOptionTypeUpdateSeed(id))]
      .map(row => ({ table: "shipping_option_type", row: { ...row } })),
    { table: "shipping_profile", row: { id: "sotype-update-protected-profile", name: "Protected update Profile", type: "default", metadata: null, ...managed() } },
    ...[false, true].map(deleted => ({ table: "shipping_option", row: {
      id: deleted ? "sotype-update-historical-option" : "sotype-update-active-option", name: "Canonical native Option", price_type: "flat", data: null, metadata: null,
      service_zone_id: "sp-delete-zone", shipping_profile_id: "sotype-update-protected-profile", provider_id: "sp-delete-provider",
      shipping_option_type_id: deleted ? shippingOptionTypeUpdateLinkedIds.historical : shippingOptionTypeUpdateLinkedIds.active, ...managed(deleted),
    } })),
  ];
  const order = ["fulfillment_set", "service_zone", "shipping_option_type", "fulfillment_provider", "shipping_profile", "shipping_option"];
  const initialRows = order.flatMap(table => supplied.filter(value => value.table === table));
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition,
    ...(shared === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(shared) }), sources: [
      { name: "fulfillment", definition, initialCommands: fulfillment.commands, rows: initialRows },
    ] });
  close(fixture.close);
  const { own, closeCaseHosts } = orderFixtureHosts(close);
  const execution = fixture.execution, installed = { module: fulfillment.workflow, nativeStorage: fixture.source("fulfillment") };
  const options: Parameters<typeof prepareShippingOptionTypeUpdateWorkflow>[0] = { execution, modules: { fulfillment: installed },
    revision: revision("native-shipping-option-type-update-129"), subscribers: [{ id: "native-shipping-option-type-update", revision: "9".repeat(64) }] };
  const prepare = async (hooks: ShippingOptionTypeUpdateHooks = {}, selectedRevision = options.revision) =>
    own(await Effect.runPromise(prepareShippingOptionTypeUpdateWorkflow({ ...options, hooks, revision: selectedRevision })));
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["listShippingOptionTypes", "updateShippingOptionTypes", "upsertShippingOptionTypes"], graph: false } }, true));
  const prepareRoundtrip = async (lateFailure?: Error) => {
    const Input = Schema.Struct({ input: ShippingOptionTypeUpdateInput });
    const Output = Schema.Struct({ output: fulfillment.output, preimages: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)) });
    // Execute the actual retained callback pair. Full-root hook/event behavior
    // is tested separately; this probe does not reproduce preimage selection.
    const roundtrip = createStep("probe-native-shipping-option-type-update-roundtrip", resources.callback(async (input: typeof Input.Type, context) => {
      const response = await invoke(input.input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine ShippingOptionType StepResponse");
      await compensate(response.compensateInput, context);
      if (lateFailure !== undefined) throw lateFailure;
      return { output: response.output, preimages: response.compensateInput };
    }));
    const workflow = createWorkflow("probe-native-shipping-option-type-update-roundtrip", (input: WorkflowData<typeof Input.Type>) => new WorkflowResponse(roundtrip(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      workflow: { name: "probeNativeShippingOptionTypeUpdateRoundtrip", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: Input, output: Output, events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async () => {
    // This probe admits deliberately partial captured rows. Their native upsert
    // required-field validation is observed through the genuine inverse.
    const Input = ShippingOptionTypeUpsertRows;
    const undo = createStep("probe-native-shipping-option-type-update-inverse", resources.callback(async (preimages: typeof Input.Type, context) => {
      await compensate(preimages, context); return new StepResponse(null);
    }));
    const workflow = createWorkflow("probe-native-shipping-option-type-update-inverse", (input: WorkflowData<typeof Input.Type>) => new WorkflowResponse(undo(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      workflow: { name: "probeNativeShippingOptionTypeUpdateInverse", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: Input, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareAbsentInverse = async () => {
    const undo = createStep("probe-native-shipping-option-type-empty-inverses", resources.callback(async (_input: null, context) => {
      await compensate(undefined, context); await compensate([], context); return new StepResponse(null);
    }));
    const workflow = createWorkflow("probe-native-shipping-option-type-empty-inverses", (input: WorkflowData<null>) => new WorkflowResponse(undo(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      workflow: { name: "probeNativeShippingOptionTypeEmptyInverses", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareWithoutEventBus = async (onHook: () => void) => {
    const withoutEvents = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
      methods: ["listShippingOptionTypes", "updateShippingOptionTypes", "upsertShippingOptionTypes"], graph: false } }, false));
    const prepared = Result.getOrThrow(updateShippingOptionTypesWorkflow.prepare({ shippingOptionTypesUpdated: withoutEvents.callback(() => { onHook(); }) }));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: options.modules, revision: options.revision,
      workflow: { name: "probeTypeUpdateMissingEventBus", resources: withoutEvents, prepared, input: ShippingOptionTypeUpdateInput, output: fulfillment.output } })));
  };
  return { fixture, definition, fulfillment, installed, options, prepare, prepareRoundtrip, prepareInverse, prepareAbsentInverse, prepareWithoutEventBus, closeCaseHosts,
    read: (ids: readonly string[]) => fixture.readRows("fulfillment", ids), snapshot: fixture.snapshot };
}
