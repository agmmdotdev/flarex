import { describe, expect, it } from "vitest";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";

import {
  type FlarexPersistence,
  indexBoundsForExpressions,
  sql,
  upsertLiveQuerySubscription,
} from "../src";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("createPostgresPersistence", () => {
  it("uses transaction time for an implicit live query subscription update timestamp", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const key = {
        deploymentId: "deployment_real_pg_live_query_database_time",
        connectionId: "connection_database_time",
        queryId: 1,
      } as const;

      await persistence.upsertLiveQuerySubscription({
        ...key,
        functionPath: "messages:list",
        argsJson: {},
        beginTs: 10,
        readSetJson: {},
        resultJson: [],
        resultHash: "hash_before_database_time",
        updatedAt: new Date("2000-01-01T00:00:00.000Z"),
      });

      await persistence.drizzle.transaction(async (tx) => {
        const timestampResult = await tx.execute<{
          transaction_now_ms: string;
        }>(sql`
          select floor(extract(epoch from current_timestamp) * 1000)::text
            as transaction_now_ms
        `);
        const transactionNowMs = Number(
          timestampResult.rows[0]?.transaction_now_ms,
        );
        expect(Number.isSafeInteger(transactionNowMs)).toBe(true);

        await new Promise<void>(resolve => setTimeout(resolve, 25));

        const updated = await upsertLiveQuerySubscription(tx, {
          ...key,
          functionPath: "messages:list",
          argsJson: {},
          beginTs: 11,
          readSetJson: {},
          resultJson: [{ text: "updated" }],
          resultHash: "hash_after_database_time",
        });

        expect(updated.updatedAt.getTime()).toBe(transactionNowMs);
      });
    });
  });

  it("enforces the scope catalog constraints on real Postgres", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      for (const deploymentId of [
        "deployment_real_pg_scope_a",
        "deployment_real_pg_scope_b",
      ]) {
        await persistence.insertDeploymentMetadata({
          deploymentId,
          projectId: `project_${deploymentId}`,
        });
      }

      await persistence.insertScopeMetadata({
        scopeId: ScopeIdSchema.make("scope_real_pg_a"),
        deploymentId: "deployment_real_pg_scope_a",
        physicalLocator: {
          kind: "shared_database",
          databaseKey: "primary",
          schemaName: "public",
        },
      });
      await persistence.insertScopeMetadata({
        scopeId: ScopeIdSchema.make("scope_real_pg_b"),
        deploymentId: "deployment_real_pg_scope_b",
        physicalLocator: {
          kind: "schema_per_scope",
          databaseKey: "primary",
          schemaName: "fx_scope_real_pg_b",
        },
      });

      const firstPage = await persistence.listScopeMetadata({ limit: 1 });
      expect(firstPage.scopes.map((scope) => scope.scopeId)).toEqual([
        "scope_real_pg_a",
      ]);
      if (firstPage.nextCursor === null) {
        throw new Error("Expected the first real Postgres scope page to continue.");
      }
      await expect(
        persistence.listScopeMetadata({
          limit: 1,
          cursor: firstPage.nextCursor,
        }),
      ).resolves.toMatchObject({
        scopes: [{ scopeId: "scope_real_pg_b" }],
        nextCursor: null,
        hasMore: false,
      });

      const constraints = await persistence.query<ConstraintRow>(
        `
          select conname, contype
          from pg_constraint
          where conrelid = 'fx_control_scope'::regclass
          order by conname
        `,
      );
      expect(constraints.rows).toEqual(
        expect.arrayContaining([
          {
            conname: "fx_control_scope_deployment_id_deployments_deployment_id_fk",
            contype: "f",
          },
          {
            conname: "fx_control_scope_deployment_id_unique",
            contype: "u",
          },
          {
            conname: "fx_control_scope_isolation_kind_check",
            contype: "c",
          },
          {
            conname: "fx_control_scope_physical_locator_check",
            contype: "c",
          },
        ]),
      );

      const sharedLocator = JSON.stringify({
        kind: "shared_database",
        databaseKey: "primary",
        schemaName: "public",
      });
      await expect(
        persistence.query(
          `
            insert into fx_control_scope (
              id,
              deployment_id,
              isolation_kind,
              physical_locator_json
            ) values ($1, $2, $3, $4::jsonb)
          `,
          [
            "scope_real_pg_duplicate_deployment",
            "deployment_real_pg_scope_a",
            "shared_database",
            sharedLocator,
          ],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        persistence.query(
          `
            insert into fx_control_scope (
              id,
              deployment_id,
              isolation_kind,
              physical_locator_json
            ) values ($1, $2, $3, $4::jsonb)
          `,
          [
            "scope_real_pg_orphan",
            "deployment_real_pg_missing",
            "shared_database",
            sharedLocator,
          ],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        persistence.query(
          `
            update fx_control_scope
            set physical_locator_json = $1::jsonb
            where id = $2
          `,
          [
            JSON.stringify({
              kind: "database_per_scope",
              databaseKey: "primary",
              schemaName: "public",
            }),
            "scope_real_pg_a",
          ],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        persistence.query(
          `
            update fx_control_scope
            set physical_locator_json = $1::jsonb
            where id = $2
          `,
          [
            JSON.stringify({
              kind: "shared_database",
              databaseKey: "\t\n",
              schemaName: "public",
            }),
            "scope_real_pg_a",
          ],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        persistence.query(
          `delete from deployments where deployment_id = $1`,
          ["deployment_real_pg_scope_a"],
        ),
      ).rejects.toMatchObject({ code: "23001" });
    });
  });

  it("uses the indexed freshness btree path on real Postgres", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
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
    });
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

interface ConstraintRow extends Record<string, unknown> {
  conname: string;
  contype: string;
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

function planContainsText(plan: unknown, text: string): boolean {
  return JSON.stringify(plan).includes(text);
}
