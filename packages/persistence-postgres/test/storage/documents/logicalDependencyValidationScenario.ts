import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../../../src/installation/installationLifecycle";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { expect, vi } from "vitest";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { appRowIdHexV1ToBytes, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { decodeOrderedIndexBoundHexV1, encodeAppOrderedIndexKeyV1, encodeOrderedIndexComponentsV1,
  orderedIndexCreationTimeV1 } from "flarex-protocol/ordered-index";
import { CommitSeqSchema, type ScopeEpoch, type ScopeId } from "flarex-protocol/storage-authority";
import type { LocatedAppIndexDefinitionV1 } from "../../../src/storage/indexes/appIndexDefinitions";
import { appendAppIndexEntryRevisionsInTransactionEffect, consumeCurrentAppIndexPagesInTransactionEffect,
  scanCurrentAppIndexInTransactionEffect, type ScanCurrentAppIndexV1Input,
  type AppIndexRangePageV1 } from "../../../src/storage/indexes/appIndexEntries";
import { appendPreparedAppRowRevisionsInTransactionEffect, consumeAppTableWriteFrontiersInTransactionEffect } from "../../../src/storage/documents/appRows";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import { validateLogicalDocumentChanges, type LogicalDocumentConflictObservation } from "../../../src/storage/documents/logicalDocuments/contribution";
import { readLogicalIndexRange, consumeLogicalIndexRanges,
  sameLogicalIndexMembership } from "../../../src/storage/documents/logicalDocuments/indexReads";
import type { LogicalDocumentFailureReason } from "../../../src/storage/documents/logicalDocuments/model";
import type { LogicalDocumentChanges } from "../../../src/storage/documents/logicalDocuments/workingSet";
import { fxAppIndexEntryRevisions } from "../../../src/database/schema";
import { closeExactAttemptScopeClockObservation, lockScopeClockRowsForOrdinaryWriteInTransactionEffect } from "../../../src/scope/scopeClock";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

type Failure = Readonly<{ reason: LogicalDocumentFailureReason; cause?: unknown; observation?: LogicalDocumentConflictObservation }>;
const error = (reason: LogicalDocumentFailureReason, cause?: unknown): Failure => ({ reason, ...(cause === undefined ? {} : { cause }) });
const empty: LogicalDocumentChanges = { changes: [], dependencies: [], attempts: [], lifecycle: [], observedRows: [],
  noFinalRows: [], scans: [], uniqueReads: [], indexReads: [], pageReads: [], searchReads: [], setNull: [], relationalReads: [], referenceReplacements: [] };

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
      const execute = vi.spyOn(tx._.session, "prepareQuery");
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
      // The fixed statement must preserve every nullable predicate combination,
      // cursor tie-break and empty witness, with fresh bindings across calls.
      const demands: ScanCurrentAppIndexV1Input[] = Array.from({ length: 8 }, (_, shape) => ({
        scopeId, definition, limit: 1,
        bounds: { ...(shape & 1 ? { startInclusive: decodeOrderedIndexBoundHexV1(encodedKey) } : {}),
          ...(shape & 2 ? { endExclusive: decodeOrderedIndexBoundHexV1(encodedKey + "ff") } : {}) },
        ...(shape & 4 ? { after: { encodedKey: firstEntry.encodedKey, rowId: firstEntry.rowId } } : {}),
      }));
      const expected: AppIndexRangePageV1[] = [];
      for (const demand of demands) expected.push(await runEffect(scanCurrentAppIndexInTransactionEffect(tx, demand)));
      for (const count of [1, 8, 35]) {
        const vector = Array.from({ length: count }, (_, ordinal) => {
          const demand = demands[ordinal % demands.length];
          if (demand === undefined) throw new Error("Missing demand fixture");
          return demand;
        });
        const pages: typeof expected = [];
        await runEffect(consumeCurrentAppIndexPagesInTransactionEffect(tx, vector, cause => error("storedCorruption", cause),
          (ordinal, page) => Effect.sync(() => { expect(ordinal).toBe(pages.length); pages.push(page); })));
        expect(pages).toEqual(vector.map((_, ordinal) => expected[ordinal % demands.length]));
      }
      const firstRefusal = error("writeConflict");
      const validDemand = { scopeId, definition, bounds: {}, limit: 1 };
      expect(await runEffectFailure(consumeCurrentAppIndexPagesInTransactionEffect(tx,
        [validDemand, { ...validDemand, limit: 0 }], cause => error("storedCorruption", cause),
        () => Effect.fail(firstRefusal)))).toBe(firstRefusal);
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
      // An earlier empty-page consumer refusal precedes later stored-body decoding.
      expect(await runEffectFailure(consumeCurrentAppIndexPagesInTransactionEffect(tx,
        [{ scopeId, definition, bounds: negative.bounds, limit: 1 }, { ...validDemand, limit: 10 }],
        cause => error("storedCorruption", cause), () => Effect.fail(firstRefusal)))).toBe(firstRefusal);
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

