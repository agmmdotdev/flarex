import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import {
  type FlarexPersistence,
  indexBoundsForExpressions,
} from "../src";
import {
  createPostgresPersistence,
  type PostgresFlarexPersistence,
} from "../src/postgres";

const postgresUrl = normalizePostgresUrl(
  process.env.FLAREX_POSTGRES_DATABASE_URL,
);
const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("createPostgresPersistence", () => {
  it("uses the indexed freshness btree path on real Postgres", async () => {
    const connectionString = requiredPostgresUrl();
    const schemaName = temporaryIdentifier("flarex_test");
    const migrationsSchema = temporaryIdentifier("flarex_migrations");
    const adminPool = new Pool({ connectionString });
    let persistence: PostgresFlarexPersistence | undefined;

    try {
      await adminPool.query(`create schema ${quoteIdentifier(schemaName)}`);
      await adminPool.query(`create schema ${quoteIdentifier(migrationsSchema)}`);
      persistence = await createPostgresPersistence({
        connectionString,
        migrationsSchema,
        poolConfig: {
          options: `-c search_path=${schemaName}`,
        },
      });
      await persistence.migrate();

      const bounds = indexBoundsForExpressions(["text"], [
        { op: "eq", field: "text", value: "hello" },
      ]);
      if (bounds.lower === undefined || bounds.upper === undefined) {
        throw new Error("Expected equality index bounds.");
      }

      await insertIndexedPackageAndSession(persistence, {
        deploymentId: "deployment_real_pg_index_freshness",
        sessionId: "session_insert_hello",
        beginTs: 100,
      });
      await persistence.stageInvokeSessionDocumentWrite({
        deploymentId: "deployment_real_pg_index_freshness",
        sessionId: "session_insert_hello",
        tableId: 1,
        documentId: "1:hello",
        op: "insert",
        valueJson: { text: "hello", count: 1 },
      });
      await persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_real_pg_index_freshness",
        sessionId: "session_insert_hello",
        source: "invoke:messages:send",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 100,
      });

      await expect(
        persistence.hasIndexEntryAfterTs({
          deploymentId: "deployment_real_pg_index_freshness",
          indexId: 1,
          afterTs: 100,
          ...bounds,
        }),
      ).resolves.toBe(true);

      const plan = await explainIndexedFreshnessPlan(persistence, {
        deploymentId: "deployment_real_pg_index_freshness",
        indexId: 1,
        afterTs: 100,
        lower: bounds.lower,
        upper: bounds.upper,
      });
      expect(planContainsText(plan, "indexes_by_index_id_key_prefix_ts")).toBe(
        true,
      );
    } finally {
      if (persistence !== undefined) {
        await persistence.close();
      }
      await adminPool.query(
        `drop schema if exists ${quoteIdentifier(schemaName)} cascade`,
      );
      await adminPool.query(
        `drop schema if exists ${quoteIdentifier(migrationsSchema)} cascade`,
      );
      await adminPool.end();
    }
  });
});

async function explainIndexedFreshnessPlan(
  persistence: FlarexPersistence,
  input: {
    deploymentId: string;
    indexId: number;
    afterTs: number;
    lower: string;
    upper: string;
  },
): Promise<unknown> {
  return await persistence.transaction(async (tx) => {
    await tx.exec("set local enable_seqscan = off");
    const result = await tx.query<ExplainRow>(
      `
        explain (format json, costs off)
        select key_prefix
        from indexes
        where deployment_id = $1
          and index_id = $2
          and key_prefix >= $3
          and key_prefix < $4
          and ts > $5
        limit 1
      `,
      [
        input.deploymentId,
        Buffer.from(String(input.indexId), "utf8"),
        Buffer.from(input.lower, "hex"),
        Buffer.from(input.upper, "hex"),
        input.afterTs,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("EXPLAIN returned no rows.");
    }
    return row["QUERY PLAN"];
  });
}

interface ExplainRow extends Record<string, unknown> {
  "QUERY PLAN": unknown;
}

async function insertIndexedPackageAndSession(
  persistence: FlarexPersistence,
  input: {
    deploymentId: string;
    sessionId: string;
    beginTs?: number;
  },
): Promise<void> {
  await persistence.insertDeploymentPackageMetadata({
    deploymentId: input.deploymentId,
    packageId: `package_indexed_${input.sessionId}`,
    sourcePackageHash: "c".repeat(64),
    executionModule: "_flarex/execution.js",
    sourcePackageJson: {
      modules: [],
      functions: [],
      execution: "_flarex/execution.js",
    },
    analysisJson: {
      schema: {
        version: 1,
        tables: [
          {
            tableId: 1,
            name: "messages",
            placement: { kind: "partitionBy", field: "_id" },
          },
        ],
        indexes: [
          {
            indexId: 1,
            tableId: 1,
            name: "by_text",
            fields: ["text"],
            state: "enabled",
          },
        ],
      },
    },
  });
  await persistence.insertInvokeSessionMetadata({
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    projectId: "project_indexed",
    packageId: `package_indexed_${input.sessionId}`,
    functionPath: "messages:send",
    functionKind: "mutation",
    partitionKey: "team:1",
    scopeJson: { kind: "partition", partitionKey: "team:1" },
    argsJson: { teamId: "team:1" },
    beginTs: input.beginTs ?? 100,
    schemaVersion: 1,
    executionModule: "_flarex/execution.js",
  });
}

function requiredPostgresUrl(): string {
  if (postgresUrl === null) {
    throw new Error("FLAREX_POSTGRES_DATABASE_URL is required.");
  }
  return postgresUrl;
}

function normalizePostgresUrl(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function temporaryIdentifier(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function planContainsText(plan: unknown, text: string): boolean {
  return JSON.stringify(plan).includes(text);
}
