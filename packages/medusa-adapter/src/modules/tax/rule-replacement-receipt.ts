import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { captureCommerceInput } from "../../value/input";
import { taxRuleCreationPolicy } from "./rule-create-receipt";
import { taxRuleDeletionPolicy } from "./rule-delete-receipt";
import { decodeTaxRuleReplacementRead, decodeTaxRuleReplacementIds } from "./rule-replacement-input";
import type { prepareTaxRuleReplacementRepository } from "./rule-replacement-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareTaxRuleReplacementRepository>>;

/** Complete projected-ID reads and both existing inverse policies authenticate
 * the one Rule participant without granting Tax parent mutation capabilities. */
export function taxRuleReplacementPolicy(prepared: Prepared) {
  const creation = taxRuleCreationPolicy(prepared.creation.contracts), deletion = taxRuleDeletionPolicy(prepared.deletion.contracts);
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("TaxRuleReplacement.validateCall")(function* (call, activity) {
    if (call.commandName === "taxRuleCreateForWorkflow" || call.commandName === "taxRulePhysicalDeleteForWorkflow")
      return yield* creation.validateLogicalCall(call, activity);
    if (call.commandName === "taxRuleSoftDeleteForWorkflow" || call.commandName === "taxRuleRestoreForWorkflow")
      return yield* deletion.validateLogicalCall(call, activity);
    if (call.commandName !== "taxRuleListForReplacement" || call.mode !== "read" || call.events.length || activity.mutations.length ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const input = yield* Effect.fromResult(decodeTaxRuleReplacementRead(call.input));
    // The generated internal service adds the model's ascending primary-key
    // order before buildQuery; the original workflow supplies only select.
    const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, { select: [...input.config.select], order: { id: "ASC" } }))
      .pipe(Result.flatMap(prepared.query)));
    const rows = new Map<string, JsonObject & { readonly id: string }>(), rateIds = new Set(input.filters.tax_rate_id);
    for (const observation of activity.observedRows) {
      if (observation.table !== prepared.contracts.rule.name) return yield* Effect.fail(commerceError("receiptMismatch"));
      const row = yield* Effect.fromResult(prepared.contracts.decodeRuleRow(projectNativeRow(observation.row))), prior = rows.get(row.id);
      if (prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(commerceError("receiptMismatch"));
      rows.set(row.id, row);
    }
    // Shared read support observes complete bodies before residual selection.
    // Decode and correlate every raw body above, then admit only the complete
    // active cohort for the selected Rates, as in the Tax calculation owner.
    const selected = orderNativeIdRows([...rows.values()].filter(row => row.deleted_at === null &&
      typeof row.tax_rate_id === "string" && rateIds.has(row.tax_rate_id)), {});
    const expected = selected.map(row => ({ id: row.id }));
    const actual = yield* Effect.fromResult(decodeTaxRuleReplacementIds(call.result));
    const reads = [{ table: prepared.contracts.rule.name,
      query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: expected.length, returned: expected.length }];
    if (selected.length > 8 || !jsonEqual(actual, expected) || !jsonEqual(activity.relationalReads, reads))
      return yield* Effect.fail(commerceError("receiptMismatch"));
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture: creation.capture, validateLogicalCall, allowStorageInsertionOrder: true as const };
}
