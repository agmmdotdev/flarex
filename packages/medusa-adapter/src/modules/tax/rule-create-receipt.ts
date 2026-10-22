import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { correlatePhysicalGraphReceipt } from "../../repository/physical-graph-receipt";
import { projectNativeRow } from "../../repository/result";
import { moduleEventDecoder } from "../../module/events";
import { TaxId } from "./query";
import { decodeTaxRuleCreates, decodeTaxRulePhysicalDeletionIds, type compileTaxRuleCreationContracts } from "./rule-create-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileTaxRuleCreationContracts>>;
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.TAX), object: Schema.Literal("tax_rate_rule"),
    action: Schema.Literals(["created", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([TaxId, Schema.Array(TaxId).check(Schema.isLengthBetween(1, 8))]) }),
}), defaultCommerceResources);

/** Complete Rule writes and observed rows authenticate native serialization.
 * The physical inverse reuses the shared graph receipt and ordering evidence. */
export function taxRuleCreationPolicy(contracts: Contracts) {
  const capture = Effect.fn("TaxRule.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.TAX, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("TaxRule.validateCreationCall")(function* (call, activity) {
    const creating = call.commandName === "taxRuleCreateForWorkflow";
    if ((!creating && call.commandName !== "taxRulePhysicalDeleteForWorkflow") || call.mode !== "write" ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const expectedIds: string[] = [];
    if (creating) {
      const inputs = yield* Effect.fromResult(decodeTaxRuleCreates(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const results = yield* Effect.fromResult(contracts.decodeOutput(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (results.length !== inputs.length || activity.mutations.length !== inputs.length || activity.relationalReads.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const inserted = new Map<string, JsonObject>();
      for (const [ordinal, input] of inputs.entries()) {
        const mutation = activity.mutations[ordinal], result = results[ordinal], row = mutation?.after;
        if (mutation === undefined || result === undefined || row === undefined || row === null || mutation.ordinal !== ordinal ||
          mutation.operation !== "insert" || mutation.table !== contracts.rule.name || mutation.before !== null || mutation.realNormalization !== undefined)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const stored = yield* Effect.fromResult(contracts.decodeRuleRow(projectNativeRow(row))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (inserted.has(stored.id) || !jsonEqual(stored, result)) return yield* Effect.fail(commerceError("receiptMismatch"));
        const expected = { ...contracts.ruleDefaults, deleted_at: null, ...input }, actual: JsonObject = stored;
        for (const [field, value] of Object.entries(expected)) if (actual[field] === undefined || !jsonEqual(actual[field], value))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        inserted.set(stored.id, row); expectedIds.push(stored.id);
      }
      const seen = new Set<string>();
      for (const observation of activity.observedRows) {
        const id = observation.row.id;
        if (typeof id !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
        const row = inserted.get(id);
        if (observation.table !== contracts.rule.name || row === undefined || !jsonEqual(projectNativeRow(observation.row), projectNativeRow(row)))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        seen.add(id);
      }
      if (seen.size !== inserted.size) return yield* Effect.fail(commerceError("receiptMismatch"));
    } else {
      if (call.result !== null) return yield* Effect.fail(commerceError("receiptMismatch"));
      const requestedIds = yield* Effect.fromResult(decodeTaxRulePhysicalDeletionIds(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      expectedIds.push(...yield* Effect.fromResult(correlatePhysicalGraphReceipt({ tables: contracts.tables, entities: contracts.entities,
        root: contracts.rule, rootOrder: "storageInsertion", requestedIds, activity })));
    }
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.action !== (creating ? "created" : "deleted")) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        if (expectedIds[emitted++] !== id) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    if (emitted !== expectedIds.length) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall, allowStorageInsertionOrder: true as const };
}
