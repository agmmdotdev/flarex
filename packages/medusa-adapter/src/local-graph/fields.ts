import { Result } from "effect";
import { toPopulateTree, type PopulateTree } from "@medusajs/drizzle/relation-query";
import { commerceError, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ReadTable } from "../query/catalog";
import { projectRows, type ProjectionNode } from "../query/projection";
import type { GraphReadDefinition, GraphRelationPath } from "./model";

export interface GraphFieldPlan {
  readonly select: readonly string[];
  readonly relations: readonly string[];
  readonly project: (rows: readonly JsonObject[]) => Result.Result<JsonObject[], CommerceTransactionError>;
}

/** Validate native admission, then reuse the promoted Medusa path tree and shared
 * projection executor. No remote-query AST, row reader or relation loader. */
export function planGraphFields(read: GraphReadDefinition, fields: readonly string[]): Result.Result<GraphFieldPlan, CommerceTransactionError> {
  return Result.gen(function* () {
    const paths = new Map(read.paths.map(relation => [relation.path, relation]));
    const requested = new Set<string>();
    for (const field of fields) {
      const parts = field.split(".");
      if (parts.some(part => part.length === 0)) return yield* Result.fail(commerceError("unsupportedProfile"));
      const column = parts.pop();
      const table = parts.length === 0 ? read.table : paths.get(parts.join("."))?.table;
      if (column === undefined || table === undefined || (column !== "*" && !table.columns.includes(column))) return yield* Result.fail(commerceError("unsupportedProfile"));
      for (let index = 1; index <= parts.length; index++) requested.add(parts.slice(0, index).join("."));
    }
    const root = yield* fieldProjection(toPopulateTree(fields), read.table, paths, "");
    // Hydration may need root keys not selected by the caller. Fetch all root
    // columns for relation reads, then mask them; all intermediate budgets apply.
    const select = root.children.length === 0 ? [...root.fields] : [...read.table.columns];
    return { select, relations: read.paths.filter(relation => requested.has(relation.path)).map(relation => relation.path),
      project: rows => projectRows(rows, root) };
  });
}

/** Native-only policy: expand a node wildcard against its admitted columns and
 * require selected scalars. Prefix normalization and row projection are reused. */
function fieldProjection(tree: PopulateTree, table: ReadTable, paths: ReadonlyMap<string, GraphRelationPath>, prefix: string): Result.Result<ProjectionNode, CommerceTransactionError> {
  return Result.gen(function* () {
    const fields = new Set<string>();
    const children: Array<ProjectionNode["children"][number]> = [];
    for (const [name, child] of tree) {
      if (child.size === 0) {
        for (const column of name === "*" ? table.columns : [name]) {
          fields.add(column);
          const companion = Object.hasOwn(table.companions, column) ? table.companions[column] : undefined;
          if (companion !== undefined) fields.add(companion);
        }
      } else {
        const path = prefix + name;
        const relation = paths.get(path);
        if (relation === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
        children.push({ name, many: relation.many, optional: relation.optional === true,
          node: yield* fieldProjection(child, relation.table, paths, path + ".") });
      }
    }
    return { fields, children, nullRelations: [], requireFields: true };
  });
}
