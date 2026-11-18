import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../../../src/installation/installationLifecycle";
import { Cause, Effect, Exit, Result } from "effect";
import { eq } from "drizzle-orm";
import { insertCurrentScopeClockFixture } from "../../scope/scopeClockFixture";
import { expect, vi } from "vitest";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import {
  decodeCatalogIndexDefinitionId,
  decodeCatalogIndexId,
} from "flarex-protocol/catalog";
import {
  appIndexPhysicalSpecSha256HexV1ToBytes,
  canonicalAppIndexPhysicalSpecBytesHexV1ToBytes,
  canonicalizeAppIndexPhysicalSpecV1,
} from "flarex-protocol/index-definition";
import {
  encodeAppOrderedIndexKeyV1,
  lowerAppDeveloperOrderedIndexPhysicalSpecV1,
  orderedIndexCreationTimeV1,
  decodeOrderedIndexBoundHexV1,
  type OrderedIndexBoundsV1,
} from "flarex-protocol/ordered-index";
import {
  decodeCatalogSchemaVersionId,
  decodeSchemaManifestAppDeveloperOrderedIndexSpecV1,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeIdSchema,
  type ScopeEpoch,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import {
  locateAppIndexDefinitionByIdEffect,
  type LocatedAppIndexDefinitionV1,
} from "../../../src/storage/indexes/appIndexDefinitions";
import {
  appendAppIndexEntryRevisionsInTransactionEffect,
  prepareAppIndexRevisionApplicationEffect,
  readAppIndexMembershipHeadsInTransactionEffect,
  scanCurrentAppIndexInTransactionEffect,
  withCurrentPublicationIndexRowsInTransactionEffect,
  type AppIndexEntryPositionV1,
  type AppIndexRangeEntryV1,
  type ReadAppIndexRangeV1Error,
} from "../../../src/storage/indexes/appIndexEntries";
import {
  AppIndexEntryScopeAuthorityUnavailableError,
  InvalidAppIndexEntryInputError,
} from "../../../src/storage/indexes/appIndexEntryErrors";
import { appendPreparedAppRowRevisionsInTransactionEffect, readAppRowAtSnapshotInTransactionEffect } from "../../../src/storage/documents/appRows";
import { AppRowScopeAuthorityUnavailableError } from "../../../src/storage/documents/appRowErrors";
import { closeExactAttemptScopeClockObservation, lockScopeClockRowsForOrdinaryWriteInTransactionEffect,
  readProtectedScopeReadIdentity, requireProtectedScopeReadIdentity, readExactScopeWriteClockObservation,
  lockScopeClockForSnapshotReadInTransactionEffect } from "../../../src/scope/scopeClock";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import {
  deployments,
  fxControlIndexDefinitions,
  fxControlIndexes,
  fxControlScopes,
  fxControlTables,
  fxSystemScopeClocks,
  fxSystemScopeExecutionAuthorities,
} from "../../../src/database/schema";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { verifyLogicalDependencyValidation } from "../documents/logicalDependencyValidationScenario";

/** Real storage and issued definitions in both driver lanes; spies observe SQL
 * construction without replacing its execution or results. */
export async function verifyMembershipReadPreparation(
  db: FlarexMetadataDatabase,
  scopeId: ScopeId,
  epoch: ScopeEpoch,
  intrinsic: LocatedAppIndexDefinitionV1,
) {
  const tableId = intrinsic.access.tableId;
  const developerId = decodeCatalogIndexDefinitionId(2);
  const logicalIndexId = decodeCatalogIndexId(1);
  const physicalSpec = lowerAppDeveloperOrderedIndexPhysicalSpecV1(
    decodeSchemaManifestAppDeveloperOrderedIndexSpecV1({
      kind: "developerOrdered",
      specVersion: 1,
      fields: ["title"],
    }),
  );
  const canonical = await canonicalizeAppIndexPhysicalSpecV1(physicalSpec);
  await db.insert(fxControlIndexes).values({
    deploymentId: intrinsic.deploymentId,
    logicalIndexId,
    tableId,
    descriptor: "by_title",
  });
  await db.insert(fxControlIndexDefinitions).values({
    deploymentId: intrinsic.deploymentId,
    indexDefinitionId: developerId,
    accessKind: "developer",
    accessIdentityId: logicalIndexId,
    tableId,
    logicalIndexId,
    physicalSpecCodecVersion: canonical.codecVersion,
    physicalSpecJson: physicalSpec,
    physicalSpecBytes: canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(
      canonical.canonicalBytesHex,
    ),
    physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
      canonical.sha256Hex,
    ),
  });
  const developer = await runEffect(
    locateAppIndexDefinitionByIdEffect(db, scopeId, developerId),
  );
  const intrinsicAgain = await runEffect(
    locateAppIndexDefinitionByIdEffect(
      db,
      scopeId,
      intrinsic.indexDefinitionId,
    ),
  );
  if (developer === null || intrinsicAgain === null)
    throw new Error("Missing issued definition.");
  expect(intrinsicAgain).not.toBe(intrinsic);

  const rowId = decodeAppRowIdHexV1("00000000000000000000000000000001");
  const missingRowId = decodeAppRowIdHexV1("00000000000000000000000000000002");
  const creationTime = decodeAppCreationTimeV1(42);
  const intrinsicKey = encodeAppOrderedIndexKeyV1({
    spec: intrinsic.physicalSpec,
    values: [orderedIndexCreationTimeV1(42)],
  });
  const developerKey = encodeAppOrderedIndexKeyV1({
    spec: physicalSpec,
    values: [
      { kind: "string", value: "title" },
      orderedIndexCreationTimeV1(42),
    ],
  });
  const document = await canonicalizeAppDocumentV1({
    tableId,
    rowId,
    creationTime,
    fields: { title: "title" },
  });
  const livePosition = {
    definition: intrinsic,
    encodedKey: intrinsicKey,
    rowId,
  };
  const tombstonePosition = {
    definition: developer,
    encodedKey: developerKey,
    rowId,
  };
  await db.transaction(async (tx) => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      await runEffect(
        appendPreparedAppRowRevisionsInTransactionEffect(tx, [
          {
            kind: "live",
            scopeId,
            writeEpoch: epoch,
            tableId,
            rowId,
            creationTime,
            schemaVersionId: decodeCatalogSchemaVersionId(
              "membership_read_preparation",
            ),
            commitSeq: CommitSeqSchema.make(1n),
            prevCommitSeq: null,
            document,
          },
        ]),
      );
      await runEffect(
        appendAppIndexEntryRevisionsInTransactionEffect(
          tx,
          [livePosition, tombstonePosition].map((position) => ({
            ...position,
            kind: "live",
            scopeId,
            writeEpoch: epoch,
            commitSeq: CommitSeqSchema.make(1n),
          })),
        ),
      );
      await runEffect(
        appendAppIndexEntryRevisionsInTransactionEffect(tx, [
          {
            ...tombstonePosition,
            kind: "tombstone",
            scopeId,
            writeEpoch: epoch,
            commitSeq: CommitSeqSchema.make(2n),
          },
        ]),
      );
    } finally { closeInstallationAdmission(tx); }
  });
  const group = [
    livePosition,
    tombstonePosition,
    { ...livePosition, definition: intrinsicAgain, rowId: missingRowId },
    { ...tombstonePosition, rowId: missingRowId },
  ];
  await verifyLogicalDependencyValidation(db, scopeId, epoch, developer);
  const positions = Array.from({ length: 9 }, () => group).flat();
  const rollbackProof = new Error("membership proof rollback");
  await expect(db.transaction(async (tx) => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      await runEffect(lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, scopeId));
      try {
        const captured = await runEffect(readAppIndexMembershipHeadsInTransactionEffect(tx, { scopeId, positions: [livePosition] }));
        const action = {
          ...livePosition, kind: "tombstone" as const, scopeId, writeEpoch: epoch,
          commitSeq: CommitSeqSchema.make(3n), membershipHeadEvidence: captured.evidence
        };
        expect(await runEffectFailure(appendAppIndexEntryRevisionsInTransactionEffect(tx,
          [{ ...action, membershipHeadEvidence: { ...captured.evidence } }])))
          .toMatchObject({ _tag: "AppIndexEntryStorageCorruptionError" });
        await runEffect(lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, scopeId));
        const exactPositionProof = await runEffect(readAppIndexMembershipHeadsInTransactionEffect(tx,
          { scopeId, positions: [livePosition] }));
        // A genuine issuer does not grant an unobserved position.
        expect(await runEffectFailure(appendAppIndexEntryRevisionsInTransactionEffect(tx,
          [{ ...action, rowId: missingRowId, membershipHeadEvidence: exactPositionProof.evidence }])))
          .toMatchObject({ _tag: "AppIndexEntryStorageCorruptionError" });
        await runEffect(lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, scopeId));
        const writeProof = await runEffect(readAppIndexMembershipHeadsInTransactionEffect(tx,
          { scopeId, positions: [livePosition] }));
        const disjointProof = await runEffect(readAppIndexMembershipHeadsInTransactionEffect(tx,
          { scopeId, positions: [tombstonePosition] }));
        await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx,
          [{ ...action, membershipHeadEvidence: writeProof.evidence }]));
        // Independently issued proof for another exact position survives.
        await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx,
          [{ ...tombstonePosition, kind: "live", scopeId, writeEpoch: epoch,
            commitSeq: CommitSeqSchema.make(3n), membershipHeadEvidence: disjointProof.evidence }]));
        // The overlapping mutation consumes the captured position generation.
        expect(await runEffectFailure(prepareAppIndexRevisionApplicationEffect(tx,
          [{ ...action, commitSeq: CommitSeqSchema.make(4n), membershipHeadEvidence: writeProof.evidence }])))
          .toMatchObject({ _tag: "AppIndexEntryStorageCorruptionError" });
        const beforeRefresh = await runEffect(readAppIndexMembershipHeadsInTransactionEffect(tx,
          { scopeId, positions: [tombstonePosition] }));
        await runEffect(lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, scopeId));
        const nextAction = { ...tombstonePosition, kind: "tombstone" as const, scopeId, writeEpoch: epoch,
          commitSeq: CommitSeqSchema.make(4n), membershipHeadEvidence: beforeRefresh.evidence };
        // An identical database clock does not preserve the issuer identity.
        expect(await runEffectFailure(prepareAppIndexRevisionApplicationEffect(tx, [nextAction])))
          .toMatchObject({ _tag: "AppIndexEntryStorageCorruptionError" });
        const beforeClose = await runEffect(readAppIndexMembershipHeadsInTransactionEffect(tx,
          { scopeId, positions: [tombstonePosition] }));
        closeExactAttemptScopeClockObservation(tx);
        expect(await runEffectFailure(prepareAppIndexRevisionApplicationEffect(tx,
          [{ ...nextAction, membershipHeadEvidence: beforeClose.evidence }])))
          .toMatchObject({ _tag: "AppIndexEntryStorageCorruptionError" });
        throw rollbackProof;
      } finally { closeExactAttemptScopeClockObservation(tx); }
    } finally { closeInstallationAdmission(tx); }
  })).rejects.toBe(rollbackProof);
  const detached = await db.transaction(async (tx) => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      await runEffect(lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, scopeId));
      try {
        return await runEffect(readAppIndexMembershipHeadsInTransactionEffect(tx,
          { scopeId, positions: [livePosition] }));
      } finally { closeExactAttemptScopeClockObservation(tx); }
    } finally { closeInstallationAdmission(tx); }
  });
  await db.transaction(async (tx) => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      await runEffect(lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, scopeId));
      try {
        expect(await runEffectFailure(appendAppIndexEntryRevisionsInTransactionEffect(tx,
          [{
            ...livePosition, kind: "tombstone", scopeId, writeEpoch: epoch, commitSeq: CommitSeqSchema.make(3n),
            membershipHeadEvidence: detached.evidence
          }])))
          .toMatchObject({ _tag: "AppIndexEntryStorageCorruptionError" });
      } finally { closeExactAttemptScopeClockObservation(tx); }
    } finally { closeInstallationAdmission(tx); }
  });
  await db.transaction(async (tx) => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      const select = vi.spyOn(tx._.session, "prepareQuery");
      const execute = vi.spyOn(tx, "execute");
      try {
        for (let call = 1; call <= 2; call += 1) {
          expect(
            await runEffect(
              readAppIndexMembershipHeadsInTransactionEffect(tx, {
                scopeId,
                positions,
              }).pipe(Effect.map(selection => selection.heads)),
            ),
          ).toEqual(
            Array.from({ length: 9 }, () => [
              { commitSeq: 1n, isTombstone: false },
              { commitSeq: 2n, isTombstone: true },
              null,
              null,
            ]).flat(),
          );
          expect(select.mock.calls.filter(args => args[1] !== undefined)).toHaveLength(call);
          expect(execute).toHaveBeenCalledTimes(call * 2);
        }
      } finally {
        select.mockRestore();
        execute.mockRestore();
      }
    } finally { closeInstallationAdmission(tx); }
  });

  const otherScope = ScopeIdSchema.make(
    "scope_60000000-0000-0000-0000-000000000099",
  );
  const otherDeployment = `${intrinsic.deploymentId}_other`;
  await db.insert(deployments).values({
    deploymentId: otherDeployment,
    projectId: "membership_read_preparation",
  });
  await db.insert(fxControlTables).values({
    deploymentId: otherDeployment,
    tableId,
    namespace: "app",
    logicalName: "documents",
  });
  await db.insert(fxControlIndexDefinitions).values({
    deploymentId: otherDeployment,
    indexDefinitionId: intrinsic.indexDefinitionId,
    accessKind: "by_creation_time",
    accessIdentityId: tableId,
    tableId,
    physicalSpecCodecVersion: intrinsic.physicalSpecCodecVersion,
    physicalSpecJson: intrinsic.physicalSpec,
    physicalSpecBytes: canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(
      intrinsic.physicalSpecBytesHex,
    ),
    physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
      intrinsic.physicalSpecSha256Hex,
    ),
  });
  await db.insert(fxControlScopes).values({
    scopeId: otherScope,
    deploymentId: otherDeployment,
    isolationKind: "shared_database",
    physicalLocator: {
      kind: "shared_database",
      databaseKey: "membership_read_preparation",
      schemaName: "public",
    },
  });
  const otherDefinition = await runEffect(
    locateAppIndexDefinitionByIdEffect(
      db,
      otherScope,
      intrinsic.indexDefinitionId,
    ),
  );
  if (otherDefinition === null)
    throw new Error("Missing other-scope definition.");
  await insertCurrentScopeClockFixture(db, { scopeId: otherScope, epoch });
  for (const mutation of ["scope", "position"] as const) {
    await db.transaction(async (tx) => {
      await runEffect(lockInstallationForCurrentTransaction(tx));
      try {
        const position = { ...livePosition };
        const input = {
          scopeId,
          positions:
            mutation === "scope"
              ? [position, { ...livePosition, definition: otherDefinition }]
              : [position],
        };
        const originalSelect = tx._.session.prepareQuery.bind(tx._.session);
        const select = vi.spyOn(tx._.session, "prepareQuery").mockImplementation((...args) => {
          // Mutate caller input at the scope-query construction boundary.
          if (args[1] !== undefined && mutation === "scope") input.scopeId = otherScope;
          else if (args[1] !== undefined) {
            position.definition = otherDefinition;
            position.encodedKey = developerKey;
            position.rowId = missingRowId;
          }
          return originalSelect(...args);
        });
        const execute = vi.spyOn(tx, "execute");
        try {
          const read = readAppIndexMembershipHeadsInTransactionEffect(tx, input).pipe(Effect.map(selection => selection.heads));
          if (mutation === "scope") {
            expect(await runEffectFailure(read)).toMatchObject({
              issue: "invalidLocatedDefinition",
            });
            expect(execute).not.toHaveBeenCalled();
          } else {
            expect(await runEffect(read)).toEqual([
              { commitSeq: 1n, isTombstone: false },
            ]);
            expect(execute).toHaveBeenCalledOnce();
          }
          expect(select.mock.calls.filter(args => args[1] !== undefined)).toHaveLength(1);
        } finally {
          select.mockRestore();
          execute.mockRestore();
        }
      } finally { closeInstallationAdmission(tx); }
    });
  }
  const otherInput = {
    scopeId: otherScope,
    positions: [{ ...livePosition, definition: otherDefinition }],
  };
  await db.transaction(async (tx) => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      expect(
        await runEffect(
          readAppIndexMembershipHeadsInTransactionEffect(tx, otherInput).pipe(Effect.map(selection => selection.heads)),
        ),
      ).toEqual([null]);
      await tx.delete(fxSystemScopeExecutionAuthorities)
        .where(eq(fxSystemScopeExecutionAuthorities.scopeId, otherScope));
      await tx
        .delete(fxSystemScopeClocks)
        .where(eq(fxSystemScopeClocks.scopeId, otherScope));
      expect(
        await runEffectFailure(
          readAppIndexMembershipHeadsInTransactionEffect(tx, otherInput).pipe(Effect.map(selection => selection.heads)),
        ),
      ).toBeInstanceOf(AppIndexEntryScopeAuthorityUnavailableError);
    } finally { closeInstallationAdmission(tx); }
  });

  // All fixed predicate shapes retain exact bounds and composite cursor order
  // through both actual drivers, while a native snapshot lends identity only.
  const closedReadIdentity = await db.transaction(async tx => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    await runEffect(lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId));
    const identity = readProtectedScopeReadIdentity(tx, scopeId);
    if (identity === undefined) throw new Error("Native identity was not issued");
    expect(readExactScopeWriteClockObservation(tx, scopeId)).toBeUndefined();
    const prepare = vi.spyOn(tx._.session, "prepareQuery");
    try {
      for (let shape = 0; shape < 8; shape++) {
        const bounds = {
          ...(shape & 1 ? { startInclusive: decodeOrderedIndexBoundHexV1(intrinsicKey) } : {}),
          ...(shape & 2 ? { endExclusive: decodeOrderedIndexBoundHexV1(`${intrinsicKey}ff`) } : {}),
        };
        const after = shape & 4 ? { encodedKey: intrinsicKey, rowId } : undefined;
        for (const limit of [1, 2]) {
          const observed: Readonly<{ sql: string; params: ReadonlyArray<unknown> }>[] = [];
          const page = await runEffect(scanCurrentAppIndexInTransactionEffect(tx, { scopeId, definition: intrinsic, bounds,
            ...(after === undefined ? {} : { after }), limit }, value => observed.push(value)));
          expect(page.entries.map(entry => [entry.encodedKey, entry.rowId])).toEqual(shape & 4 ? [] : [[intrinsicKey, rowId]]);
          expect(page.isDone).toBe(true);
          expect(observed).toHaveLength(1);
          expect(observed[0]?.params.at(-1)).toBe(limit + 1);
          expect(observed[0]?.sql).toContain("order by current_entry.encoded_key asc, current_entry.row_id asc");
        }
      }
      expect(await runEffect(readAppRowAtSnapshotInTransactionEffect(tx,
        { scopeId, tableId, rowId, snapshotCommitSeq: CommitSeqSchema.make(1n) })))
        .toMatchObject({ kind: "live", commitSeq: 1n });
      expect(await runEffect(readAppRowAtSnapshotInTransactionEffect(tx,
        { scopeId, tableId, rowId: missingRowId, snapshotCommitSeq: CommitSeqSchema.make(1n) })))
        .toEqual({ kind: "missing" });
      expect(prepare.mock.calls.filter(args => args[1] !== undefined)).toHaveLength(0);
      expect(Result.getOrThrow(requireProtectedScopeReadIdentity(tx, identity))).toBe(identity);
      expect(Result.isFailure(requireProtectedScopeReadIdentity(tx, { ...identity }))).toBe(true);
      expect(await runEffectFailure(readAppRowAtSnapshotInTransactionEffect(tx,
        { scopeId: otherScope, tableId, rowId, snapshotCommitSeq: CommitSeqSchema.make(1n) })))
        .toBeInstanceOf(AppRowScopeAuthorityUnavailableError);
      expect(prepare.mock.calls.filter(args => args[1] !== undefined)).toHaveLength(1);
      expect(Result.getOrThrow(requireProtectedScopeReadIdentity(tx, identity))).toBe(identity);
      closeExactAttemptScopeClockObservation(tx);
      expect(Result.isFailure(requireProtectedScopeReadIdentity(tx, identity))).toBe(true);
      expect(await runEffect(readAppRowAtSnapshotInTransactionEffect(tx,
        { scopeId, tableId, rowId, snapshotCommitSeq: CommitSeqSchema.make(1n) })))
        .toMatchObject({ kind: "live", commitSeq: 1n });
      expect(prepare.mock.calls.filter(args => args[1] !== undefined)).toHaveLength(2);
      await runEffect(scanCurrentAppIndexInTransactionEffect(tx, { scopeId, definition: intrinsic, bounds: {}, limit: 1 }));
      expect(prepare.mock.calls.filter(args => args[1] !== undefined)).toHaveLength(3);
      return identity;
    } finally {
      prepare.mockRestore();
      closeExactAttemptScopeClockObservation(tx);
      closeInstallationAdmission(tx);
    }
  });
  await db.transaction(async tx => {
    expect(Result.isFailure(requireProtectedScopeReadIdentity(tx, closedReadIdentity))).toBe(true);
    const prepare = vi.spyOn(tx._.session, "prepareQuery");
    try {
      expect(await runEffect(readAppRowAtSnapshotInTransactionEffect(tx,
        { scopeId, tableId, rowId, snapshotCommitSeq: CommitSeqSchema.make(1n) })))
        .toMatchObject({ kind: "live", commitSeq: 1n });
      expect(prepare.mock.calls.filter(args => args[1] !== undefined)).toHaveLength(1);
    } finally { prepare.mockRestore(); }
  });
  // Deliberate resolved native-driver outputs preserve the full Cause from a
  // foreign head or membership getter, before any later property or ordinal.
  await db.transaction(async tx => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      for (const field of ["ordinal", "tableIdText"] as const) {
        const defect = new Error(`original membership head ${field} getter defect`);
        let laterAccessed = false;
        const raw = { ordinal: "0", currentCommitSeq: "1", commitSeqText: "1" };
        Object.defineProperty(raw, field, { get() { throw defect; } });
        Object.defineProperty(raw, field === "ordinal" ? "tableIdText" : "keyCodecVersionText", {
          get() { laterAccessed = true; throw new Error("later membership property must remain deferred"); },
        });
        const nativePrepare = tx._.session.prepareQuery.bind(tx._.session);
        const prepare = vi.spyOn(tx._.session, "prepareQuery").mockImplementation((...args) => {
          const query = nativePrepare(...args);
          if (args[1] === undefined) vi.spyOn(query, "execute").mockResolvedValue({ rows: [raw] });
          return query;
        });
        try {
          const exit = await runEffect(Effect.exit(readAppIndexMembershipHeadsInTransactionEffect(tx,
            { scopeId, positions: [livePosition] })));
          if (!Exit.isFailure(exit)) throw new Error("Expected original membership getter defect");
          expect(exit.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect]);
          expect(Cause.hasFails(exit.cause)).toBe(false);
          expect(laterAccessed).toBe(false);
        } finally { prepare.mockRestore(); }
      }
    } finally { closeInstallationAdmission(tx); }
  });

  // Callback construction belongs to the capture lifetime as well as execution.
  // Check the escaped reader while its actual transaction and writer remain open.
  await db.transaction(async tx => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      await runEffect(lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, scopeId));
      const saved: { read?: (ordinal: number) => Effect.Effect<readonly AppIndexRangeEntryV1[], ReadAppIndexRangeV1Error> } = {};
      const defect = new Error("original publication consumer construction defect");
      const exit = await runEffect(Effect.exit(withCurrentPublicationIndexRowsInTransactionEffect(tx, {
        scopeId, publicationIndex: { indexDefinitionId: intrinsic.indexDefinitionId,
          physicalSpec: intrinsic.physicalSpec, physicalSpecSha256Hex: intrinsic.physicalSpecSha256Hex },
        rowIds: [rowId],
      }, cause => cause, read => {
        saved.read = read;
        throw defect;
      })));
      if (!Exit.isFailure(exit)) throw new Error("Expected publication consumer construction defect");
      const defects = exit.cause.reasons.filter(Cause.isDieReason);
      expect(defects).toHaveLength(1);
      expect(defects[0]?.defect).toBe(defect);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(readExactScopeWriteClockObservation(tx, scopeId)).toBeDefined();
      if (saved.read === undefined) throw new Error("Publication consumer did not retain its reader");
      expect(await runEffectFailure(saved.read(0))).toMatchObject({ reason: "reverse membership capture is closed" });
    } finally {
      closeExactAttemptScopeClockObservation(tx);
      closeInstallationAdmission(tx);
    }
  });

  // Reverse captures accept all envelopes before lending a body reader. An
  // envelope refusal must preserve its original Cause and stop that acceptance.
  await db.transaction(async tx => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      for (const mode of ["ordinal", "present", "malformedOrdinal", "malformedPresent", "unrequested"] as const) {
        const defect = new Error(`original reverse membership ${mode} getter defect`);
        let bodyAccessed = false, laterEnvelopeAccessed = false, consumerCalled = false, errorMapped = false;
        const first = { ordinal: 0, present: true,
          get tableIdText() { bodyAccessed = true; throw new Error("membership bodies must remain lazy"); } };
        const raw: { ordinal: unknown; present: unknown } = { ordinal: 1, present: true };
        if (mode === "ordinal" || mode === "present") Object.defineProperty(raw, mode, { get() { throw defect; } });
        else if (mode === "malformedOrdinal") raw.ordinal = -1;
        else if (mode === "malformedPresent") raw.present = "invalid";
        else raw.ordinal = 2;
        const rows = [first, raw, {
          get ordinal() { laterEnvelopeAccessed = true; throw new Error("later envelope must remain deferred"); },
          present: null,
        }];
        const nativePrepare = tx._.session.prepareQuery.bind(tx._.session);
        const prepare = vi.spyOn(tx._.session, "prepareQuery").mockImplementation((...args) => {
          const query = nativePrepare(...args);
          if (args[1] === undefined) vi.spyOn(query, "execute").mockResolvedValue({ rows });
          return query;
        });
        try {
          const exit = await runEffect(Effect.exit(withCurrentPublicationIndexRowsInTransactionEffect(tx, {
            scopeId, publicationIndex: { indexDefinitionId: intrinsic.indexDefinitionId,
              physicalSpec: intrinsic.physicalSpec, physicalSpecSha256Hex: intrinsic.physicalSpecSha256Hex },
            rowIds: [rowId, missingRowId],
          }, cause => { errorMapped = true; return cause; }, () => Effect.sync(() => { consumerCalled = true; }))));
          if (!Exit.isFailure(exit)) throw new Error("Expected reverse membership envelope refusal");
          if (mode === "ordinal" || mode === "present") {
            expect(exit.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect]);
            expect(Cause.hasFails(exit.cause)).toBe(false);
            expect(errorMapped).toBe(false);
          } else {
            expect(Cause.hasDies(exit.cause)).toBe(false);
            expect(exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error)).toMatchObject([{
              _tag: "AppIndexEntryStorageCorruptionError",
              reason: mode === "unrequested" ? "reverse membership has an unrequested ordinal" : "reverse membership envelope invalid",
            }]);
            expect(errorMapped).toBe(true);
          }
          expect(bodyAccessed).toBe(false);
          expect(laterEnvelopeAccessed).toBe(false);
          expect(consumerCalled).toBe(false);
        } finally { prepare.mockRestore(); }
      }
    } finally { closeInstallationAdmission(tx); }
  });

  // Deliberately forged private inputs exercise fail-closed runtime validation.
  const forged = { ...intrinsic } as LocatedAppIndexDefinitionV1;
  const badRow = "bad" as AppIndexEntryPositionV1["rowId"];
  const cases = [
    {
      positions: [{ ...livePosition, definition: forged }],
      issue: "invalidLocatedDefinition",
      scopeReads: 0,
    },
    {
      positions: [livePosition, { ...livePosition, definition: forged }],
      issue: "invalidLocatedDefinition",
      scopeReads: 1,
    },
    {
      positions: [
        livePosition,
        { ...livePosition, definition: otherDefinition },
      ],
      issue: "invalidLocatedDefinition",
      scopeReads: 1,
    },
    {
      positions: [
        livePosition,
        { ...tombstonePosition, encodedKey: intrinsicKey },
      ],
      issue: "invalidEncodedKey",
      scopeReads: 1,
    },
    {
      positions: [{ ...livePosition, rowId: badRow }],
      issue: "invalidRowId",
      scopeReads: 1,
    },
    {
      positions: [
        { ...livePosition, rowId: badRow },
        { ...livePosition, definition: forged },
      ],
      issue: "invalidRowId",
      scopeReads: 1,
    },
  ];
  await db.transaction(async (tx) => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      const select = vi.spyOn(tx._.session, "prepareQuery");
      const execute = vi.spyOn(tx, "execute");
      try {
        expect(
          await runEffect(
            readAppIndexMembershipHeadsInTransactionEffect(tx, {
              scopeId: "invalid" as ScopeId,
              positions: [],
            }).pipe(Effect.map(selection => selection.heads)),
          ),
        ).toEqual([]);
        expect(select.mock.calls.filter(args => args[1] !== undefined)).toHaveLength(0);
        for (const sample of cases) {
          select.mockClear();
          const failure = await runEffectFailure(
            readAppIndexMembershipHeadsInTransactionEffect(tx, {
              scopeId,
              positions: sample.positions,
            }).pipe(Effect.map(selection => selection.heads)),
          );
          expect(failure).toBeInstanceOf(InvalidAppIndexEntryInputError);
          expect(failure).toMatchObject({ issue: sample.issue });
          expect(select.mock.calls.filter(args => args[1] !== undefined)).toHaveLength(sample.scopeReads);
        }
        expect(execute).not.toHaveBeenCalled();
        select.mockClear();
        for (const sample of [
          {
            definition: forged,
            bounds: null as unknown as OrderedIndexBoundsV1,
            limit: 0,
            issue: "invalidBounds",
          },
          {
            definition: forged,
            bounds: {},
            limit: 0,
            issue: "invalidLocatedDefinition",
          },
          {
            definition: intrinsic,
            bounds: {},
            after: { encodedKey: developerKey, rowId },
            limit: 0,
            issue: "invalidCursor",
          },
          { definition: intrinsic, bounds: {}, limit: 0, issue: "invalidLimit" },
        ]) {
          expect(
            await runEffectFailure(
              scanCurrentAppIndexInTransactionEffect(tx, { scopeId, ...sample }),
            ),
          ).toMatchObject({ issue: sample.issue });
        }
        expect(select.mock.calls.filter(args => args[1] !== undefined)).toHaveLength(0);
        expect(execute).not.toHaveBeenCalled();
      } finally {
        select.mockRestore();
        execute.mockRestore();
      }
    } finally { closeInstallationAdmission(tx); }
  });
}
