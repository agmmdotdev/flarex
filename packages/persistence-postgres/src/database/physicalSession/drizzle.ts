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
/** Compile code-defined metadata once; each checkout binds a fresh session.
 * Construct each full-schema view only when that checkout first requests it. */
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
    let database: NodePgDatabase<FullSchema> | undefined;
    let transaction: NodePgTransaction<FullSchema, Tables> | undefined;
    return {
      get database() {
        return database ??= new NodePgDatabase<FullSchema>(dialect, session, schema);
      },
      get transaction() {
        return transaction ??= new NodePgTransaction<FullSchema, Tables>(dialect, session, schema);
      },
    };
  };
}
