import { lockInstallationForCurrentTransaction, closeInstallationAdmission, requireAdmittedTargetInstallationSchema } from "../../../src/installation/installationLifecycle";
import { eq, getTableName, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { insertCurrentScopeClockFixture } from "../../scope/scopeClockFixture";
import { Effect, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { expect, vi } from "vitest";
import { MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1 } from "flarex-protocol/commit-protocol";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import type { FlarexPersistence } from "../../../src";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import {
  appendPreparedAppRowRevisionsInTransactionEffect,
  AppRowWritePersistenceError,
  InvalidAppRowBatchInputError,
  readAppRowAtSnapshotInTransactionEffect,
  type AppendPreparedAppRowRevisionV1Input,
} from "../../../src/storage/documents/appRows";
import {
  AppRowCreationTimeConflictError,
  AppRowRevisionChainConflictError,
  AppRowStorageCorruptionError,
} from "../../../src/storage/documents/appRowErrors";
import { runEffect } from "../../support/effectTestRuntime";
import { fxAppRowCurrent, fxAppRowRevisions } from "../../../src/database/schema";
import { applicationDomainFailureDetail } from "../../../src/storage/materialization/domainApplication";

const decodePreparedStatements = Schema.decodeUnknownSync(
  Schema.Struct({
    rows: Schema.Array(
      Schema.Struct({ name: Schema.String, statement: Schema.String }),
    ),
  }),
);

/** Identical row-batch semantic witnesses on PGlite and ordinary PostgreSQL. */
export async function verifyAppRowBatches(
  persistence: Pick<FlarexPersistence, "query">,
  db: FlarexMetadataDatabase,
  observeCaughtRollback: (run: () => Promise<void>) => Promise<void> = run => run(),
  observeNoRowBatch: (run: () => Promise<void>) => Promise<void> = run => run(),
) {
  const fixtureCommand = (statement: string) => Effect.tryPromise({ try: () => persistence.query(statement),
    catch: cause => new Error("Row batch fixture SQL", { cause }) });
  const schemaName = await db.transaction(async tx => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try { return await runEffect(Effect.fromResult(requireAdmittedTargetInstallationSchema(tx))); }
    finally { closeInstallationAdmission(tx); }
  });
  const rowTableName = new PgDialect().sqlToQuery(sql`${sql.identifier(schemaName)}.${sql.identifier(getTableName(fxAppRowRevisions))}`).sql;
  const scopeId = ScopeIdSchema.make(
    "scope_50190000-0000-0000-0000-000000000001",
  );
  const writeEpoch = ScopeEpochSchema.make(
    "epoch_50190000-0000-0000-0000-000000000002",
  );
  await insertCurrentScopeClockFixture(db, { scopeId, epoch: writeEpoch });
  const rows: AppendPreparedAppRowRevisionV1Input[] = [];
  for (let i = 0; i < 33; i += 1) {
    const tableId = decodeCatalogTableId(1 + (i % 2));
    // Deliberately reuse row IDs across tables to prove composite identity.
    const rowId = decodeAppRowIdHexV1(
      Math.floor(i / 2)
        .toString(16)
        .padStart(32, "0"),
    );
    const creationTime = decodeAppCreationTimeV1(42 + i);
    rows.push({
      kind: "live",
      scopeId,
      writeEpoch,
      tableId,
      rowId,
      creationTime,
      commitSeq: CommitSeqSchema.make(1n),
      prevCommitSeq: null,
      schemaVersionId: decodeCatalogSchemaVersionId("ce1_batch"),
      document: await canonicalizeAppDocumentV1({
        tableId,
        rowId,
        creationTime,
        fields: { ordinal: i },
      }),
    });
  }
  const append = (values: ReadonlyArray<AppendPreparedAppRowRevisionV1Input>) =>
    db.transaction(async (tx) => {
      await runEffect(lockInstallationForCurrentTransaction(tx));
      try {
        return await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, values));
      } finally { closeInstallationAdmission(tx); }
    },
    );
  const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
  const state = async () => ({
    history: await db.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid))
      .orderBy(fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
    pointers: await db.select().from(fxAppRowCurrent).where(eq(fxAppRowCurrent.scopeUuid, scopeUuid))
      .orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId),
  });
  const caught = (values: readonly AppendPreparedAppRowRevisionV1Input[], inspect?: (failure: AppRowStorageCorruptionError) => void) => observeCaughtRollback(() => db.transaction(async (tx) => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      const refusal = await runEffect(Effect.result(appendPreparedAppRowRevisionsInTransactionEffect(tx, values)));
      expect(Result.isFailure(refusal)).toBe(true);
      if (Result.isSuccess(refusal)) throw new Error("Corrupt row batch was accepted");
      if (!(refusal.failure instanceof AppRowStorageCorruptionError)) throw refusal.failure;
      expect(refusal.failure).toBeInstanceOf(AppRowStorageCorruptionError);
      inspect?.(refusal.failure);
      // Catching the typed owner refusal cannot restore this real transaction.
      await expect(tx.execute(sql`select 1`)).rejects.toMatchObject({ cause: { code: "25P02" } });
    } finally { closeInstallationAdmission(tx); }
  }));
  expect(await append([])).toEqual([]);
  expect(await append(rows)).toHaveLength(33);
  const before = await state();
  await runEffect(Effect.scoped(Effect.gen(function* () {
    // The real codec's semantic ceiling is 1 MiB. Retain only 65 canonical
    // documents and one shared source string until this one invocation settles.
    const input = yield* Effect.acquireRelease(Effect.sync(() => {
      const rows: AppendPreparedAppRowRevisionV1Input[] = [];
      return { rows, body: "x".repeat(1024 * 1024 - 1024) };
    }), owned => Effect.sync(() => { owned.rows.length = 0; owned.body = ""; }));
    let bytes = 0;
    for (let i = 0; i < 65; i += 1) {
      const tableId = decodeCatalogTableId(1);
      const rowId = decodeAppRowIdHexV1((256 + i).toString(16).padStart(32, "0"));
      const creationTime = decodeAppCreationTimeV1(42);
      const document = yield* Effect.tryPromise({
        try: () => canonicalizeAppDocumentV1({ tableId, rowId, creationTime, fields: { body: input.body, ordinal: i } }),
        catch: cause => new Error("Canonical row-input ceiling fixture", { cause }),
      }).pipe(Effect.uninterruptible);
      expect(document.canonicalBytes.byteLength).toBeLessThanOrEqual(8 * 1024 * 1024);
      bytes += document.canonicalBytes.byteLength;
      if (i === 63) expect(bytes).toBeLessThanOrEqual(MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1);
      input.rows.push({ kind: "live", scopeId, writeEpoch, tableId, rowId, creationTime,
        commitSeq: CommitSeqSchema.make(1n), prevCommitSeq: null,
        schemaVersionId: decodeCatalogSchemaVersionId("ce1_input_bytes"), document });
    }
    expect(bytes).toBeGreaterThan(MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1);
    yield* Effect.tryPromise({ try: () => observeNoRowBatch(() => db.transaction(async tx => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        const execute = vi.spyOn(tx, "execute");
        try {
          const refusal = await runEffect(Effect.result(appendPreparedAppRowRevisionsInTransactionEffect(tx, input.rows)));
          expect(Result.isFailure(refusal)).toBe(true);
          if (Result.isSuccess(refusal)) throw new Error("Canonical row-input ceiling was accepted");
          if (!(refusal.failure instanceof InvalidAppRowBatchInputError)) throw refusal.failure;
          expect(refusal.failure).toBeInstanceOf(InvalidAppRowBatchInputError);
          expect(refusal.failure.reason).toBe("byteCountExceeded");
          // The real execute method is observed, never replaced: even the first
          // fixed row page must remain unsubmitted on both database drivers.
          expect(execute).not.toHaveBeenCalled();
        } finally { execute.mockRestore(); closeInstallationAdmission(tx); }
      })), catch: cause => new Error("Canonical row-input ceiling transaction", { cause }) }).pipe(Effect.uninterruptible);
    const unchanged = yield* Effect.tryPromise({ try: state,
      catch: cause => new Error("Canonical row-input ceiling state", { cause }) }).pipe(Effect.uninterruptible);
    expect(unchanged).toEqual(before);
  })));
  const changed = rows.map((row) => ({
    ...row,
    commitSeq: CommitSeqSchema.make(2n),
    prevCommitSeq: CommitSeqSchema.make(1n),
  }));
  const last = changed.at(-1);
  const first = changed[0];
  if (first === undefined || last === undefined) throw new Error("Missing row batch witnesses.");
  await expect(
    append([
      ...changed.slice(0, -1),
      { ...last, creationTime: decodeAppCreationTimeV1(999) },
    ]),
  ).rejects.toBeInstanceOf(AppRowCreationTimeConflictError);
  expect(await state()).toEqual(before);
  await expect(append([...changed, last])).rejects.toBeInstanceOf(
    InvalidAppRowBatchInputError,
  );
  await expect(
    append([
      ...changed.slice(0, -1),
      {
        ...last,
        writeEpoch: ScopeEpochSchema.make(
          "epoch_50190000-0000-0000-0000-000000000003",
        ),
      },
    ]),
  ).rejects.toBeInstanceOf(InvalidAppRowBatchInputError);
  expect(await state()).toEqual(before);

  // A real SQL trigger changes the returned identity while preserving row count.
  // The first 32 rows have already been applied when the last row is corrupted.
  await runEffect(Effect.scoped(Effect.gen(function* () {
    yield* Effect.acquireRelease(fixtureCommand(`create function ce1_corrupt_row_identity() returns trigger language plpgsql as $$
      begin
        if NEW.commit_seq = 2 and NEW.table_id = 1 and NEW.row_id = decode('00000000000000000000000000000010','hex') then
          NEW.row_id := decode(repeat('ff',16),'hex');
        end if;
        return NEW;
      end $$`), () => fixtureCommand("drop function ce1_corrupt_row_identity()").pipe(Effect.orDie));
    yield* Effect.acquireRelease(fixtureCommand(
      "create trigger ce1_corrupt_row_identity before insert on fx_app_row_rev for each row execute function ce1_corrupt_row_identity()",
    ), () => fixtureCommand("drop trigger ce1_corrupt_row_identity on fx_app_row_rev").pipe(Effect.orDie));
    yield* Effect.tryPromise({ try: async () => {
      await expect(append(changed)).rejects.toBeInstanceOf(AppRowStorageCorruptionError);
      await caught(changed);
      expect(await state()).toEqual(before);
    }, catch: cause => new Error("Row batch BEFORE witness", { cause }) }).pipe(Effect.uninterruptible);
  })));

  await runEffect(Effect.scoped(Effect.gen(function* () {
    yield* Effect.acquireRelease(fixtureCommand(`create function ce1_corrupt_row_after() returns trigger language plpgsql as $$
      begin
        if NEW.commit_seq = 2 and NEW.table_id = 1 and NEW.row_id = decode('00000000000000000000000000000010','hex') then
          update ${rowTableName} set "${fxAppRowRevisions.creationTime.name}" = "${fxAppRowRevisions.creationTime.name}" + 1
            where "${fxAppRowRevisions.scopeUuid.name}" = NEW."${fxAppRowRevisions.scopeUuid.name}"
              and "${fxAppRowRevisions.tableId.name}" = NEW."${fxAppRowRevisions.tableId.name}"
              and "${fxAppRowRevisions.rowId.name}" = NEW."${fxAppRowRevisions.rowId.name}"
              and "${fxAppRowRevisions.commitSeq.name}" = NEW."${fxAppRowRevisions.commitSeq.name}";
        end if;
        return NEW;
      end $$`), () => fixtureCommand("drop function ce1_corrupt_row_after()").pipe(Effect.orDie));
    yield* Effect.acquireRelease(fixtureCommand("create trigger ce1_corrupt_row_after after insert on fx_app_row_rev for each row execute function ce1_corrupt_row_after()"),
      () => fixtureCommand("drop trigger ce1_corrupt_row_after on fx_app_row_rev").pipe(Effect.orDie));
    yield* Effect.tryPromise({ try: async () => {
      await caught(changed);
      expect(await state()).toEqual(before);
    }, catch: cause => new Error("Row batch AFTER witness", { cause }) }).pipe(Effect.uninterruptible);
  })));

  // The last page leaves its own tuple intact while corrupting a prior page.
  // Only the final invocation-wide proof can detect this earlier identity.
  await runEffect(Effect.scoped(Effect.gen(function* () {
    yield* Effect.acquireRelease(fixtureCommand(`create function ce1_corrupt_earlier_row_after() returns trigger language plpgsql as $$
      begin
        if NEW.commit_seq = 2 and NEW.table_id = 1 and NEW.row_id = decode('00000000000000000000000000000010','hex') then
          update ${rowTableName} set "${fxAppRowRevisions.creationTime.name}" = "${fxAppRowRevisions.creationTime.name}" + 1
            where "${fxAppRowRevisions.scopeUuid.name}" = NEW."${fxAppRowRevisions.scopeUuid.name}"
              and "${fxAppRowRevisions.tableId.name}" = 1
              and "${fxAppRowRevisions.rowId.name}" = decode('00000000000000000000000000000000','hex')
              and "${fxAppRowRevisions.commitSeq.name}" = NEW."${fxAppRowRevisions.commitSeq.name}";
        end if;
        return NEW;
      end $$`), () => fixtureCommand("drop function ce1_corrupt_earlier_row_after()").pipe(Effect.orDie));
    yield* Effect.acquireRelease(fixtureCommand("create trigger ce1_corrupt_earlier_row_after after insert on fx_app_row_rev for each row execute function ce1_corrupt_earlier_row_after()"),
      () => fixtureCommand("drop trigger ce1_corrupt_earlier_row_after on fx_app_row_rev").pipe(Effect.orDie));
    yield* Effect.tryPromise({ try: async () => {
      await caught(changed, failure => {
        expect(failure.identity).toEqual({ scopeId, tableId: first.tableId, rowId: first.rowId });
        expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
          reason: Schema.Literal("storedCorruption"), phase: Schema.Literal("verify"), ordinal: Schema.Literal(0),
        })))(applicationDomainFailureDetail(failure.cause, "fx_apply_app_row_batch"))).toEqual({
          reason: "storedCorruption", phase: "verify", ordinal: 0,
        });
      });
      expect(await state()).toEqual(before);
    }, catch: cause => new Error("Row batch earlier-page AFTER witness", { cause }) }).pipe(Effect.uninterruptible);
  })));

  const mixed = changed.map((row, i): AppendPreparedAppRowRevisionV1Input =>
    i % 3 === 0 ? { ...row, kind: "tombstone" } : row,
  );
  expect(await append(mixed)).toHaveLength(33);
  const after = await state();
  expect(after.history).toHaveLength(66);
  // Existing predecessor 1 is insufficient: current pointer already points to 2.
  await expect(
    append(
      changed.map((row) => ({ ...row, commitSeq: CommitSeqSchema.make(3n) })),
    ),
  ).rejects.toBeInstanceOf(AppRowRevisionChainConflictError);
  expect(await state()).toEqual(after);
  // A missing predecessor must also refuse without leaving earlier batches.
  await expect(
    append(
      changed.map((row) => ({
        ...row,
        commitSeq: CommitSeqSchema.make(4n),
        prevCommitSeq: CommitSeqSchema.make(3n),
      })),
    ),
  ).rejects.toBeInstanceOf(AppRowRevisionChainConflictError);
  for (const index of [0, 1, 32]) {
    const row = rows[index];
    if (row === undefined) throw new Error("Missing history witness.");
    for (const seq of [1n, 2n]) {
      const stored = await db.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
          return await runEffect(
            readAppRowAtSnapshotInTransactionEffect(tx, {
              ...row,
              snapshotCommitSeq: CommitSeqSchema.make(seq),
            }),
          );
        } finally { closeInstallationAdmission(tx); }
      },
      );
      expect(stored).toMatchObject({
        commitSeq: seq,
        kind: seq === 2n && index % 3 === 0 ? "tombstone" : "live",
        creationTime: row.creationTime,
      });
      if (stored.kind === "live" && row.kind === "live")
        expect(stored.document.canonicalBytes).toEqual(
          row.document.canonicalBytes,
        );
    }
  }

  // A database rejection retains its foreign cause and rolls back the owner.
  await persistence.query(
    `create function ce1_reject_rows() returns trigger language plpgsql as $$ begin raise exception 'CE1 injected driver refusal'; end $$`,
  );
  await persistence.query(
    "create trigger ce1_reject_rows before insert on fx_app_row_rev for each row execute function ce1_reject_rows()",
  );
  try {
    await expect(
      append(
        mixed.map((row) => ({
          ...row,
          commitSeq: CommitSeqSchema.make(5n),
          prevCommitSeq: CommitSeqSchema.make(2n),
        })),
      ),
    ).rejects.toBeInstanceOf(AppRowWritePersistenceError);
    expect(await state()).toEqual(after);
  } finally {
    await persistence.query("drop trigger ce1_reject_rows on fx_app_row_rev");
    await persistence.query("drop function ce1_reject_rows()");
  }
}

