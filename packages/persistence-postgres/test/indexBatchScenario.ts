import { lockInstallationForCurrentTransaction, closeInstallationAdmission, requireAdmittedTargetInstallationSchema } from "../src/installationLifecycle";
import { expect } from "vitest";
import { and, eq, getTableName, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Result, Schema } from "effect";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  type ScopeId,
  type ScopeEpoch,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import {
  decodeOrderedIndexRowIdHexV1,
  encodeAppOrderedIndexKeyV1,
  orderedIndexCreationTimeV1,
} from "flarex-protocol/ordered-index";
import type { FlarexPersistence } from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import type { LocatedAppIndexDefinitionV1 } from "../src/appIndexDefinitions";
import {
  appendPreparedAppRowRevisionsInTransactionEffect,
  type AppendPreparedLiveAppRowRevisionV1Input,
} from "../src/appRows";
import {
  appendAppIndexEntryRevisionsInTransactionEffect,
  scanAppIndexAtSnapshotInTransactionEffect,
  AppIndexEntryStorageCorruptionError,
  AppIndexEntryParentRowError,
  AppIndexEntryScopeAuthorityUnavailableError,
  AppIndexEntryRevisionAlreadyExistsError,
  InvalidAppIndexEntryInputError,
  type AppendAppIndexEntryRevisionV1Input,
} from "../src/appIndexEntries";
import { runEffect } from "./effectTestRuntime";
import { fxAppIndexEntryCurrent, fxAppIndexEntryRevisions } from "../src/schema";
import { applicationDomainFailureDetail } from "../src/applicationDocumentMaterialization/domainApplication";

