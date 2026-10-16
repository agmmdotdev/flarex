import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";
import { projectNativeRow } from "../../repository/result";
import { captureExactNumericRow } from "../../value/exact-numeric";
import { commerceDecoder } from "../../value/decoder";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { compileInventoryLevelContracts } from "./level-contracts";
import { InventoryLevelsInput } from "./level-input";
import { inventoryCreateEventPolicy } from "./events";
import { inventoryLevelUpdateEventPolicy } from "./update-level-events";
import { inventoryLevelDeletionEventPolicy } from "./delete-level-events";
import { decodeInventoryLevelPhysicalDeletionIds } from "./level-lifecycle";

type Contracts = Result.Result.Success<ReturnType<typeof compileInventoryLevelContracts>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeCreate = commerceDecoder(InventoryLevelsInput, "receiptMismatch");
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.INVENTORY), object: Schema.Literal("inventory_level"),
    action: Schema.Literals(["created", "updated", "deleted", "restored"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 8))]) }),
}), defaultCommerceResources);

/** One Level participant composes the established command-specific receipts.
 * The retained physical inverse authenticates removals rather than accepting a
 * void result as evidence, and never grants Item or quantity mutation. */
export function inventoryLevelBatchEventPolicy(contracts: Contracts) {
  const creation = inventoryCreateEventPolicy(true), update = inventoryLevelUpdateEventPolicy(contracts),
    managed = inventoryLevelDeletionEventPolicy(contracts);
  const capture = Effect.fn("InventoryLevelBatch.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_level", action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("InventoryLevelBatch.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    switch (call.commandName) {
      case "inventoryLevelListForUpdate":
      case "inventoryLevelUpdateForWorkflow":
        return yield* update.validateLogicalCall(call, activity);
      case "inventoryLevelCountForDeletion":
      case "inventoryLevelSoftDeleteForWorkflow":
      case "inventoryLevelRestoreForWorkflow":
        return yield* managed.validateLogicalCall(call, activity);
      case "inventoryCreateLevels": {
        yield* creation.validateLogicalCall(call, activity);
        const inputs = yield* Effect.fromResult(decodeCreate(call.input));
        const results = yield* Effect.fromResult(contracts.decodeCreatedRows(call.result))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        for (const [index, mutation] of activity.mutations.entries()) {
          const input = inputs[index], result = results[index];
          if (input === undefined || result === undefined || mutation.after === null) return yield* Effect.fail(mismatch());
          const stored = projectNativeRow(mutation.after);
          yield* contracts.decodeStoredRow(stored).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          const expected = yield* captureExactNumericRow(input, contracts.numeric, true)
            .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          if (stored.metadata !== null) return yield* Effect.fail(mismatch());
          for (const [field, value] of Object.entries(expected)) if (stored[field] === undefined || !jsonEqual(stored[field], value))
            return yield* Effect.fail(mismatch());
          if (!(yield* contracts.matchesResult(stored, result).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)))))
            return yield* Effect.fail(mismatch());
        }
        return;
      }
      case "inventoryLevelPhysicalDeleteForWorkflow": {
        if (call.mode !== "write" || call.result !== null || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
          return yield* Effect.fail(mismatch());
        const ids = yield* Effect.fromResult(decodeInventoryLevelPhysicalDeletionIds(call.input))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const requested = new Set(ids), observed = new Map<string, JsonObject>();
        const record = Effect.fn("InventoryLevelBatch.observePhysicalDelete")(function* (table: string, input: JsonObject) {
          if (table !== "inventory_level") return yield* Effect.fail(mismatch());
          const row = yield* contracts.decodeStoredRow(projectNativeRow(input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          if (!requested.has(row.id)) return yield* Effect.fail(mismatch());
          observed.set(row.id, row);
        });
        for (const entry of activity.observedRows) yield* record(entry.table, entry.row);
        for (const mutation of activity.mutations) {
          if (mutation.before === null) return yield* Effect.fail(mismatch());
          yield* record(mutation.table, mutation.before);
        }
        const pending = new Set(observed.keys()), ordered: string[] = [];
        for (const [ordinal, mutation] of activity.mutations.entries()) {
          const id = mutation.before?.id;
          if (mutation.ordinal !== ordinal || mutation.table !== "inventory_level" || mutation.operation !== "delete" ||
            mutation.after !== null || typeof id !== "string" || !pending.delete(id)) return yield* Effect.fail(mismatch());
          ordered.push(id);
        }
        if (pending.size !== 0 || ordered.length > 8) return yield* Effect.fail(mismatch());
        let emitted = 0;
        for (const event of call.events) {
          const message = yield* capture(event);
          if (message.metadata.action !== "deleted") return yield* Effect.fail(mismatch());
          for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
            if (id !== ordered[emitted++]) return yield* Effect.fail(mismatch());
        }
        if (emitted !== ordered.length) return yield* Effect.fail(mismatch());
        return;
      }
      default:
        return yield* Effect.fail(mismatch());
    }
  });
  return { capture, validateLogicalCall };
}
