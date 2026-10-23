import { InventoryItemRows } from "./item-contracts";
import { commerceDecoder } from "../../value/decoder";
import { correlateScalarCreateReceipt } from "../../repository/scalar-create-receipt";
import { decodeInventoryItemCreates } from "./create-item-input";
import { jsonEqual } from "flarex-protocol/json";
import { matchesPublicRow, projectNativeRow } from "../../repository/result";
import { Effect, Schema } from "effect";
import { Modules, CommonEvents, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";

const decodeItems = commerceDecoder(InventoryItemRows, "receiptMismatch");

/** The trusted module profile selects item-only or nonempty level creation. */
export function inventoryCreateEventPolicy(levels = false) {
  const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const decode = moduleEventDecoder(Schema.Struct({ name: Schema.String,
    metadata: Schema.Struct({ source: Schema.Literal(Modules.INVENTORY), object: Schema.Literals(levels ? ["inventory_item", "inventory_level"] : ["inventory_item"]), action: Schema.Literal(CommonEvents.CREATED) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, levels ? 8 : 4))]) }),
  }), defaultCommerceResources);
  const capture = Effect.fn("InventoryEvents.capture")(function* (input: unknown) {
    const message = yield* decode(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: message.metadata.object, action: CommonEvents.CREATED }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateCreationCall = Effect.fn("InventoryEvents.validateCall")(function* (
    call: Parameters<LogicalCallReceiptValidation>[0], activity: Parameters<LogicalCallReceiptValidation>[1],
  ) {
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    if (call.mode === "read") {
      if (activity.mutations.length || call.events.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      return;
    }
    if (call.commandName === "inventoryCreateLevels" && !levels) {
      if (!Array.isArray(call.input) || !Array.isArray(call.result)) return yield* Effect.fail(commerceError("receiptMismatch"));
      if (call.input.length || call.result.length || activity.mutations.length || call.events.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      return;
    }
    if (Array.isArray(call.input) !== Array.isArray(call.result)) return yield* Effect.fail(commerceError("receiptMismatch"));
    const inputs = Array.isArray(call.input) ? call.input : [call.input];
    const results = Array.isArray(call.result) ? call.result : [call.result];
    const table = call.commandName === "inventoryCreate" ? "inventory_item"
      : levels && call.commandName === "inventoryCreateLevels" ? "inventory_level" : undefined;
    if (table === undefined || inputs.length > (table === "inventory_level" ? 8 : 4) || results.length !== inputs.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const itemCohort = table === "inventory_item" ? yield* Effect.fromResult(correlateScalarCreateReceipt(
      yield* Effect.fromResult(decodeInventoryItemCreates(inputs)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause))),
      yield* Effect.fromResult(decodeItems(results)),
    )) : undefined;
    const canonicalResults = itemCohort?.results ?? results;
    if (activity.mutations.length !== canonicalResults.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    const expected = new Set<string>();
    for (const [index, mutation] of activity.mutations.entries()) {
      const id = mutation.after?.id;
      if (mutation.ordinal !== index || mutation.table !== table || mutation.operation !== "insert" ||
        mutation.before !== null || typeof id !== "string" || mutation.after?.deleted_at !== null || expected.has(id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      expected.add(id);
    }
    if (table === "inventory_item") {
      const decoded = itemCohort?.results;
      for (const [index, mutation] of activity.mutations.entries()) {
        const returned: JsonObject | undefined = decoded?.[index];
        const input = itemCohort?.inputs[index];
        if (mutation.after === null || returned === undefined || input === undefined || !matchesPublicRow(projectNativeRow(mutation.after), returned))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        for (const [field, value] of Object.entries(input))
          if (returned[field] === undefined || !jsonEqual(returned[field], value)) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    const returned = new Set<string>();
    for (const row of canonicalResults) {
      if (!isJsonObject(row) || typeof row.id !== "string" || !expected.has(row.id) || returned.has(row.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      returned.add(row.id);
    }
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.object !== table) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!expected.delete(id)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (expected.size) return yield* Effect.fail(commerceError("receiptMismatch"));
    return itemCohort;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = (call, activity) => validateCreationCall(call, activity).pipe(Effect.asVoid);
  return { capture, validateLogicalCall, validateCreationCall };
}
