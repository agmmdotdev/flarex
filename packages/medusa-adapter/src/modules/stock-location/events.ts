import { Effect, Result, Schema } from "effect";
import { Modules, CommonEvents, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { moduleEventDecoder } from "../../module/events";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { ScalarId } from "../../repository/scalar-id-read";
import { correlateScalarCreateReceipt } from "../../repository/scalar-create-receipt";
import { projectNativeRow } from "../../repository/result";
import { compileCompleteRow } from "../../value/complete-row";
import { commerceDecoder } from "../../value/decoder";
import type { SchemaTable } from "../../schema/model";
import { StockLocationsInput } from "./input";
import { planStockLocationCreates } from "./create-planning";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";

export function stockLocationCreateEventPolicy(table: SchemaTable, addressTable: SchemaTable,
  validateRead: LogicalCallReceiptValidation) {
  return Result.gen(function* () {
    if (table.name !== "stock_location" || addressTable.name !== "stock_location_address")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const decodeLocation = yield* compileCompleteRow(table), decodeAddress = yield* compileCompleteRow(addressTable);
    const decodeInputs = commerceDecoder(StockLocationsInput, "receiptMismatch");
    const decodeResults = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "receiptMismatch");
    const decodeId = commerceDecoder(ScalarId, "receiptMismatch");
    const decode = moduleEventDecoder(Schema.Struct({ name: Schema.String,
      metadata: Schema.Struct({ source: Schema.Literal(Modules.STOCK_LOCATION),
        object: Schema.Literals(["stock_location", "stock_location_address"]), action: Schema.Literal(CommonEvents.CREATED) }),
      data: Schema.Struct({ id: Schema.Union([ScalarId, Schema.Array(ScalarId).check(Schema.isLengthBetween(1, 4))]) }),
    }), defaultCommerceResources);
    const capture = Effect.fn("StockLocationEvents.capture")(function* (input: unknown) {
      const message = yield* decode(input);
      if (message.name !== buildModuleResourceEventName({ prefix: Modules.STOCK_LOCATION,
        objectName: message.metadata.object, action: CommonEvents.CREATED })) return yield* Effect.fail(commerceError("unadmittedEvent"));
      return message;
    });
    const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("StockLocationEvents.validateCall")(function* (call, activity) {
      if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (call.mode === "read") return yield* validateRead(call, activity);
      if (call.commandName !== "stockLocationCreate" || Array.isArray(call.input) !== Array.isArray(call.result))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const inputs = yield* Effect.fromResult(decodeInputs(Array.isArray(call.input) ? call.input : [call.input]));
      const results = yield* Effect.fromResult(decodeResults(Array.isArray(call.result) ? call.result : [call.result]));
      if (inputs.some(row => row.address !== undefined && row.address_id !== undefined) || activity.relationalReads.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const keyed: Array<JsonObject & { id: string }> = [];
      for (const result of results) keyed.push({ ...result, id: yield* Effect.fromResult(decodeId(result.id)) });
      const cohort = yield* Effect.fromResult(correlateScalarCreateReceipt(inputs, keyed));
      const plan = planStockLocationCreates(inputs, keyed.map(row => row.id));
      const nestedInputs: JsonObject[] = [], nestedResults: Array<JsonObject & { id: string }> = [];
      for (const [index, selected] of plan.addresses.entries()) {
        const result = cohort.results[index];
        if (result === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
        const { address, ...scalar } = result;
        yield* Effect.fromResult(decodeLocation(scalar)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (selected.kind === "nested") {
          const row = yield* Effect.fromResult(decodeAddress(address)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          nestedInputs.push(selected.input);
          nestedResults.push({ ...row, id: yield* Effect.fromResult(decodeId(row.id)) });
        } else if (selected.kind === "reference" ? address === undefined || !jsonEqual(address, { id: selected.id }) : address !== undefined)
          return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      const addresses = yield* Effect.fromResult(correlateScalarCreateReceipt(nestedInputs, nestedResults));
      if (activity.mutations.length !== plan.entities.length + addresses.inputs.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const expected: string[] = [], inserted = new Map<string, JsonObject>();
      const authenticateWrite = Effect.fn("StockLocationEvents.authenticateWrite")(function* (
        ordinal: number, source: JsonObject, result: JsonObject, target: SchemaTable,
        decode: typeof decodeLocation,
      ) {
        const mutation = activity.mutations[ordinal];
        if (mutation === undefined || mutation.ordinal !== ordinal || mutation.table !== target.name ||
          mutation.operation !== "insert" || mutation.before !== null || mutation.after === null || mutation.after === undefined ||
          mutation.realNormalization !== undefined)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const row = yield* Effect.fromResult(decode(projectNativeRow(mutation.after)))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (typeof row.id !== "string" || row.deleted_at !== null || !jsonEqual(row, result))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        for (const column of target.columns) {
          if (["created_at", "updated_at"].includes(column.name)) continue;
          const value = source[column.name] ?? (source[column.name] === null ? null :
            column.defaultValue === undefined ? column.nullable ? null : undefined : column.defaultValue);
          const actual = row[column.name];
          if (value !== undefined && (actual === undefined || !jsonEqual(actual, value))) return yield* Effect.fail(commerceError("receiptMismatch"));
        }
        const key = target.name + ":" + row.id;
        if (inserted.has(key)) return yield* Effect.fail(commerceError("receiptMismatch"));
        inserted.set(key, row); expected.push(key);
      });
      for (const [index, source] of addresses.inputs.entries())
        yield* authenticateWrite(index, source, addresses.results[index]!, addressTable, decodeAddress);
      let childOrdinal = 0;
      for (const [index, source] of plan.entities.entries()) {
        const result = cohort.results[index]!, selected = plan.addresses[index]!;
        const { address: _address, ...scalar } = result;
        const nested = selected.kind === "nested" ? nestedResults[childOrdinal++] : undefined;
        const storageInput = nested === undefined ? source : { ...source, address_id: nested.id };
        const storedResult = nested === undefined ? scalar : { ...scalar, address_id: nested.id };
        yield* authenticateWrite(addresses.inputs.length + index, storageInput, storedResult, table, decodeLocation);
        const expectedAddressId = typeof source.address_id === "string" ? source.address_id : nested?.id ?? source.address_id ?? null;
        if (result.address_id !== expectedAddressId) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      const observed = new Set<string>();
      for (const observation of activity.observedRows) {
        const key = observation.table + ":" + observation.row.id, row = inserted.get(key);
        if (row !== undefined && !jsonEqual(row, projectNativeRow(observation.row)))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        if (row === undefined && (observation.table !== addressTable.name ||
          !plan.addresses.some(selected => selected.kind === "reference" && selected.id === observation.row.id)))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        if (row !== undefined) observed.add(key);
      }
      if (observed.size !== inserted.size) return yield* Effect.fail(commerceError("receiptMismatch"));
      let emitted = 0;
      for (const event of call.events) {
        const message = yield* capture(event);
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
          if (expected[emitted++] !== message.metadata.object + ":" + id) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (emitted !== expected.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    });
    return { capture, validateLogicalCall };
  });
}
