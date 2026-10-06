import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../src/installationLifecycle";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { expect, vi } from "vitest";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { appRowIdHexV1ToBytes, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { decodeOrderedIndexBoundHexV1, encodeAppOrderedIndexKeyV1, orderedIndexCreationTimeV1 } from "flarex-protocol/ordered-index";
import { CommitSeqSchema, type ScopeEpoch, type ScopeId } from "flarex-protocol/storage-authority";
import type { LocatedAppIndexDefinitionV1 } from "../src/appIndexDefinitions";
import { appendAppIndexEntryRevisionsInTransactionEffect } from "../src/appIndexEntries";
import { appendPreparedAppRowRevisionsInTransactionEffect, consumeAppTableWriteFrontiersInTransactionEffect } from "../src/appRows";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { validateLogicalDocumentChanges, type LogicalDocumentConflictObservation } from "../src/logicalDocuments/contribution";
import { readLogicalIndexRange } from "../src/logicalDocuments/indexReads";
import type { LogicalDocumentFailureReason } from "../src/logicalDocuments/model";
import type { LogicalDocumentChanges } from "../src/logicalDocuments/workingSet";
import { fxAppIndexEntryRevisions } from "../src/schema";
import { closeExactAttemptScopeClockObservation, lockScopeClockRowsForOrdinaryWriteInTransactionEffect } from "../src/scopeClock";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

type Failure = Readonly<{ reason: LogicalDocumentFailureReason; cause?: unknown; observation?: LogicalDocumentConflictObservation }>;
const error = (reason: LogicalDocumentFailureReason, cause?: unknown): Failure => ({ reason, ...(cause === undefined ? {} : { cause }) });
const empty: LogicalDocumentChanges = { changes: [], dependencies: [], attempts: [], lifecycle: [], observedRows: [],
  noFinalRows: [], scans: [], uniqueReads: [], indexReads: [], pageReads: [], searchReads: [], setNull: [], referenceReplacements: [] };

/** Real issued developer definition and storage in both drivers. All witness
 * rows roll back, preserving the owning membership scenario's original state. */
