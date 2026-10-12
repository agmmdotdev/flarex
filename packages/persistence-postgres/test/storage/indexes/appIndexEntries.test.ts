import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../../../src/installation/installationLifecycle";
import { verifyIndexBatches } from "./indexBatchScenario";
import { insertCurrentScopeClockFixture } from "../../scope/scopeClockFixture";
import { verifyMembershipReadPreparation } from "./indexMembershipReadScenario";
import { verifyDemandVectorFreshness } from "../documents/logicalDependencyValidationScenario";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import {
  decodeCatalogIndexDefinitionId,
  decodeCatalogTableId,
} from "flarex-protocol/catalog";
import {
  APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
  APP_BY_ID_PHYSICAL_SPEC_V1,
  decodeOrderedIndexBoundHexV1,
  encodeOrderedIndexComponentsV1,
  orderedIndexCreationTimeV1,
  orderedIndexKeyBytesHexV1ToBytes,
  type OrderedIndexKeyHexV1,
  type OrderedIndexRowIdHexV1,
} from "flarex-protocol/ordered-index";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  appIndexPhysicalSpecSha256HexV1ToBytes,
  canonicalAppIndexPhysicalSpecBytesHexV1ToBytes,
  canonicalizeAppIndexPhysicalSpecV1,
} from "flarex-protocol/index-definition";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { Effect } from "effect";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { flarexSchema } from "../../../src/database/schema";
import { describe, expect, it, vi } from "vitest";

import {
  AppIndexEntryTransitionConflictError,
  AppIndexEntryParentRowError,
  AppIndexEntryStorageCorruptionError,
  AppIndexEntryReadPersistenceError,
  InvalidAppIndexEntryInputError,
} from "../../../src/storage/indexes/appIndexEntryErrors";
import {
  readAppIndexMembershipHeadsInTransactionEffect,
  appendAppIndexEntryRevisionsInTransactionEffect,
  scanAppIndexAtSnapshotInTransactionEffect,
  scanCurrentAppIndexInTransactionEffect,
  scanCurrentPublicationIndexInTransactionEffect,
  withCurrentPublicationIndexRowsInTransactionEffect,
  type AppendAppIndexEntryRevisionV1Input,
  type AppIndexEntryTransaction,
} from "../../../src/storage/indexes/appIndexEntries";
import {
  locateAppIndexDefinitionByIdEffect,
  type LocatedAppIndexDefinitionV1,
} from "../../../src/storage/indexes/appIndexDefinitions";
import {
  appendPreparedAppRowRevisionsInTransactionEffect,
  type AppendPreparedAppRowRevisionV1Input,
} from "../../../src/storage/documents/appRows";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../../../src/database/pglite";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

const scopeId = ScopeIdSchema.make(
  "scope_52000000-0000-0000-0000-000000000001",
);
const otherScopeId = ScopeIdSchema.make(
  "scope_52000000-0000-0000-0000-000000000099",
);
const epoch = ScopeEpochSchema.make(
  "epoch_52000000-0000-0000-0000-000000000002",
);
const tableId = decodeCatalogTableId(1);
const indexDefinitionId = decodeCatalogIndexDefinitionId(1);
const schemaVersionId = decodeCatalogSchemaVersionId("schema_index_rows_v1");
const creationTime = decodeAppCreationTimeV1(1_725_000_000_100.25);
const rowA = decodeAppRowIdHexV1("5200000000000000000000000000000a");
const rowB = decodeAppRowIdHexV1("5200000000000000000000000000000b");
const rowC = decodeAppRowIdHexV1("5200000000000000000000000000000c");
const keyA = key("a");
const keyB = key("b");
const keyC = key("c");
const physicalSpec = APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1;
const deploymentId = "deployment_s10_pglite";
let locatedDefinition: LocatedAppIndexDefinitionV1;