/** Repeated equal shapes must bind each batch, scope and nullable value afresh. */
export async function verifyAppRowBatchBindings(
  persistence: Pick<FlarexPersistence, "query">,
  db: FlarexMetadataDatabase,
) {
  const sequence = CommitSeqSchema.make(9_007_199_254_740_995n);
  for (const scopeOrdinal of [1, 2]) {
    const scopeUuid = `a5290000-0000-4000-8000-${scopeOrdinal.toString().padStart(12, "0")}`;
    const scopeId = ScopeIdSchema.make(`scope_${scopeUuid}`);
    const writeEpoch = ScopeEpochSchema.make(`epoch_${scopeUuid}`);
    await insertCurrentScopeClockFixture(db, { scopeId, epoch: writeEpoch });
    const rows: AppendPreparedAppRowRevisionV1Input[] = [];
    for (let i = 0; i < 64; i++) {
      const tableId = decodeCatalogTableId(1);
      const rowId = decodeAppRowIdHexV1(i.toString(16).padStart(32, "0"));
      const creationTime = decodeAppCreationTimeV1(42 + i);
      rows.push({
        kind: "live",
        scopeId,
        writeEpoch,
        tableId,
        rowId,
        creationTime,
        commitSeq: CommitSeqSchema.make(1n),
        prevCommitSeq: null,
        schemaVersionId: decodeCatalogSchemaVersionId(
          `ce1_binding_${scopeOrdinal}`,
        ),
        document: await canonicalizeAppDocumentV1({
          tableId,
          rowId,
          creationTime,
          fields: {
            scopeOrdinal,
            ordinal: i,
            bytes: new Uint8Array([0, 127, 255, i]).buffer,
          },
        }),
      });
    }
    const append = (values: readonly AppendPreparedAppRowRevisionV1Input[]) =>
      db.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {

          const before = decodePreparedStatements(
            await tx.execute(
              sql`select name, statement from pg_prepared_statements order by name`,
            ),
          ).rows;
          const result = await runEffect(
            appendPreparedAppRowRevisionsInTransactionEffect(tx, values),
          );
          expect(
            decodePreparedStatements(
              await tx.execute(
                sql`select name, statement from pg_prepared_statements order by name`,
              ),
            ).rows,
          ).toEqual(before);
          return await result;
        } finally { closeInstallationAdmission(tx); }
      });
    await append(rows);
    const changed = rows.map((row, i): AppendPreparedAppRowRevisionV1Input =>
      i % 3 === 0
        ? {
            kind: "tombstone",
            scopeId,
            writeEpoch,
            tableId: row.tableId,
            rowId: row.rowId,
            creationTime: row.creationTime,
            schemaVersionId: row.schemaVersionId,
            commitSeq: sequence,
            prevCommitSeq: CommitSeqSchema.make(1n),
          }
        : {
            ...row,
            commitSeq: sequence,
            prevCommitSeq: CommitSeqSchema.make(1n),
          },
    );
    await append(changed);
    const stored = await persistence.query(
      `select r.table_id, encode(r.row_id, 'hex') as row_id,
      r.commit_seq::text, r.prev_commit_seq::text, r.write_epoch_uuid::text, r.schema_version_id,
      r.creation_time, r.is_tombstone, encode(r.value_bytes, 'hex') as value_bytes, encode(r.value_sha256, 'hex') as value_sha256
      from fx_app_row_current c join fx_app_row_rev r using(scope_uuid,table_id,row_id,commit_seq)
      where c.scope_uuid=$1 order by r.row_id`,
      [scopeUuid],
    );
    expect(stored.rows).toEqual(
      changed.map((row) => ({
        table_id: row.tableId,
        row_id: row.rowId,
        commit_seq: sequence.toString(),
        prev_commit_seq: "1",
        write_epoch_uuid: scopeUuid,
        schema_version_id: row.schemaVersionId,
        creation_time: row.creationTime,
        is_tombstone: row.kind === "tombstone",
        value_bytes:
          row.kind === "live"
            ? encodeBytesToLowercaseHex(row.document.canonicalBytes)
            : null,
        value_sha256:
          row.kind === "live"
            ? encodeBytesToLowercaseHex(row.document.sha256)
            : null,
      })),
    );
  }
}
