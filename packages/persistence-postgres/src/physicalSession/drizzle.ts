import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  type ExtractTablesWithRelations,
  type RelationalSchemaConfig,
} from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  NodePgSession,
  NodePgTransaction,
} from "drizzle-orm/node-postgres/session";
import type { Client, PoolClient } from "pg";
/** Compile code-defined metadata once; each call binds fresh views to an
 * already-owned Client or PoolClient without acquiring any resource. */
export function makePhysicalSessionAccess<
  FullSchema extends Record<string, unknown>,
>(fullSchema: FullSchema) {
  type Tables = ExtractTablesWithRelations<FullSchema>;
  const extracted = extractTablesRelationalConfig<Tables>(
    fullSchema,
    createTableRelationsHelpers,
  );
  const schema = {
    fullSchema,
    schema: extracted.tables,
    tableNamesMap: extracted.tableNamesMap,
  } satisfies RelationalSchemaConfig<Tables>;
  const dialect = new PgDialect();
  return (client: Client | PoolClient) => {
    const session = new NodePgSession<FullSchema, Tables>(
      client,
      dialect,
      schema,
    );
    return {
      database: new NodePgDatabase<FullSchema>(dialect, session, schema),
      transaction: new NodePgTransaction<FullSchema, Tables>(
        dialect,
        session,
        schema,
      ),
    };
  };
}
