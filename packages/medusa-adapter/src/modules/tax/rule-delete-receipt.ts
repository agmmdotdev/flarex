import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { scalarLifecycleReceipt } from "../../repository/scalar-lifecycle-receipt";
import { commerceRelationReadQuery } from "../../query/relations";
import { commerceDecoder } from "../../value/decoder";
import { moduleEventDecoder } from "../../module/events";
import { TaxId } from "./query";
import { decodeTaxRuleDeletionIds, decodeTaxRuleDeletionOutput, type compileTaxRuleDeletionContracts } from "./rule-delete-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileTaxRuleDeletionContracts>>;
const decodeSelectedIdentities = commerceDecoder(Schema.Array(Schema.Struct({ id: TaxId })).check(Schema.isMaxLength(8)), "receiptMismatch");
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.TAX), object: Schema.Literal("tax_rate_rule"), action: Schema.Literal("deleted") }),
  data: Schema.Struct({ id: Schema.Union([TaxId, Schema.Array(TaxId).check(Schema.isLengthBetween(1, 8))]) }),
}), defaultCommerceResources);

/** Shared scalar correlation proves transitions and no-ops. This Tax profile
 * additionally binds complete historical membership and its selected order. */
export function taxRuleDeletionPolicy(contracts: Contracts) {
  const capture = Effect.fn("TaxRuleDeletion.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.TAX, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLifecycle = scalarLifecycleReceipt({ table: contracts.rule.name,
    softDeleteCommand: "taxRuleSoftDeleteForWorkflow", restoreCommand: "taxRuleRestoreForWorkflow", maximumRoots: 8,
    decodeIds: decodeTaxRuleDeletionIds, decodeRow: contracts.decodeRuleRow,
    decodeResult: input => decodeTaxRuleDeletionOutput(input).pipe(Result.map(result => ({
      empty: Object.keys(result).length === 0, ids: result.tax_rate_rule_id ?? [],
    }))) });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("TaxRuleDeletion.validateCall")(function* (call, activity) {
    const { operation, ids: transitioned, requestedIds: ids, rows: historical } = yield* validateLifecycle(call, activity);
    const identities = ids.length === 0 ? [] : yield* Effect.fromResult(decodeSelectedIdentities(activity.relationalReads[0]?.orderedIdentities));
    const pending = new Set(historical.keys()), ordered: string[] = [], parents = new Set<string>();
    for (const identity of identities) {
      const row = historical.get(identity.id);
      if (row === undefined || !pending.delete(identity.id) || typeof row.tax_rate_id !== "string")
        return yield* Effect.fail(commerceError("receiptMismatch"));
      parents.add(row.tax_rate_id);
      if (operation === "restore" || row.deleted_at === null) ordered.push(identity.id);
    }
    const reads = ids.length === 0 ? [] : [{ table: contracts.rule.name,
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: ids },
        { kind: "storageInsertion", direction: "asc" }, { includeIdentities: true }),
      total: identities.length, returned: identities.length, orderedIdentities: identities }];
    if (pending.size || parents.size > 4 || !jsonEqual(activity.relationalReads, reads) || !jsonEqual(transitioned, ordered))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    if (operation === "restore") {
      if (call.events.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      return;
    }
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (ordered[emitted++] !== id) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (emitted !== ordered.length) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall, allowStorageInsertionOrder: true as const };
}
