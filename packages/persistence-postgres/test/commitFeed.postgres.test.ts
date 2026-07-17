import { Effect, Fiber } from "effect";
import {
  CommitSeqSchema,
  decodeScopeUuidV1,
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import type { FlarexPersistence } from "../src";
import {
  CommitFeedCorruptionErrorV1,
  MAX_COMMIT_FEED_PAGE_APP_ROW_CHANGES_V1,
  MAX_COMMIT_FEED_PAGE_COMMITS_V1,
  createCommitFeedRepositoryV1,
  type CommitFeedCorruptionReasonV1,
  type CommitFeedQueryV1,
  type CommitFeedRepositoryV1,
} from "../src/commitFeed";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import { runEffect } from "./effectTestRuntime";

const SCOPE_SNAPSHOT = "a1000000-0000-0000-0000-000000000001";
const SCOPE_FLOOR = "a1000000-0000-0000-0000-000000000002";
const SCOPE_TAIL = "a1000000-0000-0000-0000-000000000003";
const SCOPE_COUNT = "a1000000-0000-0000-0000-000000000004";
const SCOPE_CONSTRAINTS = "a1000000-0000-0000-0000-000000000005";
const SCOPE_HEADERS = "a1000000-0000-0000-0000-000000000006";
const SCOPE_ISOLATED = "a1000000-0000-0000-0000-000000000007";
const SCOPE_CHILDREN = "a1000000-0000-0000-0000-000000000008";

const EPOCH_A = "a2000000-0000-0000-0000-000000000001";
const EPOCH_B = "a2000000-0000-0000-0000-000000000002";

const describePostgres = postgresUrl === null ? describe.skip : describe;
type SqlPersistence = Pick<FlarexPersistence, "query">;

describePostgres("real Postgres S08 commit feed reader", () => {
  it("captures clock and headers in one repeatable-read snapshot and closes SQL before materialization", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertScope(persistence, SCOPE_SNAPSHOT, EPOCH_A, 1n);
      await insertHeader(persistence, {
        scopeUuid: SCOPE_SNAPSHOT,
        epochUuid: EPOCH_A,
        commitSeq: 1n,
        changeCount: 0,
      });

      const writer = await persistence.pool.connect();
      const headerQueryStarted = deferredSignal();
      let transactionClosed = false;
      try {
        await writer.query("begin");
        await writer.query(
          "lock table fx_system_commit in access exclusive mode",
        );
        const repository = createCommitFeedRepositoryV1(persistence.drizzle, {
          observeQuery: (query) => {
            if (query.name === "headers") headerQueryStarted.resolve();
          },
          afterRepeatableRead: () => {
            transactionClosed = true;
          },
        });
        const capturedPromise = listAfter(repository, SCOPE_SNAPSHOT, 0n);
        await headerQueryStarted.promise;

        await writer.query(
          `
            insert into fx_system_commit
              (scope_uuid, epoch_uuid, commit_seq, change_count)
            values ($1::uuid, $2::uuid, 2, 0)
          `,
          [SCOPE_SNAPSHOT, EPOCH_A],
        );
        await writer.query(
          `
            update fx_system_scope_clock
            set last_commit_seq = 2
            where scope_uuid = $1::uuid
          `,
          [SCOPE_SNAPSHOT],
        );
        await writer.query("commit");

        const captured = await capturedPromise;
        expect(transactionClosed).toBe(true);
        expect(captured.observedLastCommitSeq).toBe(1n);
        expect(captured.commits.map(({ commitSeq }) => commitSeq)).toEqual([
          1n,
        ]);
        expect(captured.continuation).toEqual({
          kind: "complete",
          observedLastCommitSeq: 1n,
        });

        const next = await listAfter(
          createCommitFeedRepositoryV1(persistence.drizzle),
          SCOPE_SNAPSHOT,
          1n,
        );
        expect(next.commits.map(({ commitSeq }) => commitSeq)).toEqual([2n]);
        expect(next.observedLastCommitSeq).toBe(2n);
      } finally {
        await writer.query("rollback").catch(() => undefined);
        writer.release();
      }
    });
  }, 30_000);

  it("does not observe interruption until a blocked transaction Promise has settled", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertScope(persistence, SCOPE_SNAPSHOT, EPOCH_A, 1n);
      await insertHeader(persistence, {
        scopeUuid: SCOPE_SNAPSHOT,
        epochUuid: EPOCH_A,
        commitSeq: 1n,
        changeCount: 0,
      });

      const blocker = await persistence.pool.connect();
      const headerQueryStarted = deferredSignal();
      let afterRepeatableRead = false;
      let interruptionSettled = false;
      try {
        await blocker.query("begin");
        await blocker.query(
          "lock table fx_system_commit in access exclusive mode",
        );
        const repository = createCommitFeedRepositoryV1(persistence.drizzle, {
          observeQuery: (query) => {
            if (query.name === "headers") headerQueryStarted.resolve();
          },
          afterRepeatableRead: () => {
            afterRepeatableRead = true;
          },
        });
        const fiber = Effect.runFork(repository.listAfter({
          scopeUuid: decodeScopeUuidV1(SCOPE_SNAPSHOT),
          exclusiveCommitSeq: CommitSeqSchema.make(0n),
        }));
        await headerQueryStarted.promise;

        const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
          interruptionSettled = true;
          return exit;
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        expect(interruptionSettled).toBe(false);
        expect(afterRepeatableRead).toBe(false);

        await blocker.query("commit");
        await interruption;
        expect(interruptionSettled).toBe(true);
        expect(afterRepeatableRead).toBe(false);

        const closureProbe = await persistence.pool.connect();
        try {
          await closureProbe.query("begin");
          await closureProbe.query("set local lock_timeout = '1s'");
          await expect(
            closureProbe.query(
              "lock table fx_system_commit in access exclusive mode",
            ),
          ).resolves.toBeDefined();
          await closureProbe.query("rollback");
        } finally {
          await closureProbe.query("rollback").catch(() => undefined);
          closureProbe.release();
        }
      } finally {
        await blocker.query("rollback").catch(() => undefined);
        blocker.release();
      }
    });
  }, 30_000);

  it("fails closed on an active floor, missing tail, child-count mismatch, and invalid physical provenance", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertScope(persistence, SCOPE_FLOOR, EPOCH_A, 1n);
      await insertHeader(persistence, {
        scopeUuid: SCOPE_FLOOR,
        epochUuid: EPOCH_A,
        commitSeq: 1n,
        changeCount: 0,
      });
      await persistence.query(
        `
          update fx_system_scope_clock
          set oldest_available_commit_seq = 1
          where scope_uuid = $1::uuid
        `,
        [SCOPE_FLOOR],
      );

      await insertScope(persistence, SCOPE_TAIL, EPOCH_A, 2n);
      await insertHeader(persistence, {
        scopeUuid: SCOPE_TAIL,
        epochUuid: EPOCH_A,
        commitSeq: 1n,
        changeCount: 0,
      });

      await insertScope(persistence, SCOPE_COUNT, EPOCH_A, 1n);
      await insertHeader(persistence, {
        scopeUuid: SCOPE_COUNT,
        epochUuid: EPOCH_A,
        commitSeq: 1n,
        changeCount: 1,
      });

      await insertScope(persistence, SCOPE_CONSTRAINTS, EPOCH_A, 1n);
      await insertRevision(persistence, {
        scopeUuid: SCOPE_CONSTRAINTS,
        epochUuid: EPOCH_A,
        commitSeq: 1n,
        rowBase: 1_000n,
        changeCount: 1,
      });
      await insertHeader(persistence, {
        scopeUuid: SCOPE_CONSTRAINTS,
        epochUuid: EPOCH_B,
        commitSeq: 1n,
        changeCount: 1,
      });
      await expect(
        insertChange(persistence, {
          scopeUuid: SCOPE_CONSTRAINTS,
          epochUuid: EPOCH_B,
          commitSeq: 1n,
          rowBase: 1_000n,
          changeCount: 1,
        }),
      ).rejects.toThrow();

      await persistence.query(
        `
          update fx_system_commit
          set epoch_uuid = $2::uuid
          where scope_uuid = $1::uuid and commit_seq = 1
        `,
        [SCOPE_CONSTRAINTS, EPOCH_A],
      );
      await insertChange(persistence, {
        scopeUuid: SCOPE_CONSTRAINTS,
        epochUuid: EPOCH_A,
        commitSeq: 1n,
        rowBase: 1_000n,
        changeCount: 1,
      });
      await expect(
        persistence.query(
          `
            insert into fx_system_commit_app_row_change
              (scope_uuid, epoch_uuid, commit_seq, change_ordinal,
               table_id, row_id)
            values ($1::uuid, $2::uuid, 1, 1, 1, decode($3, 'hex'))
          `,
          [SCOPE_CONSTRAINTS, EPOCH_A, rowHex(1_000n)],
        ),
      ).rejects.toThrow();

      const repository = createCommitFeedRepositoryV1(persistence.drizzle);
      await expectCorruption(
        listAfter(repository, SCOPE_FLOOR, 0n),
        "retainedFloorActivated",
      );
      await expectCorruption(
        listAfter(repository, SCOPE_TAIL, 0n),
        "commitHeaderMissingBeforeClock",
      );
      await expectCorruption(
        listAfter(repository, SCOPE_COUNT, 0n),
        "appRowChangeCountMismatch",
      );
      await expect(listAfter(repository, SCOPE_CONSTRAINTS, 0n)).resolves
        .toMatchObject({ commits: [{ commitSeq: 1n }] });
    });
  }, 30_000);

  it("orders by commit sequence, isolates scopes, and continues after 100 whole headers", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertScope(persistence, SCOPE_HEADERS, EPOCH_A, 101n);
      await persistence.query(
        `
          insert into fx_system_commit
            (scope_uuid, epoch_uuid, commit_seq, change_count, committed_at)
          select
            $1::uuid,
            $2::uuid,
            generated_id,
            0,
            timestamptz '2100-01-01 00:00:00+00'
              - generated_id * interval '1 second'
          from generate_series(1, 101) as generated_id
        `,
        [SCOPE_HEADERS, EPOCH_A],
      );
      await insertScope(persistence, SCOPE_ISOLATED, EPOCH_B, 1n);
      await insertHeader(persistence, {
        scopeUuid: SCOPE_ISOLATED,
        epochUuid: EPOCH_B,
        commitSeq: 1n,
        changeCount: 0,
      });
      const repository = createCommitFeedRepositoryV1(persistence.drizzle);

      const first = await listAfter(repository, SCOPE_HEADERS, 0n);
      expect(first.commits).toHaveLength(MAX_COMMIT_FEED_PAGE_COMMITS_V1);
      expect(first.commits[0]?.commitSeq).toBe(1n);
      expect(first.commits.at(-1)?.commitSeq).toBe(100n);
      expect(first.commits[0]?.committedAtMilliseconds)
        .toBeGreaterThan(first.commits.at(-1)?.committedAtMilliseconds ?? 0);
      expect(first.continuation).toEqual({
        kind: "more",
        nextExclusiveCommitSeq: 100n,
        observedLastCommitSeq: 101n,
      });

      const isolated = await listAfter(repository, SCOPE_ISOLATED, 0n);
      expect(isolated.scopeUuid).toBe(SCOPE_ISOLATED);
      expect(isolated.commits.map(({ commitSeq }) => commitSeq)).toEqual([1n]);
      const second = await listAfter(repository, SCOPE_HEADERS, 100n);
      expect(second.commits.map(({ commitSeq }) => commitSeq)).toEqual([
        101n,
      ]);
      expect(second.continuation.kind).toBe("complete");
    });
  }, 30_000);

  it("keeps a 16,000-child group whole and uses bounded index-backed query plans", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertScope(persistence, SCOPE_CHILDREN, EPOCH_A, 2n);
      await insertCommitGroup(persistence, {
        scopeUuid: SCOPE_CHILDREN,
        epochUuid: EPOCH_A,
        commitSeq: 1n,
        changeCount: MAX_COMMIT_FEED_PAGE_APP_ROW_CHANGES_V1,
        rowBase: 10_000n,
      });
      await insertCommitGroup(persistence, {
        scopeUuid: SCOPE_CHILDREN,
        epochUuid: EPOCH_A,
        commitSeq: 2n,
        changeCount: 1,
        rowBase: 30_000n,
      });
      const queries = new Map<
        CommitFeedQueryV1["name"],
        CommitFeedQueryV1
      >();
      const repository = createCommitFeedRepositoryV1(persistence.drizzle, {
        observeQuery: (query) => queries.set(query.name, query),
      });

      const first = await listAfter(repository, SCOPE_CHILDREN, 0n);
      expect(first.commits).toHaveLength(1);
      expect(first.commits[0]?.appRowChanges).toHaveLength(
        MAX_COMMIT_FEED_PAGE_APP_ROW_CHANGES_V1,
      );
      expect(first.continuation).toEqual({
        kind: "more",
        nextExclusiveCommitSeq: 1n,
        observedLastCommitSeq: 2n,
      });
      expect(requireQuery(queries, "clock").params.at(-1)).toBe(2);
      expect(requireQuery(queries, "headers").params.at(-1)).toBe(
        MAX_COMMIT_FEED_PAGE_COMMITS_V1 + 1,
      );
      expect(requireQuery(queries, "appRowChanges").params.at(-1)).toBe(
        MAX_COMMIT_FEED_PAGE_APP_ROW_CHANGES_V1 + 1,
      );

      const plans = await explainPlans(persistence, queries);
      expect(plans.clock).toContain(
        "fx_system_scope_clock_scope_uuid_unique",
      );
      expect(plans.headers).toContain(
        "fx_system_commit_scope_uuid_commit_seq_pk",
      );
      // PostgreSQL truncates this generated primary-key name to 63 bytes.
      expect(plans.appRowChanges).toContain(
        "fx_system_commit_app_row_change_scope_uuid_commit_seq_change_or",
      );
      expect(plans.appRowChanges).toMatch(
        /fx_app_row_rev_(?:change_provenance_unique|scope_uuid_table_id_row_id_commit_seq_pk)/,
      );

      const second = await listAfter(repository, SCOPE_CHILDREN, 1n);
      expect(second.commits).toHaveLength(1);
      expect(second.commits[0]?.appRowChanges).toHaveLength(1);
      expect(second.continuation.kind).toBe("complete");
    });
  }, 60_000);
});

