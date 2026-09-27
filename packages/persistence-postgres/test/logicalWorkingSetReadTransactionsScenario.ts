import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { expect } from "vitest";
import { canonicalizeAppDocumentV1, AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, FlarexDbV1StorageGenerationSchema, ScopeEpochSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction } from "../src/appRows";
import { makeBoundedRequestLifetime } from "../src/boundedRequestLifetime";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { runEffectTransaction } from "../src/effectTransaction";
import { makeLogicalDocumentWorkingSet } from "../src/logicalDocuments/workingSet";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { getScopeClock } from "../src/scopeClock";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../src/scopeClock";
import { fxSystemScopeClocks } from "../src/schema";
import { runEffect } from "./effectTestRuntime";

/** A neutral two-table working-set witness shared by PGlite and ordinary PG. */
export async function logicalWorkingSetReadTransactionsScenario(db: FlarexMetadataDatabase): Promise<void> {
    const scopeId = ScopeIdSchema.make("scope_53000000-0000-0000-0000-000000000001");
    const epoch = ScopeEpochSchema.make("epoch_53000000-0000-0000-0000-000000000002");
    const schemaVersionId = decodeCatalogSchemaVersionId("schema_working_set_reads");
    const firstTable = decodeCatalogTableId(41);
    const secondTable = decodeCatalogTableId(42);
    const firstRow = decodeAppRowIdHexV1("53000000000000000000000000000003");
    const secondRow = decodeAppRowIdHexV1("53000000000000000000000000000004");
    const absentRow = decodeAppRowIdHexV1("53000000000000000000000000000005");
    const firstTime = AppCreationTimeV1Schema.make(1);
    const secondTime = AppCreationTimeV1Schema.make(2);
    await db.insert(fxSystemScopeClocks).values({ scopeId,
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"), epoch });
    const original = await canonicalizeAppDocumentV1({ tableId: firstTable, rowId: firstRow,
      creationTime: firstTime, fields: { label: "original" } });
    const deleted = await canonicalizeAppDocumentV1({ tableId: secondTable, rowId: secondRow,
      creationTime: secondTime, fields: { label: "deleted" } });
    const pending = await canonicalizeAppDocumentV1({ tableId: firstTable, rowId: firstRow,
      creationTime: firstTime, fields: { label: "pending" } });
    const append = (input: Parameters<typeof appendAppRowRevisionAndAdvanceCurrentInTransaction>[1]) =>
      db.transaction(tx => appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, input));
    const evidence = (document: typeof original) => ({ codecVersion: document.codecVersion,
      valueJson: document.valueJson, canonicalBytes: document.canonicalBytes, sha256: document.sha256 });
    await append({ kind: "live", scopeId, tableId: firstTable, rowId: firstRow, writeEpoch: epoch,
      commitSeq: CommitSeqSchema.make(1n), prevCommitSeq: null, schemaVersionId,
      creationTime: firstTime, value: evidence(original) });
    await append({ kind: "live", scopeId, tableId: secondTable, rowId: secondRow, writeEpoch: epoch,
      commitSeq: CommitSeqSchema.make(2n), prevCommitSeq: null, schemaVersionId,
      creationTime: secondTime, value: evidence(deleted) });
    await append({ kind: "tombstone", scopeId, tableId: secondTable, rowId: secondRow, writeEpoch: epoch,
      commitSeq: CommitSeqSchema.make(3n), prevCommitSeq: CommitSeqSchema.make(2n), schemaVersionId,
      creationTime: secondTime });
    await db.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(3n) })
      .where(eq(fxSystemScopeClocks.scopeId, scopeId));
    const clock = await getScopeClock(db, scopeId);
    if (clock === null) throw new Error("Missing neutral working-set scope");
    const failure = (reason: string, cause?: unknown) => new Error(reason, { cause });
    let checkedReads = 0;
    let admissionTransactions = 0;
    let allowed = true;
    let active = false;
    const requireAdmission = Effect.suspend(() => {
      if (active) return Effect.fail(failure("nestedAdmission"));
      admissionTransactions++;
      return runEffectTransaction<void, Error, Error, FlarexMetadataTransaction>(
        callback => db.transaction(callback), "Neutral source admission", tx =>
        lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId).pipe(Effect.asVoid,
          Effect.mapError(cause => failure("statementFailure", cause))),
      cause => failure("statementFailure", cause));
    });
    const readTransaction = <A, E>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
      Effect.suspend(() => {
        checkedReads++;
        if (!allowed) return Effect.fail(failure("sourceMismatch"));
        return runEffectTransaction<A, E | Error, Error, FlarexMetadataTransaction>(
          callback => db.transaction(callback), "Neutral checked read", tx => Effect.gen(function* () {
            yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId)
              .pipe(Effect.mapError(cause => failure("statementFailure", cause)));
            return yield* Effect.acquireUseRelease(Effect.sync(() => { active = true; }), () => work(tx),
              () => Effect.sync(() => { active = false; }));
          }), cause => failure("statementFailure", cause));
      });
    const firstId = appDocumentIdV1FromRowIdentity({ tableId: firstTable, rowId: firstRow });
    const secondId = appDocumentIdV1FromRowIdentity({ tableId: secondTable, rowId: secondRow });
    const absentId = appDocumentIdV1FromRowIdentity({ tableId: firstTable, rowId: absentRow });
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
        { calls: 16, commandBytes: 262_144, commandMs: 60_000 }, {}, {}, "neutral-checked-read", "read"),
      resource => resource.close);
      const working = yield* makeLogicalDocumentWorkingSet({ scopeId, clock, lifetime, readTransaction,
        snapshotCommitSeq: CommitSeqSchema.make(3n),
        tables: [{ tableId: firstTable, logicalName: "notes" }, { tableId: secondTable, logicalName: "labels" }],
        pendingRows: [
          { tableId: firstTable, rowId: firstRow, observed: { kind: "present", revisionCommitSeq: CommitSeqSchema.make(1n) },
            overlay: { kind: "live", creationTime: firstTime, document: pending } },
          { tableId: secondTable, rowId: secondRow, observed: { kind: "missing",
            basis: { kind: "tombstone", revisionCommitSeq: CommitSeqSchema.make(3n) } }, overlay: { kind: "deleted" } },
        ],
        requireAdmission, validateDocument: () => Effect.void,
        error: failure, uniqueConflict: () => failure("uniqueConflict"),
        limits: { pageRows: 8, identities: 8, documentBytes: 65_536 },
      }, firstTime, [], [], { observeQuery: () => expect(active).toBe(true) });
      expect(checkedReads).toBe(1);
      expect(admissionTransactions).toBeGreaterThanOrEqual(2);
      expect(active).toBe(false);
      const id = yield* lifetime.begin(lifetime.context);
      expect(yield* working.documents.getMany(lifetime.context, id, "notes", [firstId, absentId]))
        .toMatchObject([{ label: "pending" }, null]);
      expect(checkedReads).toBe(2);
      expect(yield* working.documents.getMany(lifetime.context, id, "labels", [secondId])).toEqual([null]);
      expect(checkedReads).toBe(2);
      expect(yield* working.documents.getMany(lifetime.context, id, "notes", [absentId])).toEqual([null]);
      expect(checkedReads).toBe(2);
      const snapshot = yield* working.activitySnapshot();
      expect(snapshot.observedRows).toMatchObject([{ tableName: "notes", value: { label: "pending" } }]);
      allowed = false;
      expect(yield* Effect.result(working.documents.getMany(lifetime.context, id, "notes", [
        appDocumentIdV1FromRowIdentity({ tableId: firstTable,
          rowId: decodeAppRowIdHexV1("53000000000000000000000000000006") }),
      ]))).toMatchObject({ _tag: "Failure", failure: { message: "sourceMismatch" } });
      expect(checkedReads).toBe(3);
      expect(active).toBe(false);
    })));
}
