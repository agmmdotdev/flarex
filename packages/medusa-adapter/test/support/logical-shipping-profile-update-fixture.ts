import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateShippingProfilesWorkflow } from "@medusajs/core-flows/fulfillment/update-shipping-profiles";
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
import { makeShippingProfileUpdateCommands } from "../../src/modules/fulfillment/shipping-profile-update-service";
import { ShippingProfileUpdateInput } from "../../src/modules/fulfillment/shipping-profile-update-input";
import { prepareShippingProfileUpdateWorkflow } from "../../src/workflows/fulfillment/update-shipping-profiles";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

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

/** Canonical seed/history and committed observation reuse the existing installed
 * fixture. Mutations execute native Fulfillment methods, never test storage. */
export async function prepareLogicalShippingProfileUpdate(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  initial: readonly JsonObject[], shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? { includeShippingProfile: true }
    : { includeShippingProfile: true, ...shared });
  const fulfillment = await Effect.runPromise(makeShippingProfileUpdateCommands()), definition = fixture.shippingProfileDefinition;
  if (definition === undefined) throw new Error("Missing installed ShippingProfile source");
  // The existing initializer takes raw rows for a single-table source;
  // table envelopes belong to its distinct multi-table initialization shape.
  const initialRows = initial.map(row => ({ ...row }));
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: initialRows }, 1_048_576,
    { invalidInput: () => new Error("Invalid ShippingProfile update seed"), hashFailure: cause => new Error("ShippingProfile seed hash", { cause }) }));
  const hostInput = { ...fixture.hostInput, commands: fulfillment.commands,
    identityAndAccessPolicy: { profile: "logical-shipping-profile-update-initialization" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: "medusa.shippingProfile", writeProfile: "medusa.shippingProfile", schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "shipping-profile-update-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: initialRows.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializer = await Effect.runPromise(makeCommerceHost(hostInput));
  try { await Effect.runPromise(initializer.initialize(initialRows)); } finally { await Effect.runPromise(initializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const installed = { module: fulfillment.workflow, logicalStorage: hostInput.logicalStorage };
  const options: Parameters<typeof prepareShippingProfileUpdateWorkflow>[0] = { execution, fulfillment: installed,
    revision: "6".repeat(64), subscribers: [{ id: "native-shipping-profile-update", revision: "7".repeat(64) }] };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareShippingProfileUpdateWorkflow({ ...options, revision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["listShippingProfiles", "updateShippingProfiles", "upsertShippingProfiles"], graph: false } }, true));
  const prepareRoundtrip = async () => {
    const Input = Schema.Struct({ input: ShippingProfileUpdateInput, fail: Schema.optionalKey(Schema.Boolean) });
    const Output = Schema.Struct({ output: fulfillment.output, preimages: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)) });
    const roundtrip = createStep("probe-native-shipping-profile-update-roundtrip", resources.callback(async (input: typeof Input.Type, context) => {
      const response = await invoke(input.input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine ShippingProfile StepResponse");
      await compensate(response.compensateInput, context);
      if (input.fail === true) throw new Error("Late native ShippingProfile inverse failure");
      return { output: response.output, preimages: response.compensateInput };
    }));
    const workflow = createWorkflow("probe-native-shipping-profile-update-roundtrip", (input: WorkflowData<typeof Input.Type>) => new WorkflowResponse(roundtrip(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { fulfillment: installed },
      revision: options.revision, subscribers: options.subscribers,
      workflow: { name: "probeNativeShippingProfileUpdateRoundtrip", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: Input, output: Output, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareAbsentInverse = async () => {
    const undo = createStep("probe-native-shipping-profile-empty-inverses", resources.callback(async (_input: null, context) => {
      await compensate(undefined, context); await compensate([], context); return null;
    }));
    const workflow = createWorkflow("probe-native-shipping-profile-empty-inverses", (input: WorkflowData<null>) => new WorkflowResponse(undo(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { fulfillment: installed },
      revision: options.revision, subscribers: options.subscribers,
      workflow: { name: "probeNativeShippingProfileEmptyInverses", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const read = async (ids: readonly string[]) => {
    const inventory = await logicalCurrencyInventory(fixture), selected = new Set(ids), result: JsonObject[] = [];
    for (const current of inventory.rows) {
      if (current.scopeUuid !== projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid) continue;
      const revision = inventory.revisions.find(row => row.scopeUuid === current.scopeUuid && row.tableId === current.tableId
        && row.commitSeq === current.commitSeq && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (revision === undefined || revision.isTombstone) continue;
      const value = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: revision.valueBytes, sha256: revision.valueSha256, profile: "appDocument" });
      const row = Schema.decodeUnknownSync(Schema.JsonObject)(value.valueJson);
      if (typeof row.id === "string" && selected.has(row.id)) result.push(projectNativeRow(row));
    }
    return result.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  };
  return { fixture, fulfillment, execution, installed, options, prepare, prepareRoundtrip, prepareAbsentInverse, read,
    snapshot: () => logicalCurrencyInventory(fixture) };
}
