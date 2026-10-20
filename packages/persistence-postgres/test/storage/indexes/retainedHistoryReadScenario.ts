import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import { canonicalizeAppDocumentV1, type AppCreationTimeV1 } from "flarex-protocol/app-document";
import { appRowIdHexV1ToBytes, type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogSchemaVersionId, type CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, projectScopeIdUuidV1, type ScopeEpoch } from "flarex-protocol/storage-authority";
import { encodeAppOrderedIndexKeyV1, orderedIndexCreationTimeV1 } from "flarex-protocol/ordered-index";
import { decodeFlarexValueSha256V1 } from "flarex-protocol/value";
import { fxAppIndexEntryRevisions, fxAppRowRevisions } from "../../../src/database/schema";
import { AppRowRetainedReadLimitError, appendPreparedAppRowRevisionsInTransactionEffect,
  readRetainedAppRowRevisionsInTransactionEffect, type AppRowIdentityV1, type AppRowTransaction } from "../../../src/storage/documents/appRows";
import { AppRowStorageCorruptionError } from "../../../src/storage/documents/appRowErrors";
import { AppIndexRetainedReadLimitError, appendAppIndexEntryRevisionsInTransactionEffect,
  readRetainedAppIndexCandidatesInTransactionEffect } from "../../../src/storage/indexes/appIndexEntries";
import { AppIndexEntryStorageCorruptionError, InvalidAppIndexEntryInputError } from "../../../src/storage/indexes/appIndexEntryErrors";
import type { LocatedAppIndexDefinitionV1 } from "../../../src/storage/indexes/appIndexDefinitions";
import { inspectStoredAppDocumentEvidence } from "../../../src/storage/documents/appRowCanonicalEvidence";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

/** Shared ordinary PostgreSQL/PGlite proof using real catalog, row and index
 * writers. The directory retains deleted identities; it grants no replay. */