export async function verifyIndexBatches(
  persistence: Pick<FlarexPersistence, "query">,
  db: FlarexMetadataDatabase,
  scopeId: ScopeId,
  writeEpoch: ScopeEpoch,
  definition: LocatedAppIndexDefinitionV1,
  observeCaughtRollback: (run: () => Promise<void>) => Promise<void> = run => run(),
) {
  const fixtureCommand = (statement: string) => Effect.tryPromise({ try: () => persistence.query(statement),
    catch: cause => new Error("Index batch fixture SQL", { cause }) });
  const schemaName = await db.transaction(async tx => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try { return await runEffect(Effect.fromResult(requireAdmittedTargetInstallationSchema(tx))); }
    finally { closeInstallationAdmission(tx); }
  });
  const indexTableName = new PgDialect().sqlToQuery(sql`${sql.identifier(schemaName)}.${sql.identifier(getTableName(fxAppIndexEntryRevisions))}`).sql;
  const tableId = definition.access.tableId;
  const creationTime = decodeAppCreationTimeV1(42);
  const rows: AppendPreparedLiveAppRowRevisionV1Input[] = [];
  const actions: AppendAppIndexEntryRevisionV1Input[] = [];
  const encodedKey = encodeAppOrderedIndexKeyV1({
    spec: definition.physicalSpec,
    values: [orderedIndexCreationTimeV1(42)],
  });
  for (let i = 0; i < 33; i += 1) {
    const rowId = decodeAppRowIdHexV1(i.toString(16).padStart(32, "0"));
    rows.push({
      kind: "live",
      scopeId,
      writeEpoch,
      tableId,
      rowId,
      creationTime,
      schemaVersionId: decodeCatalogSchemaVersionId("ce1_index_batch"),
      commitSeq: CommitSeqSchema.make(1n),
      prevCommitSeq: null,
      document: await canonicalizeAppDocumentV1({
        tableId,
        rowId,
        creationTime,
        fields: { ordinal: i },
      }),
    });
    actions.push({
      kind: "live",
      scopeId,
      writeEpoch,
      definition,
      encodedKey,
      rowId: decodeOrderedIndexRowIdHexV1(rowId),
      commitSeq: CommitSeqSchema.make(1n),
    });
  }
  await db.transaction(async (tx) => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      return await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, rows));
    } finally { closeInstallationAdmission(tx); }
  },
  );
  const append = (input: ReadonlyArray<AppendAppIndexEntryRevisionV1Input>) =>
    db.transaction(async (tx) => {
      await runEffect(lockInstallationForCurrentTransaction(tx));
      try {
        return await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, input));
      } finally { closeInstallationAdmission(tx); }
    },
    );
  const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
  const state = async () => ({
    history: await db.select().from(fxAppIndexEntryRevisions).where(and(eq(fxAppIndexEntryRevisions.scopeUuid, scopeUuid),
      eq(fxAppIndexEntryRevisions.indexDefinitionId, definition.indexDefinitionId)))
      .orderBy(fxAppIndexEntryRevisions.encodedKey, fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq),
    pointers: await db.select().from(fxAppIndexEntryCurrent).where(and(eq(fxAppIndexEntryCurrent.scopeUuid, scopeUuid),
      eq(fxAppIndexEntryCurrent.indexDefinitionId, definition.indexDefinitionId)))
      .orderBy(fxAppIndexEntryCurrent.encodedKey, fxAppIndexEntryCurrent.rowId),
  });
  const caught = (values: readonly AppendAppIndexEntryRevisionV1Input[], inspect?: (failure: AppIndexEntryStorageCorruptionError) => void) => observeCaughtRollback(() => db.transaction(async (tx) => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      const refusal = await runEffect(Effect.result(appendAppIndexEntryRevisionsInTransactionEffect(tx, values)));
      expect(Result.isFailure(refusal)).toBe(true);
      if (Result.isSuccess(refusal)) throw new Error("Corrupt index batch was accepted");
      if (!(refusal.failure instanceof AppIndexEntryStorageCorruptionError)) throw refusal.failure;
      expect(refusal.failure).toBeInstanceOf(AppIndexEntryStorageCorruptionError);
      inspect?.(refusal.failure);
      await expect(tx.execute(sql`select 1`)).rejects.toMatchObject({ cause: { code: "25P02" } });
    } finally { closeInstallationAdmission(tx); }
  }));
  expect(await append([])).toEqual([]);
  expect(await append(actions)).toHaveLength(33);
  const before = await state();
  await expect(append(actions)).rejects.toBeInstanceOf(
    AppIndexEntryRevisionAlreadyExistsError,
  );
  await expect(append([...actions, ...actions])).rejects.toBeInstanceOf(
    InvalidAppIndexEntryInputError,
  );
  await expect(
    append(
      actions.map((action) => ({
        ...action,
        writeEpoch: ScopeEpochSchema.make(
          "epoch_55190000-0000-0000-0000-000000000099",
        ),
      })),
    ),
  ).rejects.toBeInstanceOf(AppIndexEntryScopeAuthorityUnavailableError);
  const first = actions[0];
  if (first === undefined) throw new Error("Missing index batch witness.");
  await expect(
    append([
      { ...first, rowId: decodeOrderedIndexRowIdHexV1("ff".repeat(16)) },
    ]),
  ).rejects.toBeInstanceOf(AppIndexEntryParentRowError);
  expect(await state()).toEqual(before);
  const deletes = actions.map((action): AppendAppIndexEntryRevisionV1Input => ({
    ...action,
    kind: "tombstone",
    commitSeq: CommitSeqSchema.make(2n),
  }));
  await runEffect(Effect.scoped(Effect.gen(function* () {
    yield* Effect.acquireRelease(fixtureCommand(`create function ce1_corrupt_index_return() returns trigger language plpgsql as $$ begin
      if NEW.commit_seq = 2 and NEW.row_id = decode('00000000000000000000000000000020','hex') then
        NEW.encoded_key := NEW.encoded_key || decode('00','hex');
      end if; return NEW; end $$`), () => fixtureCommand("drop function ce1_corrupt_index_return()").pipe(Effect.orDie));
    yield* Effect.acquireRelease(fixtureCommand(
      "create trigger ce1_corrupt_index_return before insert on fx_app_index_entry_rev for each row execute function ce1_corrupt_index_return()",
    ), () => fixtureCommand("drop trigger ce1_corrupt_index_return on fx_app_index_entry_rev").pipe(Effect.orDie));
    yield* Effect.tryPromise({ try: async () => {
      await expect(append(deletes)).rejects.toBeInstanceOf(
        AppIndexEntryStorageCorruptionError,
      );
      await caught(deletes);
      expect(await state()).toEqual(before);
      expect((await state()).pointers).toHaveLength(33);
    }, catch: cause => new Error("Index batch BEFORE witness", { cause }) }).pipe(Effect.uninterruptible);
  })));
  await runEffect(Effect.scoped(Effect.gen(function* () {
    yield* Effect.acquireRelease(fixtureCommand(`create function ce1_corrupt_index_after() returns trigger language plpgsql as $$ begin
      if NEW.commit_seq = 2 and NEW.row_id = decode('00000000000000000000000000000020','hex') then
        update ${indexTableName} set "${fxAppIndexEntryRevisions.keySha256.name}" = decode(repeat('00',32),'hex')
          where "${fxAppIndexEntryRevisions.scopeUuid.name}" = NEW."${fxAppIndexEntryRevisions.scopeUuid.name}"
            and "${fxAppIndexEntryRevisions.indexDefinitionId.name}" = NEW."${fxAppIndexEntryRevisions.indexDefinitionId.name}"
            and "${fxAppIndexEntryRevisions.encodedKey.name}" = NEW."${fxAppIndexEntryRevisions.encodedKey.name}"
            and "${fxAppIndexEntryRevisions.rowId.name}" = NEW."${fxAppIndexEntryRevisions.rowId.name}"
            and "${fxAppIndexEntryRevisions.commitSeq.name}" = NEW."${fxAppIndexEntryRevisions.commitSeq.name}";
      end if; return NEW; end $$`), () => fixtureCommand("drop function ce1_corrupt_index_after()").pipe(Effect.orDie));
    yield* Effect.acquireRelease(fixtureCommand("create trigger ce1_corrupt_index_after after insert on fx_app_index_entry_rev for each row execute function ce1_corrupt_index_after()"),
      () => fixtureCommand("drop trigger ce1_corrupt_index_after on fx_app_index_entry_rev").pipe(Effect.orDie));
    yield* Effect.tryPromise({ try: async () => {
      await caught(deletes);
      expect(await state()).toEqual(before);
    }, catch: cause => new Error("Index batch AFTER witness", { cause }) }).pipe(Effect.uninterruptible);
  })));
  await runEffect(Effect.scoped(Effect.gen(function* () {
    yield* Effect.acquireRelease(fixtureCommand(`create function ce1_corrupt_earlier_index_after() returns trigger language plpgsql as $$ begin
      if NEW.commit_seq = 2 and NEW.row_id = decode('00000000000000000000000000000020','hex') then
        update ${indexTableName} set "${fxAppIndexEntryRevisions.keySha256.name}" = decode(repeat('00',32),'hex')
          where "${fxAppIndexEntryRevisions.scopeUuid.name}" = NEW."${fxAppIndexEntryRevisions.scopeUuid.name}"
            and "${fxAppIndexEntryRevisions.indexDefinitionId.name}" = NEW."${fxAppIndexEntryRevisions.indexDefinitionId.name}"
            and "${fxAppIndexEntryRevisions.encodedKey.name}" = NEW."${fxAppIndexEntryRevisions.encodedKey.name}"
            and "${fxAppIndexEntryRevisions.rowId.name}" = decode('00000000000000000000000000000000','hex')
            and "${fxAppIndexEntryRevisions.commitSeq.name}" = NEW."${fxAppIndexEntryRevisions.commitSeq.name}";
      end if; return NEW; end $$`), () => fixtureCommand("drop function ce1_corrupt_earlier_index_after()").pipe(Effect.orDie));
    yield* Effect.acquireRelease(fixtureCommand("create trigger ce1_corrupt_earlier_index_after after insert on fx_app_index_entry_rev for each row execute function ce1_corrupt_earlier_index_after()"),
      () => fixtureCommand("drop trigger ce1_corrupt_earlier_index_after on fx_app_index_entry_rev").pipe(Effect.orDie));
    yield* Effect.tryPromise({ try: async () => {
      await caught(deletes, failure => {
        expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
          reason: Schema.Literal("storedCorruption"), phase: Schema.Literal("verify"), ordinal: Schema.Literal(0),
        })))(applicationDomainFailureDetail(failure.cause, "fx_apply_app_index_batch"))).toEqual({
          reason: "storedCorruption", phase: "verify", ordinal: 0,
        });
      });
      expect(await state()).toEqual(before);
    }, catch: cause => new Error("Index batch earlier-page AFTER witness", { cause }) }).pipe(Effect.uninterruptible);
  })));
  expect(await append(deletes)).toHaveLength(33);
  expect(
    await append(
      actions.map((action) => ({
        ...action,
        commitSeq: CommitSeqSchema.make(3n),
      })),
    ),
  ).toHaveLength(33);
  for (const [sequence, count] of [
    [1n, 33],
    [2n, 0],
    [3n, 33],
  ] as const) {
    const page = await db.transaction(async (tx) => {
      await runEffect(lockInstallationForCurrentTransaction(tx));
      try {
        return await runEffect(
          scanAppIndexAtSnapshotInTransactionEffect(tx, {
            scopeId,
            definition,
            bounds: {},
            limit: 100,
            snapshotCommitSeq: CommitSeqSchema.make(sequence),
          }),
        );
      } finally { closeInstallationAdmission(tx); }
    },
    );
    expect(page.entries).toHaveLength(count);
    if (count > 0)
      expect(page.entries.map((entry) => entry.rowId)).toEqual(
        actions.map((action) => action.rowId),
      );
  }
  const last = rows.at(-1);
  if (last === undefined) throw new Error("Missing last parent witness.");
  await db.transaction(async (tx) => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      return await runEffect(
        appendPreparedAppRowRevisionsInTransactionEffect(tx, [
          {
            ...last,
            kind: "tombstone",
            prevCommitSeq: CommitSeqSchema.make(1n),
            commitSeq: CommitSeqSchema.make(4n),
          },
        ]),
      );
    } finally { closeInstallationAdmission(tx); }
  },
  );
  await expect(
    append([
      {
        ...first,
        rowId: decodeOrderedIndexRowIdHexV1(last.rowId),
        commitSeq: CommitSeqSchema.make(4n),
        encodedKey: encodeAppOrderedIndexKeyV1({
          spec: definition.physicalSpec,
          values: [orderedIndexCreationTimeV1(43)],
        }),
      },
    ]),
  ).rejects.toMatchObject({ reason: "tombstonedLiveEntry" });
}
