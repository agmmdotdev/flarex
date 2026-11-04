import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteServiceZonesWorkflow } from "@medusajs/core-flows/fulfillment/delete-service-zones";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { makeServiceZoneDeletionCommands } from "../../src/modules/fulfillment/service-zone-delete-service";
import { makeServiceZoneCreationCommands } from "../../src/modules/fulfillment/service-zone-create-service";
import { serviceZoneDeletionResources } from "../../src/workflow/policy";
import { ServiceZoneDeletionIds } from "../../src/modules/fulfillment/service-zone-delete-input";
import { prepareServiceZoneDeletionWorkflow, ServiceZoneDeletionInput } from "../../src/workflows/fulfillment/delete-service-zones";
import { prepareServiceZoneCreationWorkflow } from "../../src/workflows/fulfillment/create-service-zones";
import { prepareCoreServiceZoneStorage } from "./core-service-zone-creation-fixture";
import type { serviceZoneDeletionGraph } from "./native-fulfillment-graph-fixture";

const native = Result.getOrThrow(deleteServiceZonesWorkflow.prepare());
const retained = native.nodes.find(node => node.name === "delete-service-zones");
if (retained?.kind !== "step" || retained.compensation !== "transactionCovered" || retained.compensate === undefined)
  throw new Error("Missing genuine ServiceZone deletion retained inverse");
const compensate = retained.compensate;

/** Reuse the current native eight-table installation, canonical graph seeds
 * and scoped inventory. This adds only the selected lifecycle workflow owner. */
export async function prepareCoreServiceZoneDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  graphs: readonly ReturnType<typeof serviceZoneDeletionGraph>[], physical?: CorePersistenceFixture) {
  const base = await prepareCoreServiceZoneStorage(driver, close, graphs, physical);
  const fulfillment = await Effect.runPromise(makeServiceZoneDeletionCommands());
  const installed = { module: fulfillment.workflow, nativeStorage: base.nativeStorage };
  const options: Parameters<typeof prepareServiceZoneDeletionWorkflow>[0] = { execution: base.execution, modules: { fulfillment: installed },
    revision: createHash("sha256").update("native-service-zone-deletion-132").digest("hex"),
    subscribers: [{ id: "native-service-zone-deletion", revision: "b".repeat(64) }] };
  const prepare = async (revision = options.revision) => {
    return base.own(await Effect.runPromise(prepareServiceZoneDeletionWorkflow({ ...options, revision })));
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["softDeleteServiceZones", "restoreServiceZones"], graph: false } }, true));
  const prepareInverse = async (retainedInput?: () => unknown, limits: Readonly<{ calls: number; eventMessages: number }> = serviceZoneDeletionResources, lateFailure?: Error) => {
    const roundtrip = retainedInput !== undefined;
    const inverse = createStep("probe-native-service-zone-deletion-inverse", resources.callback(async (value: typeof ServiceZoneDeletionInput.Type, context) => {
      await compensate(retainedInput === undefined ? [...value.ids] : retainedInput(), context);
      if (lateFailure !== undefined) throw lateFailure;
      return new StepResponse(null);
    }));
    const flow = createWorkflow(roundtrip ? "probe-native-service-zone-deletion-roundtrip" : "probe-native-service-zone-deletion-inverse", (value: WorkflowData<typeof ServiceZoneDeletionInput.Type>) => {
      if (roundtrip) {
        const deleted = deleteServiceZonesWorkflow.runAsStep({ input: { ids: value.ids } });
        return new WorkflowResponse(inverse(transform({ value, deleted }, ({ value }) => value)));
      }
      return new WorkflowResponse(inverse(value));
    });
    const selectedResources = { ...serviceZoneDeletionResources, ...limits };
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      modules: { fulfillment: { ...installed, logicalResources: selectedResources } },
      requestCallLimit: selectedResources.calls, requestEventLimit: selectedResources.eventMessages, workflow: {
      name: roundtrip ? "probeNativeServiceZoneDeletionRoundtrip" : "probeNativeServiceZoneDeletionInverse", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: ServiceZoneDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents,
    } }));
    return base.own(host);
  };
  const prepareLifecycle = async () => {
    const Input = Schema.Struct({ ids: ServiceZoneDeletionIds, restore: Schema.Boolean });
    const invoke = createStep("probe-native-service-zone-module-lifecycle", resources.callback(async (value: typeof Input.Type, context) =>
      value.restore ? context.resources.fulfillment.restoreServiceZones([...value.ids]) : context.resources.fulfillment.softDeleteServiceZones([...value.ids])));
    const flow = createWorkflow("probe-native-service-zone-module-lifecycle", (value: WorkflowData<typeof Input.Type>) => new WorkflowResponse(invoke(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { fulfillment: { ...installed, logicalResources: serviceZoneDeletionResources } }, requestCallLimit: serviceZoneDeletionResources.calls,
      requestEventLimit: serviceZoneDeletionResources.eventMessages, workflow: { name: "probeNativeServiceZoneModuleLifecycle", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: Input, output: Schema.JsonObject, events: internalModuleWorkflowEvents } }));
    return base.own(host);
  };
  const prepareAbsentInverse = async () => {
    const undo = createStep("probe-absent-native-service-zone-deletion-inverse", resources.callback(async (_value: null, context) => {
      await compensate(undefined, context); await compensate([], context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-absent-native-service-zone-deletion-inverse", (value: WorkflowData<null>) => new WorkflowResponse(undo(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { fulfillment: { ...installed, logicalResources: serviceZoneDeletionResources } }, requestCallLimit: serviceZoneDeletionResources.calls,
      requestEventLimit: serviceZoneDeletionResources.eventMessages, workflow: { name: "probeAbsentNativeServiceZoneDeletionInverse", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    return base.own(host);
  };
  const prepareCreation = async () => {
    const creator = await Effect.runPromise(makeServiceZoneCreationCommands());
    return base.own(await Effect.runPromise(prepareServiceZoneCreationWorkflow({ ...options,
      modules: { fulfillment: { module: creator.workflow, nativeStorage: base.nativeStorage } },
    })));
  };
  return { ...base, fulfillment, installed, options, prepare, resources, prepareLifecycle,
    prepareRoundtrip: (retainedInput: () => unknown, limits?: Readonly<{ calls: number; eventMessages: number }>) => prepareInverse(retainedInput, limits),
    prepareRestore: (lateFailure?: Error) => prepareInverse(undefined, undefined, lateFailure), prepareAbsentInverse,
    prepareCreation, input: ServiceZoneDeletionInput };
}
