import { Result } from "effect";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { GraphReadDefinition } from "./model";
import { graphSelectableColumns } from "./presentation";
import type { GraphComputedObject } from "./computed";

/** Computed metadata restricts capabilities; native Query alone expands and
 * presents the selected object. A selected object prefix grants its own leaves. */
function admitsComputed(object: GraphComputedObject, field: string) {
  return field === "" || field === "*" || object.fields.some(allowed => allowed === field || allowed.startsWith(field + ".")
    || field.endsWith(".*") && allowed.startsWith(field.slice(0, -1)));
}

/** Static field/path admission only. This produces no tree, storage selection,
 * hydration fields or response mask; all execution belongs to native Query. */
export function planGraphFields(read: GraphReadDefinition, fields: readonly string[]): Result.Result<void, CommerceTransactionError> {
  return Result.gen(function* () {
    const paths = new Map(read.paths.map(relation => [relation.path, relation]));
    for (const field of fields) {
      const parts = field.split(".");
      if (parts.some(part => part.length === 0)) return yield* Result.fail(commerceError("unsupportedProfile"));
      const output = read.paths.find(path => path.outputObject !== undefined && (field === path.path || field.startsWith(path.path + ".")));
      if (output?.outputObject !== undefined) {
        if (!admitsComputed(output.outputObject, field === output.path ? "" : field.slice(output.path.length + 1)))
          return yield* Result.fail(commerceError("unsupportedProfile"));
        continue;
      }
      const computed = [read, ...read.paths].flatMap(owner => Object.entries(owner.computedObjects ?? {}).map(([name, object]) =>
        ({ name: ("path" in owner ? owner.path + "." : "") + name, object })))
        .find(candidate => field === candidate.name || field.startsWith(candidate.name + "."));
      if (computed !== undefined) {
        if (!admitsComputed(computed.object, field === computed.name ? "" : field.slice(computed.name.length + 1)))
          return yield* Result.fail(commerceError("unsupportedProfile"));
        continue;
      }
      const column = parts.pop(), selected = parts.length === 0 ? read : paths.get(parts.join("."));
      if (column === undefined || selected === undefined || column !== "*" && !graphSelectableColumns(selected).includes(column)
        && !selected.optionalFields?.includes(column)) return yield* Result.fail(commerceError("unsupportedProfile"));
    }
  });
}
