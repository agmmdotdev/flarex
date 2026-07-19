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
import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  AppRowReadPersistenceError,
  AppRowCreationTimeConflictError,
  AppRowRevisionChainConflictError,
  AppRowStorageCorruptionError,
  InvalidAppRowReadInputError,
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
  getAppRowAtSnapshotInTransactionEffect,
  readAppRowAtSnapshotInTransactionEffect,
  readCurrentAppRowInTransactionEffect,
  type AppendAppRowRevisionV1Input,
  type AppRowIdentityV1,
  type AppRowReadResultV1,
  type AppRowTransaction,
  type AppRowValueEvidenceV1,
  type ReadAppRowError,
} from "../src/appRows";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

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
        runEffect(readCurrentAppRowInTransactionEffect(tx, identity)),
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

  it("projects exact point reads into present and qualified missing dependencies", async () => {
    const persistence = await appRowPersistence();
    const first = await canonicalDocument({ title: "first" });
    const replacement = await canonicalDocument({ title: "replacement" });
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
      kind: "tombstone",
      ...identity,
      writeEpoch: firstEpoch,
      commitSeq: CommitSeqSchema.make(3n),
      prevCommitSeq: CommitSeqSchema.make(1n),
      schemaVersionId,
      creationTime,
    });
    await append(persistence, {
      kind: "live",
      ...identity,
      writeEpoch: firstEpoch,
      commitSeq: CommitSeqSchema.make(5n),
      prevCommitSeq: CommitSeqSchema.make(3n),
      schemaVersionId,
      creationTime,
      value: evidence(replacement),
    });

    await expect(pointReadAt(persistence, 0n)).resolves.toEqual({
      kind: "missing",
      document: null,
      dependency: {
        kind: "missing",
        identity,
        basis: { kind: "noVisibleRevision" },
      },
    });

    const present = await pointReadAt(persistence, 1n);
    expect(present).toMatchObject({
      kind: "present",
      document: { value: { title: "first" } },
      dependency: {
        kind: "present",
        identity,
        revisionCommitSeq: 1n,
      },
    });
    expect(Object.isFrozen(present)).toBe(true);
    expect(Object.isFrozen(present.dependency)).toBe(true);
    expect(Object.isFrozen(present.dependency.identity)).toBe(true);

    await expect(pointReadAt(persistence, 3n)).resolves.toEqual({
      kind: "missing",
      document: null,
      dependency: {
        kind: "missing",
        identity,
        basis: { kind: "tombstone", revisionCommitSeq: 3n },
      },
    });
    await expect(pointReadAt(persistence, 4n)).resolves.toEqual({
      kind: "missing",
      document: null,
      dependency: {
        kind: "missing",
        identity,
        basis: { kind: "tombstone", revisionCommitSeq: 3n },
      },
    });
    await expect(pointReadAt(persistence, 5n)).resolves.toMatchObject({
      kind: "present",
      document: { value: { title: "replacement" } },
      dependency: { kind: "present", revisionCommitSeq: 5n },
    });

    await persistence.query(
      `update fx_system_scope_clock set epoch = $2 where scope_id = $1`,
      [scopeId, secondEpoch],
    );
    await expect(pointReadAt(persistence, 5n, secondEpoch)).resolves.toMatchObject(
      {
        kind: "present",
        dependency: { kind: "present", revisionCommitSeq: 5n },
      },
    );

    const counts = await persistence.query<{ revisions: string }>(
      `select count(*)::text as revisions from fx_app_row_rev`,
    );
    expect(counts.rows).toEqual([{ revisions: "3" }]);
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
        runEffect(readAppRowAtSnapshotInTransactionEffect(tx, {
          scopeId: otherScopeId,
          tableId,
          rowId,
          snapshotCommitSeq: CommitSeqSchema.make(1n),
        })),
      ),
    ).resolves.toEqual({ kind: "missing" });
    await expect(
      pointReadAt(
        persistence,
        1n,
        ScopeEpochSchema.make("epoch_50000000-0000-0000-0000-000000000012"),
        otherScopeId,
      ),
    ).resolves.toEqual({
      kind: "missing",
      document: null,
      dependency: {
        kind: "missing",
        identity: { scopeId: otherScopeId, tableId, rowId },
        basis: { kind: "noVisibleRevision" },
      },
    });
    await expect(
      pointReadAt(persistence, 1n, firstEpoch, scopeId, otherTableId),
    ).resolves.toEqual({
      kind: "missing",
      document: null,
      dependency: {
        kind: "missing",
        identity: { scopeId, tableId: otherTableId, rowId },
        basis: { kind: "noVisibleRevision" },
      },
    });
    await expect(
      persistence.drizzle.transaction((tx) =>
        runEffect(readAppRowAtSnapshotInTransactionEffect(tx, {
          scopeId,
          tableId: otherTableId,
          rowId,
          snapshotCommitSeq: CommitSeqSchema.make(1n),
        })),
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
        runEffect(readCurrentAppRowInTransactionEffect(tx, identity)),
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
    const legacyExit = await persistence.drizzle.transaction((tx) =>
      runEffect(Effect.exit(
        readAppRowAtSnapshotInTransactionEffect(tx, {
          scopeId: legacyScope,
          tableId,
          rowId,
          snapshotCommitSeq: CommitSeqSchema.make(0n),
        }),
      )),
    );
    expect(Exit.isFailure(legacyExit)).toBe(true);
    if (Exit.isFailure(legacyExit)) {
      expect(Cause.hasFails(legacyExit.cause)).toBe(true);
      expect(Cause.hasDies(legacyExit.cause)).toBe(false);
      const failure = Cause.findErrorOption(legacyExit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value).toBeInstanceOf(InvalidAppRowReadInputError);
        expect(failure.value).toMatchObject({
          issue: { reason: "invalidScopeId" },
        });
      }
    }

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
        runEffect(readCurrentAppRowInTransactionEffect(tx, {
          scopeId,
          tableId,
          rowId: corruptionRowId,
        })),
      ),
    ).rejects.toBeInstanceOf(AppRowStorageCorruptionError);
    await expect(
      pointReadAt(
        persistence,
        1n,
        firstEpoch,
        scopeId,
        tableId,
        corruptionRowId,
      ),
    ).rejects.toBeInstanceOf(AppRowStorageCorruptionError);
  });

  it("exposes the read kernel as a typed lazy Effect", () => {
    let queryConstructed = false;
    const tx = {
      select(): never {
        queryConstructed = true;
        throw new Error("the lazy read was executed");
      },
    } as unknown as AppRowTransaction;
    const effect: Effect.Effect<AppRowReadResultV1, ReadAppRowError> =
      readAppRowAtSnapshotInTransactionEffect(tx, {
        ...identity,
        snapshotCommitSeq: CommitSeqSchema.make(1n),
      });

    expect(Effect.isEffect(effect)).toBe(true);
    expect(queryConstructed).toBe(false);
  });

  it("rejects invalid read input before constructing SQL", async () => {
    let queryConstructed = false;
    const tx = {
      select(): never {
        queryConstructed = true;
        throw new Error("invalid input reached SQL construction");
      },
    } as unknown as AppRowTransaction;

    const failure = await runEffectFailure(
      readAppRowAtSnapshotInTransactionEffect(tx, {
        ...identity,
        tableId: 0 as typeof tableId,
        snapshotCommitSeq: CommitSeqSchema.make(1n),
      }),
    );

    expect(failure).toBeInstanceOf(InvalidAppRowReadInputError);
    expect(failure).toMatchObject({ issue: { reason: "invalidTableId" } });
    expect(queryConstructed).toBe(false);
  });

  it("maps a rejected revision query into the typed persistence channel", async () => {
    const rejection = new Error("revision query rejected");
    let readCount = 0;
    const tx = appRowSelectTransaction(() => {
      readCount += 1;
      return readCount === 1
        ? Promise.resolve([{
            scopeId,
            scopeUuid: "50000000-0000-0000-0000-000000000001",
          }])
        : Promise.reject(rejection);
    });

    const failure = await runEffectFailure(
      readAppRowAtSnapshotInTransactionEffect(tx, {
        ...identity,
        snapshotCommitSeq: CommitSeqSchema.make(1n),
      }),
    );

    expect(failure).toBeInstanceOf(AppRowReadPersistenceError);
    expect(failure).toMatchObject({
      operation: "readSnapshotRevision",
      cause: rejection,
    });
  });

  it("preserves query construction exceptions as defects", async () => {
    const defect = new Error("app-row query construction defect");
    const tx = {
      select(): never {
        throw defect;
      },
    } as unknown as AppRowTransaction;

    const exit = await Effect.runPromiseExit(
      readAppRowAtSnapshotInTransactionEffect(tx, {
        ...identity,
        snapshotCommitSeq: CommitSeqSchema.make(1n),
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  it("waits for a pending database read before interruption completes", async () => {
    const entered = deferredValue<void>();
    const query = deferredValue<ReadonlyArray<unknown>>();
    const tx = appRowSelectTransaction(() => {
      entered.resolve(undefined);
      return query.promise;
    });
    const fiber = Effect.runFork(
      readAppRowAtSnapshotInTransactionEffect(tx, {
        ...identity,
        snapshotCommitSeq: CommitSeqSchema.make(1n),
      }),
    );

    await entered.promise;
    const completion = runEffect(Fiber.await(fiber));
    let interruptionSettled = false;
    const interruption = runEffect(Fiber.interrupt(fiber)).then(() => {
      interruptionSettled = true;
    });
    try {
      await delay(25);
      expect(interruptionSettled).toBe(false);
    } finally {
      query.resolve([]);
    }

    await interruption;
    const exit = await completion;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
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
    type ForbiddenPointReadKey = Extract<
      keyof PGliteFlarexPersistence,
      "getAppRowAtSnapshot"
    >;
    const hasNoAmbientMutation: [ForbiddenMutationKey] extends [never]
      ? true
      : false = true;
    const hasNoAmbientPointRead: [ForbiddenPointReadKey] extends [never]
      ? true
      : false = true;
    expect(hasNoAmbientMutation).toBe(true);
    expect(hasNoAmbientPointRead).toBe(true);
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
    runEffect(readAppRowAtSnapshotInTransactionEffect(tx, {
      ...identity,
      snapshotCommitSeq: CommitSeqSchema.make(commitSeq),
    })),
  );
}

async function pointReadAt(
  persistence: PGliteFlarexPersistence,
  commitSeq: bigint,
  epoch = firstEpoch,
  selectedScopeId = scopeId,
  selectedTableId = tableId,
  selectedRowId = rowId,
) {
  return persistence.drizzle.transaction((tx) =>
    runEffect(getAppRowAtSnapshotInTransactionEffect(tx, {
      snapshotToken: SnapshotTokenSchema.make({
        scopeId: selectedScopeId,
        epoch,
        commitSeq: CommitSeqSchema.make(commitSeq),
      }),
      tableId: selectedTableId,
      rowId: selectedRowId,
    })),
  );
}

function appRowSelectTransaction(
  read: () => PromiseLike<ReadonlyArray<unknown>>,
): AppRowTransaction {
  const query = {
    from() {
      return query;
    },
    where() {
      return query;
    },
    orderBy() {
      return query;
    },
    limit() {
      return read();
    },
  };
  return {
    select() {
      return query;
    },
  } as unknown as AppRowTransaction;
}

function deferredValue<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
