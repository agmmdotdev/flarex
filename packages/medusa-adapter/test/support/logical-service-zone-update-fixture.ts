import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateServiceZonesWorkflow } from "@medusajs/core-flows/fulfillment/update-service-zones";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { serviceZoneUpdateResources } from "../../src/workflow/policy";
import { captureServiceZoneCreationMetadata } from "../../src/modules/fulfillment/shipping-profile-schema";
import { compileFulfillmentGraphContracts } from "../../src/modules/fulfillment/fulfillment-graph-contracts";
import { projectNativeRow } from "../../src/repository/result";
import { makeServiceZoneUpdateCommands } from "../../src/modules/fulfillment/service-zone-update-service";
import { ServiceZoneUpdateInput, ServiceZoneUpdateUpserts } from "../../src/modules/fulfillment/service-zone-update-input";
import { prepareServiceZoneUpdateWorkflow } from "../../src/workflows/fulfillment/update-service-zones";
import { prepareLogicalServiceZoneCreation, serviceZoneDeletionGraph } from "./logical-service-zone-creation-fixture";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

const prepared = Result.getOrThrow(updateServiceZonesWorkflow.prepare());
const retained = prepared.nodes.find(node => node.name === "update-service-zones");
if (retained?.kind !== "step" || retained.compensation !== "transactionCovered" || retained.compensate === undefined)
  throw new Error("Missing genuine ServiceZone update retained callback pair");
const invoke = retained.invoke, compensate = retained.compensate;
type NativeInput = Parameters<typeof updateServiceZonesWorkflow.runAsStep>[0]["input"];

/** Existing fresh eight-table source, graph initialization and scope inventory.
 * Every observed update/inverse calls the genuine Fulfillment methods. */