describe("S10 app-index revision and current storage", () => {
  it("retains genuine frozen catalog specifications and authenticates raw publication digests", async () => {
    const persistence = await indexPersistence();
    const definition = locatedDefinition;
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.physicalSpec)).toBe(true);
    expect(Object.isFrozen(definition.physicalSpec.orderedFields)).toBe(true);
    expect(Object.isFrozen(definition.physicalSpec.orderedFields[0])).toBe(true);
    expect(Object.isFrozen(definition.physicalSpec.tieBreaker)).toBe(true);
    expect(Reflect.set(definition.physicalSpec, "maxEncodedKeyBytes", 1)).toBe(false);
    expect(Reflect.set(definition.physicalSpec.orderedFields, "0", { kind: "documentPath", path: "other" })).toBe(false);
    expect(Reflect.set(definition, "physicalSpecSha256Hex", "0".repeat(64))).toBe(false);
    expect(await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffect(scanAppIndexAtSnapshotInTransactionEffect(tx, {
      scopeId, definition, bounds: {}, snapshotCommitSeq: CommitSeqSchema.make(1n), limit: 10,
    }));
        } finally { closeInstallationAdmission(tx); }
      })).toMatchObject({ entries: [], isDone: true });
    for (const publicationIndex of [
      { indexDefinitionId: definition.indexDefinitionId, physicalSpec: definition.physicalSpec,
        physicalSpecSha256Hex: "0".repeat(64) },
      { indexDefinitionId: definition.indexDefinitionId, physicalSpec: APP_BY_ID_PHYSICAL_SPEC_V1,
        physicalSpecSha256Hex: definition.physicalSpecSha256Hex },
    ]) {
      const refused = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffectFailure(
        scanCurrentPublicationIndexInTransactionEffect(tx, { scopeId, publicationIndex, bounds: {}, limit: 10 }));
        } finally { closeInstallationAdmission(tx); }
      });
      expect(refused).toBeInstanceOf(AppIndexEntryStorageCorruptionError);
      expect(refused).toMatchObject({ reason: "activation index digest mismatch" });
    }
  });

  it("defers publication bodies until their ordinal and closes an escaped reader", async () => {
    const persistence = await indexPersistence();
    const publicationIndex = { indexDefinitionId: locatedDefinition.indexDefinitionId,
      physicalSpec: locatedDefinition.physicalSpec, physicalSpecSha256Hex: locatedDefinition.physicalSpecSha256Hex };
    await persistence.drizzle.transaction(async tx => {
      await runEffect(lockInstallationForCurrentTransaction(tx));
      const execute = tx.execute.bind(tx);
      const spy = vi.spyOn(tx, "execute").mockImplementation(() => execute(sql`
        select 0::integer as "ordinal", null::boolean as "present", null::text as "tableIdText"
        union all select 1::integer, true::boolean, 'malformed'::text`));
      try {
        const input = { scopeId, publicationIndex, rowIds: [rowA, rowB] };
        expect(await runEffectFailure(withCurrentPublicationIndexRowsInTransactionEffect(tx, input,
          cause => cause.message, read => Effect.gen(function* () {
            expect(yield* read(0)).toEqual([]);
            return yield* Effect.fail("earlier consumer refusal");
          })))).toBe("earlier consumer refusal");
        const read = await runEffect(withCurrentPublicationIndexRowsInTransactionEffect(tx, input,
          cause => cause, read => Effect.succeed(read)));
        expect(await runEffectFailure(read(0))).toMatchObject({ reason: "reverse membership capture is closed" });
        expect(await runEffectFailure(withCurrentPublicationIndexRowsInTransactionEffect(tx, input,
          cause => cause, read => read(1)))).toBeInstanceOf(AppIndexEntryStorageCorruptionError);
      } finally {
        spy.mockRestore();
        closeInstallationAdmission(tx);
      }
    });
  });

  it("prepares mixed membership definitions with one fresh scope check per operation", async () => {
    const persistence = await indexPersistence();
    await verifyMembershipReadPreparation(persistence.drizzle, scopeId, epoch, locatedDefinition);
  });

  it("retains rollback and fresh OCC across interleaved predicate writers", async () => {
    const persistence = await indexPersistence();
    await verifyDemandVectorFreshness(persistence.drizzle, scopeId, epoch, locatedDefinition);
  });

  it.each(["membership", "range"] as const)("preserves %s query construction defects and classifies SQL rejections", async (kind) => {
    const persistence = await indexPersistence();
    const defect = new Error("query construction defect");
    for (const mode of ["construction", "rejection"] as const) {
      await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {

        const execute = tx.execute.bind(tx);
        const executeSpy = kind === "membership" ? vi.spyOn(tx, "execute").mockImplementation(() => {
          // The reader is the only execute caller in this transaction.
          if (mode === "construction") throw defect;
          return execute(sql`select 1 / 0`);
        }) : undefined;
        const prepare = tx._.session.prepareQuery.bind(tx._.session);
        const prepareSpy = kind === "range" ? vi.spyOn(tx._.session, "prepareQuery").mockImplementation((...args) => {
          if (args[1] === undefined && mode === "construction") throw defect;
          const query = prepare(...args);
          if (args[1] === undefined) vi.spyOn(query, "execute").mockRejectedValue(defect);
          return query;
        }) : undefined;
        try {
          const reading = kind === "membership"
            ? readAppIndexMembershipHeadsInTransactionEffect(tx, { scopeId, positions: [{ definition: locatedDefinition, encodedKey: keyA, rowId: rowA }] }).pipe(Effect.map(selection => selection.heads)).pipe(Effect.asVoid)
            : scanCurrentAppIndexInTransactionEffect(tx, { scopeId, definition: locatedDefinition, bounds: {}, limit: 10 }).pipe(Effect.asVoid);
          const exit = await runEffect(Effect.exit(reading));
          if (mode === "construction") {
            expect(exit).toMatchObject({ _tag: "Failure", cause: { reasons: [{ _tag: "Die", defect }] } });
          } else {
            expect(exit).toMatchObject({ _tag: "Failure", cause: { reasons: [{ _tag: "Fail", error: expect.any(AppIndexEntryReadPersistenceError) }] } });
          }
          if (executeSpy !== undefined) expect(executeSpy).toHaveBeenCalledOnce();
          if (prepareSpy !== undefined) expect(prepareSpy.mock.calls.filter(args => args[1] === undefined)).toHaveLength(1);
        } finally { executeSpy?.mockRestore(); prepareSpy?.mockRestore(); }
      
        } finally { closeInstallationAdmission(tx); }
      });
    }
  });

  it("rejects malformed membership driver evidence without a write capability", async () => {
    await indexPersistence();
    const scopeUuid = scopeId.slice("scope_".length);
    const absent = { ordinal: "0", currentCommitSeq: null, commitSeqText: null };
    const cases: ReadonlyArray<ReadonlyArray<unknown>> = [
      [], [{ ...absent, ordinal: 0 }], [{ ...absent, ordinal: "1" }],
      [{ ...absent, currentCommitSeq: 1 }], [{ ...absent, currentCommitSeq: "1" }],
      [{ ...absent, commitSeqText: "0" }], [{ ...absent, commitSeqText: "1", tableIdText: "0" }],
      [absent, absent],
    ];
    for (const returned of cases) {
      // Only the actual membership read is present; no installation admission or
      // publication writer is forged to reach a displaced RETURNING decoder.
      const native = drizzle.mock({ schema: flarexSchema });
      const prepare = native._.session.prepareQuery.bind(native._.session);
      vi.spyOn(native._.session, "prepareQuery").mockImplementation((...args) => {
        const query = prepare(...args);
        vi.spyOn(query, "execute").mockImplementation(() => Promise.resolve([{ scopeUuid }]));
        return query;
      });
      const tx = Object.assign(native, { execute() { return Promise.resolve({ rows: returned }); } }) as unknown as AppIndexEntryTransaction;
      expect(await runEffectFailure(readAppIndexMembershipHeadsInTransactionEffect(tx, {
        scopeId, positions: [{ definition: locatedDefinition, encodedKey: keyA, rowId: rowA }],
      }))).toBeInstanceOf(AppIndexEntryStorageCorruptionError);
    }
  });

  it("applies bounded index batches with exact returned keys and atomic rollback", async () => {
    const persistence = await indexPersistence();
    await verifyIndexBatches(persistence, persistence.drizzle, scopeId, epoch, locatedDefinition);
  }, 120_000);

  it("preserves ordered history, exact bounds, composite pagination, movement, and tombstones", async () => {
    const persistence = await indexPersistence();
    await commitRowAndEntries(persistence, await liveRow(rowA, 1n, null, "a"), [
      liveEntry(rowA, keyA, 1n),
    ]);
    await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {

      await appendRow(tx, await liveRow(rowB, 2n, null, "b"));
      await appendEntry(tx, liveEntry(rowB, keyB, 2n));
      await appendRow(tx, await liveRow(rowC, 2n, null, "b-tie"));
      await appendEntry(tx, liveEntry(rowC, keyB, 2n));
    
        } finally { closeInstallationAdmission(tx); }
      });
    await commitRowAndEntries(persistence, await liveRow(rowA, 3n, 1n, "c"), [
      tombstoneEntry(rowA, keyA, 3n),
      liveEntry(rowA, keyC, 3n),
    ]);
    await commitRowAndEntries(persistence, tombstoneRow(rowB, 4n, 2n), [
      tombstoneEntry(rowB, keyB, 4n),
    ]);

    const snapshotTwo = await snapshot(persistence, 2n, 10);
    expect(positions(snapshotTwo.entries)).toEqual([
      [keyA, rowA],
      [keyB, rowB],
      [keyB, rowC],
    ]);
    expect(snapshotTwo.entries.map((entry) => entry.commitSeq)).toEqual([
      1n,
      2n,
      2n,
    ]);
    expect(
      snapshotTwo.entries.every((entry) => entry.keySha256.byteLength === 32),
    ).toBe(true);

    const bounded = await snapshot(persistence, 2n, 10, {
      startInclusive: decodeOrderedIndexBoundHexV1(keyB),
      endExclusive: decodeOrderedIndexBoundHexV1(keyC),
    });
    expect(positions(bounded.entries)).toEqual([
      [keyB, rowB],
      [keyB, rowC],
    ]);

    const firstPage = await snapshot(persistence, 2n, 2);
    expect(firstPage.isDone).toBe(false);
    expect(positions(firstPage.entries)).toEqual([
      [keyA, rowA],
      [keyB, rowB],
    ]);
    expect(firstPage.continueCursor).toEqual({
      encodedKey: keyB,
      rowId: rowB,
    });
    const secondPage = await snapshot(
      persistence,
      2n,
      2,
      {},
      firstPage.continueCursor ?? undefined,
    );
    expect(secondPage.isDone).toBe(true);
    expect(positions(secondPage.entries)).toEqual([[keyB, rowC]]);

    const snapshotThree = await snapshot(persistence, 3n, 10);
    expect(positions(snapshotThree.entries)).toEqual([
      [keyB, rowB],
      [keyB, rowC],
      [keyC, rowA],
    ]);
    const current = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffect(
        scanCurrentAppIndexInTransactionEffect(tx, {
          scopeId,
          definition: locatedDefinition,
          bounds: {},
          limit: 10,
        }),
      );
        } finally { closeInstallationAdmission(tx); }
      },
    );
    expect(positions(current.entries)).toEqual([
      [keyB, rowC],
      [keyC, rowA],
    ]);
    const publicationView = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffect(
      scanCurrentPublicationIndexInTransactionEffect(tx, {
        scopeId, publicationIndex: { indexDefinitionId: locatedDefinition.indexDefinitionId,
          physicalSpec: locatedDefinition.physicalSpec,
          physicalSpecSha256Hex: locatedDefinition.physicalSpecSha256Hex },
        bounds: {}, limit: 10,
      }));
        } finally { closeInstallationAdmission(tx); }
      });
    expect(publicationView).toEqual(current);

    const counts = await persistence.query<{
      revisions: string;
      current: string;
      tombstones: string;
    }>(
      `select
         (select count(*)::text from fx_app_index_entry_rev) as revisions,
         (select count(*)::text from fx_app_index_entry_current) as current,
         (select count(*)::text from fx_app_index_entry_rev where is_tombstone)
           as tombstones`,
    );
    expect(counts.rows).toEqual([
      { revisions: "6", current: "2", tombstones: "2" },
    ]);

    // Reusing an absent membership creates a new transition without a predecessor.
    await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {

      await appendRow(tx, await liveRow(rowA, 5n, 3n, "reuse"));
      const result =
        await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [liveEntry(rowA, keyA, 5n)]));
      expect(result).toHaveLength(1);
    
        } finally { closeInstallationAdmission(tx); }
      });

    await persistence.query(
      `insert into fx_app_index_entry_current
         (scope_uuid, index_definition_id, encoded_key, row_id, commit_seq)
       select scope_uuid, index_definition_id, encoded_key, row_id, commit_seq
       from fx_app_index_entry_rev
       where is_tombstone
       order by commit_seq desc
       limit 1`,
    );
    const contradictoryCurrent = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffectFailure(
        scanCurrentAppIndexInTransactionEffect(tx, {
          scopeId,
          definition: locatedDefinition,
          bounds: {},
          limit: 10,
        }),
      );
        } finally { closeInstallationAdmission(tx); }
      },
    );
    expect(contradictoryCurrent).toBeInstanceOf(
      AppIndexEntryStorageCorruptionError,
    );
    expect(contradictoryCurrent.message).toMatch(/tombstone/);
  });

  it("rejects a redundant live membership without leaving a revision", async () => {
    const persistence = await indexPersistence();
    await commitRowAndEntries(persistence, await liveRow(rowA, 1n, null, "a"), [
      liveEntry(rowA, keyA, 1n),
    ]);
    await commitRowAndEntries(
      persistence,
      await liveRow(rowA, 3n, 1n, "a2"),
      [],
    );

    await expect(persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {

      await appendRow(tx, await liveRow(rowA, 5n, 3n, "stale"));
      await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [liveEntry(rowA, keyA, 5n)]));
    
        } finally { closeInstallationAdmission(tx); }
      })).rejects.toBeInstanceOf(AppIndexEntryTransitionConflictError);
    const stored = await persistence.query<{ count: string }>(
      `select count(*)::text as count from fx_app_index_entry_rev
       where commit_seq = 5`,
    );
    expect(stored.rows).toEqual([{ count: "0" }]);
  });

  it.each([
    "missingPointer",
    "tombstonePointer",
    "keyDigest",
    "physicalSpec",
  ] as const)(
    "authenticates unchanged membership before omission: %s",
    async (corruption) => {
      const persistence = await indexPersistence();
      await commitRowAndEntries(
        persistence,
        await liveRow(rowA, 1n, null, "a"),
        [liveEntry(rowA, keyA, 1n)],
      );
      if (corruption === "missingPointer")
        await persistence.query("delete from fx_app_index_entry_current");
      if (corruption === "tombstonePointer")
        await persistence.query(
          "update fx_app_index_entry_rev set is_tombstone=true",
        );
      if (corruption === "keyDigest")
        await persistence.query(
          "update fx_app_index_entry_rev set key_sha256=$1",
          [new Uint8Array(32)],
        );
      if (corruption === "physicalSpec")
        await persistence.query(
          "update fx_app_index_entry_rev set physical_spec_sha256=$1",
          [new Uint8Array(32)],
        );
      const failure = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffectFailure(
          readAppIndexMembershipHeadsInTransactionEffect(tx, {
            scopeId,
            positions: [
              { definition: locatedDefinition, encodedKey: keyA, rowId: rowA },
            ],
          }).pipe(Effect.map(selection => selection.heads)),
        );
        } finally { closeInstallationAdmission(tx); }
      },
      );
      expect(failure).toBeInstanceOf(AppIndexEntryStorageCorruptionError);
    },
  );

  it("fails closed when stored canonical-key bytes and digest diverge", async () => {
    const persistence = await indexPersistence();
    await commitRowAndEntries(persistence, await liveRow(rowA, 1n, null, "a"), [
      liveEntry(rowA, keyA, 1n),
    ]);
    await persistence.query(
      `update fx_app_index_entry_rev set key_sha256 = $1`,
      [new Uint8Array(32)],
    );
    const failure = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffectFailure(
        scanAppIndexAtSnapshotInTransactionEffect(tx, {
          scopeId,
          definition: locatedDefinition,
          bounds: {},
          snapshotCommitSeq: CommitSeqSchema.make(1n),
          limit: 10,
        }),
      );
        } finally { closeInstallationAdmission(tx); }
      },
    );
    expect(failure).toBeInstanceOf(AppIndexEntryStorageCorruptionError);
    expect(failure.message).toMatch(/digest does not match/);

    const malformedBytes = new Uint8Array([
      ...orderedIndexKeyBytesHexV1ToBytes(keyA),
      0,
    ]);
    const malformedDigest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", malformedBytes.buffer),
    );
    await persistence.query(`delete from fx_app_index_entry_current`);
    await persistence.query(
      `update fx_app_index_entry_rev
       set encoded_key = $1, key_sha256 = $2`,
      [malformedBytes, malformedDigest],
    );
    const malformedFailure = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffectFailure(
        scanAppIndexAtSnapshotInTransactionEffect(tx, {
          scopeId,
          definition: locatedDefinition,
          bounds: {},
          snapshotCommitSeq: CommitSeqSchema.make(1n),
          limit: 10,
        }),
      );
        } finally { closeInstallationAdmission(tx); }
      },
    );
    expect(malformedFailure).toBeInstanceOf(
      AppIndexEntryStorageCorruptionError,
    );
    expect(malformedFailure.message).toMatch(/physical specification/);
  });

  it("rejects malformed keys, live entries over row tombstones, and accepts empty ranges", async () => {
    const persistence = await indexPersistence();
    await expect(persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {

      await appendRow(tx, tombstoneRow(rowA, 1n, null));
      await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [liveEntry(rowA, keyA, 1n)]));
    
        } finally { closeInstallationAdmission(tx); }
      })).rejects.toBeInstanceOf(AppIndexEntryParentRowError);
    await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {

      await appendRow(tx, await liveRow(rowB, 2n, null, "b"));
    
        } finally { closeInstallationAdmission(tx); }
      });
    const forgedDefinition = {
      ...locatedDefinition, physicalSpec: APP_BY_ID_PHYSICAL_SPEC_V1,
    } as unknown as LocatedAppIndexDefinitionV1;
    for (const symbol of Object.getOwnPropertySymbols(locatedDefinition)) {
      const descriptor = Object.getOwnPropertyDescriptor(locatedDefinition, symbol);
      if (descriptor !== undefined) Object.defineProperty(forgedDefinition, symbol, descriptor);
    }
    await expect(persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx,
      [{ ...liveEntry(rowB, keyB, 2n), definition: forgedDefinition }]));
        } finally { closeInstallationAdmission(tx); }
      }))
      .rejects.toMatchObject({ issue: "invalidLocatedDefinition" });
    await expect(persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx,
      [{ ...liveEntry(rowB, keyB, 2n), encodedKey: `${keyB}00` as OrderedIndexKeyHexV1 }]));
        } finally { closeInstallationAdmission(tx); }
      }))
      .rejects.toMatchObject({ issue: "invalidEncodedKey" });

    const empty = await snapshot(persistence, 2n, 10, {
      startInclusive: decodeOrderedIndexBoundHexV1(keyB),
      endExclusive: decodeOrderedIndexBoundHexV1(keyB),
    });
    expect(empty).toMatchObject({ entries: [], isDone: true });

    const invalidCursor = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffectFailure(
        scanAppIndexAtSnapshotInTransactionEffect(tx, {
          scopeId,
          definition: locatedDefinition,
          bounds: {},
          after: {
            encodedKey: `${keyB}00` as OrderedIndexKeyHexV1,
            rowId: rowB,
          },
          snapshotCommitSeq: CommitSeqSchema.make(2n),
          limit: 10,
        }),
      );
        } finally { closeInstallationAdmission(tx); }
      },
    );
    expect(invalidCursor).toBeInstanceOf(InvalidAppIndexEntryInputError);
    expect(invalidCursor).toMatchObject({ issue: "invalidCursor" });

    const crossScope = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffectFailure(
        scanAppIndexAtSnapshotInTransactionEffect(tx, {
          scopeId: otherScopeId,
          definition: locatedDefinition,
          bounds: {},
          snapshotCommitSeq: CommitSeqSchema.make(2n),
          limit: 10,
        }),
      );
        } finally { closeInstallationAdmission(tx); }
      },
    );
    expect(crossScope).toBeInstanceOf(InvalidAppIndexEntryInputError);
    expect(crossScope).toMatchObject({ issue: "invalidLocatedDefinition" });
  });
});

