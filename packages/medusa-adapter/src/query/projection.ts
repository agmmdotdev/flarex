import { Option, Result } from "effect";
import { projectRowFields, toPopulateTree } from "@medusajs/drizzle/relation-query";
import { commerceError, isJsonObject, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ReadCatalog } from "./catalog";

/** Response policy is separate from the keys required to read a relationship. */
export interface ProjectionPolicy {
  readonly allowedPaths?: readonly string[];
  readonly keys: "selected" | "retain" | "retainWhenNested";
  readonly storageKeys: "selected" | "first" | "last";
  readonly joinKeys: "storage" | "retain" | "retainWhenNested";
  readonly incomingKeys?: boolean;
  readonly nullToOne?: boolean;
  readonly selectableRelations: readonly string[];
  readonly nested: ReadonlyMap<string, ProjectionPolicy>;
}
export interface ProjectionNode {
  readonly fields: ReadonlySet<string>;
  /** Native graph masks require every selected scalar; existing DAL projections
   * keep their established optional-field behavior unless explicitly selected. */
  readonly requireFields?: boolean;
  readonly children: readonly { readonly name: string; readonly many: boolean; readonly optional?: boolean; readonly node: ProjectionNode }[];
  readonly nullRelations: readonly { readonly name: string; readonly keys: readonly string[] }[];
}
export interface ReadProjection {
  readonly storageFields: readonly string[];
  readonly node: ProjectionNode;
}

/** Bounded projection-tree planning from the pinned DAL's selection semantics.
 * Module policies decide which nested fields are admitted; DML supplies names. */
export function compileProjection(
  catalog: ReadCatalog, tableName: string, fields: readonly string[] | undefined,
  paths: readonly string[], policy: ProjectionPolicy, incomingKeys: readonly string[] = [],
): Result.Result<ReadProjection, CommerceTransactionError> {
  return Result.gen(function* () {
    const allowedPaths = policy.allowedPaths;
    if (allowedPaths !== undefined && paths.some(path => !allowedPaths.includes(path))) return yield* Result.fail(commerceError("unsupportedProfile"));
    const table = yield* catalog.table(tableName);
    const selected = fields ?? table.columns;
    const scalar: string[] = [];
    const nestedFields = new Map<string, string[]>();
    const tree = toPopulateTree(paths);
    for (const field of selected) {
      if (table.columns.includes(field)) scalar.push(field);
      else {
        const dot = field.indexOf(".");
        const name = field.slice(0, dot), child = field.slice(dot + 1);
        if (dot < 1 || !policy.selectableRelations.includes(name) || !policy.nested.has(name) || !tree.has(name)) return yield* Result.fail(commerceError("unsupportedProfile"));
        const group = nestedFields.get(name) ?? []; group.push(child); nestedFields.set(name, group);
      }
    }
    for (const field of [...scalar]) {
      const companion = Object.hasOwn(table.companions, field) ? table.companions[field] : undefined;
      if (companion !== undefined && !scalar.includes(companion)) scalar.push(companion);
    }
    const joins: string[] = [];
    const children: Array<ProjectionNode["children"][number]> = [];
    for (const name of tree.keys()) {
      const relation = yield* catalog.relation(tableName, name).pipe(Option.match({
        onNone: () => Result.fail(commerceError("unsupportedProfile")), onSome: Result.succeed,
      }));
      if (relation.join.type === "belongsTo") joins.push(...relation.join.foreignKeys);
      const childPolicy = policy.nested.get(name);
      if (childPolicy !== undefined) {
        const childPaths = paths.filter(path => path.startsWith(name + ".")).map(path => path.slice(name.length + 1));
        const projection = yield* compileProjection(catalog, relation.targetTable, nestedFields.get(name), childPaths, childPolicy,
          relation.join.type === "hasMany" ? relation.join.foreignKeys : []);
        children.push({ name, many: relation.join.type !== "belongsTo", node: projection.node });
      }
    }
    const nested = nestedFields.size > 0;
    const storageFields = [...new Set([
      ...(policy.storageKeys === "first" ? table.primaryKeys : []), ...scalar,
      ...(policy.storageKeys === "last" ? table.primaryKeys : []), ...joins,
    ])];
    const retainedKeys = policy.keys === "retain" || (policy.keys === "retainWhenNested" && nested) ? table.primaryKeys : [];
    const retainedJoins = policy.joinKeys === "retain" || (policy.joinKeys === "retainWhenNested" && nested) ? joins : [];
    const exposed = new Set([...scalar, ...retainedKeys, ...retainedJoins, ...(policy.incomingKeys ? incomingKeys : []), ...tree.keys()]);
    const nullRelations: Array<ProjectionNode["nullRelations"][number]> = [];
    if (policy.nullToOne) {
      for (const name of policy.nested.keys()) {
        const relation = catalog.relation(tableName, name);
        if (Option.isSome(relation) && relation.value.join.type === "belongsTo") nullRelations.push({ name, keys: relation.value.join.foreignKeys });
      }
    }
    return { storageFields, node: { fields: exposed, children, nullRelations } };
  });
}

export function projectRows(rows: readonly JsonObject[], node: ProjectionNode): Result.Result<JsonObject[], CommerceTransactionError> {
  return Result.gen(function* () {
    const output: JsonObject[] = [];
    for (const row of rows) {
      if (node.requireFields === true && [...node.fields].some(field => !Object.hasOwn(row, field))) return yield* Result.fail(commerceError("storedCorruption"));
      const projected = projectRowFields(row, node.fields);
      for (const child of node.children) {
        const value = row[child.name];
        if (!child.many && child.optional === true && value === undefined) continue;
        if (child.many) {
          if (!Array.isArray(value) || !value.every(isJsonObject)) return yield* Result.fail(commerceError("storedCorruption"));
          projected[child.name] = yield* projectRows(value, child.node);
        } else {
          if (value === null) projected[child.name] = null;
          else {
            if (value === undefined || !isJsonObject(value)) return yield* Result.fail(commerceError("storedCorruption"));
            const children = yield* projectRows([value], child.node);
            const first = children[0];
            if (first === undefined) return yield* Result.fail(commerceError("storedCorruption"));
            projected[child.name] = first;
          }
        }
      }
      for (const relation of node.nullRelations) {
        if (projected[relation.name] === undefined && relation.keys.length > 0 && relation.keys.every(key => node.fields.has(key) && projected[key] === null)) projected[relation.name] = null;
      }
      output.push(projected);
    }
    return output;
  });
}