export async function verifyRetainedHistoryReads(tx: AppRowTransaction, input: {
  readonly identity: AppRowIdentityV1;
  readonly otherRowId: AppRowIdHexV1;
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly epoch: ScopeEpoch;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly creationTime: AppCreationTimeV1;
}) {
  const { identity, definition, epoch, schemaVersionId, creationTime } = input;
  const first = await canonicalizeAppDocumentV1({ tableId: identity.tableId, rowId: identity.rowId, creationTime,
    fields: { id: "recorded-native-156", amount: "40", updated_at: "2026-01-01T00:00:00.000Z" } });
  const second = await canonicalizeAppDocumentV1({ tableId: identity.tableId, rowId: identity.rowId, creationTime,
    fields: { id: "recorded-native-156", amount: "77", updated_at: "2026-01-02T00:00:00.000Z" } });
  const key = encodeAppOrderedIndexKeyV1({ spec: definition.physicalSpec, values: [orderedIndexCreationTimeV1(creationTime)] });
  for (const [sequence, previous, document] of [[1n, null, first], [3n, 1n, second]] as const) {
    await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, [{ kind: "live", ...identity, writeEpoch: epoch,
      commitSeq: CommitSeqSchema.make(sequence), prevCommitSeq: previous === null ? null : CommitSeqSchema.make(previous), schemaVersionId, creationTime, document }]));
    if (sequence === 1n) await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [{ kind: "live", scopeId: identity.scopeId,
      definition, encodedKey: key, rowId: identity.rowId, writeEpoch: epoch, commitSeq: CommitSeqSchema.make(sequence) }]));
  }
  await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, [{ kind: "tombstone", ...identity, writeEpoch: epoch,
    commitSeq: CommitSeqSchema.make(5n), prevCommitSeq: CommitSeqSchema.make(3n), schemaVersionId, creationTime }]));
  await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [{ kind: "tombstone", scopeId: identity.scopeId,
    definition, encodedKey: key, rowId: identity.rowId, writeEpoch: epoch, commitSeq: CommitSeqSchema.make(5n) }]));

  const rowInput = { ...identity, schemaVersionId, maximumCommitSeq: CommitSeqSchema.make(5n),
    maximumRevisions: 8, maximumDocumentBytes: 65_536, maximumTotalValueBytes: 262_144 };
  const revisions = await runEffect(readRetainedAppRowRevisionsInTransactionEffect(tx, rowInput));
  expect(revisions.map(row => [row.kind, row.commitSeq])).toEqual([["tombstone", 5n], ["live", 3n], ["live", 1n]]);
  for (const revision of revisions) {
    expect(revision.rowId).toBe(identity.rowId); expect(revision.creationTime).toBe(creationTime); expect(revision.schemaVersionId).toBe(schemaVersionId);
    if (revision.kind === "live") expect(inspectStoredAppDocumentEvidence(revision.document)).toMatchObject({ _tag: "Success", success: { runtime: revision.document.value } });
  }
  expect((await runEffect(readRetainedAppRowRevisionsInTransactionEffect(tx, { ...rowInput, maximumCommitSeq: CommitSeqSchema.make(2n) })))
    .map(row => row.commitSeq)).toEqual([1n]);
  expect(await runEffect(readRetainedAppRowRevisionsInTransactionEffect(tx, { ...rowInput, schemaVersionId: decodeCatalogSchemaVersionId("wrong-recorded-schema") }))).toEqual([]);
  expect(await runEffect(readRetainedAppRowRevisionsInTransactionEffect(tx, { ...rowInput, rowId: input.otherRowId }))).toEqual([]);
  for (const reduction of [{ maximumRevisions: 2 }, { maximumDocumentBytes: 1 }, { maximumTotalValueBytes: 0 }])
    expect(await runEffectFailure(readRetainedAppRowRevisionsInTransactionEffect(tx, { ...rowInput, ...reduction }))).toBeInstanceOf(AppRowRetainedReadLimitError);

  const indexInput = { scopeId: identity.scopeId, definition, bounds: {}, maximumCommitSeq: CommitSeqSchema.make(5n),
    maximumEntries: 8, maximumIdentities: 8, maximumTotalKeyBytes: 262_144 };
  const positions = await runEffect(readRetainedAppIndexCandidatesInTransactionEffect(tx, indexInput));
  expect(positions.map(row => [row.rowId, row.kind, row.commitSeq])).toEqual([[identity.rowId, "tombstone", 5n], [identity.rowId, "live", 1n]]);
  expect((await runEffect(readRetainedAppIndexCandidatesInTransactionEffect(tx, { ...indexInput, maximumCommitSeq: CommitSeqSchema.make(2n) })))
    .map(row => row.commitSeq)).toEqual([1n]);
  for (const reduction of [{ maximumEntries: 1 }, { maximumTotalKeyBytes: 0 }])
    expect(await runEffectFailure(readRetainedAppIndexCandidatesInTransactionEffect(tx, { ...indexInput, ...reduction }))).toBeInstanceOf(AppIndexRetainedReadLimitError);
  expect(await runEffectFailure(readRetainedAppIndexCandidatesInTransactionEffect(tx, { ...indexInput, definition: { ...definition } })))
    .toBeInstanceOf(InvalidAppIndexEntryInputError);

  const otherDocument = await canonicalizeAppDocumentV1({ tableId: identity.tableId, rowId: input.otherRowId, creationTime, fields: { id: "other-native-156" } });
  await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, [{ kind: "live", ...identity, rowId: input.otherRowId,
    writeEpoch: epoch, commitSeq: CommitSeqSchema.make(7n), prevCommitSeq: null, schemaVersionId, creationTime, document: otherDocument }]));
  await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [{ kind: "live", scopeId: identity.scopeId,
    definition, encodedKey: key, rowId: input.otherRowId, writeEpoch: epoch, commitSeq: CommitSeqSchema.make(7n) }]));
  expect(await runEffectFailure(readRetainedAppIndexCandidatesInTransactionEffect(tx, {
    ...indexInput, maximumCommitSeq: CommitSeqSchema.make(7n), maximumIdentities: 1,
  }))).toMatchObject({ _tag: "AppIndexRetainedReadLimitError", limit: "identities" });

  // Corruption controls change real stored evidence after the successful reads;
  // both accepting operations must retain their canonical/hash checks.
  const scopeUuid = projectScopeIdUuidV1(identity.scopeId).scopeUuid;
  await tx.update(fxAppRowRevisions).set({ valueSha256: decodeFlarexValueSha256V1(new Uint8Array(32)) }).where(and(
    eq(fxAppRowRevisions.scopeUuid, scopeUuid), eq(fxAppRowRevisions.tableId, identity.tableId),
    eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(identity.rowId)), eq(fxAppRowRevisions.commitSeq, CommitSeqSchema.make(1n))));
  expect(await runEffectFailure(readRetainedAppRowRevisionsInTransactionEffect(tx, rowInput))).toBeInstanceOf(AppRowStorageCorruptionError);
  await tx.update(fxAppIndexEntryRevisions).set({ keySha256: new Uint8Array(32) }).where(and(
    eq(fxAppIndexEntryRevisions.scopeUuid, scopeUuid), eq(fxAppIndexEntryRevisions.indexDefinitionId, definition.indexDefinitionId)));
  expect(await runEffectFailure(readRetainedAppIndexCandidatesInTransactionEffect(tx, indexInput))).toBeInstanceOf(AppIndexEntryStorageCorruptionError);
}
