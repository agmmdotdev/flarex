import { createHash, randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createServiceZonesWorkflow } from "@medusajs/core-flows/fulfillment/create-service-zones";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { makeServiceZoneCreationCommands } from "../../src/modules/fulfillment/service-zone-create-service";
import { ServiceZonePhysicalDeletionIds } from "../../src/modules/fulfillment/service-zone-create-input";
import { prepareServiceZoneCreationWorkflow, ServiceZoneCreationInput } from "../../src/workflows/fulfillment/create-service-zones";
import { captureServiceZoneCreationMetadata, compileServiceZoneCreationCoreDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { compileCompleteRow } from "../../src/value/complete-row";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";
import { orderFixtureHosts } from "./core-order-fixture";
import { fulfillmentForestRows, serviceZoneParents } from "./native-fulfillment-graph-fixture";

const revision = createHash("sha256").update("native-service-zone-create-131").digest("hex");
const subscribers = [{ id: "native-service-zone-create", revision: "a".repeat(64) }];
type NativeCreationInput = Parameters<typeof createServiceZonesWorkflow.runAsStep>[0]["input"];
const native = Result.getOrThrow(createServiceZonesWorkflow.prepare());
const retained = native.nodes.find(node => node.name === "create-service-zones");
if (retained?.kind !== "step" || retained.compensation !== "transactionCovered" || retained.compensate === undefined)
  throw new Error("Missing genuine ServiceZone retained inverse");
const compensate = retained.compensate;

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

export async function prepareCoreServiceZoneStorage(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  graphs: Parameters<typeof fulfillmentForestRows>[0], physical?: CorePersistenceFixture) {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const { definition, eventDefinition, fulfillment } = await Effect.runPromise(Effect.all({
    definition: compileServiceZoneCreationCoreDefinition(target), eventDefinition: compileCoreNativeEventStorageDefinition(target),
    fulfillment: makeServiceZoneCreationCommands(),
  }));
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition,
    sources: [{ name: "fulfillment", definition, initialCommands: fulfillment.commands, rows: fulfillmentForestRows(graphs, true) }],
    ...(physical === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(physical) }),
  });
  close(fixture.close);
  const { own, closeCaseHosts } = orderFixtureHosts(close);
  return { fixture, definition, fulfillment, own, closeCaseHosts, execution: fixture.execution, nativeStorage: fixture.source("fulfillment"),
    read: (ids: readonly string[]) => fixture.readRows("fulfillment", ids), snapshot: fixture.snapshot };
}

type Storage = Awaited<ReturnType<typeof prepareCoreServiceZoneStorage>>;

function creationProbe(base: Storage) {
  const installed = { module: base.fulfillment.workflow, nativeStorage: base.nativeStorage };
  const options = { execution: base.execution, modules: { fulfillment: installed }, revision, subscribers };
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: base.fulfillment.workflow,
    methods: ["createServiceZones", "deleteServiceZones"], graph: false } }, true));
  return { installed, options, resources };
}

export async function prepareCoreServiceZonePhysicalInverse(base: Storage) {
  const { options, resources } = creationProbe(base);
  const undo = createStep("probe-native-service-zone-inverse", resources.callback(async (ids: typeof ServiceZonePhysicalDeletionIds.Type, context) => {
    await compensate([...ids], context);
    return new StepResponse(null);
  }));
  const flow = createWorkflow("probe-native-service-zone-inverse", (ids: WorkflowData<typeof ServiceZonePhysicalDeletionIds.Type>) => new WorkflowResponse(undo(ids)));
  return base.own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probeNativeServiceZoneInverse", resources,
    prepared: Result.getOrThrow(flow.prepare()), input: ServiceZonePhysicalDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } })));
}

export async function prepareCoreServiceZoneCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  graphs: Parameters<typeof fulfillmentForestRows>[0], physical?: CorePersistenceFixture) {
  const base = await prepareCoreServiceZoneStorage(driver, close, graphs, physical);
  const { installed, options, resources } = creationProbe(base);
  const prepare = async (selectedRevision = revision) => base.own(await Effect.runPromise(
    prepareServiceZoneCreationWorkflow({ ...options, revision: selectedRevision })));
  const prepareRoundtrip = async (actualRetained: () => unknown, lateFailure?: Error) => {
    const undo = createStep("probe-native-service-zone-roundtrip-inverse", resources.callback(async (_value: null, context) => {
      await compensate(actualRetained(), context);
      if (lateFailure !== undefined) throw lateFailure;
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-native-service-zone-roundtrip", (value: WorkflowData<typeof ServiceZoneCreationInput.Type>) => {
      // SAFETY: checked DML admits nullable native metadata absent from DTOs.
      const output = createServiceZonesWorkflow.runAsStep({ input: value as NativeCreationInput });
      const inverse = undo(transform(output, () => null));
      return new WorkflowResponse(transform({ output, inverse }, ({ output }) => output));
    });
    return base.own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probeNativeServiceZoneRoundtrip", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: ServiceZoneCreationInput, output: base.fulfillment.output, events: internalModuleWorkflowEvents } })));
  };
  const prepareAbsentInverse = async () => {
    const undo = createStep("probe-absent-native-zone-inverse", resources.callback(async (_input: null, context) => {
      await compensate(undefined, context); await compensate([], context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-absent-native-zone-inverse", (value: WorkflowData<null>) => new WorkflowResponse(undo(value)));
    return base.own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probeAbsentNativeZoneInverse", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  return { ...base, installed, options, prepare, prepareRoundtrip, prepareInverse: () => prepareCoreServiceZonePhysicalInverse(base),
    prepareAbsentInverse, prepareParentRemoval: () => prepareParentRemoval(base) };
}

/** Canonical contender for an FK race. It exposes no FulfillmentSet API. */
async function prepareParentRemoval(base: Storage) {
  const metadata = await Effect.runPromise(captureServiceZoneCreationMetadata());
  const table = metadata.frame.tables.find(table => table.name === "fulfillment_set");
  if (table === undefined) throw new Error("Missing comparison FulfillmentSet table");
  const decode = Result.getOrThrow(compileCompleteRow(table));
  const remove = defineCommerceCommand("serviceZoneParentRaceFixtureRemove", "write", Effect.fn(function* (ctx, value) {
    const id = yield* Schema.decodeUnknownEffect(Schema.Literal(serviceZoneParents.race))(value).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    const store = yield* ctx.table(table.name);
    return [...yield* store.delete(ctx.manager, [{ id }])];
  }));
  const participant = defineAtomicCommerceParticipant("serviceZoneParentRaceFixture");
  const root = defineAtomicCommerceCommand("serviceZoneParentRaceFixtureRoot", (ctx, value) => ctx.call(participant, remove, value));
  const host = base.own(await Effect.runPromise(base.execution.prepare({
    identityAndAccessPolicy: { profile: "service-zone-parent-canonical-race-fixture" }, commands: [root],
    participants: [{ participant, nativeStorage: base.nativeStorage, commands: [remove],
      validateLogicalCall: Effect.fn("ServiceZoneParentRace.validate")(function* (call, activity, command) {
        if (command !== remove || call.commandName !== "serviceZoneParentRaceFixtureRemove" || call.mode !== "write" || call.input !== serviceZoneParents.race ||
          call.events.length || activity.mutations.length !== 1 || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const mutation = activity.mutations[0];
        const result = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.JsonObject]))(call.result)
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (mutation === undefined || mutation.ordinal !== 0 || mutation.table !== table.name || mutation.operation !== "delete" || mutation.after !== null || mutation.before === null)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const before = yield* Effect.fromResult(decode(projectNativeRow(mutation.before)));
        if (before.id !== serviceZoneParents.race || !jsonEqual(result[0], projectNativeRow(mutation.before)))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        for (const observation of activity.observedRows) {
          if (observation.table !== table.name) return yield* Effect.fail(commerceError("receiptMismatch"));
          yield* Effect.fromResult(decode(projectNativeRow(observation.row)));
        }
      }),
    }],
  })));
  return { newRequestKey: host.newRequestKey, run: (key: string) => host.run(key, root, serviceZoneParents.race) };
}
