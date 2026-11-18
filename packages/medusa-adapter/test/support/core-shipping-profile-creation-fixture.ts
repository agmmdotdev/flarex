import { createHash, randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createShippingProfilesWorkflow } from "@medusajs/core-flows/fulfillment/create-shipping-profiles";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { makeShippingProfileCreationCommands } from "../../src/modules/fulfillment/shipping-profile-create-service";
import { ShippingProfilePhysicalDeletionIds } from "../../src/modules/fulfillment/shipping-profile-create-input";
import { compileServiceZoneCreationCoreDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { prepareShippingProfileCreationWorkflow, ShippingProfileCreationInput } from "../../src/workflows/fulfillment/create-shipping-profiles";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";
import { orderFixtureHosts } from "./core-order-fixture";
import { shippingProfileOptionParents, shippingProfileDeletionGraph } from "./shipping-profile-seeds";

const revision = createHash("sha256").update("native-shipping-profile-create-135").digest("hex");
const native = Result.getOrThrow(createShippingProfilesWorkflow.prepare());
type NativeCreationInput = Parameters<typeof createShippingProfilesWorkflow.runAsStep>[0]["input"];
const retained = native.nodes.find(node => node.name === "create-shipping-profiles");
if (retained?.kind !== "step" || retained.compensation !== "transactionCovered" || retained.compensate === undefined)
  throw new Error("Missing genuine ShippingProfile retained inverse");
const compensate = retained.compensate;

export const shippingProfileCreationGraphs = {
  existing: shippingProfileDeletionGraph("sp-create-existing"),
  blocked: shippingProfileDeletionGraph("sp-create-blocked", 1, { optionsPerProfile: 1 }),
  historyOption: shippingProfileDeletionGraph("sp-create-history-option", 1, { optionsPerProfile: 2, deletedOptions: true }),
  historyProfile: shippingProfileDeletionGraph("sp-create-history-profile", 1, { optionsPerProfile: 2, deletedProfiles: true }),
  race: shippingProfileDeletionGraph("sp-create-race"),
};

/** Install the existing Fulfillment source and seed the required Profile graph. */
export async function prepareCoreShippingProfileCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  graphs: readonly ReturnType<typeof shippingProfileDeletionGraph>[] = Object.values(shippingProfileCreationGraphs),
  physical?: CorePersistenceFixture) {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const { fulfillment, definition, eventDefinition } = await Effect.runPromise(Effect.all({
    fulfillment: makeShippingProfileCreationCommands(),
    definition: compileServiceZoneCreationCoreDefinition(target),
    eventDefinition: compileCoreNativeEventStorageDefinition(target),
  }));
  const supplied = [...shippingProfileOptionParents, ...graphs.flatMap(graph => graph.rows)];
  const order = ["fulfillment_set", "service_zone", "shipping_option_type", "fulfillment_provider", "shipping_profile", "shipping_option"];
  const initial = order.flatMap(table => supplied.filter(value => value.table === table));
  if (initial.length !== supplied.length) throw new Error("Unexpected ShippingProfile comparison table");
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition,
    sources: [{ name: "fulfillment", definition, initialCommands: fulfillment.commands, rows: initial }],
    ...(physical === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(physical) }),
  });
  close(fixture.close);
  const { own, closeCaseHosts } = orderFixtureHosts(close);
  const execution = fixture.execution;
  const installed = { module: fulfillment.workflow, nativeStorage: fixture.source("fulfillment") };
  const options: Parameters<typeof prepareShippingProfileCreationWorkflow>[0] = { execution, fulfillment: installed,
    revision, subscribers: [{ id: "native-shipping-profile-create", revision: "d".repeat(64) }] };
  const prepare = async (selectedRevision = options.revision) =>
    own(await Effect.runPromise(prepareShippingProfileCreationWorkflow({ ...options, revision: selectedRevision })));
  const workflowOptions = { execution, revision, subscribers: options.subscribers,
    requestCallLimit: defaultCommerceResources.calls, requestEventLimit: defaultCommerceResources.eventMessages };
  const inverseModules = { fulfillment: { ...installed, logicalResources: defaultCommerceResources } };
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["createShippingProfiles", "deleteShippingProfiles"], graph: false } }, true));
  const prepareRoundtrip = async (actualRetained: () => unknown, lateFailure?: Error) => {
    const undo = createStep("probe-native-profile-retained-inverse", resources.callback(async (_value: null, context) => {
      await compensate(actualRetained(), context);
      if (lateFailure !== undefined) throw lateFailure;
      return null;
    }));
    const flow = createWorkflow("probe-native-profile-creation-roundtrip", (value: WorkflowData<typeof ShippingProfileCreationInput.Type>) => {
      // SAFETY: the public DTO omits supplied persistence IDs admitted by the
      // checked DML. Preserve real values at this native authoring boundary.
      const output = createShippingProfilesWorkflow.runAsStep({ input: value as NativeCreationInput });
      const inverse = undo(transform(output, () => null));
      return new WorkflowResponse(transform({ output, inverse }, ({ output }) => output));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...workflowOptions, modules: inverseModules,
      workflow: { name: "probeNativeShippingProfileRoundtrip", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: ShippingProfileCreationInput, output: fulfillment.output, events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async (lateFailure?: Error) => {
    const undo = createStep("probe-native-profile-physical-inverse", resources.callback(async (ids: typeof ShippingProfilePhysicalDeletionIds.Type, context) => {
      await compensate([...ids], context);
      if (lateFailure !== undefined) throw lateFailure;
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-native-profile-physical-inverse", (ids: WorkflowData<typeof ShippingProfilePhysicalDeletionIds.Type>) => new WorkflowResponse(undo(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...workflowOptions, modules: inverseModules,
      workflow: { name: "probeNativeShippingProfileInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: ShippingProfilePhysicalDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareAbsentInverse = async () => {
    const undo = createStep("probe-absent-native-profile-inverse", resources.callback(async (_input: null, context) => {
      await compensate(undefined, context);
      await compensate([], context);
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-absent-native-profile-inverse", (value: WorkflowData<null>) => new WorkflowResponse(undo(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...workflowOptions, modules: { fulfillment: installed },
      workflow: { name: "probeAbsentNativeProfileInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };

  return { fixture, definition, fulfillment, installed, options, execution, prepare, prepareRoundtrip, prepareInverse, prepareAbsentInverse, closeCaseHosts,
    read: (ids: readonly string[]) => fixture.readRows("fulfillment", ids), snapshot: fixture.snapshot };
}