async function indexPersistence(): Promise<PGliteFlarexPersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  await seedLocatedDefinition(persistence);
  await insertCurrentScopeClockFixture(persistence.drizzle, { scopeId, epoch, lastCommitSeq: 100n });
  return persistence;
}

async function seedLocatedDefinition(
  persistence: PGliteFlarexPersistence,
): Promise<void> {
  const canonical = await canonicalizeAppIndexPhysicalSpecV1(physicalSpec);
  await persistence.query(
    `insert into deployments (deployment_id, project_id)
     values ($1, 'project_s10_pglite')`,
    [deploymentId],
  );
  await persistence.query(
    `insert into fx_control_table
       (deployment_id, table_id, namespace, logical_name)
     values ($1, $2, 'app', 'documents')`,
    [deploymentId, tableId],
  );
  await persistence.query(
    `insert into fx_control_scope
       (id, deployment_id, isolation_kind, physical_locator_json)
     values ($1, $2, 'shared_database', $3)`,
    [
      scopeId,
      deploymentId,
      {
        kind: "shared_database",
        databaseKey: "s10_pglite",
        schemaName: "public",
      },
    ],
  );
  await persistence.query(
    `insert into fx_control_index_definition
       (deployment_id, index_definition_id, access_kind, access_identity_id,
        table_id, logical_index_id, physical_spec_codec_version,
        physical_spec_json, physical_spec_bytes, physical_spec_sha256)
     values ($1, $2, 'by_creation_time', $3, $3, null, 1, $4, $5, $6)`,
    [
      deploymentId,
      indexDefinitionId,
      tableId,
      physicalSpec,
      canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(
        canonical.canonicalBytesHex,
      ),
      appIndexPhysicalSpecSha256HexV1ToBytes(canonical.sha256Hex),
    ],
  );
  const located = await runEffect(
    locateAppIndexDefinitionByIdEffect(
      persistence.drizzle,
      scopeId,
      indexDefinitionId,
    ),
  );
  if (located === null)
    throw new Error("Expected located S10 index definition");
  locatedDefinition = located;
}

