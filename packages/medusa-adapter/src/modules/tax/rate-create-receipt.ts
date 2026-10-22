import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { correlatePhysicalGraphReceipt } from "../../repository/physical-graph-receipt";
import { projectNativeRow } from "../../repository/result";
import { moduleEventDecoder } from "../../module/events";
import { TaxId } from "./query";
import { decodeTaxRateCreates, decodeTaxRatePhysicalDeletionIds, type compileTaxRateCreationContracts } from "./rate-create-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileTaxRateCreationContracts>>;
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.TAX), object: Schema.Literals(["tax_rate", "tax_rate_rule"]),
    action: Schema.Literals(["created", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([TaxId, Schema.Array(TaxId).check(Schema.isLengthBetween(1, 8))]) }),
}), defaultCommerceResources);

/** Authenticate the native two scalar creates against complete canonical SQL
 * writes. Original REAL presentation comes only from shared conversion evidence;
 * the retained inverse reuses the complete physical cascade receipt owner. */
export function taxRateCreationPolicy(contracts: Contracts) {
  const capture = Effect.fn("TaxRate.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.TAX, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("TaxRate.validateCreationCall")(function* (call, activity) {
    const creating = call.commandName === "taxRateCreateForWorkflow";
    if ((!creating && call.commandName !== "taxRatePhysicalDeleteForWorkflow") || call.mode !== "write" ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const expectedEvents: Array<{ readonly object: "tax_rate" | "tax_rate_rule"; readonly id: string }> = [];
    if (creating) {
      const inputs = yield* Effect.fromResult(decodeTaxRateCreates(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const results = yield* Effect.fromResult(contracts.decodeOutput(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const ruleCount = inputs.reduce((count, input) => count + (input.rules?.length ?? 0), 0);
      if (results.length !== inputs.length || activity.mutations.length !== inputs.length + ruleCount || activity.relationalReads.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const inserted = new Map<string, JsonObject>();
      const check = Effect.fn("TaxRate.authenticateInsert")(function* (
        ordinal: number, table: string, expected: JsonObject, object: "tax_rate" | "tax_rate_rule", result?: JsonObject,
      ) {
        const mutation = activity.mutations[ordinal], row = mutation?.after;
        if (mutation === undefined || row === undefined || row === null || mutation.ordinal !== ordinal ||
          mutation.operation !== "insert" || mutation.table !== table || mutation.before !== null)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const decode = table === contracts.rate.name ? contracts.decodeRateRow : contracts.decodeRuleRow;
        const stored = yield* Effect.fromResult(decode(projectNativeRow(row))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const identity = table + ":" + stored.id;
        if (inserted.has(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
        const presented: JsonObject = { ...stored, ...mutation.realNormalization };
        for (const [field, value] of Object.entries(expected)) if (presented[field] === undefined || !jsonEqual(presented[field], value))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        if (mutation.realNormalization !== undefined && (table !== contracts.rate.name ||
          Object.keys(mutation.realNormalization).some(field => field !== "rate"))) return yield* Effect.fail(commerceError("receiptMismatch"));
        if (result !== undefined && !jsonEqual(presented, result)) return yield* Effect.fail(commerceError("receiptMismatch"));
        inserted.set(identity, row); expectedEvents.push({ object, id: stored.id });
        return stored;
      });
      for (const [ordinal, input] of inputs.entries()) {
        const result = results[ordinal];
        if (result === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
        const { rules: inputRules, ...scalar } = input, { rules: outputRules, ...output } = result;
        if (outputRules.length || inputRules !== undefined && inputRules.length > 2) return yield* Effect.fail(commerceError("receiptMismatch"));
        yield* check(ordinal, contracts.rate.name, { ...contracts.rateDefaults, deleted_at: null, ...scalar }, "tax_rate", output);
      }
      let ordinal = inputs.length;
      for (const [index, input] of inputs.entries()) {
        const parent = results[index];
        if (parent === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
        for (const rule of input.rules ?? []) yield* check(ordinal++, contracts.rule.name,
          { ...contracts.ruleDefaults, deleted_at: null, ...rule, tax_rate_id: parent.id, created_by: parent.created_by }, "tax_rate_rule");
      }
      const seen = new Set<string>();
      for (const observation of activity.observedRows) {
        const identity = observation.table + ":" + observation.row.id, row = inserted.get(identity);
        if (row === undefined || !jsonEqual(projectNativeRow(observation.row), projectNativeRow(row)))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        seen.add(identity);
      }
      if (seen.size !== inserted.size) return yield* Effect.fail(commerceError("receiptMismatch"));
    } else {
      if (call.result !== null) return yield* Effect.fail(commerceError("receiptMismatch"));
      const requestedIds = yield* Effect.fromResult(decodeTaxRatePhysicalDeletionIds(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const ids = yield* Effect.fromResult(correlatePhysicalGraphReceipt({ tables: contracts.tables, entities: contracts.entities,
        root: contracts.rate, rootOrder: "storageInsertion", requestedIds, activity }));
      expectedEvents.push(...ids.map(id => ({ object: "tax_rate" as const, id })));
    }
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.action !== (creating ? "created" : "deleted")) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        const expected = expectedEvents[emitted++];
        if (expected?.id !== id || expected?.object !== message.metadata.object) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    if (emitted !== expectedEvents.length) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall, allowStorageInsertionOrder: true as const };
}
