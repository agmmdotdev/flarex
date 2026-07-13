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
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  AppRowCreationTimeConflictError,
  AppRowRevisionChainConflictError,
  AppRowStorageCorruptionError,
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
  readAppRowAtSnapshotInTransaction,
  readCurrentAppRowInTransaction,
  type AppendAppRowRevisionV1Input,
  type AppRowIdentityV1,
  type AppRowValueEvidenceV1,
} from "../src/appRows";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";

const scopeId = ScopeIdSchema.make(
  "scope_50000000-0000-0000-0000-000000000001",
);
const firstEpoch = ScopeEpochSchema.make(
  "epoch_50000000-0000-0000-0000-000000000002",
);
const secondEpoch = ScopeEpochSchema.make(
  "epoch_50000000-0000-0000-0000-000000000003",
);
const tableId = decodeCatalogTableId(1);
const otherTableId = decodeCatalogTableId(2);
const rowId = decodeAppRowIdHexV1("50000000000000000000000000000004");
const corruptionRowId = decodeAppRowIdHexV1(
  "50000000000000000000000000000005",
);
const schemaVersionId = decodeCatalogSchemaVersionId("schema_rows_v1");
const creationTime = decodeAppCreationTimeV1(1_725_000_000_000.25);
const identity = Object.freeze({ scopeId, tableId, rowId }) satisfies AppRowIdentityV1;

