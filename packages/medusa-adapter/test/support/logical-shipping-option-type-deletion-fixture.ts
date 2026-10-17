import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteShippingOptionTypesWorkflow } from "@medusajs/core-flows/shipping-options/delete-shipping-option-types";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents, orderedWorkflowIdEvents } from "../../src/workflow/events";
import { makeShippingOptionTypeDeletionCommands } from "../../src/modules/fulfillment/shipping-option-type-delete-service";
import { ShippingOptionTypeDeletionIds, decodeShippingOptionTypeDeletionIds } from "../../src/modules/fulfillment/shipping-option-type-delete-input";
import { prepareShippingOptionTypeDeletionLinkResource } from "../../src/links/shipping-option-type-deletion";
import { prepareShippingOptionTypeDeletionWorkflow, ShippingOptionTypeDeletionInput,
  type ShippingOptionTypeDeletionHooks } from "../../src/workflows/fulfillment/delete-shipping-option-types";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { shippingProfileOptionParents, shippingProfileDeletionSeedTime, type ShippingProfileDeletionInitialRow } from "./logical-shipping-profile-deletion-fixture";

export const shippingOptionTypeDeletionSeedTime = shippingProfileDeletionSeedTime;
const managed = (deleted = false) => ({ created_at: shippingOptionTypeDeletionSeedTime, updated_at: shippingOptionTypeDeletionSeedTime,
  deleted_at: deleted ? shippingOptionTypeDeletionSeedTime : null });