async function commitRowAndEntries(
  persistence: PGliteFlarexPersistence,
  row: AppendPreparedAppRowRevisionV1Input,
  entries: ReadonlyArray<AppendAppIndexEntryRevisionV1Input>,
): Promise<void> {
  await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {

    await appendRow(tx, row);
    for (const entry of entries) await appendEntry(tx, entry);
  
        } finally { closeInstallationAdmission(tx); }
      });
}

async function appendRow(
  tx: Parameters<
    typeof appendPreparedAppRowRevisionsInTransactionEffect
  >[0],
  input: AppendPreparedAppRowRevisionV1Input,
): Promise<void> {
  await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, [input]));
}

async function appendEntry(
  tx: Parameters<
    typeof appendAppIndexEntryRevisionsInTransactionEffect
  >[0],
  input: AppendAppIndexEntryRevisionV1Input,
): Promise<void> {
  await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [input]));
}

async function snapshot(
  persistence: PGliteFlarexPersistence,
  commitSeq: bigint,
  limit: number,
  bounds: Parameters<
    typeof scanAppIndexAtSnapshotInTransactionEffect
  >[1]["bounds"] = {},
  after?: Parameters<
    typeof scanAppIndexAtSnapshotInTransactionEffect
  >[1]["after"],
) {
  return persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffect(
      scanAppIndexAtSnapshotInTransactionEffect(tx, {
        scopeId,
        definition: locatedDefinition,
        bounds,
        ...(after === undefined ? {} : { after }),
        snapshotCommitSeq: CommitSeqSchema.make(commitSeq),
        limit,
      }),
    );
        } finally { closeInstallationAdmission(tx); }
      },
  );
}