describe("FlarexDB app-row revision storage", () => {
  it("preserves exact missing, live, update, and tombstone history", async () => {
    const persistence = await appRowPersistence();
    const first = await canonicalDocument({
      title: "before\u0000after",
      count: 9_007_199_254_740_993n,
      bytes: new Uint8Array([0, 127, 255]).buffer,
    });
    const second = await canonicalDocument({ title: "updated", count: 2n });

    await expect(readAt(persistence, 0n)).resolves.toEqual({ kind: "missing" });
    await append(persistence, {
      kind: "live",
      ...identity,
      writeEpoch: firstEpoch,
      commitSeq: CommitSeqSchema.make(1n),
      prevCommitSeq: null,
      schemaVersionId,
      creationTime,
      value: evidence(first),
    });
    await append(persistence, {
      kind: "live",
      ...identity,
      writeEpoch: firstEpoch,
      commitSeq: CommitSeqSchema.make(3n),
      prevCommitSeq: CommitSeqSchema.make(1n),
      schemaVersionId,
      creationTime,
      value: evidence(second),
    });
    await append(persistence, {
      kind: "tombstone",
      ...identity,
      writeEpoch: firstEpoch,
      commitSeq: CommitSeqSchema.make(5n),
      prevCommitSeq: CommitSeqSchema.make(3n),
      schemaVersionId,
      creationTime,
    });

    for (const [snapshot, expectedCommit, expectedKind] of [
      [0n, null, "missing"],
      [1n, 1n, "live"],
      [2n, 1n, "live"],
      [3n, 3n, "live"],
      [4n, 3n, "live"],
      [5n, 5n, "tombstone"],
    ] as const) {
      const result = await readAt(persistence, snapshot);
      expect(result.kind).toBe(expectedKind);
      expect(result.kind === "missing" ? null : result.commitSeq).toBe(
        expectedCommit,
      );
    }

    const inserted = await readAt(persistence, 1n);
    expect(inserted).toMatchObject({
      kind: "live",
      creationTime,
      document: {
        value: {
          _id: "1:50000000-0000-0000-0000-000000000004",
          _creationTime: creationTime,
          title: "before\u0000after",
          count: 9_007_199_254_740_993n,
        },
      },
    });
    await expect(
      persistence.drizzle.transaction((tx) =>
        readCurrentAppRowInTransaction(tx, identity),
      ),
    ).resolves.toMatchObject({ kind: "tombstone", commitSeq: 5n });

    await persistence.query(
      `update fx_system_scope_clock set epoch = $2 where scope_id = $1`,
      [scopeId, secondEpoch],
    );
    await expect(readAt(persistence, 4n)).resolves.toMatchObject({
      kind: "live",
      commitSeq: 3n,
      writeEpochUuid: "50000000-0000-0000-0000-000000000002",
    });
  });

  it("keeps identical physical row bytes isolated by scope and table", async () => {
    const persistence = await appRowPersistence();
    const document = await canonicalDocument({ title: "isolated" });
    await append(persistence, {
      kind: "live",
      ...identity,
      writeEpoch: firstEpoch,
      commitSeq: CommitSeqSchema.make(1n),
      prevCommitSeq: null,
      schemaVersionId,
      creationTime,
      value: evidence(document),
    });
    const otherScopeId = ScopeIdSchema.make(
      "scope_50000000-0000-0000-0000-000000000011",
    );
    await insertClock(
      persistence,
      otherScopeId,
      ScopeEpochSchema.make("epoch_50000000-0000-0000-0000-000000000012"),
    );

    await expect(
      persistence.drizzle.transaction((tx) =>
        readAppRowAtSnapshotInTransaction(tx, {
          scopeId: otherScopeId,
          tableId,
          rowId,
          snapshotCommitSeq: CommitSeqSchema.make(1n),
        }),
      ),
    ).resolves.toEqual({ kind: "missing" });
    await expect(
      persistence.drizzle.transaction((tx) =>
        readAppRowAtSnapshotInTransaction(tx, {
          scopeId,
          tableId: otherTableId,
          rowId,
          snapshotCommitSeq: CommitSeqSchema.make(1n),
        }),
      ),
    ).resolves.toEqual({ kind: "missing" });
  });

  it("rolls back an appended revision when current-pointer CAS fails", async () => {
    const persistence = await appRowPersistence();
    const first = await canonicalDocument({ value: 1 });
    const second = await canonicalDocument({ value: 2 });
    const stale = await canonicalDocument({ value: 3 });
    await append(persistence, {
      kind: "live",
      ...identity,
      writeEpoch: firstEpoch,
      commitSeq: CommitSeqSchema.make(1n),
      prevCommitSeq: null,
      schemaVersionId,
      creationTime,
      value: evidence(first),
    });
    await append(persistence, {
      kind: "live",
      ...identity,
      writeEpoch: firstEpoch,
      commitSeq: CommitSeqSchema.make(2n),
      prevCommitSeq: CommitSeqSchema.make(1n),
      schemaVersionId,
      creationTime,
      value: evidence(second),
    });

    const conflict = await persistence.drizzle.transaction(async (tx) => {
      try {
        await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
          kind: "live",
          ...identity,
          writeEpoch: firstEpoch,
          commitSeq: CommitSeqSchema.make(3n),
          prevCommitSeq: CommitSeqSchema.make(1n),
          schemaVersionId,
          creationTime,
          value: evidence(stale),
        });
      } catch (error) {
        return error;
      }
      throw new Error("Expected stale app-row append to fail");
    });
    expect(conflict).toBeInstanceOf(AppRowRevisionChainConflictError);
    await expect(readAt(persistence, 3n)).resolves.toMatchObject({
      kind: "live",
      commitSeq: 2n,
    });
    const counts = await persistence.query<{
      revisions: string;
      current_rows: string;
    }>(`
      select
        (select count(*)::text from fx_app_row_rev) as revisions,
        (select count(*)::text from fx_app_row_current) as current_rows
    `);
    expect(counts.rows).toEqual([{ revisions: "2", current_rows: "1" }]);
  });

  it("rejects creation-time changes on live and tombstone revisions", async () => {
    const persistence = await appRowPersistence();
    const first = await canonicalDocument({ value: 1 });
    await append(persistence, {
      kind: "live",
      ...identity,
      writeEpoch: firstEpoch,
      commitSeq: CommitSeqSchema.make(1n),
      prevCommitSeq: null,
      schemaVersionId,
      creationTime,
      value: evidence(first),
    });

    const changedCreationTime = decodeAppCreationTimeV1(creationTime + 1);
    const changedDocument = await canonicalizeAppDocumentV1({
      tableId,
      rowId,
      creationTime: changedCreationTime,
      fields: { value: 2 },
    });
    await expect(
      append(persistence, {
        kind: "live",
        ...identity,
        writeEpoch: firstEpoch,
        commitSeq: CommitSeqSchema.make(3n),
        prevCommitSeq: CommitSeqSchema.make(1n),
        schemaVersionId,
        creationTime: changedCreationTime,
        value: evidence(changedDocument),
      }),
    ).rejects.toBeInstanceOf(AppRowCreationTimeConflictError);
    await expect(
      append(persistence, {
        kind: "tombstone",
        ...identity,
        writeEpoch: firstEpoch,
        commitSeq: CommitSeqSchema.make(4n),
        prevCommitSeq: CommitSeqSchema.make(1n),
        schemaVersionId,
        creationTime: changedCreationTime,
      }),
    ).rejects.toBeInstanceOf(AppRowCreationTimeConflictError);

    await expect(
      persistence.drizzle.transaction((tx) =>
        readCurrentAppRowInTransaction(tx, identity),
      ),
    ).resolves.toMatchObject({
      kind: "live",
      commitSeq: 1n,
      creationTime,
    });
    const counts = await persistence.query<{ revisions: string }>(
      `select count(*)::text as revisions from fx_app_row_rev`,
    );
    expect(counts.rows).toEqual([{ revisions: "1" }]);
  });

  it("fails closed on legacy scope authority and corrupted value evidence", async () => {
    const persistence = await appRowPersistence();
    const legacyScope = ScopeIdSchema.make("scope-legacy-row-path");
    await insertClock(
      persistence,
      legacyScope,
      ScopeEpochSchema.make("epoch-legacy-row-path"),
    );
    await expect(
      persistence.drizzle.transaction((tx) =>
        readAppRowAtSnapshotInTransaction(tx, {
          scopeId: legacyScope,
          tableId,
          rowId,
          snapshotCommitSeq: CommitSeqSchema.make(0n),
        }),
      ),
    ).rejects.toThrow();

    const document = await canonicalizeAppDocumentV1({
      tableId,
      rowId: corruptionRowId,
      creationTime,
      fields: { title: "corrupt me" },
    });
    await persistence.query(
      `
        insert into fx_app_row_rev
          (
            scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
            write_epoch_uuid, schema_version_id, creation_time,
            value_codec_version, is_tombstone, value_json, value_bytes,
            value_sha256
          )
        values ($1::uuid, $2, $3, 1, null, $4::uuid, $5, $6, 1, false,
          $7::jsonb, $8, $9)
      `,
      [
        "50000000-0000-0000-0000-000000000001",
        tableId,
        appRowIdHexV1ToBytes(corruptionRowId),
        "50000000-0000-0000-0000-000000000002",
        schemaVersionId,
        creationTime,
        JSON.stringify(document.valueJson),
        document.canonicalBytes,
        new Uint8Array(32).fill(9),
      ],
    );
    await persistence.query(
      `insert into fx_app_row_current (scope_uuid, table_id, row_id, commit_seq)
       values ($1::uuid, $2, $3, 1)`,
      [
        "50000000-0000-0000-0000-000000000001",
        tableId,
        appRowIdHexV1ToBytes(corruptionRowId),
      ],
    );
    await expect(
      persistence.drizzle.transaction((tx) =>
        readCurrentAppRowInTransaction(tx, {
          scopeId,
          tableId,
          rowId: corruptionRowId,
        }),
      ),
    ).rejects.toBeInstanceOf(AppRowStorageCorruptionError);
  });

  it("enforces physical row constraints and keeps mutation off the root API", async () => {
    const persistence = await appRowPersistence();
    for (const statement of [
      `insert into fx_app_row_rev
        (scope_uuid, table_id, row_id, commit_seq, write_epoch_uuid,
         schema_version_id, creation_time, value_codec_version, is_tombstone)
       values ('50000000-0000-0000-0000-000000000001', 1, decode('00', 'hex'),
         1, '50000000-0000-0000-0000-000000000002', 'schema', 1, 1, true)`,
      `insert into fx_app_row_rev
        (scope_uuid, table_id, row_id, commit_seq, write_epoch_uuid,
         schema_version_id, creation_time, value_codec_version, is_tombstone)
       values ('50000000-0000-0000-0000-000000000001', 1,
         decode(repeat('00', 16), 'hex'), 0,
         '50000000-0000-0000-0000-000000000002', 'schema', 1, 1, true)`,
      `insert into fx_app_row_current (scope_uuid, table_id, row_id, commit_seq)
       values ('50000000-0000-0000-0000-000000000001', 1,
         decode(repeat('01', 16), 'hex'), 1)`,
    ]) {
      await expect(persistence.query(statement)).rejects.toThrow();
    }

    type ForbiddenMutationKey = Extract<
      keyof PGliteFlarexPersistence,
      "appendAppRowRevisionAndAdvanceCurrent"
    >;
    const hasNoAmbientMutation: [ForbiddenMutationKey] extends [never]
      ? true
      : false = true;
    expect(hasNoAmbientMutation).toBe(true);
  });
});

