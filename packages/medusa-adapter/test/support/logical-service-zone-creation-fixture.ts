import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createServiceZonesWorkflow } from "@medusajs/core-flows/fulfillment/create-service-zones";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { jsonEqual } from "flarex-protocol/json";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { makeServiceZoneCreationCommands } from "../../src/modules/fulfillment/service-zone-create-service";
import { ServiceZonePhysicalDeletionIds } from "../../src/modules/fulfillment/service-zone-create-input";
import { prepareServiceZoneCreationWorkflow, ServiceZoneCreationInput } from "../../src/workflows/fulfillment/create-service-zones";
import { makeShippingOptionTypeCreationCommands } from "../../src/modules/fulfillment/shipping-option-type-service";
import { prepareShippingOptionTypeCreationWorkflow } from "../../src/workflows/fulfillment/create-shipping-option-types";
import { makeShippingProfileUpdateCommands } from "../../src/modules/fulfillment/shipping-profile-update-service";
import { prepareShippingProfileUpdateWorkflow } from "../../src/workflows/fulfillment/update-shipping-profiles";
import { captureServiceZoneCreationMetadata } from "../../src/modules/fulfillment/shipping-profile-schema";
import { compileCompleteRow } from "../../src/value/complete-row";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

const revision = (name: string) => createHash("sha256").update(name).digest("hex");
export const serviceZoneSeedTime = "2026-10-18T00:00:00.000Z";
const managed = (deleted = false) => ({ created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: deleted ? serviceZoneSeedTime : null });
const native = Result.getOrThrow(createServiceZonesWorkflow.prepare());
type NativeCreationInput = Parameters<typeof createServiceZonesWorkflow.runAsStep>[0]["input"];
const retained = native.nodes.find(node => node.name === "create-service-zones");
if (retained?.kind !== "step" || retained.compensation !== "transactionCovered" || retained.compensate === undefined)
  throw new Error("Missing genuine ServiceZone retained inverse");
const compensate = retained.compensate;
export const serviceZoneParents = { active: "zone-create-active-set", historical: "zone-create-historical-set", other: "zone-create-other-set", race: "zone-create-race-set" } as const;
type Seed = Readonly<{ table: string; row: JsonObject }>;

/** Canonical initial data exercises the installed cascade graph; it does not
 * grant Option/Rule or FulfillmentSet public creation authority. */
export function serviceZoneDeletionGraph(prefix: string, options: Readonly<{
  roots?: number; geos?: number; options?: number; rules?: number; historical?: boolean;
}> = {}) {
  const ids = Array.from({ length: options.roots ?? 1 }, (_, index) => `${prefix}-zone-${index}`);
  const geoIds = Array.from({ length: options.geos ?? 0 }, (_, index) => `${prefix}-geo-${index}`);
  const optionIds = Array.from({ length: options.options ?? 0 }, (_, index) => `${prefix}-option-${index}`);
  const ruleIds = Array.from({ length: options.rules ?? 0 }, (_, index) => `${prefix}-rule-${index}`);
  if (ids.length === 0 || (ruleIds.length > 0 && optionIds.length === 0)) throw new Error("Invalid ServiceZone comparison graph");
  const rows: Seed[] = [
    ...ids.map((id, index) => ({ table: "service_zone", row: { id, name: id, fulfillment_set_id: serviceZoneParents.active,
      metadata: { fixture: prefix }, ...managed(options.historical === true && index % 2 === 0) } })),
    ...geoIds.map((id, index) => ({ table: "geo_zone", row: { id, type: "country", country_code: "Raw" + index,
      province_code: null, city: null, postal_expression: null, metadata: null, service_zone_id: ids[index % ids.length]!,
      ...managed(options.historical === true && index % 2 === 0) } })),
    ...optionIds.map((id, index) => ({ table: "shipping_option", row: { id, name: id, price_type: "flat", data: null, metadata: null,
      service_zone_id: ids[index % ids.length]!, shipping_profile_id: "zone-create-protected-profile", provider_id: "zone-create-provider",
      shipping_option_type_id: "zone-create-type", ...managed(options.historical === true && index % 2 === 0) } })),
    ...ruleIds.map((id, index) => ({ table: "shipping_option_rule", row: { id, attribute: "native.rule", operator: "eq", value: { retained: index },
      shipping_option_id: optionIds[index % optionIds.length]!, ...managed(options.historical === true && index % 2 === 0) } })),
  ];
  return { ids, geoIds, optionIds, ruleIds, allIds: [...ids, ...geoIds, ...optionIds, ...ruleIds], rows };
}

