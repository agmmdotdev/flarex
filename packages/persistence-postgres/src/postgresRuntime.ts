import type { SQLWrapper } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type {
  FlarexPersistenceTx,
  FlarexSqlClient,
  QueryResult,
} from "./index";
import {
  rowsFromDriver,
  type FlarexRuntimePersistenceTransaction,
} from "./runtimePersistence";
import { flarexSchema } from "./schema";

export interface PostgresQueryClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface RunPostgresTransactionOptions {
  onRollbackError?(error: unknown): void;
}

export function createPostgresSqlClient(
  database: NodePgDatabase<typeof flarexSchema>,
  client: PostgresQueryClient,
): FlarexSqlClient {
  return {
    async execute<Row extends Record<string, unknown> = Record<string, unknown>>(
      query: SQLWrapper | string,
    ): Promise<QueryResult<Row>> {
      const result = await database.execute<Row>(query);
      return { rows: rowsFromDriver<Row>(result.rows) };
    },
    async exec(sql: string): Promise<void> {
      await client.query(sql);
    },
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<QueryResult<Row>> {
      const result = await client.query<Row>(
        sql,
        params === undefined ? [] : [...params],
      );
      return { rows: result.rows };
    },
  };
}

export async function runPostgresTransaction<T>(
  client: PostgresQueryClient,
  database: NodePgDatabase<typeof flarexSchema>,
  run: (transaction: FlarexRuntimePersistenceTransaction) => Promise<T>,
  options: RunPostgresTransactionOptions = {},
): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await run({
      drizzle: database,
      sql: createPostgresSqlClient(
        database,
        client,
      ) satisfies FlarexPersistenceTx,
    });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // The transaction/domain failure is authoritative. A failed rollback is
      // secondary cleanup and must not replace it at the Worker boundary.
      try {
        options.onRollbackError?.(rollbackError);
      } catch {
        // Observability cleanup is secondary to the primary transaction error.
      }
    }
    throw error;
  }
}