/** A captured predicate and settlement are separate transactions. A committed
 * writer between them must produce a phantom/revision conflict, never a reused
 * result. PGlite exercises committed interleaving; PostgreSQL also has independent
 * connection/lock concurrency witnesses in the owner suite. */
export async function verifyDemandVectorFreshness(db: FlarexMetadataDatabase, scopeId: ScopeId,
  epoch: ScopeEpoch, definition: LocatedAppIndexDefinitionV1) {
  await verifyDemandVectorEnvelopeCapture(db, scopeId, definition);
  const tableId = definition.access.tableId;
  const rowId = decodeAppRowIdHexV1("000000000000000000000000000000ef");
  const creationTime = decodeAppCreationTimeV1(45);
  const encodedKey = encodeOrderedIndexComponentsV1([orderedIndexCreationTimeV1(45)]);
  const bounds = { startInclusive: decodeOrderedIndexBoundHexV1(encodedKey),
    endExclusive: decodeOrderedIndexBoundHexV1(encodedKey + "ff") };
  const document = await canonicalizeAppDocumentV1({ tableId, rowId, creationTime, fields: { title: "fresh-demand" } });
  const read = () => db.transaction(async tx => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try { return await runEffect(readLogicalIndexRange(tx, scopeId, { definition, bounds }, 4096, error)); }
    finally { closeInstallationAdmission(tx); }
  });
  const write = (sequence: bigint, rollback?: Error, tombstone = false) => db.transaction(async tx => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      await runEffect(lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, scopeId));
      await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, [{ kind: "live", scopeId, tableId, rowId,
        writeEpoch: epoch, commitSeq: CommitSeqSchema.make(sequence),
        prevCommitSeq: sequence === 1n ? null : CommitSeqSchema.make(sequence - 1n),
        schemaVersionId: decodeCatalogSchemaVersionId("demand_freshness"), creationTime, document }]));
      await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [{ kind: tombstone ? "tombstone" : "live",
        scopeId, definition, encodedKey, rowId, writeEpoch: epoch, commitSeq: CommitSeqSchema.make(sequence) }]));
      if (rollback !== undefined) throw rollback;
    } finally { closeExactAttemptScopeClockObservation(tx); closeInstallationAdmission(tx); }
  });
  const initial = await read();
  expect(initial).toEqual([]);
  const rollback = new Error("demand-vector writer rollback");
  await expect(write(1n, rollback)).rejects.toBe(rollback);
  expect(await read()).toEqual(initial);
  await write(1n);
  const validate = (entries: typeof initial) => db.transaction(async tx => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      await runEffect(lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, scopeId));
      // This fixture's genuine intrinsic definition is a storage demand, not a
      // developer contribution capability. Exercise the existing range consumer
      // and membership verdict without fabricating developer authority.
      return await runEffectFailure(consumeLogicalIndexRanges(tx, scopeId, [{ definition, bounds, entries }], 4096, error,
        (ordinal, current) => {
          expect(ordinal).toBe(0);
          return sameLogicalIndexMembership(current, entries) ? Effect.void : Effect.fail(error("writeConflict"));
        }));
    } finally { closeExactAttemptScopeClockObservation(tx); closeInstallationAdmission(tx); }
  });
  expect(await validate(initial)).toMatchObject({ reason: "writeConflict" });
  const first = await read();
  expect(first).toHaveLength(1);
  await write(2n, undefined, true);
  expect(await validate(first)).toMatchObject({ reason: "writeConflict" });
  const second = await read();
  expect(second).toEqual([]);
  await write(3n);
  expect((await read())[0]?.commitSeq).toBe(3n);
  expect(await validate(second)).toMatchObject({ reason: "writeConflict" });
  expect(await validate(first)).toMatchObject({ reason: "writeConflict" });
}