/** All four native GeoZone kinds, retaining case and arbitrary postal JSON. */
export function maximumServiceZoneCreationInput(prefix: string): typeof ServiceZoneCreationInput.Type {
  return { data: Array.from({ length: 4 }, (_, index) => ({ name: `${prefix} ${index}`, fulfillment_set_id: serviceZoneParents.active,
    metadata: { ordinal: index, nested: { retained: true } }, geo_zones: [
      { type: "country", country_code: "Raw-Country" },
      { type: "province", country_code: "MM", province_code: "Raw-Province", metadata: { retained: true } },
      { type: "city", country_code: "MM", province_code: "YG", city: " Raw City " },
      { type: "zip", country_code: "MM", province_code: "YG", city: "Yangon", postal_expression: { arbitrary: [index, "Raw"] } },
    ] })) };
}

export async function prepareLogicalServiceZoneCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  graphs: readonly ReturnType<typeof serviceZoneDeletionGraph>[], shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const configuration = { includeShippingProfile: true, includeServiceZoneCreation: true };
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? configuration : { ...configuration, ...shared });
  const fulfillment = await Effect.runPromise(makeServiceZoneCreationCommands()), definition = fixture.shippingProfileDefinition;
  if (definition === undefined || definition.schema.tables.length !== 8) throw new Error("Missing fresh eight-table Fulfillment source");
  const supplied: Seed[] = [
    ...Object.values(serviceZoneParents).map(id => ({ table: "fulfillment_set", row: { id, name: id, type: "shipping", metadata: null,
      ...managed(id === serviceZoneParents.historical) } })),
    { table: "shipping_profile", row: { id: "zone-create-protected-profile", name: "Zone protected Profile", type: "default", metadata: null, ...managed() } },
    { table: "shipping_option_type", row: { id: "zone-create-type", label: "Zone type", code: "raw", description: null, ...managed() } },
    { table: "fulfillment_provider", row: { id: "zone-create-provider", is_enabled: true, ...managed() } },
    { table: "service_zone", row: { id: "zone-create-active-name", name: "Reserved global Zone name", fulfillment_set_id: serviceZoneParents.active, metadata: null, ...managed() } },
    { table: "service_zone", row: { id: "zone-create-historical-name", name: "Reusable historical Zone name", fulfillment_set_id: serviceZoneParents.active, metadata: null, ...managed(true) } },
    ...graphs.flatMap(graph => graph.rows),
  ];
  const order = ["fulfillment_set", "shipping_profile", "shipping_option_type", "fulfillment_provider", "service_zone", "geo_zone", "shipping_option", "shipping_option_rule"];
  const initial = order.flatMap(table => supplied.filter(value => value.table === table));
  if (initial.length !== supplied.length) throw new Error("Unknown ServiceZone seed table");
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: initial }, 1_048_576,
    { invalidInput: () => new Error("Invalid ServiceZone creation comparison seed"), hashFailure: cause => new Error("ServiceZone seed hash", { cause }) }));
  const input = { ...fixture.hostInput, commands: fulfillment.commands, identityAndAccessPolicy: { profile: "logical-service-zone-create-initialization" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: "medusa.shippingProfile", writeProfile: "medusa.shippingProfile", schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "service-zone-create-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: initial.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializer = await Effect.runPromise(makeCommerceHost(input));
  try { await Effect.runPromise(initializer.initialize(initial)); } finally { await Effect.runPromise(initializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const installed = { module: fulfillment.workflow, logicalStorage: input.logicalStorage };
  const options: Parameters<typeof prepareServiceZoneCreationWorkflow>[0] = { execution, modules: { fulfillment: installed },
    revision: revision("native-service-zone-create-131"), subscribers: [{ id: "native-service-zone-create", revision: "a".repeat(64) }] };
  const prepare = async (selectedRevision = options.revision) => {
    const host = await Effect.runPromise(prepareServiceZoneCreationWorkflow({ ...options, revision: selectedRevision })); close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["createServiceZones", "deleteServiceZones"], graph: false } }, true));
  const inverseStep = (lateFailure = false) => createStep("probe-native-service-zone-inverse", resources.callback(async (ids: typeof ServiceZonePhysicalDeletionIds.Type, context) => {
    await compensate([...ids], context); if (lateFailure) throw new Error("Late native ServiceZone inverse failure"); return new StepResponse(null);
  }));
  const prepareRoundtrip = async (lateFailure = false) => {
    const undo = inverseStep(lateFailure);
    const flow = createWorkflow("probe-native-service-zone-roundtrip", (value: WorkflowData<typeof ServiceZoneCreationInput.Type>) => {
      // SAFETY: checked DML admits nullable native metadata absent from DTOs.
      const output = createServiceZonesWorkflow.runAsStep({ input: value as NativeCreationInput });
      const inverse = undo(transform(output, rows => rows.map(row => row.id)));
      return new WorkflowResponse(transform({ output, inverse }, ({ output }) => output));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probeNativeServiceZoneRoundtrip", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: ServiceZoneCreationInput, output: fulfillment.output, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareInverse = async () => {
    const undo = inverseStep(), flow = createWorkflow("probe-native-service-zone-inverse", (ids: WorkflowData<typeof ServiceZonePhysicalDeletionIds.Type>) => new WorkflowResponse(undo(ids)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probeNativeServiceZoneInverse", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: ServiceZonePhysicalDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareAbsentInverse = async () => {
    const undo = createStep("probe-absent-native-zone-inverse", resources.callback(async (_input: null, context) => {
      await compensate(undefined, context); await compensate([], context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-absent-native-zone-inverse", (value: WorkflowData<null>) => new WorkflowResponse(undo(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probeAbsentNativeZoneInverse", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareExistingType = async () => {
    const type = await Effect.runPromise(makeShippingOptionTypeCreationCommands());
    const host = await Effect.runPromise(prepareShippingOptionTypeCreationWorkflow({ execution, revision: revision("service-zone-existing-type-131"),
      modules: { fulfillment: { module: type.workflow, logicalStorage: input.logicalStorage } }, subscribers: [{ id: "native-service-zone-type-create", revision: "a".repeat(64) }] }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareExistingProfile = async () => {
    const profile = await Effect.runPromise(makeShippingProfileUpdateCommands());
    const host = await Effect.runPromise(prepareShippingProfileUpdateWorkflow({ execution, revision: revision("service-zone-existing-profile-131"),
      fulfillment: { module: profile.workflow, logicalStorage: input.logicalStorage }, subscribers: [{ id: "native-service-zone-profile-update", revision: "b".repeat(64) }] }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  /** Canonical fixture mutation proves FK settlement with a competing parent
   * deletion. It establishes no native FulfillmentSet deletion API support. */
  const prepareParentRemoval = async () => {
    const metadata = await Effect.runPromise(captureServiceZoneCreationMetadata()), table = metadata.frame.tables.find(table => table.name === "fulfillment_set");
    if (table === undefined) throw new Error("Missing comparison FulfillmentSet table");
    const decode = Result.getOrThrow(compileCompleteRow(table));
    const remove = defineCommerceCommand("serviceZoneParentRaceFixtureRemove", "write", Effect.fn(function* (ctx, value) {
      const id = yield* Schema.decodeUnknownEffect(Schema.Literal(serviceZoneParents.race))(value).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      const store = yield* ctx.table(table.name); return [...yield* store.delete(ctx.manager, [{ id }])];
    }));
    const participant = defineAtomicCommerceParticipant("serviceZoneParentRaceFixture");
    const root = defineAtomicCommerceCommand("serviceZoneParentRaceFixtureRoot", (ctx, value) => ctx.call(participant, remove, value));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      identityAndAccessPolicy: { profile: "service-zone-parent-canonical-race-fixture" }, commands: [root],
      participants: [{ participant, logicalStorage: input.logicalStorage, commands: [remove],
        validateLogicalCall: Effect.fn("ServiceZoneParentRace.validate")(function* (call, activity, command) {
          if (command !== remove || call.commandName !== "serviceZoneParentRaceFixtureRemove" || call.mode !== "write" || call.input !== serviceZoneParents.race ||
            call.events.length || activity.mutations.length !== 1 || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
            return yield* Effect.fail(commerceError("receiptMismatch"));
          const mutation = activity.mutations[0], result = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject).check(Schema.isLengthBetween(1, 1)))(call.result)
            .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          if (mutation === undefined || mutation.ordinal !== 0 || mutation.table !== table.name || mutation.operation !== "delete" || mutation.after !== null || mutation.before === null)
            return yield* Effect.fail(commerceError("receiptMismatch"));
          const before = yield* Effect.fromResult(decode(projectNativeRow(mutation.before)));
          if (before.id !== serviceZoneParents.race || result[0] === undefined || !jsonEqual(result[0], projectNativeRow(mutation.before)))
            return yield* Effect.fail(commerceError("receiptMismatch"));
          for (const observation of activity.observedRows) {
            if (observation.table !== table.name) return yield* Effect.fail(commerceError("receiptMismatch"));
            yield* Effect.fromResult(decode(projectNativeRow(observation.row)));
          }
        }),
      }],
    }));
    close(() => Effect.runPromise(host.close));
    return { newRequestKey: host.newRequestKey, run: (key: string) => host.run(key, root, serviceZoneParents.race) };
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
  return { fixture, fulfillment, installed, options, execution, prepare, prepareRoundtrip, prepareInverse, prepareAbsentInverse, prepareExistingType,
    prepareExistingProfile, prepareParentRemoval, read,
    snapshot: () => logicalCurrencyInventory(fixture) };
}
