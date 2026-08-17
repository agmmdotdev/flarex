import {
  CommitSeqSchema,
  decodeScopeUuidV1,
} from "flarex-protocol/storage-authority";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { FlarexPersistence } from "../src";
import * as persistenceRoot from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import {
  CommitFeedCorruptionErrorV1,
  CommitFeedCursorResetRequiredErrorV1,
  MAX_COMMIT_FEED_PAGE_APP_ROW_CHANGES_V1,
  MAX_COMMIT_FEED_PAGE_COMMITS_V1,
  createCommitFeedRepositoryV1,
  type CommitFeedCorruptionReasonV1,
  type CommitFeedQueryV1,
  type CommitFeedRepositoryV1,
} from "../src/commitFeed";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { runEffect } from "./effectTestRuntime";

const SCOPE_EMPTY = "91000000-0000-0000-0000-000000000001";
const SCOPE_GROUPS = "91000000-0000-0000-0000-000000000002";
const SCOPE_OTHER = "91000000-0000-0000-0000-000000000003";
const SCOPE_INTERIOR_GAP = "91000000-0000-0000-0000-000000000004";
const SCOPE_TAIL_GAP = "91000000-0000-0000-0000-000000000005";
const SCOPE_MISSING_CHILD = "91000000-0000-0000-0000-000000000006";
const SCOPE_EXTRA_CHILD = "91000000-0000-0000-0000-000000000007";
const SCOPE_ORDINAL_GAP = "91000000-0000-0000-0000-000000000008";
const SCOPE_HEADER_MISMATCH = "91000000-0000-0000-0000-000000000009";
const SCOPE_REVISION_MISMATCH = "91000000-0000-0000-0000-000000000010";
const SCOPE_FLOOR = "91000000-0000-0000-0000-000000000011";
const SCOPE_HEADER_LIMIT = "91000000-0000-0000-0000-000000000012";
const SCOPE_CHILD_LIMIT = "91000000-0000-0000-0000-000000000013";
const SCOPE_DETACHED = "91000000-0000-0000-0000-000000000014";

const EPOCH_A = "92000000-0000-0000-0000-000000000001";
const EPOCH_B = "92000000-0000-0000-0000-000000000002";

type SqlPersistence = Pick<FlarexPersistence, "query">;

