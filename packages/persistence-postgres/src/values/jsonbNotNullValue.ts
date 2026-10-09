import { sql } from "drizzle-orm";

/** Preserves JSON null when writing through a NOT NULL PostgreSQL jsonb column. */
export function jsonbNotNullValue(value: unknown): unknown {
  return value === null ? sql`'null'::jsonb` : value;
}