export async function prepareLogicalServiceZoneUpdate(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  graphs: readonly ReturnType<typeof serviceZoneDeletionGraph>[], shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const base = await prepareLogicalServiceZoneCreation(driver, close, graphs, shared);
  const fulfillment = await Effect.runPromise(makeServiceZoneUpdateCommands());
  const installed = { module: fulfillment.workflow, logicalStorage: base.installed.logicalStorage, logicalResources: serviceZoneUpdateResources };
  const options: Parameters<typeof prepareServiceZoneUpdateWorkflow>[0] = { execution: base.execution, modules: { fulfillment: installed },
    revision: createHash("sha256").update("native-service-zone-update-133").digest("hex"),
    subscribers: [{ id: "native-service-zone-update", revision: "c".repeat(64) }] };
  const hostOptions = { execution: options.execution, modules: { fulfillment: installed }, revision: options.revision, subscribers: options.subscribers,
    requestCallLimit: serviceZoneUpdateResources.calls, requestEventLimit: serviceZoneUpdateResources.eventMessages };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareServiceZoneUpdateWorkflow({ ...options, revision })); close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["listServiceZones", "updateServiceZones", "upsertServiceZones"], graph: false } }, true));
  const Input = Schema.Struct({ input: ServiceZoneUpdateInput, fail: Schema.optionalKey(Schema.Boolean) });
  const Output = Schema.Struct({ output: fulfillment.output, preimages: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)) });
  const prepareCallbacks = async (roundtrip: boolean) => {
    const forward = createStep("probe-native-service-zone-update-callbacks", resources.callback(async (value: typeof Input.Type, context) => {
      const response = await invoke(value.input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine ServiceZone StepResponse");
      if (roundtrip) await compensate(response.compensateInput, context);
      if (value.fail === true) throw new Error("Late native ServiceZone update/inverse failure");
      return { output: response.output, preimages: response.compensateInput };
    }));
    const flow = createWorkflow(roundtrip ? "probe-native-service-zone-update-roundtrip" : "probe-native-service-zone-update-forward",
      (value: WorkflowData<typeof Input.Type>) => new WorkflowResponse(forward(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...hostOptions, workflow: {
      name: roundtrip ? "probeNativeServiceZoneUpdateRoundtrip" : "probeNativeServiceZoneUpdateForward", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: Input, output: Output, events: internalModuleWorkflowEvents,
    } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareInverse = async () => {
    const undo = createStep("probe-native-service-zone-update-inverse", resources.callback(async (preimages: typeof ServiceZoneUpdateUpserts.Type, context) => {
      await compensate(preimages, context); return null;
    }));
    const flow = createWorkflow("probe-native-service-zone-update-inverse", (value: WorkflowData<typeof ServiceZoneUpdateUpserts.Type>) => new WorkflowResponse(undo(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...hostOptions, workflow: { name: "probeNativeServiceZoneUpdateInverse", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: ServiceZoneUpdateUpserts, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  /** The test supplies a scoped delegating native public-list tap. The full
   * genuine root receives that actual result; no preimage query is reproduced. */
  const prepareRootRoundtrip = async (preimages: () => unknown) => {
    const undo = createStep("probe-native-service-zone-root-retained-inverse", resources.callback(async (_input: null, context) => {
      const original = preimages(); await compensate(original, context); return original;
    }));
    const flow = createWorkflow("probe-native-service-zone-full-root-roundtrip", (value: WorkflowData<typeof ServiceZoneUpdateInput.Type>) => {
      // SAFETY: admission preserves invalid geography for the genuine native
      // service to reject in its own validation order; the DTO is narrower.
      const output = updateServiceZonesWorkflow.runAsStep({ input: value as NativeInput });
      const original = undo(transform(output, () => null));
      return new WorkflowResponse({ output, preimages: original });
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...hostOptions, workflow: { name: "probeNativeServiceZoneFullRootRoundtrip", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: ServiceZoneUpdateInput, output: Output, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareAbsentInverse = async () => {
    const undo = createStep("probe-native-service-zone-update-absent-inverse", resources.callback(async (_value: null, context) => {
      await compensate(undefined, context); await compensate([], context); return null;
    }));
    const flow = createWorkflow("probe-native-service-zone-update-absent-inverse", (value: WorkflowData<null>) => new WorkflowResponse(undo(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...hostOptions, workflow: { name: "probeNativeServiceZoneUpdateAbsentInverse", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  /** One canonical Geo insert for an indexed-read race, granting no public
   * native GeoZone mutation capability or second storage implementation. */
  const prepareGeoInsertion = async () => {
    const contracts = Result.getOrThrow(compileFulfillmentGraphContracts((await Effect.runPromise(captureServiceZoneCreationMetadata())).frame));
    const insert = defineCommerceCommand("serviceZoneGeoRaceFixtureInsert", "write", Effect.fn(function* (ctx, value) {
      const row = yield* Effect.fromResult(contracts.decodeGeoRow(value));
      if (row.deleted_at !== null) return yield* ctx.refuse(commerceError("invalidInput"));
      const store = yield* ctx.table(contracts.geo.name); return [...yield* store.write(ctx.manager, "insert", [row])];
    }));
    const participant = defineAtomicCommerceParticipant("serviceZoneGeoRaceFixture");
    const root = defineAtomicCommerceCommand("serviceZoneGeoRaceFixtureRoot", (ctx, value) => ctx.call(participant, insert, value));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...base.fixture.hostInput,
      identityAndAccessPolicy: { profile: "service-zone-geo-canonical-race-fixture" }, commands: [root],
      participants: [{ participant, logicalStorage: installed.logicalStorage, commands: [insert],
        validateLogicalCall: Effect.fn("ServiceZoneGeoRace.validate")(function* (call, activity, command) {
          if (command !== insert || call.commandName !== "serviceZoneGeoRaceFixtureInsert" || call.mode !== "write" || call.events.length ||
            activity.mutations.length !== 1 || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
            return yield* Effect.fail(commerceError("receiptMismatch"));
          const supplied = yield* Effect.fromResult(contracts.decodeGeoRow(call.input)), result = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject).check(Schema.isLengthBetween(1, 1)))(call.result)
            .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          const mutation = activity.mutations[0], row = result[0];
          if (mutation === undefined || mutation.ordinal !== 0 || mutation.table !== contracts.geo.name || mutation.operation !== "insert" || mutation.before !== null ||
            mutation.after === null || row === undefined || !jsonEqual(row, supplied) || !jsonEqual(row, projectNativeRow(mutation.after)))
            return yield* Effect.fail(commerceError("receiptMismatch"));
          for (const observation of activity.observedRows) {
            if (observation.table !== contracts.geo.name) return yield* Effect.fail(commerceError("receiptMismatch"));
            yield* Effect.fromResult(contracts.decodeGeoRow(projectNativeRow(observation.row)));
          }
        }),
      }],
    }));
    close(() => Effect.runPromise(host.close)); return { newRequestKey: host.newRequestKey, run: (key: string, row: JsonObject) => host.run(key, root, row) };
  };
  return { ...base, fulfillment, installed, options, hostOptions, resources, prepare, prepareInverse, prepareRootRoundtrip, prepareAbsentInverse,
    prepareForward: () => prepareCallbacks(false), prepareRoundtrip: () => prepareCallbacks(true), prepareCreation: base.prepare,
    preparePhysicalDelete: base.prepareInverse, prepareGeoInsertion };
}
