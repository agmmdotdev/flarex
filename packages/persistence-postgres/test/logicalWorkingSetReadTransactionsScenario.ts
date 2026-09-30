import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { expect } from "vitest";
import { canonicalizeAppDocumentV1, AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { isJsonObject } from "flarex-protocol/json";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, FlarexDbV1StorageGenerationSchema, ScopeEpochSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction } from "../src/appRows";
import { makeBoundedRequestLifetime } from "../src/boundedRequestLifetime";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { runEffectTransaction } from "../src/effectTransaction";
import { makeLogicalDocumentWorkingSet } from "../src/logicalDocuments/workingSet";
import { makeLogicalDocumentRootEvaluator, requireLogicalDocumentRootEvaluatorOpen } from "../src/logicalDocuments/rootEvaluator";
import { projectLogicalDocumentJournalContribution } from "../src/logicalDocuments/journalContribution";
import type { SessionJournalAttempt } from "../src/sessionJournalStore";
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
    const laterPending = await canonicalizeAppDocumentV1({ tableId: firstTable, rowId: firstRow,
      creationTime: firstTime, fields: { label: "later-pending" } });
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
        Effect.acquireUseRelease(Effect.sync(() => { active = true; }), () =>
          lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId).pipe(
            Effect.mapError(cause => failure("statementFailure", cause)),
            Effect.flatMap(() => allowed ? Effect.void : Effect.fail(failure("sourceMismatch")))),
        () => Effect.sync(() => { active = false; })),
      cause => failure("statementFailure", cause));
    });
    const readTransaction = <A, E>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
      Effect.suspend(() => {
        checkedReads++;
        return runEffectTransaction<A, E | Error, Error, FlarexMetadataTransaction>(
          callback => db.transaction(callback), "Neutral checked read", tx => Effect.gen(function* () {
            yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId)
              .pipe(Effect.mapError(cause => failure("statementFailure", cause)));
            return yield* Effect.acquireUseRelease(Effect.sync(() => { active = true; }), () => Effect.gen(function* () {
              if (!allowed) return yield* Effect.fail(failure("sourceMismatch"));
              return yield* work(tx);
            }),
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
      const working = yield* readTransaction(tx => makeLogicalDocumentWorkingSet({ scopeId, clock, lifetime, readTransaction,
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
      }, firstTime, [], [], { observeQuery: () => expect(active).toBe(true) }, tx));
      expect(checkedReads).toBe(1);
      // One checked construction transaction hydrates pending bases and closes
      // before any returned method can run.
      expect(admissionTransactions).toBe(0);
      expect(active).toBe(false);
      const id = yield* lifetime.begin(lifetime.context);
      expect(yield* working.documents.getMany(lifetime.context, id, "notes", [firstId, absentId]))
        .toMatchObject([{ label: "pending" }, null]);
      expect(checkedReads).toBe(2);
      expect(admissionTransactions).toBe(1);
      expect(yield* working.documents.getMany(lifetime.context, id, "labels", [secondId])).toEqual([null]);
      expect(checkedReads).toBe(2);
      expect(admissionTransactions).toBe(2);
      expect(yield* working.documents.getMany(lifetime.context, id, "notes", [absentId])).toEqual([null]);
      expect(checkedReads).toBe(2);
      expect(admissionTransactions).toBe(3);
      const snapshot = yield* working.activitySnapshot();
      expect(snapshot.observedRows).toMatchObject([{ tableName: "notes", value: { label: "pending" } }]);
      allowed = false;
      expect(yield* Effect.result(working.documents.getMany(lifetime.context, id, "notes", [firstId])))
        .toMatchObject({ _tag: "Failure", failure: { message: "sourceMismatch" } });
      expect(checkedReads).toBe(2);
      expect(active).toBe(false);
    })));
    allowed = true;
    for (const admitted of [true, false]) {
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
          { calls: 8, commandBytes: 65_536, commandMs: 60_000 }, {}, {}, `neutral-proxy-${admitted}`, "read"),
        resource => resource.close);
        const working = yield* readTransaction(tx => makeLogicalDocumentWorkingSet({
          scopeId, clock, lifetime, readTransaction, snapshotCommitSeq: CommitSeqSchema.make(3n),
          tables: [{ tableId: firstTable, logicalName: "notes" }], pendingRows: [],
          requireAdmission, validateDocument: () => Effect.void,
          error: failure, uniqueConflict: () => failure("uniqueConflict"),
          limits: { pageRows: 8, identities: 8, documentBytes: 65_536 },
        }, firstTime, [], [], undefined, tx));
        const id = yield* lifetime.begin(lifetime.context);
        let proxyTraps = 0;
        const malformed = new Proxy({ where: {}, offset: 0, limit: 1 }, {
          get(target, key, receiver) {
            proxyTraps++;
            expect(active).toBe(false);
            return key === "limit" ? "wrong" : Reflect.get(target, key, receiver);
          },
          ownKeys(target) {
            proxyTraps++;
            expect(active).toBe(false);
            return Reflect.ownKeys(target);
          },
          getOwnPropertyDescriptor(target, key) {
            proxyTraps++;
            expect(active).toBe(false);
            const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
            return key === "limit" && descriptor !== undefined ? { ...descriptor, value: "wrong" } : descriptor;
          },
        });
        allowed = admitted;
        const outcome = yield* Effect.result(working.documents.find(lifetime.context, id, "notes", malformed));
        expect(outcome._tag).toBe("Failure");
        if (admitted) expect(proxyTraps).toBeGreaterThan(0);
        else {
          expect(outcome).toMatchObject({ _tag: "Failure", failure: { message: "sourceMismatch" } });
          expect(proxyTraps).toBe(0);
        }
        expect(active).toBe(false);
      })));
      allowed = true;
    }
    const primitiveId = appDocumentIdV1FromRowIdentity({ tableId: firstTable,
      rowId: decodeAppRowIdHexV1("53000000000000000000000000000006") });
    const beforePrimitiveReads = checkedReads;
    const beforePrimitiveAdmissions = admissionTransactions;
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
        { calls: 8, commandBytes: 65_536, commandMs: 60_000 }, {}, {}, "neutral-primitive-get", "read"),
      resource => resource.close);
      const working = yield* readTransaction(tx => makeLogicalDocumentWorkingSet({
        scopeId, clock, lifetime, readTransaction, snapshotCommitSeq: CommitSeqSchema.make(3n),
        tables: [{ tableId: firstTable, logicalName: "notes" }], pendingRows: [],
        requireAdmission, validateDocument: () => Effect.void,
        error: failure, uniqueConflict: () => failure("uniqueConflict"),
        limits: { pageRows: 8, identities: 8, documentBytes: 65_536 },
      }, firstTime, [], [], { observeQuery: () => expect(active).toBe(true) }, tx));
      expect(active).toBe(false);
      expect(checkedReads - beforePrimitiveReads).toBe(1);
      const id = yield* lifetime.begin(lifetime.context);
      expect(yield* working.documents.get(lifetime.context, id, primitiveId, "notes")).toBeNull();
      expect(checkedReads - beforePrimitiveReads).toBe(2);
      expect(admissionTransactions - beforePrimitiveAdmissions).toBe(0);
      expect(active).toBe(false);
      expect(yield* working.documents.get(lifetime.context, id, firstId, "notes"))
        .toMatchObject({ label: "original" });
      expect(checkedReads - beforePrimitiveReads).toBe(3);
      expect(admissionTransactions - beforePrimitiveAdmissions).toBe(0);
      expect(yield* working.documents.get(lifetime.context, id, primitiveId, "notes")).toBeNull();
      expect(checkedReads - beforePrimitiveReads).toBe(4);
      expect(admissionTransactions - beforePrimitiveAdmissions).toBe(0);
      yield* lifetime.seal;
      const changes = yield* working.close();
      expect(changes.dependencies).toMatchObject([
        { documentId: firstId, dependency: { kind: "appRowPoint", observed: { kind: "present",
          revisionCommitSeq: CommitSeqSchema.make(1n) } } },
        { documentId: primitiveId, dependency: { kind: "appRowPoint", observed: { kind: "missing",
          basis: { kind: "noVisibleRevision" } } } },
      ]);
    })));
    const attempt = {} as SessionJournalAttempt;
    const snapshotCommitSeq = CommitSeqSchema.make(3n);
    const pins = { attempt, scopeId, snapshotCommitSeq, attemptFence: "working-set-root-1" };
    const root = makeLogicalDocumentRootEvaluator(pins, { identities: 8, workingBytes: 1_048_576 });
    const seedDocument = structuredClone(pending);
    const seed = { tableId: firstTable, rowId: firstRow,
      observed: { kind: "present" as const, revisionCommitSeq: CommitSeqSchema.make(1n) },
      overlay: { kind: "live" as const, creationTime: firstTime, document: seedDocument } };
    expect(root.stageAppPoint(seed)).toBe(true);
    if (!isJsonObject(seedDocument.valueJson)) throw new Error("Expected seed object");
    Reflect.set(seedDocument.valueJson, "label", "input-tampered");
    const firstReadCount = checkedReads;
    const rootAdmissionCount = admissionTransactions;
    let rootSnapshotRevisions = 0;
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const open = (tableId: typeof firstTable, logicalName: string,
        evaluator = root, identities = 8) => Effect.gen(function* () {
        const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
          { calls: 16, commandBytes: 262_144, commandMs: 60_000 }, attempt, {}, `root-${logicalName}`, "write"),
        resource => resource.close);
        const working = yield* makeLogicalDocumentWorkingSet({ scopeId, clock, lifetime, readTransaction,
          snapshotCommitSeq, rootEvaluator: evaluator, rootAttempt: attempt, rootAttemptFence: pins.attemptFence,
          tables: [{ tableId, logicalName }], requireAdmission: requireLogicalDocumentRootEvaluatorOpen(evaluator, pins, () => failure("closed")),
          validateDocument: () => Effect.void,
          error: failure, uniqueConflict: () => failure("uniqueConflict"),
          limits: { pageRows: 8, identities, documentBytes: 65_536 },
        }, firstTime, [], [], { observeQuery: query => {
          expect(active).toBe(true);
          if (query.name === "snapshotRevision") rootSnapshotRevisions++;
        } });
        const id = yield* lifetime.begin(lifetime.context);
        return { working, lifetime, id };
      });
      const first = yield* open(firstTable, "notes");
      // Pending seed hydration is the first actual historical load.
      expect(checkedReads - firstReadCount).toBe(1);
      expect(rootSnapshotRevisions).toBe(1);
      expect(admissionTransactions - rootAdmissionCount).toBe(0);
      expect(yield* first.working.documents.get(first.lifetime.context, first.id, firstId, "notes"))
        .toMatchObject({ label: "pending" });
      expect(yield* first.working.documents.patch(first.lifetime.context, first.id, firstId,
        { label: "native-first" }, "notes")).toMatchObject({ label: "native-first" });
      expect(checkedReads - firstReadCount).toBe(1);
      expect(rootSnapshotRevisions).toBe(1);
      expect(admissionTransactions - rootAdmissionCount).toBe(0);
      yield* first.lifetime.seal;
      const firstChanges = yield* first.working.close();
      expect(firstChanges.attempts).toHaveLength(1);
      expect(firstChanges.attempts[0]?.ordinal).toBe(0);
      yield* projectLogicalDocumentJournalContribution(firstChanges);
      expect((yield* Effect.result(first.working.documents.get(first.lifetime.context, first.id, firstId)))
        ._tag).toBe("Failure");

      const second = yield* open(secondTable, "labels");
      expect(checkedReads - firstReadCount).toBe(1);
      expect(yield* second.working.documents.get(second.lifetime.context, second.id, secondId, "labels"))
        .toEqual(null);
      expect(checkedReads - firstReadCount).toBe(2);
      expect(rootSnapshotRevisions).toBe(2);
      expect(admissionTransactions - rootAdmissionCount).toBe(0);
      expect(yield* second.working.documents.get(second.lifetime.context, second.id, secondId, "labels"))
        .toEqual(null);
      yield* second.lifetime.seal;
      const secondChanges = yield* second.working.close();
      expect(secondChanges.attempts).toHaveLength(0);
      expect(secondChanges.dependencies.map(dependency => dependency.documentId)).toEqual([secondId]);
      expect((yield* Effect.result(second.working.documents.get(second.lifetime.context, second.id, firstId)))
        ._tag).toBe("Failure");

      const third = yield* open(firstTable, "notes");
      expect(checkedReads - firstReadCount).toBe(2);
      expect(rootSnapshotRevisions).toBe(2);
      expect(yield* third.working.documents.get(third.lifetime.context, third.id, firstId, "notes"))
        .toMatchObject({ label: "native-first" });
      expect(yield* third.working.documents.patch(third.lifetime.context, third.id, firstId,
        { label: "native-second" }, "notes")).toMatchObject({ label: "native-second" });
      yield* third.lifetime.seal;
      const thirdChanges = yield* third.working.close();
      expect(thirdChanges.attempts).toHaveLength(1);
      expect(thirdChanges.attempts[0]?.ordinal).toBe(0);
      expect(thirdChanges.dependencies.map(dependency => dependency.documentId)).toContain(firstId);
      yield* projectLogicalDocumentJournalContribution(thirdChanges);
      // Root-local cached gets, patches and later source reuse stay tentative.
      // Only seed hydration and the uncached tombstone load use checked SQL.
      expect(checkedReads - firstReadCount).toBe(2);
      expect(rootSnapshotRevisions).toBe(2);
      expect(admissionTransactions - rootAdmissionCount).toBe(0);
      const detached = root.snapshot();
      expect(detached.changes).toHaveLength(1);
      expect(detached.changes[0]).toMatchObject({ documentId: firstId, kind: "live" });
      const live = detached.changes[0];
      if (live?.kind !== "live") throw new Error("Expected live root change");
      if (!isJsonObject(live.document.valueJson)) throw new Error("Expected result object");
      const originalByte = live.document.canonicalBytes[0];
      Reflect.set(live.document.valueJson, "label", "tampered");
      live.document.canonicalBytes[0] = (originalByte ?? 0) ^ 0xff;
      expect(root.snapshot().changes[0]).toMatchObject({ kind: "live", document: { valueJson: { label: "native-second" } } });
      const nextLive = root.snapshot().changes[0];
      if (nextLive?.kind !== "live") throw new Error("Expected retained live root change");
      expect(nextLive.document.canonicalBytes[0]).toBe(originalByte);
      expect(root.stageAppPoint({ tableId: firstTable, rowId: firstRow,
        observed: seed.observed, overlay: { kind: "live", creationTime: firstTime, document: laterPending } })).toBe(false);
      expect((yield* Effect.result(makeLogicalDocumentWorkingSet({ scopeId, clock, lifetime: third.lifetime,
        readTransaction, snapshotCommitSeq, rootEvaluator: root, rootAttempt: {} as SessionJournalAttempt,
        rootAttemptFence: pins.attemptFence, tables: [{ tableId: firstTable, logicalName: "notes" }],
        requireAdmission, validateDocument: () => Effect.void, error: failure,
        uniqueConflict: () => failure("uniqueConflict"), limits: { pageRows: 8, identities: 8, documentBytes: 65_536 },
      }, firstTime, [], [])))._tag).toBe("Failure");
      expect((yield* Effect.result(makeLogicalDocumentWorkingSet({ scopeId: ScopeIdSchema.make("scope_53000000-0000-0000-0000-000000000099"),
        clock, lifetime: third.lifetime, readTransaction, snapshotCommitSeq, rootEvaluator: root,
        rootAttempt: attempt, rootAttemptFence: pins.attemptFence,
        tables: [{ tableId: firstTable, logicalName: "notes" }], requireAdmission,
        validateDocument: () => Effect.void, error: failure,
        uniqueConflict: () => failure("uniqueConflict"), limits: { pageRows: 8, identities: 8, documentBytes: 65_536 },
      }, firstTime, [], [])))._tag).toBe("Failure");
      const refused = yield* open(firstTable, "notes");
      const beforeRefusedRead = checkedReads;
      const beforeRefusedSql = rootSnapshotRevisions;
      const beforeRefusedDependencies = root.snapshot().dependencies.length;
      const beforeRefusedAdmissions = admissionTransactions;
      allowed = false;
      // A later persisted refusal is discovered by the next actual read;
      // previously observed root-local data remains tentative in the meantime.
      expect(yield* refused.working.documents.get(refused.lifetime.context, refused.id, firstId, "notes"))
        .toMatchObject({ label: "native-second" });
      expect(checkedReads).toBe(beforeRefusedRead);
      expect(admissionTransactions).toBe(beforeRefusedAdmissions);
      expect(yield* Effect.result(refused.working.documents.get(refused.lifetime.context, refused.id, absentId, "notes")))
        .toMatchObject({ _tag: "Failure", failure: { message: "sourceMismatch" } });
      expect(checkedReads).toBe(beforeRefusedRead + 1);
      expect(rootSnapshotRevisions).toBe(beforeRefusedSql);
      expect(admissionTransactions).toBe(beforeRefusedAdmissions);
      expect(root.snapshot().dependencies).toHaveLength(beforeRefusedDependencies);
      expect(root.snapshot().dependencies.map(dependency => dependency.documentId)).not.toContain(absentId);
      expect(active).toBe(false);
      allowed = true;
      root.close();
      expect(() => root.snapshot()).toThrow("closed");
      const limited = makeLogicalDocumentRootEvaluator(pins, { identities: 2, workingBytes: 1_048_576 });
      const limitedFirst = yield* open(firstTable, "notes", limited);
      expect(yield* limitedFirst.working.documents.get(limitedFirst.lifetime.context, limitedFirst.id, firstId))
        .toMatchObject({ label: "original" });
      yield* limitedFirst.lifetime.seal;
      yield* limitedFirst.working.close();
      const limitedSecond = yield* open(secondTable, "labels", limited);
      expect(yield* limitedSecond.working.documents.get(limitedSecond.lifetime.context, limitedSecond.id, secondId))
        .toEqual(null);
      yield* limitedSecond.lifetime.seal;
      yield* limitedSecond.working.close();
      const limitedThird = yield* open(firstTable, "notes", limited);
      expect((yield* Effect.result(limitedThird.working.documents.get(limitedThird.lifetime.context,
        limitedThird.id, absentId)))._tag).toBe("Failure");
      limited.close();
      const smallCallRoot = makeLogicalDocumentRootEvaluator(pins, { identities: 8, workingBytes: 1_048_576 });
      const smallCall = yield* open(firstTable, "notes", smallCallRoot, 1);
      expect((yield* Effect.result(smallCall.working.documents.getMany(smallCall.lifetime.context,
        smallCall.id, "notes", [firstId, absentId])))._tag).toBe("Failure");
      expect(smallCallRoot.snapshot().dependencies).toHaveLength(0);
      smallCallRoot.close();
      const appUpdates = makeLogicalDocumentRootEvaluator(pins, { identities: 8, workingBytes: 1_048_576 });
      expect(appUpdates.stageAppPoint({ tableId: firstTable, rowId: firstRow, observed: seed.observed,
        overlay: { kind: "live", creationTime: firstTime, document: pending } })).toBe(true);
      expect(appUpdates.stageAppPoint({ tableId: firstTable, rowId: firstRow, observed: seed.observed,
        overlay: { kind: "live", creationTime: firstTime, document: laterPending } })).toBe(true);
      expect(appUpdates.stageAppPoint({ tableId: firstTable, rowId: firstRow,
        observed: { kind: "missing", basis: { kind: "noVisibleRevision" } },
        overlay: { kind: "live", creationTime: firstTime, document: pending } })).toBe(false);
      const latestApp = yield* open(firstTable, "notes", appUpdates);
      expect(yield* latestApp.working.documents.get(latestApp.lifetime.context, latestApp.id, firstId))
        .toMatchObject({ label: "later-pending" });
      yield* latestApp.lifetime.seal;
      yield* latestApp.working.close();
      appUpdates.close();
      const deniedRoot = makeLogicalDocumentRootEvaluator(pins, { identities: 8, workingBytes: 1_048_576 });
      const denied = yield* open(secondTable, "labels", deniedRoot);
      expect((yield* Effect.result(denied.working.documents.get(denied.lifetime.context,
        denied.id, firstId)))._tag).toBe("Failure");
      expect(deniedRoot.snapshot().dependencies).toHaveLength(0);
      deniedRoot.close();
    })));
}
