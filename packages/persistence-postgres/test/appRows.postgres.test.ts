import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appRowIdHexV1ToBytes,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  SnapshotTokenSchema,
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  AppRowRevisionChainConflictError,
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
  getAppRowAtSnapshotInTransactionEffect,
  readAppRowAtSnapshotInTransactionEffect,
  readCurrentAppRowInTransactionEffect,
  type AppRowValueEvidenceV1,
} from "../src/appRows";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import { runEffect } from "./effectTestRuntime";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const scopeId = ScopeIdSchema.make(
  "scope_51000000-0000-0000-0000-000000000001",
);
const firstEpoch = ScopeEpochSchema.make(
  "epoch_51000000-0000-0000-0000-000000000002",
);
const secondEpoch = ScopeEpochSchema.make(
  "epoch_51000000-0000-0000-0000-000000000003",
);
const tableId = decodeCatalogTableId(1);
const rowId = decodeAppRowIdHexV1("51000000000000000000000000000004");
const schemaVersionId = decodeCatalogSchemaVersionId("schema_rows_postgres_v1");
const creationTime = decodeAppCreationTimeV1(1_725_000_000_000.5);
const firstCommitSeq = CommitSeqSchema.make(9_007_199_254_740_993n);
const secondCommitSeq = CommitSeqSchema.make(firstCommitSeq + 2n);

describePostgres("real Postgres FlarexDB app-row storage", () => {
  it("proves exact history, rollback, epoch independence, and indexed lookup", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await persistence.query(
        `insert into fx_system_scope_clock
           (scope_id, storage_generation, last_commit_seq, epoch)
         values ($1, 'flarexdb_v1', $2, $3)`,
        [scopeId, secondCommitSeq, firstEpoch],
      );
      const first = await canonicalizeAppDocumentV1({
        tableId,
        rowId,
        creationTime,
        fields: {
          title: "postgres\u0000row",
          count: 9_007_199_254_740_993n,
          bytes: new Uint8Array([0, 127, 255]).buffer,
        },
      });
      const second = await canonicalizeAppDocumentV1({
        tableId,
        rowId,
        creationTime,
        fields: { title: "updated", count: 2n },
      });

      await append(persistence, {
        kind: "live",
        scopeId,
        tableId,
        rowId,
        writeEpoch: firstEpoch,
        commitSeq: firstCommitSeq,
        prevCommitSeq: null,
        schemaVersionId,
        creationTime,
        value: evidence(first),
      });
      await append(persistence, {
        kind: "live",
        scopeId,
        tableId,
        rowId,
        writeEpoch: firstEpoch,
        commitSeq: secondCommitSeq,
        prevCommitSeq: firstCommitSeq,
        schemaVersionId,
        creationTime,
        value: evidence(second),
      });

      await expect(readAt(persistence, firstCommitSeq - 1n)).resolves.toEqual({
        kind: "missing",
      });
      await expect(readAt(persistence, firstCommitSeq + 1n)).resolves.toMatchObject({
        kind: "live",
        commitSeq: firstCommitSeq,
        document: {
          value: {
            _id: "1:51000000-0000-0000-0000-000000000004",
            _creationTime: creationTime,
            title: "postgres\u0000row",
            count: 9_007_199_254_740_993n,
          },
        },
      });
      await expect(
        persistence.drizzle.transaction((tx) =>
          runEffect(readCurrentAppRowInTransactionEffect(
            tx,
            { scopeId, tableId, rowId },
          )),
        ),
      ).resolves.toMatchObject({ kind: "live", commitSeq: secondCommitSeq });

      const staleCommitSeq = CommitSeqSchema.make(secondCommitSeq + 2n);
      const conflict = await persistence.drizzle.transaction(async (tx) => {
        try {
          await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
            kind: "tombstone",
            scopeId,
            tableId,
            rowId,
            writeEpoch: firstEpoch,
            commitSeq: staleCommitSeq,
            prevCommitSeq: firstCommitSeq,
            schemaVersionId,
            creationTime,
          });
        } catch (error) {
          return error;
        }
        throw new Error("Expected stale app-row append to fail");
      });
      expect(conflict).toBeInstanceOf(AppRowRevisionChainConflictError);
      const staleCount = await persistence.query<{ count: string }>(
        `select count(*)::text as count from fx_app_row_rev where commit_seq = $1`,
        [staleCommitSeq],
      );
      expect(staleCount.rows).toEqual([{ count: "0" }]);

      await persistence.query(
        `update fx_system_scope_clock set epoch = $2 where scope_id = $1`,
        [scopeId, secondEpoch],
      );
      await expect(readAt(persistence, secondCommitSeq)).resolves.toMatchObject({
        kind: "live",
        commitSeq: secondCommitSeq,
        writeEpochUuid: "51000000-0000-0000-0000-000000000002",
      });

      const plans = await pointLookupPlans(persistence);
      expect(plans.revision).toMatch(
        /fx_app_row_rev_scope_uuid_table_id_row_id_commit_seq_pk/,
      );
      expect(plans.current).toMatch(
        /fx_app_row_current_scope_uuid_table_id_row_id_pk/,
      );
    });
  }, 30_000);

  it("keeps semantic point reads pinned while a later revision commits", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await persistence.query(
        `insert into fx_system_scope_clock
           (scope_id, storage_generation, last_commit_seq, epoch)
         values ($1, 'flarexdb_v1', $2, $3)`,
        [scopeId, secondCommitSeq, firstEpoch],
      );
      const first = await canonicalizeAppDocumentV1({
        tableId,
        rowId,
        creationTime,
        fields: { title: "pinned" },
      });
      const second = await canonicalizeAppDocumentV1({
        tableId,
        rowId,
        creationTime,
        fields: { title: "later" },
      });
      await append(persistence, {
        kind: "live",
        scopeId,
        tableId,
        rowId,
        writeEpoch: firstEpoch,
        commitSeq: firstCommitSeq,
        prevCommitSeq: null,
        schemaVersionId,
        creationTime,
        value: evidence(first),
      });

      const [pinnedRead] = await Promise.all([
        pointReadAt(persistence, firstCommitSeq),
        append(persistence, {
          kind: "live",
          scopeId,
          tableId,
          rowId,
          writeEpoch: firstEpoch,
          commitSeq: secondCommitSeq,
          prevCommitSeq: firstCommitSeq,
          schemaVersionId,
          creationTime,
          value: evidence(second),
        }),
      ]);
      expect(pinnedRead).toMatchObject({
        kind: "present",
        document: { value: { title: "pinned" } },
        dependency: {
          kind: "present",
          identity: { scopeId, tableId, rowId },
          revisionCommitSeq: firstCommitSeq,
        },
      });
      await expect(pointReadAt(persistence, firstCommitSeq)).resolves.toMatchObject(
        {
          kind: "present",
          document: { value: { title: "pinned" } },
          dependency: { revisionCommitSeq: firstCommitSeq },
        },
      );

      const tombstoneCommitSeq = CommitSeqSchema.make(secondCommitSeq + 2n);
      await append(persistence, {
        kind: "tombstone",
        scopeId,
        tableId,
        rowId,
        writeEpoch: firstEpoch,
        commitSeq: tombstoneCommitSeq,
        prevCommitSeq: secondCommitSeq,
        schemaVersionId,
        creationTime,
      });
      await expect(pointReadAt(persistence, tombstoneCommitSeq)).resolves.toEqual(
        {
          kind: "missing",
          document: null,
          dependency: {
            kind: "missing",
            identity: { scopeId, tableId, rowId },
            basis: {
              kind: "tombstone",
              revisionCommitSeq: tombstoneCommitSeq,
            },
          },
        },
      );
      await expect(
        pointReadAt(persistence, firstCommitSeq - 1n),
      ).resolves.toEqual({
        kind: "missing",
        document: null,
        dependency: {
          kind: "missing",
          identity: { scopeId, tableId, rowId },
          basis: { kind: "noVisibleRevision" },
        },
      });

      await persistence.query(
        `update fx_system_scope_clock set epoch = $2 where scope_id = $1`,
        [scopeId, secondEpoch],
      );
      await expect(
        pointReadAt(persistence, firstCommitSeq, secondEpoch),
      ).resolves.toMatchObject({
        kind: "present",
        dependency: { revisionCommitSeq: firstCommitSeq },
      });
    });
  }, 30_000);
});

