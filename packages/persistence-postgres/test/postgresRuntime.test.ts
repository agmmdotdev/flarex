import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";

import type { QueryResult } from "../src";
import {
  runPostgresTransaction,
  type PostgresQueryClient,
} from "../src/postgresRuntime";
import { flarexSchema } from "../src/schema";

describe("runPostgresTransaction", () => {
  it("preserves a callback failure when rollback also fails", async () => {
    const primaryError = new Error("callback failed");
    const rollbackError = new Error("rollback failed");
    const client = new ScriptedPostgresClient(
      new Map([["ROLLBACK", rollbackError]]),
    );
    let observedRollbackError: unknown;

    await expect(
      runPostgresTransaction(
        client,
        testDatabase(),
        async () => {
          throw primaryError;
        },
        {
          onRollbackError: (error) => {
            observedRollbackError = error;
          },
        },
      ),
    ).rejects.toBe(primaryError);
    expect(client.statements).toEqual(["BEGIN", "ROLLBACK"]);
    expect(observedRollbackError).toBe(rollbackError);
  });

  it("preserves a commit failure when rollback also fails", async () => {
    const commitError = new Error("commit failed");
    const rollbackError = new Error("rollback failed");
    const client = new ScriptedPostgresClient(
      new Map([
        ["COMMIT", commitError],
        ["ROLLBACK", rollbackError],
      ]),
    );
    let observedRollbackError: unknown;

    await expect(
      runPostgresTransaction(
        client,
        testDatabase(),
        async () => "value",
        {
          onRollbackError: (error) => {
            observedRollbackError = error;
          },
        },
      ),
    ).rejects.toBe(commitError);
    expect(client.statements).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
    expect(observedRollbackError).toBe(rollbackError);
  });
});

class ScriptedPostgresClient implements PostgresQueryClient {
  readonly statements: string[] = [];

  constructor(private readonly failures: ReadonlyMap<string, Error>) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    _params?: unknown[],
  ): Promise<QueryResult<Row>> {
    this.statements.push(sql);
    const failure = this.failures.get(sql);
    if (failure !== undefined) throw failure;
    return { rows: [] };
  }
}

function testDatabase(): NodePgDatabase<typeof flarexSchema> {
  return drizzle.mock({ schema: flarexSchema });
}
