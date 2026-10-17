import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteReservationsByLineItemsWorkflow } from "@medusajs/core-flows/reservation/delete-reservations-by-line-items";
import type { InventoryModuleService } from "@medusajs/inventory/services";
import { defineCommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ReservationLineItemIds } from "../../src/modules/inventory/reservation-line-item-input";
import { makeInventoryReservationLineItemCommands } from "../../src/modules/inventory/reservation-line-item-service";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { InventoryLevelDeletionIds } from "../../src/modules/inventory/delete-level-input";
import { prepareDeleteReservationsByLineItemsWorkflow } from "../../src/workflows/inventory/reservation-line-items";
import { prepareUpdateReservationWorkflow, prepareReleaseReservationWorkflow } from "../../src/workflows/inventory/adjust-and-reserve";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalInventoryLevelUpdate } from "./logical-inventory-level-update-fixture";
import type { LogicalInventoryMaintenanceShared } from "./logical-inventory-maintenance-fixture";

const native = Result.getOrThrow(deleteReservationsByLineItemsWorkflow.prepare());
const node = native.nodes.find(entry => entry.kind === "step" && entry.name === "delete-reservations-by-line-items");
if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
  throw new Error("Missing genuine Reservation Line Item retained callback");
const forward = node.invoke, compensate = node.compensate;
const StoredRow = Schema.StructWithRest(Schema.Struct({ id: Schema.String, inventory_item_id: Schema.String, location_id: Schema.String,
  deleted_at: Schema.NullOr(Schema.String) }), [Schema.Record(Schema.String, Schema.Json)]);
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(StoredRow));
const decodeProbe = Schema.decodeUnknownEffect(Schema.Struct({ ids: Schema.Array(Schema.String).check(Schema.isMaxLength(8)) }));
const probeCommand = defineCommerceCommand("reservationLineItemStoredProbe", "read", Effect.fn(function* (ctx, input) {
  const { ids } = yield* decodeProbe(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
  return [...yield* (yield* ctx.table("reservation_item")).find(ctx.manager, { predicate: { kind: "in", column: "id", values: ids },
    take: 8, order: { column: "id", direction: "asc" } })];
}));
const ProbeResponse = Schema.Struct({ output: Schema.Null, compensation: ReservationLineItemIds });
export interface ReservationLineItemSeed {
  readonly pair?: number;
  readonly line?: string | null;
  readonly quantity?: number;
  readonly deleted?: boolean;
}

/** Existing native Item/Location/Reservation seeds retain all business logic.
 * The new composition only binds the by-Line-Item owner and invokes genuine
 * retained callbacks. Direct reads observe full stored history by primary ID. */
export async function prepareLogicalReservationLineItems(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: LogicalInventoryMaintenanceShared) {
  const common = await prepareLogicalInventoryLevelUpdate(driver, close, shared);
  const { fixture, members } = common;
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const lineItems = await Effect.runPromise(makeInventoryReservationLineItemCommands());
  const inventory = { module: lineItems.workflow, logicalStorage: members.inventory.hostInput.logicalStorage };
  const subscribers = [{ id: "native-reservation-line-items", revision: "d".repeat(64) }];
  const options: Parameters<typeof prepareDeleteReservationsByLineItemsWorkflow>[0] = { execution, inventory, revision: "e".repeat(64), subscribers };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareDeleteReservationsByLineItemsWorkflow({ ...options, revision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const raw = await Effect.runPromise(makeCommerceHost({ ...members.inventory.hostInput, commands: [probeCommand] }));
  close(() => Effect.runPromise(raw.close));
  const probeReservations = (ids: readonly string[]) => raw.read(probeCommand, { ids: [...ids] }).pipe(Effect.flatMap(decodeRows));
  const stockOptions = { execution: common.execution, inventory: common.inventory, revision: "f".repeat(64), subscribers };
  const update = await Effect.runPromise(prepareUpdateReservationWorkflow(stockOptions));
  const release = await Effect.runPromise(prepareReleaseReservationWorkflow(stockOptions));
  for (const host of [update, release]) close(() => Effect.runPromise(host.close));
  const seed = async (prefix: string, rows: readonly ReservationLineItemSeed[] = [{}]) => {
    const count = Math.max(1, ...rows.map(row => (row.pair ?? 0) + 1)), graph = await common.seed(prefix, count);
    const reservations: Array<{ id: string; line: string | null; pair: number; quantity: number }> = [];
    for (const [index, row] of rows.entries()) {
      const pair = row.pair ?? 0, endpoint = graph.pairs[pair]; if (endpoint === undefined) throw new Error("Missing native Reservation seed endpoint");
      const line = row.line === undefined ? prefix + "-line-" + index : row.line, quantity = row.quantity ?? 1;
      const created = await Effect.runPromise(common.reservations.run(common.reservations.newRequestKey(), { reservations: [{ ...endpoint,
        quantity, line_item_id: line, metadata: { ordinal: index, retained: prefix } }] }));
      const first = created[0]; if (created.length !== 1 || first === undefined) throw new Error("Missing genuine native Reservation seed");
      reservations.push({ id: first.id, line, pair, quantity });
      if (row.deleted === true) await Effect.runPromise(release.run(release.newRequestKey(), { ids: [first.id] }));
    }
    return { ...graph, reservations, ids: reservations.map(row => row.id),
      lines: [...new Set(reservations.flatMap(row => row.line === null ? [] : [row.line]))] };
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ inventory: { module: lineItems.workflow,
    methods: ["deleteReservationItemsByLineItem", "restoreReservationItemsByLineItem"], graph: false } }, true));
  const prepareProbes = async () => {
    const invoke = createStep("probe-retained-reservation-line-item-forward", resources.callback(async (ids: typeof ReservationLineItemIds.Type, context) => {
      const response = await forward(ids, context);
      if (!(response instanceof StepResponse) || response.output !== undefined) throw new Error("Missing native void StepResponse");
      return { output: null, compensation: response.compensateInput };
    }));
    const undo = createStep("probe-retained-reservation-line-item-inverse", resources.callback(async (ids: typeof ReservationLineItemIds.Type, context) => {
      await compensate(ids, context); return null;
    }));
    const undoAbsent = createStep("probe-retained-reservation-line-item-absent-inverse", resources.callback(async (_input: null, context) => {
      await compensate(undefined, context); return null;
    }));
    const directRestore = createStep("probe-native-reservation-line-item-restore", resources.callback(async (ids: typeof ReservationLineItemIds.Type, context) => {
      const service = context.container.resolve<Pick<InventoryModuleService, "restoreReservationItemsByLineItem">>("inventory");
      await service.restoreReservationItemsByLineItem(ids); return null;
    }));
    const rollback = createStep("probe-retained-reservation-line-item-roundtrip-rollback", resources.callback(async (ids: typeof ReservationLineItemIds.Type, context) => {
      const response = await forward(ids, context); if (!(response instanceof StepResponse)) throw new Error("Missing native forward response");
      await compensate(response.compensateInput, context); throw new Error("Roll back native Line Item round trip");
    }));
    const forwardRoot = createWorkflow("probe-reservation-line-item-forward", (ids: WorkflowData<typeof ReservationLineItemIds.Type>) => new WorkflowResponse(invoke(ids)));
    const undoRoot = createWorkflow("probe-reservation-line-item-inverse", (ids: WorkflowData<typeof ReservationLineItemIds.Type>) => new WorkflowResponse(undo(ids)));
    const absentRoot = createWorkflow("probe-reservation-line-item-absent-inverse", (input: WorkflowData<null>) => new WorkflowResponse(undoAbsent(input)));
    const restoreRoot = createWorkflow("probe-reservation-line-item-direct-restore", (ids: WorkflowData<typeof ReservationLineItemIds.Type>) => new WorkflowResponse(directRestore(ids)));
    const rollbackRoot = createWorkflow("probe-reservation-line-item-roundtrip-rollback", (ids: WorkflowData<typeof ReservationLineItemIds.Type>) => new WorkflowResponse(rollback(ids)));
    const probeOptions = { execution, modules: { inventory }, revision: options.revision, subscribers, operationScheduling: "queued" as const,
      executionIsolation: "scopeExclusive" as const };
    const creation = await Effect.runPromise(prepareAtomicWorkflowHost({ ...probeOptions, workflow: { name: "probeReservationLineItemForward", resources,
      prepared: Result.getOrThrow(forwardRoot.prepare()), input: ReservationLineItemIds, output: ProbeResponse, events: internalModuleWorkflowEvents } }));
    const inverse = await Effect.runPromise(prepareAtomicWorkflowHost({ ...probeOptions, workflow: { name: "probeReservationLineItemInverse", resources,
      prepared: Result.getOrThrow(undoRoot.prepare()), input: ReservationLineItemIds, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    const absent = await Effect.runPromise(prepareAtomicWorkflowHost({ ...probeOptions, workflow: { name: "probeReservationLineItemAbsentInverse", resources,
      prepared: Result.getOrThrow(absentRoot.prepare()), input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    const restore = await Effect.runPromise(prepareAtomicWorkflowHost({ ...probeOptions, workflow: { name: "probeReservationLineItemDirectRestore", resources,
      prepared: Result.getOrThrow(restoreRoot.prepare()), input: ReservationLineItemIds, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    const roundtrip = await Effect.runPromise(prepareAtomicWorkflowHost({ ...probeOptions, workflow: { name: "probeReservationLineItemRollback", resources,
      prepared: Result.getOrThrow(rollbackRoot.prepare()), input: ReservationLineItemIds, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    for (const host of [creation, inverse, absent, restore, roundtrip]) close(() => Effect.runPromise(host.close));
    return { forward: creation, inverse, absent, restore, roundtrip };
  };
  const prepareLevelRemoval = async (physical = false) => {
    const removal = await Effect.runPromise(makeLocalInventoryCommands("level-batches"));
    const selected = Result.getOrThrow(prepareWorkflowResources({ inventory: { module: removal.workflow,
      methods: ["deleteInventoryLevels", "softDeleteInventoryLevels"], graph: false } }, true));
    const invoke = createStep("probe-reservation-line-item-level-removal", selected.callback(async (ids: typeof InventoryLevelDeletionIds.Type, context) => {
      const service = context.container.resolve<Pick<InventoryModuleService, "softDeleteInventoryLevels" | "deleteInventoryLevels">>("inventory");
      if (physical) await service.deleteInventoryLevels([...ids]); else await service.softDeleteInventoryLevels([...ids]); return null;
    }));
    const root = createWorkflow("probe-reservation-line-item-level-removal", (ids: WorkflowData<typeof InventoryLevelDeletionIds.Type>) => new WorkflowResponse(invoke(ids)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution,
      modules: { inventory: { module: removal.workflow, logicalStorage: inventory.logicalStorage } }, revision: options.revision, subscribers,
      workflow: { name: "probeReservationLineItemLevelRemoval", resources: selected, prepared: Result.getOrThrow(root.prepare()),
        input: InventoryLevelDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const preserved = async () => { const { reservations: _reservations, ...families } = await common.preserved(); return families; };
  return { ...common, lineItems, options, prepare, prepareProbes, prepareLevelRemoval, seed, seedProtected: (prefix: string) => common.seed(prefix, 1, true),
    updateReservation: update, release, probeReservations, preserved };
}