async function liveRow(
  rowId: OrderedIndexRowIdHexV1,
  commitSeq: bigint,
  prevCommitSeq: bigint | null,
  title: string,
): Promise<AppendPreparedAppRowRevisionV1Input> {
  return {
    kind: "live",
    scopeId,
    tableId,
    rowId,
    writeEpoch: epoch,
    commitSeq: CommitSeqSchema.make(commitSeq),
    prevCommitSeq:
      prevCommitSeq === null ? null : CommitSeqSchema.make(prevCommitSeq),
    schemaVersionId,
    creationTime,
    document: await canonicalDocument(rowId, title),
  };
}

function tombstoneRow(
  rowId: OrderedIndexRowIdHexV1,
  commitSeq: bigint,
  prevCommitSeq: bigint | null,
): AppendPreparedAppRowRevisionV1Input {
  return {
    kind: "tombstone",
    scopeId,
    tableId,
    rowId,
    writeEpoch: epoch,
    commitSeq: CommitSeqSchema.make(commitSeq),
    prevCommitSeq:
      prevCommitSeq === null ? null : CommitSeqSchema.make(prevCommitSeq),
    schemaVersionId,
    creationTime,
  };
}

function liveEntry(
  rowId: OrderedIndexRowIdHexV1,
  encodedKey: OrderedIndexKeyHexV1,
  commitSeq: bigint,
): AppendAppIndexEntryRevisionV1Input {
  return entry("live", rowId, encodedKey, commitSeq);
}

