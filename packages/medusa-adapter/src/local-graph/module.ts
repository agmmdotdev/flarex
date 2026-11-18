import { Option, Result } from "effect";
import type { ModuleJoinerConfig } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ReadCatalog, ReadTable } from "../query/catalog";
import type { GraphModuleDefinition, GraphRelationPath } from "./model";
import type { GraphReadCommand } from "./commands";
import { decodeGraphCount } from "./query";

/** Scalar profiles admit one unique primary key; aliases remain native policy.
 * Related paths and composite ordering keep their explicit graph definitions. */
export function scalarGraphDefinition(aliases: GraphModuleDefinition["aliases"], model: string,
  command: GraphReadCommand, table: ReadTable): Result.Result<GraphModuleDefinition, ReturnType<typeof commerceError>> {
  if (table.primaryKeys.length !== 1) return Result.fail(commerceError("unsupportedProfile"));
  return Result.succeed({ aliases, reads: [{ model, command, table, paths: [],
    orderable: table.primaryKeys, uniqueOrder: table.primaryKeys, multipleOrder: false, decode: decodeGraphCount,
  }] });
}

/** Use the pinned module's declared alias and entity. No naming guesses,
 * global container or request services are involved in alias preparation. */
export function moduleAliases(config: ModuleJoinerConfig): Result.Result<GraphModuleDefinition["aliases"], ReturnType<typeof commerceError>> {
  return Result.gen(function* () {
    const output: Array<GraphModuleDefinition["aliases"][number]> = [];
    for (const alias of Array.isArray(config.alias) ? config.alias : config.alias === undefined ? [] : [config.alias]) {
      if (typeof alias.entity !== "string") return yield* Result.fail(commerceError("unsupportedProfile"));
      for (const name of typeof alias.name === "string" ? [alias.name] : alias.name) output.push({ name, model: alias.entity });
    }
    return output;
  });
}

export function relationPaths(catalog: ReadCatalog, root: string, paths: readonly string[], options?: { readonly nativeFields: true }) {
  return Result.gen(function* () {
    const output: GraphRelationPath[] = [];
    for (const path of paths) {
      let table = root;
      let many = false;
      let sourceFields: readonly string[] = [];
      for (const name of path.split(".")) {
        const relation = yield* catalog.relation(table, name).pipe(Option.match({
          onNone: () => Result.fail(commerceError("unsupportedProfile")), onSome: Result.succeed,
        }));
        table = relation.targetTable;
        many = relation.join.type === "hasMany" || relation.join.type === "manyToMany";
        sourceFields = relation.join.type === "belongsTo" ? relation.join.foreignKeys : relation.sourcePrimaryKeys;
      }
      output.push({ path, table: yield* catalog.table(table), many,
        ...(options?.nativeFields === true ? { sourceFields: Object.freeze([...sourceFields]) } : {}),
      });
    }
    return output;
  });
}
