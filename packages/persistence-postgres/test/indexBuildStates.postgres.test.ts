import { CatalogIndexDefinitionIdSchema } from "flarex-protocol/catalog";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import type { FlarexMetadataDatabase } from "../src/deployments";
import { readFencedIndexBuildStateEffect } from "../src";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

function readFencedIndexBuildState(
  db: FlarexMetadataDatabase,
  input: unknown,
) {
  return runEffect(readFencedIndexBuildStateEffect(db, input));
}

describePostgres("real Postgres fenced index build-state reads", () => {
  it("keeps build authority in the isolated data plane and observes one clock snapshot", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const scopeId = ScopeIdSchema.make("scope_index_build_pg");
      const indexDefinitionId = CatalogIndexDefinitionIdSchema.make(9876);
      const largeFence = 9_007_199_254_740_993n;
      await persistence.query(
        `
          insert into fx_system_scope_clock
            (
              scope_id,
              storage_generation,
              storage_generation_fence,
              last_commit_seq,
              last_outbox_seq,
              epoch
            )
          values ($1, 'flarexdb_v1', $2, $3, 0, 'epoch-pg')
        `,
        [scopeId, largeFence, largeFence],
      );
      await persistence.query(
        `
          insert into fx_system_index_build_state
            (
              scope_id,
              index_definition_id,
              storage_generation,
              storage_generation_fence,
              epoch,
              start_commit_seq,
              lifecycle,
              cursor_codec_version,
              backfill_cursor_row_id,
              attempt_fence
            )
          values ($1, $2, 'flarexdb_v1', $3, 'epoch-pg', $3,
            'backfilling', 1, decode(repeat('ab', 16), 'hex'), $4)
        `,
        [scopeId, indexDefinitionId, largeFence, largeFence + 1n],
      );

      const controlCounts = await persistence.query<{
        deployments: number;
        definitions: number;
      }>(`
        select
          (select count(*)::int from deployments) as deployments,
          (select count(*)::int from fx_control_index_definition) as definitions
      `);
      expect(controlCounts.rows).toEqual([{ deployments: 0, definitions: 0 }]);
      await expect(
        readFencedIndexBuildState(persistence.drizzle, {
          scopeId,
          indexDefinitionId,
        }),
      ).resolves.toMatchObject({
        status: "current",
        buildState: {
          storageGenerationFence: largeFence,
          startCommitSeq: largeFence,
          attemptFence: largeFence + 1n,
          backfillCursor: { afterRowId: "ab".repeat(16) },
        },
      });

      const writer = await persistence.pool.connect();
      let committed = false;
      try {
        await writer.query("begin");
        await writer.query(
          `
            update fx_system_scope_clock
            set storage_generation_fence = $2
            where scope_id = $1
          `,
          [scopeId, largeFence + 1n],
        );
        await expect(
          readFencedIndexBuildState(persistence.drizzle, {
            scopeId,
            indexDefinitionId,
          }),
        ).resolves.toMatchObject({ status: "current" });
        await writer.query("commit");
        committed = true;
      } finally {
        if (!committed) {
          await writer.query("rollback").catch(() => undefined);
        }
        writer.release();
      }
      await expect(
        readFencedIndexBuildState(persistence.drizzle, {
          scopeId,
          indexDefinitionId,
        }),
      ).resolves.toMatchObject({
        status: "stale",
        mismatches: ["storageGenerationFence"],
        currentAuthority: { storageGenerationFence: largeFence + 1n },
      });

      await expect(
        persistence.query(
          `delete from fx_system_scope_clock where scope_id = $1`,
          [scopeId],
        ),
      ).rejects.toThrow();

      const planner = await persistence.pool.connect();
      try {
        await planner.query("set enable_seqscan = off");
        const explained = await planner.query<{ "QUERY PLAN": unknown }>(
          `
            explain (format json)
            select clock.scope_id, build.index_definition_id
            from fx_system_scope_clock as clock
            left join fx_system_index_build_state as build
              on build.scope_id = clock.scope_id
             and build.index_definition_id = $2
            where clock.scope_id = $1
          `,
          [scopeId, indexDefinitionId],
        );
        const plan = JSON.stringify(explained.rows);
        expect(plan).toContain("fx_system_scope_clock_pkey");
        expect(plan).toContain(
          "fx_system_index_build_state_scope_id_index_definition_id_pk",
        );
      } finally {
        planner.release();
      }

      const schema = await persistence.query<{ schema_name: string }>(
        `select current_schema() as schema_name`,
      );
      expect(schema.rows[0]?.schema_name).not.toBe("public");
    });
  }, 30_000);
});