export async function verifyLogicalDependencyValidation(db: FlarexMetadataDatabase, scopeId: ScopeId,
  epoch: ScopeEpoch, definition: LocatedAppIndexDefinitionV1) {
  const tableId = definition.access.tableId;
  const creationTime = decodeAppCreationTimeV1(42);
  const encodedKey = encodeAppOrderedIndexKeyV1({ spec: definition.physicalSpec,
    values: [{ kind: "string", value: "batch-dependency" }, orderedIndexCreationTimeV1(42)] });
  const rowIds = [16, 17, 18].map(ordinal => decodeAppRowIdHexV1(ordinal.toString(16).padStart(32, "0")));
  const rows = await Promise.all(rowIds.map(async rowId => ({ kind: "live" as const, scopeId, writeEpoch: epoch,
    tableId, rowId, creationTime, schemaVersionId: decodeCatalogSchemaVersionId("dependency_batch"),
    commitSeq: CommitSeqSchema.make(3n), prevCommitSeq: null,
    document: await canonicalizeAppDocumentV1({ tableId, rowId, creationTime, fields: { title: "batch-dependency" } }),
  })));
  const rollback = new Error("dependency validation witness rollback");
  await expect(db.transaction(async tx => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      await runEffect(lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, scopeId));
      await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, rows));
      await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, rowIds.map(rowId => ({
        kind: "live", scopeId, writeEpoch: epoch, definition, rowId, encodedKey, commitSeq: CommitSeqSchema.make(3n),
      }))));
      const input = {
        tx, scopeId, tables: new Set([tableId]), maximumIndexEntries: 4096, error,
        conflict: (observation: LogicalDocumentConflictObservation): Failure => ({ reason: "writeConflict", observation })
      };
      const entries = await runEffect(readLogicalIndexRange(tx, scopeId, { definition, bounds: {} }, 4096, error));
      expect(entries).toHaveLength(3);
      const read = { definition, bounds: {}, entries };
      const negative = {
        definition, bounds: {
          startInclusive: decodeOrderedIndexBoundHexV1(encodedKey),
          endExclusive: decodeOrderedIndexBoundHexV1(encodedKey)
        }, entries: []
      };
      const execute = vi.spyOn(tx, "execute");
      try {
        await runEffect(validateLogicalDocumentChanges(input, {
          ...empty,
          scans: Array.from({ length: 12 }, () => ({ tableId, frontier: CommitSeqSchema.make(3n) })),
          indexReads: [read, ...Array.from({ length: 12 }, () => negative)]
        }));
        expect(execute).toHaveBeenCalledTimes(2); // one frontier and one bounded page command
      } finally { execute.mockRestore(); }
      expect(await runEffectFailure(validateLogicalDocumentChanges(input,
        { ...empty, indexReads: [{ ...read, entries: [] }] })))
        .toMatchObject({ reason: "writeConflict", observation: { readKind: "indexRange", dependencyOrdinal: 0 } });
      expect(await runEffectFailure(validateLogicalDocumentChanges({ ...input, maximumIndexEntries: 2 },
        { ...empty, indexReads: [{ ...read, entries: [] }] }))).toMatchObject({ reason: "limitExceeded" });
      expect(await runEffectFailure(validateLogicalDocumentChanges(input, {
        ...empty,
        scans: [{ tableId, frontier: null }, { tableId: decodeCatalogTableId(tableId + 1), frontier: null }]
      })))
        .toMatchObject({ reason: "writeConflict", observation: { readKind: "tableScan", dependencyOrdinal: 0 } });
      const preparationRefusal = error("writeConflict");
      const missingLaterTable = [tableId];
      missingLaterTable.length = 2;
      expect(await runEffectFailure(consumeAppTableWriteFrontiersInTransactionEffect(tx, scopeId,
        missingLaterTable, cause => error("storedCorruption", cause), () => Effect.fail(preparationRefusal))))
        .toBe(preparationRefusal);
      const firstEntry = entries[0];
      const secondEntry = entries[1];
      if (firstEntry === undefined || secondEntry === undefined) throw new Error("Missing genuine range members");
      const pageRead = { ...read, entries: [firstEntry], isDone: false };
      await runEffect(validateLogicalDocumentChanges(input, { ...empty, pageReads: [pageRead] }));
      expect(await runEffectFailure(validateLogicalDocumentChanges(input,
        { ...empty, pageReads: [{ ...pageRead, isDone: true }] }))).toMatchObject({ reason: "writeConflict" });
      const afterRead = { ...pageRead, after: { encodedKey: firstEntry.encodedKey, rowId: firstEntry.rowId }, entries: [secondEntry] };
      await runEffect(validateLogicalDocumentChanges(input, { ...empty, pageReads: [afterRead] }));
      const otherKey = encodeAppOrderedIndexKeyV1({
        spec: definition.physicalSpec,
        values: [{ kind: "string", value: "different-dependency" }, orderedIndexCreationTimeV1(42)]
      });
      for (const changed of [{ ...firstEntry, encodedKey: otherKey }, { ...firstEntry, rowId: secondEntry.rowId },
      { ...firstEntry, commitSeq: CommitSeqSchema.make(4n) }]) {
        expect(await runEffectFailure(validateLogicalDocumentChanges(input,
          { ...empty, indexReads: [{ ...read, entries: [changed, ...entries.slice(1)] }] })))
          .toMatchObject({ reason: "writeConflict", observation: { readKind: "indexRange", dependencyOrdinal: 0 } });
      }
      // Later authority refusal is deferred behind the earlier complete range verdict.
      expect(await runEffectFailure(validateLogicalDocumentChanges(input, {
        ...empty,
        indexReads: [{ ...read, entries: [] }, {
          ...read, definition: {
            ...definition,
            access: { ...definition.access, tableId: decodeCatalogTableId(tableId + 1) }
          }
        }]
      })))
        .toMatchObject({ reason: "writeConflict", observation: { dependencyOrdinal: 0 } });
      const lastRow = rowIds[2];
      if (lastRow === undefined) throw new Error("Missing late corruption witness");
      await tx.update(fxAppIndexEntryRevisions).set({ keySha256: new Uint8Array(32) }).where(and(
        eq(fxAppIndexEntryRevisions.indexDefinitionId, definition.indexDefinitionId),
        eq(fxAppIndexEntryRevisions.rowId, appRowIdHexV1ToBytes(lastRow))));
      // The third body is beyond the initial one-member page and its lookahead.
      // Its corruption must be read before a cardinality mismatch becomes conflict.
      expect(await runEffectFailure(validateLogicalDocumentChanges(input,
        { ...empty, indexReads: [{ ...read, entries: [] }, negative] }))).toMatchObject({ reason: "storedCorruption" });
      throw rollback;
    } finally {
      closeExactAttemptScopeClockObservation(tx);
      closeInstallationAdmission(tx);
    }
  })).rejects.toBe(rollback);
}