async function appRowPersistence(): Promise<PGliteFlarexPersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  await insertClock(persistence, scopeId, firstEpoch);
  return persistence;
}

async function insertClock(
  persistence: PGliteFlarexPersistence,
  insertedScopeId: ReturnType<typeof ScopeIdSchema.make>,
  epoch: ReturnType<typeof ScopeEpochSchema.make>,
): Promise<void> {
  await persistence.query(
    `insert into fx_system_scope_clock (scope_id, storage_generation, epoch)
     values ($1, 'flarexdb_v1', $2)`,
    [insertedScopeId, epoch],
  );
}

async function canonicalDocument(fields: unknown) {
  return canonicalizeAppDocumentV1({
    tableId,
    rowId,
    creationTime,
    fields,
  });
}

function evidence(
  value: Awaited<ReturnType<typeof canonicalDocument>>,
): AppRowValueEvidenceV1 {
  return {
    codecVersion: value.codecVersion,
    valueJson: value.valueJson,
    canonicalBytes: value.canonicalBytes,
    sha256: value.sha256,
  };
}

async function append(
  persistence: PGliteFlarexPersistence,
  input: AppendAppRowRevisionV1Input,
) {
  return persistence.drizzle.transaction((tx) =>
    appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, input),
  );
}

async function readAt(
  persistence: PGliteFlarexPersistence,
  commitSeq: bigint,
) {
  return persistence.drizzle.transaction((tx) =>
    readAppRowAtSnapshotInTransaction(tx, {
      ...identity,
      snapshotCommitSeq: CommitSeqSchema.make(commitSeq),
    }),
  );
}
