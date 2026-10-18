import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createShippingOptionTypesWorkflow } from "@medusajs/core-flows/shipping-options/create-shipping-option-types";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents, orderedWorkflowIdEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { makeShippingOptionTypeCreationCommands } from "../../src/modules/fulfillment/shipping-option-type-service";
import { ShippingOptionTypePhysicalDeletionIds } from "../../src/modules/fulfillment/shipping-option-type-input";
import { prepareShippingOptionTypeCreationWorkflow, ShippingOptionTypeCreationInput,
  type ShippingOptionTypeCreationHooks } from "../../src/workflows/fulfillment/create-shipping-option-types";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { shippingProfileOptionParents, shippingProfileDeletionSeedTime } from "./logical-shipping-profile-deletion-fixture";

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

/** Canonical comparison rows reuse the installed six-table source. Actual Type
 * operations always execute the native Fulfillment methods and workflow. */
export async function prepareLogicalShippingOptionTypeCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const configuration = { includeShippingProfile: true, includeShippingProfileDeletion: true };
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? configuration : { ...configuration, ...shared });
  const fulfillment = await Effect.runPromise(makeShippingOptionTypeCreationCommands()), definition = fixture.shippingProfileDefinition;
  if (definition === undefined || definition.schema.tables.length !== 6) throw new Error("Missing installed six-table Fulfillment source");
  const supplied = [...shippingProfileOptionParents,
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
  const order = ["fulfillment_set", "service_zone", "shipping_option_type", "fulfillment_provider", "shipping_profile", "shipping_option"];
  const initial = order.flatMap(table => supplied.filter(value => value.table === table));
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: initial }, 1_048_576,
    { invalidInput: () => new Error("Invalid Type creation comparison seed"), hashFailure: cause => new Error("Type comparison hash", { cause }) }));
  const input = { ...fixture.hostInput, commands: fulfillment.commands,
    identityAndAccessPolicy: { profile: "logical-shipping-option-type-create-initialization" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: "medusa.shippingProfile", writeProfile: "medusa.shippingProfile", schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "shipping-option-type-create-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: initial.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializer = await Effect.runPromise(makeCommerceHost(input));
  try { await Effect.runPromise(initializer.initialize(initial)); } finally { await Effect.runPromise(initializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const installed = { module: fulfillment.workflow, logicalStorage: input.logicalStorage };
  const options: Parameters<typeof prepareShippingOptionTypeCreationWorkflow>[0] = { execution, modules: { fulfillment: installed },
    revision: revision("native-shipping-option-type-create-128"), subscribers: [{ id: "native-shipping-option-type-create", revision: "d".repeat(64) }] };
  const prepare = async (hooks: ShippingOptionTypeCreationHooks = {}, selectedRevision = options.revision) => {
    const host = await Effect.runPromise(prepareShippingOptionTypeCreationWorkflow({ ...options, hooks, revision: selectedRevision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["createShippingOptionTypes", "deleteShippingOptionTypes"], graph: false } }, true));
  const inverseStep = (lateFailure = false) =>
    createStep("probe-native-shipping-option-type-inverse", resources.callback(async (ids: typeof ShippingOptionTypePhysicalDeletionIds.Type, context) => {
      await compensate([...ids], context);
      if (lateFailure) throw new Error("Late native Type inverse failure");
      return new StepResponse(null);
    }));
  const prepareRoundtrip = async (lateFailure = false) => {
    const undo = inverseStep(lateFailure);
    const roundtripFlow = createWorkflow("probe-native-shipping-option-type-roundtrip", (value: WorkflowData<typeof ShippingOptionTypeCreationInput.Type>) => {
      // SAFETY: the pinned public DTO omits nullable description and supplied
      // IDs admitted by checked DML. Keep those real values at this native
      // authoring boundary; the child and service retain runtime validation.
      const output = createShippingOptionTypesWorkflow.runAsStep({ input: value as NativeCreationInput });
      const inverse = undo(transform(output, rows => rows.map(row => row.id)));
      return new WorkflowResponse(transform({ output, inverse }, ({ output }) => output));
    });
    const events = orderedWorkflowIdEvents("shipping-option-type.created", Effect.fn("TypeProbe.createdIds")(function* (calls) {
      const result = calls.results(fulfillment.workflow.methods.createShippingOptionTypes);
      if (result.length !== 1) throw new Error("Missing genuine Type creation call");
      return (yield* Effect.fromResult(fulfillment.decodeOutput(result[0]))).map(row => row.id);
    }));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probeNativeShippingOptionTypeRoundtrip",
      resources, prepared: Result.getOrThrow(roundtripFlow.prepare()), input: ShippingOptionTypeCreationInput, output: fulfillment.output, events } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareInverse = async () => {
    const undo = inverseStep();
    const inverseFlow = createWorkflow("probe-native-shipping-option-type-inverse", (ids: WorkflowData<typeof ShippingOptionTypePhysicalDeletionIds.Type>) => new WorkflowResponse(undo(ids)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probeNativeShippingOptionTypeInverse",
      resources, prepared: Result.getOrThrow(inverseFlow.prepare()), input: ShippingOptionTypePhysicalDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareAbsentInverse = async () => {
    const undo = createStep("probe-absent-native-type-inverse", resources.callback(async (_input: null, context) => {
      await compensate(undefined, context); await compensate([], context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-absent-native-type-inverse", (value: WorkflowData<null>) => new WorkflowResponse(undo(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probeAbsentNativeTypeInverse",
      resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareWithoutEventBus = async (onHook: () => void) => {
    const withoutEvents = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
      methods: ["createShippingOptionTypes", "deleteShippingOptionTypes"], graph: false } }, false));
    const prepared = Result.getOrThrow(createShippingOptionTypesWorkflow.prepare({
      shippingOptionTypesCreated: withoutEvents.callback(() => { onHook(); }),
    }));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: options.modules, revision: options.revision,
      workflow: { name: "probeTypeCreationMissingEventBus", resources: withoutEvents, prepared,
        input: ShippingOptionTypeCreationInput, output: fulfillment.output } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const read = async (ids: readonly string[]) => {
    const inventory = await logicalCurrencyInventory(fixture), selected = new Set(ids), result: JsonObject[] = [];
    const scope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    for (const current of inventory.rows) {
      if (current.scopeUuid !== scope) continue;
      const record = inventory.revisions.find(row => row.scopeUuid === scope && row.tableId === current.tableId && row.commitSeq === current.commitSeq
        && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (record === undefined || record.isTombstone) continue;
      const value = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: record.valueBytes, sha256: record.valueSha256, profile: "appDocument" });
      const row = Schema.decodeUnknownSync(Schema.JsonObject)(value.valueJson);
      if (typeof row.id === "string" && selected.has(row.id)) result.push(projectNativeRow(row));
    }
    return result.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };
  return { fixture, fulfillment, installed, options, execution, prepare, prepareRoundtrip, prepareInverse, prepareAbsentInverse, prepareWithoutEventBus, read,
    snapshot: () => logicalCurrencyInventory(fixture) };
}