async function append(
  persistence: PostgresFlarexPersistence,
  input: Parameters<
    typeof appendAppRowRevisionAndAdvanceCurrentInTransaction
  >[1],
) {
  return persistence.drizzle.transaction((tx) =>
    appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, input),
  );
}

async function readAt(
  persistence: PostgresFlarexPersistence,
  commitSeq: bigint,
) {
  return persistence.drizzle.transaction((tx) =>
    runEffect(readAppRowAtSnapshotInTransactionEffect(tx, {
      scopeId,
      tableId,
      rowId,
      snapshotCommitSeq: CommitSeqSchema.make(commitSeq),
    })),
  );
}

async function pointReadAt(
  persistence: PostgresFlarexPersistence,
  commitSeq: bigint,
  epoch = firstEpoch,
) {
  return persistence.drizzle.transaction((tx) =>
    runEffect(getAppRowAtSnapshotInTransactionEffect(tx, {
      snapshotToken: SnapshotTokenSchema.make({
        scopeId,
        epoch,
        commitSeq: CommitSeqSchema.make(commitSeq),
      }),
      tableId,
      rowId,
    })),
  );
}

function evidence(
  value: Awaited<ReturnType<typeof canonicalizeAppDocumentV1>>,
): AppRowValueEvidenceV1 {
  return {
    codecVersion: value.codecVersion,
    valueJson: value.valueJson,
    canonicalBytes: value.canonicalBytes,
    sha256: value.sha256,
  };
}

async function pointLookupPlans(
  persistence: PostgresFlarexPersistence,
): Promise<{ readonly revision: string; readonly current: string }> {
  const client = await persistence.pool.connect();
  try {
    await client.query(`set enable_seqscan = off`);
    const revision = await client.query<{ "QUERY PLAN": string }>(
      `
        explain (costs off)
        select *
        from fx_app_row_rev
        where scope_uuid = $1::uuid
          and table_id = $2
          and row_id = $3
          and commit_seq <= $4
        order by commit_seq desc
        limit 1
      `,
      [
        "51000000-0000-0000-0000-000000000001",
        tableId,
        appRowIdHexV1ToBytes(rowId),
        secondCommitSeq,
      ],
    );
    const current = await client.query<{ "QUERY PLAN": string }>(
      `
        explain (costs off)
        select *
        from fx_app_row_current
        where scope_uuid = $1::uuid and table_id = $2 and row_id = $3
      `,
      [
        "51000000-0000-0000-0000-000000000001",
        tableId,
        appRowIdHexV1ToBytes(rowId),
      ],
    );
    return {
      revision: revision.rows.map((row) => row["QUERY PLAN"]).join("\n"),
      current: current.rows.map((row) => row["QUERY PLAN"]).join("\n"),
    };
  } finally {
    client.release();
  }
}
