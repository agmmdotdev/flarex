import { Result } from "effect";
import { toPopulateTree, type PopulateTree } from "@medusajs/drizzle/relation-query";
import { commerceError, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ReadTable } from "../query/catalog";
import { projectRows, type ProjectionNode } from "../query/projection";
import type { GraphReadDefinition, GraphRelationPath } from "./model";
import { graphSelectableColumns, type GraphPresentation } from "./presentation";

export interface GraphFieldPlan {
  readonly node: ProjectionNode;
  /** Selected root scalars and companions before local hydration broadens reads. */
  readonly scalarSelect: readonly string[];
  readonly select: readonly string[];
  readonly relations: readonly string[];
  readonly project: (rows: readonly JsonObject[]) => Result.Result<JsonObject[], CommerceTransactionError>;
}

/** Validate native admission, then reuse the promoted Medusa path tree and shared
 * projection executor. No remote-query AST, row reader or relation loader. */
export function planGraphFields(read: GraphReadDefinition, fields: readonly string[], native = false): Result.Result<GraphFieldPlan, CommerceTransactionError> {
  return Result.gen(function* () {
    const paths = new Map(read.paths.map(relation => [relation.path, relation]));
    const requested = new Set<string>();
    for (const field of fields) {
      const parts = field.split(".");
      if (parts.some(part => part.length === 0)) return yield* Result.fail(commerceError("unsupportedProfile"));
      const column = parts.pop();
      const selected = parts.length === 0 ? read : paths.get(parts.join("."));
      if (column === undefined || selected === undefined || (column !== "*" && !graphSelectableColumns(selected).includes(column) &&
        !(parts.length === 0 && read.optionalFields?.includes(column)))) return yield* Result.fail(commerceError("unsupportedProfile"));
      for (let index = 1; index <= parts.length; index++) requested.add(parts.slice(0, index).join("."));
    }
    const tree = toPopulateTree(fields);
    const root = yield* fieldProjection(tree, read.table, paths, "", read.selectedFieldsOnly !== true, native, [], read.optionalFields, read.nativeFields === true, read.presentation);
    const fetch = read.selectedFieldsOnly === true ? yield* fieldProjection(tree, read.table, paths, "", true, native, [], read.optionalFields, read.nativeFields === true, read.presentation) : root;
    // Hydration may need root keys not selected by the caller. Fetch all root
    // columns for relation reads, then mask them; all intermediate budgets apply.
    const selected = [...fetch.fields].filter(field => graphSelectableColumns(read).includes(field));
    const select = fetch.children.length === 0 ? selected : [...new Set([...read.table.columns, ...selected])];
    return { node: root, scalarSelect: selected, select, relations: read.paths.filter(relation => requested.has(relation.path)).map(relation => relation.path),
      project: rows => projectRows(rows, root) };
  });
}

/** Native-only policy: expand a node wildcard against its admitted columns and
 * require selected scalars. Prefix normalization and row projection are reused. */
function fieldProjection(tree: PopulateTree, table: ReadTable, paths: ReadonlyMap<string, GraphRelationPath>, prefix: string,
  companions: boolean, native: boolean, incoming: readonly string[] = [], optionalFields?: readonly string[], nativeGraph = false,
  presentation?: GraphPresentation): Result.Result<ProjectionNode, CommerceTransactionError> {
  return Result.gen(function* () {
    const fields = new Set<string>(incoming);
    const children: Array<ProjectionNode["children"][number]> = [];
    for (const [name, child] of tree) {
      if (child.size === 0) {
        for (const column of name === "*" ? graphSelectableColumns({ table, ...(presentation === undefined ? {} : { presentation }) }) : [name]) {
          fields.add(column);
          const companion = Object.hasOwn(table.companions, column) ? table.companions[column]
            : presentation !== undefined && Object.hasOwn(presentation.companions, column) ? presentation.companions[column] : undefined;
          if (companions && companion !== undefined) fields.add(companion);
        }
      } else {
        const path = prefix + name;
        const relation = paths.get(path);
        if (relation === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
        const retained = native || nativeGraph && relation.nativeFields === true;
        if (retained) {
          if (relation.sourceFields === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
          for (const column of relation.sourceFields) fields.add(column);
        }
        children.push({ name, many: relation.many, optional: relation.optional === true,
          node: yield* fieldProjection(child, relation.table, paths, path + ".", companions, native,
            retained ? relation.targetFields ?? relation.table.primaryKeys : [], undefined, nativeGraph, relation.presentation) });
      }
    }
    return { fields, children, nullRelations: [], requireFields: true,
      ...(optionalFields === undefined ? {} : { optionalFields }) };
  });
}