/** Script only the driver response, while retaining real transaction and
 * definition preparation. Shared by both driver suites. */
async function verifyDemandVectorEnvelopeCapture(db: FlarexMetadataDatabase, scopeId: ScopeId,
  definition: LocatedAppIndexDefinitionV1) {
  await db.transaction(async tx => {
    const prepare = tx._.session.prepareQuery.bind(tx._.session);
    let returned: unknown[] = [];
    const spy = vi.spyOn(tx._.session, "prepareQuery").mockImplementation((...args) => {
      const query = prepare(...args);
      if (args[0].sql.includes('select (d.ordinal - 1)::integer as "ordinal"'))
        vi.spyOn(query, "execute").mockImplementation(() => Promise.resolve({ rows: returned }));
      return query;
    });
    const demand = { scopeId, definition, bounds: {}, limit: 1 };
    const refusal = new Error("first consumer refusal");
    try {
      const later: { ordinal: number; present: boolean | null } = { ordinal: 1, present: null };
      returned = [{ ordinal: 0, present: null }, later];
      const consumed: number[] = [];
      await runEffect(consumeCurrentAppIndexPagesInTransactionEffect(tx, [demand, demand], cause => cause,
        (ordinal, page) => Effect.sync(() => {
          consumed.push(ordinal);
          expect(page).toEqual({ entries: [], isDone: true, continueCursor: null });
          expect(Object.isFrozen(page)).toBe(true);
          if (ordinal === 0) { later.ordinal = 0; later.present = false; }
        })));
      expect(consumed).toEqual([0, 1]); // privately captured scalars cannot alias driver rows
      let bodyReads = 0;
      const bodyDefect = new Error("later body getter");
      const laterBody = { ordinal: 1, present: true,
        get tableIdText() { bodyReads++; throw bodyDefect; } };
      returned = [{ ordinal: 0, present: null }, laterBody];
      expect(await runEffectFailure(consumeCurrentAppIndexPagesInTransactionEffect(tx, [demand, demand], cause => cause,
        () => Effect.fail(refusal)))).toBe(refusal);
      expect(bodyReads).toBe(0);
      expect(await runEffect(Effect.exit(consumeCurrentAppIndexPagesInTransactionEffect(tx, [demand, demand], cause => cause,
        () => Effect.void)))).toMatchObject({ _tag: "Failure", cause: { reasons: [{ _tag: "Die", defect: bodyDefect }] } });
      expect(bodyReads).toBe(1);
      for (const [rows, message, ordinals] of [
        [[{ ordinal: 0, present: null }, { ordinal: 1, present: "invalid" }], "invalid index batch envelope", []],
        [[{ ordinal: 0, present: null }, { ordinal: 2, present: null }], "unrequested index batch ordinal", []],
        [[{ ordinal: 0, present: null }], "missing index batch ordinal", [0]],
        [[{ ordinal: 0, present: null }, { ordinal: 0, present: null }], "duplicate empty index batch ordinal", []],
        [[{ ordinal: 0, present: null }, { ordinal: 1, present: false }], "invalid index batch presence", [0]],
      ] as const) {
        returned = [...rows];
        const visited: number[] = [];
        expect(await runEffectFailure(consumeCurrentAppIndexPagesInTransactionEffect(tx, [demand, demand], cause => cause,
          ordinal => Effect.sync(() => { visited.push(ordinal); })))).toMatchObject({ reason: message });
        expect(visited).toEqual(ordinals);
      }
      // Invalid envelopes across the complete batch still precede any consumer.
      returned = [{ ordinal: 0, present: null }, { ordinal: 1, present: "invalid" }];
      expect(await runEffectFailure(consumeCurrentAppIndexPagesInTransactionEffect(tx, [demand, demand], cause => cause,
        () => Effect.fail(refusal)))).toMatchObject({ reason: "invalid index batch envelope" });
    } finally { spy.mockRestore(); }
  });
}
