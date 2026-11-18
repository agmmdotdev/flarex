import { createHash, randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteShippingOptionTypesWorkflow } from "@medusajs/core-flows/shipping-options/delete-shipping-option-types";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents, orderedWorkflowIdEvents } from "../../src/workflow/events";
import { makeShippingOptionTypeDeletionCommands } from "../../src/modules/fulfillment/shipping-option-type-delete-service";
import { ShippingOptionTypeDeletionIds, decodeShippingOptionTypeDeletionIds } from "../../src/modules/fulfillment/shipping-option-type-delete-input";
import { compileServiceZoneCreationCoreDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { prepareShippingOptionTypeDeletionLinkResource } from "../../src/links/shipping-option-type-deletion";
import { prepareShippingOptionTypeDeletionWorkflow, ShippingOptionTypeDeletionInput,
  type ShippingOptionTypeDeletionHooks } from "../../src/workflows/fulfillment/delete-shipping-option-types";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";
import { orderFixtureHosts } from "./core-order-fixture";
import { shippingOptionTypeDeletionParents, type shippingOptionTypeDeletionGraph } from "./shipping-option-type-deletion-seeds";

const native = Result.getOrThrow(deleteShippingOptionTypesWorkflow.prepare());
function nativeCompensator(name: string) {
  const node = native.nodes.find(node => node.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine retained Type deletion callback " + name);
  return node.compensate;
}
const restoreTypes = nativeCompensator("delete-shipping-option-types"), restoreLinks = nativeCompensator("remove-remote-links");

/** Initial state reuses the existing Fulfillment source and native FK parents. Seed writes
 * grant no ShippingOption/provider workflow capability. */
export async function prepareCoreShippingOptionTypeDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  graphs: readonly ReturnType<typeof shippingOptionTypeDeletionGraph>[], shared?: CorePersistenceFixture) {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const [fulfillment, definition, eventDefinition] = await Effect.runPromise(Effect.all([
    makeShippingOptionTypeDeletionCommands(), compileServiceZoneCreationCoreDefinition(target), compileCoreNativeEventStorageDefinition(target),
  ]));
  const link = Result.getOrThrow(prepareShippingOptionTypeDeletionLinkResource());
  const supplied = [...shippingOptionTypeDeletionParents, ...graphs.flatMap(graph => graph.rows)];
  const order = ["fulfillment_set", "service_zone", "shipping_option_type", "fulfillment_provider", "shipping_profile", "shipping_option"];
  const initialRows = order.flatMap(table => supplied.filter(value => value.table === table));
  if (initialRows.length !== supplied.length) throw new Error("Unknown Type deletion seed table");
  const physical = shared === undefined ? undefined : await shareCoreNativeWorkflowPhysical(shared);
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition, ...(physical === undefined ? {} : { physical }),
    sources: [{ name: "fulfillment", definition, initialCommands: fulfillment.commands, rows: initialRows }] });
  close(fixture.close);
  const { own, closeCaseHosts } = orderFixtureHosts(close);
  const execution = fixture.execution;
  const modules = { fulfillment: { module: fulfillment.workflow, nativeStorage: fixture.source("fulfillment") } };
  const options: Parameters<typeof prepareShippingOptionTypeDeletionWorkflow>[0] = { execution, modules, link,
    revision: createHash("sha256").update("native-shipping-option-type-deletion-130").digest("hex"),
    subscribers: [{ id: "native-shipping-option-type-deletion", revision: "a".repeat(64) }] };
  const prepare = async (hooks: ShippingOptionTypeDeletionHooks = {}, revision = options.revision) => {
    const host = await Effect.runPromise(prepareShippingOptionTypeDeletionWorkflow({ ...options, hooks, revision }));
    return own(host);
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["softDeleteShippingOptionTypes", "restoreShippingOptionTypes"], graph: true } }, true, { link }));
  const prepareInverse = async (roundtrip: boolean, lateFailure?: Error) => {
    const restore = createStep("invoke-retained-type-deletion-inverses", resources.callback(async (input: typeof ShippingOptionTypeDeletionInput.Type, context) => {
      await restoreLinks({ fulfillment: { shipping_option_type_id: [...input.ids] } }, context);
      await restoreTypes([...input.ids], context);
      if (lateFailure !== undefined) throw lateFailure;
      return new StepResponse(null);
    }));
    const workflow = createWorkflow(roundtrip ? "probe-type-deletion-roundtrip" : "probe-type-deletion-inverse", (input: WorkflowData<typeof ShippingOptionTypeDeletionInput.Type>) => {
      if (roundtrip) {
        const deleted = deleteShippingOptionTypesWorkflow.runAsStep({ input: { ids: input.ids } });
        return new WorkflowResponse(restore(transform({ input, deleted }, ({ input }) => input)));
      }
      return new WorkflowResponse(restore(input));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued",
      workflow: { name: roundtrip ? "probeTypeDeletionRoundtrip" : "probeTypeDeletionInverse", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: ShippingOptionTypeDeletionInput, output: Schema.Null, events: roundtrip ? orderedWorkflowIdEvents("shipping-option-type.deleted", Effect.fn(function* (calls) {
          const call = calls.calls(fulfillment.workflow.methods.softDeleteShippingOptionTypes)[0];
          if (call === undefined) throw new Error("Missing genuine root Type deletion receipt");
          return yield* Effect.fromResult(decodeShippingOptionTypeDeletionIds(call.input));
        })) : internalModuleWorkflowEvents } }));
    return own(host);
  };
  const prepareLifecycle = async () => {
    const Input = Schema.Struct({ ids: ShippingOptionTypeDeletionIds, restore: Schema.Boolean });
    const invoke = createStep("probe-native-type-module-lifecycle", resources.callback(async (input: typeof Input.Type, context) =>
      input.restore ? context.resources.fulfillment.restoreShippingOptionTypes([...input.ids]) : context.resources.fulfillment.softDeleteShippingOptionTypes([...input.ids])));
    const workflow = createWorkflow("probe-native-type-module-lifecycle", (input: WorkflowData<typeof Input.Type>) => new WorkflowResponse(invoke(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued",
      workflow: { name: "probeNativeTypeModuleLifecycle", resources, prepared: Result.getOrThrow(workflow.prepare()), input: Input, output: Schema.JsonObject,
        events: internalModuleWorkflowEvents } }));
    return own(host);
  };
  const prepareWithoutEventBus = async () => {
    const without = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
      methods: ["softDeleteShippingOptionTypes", "restoreShippingOptionTypes"], graph: true } }, false, { link }));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, revision: options.revision, operationScheduling: "queued",
      workflow: { name: "probeTypeDeletionMissingEventBus", resources: without, prepared: native, input: ShippingOptionTypeDeletionInput, output: Schema.Null } }));
    return own(host);
  };
  const read = async (ids: readonly string[]) => (await fixture.readRows("fulfillment", ids))
    .toSorted((left, right) => String(left.id).localeCompare(String(right.id)));
  return { fixture, fulfillment, link, modules, options, prepare, prepareRoundtrip: (lateFailure?: Error) => prepareInverse(true, lateFailure),
    prepareRestore: () => prepareInverse(false), prepareLifecycle, prepareWithoutEventBus, closeCaseHosts, read, snapshot: fixture.snapshot };
}