function listAfter(
  repository: CommitFeedRepositoryV1,
  scopeUuid: string,
  exclusiveCommitSeq: bigint,
) {
  return runEffect(repository.listAfter({
    scopeUuid: decodeScopeUuidV1(scopeUuid),
    exclusiveCommitSeq: CommitSeqSchema.make(exclusiveCommitSeq),
  }));
}

async function expectCorruption(
  result: Promise<unknown>,
  reason: CommitFeedCorruptionReasonV1,
): Promise<void> {
  await expect(result).rejects.toBeInstanceOf(CommitFeedCorruptionErrorV1);
  await expect(result).rejects.toMatchObject({ reason });
}

async function insertScope(
  persistence: SqlPersistence,
  scopeUuid: string,
  epochUuid: string,
  lastCommitSeq: bigint,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_scope_clock
        (scope_id, storage_generation, last_commit_seq, epoch)
      values ($1, 'flarexdb_v1', $2, $3)
    `,
    [
      `scope_${scopeUuid}`,
      lastCommitSeq.toString(),
      `epoch_${epochUuid}`,
    ],
  );
}

interface CommitGroupFixture {
  readonly scopeUuid: string;
  readonly epochUuid: string;
  readonly commitSeq: bigint;
  readonly changeCount: number;
  readonly rowBase: bigint;
}

async function insertCommitGroup(
  persistence: SqlPersistence,
  input: CommitGroupFixture,
): Promise<void> {
  await insertHeader(persistence, input);
  if (input.changeCount === 0) return;
  await insertRevision(persistence, input);
  await insertChange(persistence, input);
}

async function insertRevision(
  persistence: SqlPersistence,
  input: CommitGroupFixture,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_app_row_rev
        (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
         write_epoch_uuid, schema_version_id, creation_time,
         value_codec_version, is_tombstone)
      select
        $1::uuid,
        1,
        decode(lpad(to_hex($5::bigint + generated_id), 32, '0'), 'hex'),
        $2,
        null,
        $3::uuid,
        'schema_s08_reader_v1',
        1,
        1,
        true
      from generate_series(0, $4::integer - 1) as generated_id
    `,
    [
      input.scopeUuid,
      input.commitSeq.toString(),
      input.epochUuid,
      input.changeCount,
      input.rowBase.toString(),
    ],
  );
}

