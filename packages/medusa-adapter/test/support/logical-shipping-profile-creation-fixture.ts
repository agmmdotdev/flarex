import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createShippingProfilesWorkflow } from "@medusajs/core-flows/fulfillment/create-shipping-profiles";
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
import { makeShippingProfileCreationCommands } from "../../src/modules/fulfillment/shipping-profile-create-service";
import { ShippingProfilePhysicalDeletionIds } from "../../src/modules/fulfillment/shipping-profile-create-input";
import { prepareShippingProfileCreationWorkflow, ShippingProfileCreationInput } from "../../src/workflows/fulfillment/create-shipping-profiles";
import { shippingProfileCreationResources } from "../../src/workflow/policy";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { shippingProfileOptionParents, shippingProfileDeletionGraph, type ShippingProfileDeletionInitialRow } from "./logical-shipping-profile-deletion-fixture";

const revision = (name: string) => createHash("sha256").update(name).digest("hex");
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

/** Canonical initial state reuses127's full native parent/Option builders.
 * Only the six-table source is installed; no Product or Link setup is run. */
export async function prepareLogicalShippingProfileCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  graphs: readonly ReturnType<typeof shippingProfileDeletionGraph>[] = Object.values(shippingProfileCreationGraphs),
  shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const configuration = { includeShippingProfile: true, includeShippingProfileDeletion: true };
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? configuration : { ...configuration, ...shared });
  const fulfillment = await Effect.runPromise(makeShippingProfileCreationCommands()), definition = fixture.shippingProfileDefinition;
  if (definition === undefined || definition.schema.tables.length !== 6) throw new Error("Missing six-table ShippingProfile source");
  const supplied: readonly ShippingProfileDeletionInitialRow[] = [...shippingProfileOptionParents, ...graphs.flatMap(graph => graph.rows)];
  const order = ["fulfillment_set", "service_zone", "shipping_option_type", "fulfillment_provider", "shipping_profile", "shipping_option"];
  const initial = order.flatMap(table => supplied.filter(value => value.table === table));
  if (initial.length !== supplied.length) throw new Error("Unexpected ShippingProfile comparison table");
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: initial }, 1_048_576,
    { invalidInput: () => new Error("Invalid Profile creation comparison seed"), hashFailure: cause => new Error("Profile comparison hash", { cause }) }));
  const input = { ...fixture.hostInput, commands: fulfillment.commands,
    identityAndAccessPolicy: { profile: "logical-shipping-profile-create-initialization" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: "medusa.shippingProfile", writeProfile: "medusa.shippingProfile", schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "shipping-profile-create-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: initial.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializer = await Effect.runPromise(makeCommerceHost(input));
  try { await Effect.runPromise(initializer.initialize(initial)); } finally { await Effect.runPromise(initializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const installed = { module: fulfillment.workflow, logicalStorage: input.logicalStorage };
  const options: Parameters<typeof prepareShippingProfileCreationWorkflow>[0] = { execution, fulfillment: installed,
    revision: revision("native-shipping-profile-create-135"), subscribers: [{ id: "native-shipping-profile-create", revision: "d".repeat(64) }] };
  const prepare = async (selectedRevision = options.revision) => {
    const host = await Effect.runPromise(prepareShippingProfileCreationWorkflow({ ...options, revision: selectedRevision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const modules = { fulfillment: { ...installed, logicalResources: shippingProfileCreationResources } };
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["createShippingProfiles", "deleteShippingProfiles"], graph: false } }, true));
  const prepareRoundtrip = async (actualRetained: () => unknown, lateFailure = false) => {
    const undo = createStep("probe-native-profile-retained-inverse", resources.callback(async (_value: null, context) => {
      await compensate(actualRetained(), context);
      if (lateFailure) throw new Error("Late genuine Profile retained inverse failure"); return null;
    }));
    const flow = createWorkflow("probe-native-profile-creation-roundtrip", (value: WorkflowData<typeof ShippingProfileCreationInput.Type>) => {
      // SAFETY: the public DTO omits supplied persistence IDs admitted by the
      // checked DML. Preserve real values at this native authoring boundary.
      const output = createShippingProfilesWorkflow.runAsStep({ input: value as NativeCreationInput });
      const inverse = undo(transform(output, () => null));
      return new WorkflowResponse(transform({ output, inverse }, ({ output }) => output));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, revision: options.revision, subscribers: options.subscribers,
      requestCallLimit: shippingProfileCreationResources.calls, requestEventLimit: shippingProfileCreationResources.eventMessages,
      workflow: { name: "probeNativeShippingProfileRoundtrip", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: ShippingProfileCreationInput, output: fulfillment.output, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareInverse = async (lateFailure = false) => {
    const undo = createStep("probe-native-profile-physical-inverse", resources.callback(async (ids: typeof ShippingProfilePhysicalDeletionIds.Type, context) => {
      await compensate([...ids], context);
      if (lateFailure) throw new Error("Late genuine Profile physical inverse failure"); return null;
    }));
    const flow = createWorkflow("probe-native-profile-physical-inverse", (ids: WorkflowData<typeof ShippingProfilePhysicalDeletionIds.Type>) => new WorkflowResponse(undo(ids)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, revision: options.revision, subscribers: options.subscribers,
      requestCallLimit: shippingProfileCreationResources.calls, requestEventLimit: shippingProfileCreationResources.eventMessages,
      workflow: { name: "probeNativeShippingProfileInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: ShippingProfilePhysicalDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareAbsentInverse = async () => {
    const undo = createStep("probe-absent-native-profile-inverse", resources.callback(async (_input: null, context) => {
      await compensate(undefined, context); await compensate([], context); return null;
    }));
    const flow = createWorkflow("probe-absent-native-profile-inverse", (value: WorkflowData<null>) => new WorkflowResponse(undo(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, revision: options.revision, subscribers: options.subscribers,
      workflow: { name: "probeAbsentNativeProfileInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } }));
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

  return { fixture, fulfillment, installed, options, execution, modules, prepare, prepareRoundtrip, prepareInverse, prepareAbsentInverse, read,
    snapshot: () => logicalCurrencyInventory(fixture) };
}
