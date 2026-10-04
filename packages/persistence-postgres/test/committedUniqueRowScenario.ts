import { eq, sql } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { expect } from "vitest";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { orderedIndexValueFromFlarexValueV1 } from "flarex-protocol/ordered-index";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, ScopeEpochSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { canonicalizeAppUniqueKeyV1Result, decodeAppUniqueConstraintIdV1Result,
  type AppUniqueKeyProjectionV1 } from "../src/appUniqueKeyContract";
import { AppUniqueKeyStorageCorruptionError, CanonicalAppUniqueKeyHashCollisionError,
  applyAppUniqueKeyMutationsInTransactionEffect, withCommittedAppUniqueKeyRowInTransactionEffect } from "../src/appUniqueKeys";
import { AppRowStorageCorruptionError, InvalidAppRowReadInputError,
  appendPreparedAppRowRevisionsInTransactionEffect } from "../src/appRows";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { fxAppRowRevisions, fxAppUniqueKeys, fxSystemScopeClocks } from "../src/schema";
import { insertCurrentScopeClockFixture } from "./scopeClockFixture";

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
  await database.transaction(tx => Effect.runPromise(Effect.gen(function* () {
    yield* appendPreparedAppRowRevisionsInTransactionEffect(tx, [{ kind: "live", scopeId, tableId, rowId,
      writeEpoch, commitSeq, prevCommitSeq: null, creationTime,
      schemaVersionId: decodeCatalogSchemaVersionId("schema_committed_unique_row"), document }]);
    yield* applyAppUniqueKeyMutationsInTransactionEffect(tx, [{ scopeId, tableId, rowId, constraintId,
      writeEpoch, previous: null, next: projection }]);
  })));
  const input = { scopeId, constraintId, key: projection, minimumCommitSeq: commitSeq,
    maximumIdentities: 1, maximumDocumentBytes: 1_048_576, maximumTotalValueBytes: 1_048_576 };
  const mapFailure = (cause: unknown) => cause;
  let queries = 0;
  let observedSql = "";
  const observer = (observation: { readonly sql: string }) => { queries++; observedSql = observation.sql; };
  // A claim is not a committed serving owner before its publication clock.
  await expect(database.transaction(tx => Effect.runPromise(withCommittedAppUniqueKeyRowInTransactionEffect(
    tx, input, mapFailure, mapFailure, capture => capture.readOwner, observer))))
    .rejects.toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
  await database.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq }).where(eq(fxSystemScopeClocks.scopeId, scopeId));
  queries = 0;
  let escaped: Effect.Effect<unknown, unknown> | undefined;
  const captured = await database.transaction(tx => Effect.runPromise(withCommittedAppUniqueKeyRowInTransactionEffect(
    tx, input, mapFailure, mapFailure, capture => Effect.gen(function* () {
      expect(Option.isSome(capture.owner) && capture.owner.value.rowId).toBe(rowId);
      escaped = capture.readOwner;
      const first = yield* capture.readOwner;
      expect(yield* capture.readOwner).toBe(first);
      return first;
    }), observer)));
  expect(queries).toBe(1);
  expect(captured.readAt).toBe(commitSeq);
  expect(captured.row.kind === "live" && captured.row.document.value).toEqual(document.value);
  if (escaped === undefined) throw new Error("Missing lazy owner read");
  await expect(Effect.runPromise(escaped)).rejects.toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
  expect(queries).toBe(1);

  queries = 0;
  const absent = await database.transaction(tx => Effect.runPromise(withCommittedAppUniqueKeyRowInTransactionEffect(
    tx, { ...input, key: key("absent") }, mapFailure, mapFailure,
    capture => Effect.succeed(capture.owner), observer)));
  expect(Option.isNone(absent)).toBe(true);
  expect(queries).toBe(1);
  queries = 0;
  const omitted = await database.transaction(tx => Effect.runPromise(withCommittedAppUniqueKeyRowInTransactionEffect(
    tx, { ...input, key: { sparse: true, localeKey: null, values: [{ kind: "missing" }] } },
    mapFailure, mapFailure, capture => Effect.succeed(capture.owner), observer)));
  expect(Option.isNone(omitted)).toBe(true);
  expect(queries).toBe(0);

  await expect(database.transaction(tx => Effect.runPromise(withCommittedAppUniqueKeyRowInTransactionEffect(
    tx, { ...input, maximumDocumentBytes: 1 }, mapFailure, mapFailure, capture => capture.readOwner, observer))))
    .rejects.toBeInstanceOf(InvalidAppRowReadInputError);
  expect(observedSql.toLowerCase()).toContain("case when");
  expect(observedSql.toLowerCase()).toContain("octet_length");

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
  await expect(database.transaction(tx => Effect.runPromise(withCommittedAppUniqueKeyRowInTransactionEffect(
    tx, input, mapFailure, mapFailure, capture => {
      opened = true; return capture.readOwner;
    })))).rejects.toBeInstanceOf(CanonicalAppUniqueKeyHashCollisionError);
  expect(opened).toBe(false);
  await database.update(fxAppUniqueKeys).set({ encodedKey: storedClaim.encodedKey })
    .where(eq(fxAppUniqueKeys.constraintId, constraintId));
  await expect(database.transaction(tx => Effect.runPromise(withCommittedAppUniqueKeyRowInTransactionEffect(
    tx, input, mapFailure, mapFailure, capture => capture.readOwner))))
    .rejects.toBeInstanceOf(AppRowStorageCorruptionError);
  await database.update(fxAppRowRevisions).set({ isTombstone: true, valueBytes: null, valueSha256: null })
    .where(eq(fxAppRowRevisions.tableId, tableId));
  await expect(database.transaction(tx => Effect.runPromise(withCommittedAppUniqueKeyRowInTransactionEffect(
    tx, input, mapFailure, mapFailure, capture => capture.readOwner))))
    .rejects.toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
}
