import { eq, sql } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { expect, vi } from "vitest";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { orderedIndexValueFromFlarexValueV1 } from "flarex-protocol/ordered-index";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, ScopeEpochSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { canonicalizeAppUniqueKeyV1Result, decodeAppUniqueConstraintIdV1Result,
  type AppUniqueKeyProjectionV1 } from "../../../src/storage/unique/appUniqueKeyContract";
import {
  AppUniqueKeyStorageCorruptionError,
  applyAppUniqueKeyMutationsInTransactionEffect,
  readAppUniqueKeySlotInTransactionEffect,
  withAppUniqueKeySlotsInTransactionEffect,
} from "../../../src/storage/unique/appUniqueKeys";
import {
  CanonicalAppUniqueKeyHashCollisionError,
} from "../../../src/storage/unique/appUniqueKeyErrors";
import {
  AppRowStorageCorruptionError,
} from "../../../src/storage/documents/appRowErrors";
import {
  InvalidAppRowReadInputError,
  appendPreparedAppRowRevisionsInTransactionEffect,
  readBoundedCurrentAppRowsInTransactionEffect,
} from "../../../src/storage/documents/appRows";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import { fxAppRowRevisions, fxAppUniqueKeys, fxSystemScopeClocks } from "../../../src/database/schema";
import { insertCurrentScopeClockFixture } from "../../scope/scopeClockFixture";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../../../src/installation/installationLifecycle";
import { lockScopeClockForOrdinaryWriteInTransactionEffect } from "../../../src/scope/scopeClock";

