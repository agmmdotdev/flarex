import { Option, Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../commerce-decoder";
import { captureCommerceInput } from "../commerce-input";
import type { ReadCatalog } from "./catalog";
import { compileWhere, type Predicate, type WherePolicy } from "./predicate";

export interface PopulationFilter {
  readonly path: string;
  readonly predicate: Predicate;
}
const decodePopulateWhere = commerceDecoder(Schema.Record(Schema.String, Schema.Unknown), "unsupportedProfile");

export function isSelectedPopulationPath(path: string, paths: readonly string[]): boolean {
  return path.length > 0 && paths.some(selected => selected === path || selected.startsWith(path + "."));
}

/** Module-owned per-path policies select the grammar. The shared read owner
 * resolves checked relation/column metadata and reuses ordinary where compilation. */
export function compilePopulationWhere(
  catalog: ReadCatalog, root: string, paths: readonly string[], input: unknown,
  policies: ReadonlyMap<string, WherePolicy>,
) {
  return Result.gen(function* () {
    const captured = yield* captureCommerceInput(input === undefined ? {} : input);
    const where = yield* decodePopulateWhere(captured);
    const filters: PopulationFilter[] = [];
    for (const [path, value] of Object.entries(where)) {
      const policy = policies.get(path);
      if (policy === undefined || !isSelectedPopulationPath(path, paths)) return yield* Result.fail(commerceError("unsupportedProfile"));
      let target = root;
      for (const name of path.split(".")) {
        const relation = yield* catalog.relation(target, name).pipe(Option.match({
          onNone: () => Result.fail(commerceError("unsupportedProfile")), onSome: Result.succeed,
        }));
        target = relation.targetTable;
      }
      const table = yield* catalog.table(target);
      if (policy.selectors !== undefined || [...policy.fields.values()].some(field => !table.columns.includes(field.column))) return yield* Result.fail(commerceError("unsupportedProfile"));
      filters.push(Object.freeze({ path, predicate: yield* compileWhere(value, policy) }));
    }
    return Object.freeze(filters);
  });
}
