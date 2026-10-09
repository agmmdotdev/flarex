import { getTableColumns, sql } from "drizzle-orm";
import { PgDialect, type PgColumn, type PreparedQueryConfig } from "drizzle-orm/pg-core";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { fxSystemIndexBuildStates, fxSystemUniqueConstraintBuilds } from "../../database/schema";

type BuildTable = typeof fxSystemIndexBuildStates | typeof fxSystemUniqueConstraintBuilds;
type ReturningField = Readonly<{ path: string[]; field: PgColumn }>;
const dialect = new PgDialect();

/** Drizzle's ordinary INSERT includes omitted columns as DEFAULT. These two
 * lifecycle owners must omit the activation-only binding from the SQL column
 * list itself, while retaining the real columns, codecs and server defaults. */
function insertLifecycleBuild<Table extends BuildTable, Row>(
  tx: FlarexMetadataTransaction,
  table: Table,
  binding: PgColumn,
  values: Omit<Table["$inferInsert"], "maintenanceActivationSequence">,
  returning: ReturningField[],
): Promise<Row[]> {
  const columns = Object.entries(getTableColumns(table)).filter(([, column]) => column !== binding);
  const supplied = new Map(Object.entries(values));
  const statement = sql`insert into ${table}
    (${sql.join(columns.map(([, column]) => sql.identifier(column.name)), sql`, `)})
    values (${sql.join(columns.map(([key, column]) => supplied.get(key) === undefined
      ? sql`default` : sql.param(supplied.get(key), column)), sql`, `)})
    returning ${sql.join(returning.map(({ field }) => field), sql`, `)}`;
  return tx._.session.prepareQuery<PreparedQueryConfig & { execute: Row[] }>(
    dialect.sqlToQuery(statement), returning, undefined, true,
  ).execute();
}

export function insertIndexBuildState(
  tx: FlarexMetadataTransaction,
  values: Omit<typeof fxSystemIndexBuildStates.$inferInsert, "maintenanceActivationSequence">,
): Promise<{ id: typeof fxSystemIndexBuildStates.$inferSelect.indexDefinitionId }[]> {
  return insertLifecycleBuild(tx, fxSystemIndexBuildStates, fxSystemIndexBuildStates.maintenanceActivationSequence,
    values, [{ path: ["id"], field: fxSystemIndexBuildStates.indexDefinitionId }]);
}

export function insertUniqueConstraintBuild(
  tx: FlarexMetadataTransaction,
  values: Omit<typeof fxSystemUniqueConstraintBuilds.$inferInsert, "maintenanceActivationSequence">,
): Promise<typeof fxSystemUniqueConstraintBuilds.$inferSelect[]> {
  return insertLifecycleBuild(tx, fxSystemUniqueConstraintBuilds, fxSystemUniqueConstraintBuilds.maintenanceActivationSequence,
    values, Object.entries(getTableColumns(fxSystemUniqueConstraintBuilds)).map(([key, field]) => ({ path: [key], field })));
}
