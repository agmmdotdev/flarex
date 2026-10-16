import { Effect, Result } from "effect";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { ScalarIdRead } from "../../repository/scalar-id-read";
import type { prepareScalarRepository } from "../../repository/scalar";
import { projectNativeRow } from "../../repository/result";
import { projectRows } from "../../query/projection";
import { orderedCatalog } from "../../query/read";
import { compileCompleteRow } from "../../value/complete-row";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { decodeGraphCount } from "../../local-graph/query";
import type { SchemaTable } from "../../schema/model";

const decodeInput = commerceDecoder(ScalarIdRead, "receiptMismatch");
const encoder = new TextEncoder();

/** Authenticate the existing bounded scalar ID-read ABI. Call-local activity
 * contains complete matched rows before pagination, including the current
 * pending view of Locations created by an earlier command in the same root.
 * No second read, relation traversal or arbitrary query interpreter is needed. */
export function compileStockLocationReadReceipt(table: SchemaTable,
  query: Result.Result.Success<ReturnType<typeof prepareScalarRepository>>["query"]) {
  return Result.gen(function* () {
    if (table.name !== "stock_location")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const decodeRow = yield* compileCompleteRow(table);
    const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("StockLocation.validateRead")(function* (call, activity) {
      if (call.commandName !== "stockLocationCount" || call.mode !== "read" || call.events.length ||
        activity.mutations.length || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const input = yield* Effect.fromResult(decodeInput(call.input));
      // Reuse the pinned native ABI conversion and exact repository planner.
      // Native filters deduplicate before the eight-ID repository bound.
      const { select, relations, ...config } = input.config ?? {};
      const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, { ...config,
        ...(select === undefined ? {} : { select: select.slice() }),
        ...(relations === undefined ? {} : { relations: relations.slice() }),
      })).pipe(Result.flatMap(query)))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const [rows, count] = yield* Effect.fromResult(decodeGraphCount(call.result))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const ids = input.filters?.id;
      const requested = ids === undefined ? undefined : new Set(typeof ids === "string" ? [ids] : ids);
      const observed = new Map<string, JsonObject>();
      for (const observation of activity.observedRows) {
        const row = yield* Effect.fromResult(decodeRow(projectNativeRow(observation.row)))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (observation.table !== table.name || typeof row.id !== "string" || observed.has(row.id))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        observed.set(row.id, row);
      }
      const selected = [...observed.values()].filter(row => (plan.withDeleted || row.deleted_at === null) &&
        (requested === undefined || typeof row.id === "string" && requested.has(row.id)));
      // This is the scalar repository's storage order, not the native
      // mutation repository's optional caller-filter order.
      selected.sort((left, right) => compareBytesLexicographically(
        encoder.encode(String(left.id)), encoder.encode(String(right.id))));
      const direction = plan.query.order.direction;
      if (direction !== "asc" && direction !== "desc") return yield* Effect.fail(commerceError("receiptMismatch"));
      const selection = plan.window.kind === "catalog" ? plan.window.select(selected)
        : { rows: orderedCatalog(direction)(selected).rows.slice(plan.query.skip,
          plan.query.take === undefined ? undefined : plan.query.skip + plan.query.take), count: selected.length };
      const expected = yield* Effect.fromResult(projectRows(selection.rows, plan.projection.node))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (count !== selection.count || !jsonEqual(rows, expected))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    });
    return validateLogicalCall;
  });
}
