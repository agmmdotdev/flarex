import { Result } from "effect";
import { commerceError, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

type CheckedUpdate = { readonly key: string; readonly update: JsonObject };

/** The admitted single-text-key DAL profile. Decoders retain module-specific
 * shape, limits, and failure order; persistence still owns stored-row updates. */
export interface KeyedUpdateProfile<Entry> {
  readonly keyColumn: string;
  readonly repeatedKeys: "preserve" | "reject";
  readonly decodeEntries: (input: Json) => Result.Result<readonly Entry[], CommerceTransactionError>;
  readonly readEntry: (entry: Entry) => Result.Result<CheckedUpdate, CommerceTransactionError>;
  readonly validateData?: (data: JsonObject) => Result.Result<unknown, CommerceTransactionError>;
}

/** Compile once per stable module/table profile. Each invocation owns its key
 * set and output rows. This plans scalar updates; it does not read, write,
 * merge stored metadata, acquire a manager, or change insert/upsert behavior. */
export function compileKeyedUpdates<Entry>(profile: KeyedUpdateProfile<Entry>) {
  const { keyColumn, repeatedKeys, decodeEntries, readEntry, validateData } = profile;
  return (input: Json): Result.Result<JsonObject[], CommerceTransactionError> => Result.gen(function* () {
    const rows: JsonObject[] = [];
    const keys = new Set<string>();
    for (const entry of yield* decodeEntries(input)) {
      const { key, update } = yield* readEntry(entry);
      if ((repeatedKeys === "reject" && keys.has(key)) || (update[keyColumn] !== undefined && update[keyColumn] !== key)) {
        return yield* Result.fail(commerceError("invalidInput"));
      }
      if (repeatedKeys === "reject") keys.add(key);
      const { [keyColumn]: selectedKey, ...data } = update;
      if (validateData !== undefined) yield* validateData(data);
      // Validate without replacing the admitted data: omission, null, empty
      // relations, metadata values and insertion order remain caller-owned.
      rows.push({ ...data, [keyColumn]: key });
    }
    return rows;
  });
}
