import { Result, type Effect } from "effect";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { decodeCompiledDml } from "../schema/compiled";

type Table = Effect.Success<ReturnType<typeof decodeCompiledDml>>["tables"][number];
export interface PhysicalReferenceDetachment {
  readonly sourceTable: string;
  readonly sourceColumn: string;
  readonly sourceKey: string;
  readonly targetTable: string;
  readonly targetColumn: string;
}

/** A named module admits source tables; checked native non-cascading hasMany
 * metadata selects their exact nullable scalar edge. A NO ACTION FK alone is
 * never permission to detach a reference. */
export function preparePhysicalReferenceDetachments(tables: readonly Table[], admittedSources: readonly Table[]) {
  return Result.gen(function* () {
    const edges: PhysicalReferenceDetachment[] = [];
    for (const target of tables) for (const relation of target.relationships) {
      if (relation.type !== "hasMany" || relation.cascadeDelete) continue;
      const source = admittedSources.find(table => table.name === relation.targetTable);
      if (source === undefined) continue;
      const descriptor = describeToManyRelation(target, relation.name, tables);
      const sourceKey = source.columns.filter(column => column.primaryKey);
      if (descriptor?.join.type !== "hasMany" || descriptor.targetTable !== source.name ||
        descriptor.join.foreignKeys.length !== 1 || descriptor.sourcePrimaryKeys.length !== 1 ||
        sourceKey.length !== 1 || sourceKey[0]?.name !== "id" || descriptor.sourcePrimaryKeys[0] !== "id")
        return yield* Result.fail(commerceError("unsupportedProfile"));
      const column = descriptor.join.foreignKeys[0];
      if (column === undefined || source.columns.find(value => value.name === column)?.nullable !== true ||
        !source.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === column && key.referencedTable === target.name &&
          key.referencedColumns.length === 1 && key.referencedColumns[0] === "id" && key.onDelete === undefined))
        return yield* Result.fail(commerceError("unsupportedProfile"));
      edges.push(Object.freeze({ sourceTable: source.name, sourceColumn: column, sourceKey: "id", targetTable: target.name, targetColumn: "id" }));
    }
    if (admittedSources.some(source => !edges.some(edge => edge.sourceTable === source.name)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    return Object.freeze(edges);
  });
}
