import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import type { prepareScalarRepository } from "../../repository/scalar";
import { projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { captureCommerceInput } from "../../value/input";
import type { SchemaTable } from "../../schema/model";
import { type compileSalesChannelCartReadContracts, decodeSalesChannelCartRead } from "./cart-read-input";

/** The module wrapper authenticates command identity and its scoped source.
 * This point-read proof binds the complete result to the actual query and its
 * sole observed row; the checked single primary key proves selected identity.
 * No second read or general list-result reconstruction is required. */
export function salesChannelCartReadPolicy(table: SchemaTable,
  query: Result.Result.Success<ReturnType<typeof prepareScalarRepository>>["query"],
  contracts: Result.Result.Success<ReturnType<typeof compileSalesChannelCartReadContracts>>) {
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("SalesChannel.validateCartRead")(function* (call, activity) {
    if (call.commandName !== "salesChannelRetrieve" || call.mode !== "read" || call.events.length ||
      activity.mutations.length || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length ||
      activity.relationalReads.length !== 1 || activity.observedRows.length !== 1)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const input = yield* Effect.fromResult(decodeSalesChannelCartRead(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    // The genuine native internal retrieve passes buildQuery({ id }, {}) to
    // this same scalar planner. Catalog execution reads the complete cohort.
    const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery({ id: input.id }, {})).pipe(Result.flatMap(query)))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const expectedQuery = commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate, "id");
    if (!jsonEqual(activity.relationalReads[0] ?? null,
      { table: table.name, query: expectedQuery, total: 1, returned: 1 }))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const observation = activity.observedRows[0];
    if (observation === undefined || observation.table !== table.name)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const row = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(observation.row)))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const output = yield* Effect.fromResult(contracts.decodeRow(call.result))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    if (row.id !== input.id || row.deleted_at !== null || !jsonEqual(row, output))
      return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture: () => Effect.fail(commerceError("unadmittedEvent")), validateLogicalCall };
}
