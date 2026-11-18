import { createHash, randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createShippingOptionTypesWorkflow } from "@medusajs/core-flows/shipping-options/create-shipping-option-types";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents, orderedWorkflowIdEvents } from "../../src/workflow/events";
import { makeServiceZoneCreationCommands } from "../../src/modules/fulfillment/service-zone-create-service";
import { compileServiceZoneCreationCoreDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { makeShippingOptionTypeCreationCommands } from "../../src/modules/fulfillment/shipping-option-type-service";
import { ShippingOptionTypePhysicalDeletionIds } from "../../src/modules/fulfillment/shipping-option-type-input";
import { prepareShippingOptionTypeCreationWorkflow, ShippingOptionTypeCreationInput,
  type ShippingOptionTypeCreationHooks } from "../../src/workflows/fulfillment/create-shipping-option-types";
import { prepareServiceZoneCreationWorkflow } from "../../src/workflows/fulfillment/create-service-zones";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";
import { orderFixtureHosts } from "./core-order-fixture";
import { fulfillmentForestRows, serviceZoneDeletionGraph } from "./native-fulfillment-graph-fixture";
import { shippingProfileOptionParents, shippingProfileDeletionSeedTime } from "./shipping-profile-seeds";

const revision = (name: string) => createHash("sha256").update(name).digest("hex");
const stamp = shippingProfileDeletionSeedTime;
const managed = (deleted = false) => ({ created_at: stamp, updated_at: stamp, deleted_at: deleted ? stamp : null });
const native = Result.getOrThrow(createShippingOptionTypesWorkflow.prepare());
type NativeCreationInput = Parameters<typeof createShippingOptionTypesWorkflow.runAsStep>[0]["input"];
const retained = native.nodes.find(node => node.name === "create-shipping-option-types");
if (retained?.kind !== "step" || retained.compensation !== "transactionCovered" || retained.compensate === undefined)
  throw new Error("Missing genuine ShippingOptionType retained inverse");
const compensate = retained.compensate;
export const shippingOptionTypeSeedIds = { existing: "sotype-existing", deleted: "sotype-deleted",
  linked: "sotype-linked", historical: "sotype-linked-deleted-option" } as const;
const protectedZone = serviceZoneDeletionGraph("zone-protected", { geos: 1, options: 1, rules: 1 });

/** Canonical comparison rows reuse the installed Fulfillment source. Actual Type
 * operations always execute the native Fulfillment methods and workflow. */
export async function prepareCoreShippingOptionTypeCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  physical?: CorePersistenceFixture) {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const { fulfillment, definition, eventDefinition } = await Effect.runPromise(Effect.all({
    fulfillment: makeShippingOptionTypeCreationCommands(),
    definition: compileServiceZoneCreationCoreDefinition(target),
    eventDefinition: compileCoreNativeEventStorageDefinition(target),
  }));
  const supplied = [...shippingProfileOptionParents, ...fulfillmentForestRows([protectedZone], true),
    ...Object.values(shippingOptionTypeSeedIds).map(id => ({ table: "shipping_option_type", row: {
      id, label: id, description: null, code: " Native Code ", ...managed(id === shippingOptionTypeSeedIds.deleted),
    } })),
    { table: "shipping_profile", row: { id: "sotype-protected-profile", name: "Protected Profile", type: "default", metadata: null, ...managed() } },
    ...[false, true].map(deleted => ({ table: "shipping_option", row: {
      id: deleted ? "sotype-historical-option" : "sotype-active-option", name: "Canonical native Option", price_type: "flat", data: null, metadata: null,
      service_zone_id: "sp-delete-zone", shipping_profile_id: "sotype-protected-profile", provider_id: "sp-delete-provider",
      shipping_option_type_id: deleted ? shippingOptionTypeSeedIds.historical : shippingOptionTypeSeedIds.linked, ...managed(deleted),
    } })),
  ];
  const order = ["fulfillment_set", "service_zone", "geo_zone", "shipping_option_type", "fulfillment_provider", "shipping_profile", "shipping_option", "shipping_option_rule"];
  const initial = order.flatMap(table => supplied.filter(value => value.table === table));
  if (initial.length !== supplied.length) throw new Error("Unknown Shipping Option Type comparison table");
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition,
    sources: [{ name: "fulfillment", definition, initialCommands: fulfillment.commands, rows: initial }],
    ...(physical === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(physical) }),
  });
  close(fixture.close);
  const { own, closeCaseHosts } = orderFixtureHosts(close);
  const execution = fixture.execution, nativeStorage = fixture.source("fulfillment");
  const installed = { module: fulfillment.workflow, nativeStorage };
  const options: Parameters<typeof prepareShippingOptionTypeCreationWorkflow>[0] = { execution, fulfillment: installed,
    revision: revision("native-shipping-option-type-create-128"), subscribers: [{ id: "native-shipping-option-type-create", revision: "d".repeat(64) }] };
  const prepare = async (hooks: ShippingOptionTypeCreationHooks = {}, selectedRevision = options.revision) =>
    own(await Effect.runPromise(prepareShippingOptionTypeCreationWorkflow({ ...options, hooks, revision: selectedRevision })));
  const workflowOptions = { execution, revision: options.revision, subscribers: options.subscribers,
    modules: { fulfillment: { ...installed, logicalResources: defaultCommerceResources } },
    requestCallLimit: defaultCommerceResources.calls, requestEventLimit: defaultCommerceResources.eventMessages };
  const prepareZone = async () => {
    const zone = await Effect.runPromise(makeServiceZoneCreationCommands());
    return own(await Effect.runPromise(prepareServiceZoneCreationWorkflow({ execution,
      modules: { fulfillment: { module: zone.workflow, nativeStorage } }, revision: revision("service-zone-existing-type-131"),
      subscribers: [{ id: "native-service-zone-create", revision: "a".repeat(64) }] })));
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["createShippingOptionTypes", "deleteShippingOptionTypes"], graph: false } }, true));
  const prepareRoundtrip = async (actualRetained: () => unknown, lateFailure?: Error) => {
    const undo = createStep("probe-native-shipping-option-type-retained-inverse", resources.callback(async (_value: null, context) => {
      await compensate(actualRetained(), context);
      if (lateFailure !== undefined) throw lateFailure;
      return null;
    }));
    const roundtripFlow = createWorkflow("probe-native-shipping-option-type-roundtrip", (value: WorkflowData<typeof ShippingOptionTypeCreationInput.Type>) => {
      // SAFETY: the pinned public DTO omits nullable description and supplied
      // IDs admitted by checked DML. Keep those real values at this native
      // authoring boundary; the child and service retain runtime validation.
      const output = createShippingOptionTypesWorkflow.runAsStep({ input: value as NativeCreationInput });
      const inverse = undo(transform(output, () => null));
      return new WorkflowResponse(transform({ output, inverse }, ({ output }) => output));
    });
    const events = orderedWorkflowIdEvents("shipping-option-type.created", Effect.fn("TypeProbe.createdIds")(function* (calls) {
      const result = calls.results(fulfillment.workflow.methods.createShippingOptionTypes);
      if (result.length !== 1) throw new Error("Missing genuine Type creation call");
      return (yield* Effect.fromResult(fulfillment.decodeOutput(result[0]))).map(row => row.id);
    }));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...workflowOptions, workflow: { name: "probeNativeShippingOptionTypeRoundtrip",
      resources, prepared: Result.getOrThrow(roundtripFlow.prepare()), input: ShippingOptionTypeCreationInput, output: fulfillment.output, events } })));
  };
  const prepareInverse = async () => {
    const undo = createStep("probe-native-shipping-option-type-inverse", resources.callback(async (ids: typeof ShippingOptionTypePhysicalDeletionIds.Type, context) => {
      await compensate([...ids], context);
      return new StepResponse(null);
    }));
    const inverseFlow = createWorkflow("probe-native-shipping-option-type-inverse", (ids: WorkflowData<typeof ShippingOptionTypePhysicalDeletionIds.Type>) => new WorkflowResponse(undo(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...workflowOptions, workflow: { name: "probeNativeShippingOptionTypeInverse",
      resources, prepared: Result.getOrThrow(inverseFlow.prepare()), input: ShippingOptionTypePhysicalDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareAbsentInverse = async () => {
    const undo = createStep("probe-absent-native-type-inverse", resources.callback(async (_input: null, context) => {
      await compensate(undefined, context); await compensate([], context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-absent-native-type-inverse", (value: WorkflowData<null>) => new WorkflowResponse(undo(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...workflowOptions, workflow: { name: "probeAbsentNativeTypeInverse",
      resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareWithoutEventBus = async (onHook: () => void) => {
    const withoutEvents = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
      methods: ["createShippingOptionTypes", "deleteShippingOptionTypes"], graph: false } }, false));
    const prepared = Result.getOrThrow(createShippingOptionTypesWorkflow.prepare({
      shippingOptionTypesCreated: withoutEvents.callback(() => { onHook(); }),
    }));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { fulfillment: installed }, revision: options.revision,
      workflow: { name: "probeTypeCreationMissingEventBus", resources: withoutEvents, prepared,
        input: ShippingOptionTypeCreationInput, output: fulfillment.output } })));
  };
  return { fixture, definition, fulfillment, installed, options, execution, prepare, prepareZone, prepareRoundtrip, prepareInverse,
    prepareAbsentInverse, prepareWithoutEventBus, closeCaseHosts, protectedZoneIds: protectedZone.allIds,
    read: (ids: readonly string[]) => fixture.readRows("fulfillment", ids), snapshot: fixture.snapshot };
}
