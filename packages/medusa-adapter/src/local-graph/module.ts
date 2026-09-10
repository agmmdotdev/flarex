import { Option, Result } from "effect";
import type { ModuleJoinerConfig } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ReadCatalog } from "../query/catalog";
import type { GraphModuleDefinition, GraphRelationPath } from "./model";

/** Use the pinned module's declared entity and method suffix. No naming guesses,
 * global container or request services are involved in alias preparation. */
export function moduleAliases(config: ModuleJoinerConfig): Result.Result<GraphModuleDefinition["aliases"], ReturnType<typeof commerceError>> {
  return Result.gen(function* () {
    const output: Array<GraphModuleDefinition["aliases"][number]> = [];
    for (const alias of Array.isArray(config.alias) ? config.alias : config.alias === undefined ? [] : [config.alias]) {
      if (typeof alias.entity !== "string" || typeof alias.args?.methodSuffix !== "string") return yield* Result.fail(commerceError("unsupportedProfile"));
      for (const name of typeof alias.name === "string" ? [alias.name] : alias.name) output.push({ name, model: alias.entity, methodSuffix: alias.args.methodSuffix });
    }
    return output;
  });
}

export function relationPaths(catalog: ReadCatalog, root: string, paths: readonly string[]) {
  return Result.gen(function* () {
    const output: GraphRelationPath[] = [];
    for (const path of paths) {
      let table = root;
      let many = false;
      for (const name of path.split(".")) {
        const relation = yield* catalog.relation(table, name).pipe(Option.match({
          onNone: () => Result.fail(commerceError("unsupportedProfile")), onSome: Result.succeed,
        }));
        table = relation.targetTable;
        many = relation.join.type !== "belongsTo";
      }
      output.push({ path, table: yield* catalog.table(table), many });
    }
    return output;
  });
}
