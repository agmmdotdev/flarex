import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateShippingOptionTypesWorkflow } from "@medusajs/core-flows/shipping-options/update-shipping-option-types";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { makeShippingOptionTypeUpdateCommands } from "../../src/modules/fulfillment/shipping-option-type-update-service";
import { ShippingOptionTypeUpdateInput, ShippingOptionTypeUpsertRows } from "../../src/modules/fulfillment/shipping-option-type-update-input";
import { prepareShippingOptionTypeUpdateWorkflow, type ShippingOptionTypeUpdateHooks } from "../../src/workflows/fulfillment/update-shipping-option-types";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { shippingProfileOptionParents, shippingProfileDeletionSeedTime } from "./logical-shipping-profile-deletion-fixture";

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

/** Installed canonical rows and history reuse the existing six-table fixture.
 * Every observed mutation runs real native Fulfillment methods. */
export async function prepareLogicalShippingOptionTypeUpdate(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  initial: readonly JsonObject[], shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const configuration = { includeShippingProfile: true, includeShippingProfileDeletion: true };
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? configuration : { ...configuration, ...shared });
  const fulfillment = await Effect.runPromise(makeShippingOptionTypeUpdateCommands()), definition = fixture.shippingProfileDefinition;
  if (definition === undefined || definition.schema.tables.length !== 6) throw new Error("Missing installed six-table Fulfillment source");
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
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: initialRows }, 1_048_576,
    { invalidInput: () => new Error("Invalid Type update comparison seed"), hashFailure: cause => new Error("Type update comparison hash", { cause }) }));
  const hostInput = { ...fixture.hostInput, commands: fulfillment.commands,
    identityAndAccessPolicy: { profile: "logical-shipping-option-type-update-initialization" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: "medusa.shippingProfile", writeProfile: "medusa.shippingProfile", schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "shipping-option-type-update-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: initialRows.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializer = await Effect.runPromise(makeCommerceHost(hostInput));
  try { await Effect.runPromise(initializer.initialize(initialRows)); } finally { await Effect.runPromise(initializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const installed = { module: fulfillment.workflow, logicalStorage: hostInput.logicalStorage };
  const options: Parameters<typeof prepareShippingOptionTypeUpdateWorkflow>[0] = { execution, modules: { fulfillment: installed },
    revision: revision("native-shipping-option-type-update-129"), subscribers: [{ id: "native-shipping-option-type-update", revision: "9".repeat(64) }] };
  const prepare = async (hooks: ShippingOptionTypeUpdateHooks = {}, selectedRevision = options.revision) => {
    const host = await Effect.runPromise(prepareShippingOptionTypeUpdateWorkflow({ ...options, hooks, revision: selectedRevision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["listShippingOptionTypes", "updateShippingOptionTypes", "upsertShippingOptionTypes"], graph: false } }, true));
  const prepareRoundtrip = async () => {
    const Input = Schema.Struct({ input: ShippingOptionTypeUpdateInput, fail: Schema.optionalKey(Schema.Boolean) });
    const Output = Schema.Struct({ output: fulfillment.output, preimages: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)) });
    // Execute the actual retained callback pair. Full-root hook/event behavior
    // is tested separately; this probe does not reproduce preimage selection.
    const roundtrip = createStep("probe-native-shipping-option-type-update-roundtrip", resources.callback(async (input: typeof Input.Type, context) => {
      const response = await invoke(input.input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine ShippingOptionType StepResponse");
      await compensate(response.compensateInput, context);
      if (input.fail === true) throw new Error("Late native ShippingOptionType inverse failure");
      return { output: response.output, preimages: response.compensateInput };
    }));
    const workflow = createWorkflow("probe-native-shipping-option-type-update-roundtrip", (input: WorkflowData<typeof Input.Type>) => new WorkflowResponse(roundtrip(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      workflow: { name: "probeNativeShippingOptionTypeUpdateRoundtrip", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: Input, output: Output, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareInverse = async () => {
    // This probe admits deliberately partial captured rows. Their native upsert
    // required-field validation is observed through the genuine inverse.
    const Input = ShippingOptionTypeUpsertRows;
    const undo = createStep("probe-native-shipping-option-type-update-inverse", resources.callback(async (preimages: typeof Input.Type, context) => {
      await compensate(preimages, context); return new StepResponse(null);
    }));
    const workflow = createWorkflow("probe-native-shipping-option-type-update-inverse", (input: WorkflowData<typeof Input.Type>) => new WorkflowResponse(undo(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      workflow: { name: "probeNativeShippingOptionTypeUpdateInverse", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: Input, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareAbsentInverse = async () => {
    const undo = createStep("probe-native-shipping-option-type-empty-inverses", resources.callback(async (_input: null, context) => {
      await compensate(undefined, context); await compensate([], context); return new StepResponse(null);
    }));
    const workflow = createWorkflow("probe-native-shipping-option-type-empty-inverses", (input: WorkflowData<null>) => new WorkflowResponse(undo(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      workflow: { name: "probeNativeShippingOptionTypeEmptyInverses", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareWithoutEventBus = async (onHook: () => void) => {
    const withoutEvents = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
      methods: ["listShippingOptionTypes", "updateShippingOptionTypes", "upsertShippingOptionTypes"], graph: false } }, false));
    const prepared = Result.getOrThrow(updateShippingOptionTypesWorkflow.prepare({ shippingOptionTypesUpdated: withoutEvents.callback(() => { onHook(); }) }));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: options.modules, revision: options.revision,
      workflow: { name: "probeTypeUpdateMissingEventBus", resources: withoutEvents, prepared, input: ShippingOptionTypeUpdateInput, output: fulfillment.output } }));
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
  return { fixture, fulfillment, execution, installed, options, prepare, prepareRoundtrip, prepareInverse, prepareAbsentInverse, prepareWithoutEventBus, read,
    snapshot: () => logicalCurrencyInventory(fixture) };
}
