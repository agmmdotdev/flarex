import { Effect, Result } from "effect";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../repository/call-receipt";
import { projectNativeRow } from "../repository/result";
import { projectRows } from "../query/projection";
import { compileCompleteRow } from "../value/complete-row";
import type { SchemaTable } from "../schema/model";
import type { prepareLinkService } from "./service";
import type { linkLogicalEventPolicy } from "./events";
import { decodeGraphCount } from "../local-graph/query";

type Plan = Result.Result.Success<ReturnType<Effect.Success<ReturnType<typeof prepareLinkService>>["prepared"]["readPlan"]>>;
type Select = (input: unknown) => Result.Result<{ readonly plan: Plan; readonly includes: (row: JsonObject) => boolean }, ReturnType<typeof commerceError>>;

/** Shared Link read evidence; native family selectors and graph cardinality
 * remain at their respective Cart/Order construction boundaries. */
export function checkoutLinkReadPolicy(table: SchemaTable, endpoints: readonly [string, string], commandName: string,
  span: string, base: ReturnType<typeof linkLogicalEventPolicy>, select: Select) {
  const [endpoint, foreign] = endpoints;
  return Result.gen(function* () {
    const complete = yield* compileCompleteRow(table), encoder = new TextEncoder();
    const compareText = (left: string, right: string) => compareBytesLexicographically(encoder.encode(left), encoder.encode(right));
    const compareEndpoints = (left: JsonObject, right: JsonObject) => compareText(String(left[endpoint]), String(right[endpoint])) ||
      compareText(String(left[foreign]), String(right[foreign]));
    const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn(span)(function* (call, activity) {
      yield* base.validateLogicalCall(call, activity);
      if (call.commandName !== commandName || call.mode !== "read") return yield* Effect.fail(commerceError("receiptMismatch"));
      const { plan, includes } = yield* Effect.fromResult(select(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (activity.relationalReads.length !== 2 || activity.relationalReads.some(read => read.table !== table.name ||
        !jsonEqual(read.query, plan.query) || read.total > 4 || read.returned !== read.total)) return yield* Effect.fail(commerceError("receiptMismatch"));
      const observed = new Map<string, JsonObject>();
      for (const item of activity.observedRows) {
        if (item.table !== table.name) return yield* Effect.fail(commerceError("receiptMismatch"));
        const row = yield* Effect.fromResult(complete(projectNativeRow(item.row))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const key = JSON.stringify([row[endpoint], row[foreign]]);
        if (observed.has(key)) return yield* Effect.fail(commerceError("receiptMismatch"));
        observed.set(key, row);
      }
      const selected = [...observed.values()].filter(includes);
      const [rows, total] = yield* Effect.fromResult(decodeGraphCount(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const expected = yield* Effect.fromResult(projectRows(selected, plan.projection.node)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      // Ties retain native unspecified ordering; compare the complete body set
      // while enforcing the family's promised primary endpoint ordering.
      if (selected.length > 4 || total !== selected.length || rows.length !== total ||
        activity.relationalReads.some(read => read.total !== total) || rows.some((row, index) => typeof row[endpoint] !== "string" || index > 0 &&
          compareText(String(rows[index - 1]?.[endpoint]), String(row[endpoint])) > 0) ||
        !jsonEqual([...rows].sort(compareEndpoints), [...expected].sort(compareEndpoints))) return yield* Effect.fail(commerceError("receiptMismatch"));
    });
    return { capture: base.capture, validateLogicalCall };
  });
}
