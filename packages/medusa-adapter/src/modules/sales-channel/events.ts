import { Modules } from "@medusajs/framework/utils/portable";
import { scalarLogicalEventPolicy } from "../../repository/scalar-events";
import { Effect, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { correlateScalarCreateReceipt } from "../../repository/scalar-create-receipt";
import { matchesPublicRow } from "../../repository/result";
import { jsonEqual } from "flarex-protocol/json";
import { SalesChannelCreateInput, SalesChannelCreatedRow } from "./create-input";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";

const commands = { insert: "salesChannelCreate", update: "salesChannelUpdate", delete: "salesChannelDelete" };
const decodeInputs = commerceDecoder(Schema.Array(SalesChannelCreateInput).check(Schema.isMaxLength(256)), "receiptMismatch");
const decodeResults = commerceDecoder(Schema.Array(SalesChannelCreatedRow).check(Schema.isMaxLength(256)), "receiptMismatch");

export function salesChannelLogicalEventPolicy() {
  const base = scalarLogicalEventPolicy(Modules.SALES_CHANNEL, "sales_channel", commands);
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("SalesChannelEvents.validateCall")(function* (call, activity) {
    yield* base.validateLogicalCall(call, activity);
    if (call.mode !== "write" || call.commandName !== commands.insert) return;
    if (Array.isArray(call.input) !== Array.isArray(call.result)) return yield* Effect.fail(commerceError("receiptMismatch"));
    const inputs = yield* Effect.fromResult(decodeInputs(Array.isArray(call.input) ? call.input : [call.input]));
    const results = yield* Effect.fromResult(decodeResults(Array.isArray(call.result) ? call.result : [call.result]));
    const cohort = yield* Effect.fromResult(correlateScalarCreateReceipt(inputs, results));
    if (activity.mutations.length !== cohort.results.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    for (const [index, result] of cohort.results.entries()) {
      const mutation = activity.mutations[index], input = cohort.inputs[index];
      if (mutation?.after === null || mutation?.after === undefined || input === undefined || !matchesPublicRow(mutation.after, result))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const [field, value] of Object.entries(input))
        if (result[field] === undefined || !jsonEqual(result[field], value)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
  });
  return { ...base, validateLogicalCall };
}
