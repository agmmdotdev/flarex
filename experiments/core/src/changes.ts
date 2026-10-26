import { Result } from "effect";
import { numericField, uniqueKeys, type Definition, type Document } from "./definition.ts";
import { CoreError } from "./errors.ts";
import { createPendingIndex } from "./pending-index.ts";
import { applicationLimits, type NumericRange } from "./query.ts";
import { freezeOwnedJson } from "./value.ts";

/** One coherent pending row/unique/index owner, shared by the two write profiles.
 * Callers serialize use and provide already decoded scalar documents. */
export function createChanges(definition: Definition) {
  const rows = new Map<string, Document | null>();
  const owners = new Map<string, string>();
  const indexes = new Map(definition.indexes.map(index => [index.name, createPendingIndex()]));
  let bytes = 0; let keyOperations = 0;
  const check = (id: string, body: Document | null): Result.Result<void, CoreError> => {
    const previous = rows.get(id);
    const nextBytes = bytes - (previous == null ? 0 : Buffer.byteLength(JSON.stringify(previous))) + (body === null ? 0 : Buffer.byteLength(JSON.stringify(body)));
    if ((!rows.has(id) && rows.size >= applicationLimits.rows) || nextBytes > applicationLimits.bytes) return Result.fail(new CoreError({ reason: "limit" }));
    if (body !== null) for (const key of uniqueKeys(definition, body)) {
      keyOperations++;
      const owner = owners.get(JSON.stringify(key));
      if (owner !== undefined && owner !== id) return Result.fail(new CoreError({ reason: "unique" }));
    }
    return Result.succeed(undefined);
  };
  const apply = (id: string, body: Document | null) => Result.map(check(id, body), () => {
    const previous = rows.get(id);
    if (previous != null) {
      bytes -= Buffer.byteLength(JSON.stringify(previous));
      for (const key of uniqueKeys(definition, previous)) owners.delete(JSON.stringify(key));
      for (const index of definition.indexes) indexes.get(index.name)?.set(numericField(previous, index.field), numericField(previous, "systemCreationTime"), id, null);
    }
    const owned = body === null ? null : structuredClone(body);
    if (owned !== null) freezeOwnedJson(owned);
    rows.set(id, owned);
    if (owned !== null) {
      bytes += Buffer.byteLength(JSON.stringify(owned));
      for (const key of uniqueKeys(definition, owned)) owners.set(JSON.stringify(key), id);
      for (const index of definition.indexes) indexes.get(index.name)?.set(numericField(owned, index.field), numericField(owned, "systemCreationTime"), id, owned);
    }
  });
  return { check, apply, has: (id: string) => rows.has(id), get: (id: string) => rows.get(id),
    entries: () => [...rows.entries()], select: (range: NumericRange) => indexes.get(range.index)?.select(range) ?? [],
    diagnostics: () => ({ rows: rows.size, bytes, keyOperations }) };
}
