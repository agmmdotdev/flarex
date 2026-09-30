import { Effect } from "effect";
import { eq } from "drizzle-orm";
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
  type OrderedIndexBoundsV1,
} from "flarex-protocol/ordered-index";
import {
  decodeCatalogSchemaVersionId,
  decodeSchemaManifestAppDeveloperOrderedIndexSpecV1,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeIdSchema,
  FlarexDbV1StorageGenerationSchema,
  type ScopeEpoch,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import {
  locateAppIndexDefinitionByIdEffect,
  type LocatedAppIndexDefinitionV1,
} from "../src/appIndexDefinitions";
import {
  appendAppIndexEntryRevisionsInTransactionEffect,
  AppIndexEntryScopeAuthorityUnavailableError,
  InvalidAppIndexEntryInputError,
  readAppIndexMembershipHeadsInTransactionEffect,
  scanCurrentAppIndexInTransactionEffect,
  type AppIndexEntryPositionV1,
} from "../src/appIndexEntries";
import { appendPreparedAppRowRevisionsInTransactionEffect } from "../src/appRows";
import { closeExactAttemptScopeClockObservation, lockScopeClockRowsForOrdinaryWriteInTransactionEffect } from "../src/scopeClock";
import type { FlarexMetadataDatabase } from "../src/deployments";
import {
  deployments,
  fxControlIndexDefinitions,
  fxControlIndexes,
  fxControlScopes,
  fxControlTables,
  fxSystemScopeClocks,
} from "../src/schema";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

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
  });
  const group = [
    livePosition,
    tombstonePosition,
    { ...livePosition, definition: intrinsicAgain, rowId: missingRowId },
    { ...tombstonePosition, rowId: missingRowId },
  ];
  const positions = Array.from({ length: 9 }, () => group).flat();
  const rollbackProof = new Error("membership proof rollback");
  await expect(db.transaction(async tx => {
    await runEffect(lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, scopeId));
    try {
      const captured = await runEffect(readAppIndexMembershipHeadsInTransactionEffect(tx, { scopeId, positions: [livePosition] }));
      const action = { ...livePosition, kind: "tombstone" as const, scopeId, writeEpoch: epoch,
        commitSeq: CommitSeqSchema.make(3n), membershipHeadEvidence: captured.evidence };
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
      await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx,
        [{ ...action, membershipHeadEvidence: writeProof.evidence }]));
      // The first mutation consumes the captured transition generation.
      expect(await runEffectFailure(appendAppIndexEntryRevisionsInTransactionEffect(tx,
        [{ ...action, commitSeq: CommitSeqSchema.make(4n) }]))).toMatchObject({ _tag: "AppIndexEntryStorageCorruptionError" });
      closeExactAttemptScopeClockObservation(tx);
      expect(await runEffectFailure(appendAppIndexEntryRevisionsInTransactionEffect(tx,
        [{ ...action, commitSeq: CommitSeqSchema.make(4n) }]))).toMatchObject({ _tag: "AppIndexEntryStorageCorruptionError" });
      throw rollbackProof;
    } finally { closeExactAttemptScopeClockObservation(tx); }
  })).rejects.toBe(rollbackProof);
  const detached = await db.transaction(tx => runEffect(readAppIndexMembershipHeadsInTransactionEffect(tx,
    { scopeId, positions: [livePosition] })));
  await db.transaction(async tx => {
    await runEffect(lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, scopeId));
    try {
      expect(await runEffectFailure(appendAppIndexEntryRevisionsInTransactionEffect(tx,
        [{ ...livePosition, kind: "tombstone", scopeId, writeEpoch: epoch, commitSeq: CommitSeqSchema.make(3n),
          membershipHeadEvidence: detached.evidence }])))
        .toMatchObject({ _tag: "AppIndexEntryStorageCorruptionError" });
    } finally { closeExactAttemptScopeClockObservation(tx); }
  });
  await db.transaction(async (tx) => {
    const select = vi.spyOn(tx, "select");
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
        expect(select).toHaveBeenCalledTimes(call);
        expect(execute).toHaveBeenCalledTimes(call * 2);
      }
    } finally {
      select.mockRestore();
      execute.mockRestore();
    }
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
  await db.insert(fxSystemScopeClocks).values({
    scopeId: otherScope,
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    epoch,
  });
  for (const mutation of ["scope", "position"] as const) {
    await db.transaction(async (tx) => {
      const position = { ...livePosition };
      const input = {
        scopeId,
        positions:
          mutation === "scope"
            ? [position, { ...livePosition, definition: otherDefinition }]
            : [position],
      };
      const originalSelect = tx.select.bind(tx);
      const select = vi.spyOn(tx, "select").mockImplementation((...args) => {
        // Definition hashing has yielded before scope-query construction.
        if (mutation === "scope") input.scopeId = otherScope;
        else {
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
        expect(select).toHaveBeenCalledOnce();
      } finally {
        select.mockRestore();
        execute.mockRestore();
      }
    });
  }
  const otherInput = {
    scopeId: otherScope,
    positions: [{ ...livePosition, definition: otherDefinition }],
  };
  await db.transaction(async (tx) => {
    expect(
      await runEffect(
        readAppIndexMembershipHeadsInTransactionEffect(tx, otherInput).pipe(Effect.map(selection => selection.heads)),
      ),
    ).toEqual([null]);
    await tx
      .delete(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, otherScope));
    expect(
      await runEffectFailure(
        readAppIndexMembershipHeadsInTransactionEffect(tx, otherInput).pipe(Effect.map(selection => selection.heads)),
      ),
    ).toBeInstanceOf(AppIndexEntryScopeAuthorityUnavailableError);
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
    const select = vi.spyOn(tx, "select");
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
      expect(select).not.toHaveBeenCalled();
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
        expect(select).toHaveBeenCalledTimes(sample.scopeReads);
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
      expect(select).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      select.mockRestore();
      execute.mockRestore();
    }
  });
}