describe("S08 package-private commit feed reader", () => {
  it("stays package-private and returns empty, one, and multiple complete groups in sequence order", async () => {
    type RootLeak = Extract<
      keyof typeof persistenceRoot,
      | "createCommitFeedRepositoryV1"
      | "CommitFeedRepositoryV1"
      | "fxSystemCommits"
      | "fxSystemCommitAppRowChanges"
    >;
    type MetadataQueryLeak = Extract<
      keyof FlarexMetadataDatabase["query"],
      "fxSystemCommits" | "fxSystemCommitAppRowChanges"
    >;
    type PGliteQueryLeak = Extract<
      keyof PGliteFlarexPersistence["drizzle"]["query"],
      "fxSystemCommits" | "fxSystemCommitAppRowChanges"
    >;
    type PostgresQueryLeak = Extract<
      keyof PostgresFlarexPersistence["drizzle"]["query"],
      "fxSystemCommits" | "fxSystemCommitAppRowChanges"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expectTypeOf<MetadataQueryLeak>().toEqualTypeOf<never>();
    expectTypeOf<PGliteQueryLeak>().toEqualTypeOf<never>();
    expectTypeOf<PostgresQueryLeak>().toEqualTypeOf<never>();
    expect("createCommitFeedRepositoryV1" in persistenceRoot).toBe(false);
    expect("fxSystemCommits" in persistenceRoot).toBe(false);
    expect("fxSystemCommitAppRowChanges" in persistenceRoot).toBe(false);
    expect("fxSystemCommits" in persistenceRoot.flarexSchema).toBe(false);
    expect(
      "fxSystemCommitAppRowChanges" in persistenceRoot.flarexSchema,
    ).toBe(false);

    const persistence = await migratedPGlite();
    expect("fxSystemCommits" in persistence.drizzle.query).toBe(false);
    expect(
      "fxSystemCommitAppRowChanges" in persistence.drizzle.query,
    ).toBe(false);
    await insertScope(persistence, SCOPE_EMPTY, EPOCH_A, 0n);
    await insertScope(persistence, SCOPE_GROUPS, EPOCH_B, 3n);
    await insertCommitGroup(persistence, {
      scopeUuid: SCOPE_GROUPS,
      epochUuid: EPOCH_A,
      commitSeq: 1n,
      changeCount: 0,
      committedAt: "2100-01-01T00:00:00.000Z",
      rowBase: 100n,
    });
    await insertCommitGroup(persistence, {
      scopeUuid: SCOPE_GROUPS,
      epochUuid: EPOCH_A,
      commitSeq: 2n,
      changeCount: 1,
      committedAt: "2000-01-01T00:00:00.000Z",
      rowBase: 200n,
    });
    await insertCommitGroup(persistence, {
      scopeUuid: SCOPE_GROUPS,
      epochUuid: EPOCH_B,
      commitSeq: 3n,
      changeCount: 2,
      committedAt: "1990-01-01T00:00:00.000Z",
      rowBase: 300n,
    });
    const repository = createCommitFeedRepositoryV1(persistence.drizzle);

    await expect(listAfter(repository, SCOPE_EMPTY, 0n)).resolves.toEqual({
      scopeUuid: decodeScopeUuidV1(SCOPE_EMPTY),
      exclusiveCommitSeq: 0n,
      observedLastCommitSeq: 0n,
      observedOldestAvailableCommitSeq: 0n,
      commits: [],
      continuation: {
        kind: "complete",
        observedLastCommitSeq: 0n,
      },
    });

    const page = await listAfter(repository, SCOPE_GROUPS, 0n);
    expect(page.commits.map(({ commitSeq }) => commitSeq)).toEqual([
      1n,
      2n,
      3n,
    ]);
    expect(page.commits.map(({ epochUuid }) => epochUuid)).toEqual([
      EPOCH_A,
      EPOCH_A,
      EPOCH_B,
    ]);
    expect(page.commits.map(({ committedAtMilliseconds }) =>
      committedAtMilliseconds
    )).toEqual([
      Date.parse("2100-01-01T00:00:00.000Z"),
      Date.parse("2000-01-01T00:00:00.000Z"),
      Date.parse("1990-01-01T00:00:00.000Z"),
    ]);
    expect(page.commits.map(({ appRowChanges }) => appRowChanges.length))
      .toEqual([0, 1, 2]);
    expect(page.continuation).toEqual({
      kind: "complete",
      observedLastCommitSeq: 3n,
    });
  });

  it("isolates scopes while retaining old-epoch revision provenance", async () => {
    const persistence = await migratedPGlite();
    await insertScope(persistence, SCOPE_GROUPS, EPOCH_B, 1n);
    await insertScope(persistence, SCOPE_OTHER, EPOCH_B, 1n);
    await insertCommitGroup(persistence, {
      scopeUuid: SCOPE_GROUPS,
      epochUuid: EPOCH_A,
      commitSeq: 1n,
      changeCount: 1,
      rowBase: 1_000n,
    });
    await insertCommitGroup(persistence, {
      scopeUuid: SCOPE_OTHER,
      epochUuid: EPOCH_B,
      commitSeq: 1n,
      changeCount: 1,
      rowBase: 2_000n,
    });
    const repository = createCommitFeedRepositoryV1(persistence.drizzle);

    const first = await listAfter(repository, SCOPE_GROUPS, 0n);
    const second = await listAfter(repository, SCOPE_OTHER, 0n);
    expect(first.scopeUuid).toBe(SCOPE_GROUPS);
    expect(first.commits).toHaveLength(1);
    expect(first.commits[0]?.epochUuid).toBe(EPOCH_A);
    expect(bytesToHex(first.commits[0]?.appRowChanges[0]?.rowId)).toBe(
      rowHex(1_000n),
    );
    expect(second.scopeUuid).toBe(SCOPE_OTHER);
    expect(second.commits).toHaveLength(1);
    expect(second.commits[0]?.epochUuid).toBe(EPOCH_B);
    expect(bytesToHex(second.commits[0]?.appRowChanges[0]?.rowId)).toBe(
      rowHex(2_000n),
    );
  });

  it("fails closed for interior and tail commit-header gaps", async () => {
    const persistence = await migratedPGlite();
    await insertScope(persistence, SCOPE_INTERIOR_GAP, EPOCH_A, 3n);
    await insertHeader(persistence, {
      scopeUuid: SCOPE_INTERIOR_GAP,
      epochUuid: EPOCH_A,
      commitSeq: 1n,
      changeCount: 0,
    });
    await insertHeader(persistence, {
      scopeUuid: SCOPE_INTERIOR_GAP,
      epochUuid: EPOCH_A,
      commitSeq: 3n,
      changeCount: 0,
    });
    await insertScope(persistence, SCOPE_TAIL_GAP, EPOCH_A, 3n);
    for (const commitSeq of [1n, 2n]) {
      await insertHeader(persistence, {
        scopeUuid: SCOPE_TAIL_GAP,
        epochUuid: EPOCH_A,
        commitSeq,
        changeCount: 0,
      });
    }
    const repository = createCommitFeedRepositoryV1(persistence.drizzle);

    await expectCorruption(
      listAfter(repository, SCOPE_INTERIOR_GAP, 0n),
      "commitHeaderGap",
    );
    await expectCorruption(
      listAfter(repository, SCOPE_TAIL_GAP, 0n),
      "commitHeaderMissingBeforeClock",
    );
  });

  it("rejects missing, extra, and noncontiguous child evidence", async () => {
    const persistence = await migratedPGlite();
    await insertScope(persistence, SCOPE_MISSING_CHILD, EPOCH_A, 1n);
    await insertHeader(persistence, {
      scopeUuid: SCOPE_MISSING_CHILD,
      epochUuid: EPOCH_A,
      commitSeq: 1n,
      changeCount: 1,
    });

    await insertScope(persistence, SCOPE_EXTRA_CHILD, EPOCH_A, 1n);
    await insertHeader(persistence, {
      scopeUuid: SCOPE_EXTRA_CHILD,
      epochUuid: EPOCH_A,
      commitSeq: 1n,
      changeCount: 0,
    });
    await insertRevision(persistence, {
      scopeUuid: SCOPE_EXTRA_CHILD,
      epochUuid: EPOCH_A,
      commitSeq: 1n,
      rowValue: 3_000n,
    });
    await insertChange(persistence, {
      scopeUuid: SCOPE_EXTRA_CHILD,
      epochUuid: EPOCH_A,
      commitSeq: 1n,
      ordinal: 0,
      rowValue: 3_000n,
    });

    await insertScope(persistence, SCOPE_ORDINAL_GAP, EPOCH_A, 1n);
    await insertHeader(persistence, {
      scopeUuid: SCOPE_ORDINAL_GAP,
      epochUuid: EPOCH_A,
      commitSeq: 1n,
      changeCount: 1,
    });
    await insertRevision(persistence, {
      scopeUuid: SCOPE_ORDINAL_GAP,
      epochUuid: EPOCH_A,
      commitSeq: 1n,
      rowValue: 4_000n,
    });
    await insertChange(persistence, {
      scopeUuid: SCOPE_ORDINAL_GAP,
      epochUuid: EPOCH_A,
      commitSeq: 1n,
      ordinal: 1,
      rowValue: 4_000n,
    });
    const repository = createCommitFeedRepositoryV1(persistence.drizzle);

    await expectCorruption(
      listAfter(repository, SCOPE_MISSING_CHILD, 0n),
      "appRowChangeCountMismatch",
    );
    await expectCorruption(
      listAfter(repository, SCOPE_EXTRA_CHILD, 0n),
      "appRowChangeCountMismatch",
    );
    await expectCorruption(
      listAfter(repository, SCOPE_ORDINAL_GAP, 0n),
      "appRowChangeOrdinalGap",
    );
  });

  it("strictly correlates each child with its header and same-epoch revision", async () => {
    const persistence = await migratedPGlite();
    await persistence.query(`
      alter table fx_system_commit_app_row_change
        drop constraint fx_system_commit_app_row_change_header_fk,
        drop constraint fx_system_commit_app_row_change_revision_fk
    `);

    await insertScope(persistence, SCOPE_HEADER_MISMATCH, EPOCH_A, 1n);
    await insertHeader(persistence, {
      scopeUuid: SCOPE_HEADER_MISMATCH,
      epochUuid: EPOCH_A,
      commitSeq: 1n,
      changeCount: 1,
    });
    await insertRevision(persistence, {
      scopeUuid: SCOPE_HEADER_MISMATCH,
      epochUuid: EPOCH_B,
      commitSeq: 1n,
      rowValue: 5_000n,
    });
    await insertChange(persistence, {
      scopeUuid: SCOPE_HEADER_MISMATCH,
      epochUuid: EPOCH_B,
      commitSeq: 1n,
      ordinal: 0,
      rowValue: 5_000n,
    });

    await insertScope(persistence, SCOPE_REVISION_MISMATCH, EPOCH_A, 1n);
    await insertHeader(persistence, {
      scopeUuid: SCOPE_REVISION_MISMATCH,
      epochUuid: EPOCH_A,
      commitSeq: 1n,
      changeCount: 1,
    });
    await insertRevision(persistence, {
      scopeUuid: SCOPE_REVISION_MISMATCH,
      epochUuid: EPOCH_B,
      commitSeq: 1n,
      rowValue: 6_000n,
    });
    await insertChange(persistence, {
      scopeUuid: SCOPE_REVISION_MISMATCH,
      epochUuid: EPOCH_A,
      commitSeq: 1n,
      ordinal: 0,
      rowValue: 6_000n,
    });
    const repository = createCommitFeedRepositoryV1(persistence.drizzle);

    await expectCorruption(
      listAfter(repository, SCOPE_HEADER_MISMATCH, 0n),
      "appRowChangeHeaderMismatch",
    );
    await expectCorruption(
      listAfter(repository, SCOPE_REVISION_MISMATCH, 0n),
      "appRowChangeRevisionMismatch",
    );
  });

  it("requires reset only before the retained floor and resumes at floor minus one", async () => {
    const persistence = await migratedPGlite();
    await insertScope(persistence, SCOPE_FLOOR, EPOCH_A, 3n);
    for (const commitSeq of [1n, 2n, 3n]) {
      await insertHeader(persistence, {
        scopeUuid: SCOPE_FLOOR,
        epochUuid: EPOCH_A,
        commitSeq,
        changeCount: 0,
      });
    }
    await persistence.query(
      `
        update fx_system_scope_clock
        set oldest_available_commit_seq = 2
        where scope_uuid = $1::uuid
      `,
      [SCOPE_FLOOR],
    );
    await persistence.query(
      `delete from fx_system_commit where scope_uuid = $1::uuid and commit_seq = 1`,
      [SCOPE_FLOOR],
    );
    const queries: Array<CommitFeedQueryV1> = [];
    const repository = createCommitFeedRepositoryV1(persistence.drizzle, {
      observeQuery: (query) => queries.push(query),
    });

    await expectResetRequired(
      listAfter(repository, SCOPE_FLOOR, 0n),
      {
        requestedExclusiveCommitSeq: 0n,
        restartExclusiveCommitSeq: 1n,
        observedOldestAvailableCommitSeq: 2n,
      },
    );
    expect(queries.map((query) => query.name)).toEqual(["clock"]);

    await expect(listAfter(repository, SCOPE_FLOOR, 1n)).resolves.toMatchObject({
      observedOldestAvailableCommitSeq: 2n,
      commits: [{ commitSeq: 2n }, { commitSeq: 3n }],
      continuation: { kind: "complete", observedLastCommitSeq: 3n },
    });
    await expect(listAfter(repository, SCOPE_FLOOR, 2n)).resolves.toMatchObject({
      commits: [{ commitSeq: 3n }],
    });
    await expect(listAfter(repository, SCOPE_FLOOR, 3n)).resolves.toMatchObject({
      commits: [],
      continuation: { kind: "complete", observedLastCommitSeq: 3n },
    });
  });

  it("returns exactly 100 whole commit groups before an explicit continuation", async () => {
    const persistence = await migratedPGlite();
    await insertScope(persistence, SCOPE_HEADER_LIMIT, EPOCH_A, 101n);
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
      [SCOPE_HEADER_LIMIT, EPOCH_A],
    );
    const repository = createCommitFeedRepositoryV1(persistence.drizzle);

    const first = await listAfter(repository, SCOPE_HEADER_LIMIT, 0n);
    expect(first.commits).toHaveLength(MAX_COMMIT_FEED_PAGE_COMMITS_V1);
    expect(first.commits[0]?.commitSeq).toBe(1n);
    expect(first.commits.at(-1)?.commitSeq).toBe(100n);
    expect(first.continuation).toEqual({
      kind: "more",
      nextExclusiveCommitSeq: 100n,
      observedLastCommitSeq: 101n,
    });

    const second = await listAfter(repository, SCOPE_HEADER_LIMIT, 100n);
    expect(second.commits.map(({ commitSeq }) => commitSeq)).toEqual([101n]);
    expect(second.continuation).toEqual({
      kind: "complete",
      observedLastCommitSeq: 101n,
    });
  });

  it("returns an exact 16,000-child commit without splitting and bounds every query", async () => {
    const persistence = await migratedPGlite();
    await insertScope(persistence, SCOPE_CHILD_LIMIT, EPOCH_A, 2n);
    await insertCommitGroup(persistence, {
      scopeUuid: SCOPE_CHILD_LIMIT,
      epochUuid: EPOCH_A,
      commitSeq: 1n,
      changeCount: MAX_COMMIT_FEED_PAGE_APP_ROW_CHANGES_V1,
      rowBase: 10_000n,
    });
    await insertCommitGroup(persistence, {
      scopeUuid: SCOPE_CHILD_LIMIT,
      epochUuid: EPOCH_A,
      commitSeq: 2n,
      changeCount: 1,
      rowBase: 30_000n,
    });
    const queries = new Map<CommitFeedQueryV1["name"], CommitFeedQueryV1>();
    const repository = createCommitFeedRepositoryV1(persistence.drizzle, {
      observeQuery: (query) => queries.set(query.name, query),
    });

    const first = await listAfter(repository, SCOPE_CHILD_LIMIT, 0n);
    expect(first.commits).toHaveLength(1);
    expect(first.commits[0]?.commitSeq).toBe(1n);
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
    for (const query of queries.values()) {
      expect(query.sql.toLowerCase()).toContain("limit");
      const explained = await persistence.query<Record<string, unknown>>(
        `explain ${query.sql}`,
        query.params,
      );
      expect(explained.rows.length).toBeGreaterThan(0);
    }

    const second = await listAfter(repository, SCOPE_CHILD_LIMIT, 1n);
    expect(second.commits).toHaveLength(1);
    expect(second.commits[0]?.commitSeq).toBe(2n);
    expect(second.commits[0]?.appRowChanges).toHaveLength(1);
    expect(second.continuation.kind).toBe("complete");
  }, 30_000);

  it("closes repeatable read before materialization and detaches row bytes", async () => {
    const persistence = await migratedPGlite();
    await insertScope(persistence, SCOPE_DETACHED, EPOCH_A, 1n);
    await insertCommitGroup(persistence, {
      scopeUuid: SCOPE_DETACHED,
      epochUuid: EPOCH_A,
      commitSeq: 1n,
      changeCount: 1,
      rowBase: 40_000n,
    });
    await insertRevision(persistence, {
      scopeUuid: SCOPE_DETACHED,
      epochUuid: EPOCH_A,
      commitSeq: 1n,
      rowValue: 40_001n,
    });
    let transactionClosed = false;
    const repository = createCommitFeedRepositoryV1(persistence.drizzle, {
      afterRepeatableRead: async () => {
        await persistence.query(
          `
            update fx_system_commit_app_row_change
            set row_id = decode($4, 'hex')
            where scope_uuid = $1::uuid
              and epoch_uuid = $2::uuid
              and commit_seq = $3
          `,
          [SCOPE_DETACHED, EPOCH_A, "1", rowHex(40_001n)],
        );
        transactionClosed = true;
      },
    });

    const captured = await listAfter(repository, SCOPE_DETACHED, 0n);
    expect(transactionClosed).toBe(true);
    const capturedRowId = captured.commits[0]?.appRowChanges[0]?.rowId;
    expect(bytesToHex(capturedRowId)).toBe(rowHex(40_000n));
    capturedRowId?.fill(0);

    const reloaded = await listAfter(
      createCommitFeedRepositoryV1(persistence.drizzle),
      SCOPE_DETACHED,
      0n,
    );
    expect(bytesToHex(reloaded.commits[0]?.appRowChanges[0]?.rowId)).toBe(
      rowHex(40_001n),
    );
  });
});