/** Real committed storage shared by owner PGlite and restricted-login PG. */
export async function committedUniqueRowScenario(database: FlarexMetadataDatabase) {
  const scopeId = ScopeIdSchema.make("scope_58000000-0000-0000-0000-000000000001");
  const writeEpoch = ScopeEpochSchema.make("epoch_58000000-0000-0000-0000-000000000002");
  const tableId = decodeCatalogTableId(58);
  const rowId = decodeAppRowIdHexV1("58000000000000000000000000000003");
  const constraintId = Result.getOrThrow(decodeAppUniqueConstraintIdV1Result(58));
  const commitSeq = CommitSeqSchema.make(1n);
  const creationTime = decodeAppCreationTimeV1(58);
  const key = (value: string): AppUniqueKeyProjectionV1 => ({ sparse: true, localeKey: null,
    values: [orderedIndexValueFromFlarexValueV1(value)] });
  const projection = key("owner");
  const document = await canonicalizeAppDocumentV1({ tableId, rowId, creationTime,
    fields: { name: "owner", value: 58 } });
  await insertCurrentScopeClockFixture(database, { scopeId, epoch: writeEpoch });
  const inTransaction = <A, E>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
    database.transaction(tx => Effect.runPromise(lockInstallationForCurrentTransaction(tx).pipe(
      Effect.andThen(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId)),
      Effect.andThen(work(tx)), Effect.ensuring(Effect.sync(() => closeInstallationAdmission(tx))))));
  await inTransaction(tx => Effect.gen(function* () {
    yield* appendPreparedAppRowRevisionsInTransactionEffect(tx, [{ kind: "live", scopeId, tableId, rowId,
      writeEpoch, commitSeq, prevCommitSeq: null, creationTime,
      schemaVersionId: decodeCatalogSchemaVersionId("schema_committed_unique_row"), document }]);
    yield* applyAppUniqueKeyMutationsInTransactionEffect(tx, [{ scopeId, tableId, rowId, constraintId,
      writeEpoch, previous: null, next: projection }]);
  }));
  const input = { scopeId, constraintId, key: projection };
  const rowInput = { scopeId, tableId, rowId, minimumCommitSeq: commitSeq,
    maximumIdentities: 1, maximumDocumentBytes: 1_048_576, maximumTotalValueBytes: 1_048_576 };
  // A claim is not a committed serving owner before its publication clock.
  await expect(inTransaction(tx => readAppUniqueKeySlotInTransactionEffect(tx, input)))
    .rejects.toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
  await database.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq }).where(eq(fxSystemScopeClocks.scopeId, scopeId));
  await inTransaction(tx => Effect.gen(function* () {
    const prepare = tx._.session.prepareQuery.bind(tx._.session);
    let slotQueries = 0;
    const slotStatements: string[] = [];
    const spy = vi.spyOn(tx._.session, "prepareQuery").mockImplementation((...args) => {
      if (args[0].sql.includes("fx_app_unique_key")) { slotQueries++; slotStatements.push(args[0].sql); }
      return prepare(...args);
    });
    let escaped: Effect.Effect<unknown, unknown> | undefined;
    try {
      const captured = yield* withAppUniqueKeySlotsInTransactionEffect(tx, [input], cause => cause,
        capture => Effect.gen(function* () {
          escaped = capture.read(0);
          const owner = yield* capture.read(0);
          expect(Option.isSome(owner) && owner.value.rowId).toBe(rowId);
          expect(Option.isSome(owner) && owner.value.ownerCommitSeq).toBe(commitSeq);
          expect(yield* capture.read(0)).toEqual(owner);
          return owner;
        }));
      expect(captured).toHaveLength(1);
      expect(slotQueries).toBe(1);
      expect(slotStatements[0]).not.toContain("value_bytes");
      if (escaped === undefined) return yield* Effect.die(new Error("Missing lazy slot read"));
      expect(yield* Effect.result(escaped)).toMatchObject({ _tag: "Failure", failure: { _tag: "AppUniqueKeyStorageCorruptionError" } });
      expect(slotQueries).toBe(1);
      const row = yield* readBoundedCurrentAppRowsInTransactionEffect(tx, rowInput);
      expect(row.commitSeq).toBe(commitSeq);
      expect(row.rows[0]?.kind === "live" && row.rows[0].document.value).toEqual(document.value);
      slotQueries = 0;
      expect(Option.isNone(yield* readAppUniqueKeySlotInTransactionEffect(tx, { ...input, key: key("absent") }))).toBe(true);
      expect(slotQueries).toBe(1);
      slotQueries = 0;
      expect(Option.isNone(yield* readAppUniqueKeySlotInTransactionEffect(tx, { ...input,
        key: { sparse: true, localeKey: null, values: [{ kind: "missing" }] } }))).toBe(true);
      expect(slotQueries).toBe(0);
    } finally { spy.mockRestore(); }
  }));
  await expect(inTransaction(tx => readBoundedCurrentAppRowsInTransactionEffect(tx, { ...rowInput, maximumDocumentBytes: 1 })))
    .rejects.toBeInstanceOf(InvalidAppRowReadInputError);

  // Both bodies are corrupt; slot/key refusal must prevent lazy row decoding.
  const [storedClaim] = await database.select().from(fxAppUniqueKeys).where(eq(fxAppUniqueKeys.constraintId, constraintId));
  if (storedClaim === undefined) throw new Error("Missing committed claim");
  const different = Result.getOrThrow(canonicalizeAppUniqueKeyV1Result(key("different")));
  if (different.kind !== "claim") throw new Error("Missing alternate canonical key");
  await database.update(fxAppUniqueKeys).set({ encodedKey: different.canonicalKeyBytes })
    .where(eq(fxAppUniqueKeys.constraintId, constraintId));
  await database.update(fxAppRowRevisions).set({ valueBytes: sql`pg_catalog.decode('ff','hex')` })
    .where(eq(fxAppRowRevisions.tableId, tableId));
  let opened = false;
  await expect(inTransaction(tx => Effect.gen(function* () {
    yield* readAppUniqueKeySlotInTransactionEffect(tx, input);
    opened = true;
    return yield* readBoundedCurrentAppRowsInTransactionEffect(tx, rowInput);
  }))).rejects.toBeInstanceOf(CanonicalAppUniqueKeyHashCollisionError);
  expect(opened).toBe(false);
  await database.update(fxAppUniqueKeys).set({ encodedKey: storedClaim.encodedKey })
    .where(eq(fxAppUniqueKeys.constraintId, constraintId));
  // Slot acceptance does not decode a row body or grant its byte allowance.
  await expect(inTransaction(tx => Effect.gen(function* () {
    const owner = yield* readAppUniqueKeySlotInTransactionEffect(tx, input);
    expect(Option.isSome(owner)).toBe(true);
    return yield* readBoundedCurrentAppRowsInTransactionEffect(tx, { ...rowInput, maximumTotalValueBytes: 0 });
  }))).rejects.toBeInstanceOf(InvalidAppRowReadInputError);
  await expect(inTransaction(tx => Effect.gen(function* () {
    yield* readAppUniqueKeySlotInTransactionEffect(tx, input);
    return yield* readBoundedCurrentAppRowsInTransactionEffect(tx, rowInput);
  })))
    .rejects.toBeInstanceOf(AppRowStorageCorruptionError);
  await database.update(fxAppRowRevisions).set({ isTombstone: true, valueBytes: null, valueSha256: null })
    .where(eq(fxAppRowRevisions.tableId, tableId));
  await expect(inTransaction(tx => readAppUniqueKeySlotInTransactionEffect(tx, input)))
    .rejects.toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
}
