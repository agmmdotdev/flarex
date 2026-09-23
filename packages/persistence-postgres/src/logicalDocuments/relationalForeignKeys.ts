import { Result } from "effect";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import type { LogicalDocumentFailure } from "./model";

export interface LogicalRelationalForeignKey {
  readonly source: Readonly<{ tableId: CatalogTableId; name: string; column: string }>;
  readonly target: Readonly<{ tableId: CatalogTableId; name: string; column: string }>;
  readonly onDelete: "noAction" | "cascade";
}

/** Bind authenticated source-local identities once. The execution owner only
 * admits the single-text-to-primary-key profile it can enforce with indexed
 * observations. Other normalized FK shapes stay closed until implemented. */
export function prepareLogicalRelationalForeignKeys<Failure>(
  tables: readonly Readonly<{ tableId: CatalogTableId; logicalName: string; relational?: RelationalTableDefinition }>[],
  error: LogicalDocumentFailure<Failure>,
) {
  return Result.gen(function* () {
    const bindings: LogicalRelationalForeignKey[] = [];
    for (const source of tables) {
      const definition = source.relational;
      if (definition === undefined) continue;
      for (const constraint of definition.constraints) {
        if (constraint.kind !== "foreignKey") continue;
        const from = constraint.sourceColumns[0];
        const to = constraint.targetColumns[0];
        const target = tables.find(table => table.relational?.identity.owner === definition.identity.owner &&
          table.relational.identity.lineageId === definition.identity.lineageId &&
          table.relational.identity.tableId === to?.tableId);
        const primary = target?.relational?.keys.find(key => key.kind === "primary");
        if (constraint.sourceColumns.length !== 1 || constraint.targetColumns.length !== 1 || from === undefined || to === undefined ||
          from.tableId !== definition.identity.tableId || from.owner !== definition.identity.owner ||
          from.lineageId !== definition.identity.lineageId || target === undefined ||
          definition.columns.find(column => column.identity.columnId === from.columnId)?.type !== "text" ||
          target.relational?.columns.find(column => column.identity.columnId === to.columnId)?.type !== "text" ||
          primary?.columns.length !== 1 || primary.columns[0]?.columnId !== to.columnId ||
          constraint.onDelete === "restrict" || constraint.onUpdate !== "noAction")
          return yield* Result.fail(error("invalidInput"));
        bindings.push(Object.freeze({
          source: Object.freeze({ tableId: source.tableId, name: source.logicalName, column: from.columnId }),
          target: Object.freeze({ tableId: target.tableId, name: target.logicalName, column: to.columnId }),
          onDelete: constraint.onDelete,
        }));
      }
    }
    return Object.freeze(bindings);
  });
}
