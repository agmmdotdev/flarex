import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";
import { projectNativeRow } from "../../repository/result";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import type { compileInventoryItemContracts } from "./item-contracts";
import type { compileInventoryLevelContracts } from "./level-contracts";
import type { compileInventoryDeletionContracts } from "./deletion-contracts";
import { inventoryCreateEventPolicy } from "./events";
import { inventoryLevelCreationEventPolicy } from "./level-creation-events";
import { validateInventoryItemLifecycleClosure } from "./deletion-lifecycle";
import { decodeInventoryItemPhysicalDeletionIds } from "./create-item-input";

type ItemContracts = Result.Result.Success<ReturnType<typeof compileInventoryItemContracts>>;
type LevelContracts = Result.Result.Success<ReturnType<typeof compileInventoryLevelContracts>>;
type LifecycleContracts = Result.Result.Success<ReturnType<typeof compileInventoryDeletionContracts>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.INVENTORY), object: Schema.Literals(["inventory_item", "inventory_level"]),
    action: Schema.Literals(["created", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 8))]) }),
}), defaultCommerceResources);

/** This profile adds only Item creation/default authentication and its retained
 * physical cascade. The existing Level owner authenticates its own callbacks. */
export function inventoryItemCreationEventPolicy(item: ItemContracts, level: LevelContracts, lifecycle: LifecycleContracts) {
  const creation = inventoryCreateEventPolicy(), levels = inventoryLevelCreationEventPolicy(level);
  const capture = Effect.fn("InventoryItemCreation.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("InventoryItemCreation.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (call.commandName === "inventoryCreateLevels" || call.commandName === "inventoryLevelPhysicalDeleteForWorkflow")
      return yield* levels.validateLogicalCall(call, activity);
    if (call.commandName === "inventoryCreate") {
      const cohort = yield* creation.validateCreationCall(call, activity);
      if (cohort === undefined) return yield* Effect.fail(mismatch());
      for (const [index, mutation] of activity.mutations.entries()) {
        const input = cohort.inputs[index];
        if (input === undefined || mutation.after === null) return yield* Effect.fail(mismatch());
        const row: JsonObject = yield* Effect.fromResult(item.decodeRow(projectNativeRow(mutation.after))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const expected: JsonObject = { ...item.creationDefaults, ...input };
        for (const [field, value] of Object.entries(expected)) if (row[field] === undefined || !jsonEqual(row[field], value))
          return yield* Effect.fail(mismatch());
      }
      return;
    }
    if (call.commandName !== "inventoryItemPhysicalDeleteForWorkflow" || call.mode !== "write" || call.result !== null ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(mismatch());
    const requested = new Set(yield* Effect.fromResult(decodeInventoryItemPhysicalDeletionIds(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause))));
    const observed = new Map<string, Map<string, JsonObject>>();
    const record = Effect.fn("InventoryItemCreation.observePhysicalDelete")(function* (table: string, value: JsonObject) {
      const row = yield* lifecycle.decodeRow(table, value).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (typeof row.id !== "string") return yield* Effect.fail(mismatch());
      const rows = observed.get(table) ?? new Map<string, JsonObject>(); rows.set(row.id, row); observed.set(table, rows);
    });
    for (const entry of activity.observedRows) yield* record(entry.table, entry.row);
    for (const mutation of activity.mutations) {
      if (mutation.before === null) return yield* Effect.fail(mismatch());
      yield* record(mutation.table, mutation.before);
    }
    const roots = [...observed.get("inventory_item")?.values() ?? []], rootIds = new Set(roots.map(row => row.id));
    if (roots.length > 4 || roots.some(row => typeof row.id !== "string" || !requested.has(row.id))) return yield* Effect.fail(mismatch());
    const children = ["inventory_level", "reservation_item"].map(table => [...observed.get(table)?.values() ?? []]);
    const [levelRows = [], reservations = []] = children;
    yield* validateInventoryItemLifecycleClosure(roots, levelRows, reservations).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const pending = new Set([...observed].flatMap(([table, rows]) => [...rows.keys()].map(id => JSON.stringify([table, id]))));
    const rootEvents: string[] = [];
    for (const [ordinal, mutation] of activity.mutations.entries()) {
      const row = mutation.before, id = row?.id;
      if (mutation.ordinal !== ordinal || mutation.operation !== "delete" || mutation.after !== null || row === null ||
        typeof id !== "string" || !pending.delete(JSON.stringify([mutation.table, id]))) return yield* Effect.fail(mismatch());
      if (mutation.table === "inventory_item") {
        if (!rootIds.has(id) || levelRows.some(child => child.inventory_item_id === id && pending.has(JSON.stringify(["inventory_level", child.id]))) ||
          reservations.some(child => child.inventory_item_id === id && pending.has(JSON.stringify(["reservation_item", child.id]))))
          return yield* Effect.fail(mismatch());
        rootEvents.push(id);
      }
    }
    if (pending.size !== 0) return yield* Effect.fail(mismatch());
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.object !== "inventory_item" || message.metadata.action !== "deleted") return yield* Effect.fail(mismatch());
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (id !== rootEvents[emitted++]) return yield* Effect.fail(mismatch());
    }
    if (emitted !== rootEvents.length) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall };
}
