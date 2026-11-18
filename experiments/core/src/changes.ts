import { Result } from "effect";
import { numericField, textField, uniqueKeys, type Definition, type Document } from "./definition.ts";
import { CoreError } from "./errors.ts";
import { createPendingIndex } from "./pending-index.ts";
import { applicationLimits, type NumericRange, type TextEquality } from "./query.ts";
import { freezeOwnedJson } from "./value.ts";

/** One coherent pending row/unique/index owner, shared by the two write profiles.
 * Callers serialize use and provide already decoded scalar documents. */
export function createChanges(definition: Definition) {
  const rows = new Map<string, Document | null>();
  const owners = new Map<string, string>();
  const indexes = new Map(definition.indexes.map(index => [index.name, createPendingIndex()]));
  const equalities = new Map(definition.equalities.map(index => [index.name, new Map<string, Map<string, Document>>() ]));
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
      for (const index of definition.equalities) {
        const key = textField(previous, index.field); const members = key === null ? undefined : equalities.get(index.name)?.get(key);
        members?.delete(id); if (members?.size === 0 && key !== null) equalities.get(index.name)?.delete(key);
      }
    }
    const owned = body === null ? null : structuredClone(body);
    if (owned !== null) freezeOwnedJson(owned);
    rows.set(id, owned);
    if (owned !== null) {
      bytes += Buffer.byteLength(JSON.stringify(owned));
      for (const key of uniqueKeys(definition, owned)) owners.set(JSON.stringify(key), id);
      for (const index of definition.indexes) indexes.get(index.name)?.set(numericField(owned, index.field), numericField(owned, "systemCreationTime"), id, owned);
      for (const index of definition.equalities) {
        const key = textField(owned, index.field); if (key === null) continue;
        const membership = equalities.get(index.name);
        if (membership === undefined) throw new Error("Missing owned equality index");
        const members = membership.get(key) ?? new Map<string, Document>(); members.set(id, owned); membership.set(key, members);
      }
    }
  });
  return { check, apply, has: (id: string) => rows.has(id), get: (id: string) => rows.get(id),
    entries: () => [...rows.entries()], select: (range: NumericRange) => indexes.get(range.index)?.select(range) ?? [],
    selectEquality: (selection: TextEquality) => selection.keys.flatMap(key => [...(equalities.get(selection.index)?.get(key)?.values() ?? [])]),
    diagnostics: () => ({ rows: rows.size, bytes, keyOperations }) };
}