async function migratedPGlite(): Promise<PGliteFlarexPersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  return persistence;
}

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

async function expectResetRequired(
  result: Promise<unknown>,
  expected: Readonly<{
    requestedExclusiveCommitSeq: bigint;
    restartExclusiveCommitSeq: bigint;
    observedOldestAvailableCommitSeq: bigint;
  }>,
): Promise<void> {
  await expect(result).rejects.toBeInstanceOf(
    CommitFeedCursorResetRequiredErrorV1,
  );
  await expect(result).rejects.toMatchObject(expected);
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
  readonly committedAt?: string;
}

async function insertCommitGroup(
  persistence: SqlPersistence,
  input: CommitGroupFixture,
): Promise<void> {
  await insertHeader(persistence, input);
  if (input.changeCount === 0) return;
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
        (scope_uuid, epoch_uuid, commit_seq, change_count, committed_at)
      values ($1::uuid, $2::uuid, $3, $4, coalesce($5::timestamptz, now()))
    `,
    [
      input.scopeUuid,
      input.epochUuid,
      input.commitSeq.toString(),
      input.changeCount,
      input.committedAt ?? null,
    ],
  );
}

interface RevisionFixture {
  readonly scopeUuid: string;
  readonly epochUuid: string;
  readonly commitSeq: bigint;
  readonly rowValue: bigint;
}

async function insertRevision(
  persistence: SqlPersistence,
  input: RevisionFixture,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_app_row_rev
        (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
         write_epoch_uuid, schema_version_id, creation_time,
         value_codec_version, is_tombstone)
      values
        ($1::uuid, 1, decode($4, 'hex'), $2, null,
         $3::uuid, 'schema_s08_reader_v1', 1, 1, true)
    `,
    [
      input.scopeUuid,
      input.commitSeq.toString(),
      input.epochUuid,
      rowHex(input.rowValue),
    ],
  );
}

interface ChangeFixture extends RevisionFixture {
  readonly ordinal: number;
}

async function insertChange(
  persistence: SqlPersistence,
  input: ChangeFixture,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_commit_app_row_change
        (scope_uuid, epoch_uuid, commit_seq, change_ordinal, table_id, row_id)
      values ($1::uuid, $2::uuid, $3, $4, 1, decode($5, 'hex'))
    `,
    [
      input.scopeUuid,
      input.epochUuid,
      input.commitSeq.toString(),
      input.ordinal,
      rowHex(input.rowValue),
    ],
  );
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

function rowHex(value: bigint): string {
  return value.toString(16).padStart(32, "0");
}

function bytesToHex(value: Uint8Array | undefined): string | undefined {
  if (value === undefined) return undefined;
  return [...value]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