async function insertChange(
  persistence: SqlPersistence,
  input: CommitGroupFixture,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_commit_app_row_change
        (scope_uuid, epoch_uuid, commit_seq, change_ordinal, table_id, row_id)
      select
        $1::uuid,
        $3::uuid,
        $2,
        generated_id,
        1,
        decode(lpad(to_hex($5::bigint + generated_id), 32, '0'), 'hex')
      from generate_series(0, $4::integer - 1) as generated_id
    `,
    [
      input.scopeUuid,
      input.commitSeq.toString(),
      input.epochUuid,
      input.changeCount,
      input.rowBase.toString(),
    ],
  );
}

async function insertHeader(
  persistence: SqlPersistence,
  input: Omit<CommitGroupFixture, "rowBase">,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_commit
        (scope_uuid, epoch_uuid, commit_seq, change_count)
      values ($1::uuid, $2::uuid, $3, $4)
    `,
    [
      input.scopeUuid,
      input.epochUuid,
      input.commitSeq.toString(),
      input.changeCount,
    ],
  );
}

async function explainPlans(
  persistence: PostgresFlarexPersistence,
  queries: ReadonlyMap<CommitFeedQueryV1["name"], CommitFeedQueryV1>,
): Promise<Readonly<Record<CommitFeedQueryV1["name"], string>>> {
  const client = await persistence.pool.connect();
  try {
    await client.query("set enable_seqscan = off");
    return Object.freeze({
      clock: await explainObserved(client, requireQuery(queries, "clock")),
      headers: await explainObserved(
        client,
        requireQuery(queries, "headers"),
      ),
      appRowChanges: await explainObserved(
        client,
        requireQuery(queries, "appRowChanges"),
      ),
    });
  } finally {
    client.release();
  }
}

async function explainObserved(
  client: {
    readonly query: (
      text: string,
      values?: ReadonlyArray<unknown>,
    ) => Promise<{ readonly rows: ReadonlyArray<Record<string, unknown>> }>;
  },
  query: CommitFeedQueryV1,
): Promise<string> {
  const result = await client.query(
    `explain (format json) ${query.sql}`,
    [...query.params],
  );
  return JSON.stringify(result.rows);
}

function requireQuery(
  queries: ReadonlyMap<CommitFeedQueryV1["name"], CommitFeedQueryV1>,
  name: CommitFeedQueryV1["name"],
): CommitFeedQueryV1 {
  const query = queries.get(name);
  if (query === undefined) {
    throw new Error(`Commit feed did not execute its ${name} query.`);
  }
  return query;
}

function deferredSignal(): Readonly<{
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}> {
  let resolver: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return Object.freeze({
    promise,
    resolve: () => resolver?.(),
  });
}

function rowHex(value: bigint): string {
  return value.toString(16).padStart(32, "0");
}