function tombstoneEntry(
  rowId: OrderedIndexRowIdHexV1,
  encodedKey: OrderedIndexKeyHexV1,
  commitSeq: bigint,
): AppendAppIndexEntryRevisionV1Input {
  return entry("tombstone", rowId, encodedKey, commitSeq);
}

function entry(
  kind: "live" | "tombstone",
  rowId: OrderedIndexRowIdHexV1,
  encodedKey: OrderedIndexKeyHexV1,
  commitSeq: bigint,
): AppendAppIndexEntryRevisionV1Input {
  return {
    kind,
    scopeId,
    definition: locatedDefinition,
    encodedKey,
    rowId,
    writeEpoch: epoch,
    commitSeq: CommitSeqSchema.make(commitSeq),
  };
}

function key(value: string): OrderedIndexKeyHexV1 {
  return encodeOrderedIndexComponentsV1([
    orderedIndexCreationTimeV1(value.charCodeAt(0)),
  ]);
}

function canonicalDocument(rowId: OrderedIndexRowIdHexV1, title: string) {
  return canonicalizeAppDocumentV1({
    tableId,
    rowId,
    creationTime,
    fields: { title },
  });
}

function positions(
  entries: ReadonlyArray<{
    readonly encodedKey: string;
    readonly rowId: string;
  }>,
): ReadonlyArray<readonly [string, string]> {
  return entries.map((entry) => [entry.encodedKey, entry.rowId] as const);
}
