import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteServiceZonesWorkflow } from "@medusajs/core-flows/fulfillment/delete-service-zones";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { makeServiceZoneDeletionCommands } from "../../src/modules/fulfillment/service-zone-delete-service";
import { serviceZoneDeletionResources } from "../../src/workflow/policy";
import { ServiceZoneDeletionIds } from "../../src/modules/fulfillment/service-zone-delete-input";
import { prepareServiceZoneDeletionWorkflow, ServiceZoneDeletionInput } from "../../src/workflows/fulfillment/delete-service-zones";
import { prepareLogicalServiceZoneCreation, serviceZoneDeletionGraph } from "./logical-service-zone-creation-fixture";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

const native = Result.getOrThrow(deleteServiceZonesWorkflow.prepare());
const retained = native.nodes.find(node => node.name === "delete-service-zones");
if (retained?.kind !== "step" || retained.compensation !== "transactionCovered" || retained.compensate === undefined)
  throw new Error("Missing genuine ServiceZone deletion retained inverse");
const compensate = retained.compensate;

/** Reuse the current native eight-table installation, canonical graph seeds
 * and scoped inventory. This adds only the selected lifecycle workflow owner. */
export async function prepareLogicalServiceZoneDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  graphs: readonly ReturnType<typeof serviceZoneDeletionGraph>[], shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const base = await prepareLogicalServiceZoneCreation(driver, close, graphs, shared);
  const fulfillment = await Effect.runPromise(makeServiceZoneDeletionCommands());
  const installed = { module: fulfillment.workflow, logicalStorage: base.installed.logicalStorage, logicalResources: serviceZoneDeletionResources };
  const options: Parameters<typeof prepareServiceZoneDeletionWorkflow>[0] = { execution: base.execution, modules: { fulfillment: installed },
    revision: createHash("sha256").update("native-service-zone-deletion-132").digest("hex"),
    subscribers: [{ id: "native-service-zone-deletion", revision: "b".repeat(64) }] };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareServiceZoneDeletionWorkflow({ ...options, revision })); close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["softDeleteServiceZones", "restoreServiceZones"], graph: false } }, true));
  const Restore = Schema.Struct({ ids: ServiceZoneDeletionIds, fail: Schema.optionalKey(Schema.Boolean) });
  const prepareInverse = async (roundtrip: boolean, limits: Readonly<{ calls: number; eventMessages: number }> = serviceZoneDeletionResources) => {
    const inverse = createStep("probe-native-service-zone-deletion-inverse", resources.callback(async (value: typeof Restore.Type, context) => {
      await compensate([...value.ids], context); if (value.fail === true) throw new Error("Late native ServiceZone restoration failure"); return null;
    }));
    const flow = createWorkflow(roundtrip ? "probe-native-service-zone-deletion-roundtrip" : "probe-native-service-zone-deletion-inverse", (value: WorkflowData<typeof Restore.Type>) => {
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
      prepared: Result.getOrThrow(flow.prepare()), input: Restore, output: Schema.Null, events: internalModuleWorkflowEvents,
    } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareLifecycle = async () => {
    const Input = Schema.Struct({ ids: ServiceZoneDeletionIds, restore: Schema.Boolean });
    const invoke = createStep("probe-native-service-zone-module-lifecycle", resources.callback(async (value: typeof Input.Type, context) =>
      value.restore ? context.resources.fulfillment.restoreServiceZones([...value.ids]) : context.resources.fulfillment.softDeleteServiceZones([...value.ids])));
    const flow = createWorkflow("probe-native-service-zone-module-lifecycle", (value: WorkflowData<typeof Input.Type>) => new WorkflowResponse(invoke(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, requestCallLimit: serviceZoneDeletionResources.calls,
      requestEventLimit: serviceZoneDeletionResources.eventMessages, workflow: { name: "probeNativeServiceZoneModuleLifecycle", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: Input, output: Schema.JsonObject, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareAbsentInverse = async () => {
    const undo = createStep("probe-absent-native-service-zone-deletion-inverse", resources.callback(async (_value: null, context) => {
      await compensate(undefined, context); await compensate([], context); return null;
    }));
    const flow = createWorkflow("probe-absent-native-service-zone-deletion-inverse", (value: WorkflowData<null>) => new WorkflowResponse(undo(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, requestCallLimit: serviceZoneDeletionResources.calls,
      requestEventLimit: serviceZoneDeletionResources.eventMessages, workflow: { name: "probeAbsentNativeServiceZoneDeletionInverse", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  return { ...base, fulfillment, installed, options, prepare, resources, prepareLifecycle,
    prepareRoundtrip: (limits?: Readonly<{ calls: number; eventMessages: number }>) => prepareInverse(true, limits),
    prepareRestore: () => prepareInverse(false), prepareAbsentInverse,
    prepareCreation: base.prepare, input: ServiceZoneDeletionInput };
}