export function shippingOptionTypeDeletionGraph(prefix: string, count = 1, options: Readonly<{
  optionsPerType?: number; deletedOptions?: boolean; deletedTypes?: boolean;
}> = {}) {
  const ids = Array.from({ length: count }, (_, index) => `${prefix}-type-${index}`);
  const rows: ShippingProfileDeletionInitialRow[] = ids.flatMap(id => [
    { table: "shipping_option_type", row: { id, label: " Native " + id, description: null, code: " Native CODE ", ...managed(options.deletedTypes) } },
    ...Array.from({ length: options.optionsPerType ?? 0 }, (_, index) => ({ table: "shipping_option", row: {
      id: `${id}-option-${index}`, name: "Canonical native Option", price_type: "flat", data: null, metadata: { fixture: prefix },
      service_zone_id: "sp-delete-zone", shipping_profile_id: "sotype-delete-profile", provider_id: "sp-delete-provider",
      shipping_option_type_id: id, ...managed(options.deletedOptions),
    } })),
  ]);
  return { ids, optionIds: rows.filter(row => row.table === "shipping_option").map(row => Schema.decodeUnknownSync(Schema.String)(row.row.id)), rows };
}
const native = Result.getOrThrow(deleteShippingOptionTypesWorkflow.prepare());
function retained(name: string) {
  const node = native.nodes.find(node => node.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine retained Type deletion callback " + name);
  return node;
}
const typeStep = retained("delete-shipping-option-types"), linkStep = retained("remove-remote-links");

/** Initial state reuses the six-table source and native FK parents. Seed writes
 * grant no ShippingOption/provider workflow capability. */
export async function prepareLogicalShippingOptionTypeDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  graphs: readonly ReturnType<typeof shippingOptionTypeDeletionGraph>[], shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const configuration = { includeShippingProfile: true, includeShippingProfileDeletion: true };
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? configuration : { ...configuration, ...shared });
  const fulfillment = await Effect.runPromise(makeShippingOptionTypeDeletionCommands()), link = Result.getOrThrow(prepareShippingOptionTypeDeletionLinkResource());
  const definition = fixture.shippingProfileDefinition;
  if (definition === undefined || definition.schema.tables.length !== 6) throw new Error("Missing six-table Type deletion source");
  const supplied: ShippingProfileDeletionInitialRow[] = [...shippingProfileOptionParents,
    { table: "shipping_profile", row: { id: "sotype-delete-profile", name: "Type deletion Profile", type: "default", metadata: null, ...managed() } },
    ...graphs.flatMap(graph => graph.rows)];
  const order = ["fulfillment_set", "service_zone", "shipping_option_type", "fulfillment_provider", "shipping_profile", "shipping_option"];
  const initialRows = order.flatMap(table => supplied.filter(value => value.table === table));
  if (initialRows.length !== supplied.length) throw new Error("Unknown Type deletion seed table");
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: initialRows }, 1_048_576,
    { invalidInput: () => new Error("Invalid Type deletion seed"), hashFailure: cause => new Error("Type deletion seed hash", { cause }) }));
  const hostInput = { ...fixture.hostInput, commands: fulfillment.commands, identityAndAccessPolicy: { profile: "shipping-option-type-deletion-initialization" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: "medusa.shippingProfile", writeProfile: "medusa.shippingProfile", schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "shipping-option-type-deletion-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: initialRows.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializer = await Effect.runPromise(makeCommerceHost(hostInput));
  try { await Effect.runPromise(initializer.initialize(initialRows)); } finally { await Effect.runPromise(initializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const modules = { fulfillment: { module: fulfillment.workflow, logicalStorage: hostInput.logicalStorage } };
  const options: Parameters<typeof prepareShippingOptionTypeDeletionWorkflow>[0] = { execution, modules, link,
    revision: createHash("sha256").update("native-shipping-option-type-deletion-130").digest("hex"),
    subscribers: [{ id: "native-shipping-option-type-deletion", revision: "a".repeat(64) }] };
  const prepare = async (hooks: ShippingOptionTypeDeletionHooks = {}, revision = options.revision) => {
    const host = await Effect.runPromise(prepareShippingOptionTypeDeletionWorkflow({ ...options, hooks, revision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["softDeleteShippingOptionTypes", "restoreShippingOptionTypes"], graph: true } }, true, { link }));
  const Restore = Schema.Struct({ ids: ShippingOptionTypeDeletionIds, fail: Schema.optionalKey(Schema.Boolean) });
  const prepareInverse = async (roundtrip: boolean) => {
    const restore = createStep("invoke-retained-type-deletion-inverses", resources.callback(async (input: typeof Restore.Type, context) => {
      await linkStep.compensate!({ fulfillment: { shipping_option_type_id: [...input.ids] } }, context);
      await typeStep.compensate!([...input.ids], context);
      if (input.fail === true) throw new Error("Late native Type deletion inverse failure");
      return null;
    }));
    const workflow = createWorkflow(roundtrip ? "probe-type-deletion-roundtrip" : "probe-type-deletion-inverse", (input: WorkflowData<typeof Restore.Type>) => {
      if (roundtrip) {
        const deleted = deleteShippingOptionTypesWorkflow.runAsStep({ input: { ids: input.ids } });
        return new WorkflowResponse(restore(transform({ input, deleted }, ({ input }) => input)));
      }
      return new WorkflowResponse(restore(input));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued",
      workflow: { name: roundtrip ? "probeTypeDeletionRoundtrip" : "probeTypeDeletionInverse", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: Restore, output: Schema.Null, events: roundtrip ? orderedWorkflowIdEvents("shipping-option-type.deleted", Effect.fn(function* (calls) {
          const call = calls.calls(fulfillment.workflow.methods.softDeleteShippingOptionTypes)[0];
          if (call === undefined) throw new Error("Missing genuine root Type deletion receipt");
          return yield* Effect.fromResult(decodeShippingOptionTypeDeletionIds(call.input));
        })) : internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareLifecycle = async () => {
    const Input = Schema.Struct({ ids: ShippingOptionTypeDeletionIds, restore: Schema.Boolean });
    const invoke = createStep("probe-native-type-module-lifecycle", resources.callback(async (input: typeof Input.Type, context) =>
      input.restore ? context.resources.fulfillment.restoreShippingOptionTypes([...input.ids]) : context.resources.fulfillment.softDeleteShippingOptionTypes([...input.ids])));
    const workflow = createWorkflow("probe-native-type-module-lifecycle", (input: WorkflowData<typeof Input.Type>) => new WorkflowResponse(invoke(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued",
      workflow: { name: "probeNativeTypeModuleLifecycle", resources, prepared: Result.getOrThrow(workflow.prepare()), input: Input, output: Schema.JsonObject,
        events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareWithoutEventBus = async () => {
    const without = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
      methods: ["softDeleteShippingOptionTypes", "restoreShippingOptionTypes"], graph: true } }, false, { link }));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, revision: options.revision, operationScheduling: "queued",
      workflow: { name: "probeTypeDeletionMissingEventBus", resources: without, prepared: native, input: ShippingOptionTypeDeletionInput, output: Schema.Null } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const read = async (ids: readonly string[]) => {
    const inventory = await logicalCurrencyInventory(fixture), selected = new Set(ids), found: JsonObject[] = [];
    const scope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    for (const current of inventory.rows) {
      if (current.scopeUuid !== scope) continue;
      const record = inventory.revisions.find(row => row.scopeUuid === scope && row.tableId === current.tableId && row.commitSeq === current.commitSeq
        && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (record === undefined || record.isTombstone) continue;
      const value = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: record.valueBytes, sha256: record.valueSha256, profile: "appDocument" });
      const row = Schema.decodeUnknownSync(Schema.JsonObject)(value.valueJson);
      if (typeof row.id === "string" && selected.has(row.id)) found.push(row);
    }
    return found.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };
  return { fixture, fulfillment, link, execution, modules, options, prepare, resources, prepareRoundtrip: () => prepareInverse(true),
    prepareRestore: () => prepareInverse(false), prepareLifecycle, prepareWithoutEventBus, read, snapshot: () => logicalCurrencyInventory(fixture) };
}
