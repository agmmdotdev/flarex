import { durableCounts } from "../../support/applicationNativeMutationHarness";
import { sql } from "drizzle-orm";
import { Effect, Exit, Schema, Scope } from "effect";
import { decodeAppDocumentIdV1, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { openApplicationQuerySnapshot, readApplicationQueryPoint, revalidateApplicationQuerySnapshot } from
  "@flarex/persistence-postgres/internal/application-query-snapshot";
import { ScopeExecutionLive } from "@flarex/persistence-postgres/internal/scope-execution";
import { RUN_LOCATED_READ_COMMITTED_V1, type RunLocatedReadCommittedTransactionV1 } from
  "@flarex/persistence-postgres/internal/system-test/session-kernel";
import {
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { describe, expect, it } from "vitest";

import { APPLICATION_NATIVE_QUERY_FIXTURE_OPTIONS } from
  "../../support/applicationNativeQueryHarness";
import { defineApplicationNativeQueryContract } from
  "../contracts/applicationNativeQueryContract";
import {
  expectOrdinaryPostgres18,
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("Application-native query PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting AA-R7.",
    ).not.toBeNull();
  });
});

describePostgres("Application-native Standard query - PostgreSQL", () => {
  defineApplicationNativeQueryContract({
    runScenario: scenario => withTemporarySplitPostgresPersistence(
      persistence => scenario(() =>
        createApplicationNativeMutationPostgresFixture(
          APPLICATION_NATIVE_QUERY_FIXTURE_OPTIONS,
          persistence,
        )
      ),
    ),
  });
  it("pins reads through a blocked writer, enforces the retained floor and releases clients", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expectOrdinaryPostgres18(persistence.target);
      const fixture = await createApplicationNativeMutationPostgresFixture(
        APPLICATION_NATIVE_QUERY_FIXTURE_OPTIONS, persistence,
      );
      const seeded = await fixture.seedUserDocument("Ada");
      const scope = await Effect.runPromise(Scope.make());
      let readerPid: number | undefined;
      let releaseRead!: () => void;
      const release = new Promise<void>(resolve => { releaseRead = resolve; });
      const resolveTarget = fixture.authorityPorts.scopeClockTargets.resolve;
      let pauseNext = false;
      let pending: Promise<unknown>[] = [];
      const context = {
        deploymentId: fixture.deploymentId,
        controlDb: fixture.control.drizzle,
        schema: fixture.schema,
        developerIndexes: fixture.developerIndexes,
        authority: {
          ...fixture.authorityPorts,
          scopeClockTargets: { resolve: async (...args: Parameters<typeof resolveTarget>) => {
            const target = await resolveTarget(...args);
            const run: RunLocatedReadCommittedTransactionV1 = work => target[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
              const result = await work(tx);
              if (pauseNext) {
                pauseNext = false;
                const result = Schema.decodeUnknownSync(Schema.Struct({
                  rows: Schema.Array(Schema.Struct({ pid: Schema.Number })),
                }))(await tx.execute(sql`select pg_backend_pid() as pid`));
                readerPid = result.rows[0]?.pid;
                await release;
              }
              return result;
            });
            return { ...target, [RUN_LOCATED_READ_COMMITTED_V1]: run };
          } },
        },
      };
      const budget = { maximumPointReads: 16, maximumIndexReads: 16, maximumDocuments: 64, maximumSemanticBytes: 1_048_576 };
      const open = () => Effect.runPromise(openApplicationQuerySnapshot(
        fixture.active.selection, "users:get", budget, context,
      ).pipe(Scope.provide(scope), Effect.provide(ScopeExecutionLive)));
      try {
        const opened = await open();
        pauseNext = true;
        const read = Effect.runPromise(readApplicationQueryPoint(opened.snapshot, "users", decodeAppDocumentIdV1(seeded.documentId)));
        pending = [read];
        void Promise.allSettled(pending);
        const rowId = decodeAppRowIdHexV1("22".repeat(16));
        await expect.poll(() => readerPid, { timeout: 10_000 }).toBeTypeOf("number");
        const writer = fixture.seedUserDocument("Grace", { rowId });
        pending = [read, writer];
        const settled = Promise.allSettled(pending);
        await expect.poll(async () => (await persistence.target.query<{ blocked: boolean }>(`
          select exists(select 1 from pg_stat_activity
            where $1::int = any(pg_blocking_pids(pid))) as blocked
        `, [readerPid])).rows[0]?.blocked, { timeout: 10_000 }).toBe(true);
        releaseRead();
        await settled;
        expect(await read).toMatchObject({ kind: "present" });
        const written = await writer;
        const afterWriter = await durableCounts(fixture.target);
        expect(await Effect.runPromise(readApplicationQueryPoint(opened.snapshot, "users", decodeAppDocumentIdV1(written.documentId)))).toEqual({ kind: "missing" });
        const fresh = await open();
        expect(await Effect.runPromise(readApplicationQueryPoint(fresh.snapshot, "users", decodeAppDocumentIdV1(written.documentId)))).toMatchObject({ kind: "present" });
        await persistence.target.query(`update fx_system_scope_execution_authority
          set oldest_available_commit_seq = 2 where scope_id = $1`, [fixture.active.basis.authority.scopeId]);
        await expect(Effect.runPromise(revalidateApplicationQuerySnapshot(fresh.snapshot))).resolves.toMatchObject({ snapshotToken: { commitSeq: 2n } });
        await expect(Effect.runPromise(revalidateApplicationQuerySnapshot(opened.snapshot))).rejects.toMatchObject({ reason: "historyUnavailable" });
        expect(await durableCounts(fixture.target)).toEqual(afterWriter);
      } finally {
        releaseRead();
        await Promise.allSettled(pending);
        await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
      }
      expect(persistence.target.pool.waitingCount).toBe(0);
      expect(persistence.target.pool.idleCount).toBe(persistence.target.pool.totalCount);
    });
  }, 120_000);

});
