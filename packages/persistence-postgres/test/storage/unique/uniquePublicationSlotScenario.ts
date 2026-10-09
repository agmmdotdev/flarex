import { expect } from "vitest";
import { Effect, Option, Result } from "effect";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { appRowIdHexV1ToBytes, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { orderedIndexValueFromFlarexValueV1 } from "flarex-protocol/ordered-index";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, ScopeEpochSchema, ScopeIdSchema, projectScopeEpochUuidV1,
  projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { decodeAppUniqueConstraintIdV1Result } from "../../../src/storage/unique/appUniqueKeyContract";
import { AppUniqueKeyStorageCorruptionError, applyAppUniqueKeyMutationsInTransactionEffect,
  withAppUniqueKeySlotsInTransactionEffect, readAppUniqueKeySlotInTransactionEffect } from "../../../src/storage/unique/appUniqueKeys";
import { AppRowStorageCorruptionError, appendPreparedAppRowRevisionsInTransactionEffect,
  readBoundedCurrentAppRowsInTransactionEffect, readBoundedPublicationAppRowsInTransactionEffect } from "../../../src/storage/documents/appRows";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { fxSystemCommits, fxSystemCommitAppRowChanges } from "../../../src/database/schema";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { insertCurrentScopeClockFixtureInTransaction } from "../../scope/scopeClockFixture";

const scopeId = ScopeIdSchema.make("scope_5c000000-0000-0000-0000-000000000001");
const epoch = ScopeEpochSchema.make("epoch_5c000000-0000-0000-0000-000000000002");
const tableId = decodeCatalogTableId(1);
const rowId = decodeAppRowIdHexV1("5c00000000000000000000000000000a");
const schemaVersionId = decodeCatalogSchemaVersionId("schema_publication_slot");
const constraintId = Result.getOrThrow(decodeAppUniqueConstraintIdV1Result(1));
const committed = CommitSeqSchema.make(100n);
const pending = CommitSeqSchema.make(101n);
const key = { sparse: false, localeKey: null,
  values: [orderedIndexValueFromFlarexValueV1("product-1")] } as const;

/** Tests only the shared slot owner's transaction-local final-state rule.
 * Host admission, scope locking and complete publication are separate proofs. */
export async function verifyPublicationSlotFinalState(tx: FlarexMetadataTransaction): Promise<void> {
  const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
  const epochUuid = projectScopeEpochUuidV1(epoch).epochUuid;
  await insertCurrentScopeClockFixtureInTransaction(tx, { scopeId, lastCommitSeq: committed, epoch });
  const creationTime = decodeAppCreationTimeV1(1_725_000_000_300.75);
  const document = await canonicalizeAppDocumentV1({ tableId, rowId, creationTime,
    fields: { id: "product-1" } });
  await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, [{ kind: "live", scopeId,
    tableId, rowId, writeEpoch: epoch, commitSeq: pending, prevCommitSeq: null,
    schemaVersionId, creationTime, document }]));
  await runEffect(applyAppUniqueKeyMutationsInTransactionEffect(tx, [{ scopeId, constraintId,
    tableId, rowId, writeEpoch: epoch, previous: null, next: key }]));

  const selection = { scopeId, constraintId, key };
  const bounded = { scopeId, tableId, minimumCommitSeq: committed, maximumIdentities: 1,
    maximumDocumentBytes: 65_536, maximumTotalValueBytes: 65_536, rowIds: [rowId] };
  expect(await runEffectFailure(readBoundedCurrentAppRowsInTransactionEffect(tx, bounded)))
    .toBeInstanceOf(AppRowStorageCorruptionError);
  expect(await runEffectFailure(readBoundedPublicationAppRowsInTransactionEffect(tx,
    { ...bounded, pendingCommitSeq: pending }))).toBeInstanceOf(AppRowStorageCorruptionError);
  expect(await runEffectFailure(readAppUniqueKeySlotInTransactionEffect(tx, selection)))
    .toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
  expect(await runEffectFailure(withAppUniqueKeySlotsInTransactionEffect(tx,
    [{ ...selection, pendingCommitSeq: pending }], cause => cause, capture => capture.read(0)).pipe(Effect.map(owners => owners[0]!)))).toBeInstanceOf(AppUniqueKeyStorageCorruptionError);

  await tx.insert(fxSystemCommits).values({ scopeUuid, epochUuid, commitSeq: pending, changeCount: 1 });
  await tx.insert(fxSystemCommitAppRowChanges).values({ scopeUuid, epochUuid, commitSeq: pending,
    changeOrdinal: 0, tableId, rowId: appRowIdHexV1ToBytes(rowId) });
  const current = await runEffect(readBoundedPublicationAppRowsInTransactionEffect(tx,
    { ...bounded, pendingCommitSeq: pending }));
  expect(current.commitSeq).toBe(committed);
  expect(current.rows).toMatchObject([{ kind: "live", rowId, commitSeq: pending }]);
  expect(await runEffectFailure(readBoundedCurrentAppRowsInTransactionEffect(tx, bounded)))
    .toBeInstanceOf(AppRowStorageCorruptionError);
  expect(await runEffectFailure(readBoundedPublicationAppRowsInTransactionEffect(tx,
    { ...bounded, pendingCommitSeq: CommitSeqSchema.make(102n) }))).toBeInstanceOf(AppRowStorageCorruptionError);
  const slot = await runEffect(withAppUniqueKeySlotsInTransactionEffect(tx,
    [{ ...selection, pendingCommitSeq: pending }], cause => cause, capture => capture.read(0)).pipe(Effect.map(owners => owners[0]!)));
  expect(Option.isSome(slot)).toBe(true);
  if (Option.isSome(slot)) expect(slot.value).toMatchObject({ tableId, rowId, ownerCommitSeq: pending });
  expect(await runEffectFailure(readAppUniqueKeySlotInTransactionEffect(tx, selection)))
    .toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
  expect(await runEffectFailure(withAppUniqueKeySlotsInTransactionEffect(tx,
    [{ ...selection, pendingCommitSeq: CommitSeqSchema.make(102n) }], cause => cause, capture => capture.read(0)).pipe(Effect.map(owners => owners[0]!))))
    .toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
}
