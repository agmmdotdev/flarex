import { Result, Schema } from "effect";
import type { Json, JsonObject } from "flarex-protocol/json";
import { commerceError, commerceLimits } from "./model";

// The host captures this complete dataset inside its existing canonical rows
// hash. Target names are data, never table capabilities or a second authority.
const LogicalInitializationRows = Schema.Array(Schema.Struct({ table: Schema.String, row: Schema.JsonObject }))
  .check(Schema.isMaxLength(commerceLimits.catalogRows));
const decodeRows = Schema.decodeUnknownResult(LogicalInitializationRows, { onExcessProperty: "error" });

/** Preserve source order and FK-sensitive interleaving. Only adjacent entries
 * for one admitted table share a write; every target is checked before writing. */
export function planLogicalInitializationBatches(input: Json, localNames: readonly string[]) {
  return Result.gen(function* () {
    const rows = yield* decodeRows(input).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const admitted = new Set(localNames);
    for (const entry of rows)
      if (!admitted.has(entry.table)) return yield* Result.fail(commerceError("invalidAuthority"));
    const batches: { readonly table: string; readonly rows: JsonObject[] }[] = [];
    for (const entry of rows) {
      const previous = batches[batches.length - 1];
      if (previous?.table === entry.table) previous.rows.push(entry.row);
      else batches.push({ table: entry.table, rows: [entry.row] });
    }
    return batches;
  });
}
