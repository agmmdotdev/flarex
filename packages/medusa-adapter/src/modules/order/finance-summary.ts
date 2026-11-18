import { Effect } from "effect";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { projectExactNumericColumns } from "../../value/exact-numeric";

const quantities = ["paid_total", "refunded_total", "transaction_total", "pending_difference", "original_order_total",
  "current_order_total", "accounting_total", "credit_line_total"];

/** Summary.totals is native JSON, rather than a DML bigNumber column. Preserve
 * its existing JSON values and raw spelling. The common native DTO boundary
 * presents numeric instances before strict JSON capture; the named financial
 * quantities additionally authenticate every retained exact companion. */
export const captureOrderFinanceTotals = Effect.fn("OrderFinance.captureTotals")(function* (input: unknown) {
  const captured = yield* Effect.fromResult(captureNativeNumericDto(input));
  if (!isJsonObject(captured)) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const paired = quantities.filter(name => Object.hasOwn(captured, "raw_" + name)).map(name => ({ name }));
  yield* projectExactNumericColumns(captured, paired, "reserialize");
  return captured;
});
