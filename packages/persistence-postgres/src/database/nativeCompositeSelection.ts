import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/** Select each native composite scalar with its real column decoder.
 * Composite records themselves never cross the driver transport boundary.
 * A null composite projects null for every scalar, including required columns. */
export function nativeCompositeSelection<T extends PgTable>(table: T, record: string): {
  [K in keyof T["$inferSelect"]]: SQL<T["$inferSelect"][K] | null>
} {
  // SAFETY: Drizzle's column-key map is exactly the table's inferred row map.
  return Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, column]) =>
    [key, sql`(${sql.raw(record)}).${sql.identifier(column.name)}`.mapWith(column)])) as {
      [K in keyof T["$inferSelect"]]: SQL<T["$inferSelect"][K] | null>
    };
}
