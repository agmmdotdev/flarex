import type { FiniteStorageCaptureOperation, FiniteStorageCaptureEnvelopes } from "../src/finiteStorageCapture";
import { fxSystemScopeExecutionAuthorities } from "../src/schema";
import { eq, sql } from "drizzle-orm";
import { Effect, Result } from "effect";
import { expect } from "vitest";
import { canonicalizeAppDocumentV1, AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { isJsonObject } from "flarex-protocol/json";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId, decodeCatalogIndexDefinitionId, decodeCatalogIndexId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId, decodeSchemaManifestAppDeveloperOrderedIndexSpecV1 } from "flarex-protocol/schema-manifest";
import { lowerAppDeveloperOrderedIndexPhysicalSpecV1 } from "flarex-protocol/ordered-index";
import { canonicalizeAppIndexPhysicalSpecV1, canonicalAppIndexPhysicalSpecBytesHexV1ToBytes,
  appIndexPhysicalSpecSha256HexV1ToBytes } from "flarex-protocol/index-definition";
import { CommitSeqSchema, FlarexDbV1StorageGenerationSchema, ScopeEpochSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction, prepareAppRowsSnapshotReadEffect,
  captureAppRowsAtSnapshotInTransactionEffect, readAppRowAtSnapshotInTransactionEffect,
  type AppRowReadResultV1, type ReadAppRowError } from "../src/appRows";
import { makeBoundedRequestLifetime } from "../src/boundedRequestLifetime";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { runEffectTransaction } from "../src/effectTransaction";
import { makeLogicalDocumentWorkingSet, prepareLogicalWriteMechanics, combineLogicalWriteMechanics } from "../src/logicalDocuments/workingSet";
import type { LogicalStorageReadDemand, LogicalDocumentWorkingSetInput, PreparedLogicalDocumentWriteMechanics } from "../src/logicalDocuments/model";
import { makePreparedHostRuntime, retainPreparedHost } from "../src/preparedHostRuntime";
import { makeLogicalDocumentRootEvaluator, requireLogicalDocumentRootEvaluatorOpen } from "../src/logicalDocuments/rootEvaluator";
import type { SessionJournalAttempt } from "../src/sessionJournalStore";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { getScopeClock } from "../src/scopeClock";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../src/scopeClock";
import { fxSystemScopeClocks, deployments, fxControlTables, fxControlScopes, fxControlIndexes, fxControlIndexDefinitions } from "../src/schema";
import { locateAppIndexDefinitionByIdEffect, type LocatedAppIndexDefinitionV1 } from "../src/appIndexDefinitions";
import { lowerAppDeveloperIndexKeyV1 } from "../src/appDeveloperIndexCommitV1";
import { appendAppIndexEntryRevisionsInTransactionEffect, prepareAppIndexSnapshotReadEffect,
  buildAppIndexSnapshotReadStatement, decodeCapturedAppIndexSnapshotPageEffect } from "../src/appIndexEntries";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import { rowsFromDriverExecuteResult } from "../src/driverExecuteResult";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
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
    await db.transaction(async tx => {
      await tx.insert(fxSystemScopeClocks).values({ scopeId });
      await tx.insert(fxSystemScopeExecutionAuthorities).values({ scopeId,
        storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"), epoch });
    });
    const original = await canonicalizeAppDocumentV1({ tableId: firstTable, rowId: firstRow,
      creationTime: firstTime, fields: { label: "original" } });
    const deleted = await canonicalizeAppDocumentV1({ tableId: secondTable, rowId: secondRow,
      creationTime: secondTime, fields: { label: "deleted" } });
    const pending = await canonicalizeAppDocumentV1({ tableId: firstTable, rowId: firstRow,
      creationTime: firstTime, fields: { label: "pending" } });
    const laterPending = await canonicalizeAppDocumentV1({ tableId: firstTable, rowId: firstRow,
      creationTime: firstTime, fields: { label: "later-pending" } });
    const insertedPending = await canonicalizeAppDocumentV1({ tableId: firstTable, rowId: absentRow,
      creationTime: firstTime, fields: { label: "inserted-pending" } });
    const entered = await canonicalizeAppDocumentV1({ tableId: firstTable, rowId: absentRow,
      creationTime: firstTime, fields: { label: "original" } });
    const sortedPending = await canonicalizeAppDocumentV1({ tableId: firstTable, rowId: firstRow,
      creationTime: firstTime, fields: { label: "aaa" } });
    const pendingScaleCases = await Promise.all([1, 10, 100].map(async count => ({ count,
      inserts: await Promise.all(Array.from({ length: count - 1 }, async (_, ordinal) => {
        const rowId = decodeAppRowIdHexV1((1024 + ordinal).toString(16).padStart(32, "0"));
        return { rowId, documentId: appDocumentIdV1FromRowIdentity({ tableId: firstTable, rowId }),
          document: await canonicalizeAppDocumentV1({ tableId: firstTable, rowId, creationTime: firstTime,
            fields: { label: `scale_${ordinal}` } }) };
      })),
    })));
    const origin = { kind: "synthetic", sourceId: "working-set-page" };
    const pageSchema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "working-set-page",
      capabilities: [], tables: [{ tableId: "notes", origin,
        columns: [{ columnId: "label", type: "text", nullable: false, default: { kind: "none" }, origin }],
        keys: [{ keyId: "label", kind: "primary", columns: ["label"], origin }],
        indexes: [], constraints: [], relationships: [],
      }] }));
    const pageTable = pageSchema.tables[0];
    if (pageTable === undefined) throw new Error("Missing page schema");
    const largePending = await canonicalizeAppDocumentV1({ tableId: firstTable, rowId: firstRow,
      creationTime: firstTime, fields: { label: "x".repeat(2048) } });
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
    const deploymentId = "deployment_working_set_demand";
    await db.insert(deployments).values({ deploymentId, projectId: "project_working_set_demand" });
    await db.insert(fxControlTables).values({ deploymentId, tableId: firstTable, namespace: "app", logicalName: "notes" });
    await db.insert(fxControlScopes).values({ scopeId, deploymentId, isolationKind: "shared_database",
      physicalLocator: { kind: "shared_database", databaseKey: "working-set-demand", schemaName: "public" } });
    const definitions: LocatedAppIndexDefinitionV1[] = [];
    for (let ordinal = 0; ordinal <= 100; ordinal++) {
      const field = ordinal === 0 ? "label" : `unused_${ordinal}`, logicalIndexId = decodeCatalogIndexId(ordinal + 1);
      const indexDefinitionId = decodeCatalogIndexDefinitionId(ordinal + 1);
      const physicalSpec = lowerAppDeveloperOrderedIndexPhysicalSpecV1(decodeSchemaManifestAppDeveloperOrderedIndexSpecV1({
        kind: "developerOrdered", specVersion: 1, fields: [field],
      }));
      const canonical = await canonicalizeAppIndexPhysicalSpecV1(physicalSpec);
      await db.insert(fxControlIndexes).values({ deploymentId, logicalIndexId, tableId: firstTable, descriptor: `by_${field}` });
      await db.insert(fxControlIndexDefinitions).values({ deploymentId, indexDefinitionId, accessKind: "developer",
        accessIdentityId: logicalIndexId, logicalIndexId, tableId: firstTable, physicalSpecCodecVersion: canonical.codecVersion,
        physicalSpecJson: physicalSpec, physicalSpecBytes: canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(canonical.canonicalBytesHex),
        physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(canonical.sha256Hex) });
      const located = await runEffect(locateAppIndexDefinitionByIdEffect(db, scopeId, indexDefinitionId));
      if (located === null) throw new Error("Missing issued working-set index");
      definitions.push(located);
    }
    const labelIndex = definitions[0];
    if (labelIndex === undefined) throw new Error("Missing label index");
    const labelKey = await runEffect(Effect.fromResult(lowerAppDeveloperIndexKeyV1(labelIndex, original, firstTime)));
    if (labelKey === null) throw new Error("Missing label membership");
    await db.transaction(tx => runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [{ kind: "live", scopeId,
      definition: labelIndex, encodedKey: labelKey, rowId: firstRow, writeEpoch: epoch, commitSeq: CommitSeqSchema.make(1n) }])));
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
    const originalRevision = await runEffect(runEffectTransaction<AppRowReadResultV1, ReadAppRowError, Error, FlarexMetadataTransaction>(
      callback => db.transaction(callback), "Original finite fixture revision", tx =>
        readAppRowAtSnapshotInTransactionEffect(tx, { scopeId, tableId: firstTable, rowId: firstRow,
          snapshotCommitSeq: CommitSeqSchema.make(1n) }), cause => failure("originalRevision", cause)));
    if (originalRevision.kind !== "live") throw new Error("Missing actual original finite fixture revision");
    const seedRoot = (evaluator: typeof root, input: Readonly<{ tableId: typeof firstTable; rowId: typeof firstRow;
      observed: typeof originalObserved | { kind: "missing"; basis: { kind: "noVisibleRevision" } | { kind: "tombstone"; revisionCommitSeq: typeof snapshotCommitSeq } }; overlay: { kind: "deleted" } | { kind: "live"; creationTime: typeof firstTime; document: typeof original } }>): boolean => {
      const documentId = appDocumentIdV1FromRowIdentity(input);
      const observation = { documentId, tableId: input.tableId, rowId: input.rowId, readAt: snapshotCommitSeq,
        dependency: { kind: "appRowPoint" as const, documentId, observed: input.observed } };
      const admitted = evaluator.observePoint(input.tableId === firstTable ? "notes" : "labels", observation,
        input.observed.kind === "present" ? originalRevision : { kind: "missing" });
      if (Result.isFailure(admitted)) return false;
      if (input.overlay.kind === "deleted" && input.observed.kind === "missing") return true;
      return Result.isSuccess(evaluator.writePoint(input.tableId === firstTable ? "notes" : "labels", observation,
        input.overlay, input.overlay.kind === "deleted" ? "delete" : input.observed.kind === "present" ? "replace" : "insert"));
    };
    const originalObserved = { kind: "present" as const, revisionCommitSeq: CommitSeqSchema.make(1n) };
    const missingObserved = { kind: "missing" as const, basis: { kind: "noVisibleRevision" as const } };
    const seedDocument = structuredClone(pending);
    const seed = { tableId: firstTable, rowId: firstRow,
      observed: { kind: "present" as const, revisionCommitSeq: CommitSeqSchema.make(1n) },
      overlay: { kind: "live" as const, creationTime: firstTime, document: seedDocument } };
    expect(seedRoot(root, seed)).toBe(true);
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
      // Application already supplied the original observation and preimage.
      // Construction and cached native reuse need no hydration SQL.
      expect(checkedReads - firstReadCount).toBe(0);
      expect(rootSnapshotRevisions).toBe(0);
      expect(admissionTransactions - rootAdmissionCount).toBe(0);
      expect(yield* first.working.documents.get(first.lifetime.context, first.id, firstId, "notes"))
        .toMatchObject({ label: "pending" });
      expect(yield* first.working.documents.patch(first.lifetime.context, first.id, firstId,
        { label: "native-first" }, "notes")).toMatchObject({ label: "native-first" });
      expect(checkedReads - firstReadCount).toBe(0);
      expect(rootSnapshotRevisions).toBe(0);
      expect(admissionTransactions - rootAdmissionCount).toBe(0);
      yield* first.lifetime.seal;
      const firstChanges = yield* first.working.close();
      expect(firstChanges.attempts).toHaveLength(1);
      expect(firstChanges.attempts[0]?.ordinal).toBe(0);
      expect(firstChanges.changes).toHaveLength(0);
      expect(firstChanges.dependencies).toHaveLength(0);
      expect((yield* Effect.result(first.working.documents.get(first.lifetime.context, first.id, firstId)))
        ._tag).toBe("Failure");

      const second = yield* open(secondTable, "labels");
      expect(checkedReads - firstReadCount).toBe(0);
      expect(yield* second.working.documents.get(second.lifetime.context, second.id, secondId, "labels"))
        .toEqual(null);
      expect(checkedReads - firstReadCount).toBe(1);
      expect(rootSnapshotRevisions).toBe(1);
      expect(admissionTransactions - rootAdmissionCount).toBe(0);
      expect(yield* second.working.documents.get(second.lifetime.context, second.id, secondId, "labels"))
        .toEqual(null);
      yield* second.lifetime.seal;
      const secondChanges = yield* second.working.close();
      expect(secondChanges.attempts).toHaveLength(0);
      expect(secondChanges.dependencies).toHaveLength(0);
      expect(root.snapshot().dependencies.map(dependency => dependency.documentId)).toContain(secondId);
      expect((yield* Effect.result(second.working.documents.get(second.lifetime.context, second.id, firstId)))
        ._tag).toBe("Failure");

      const third = yield* open(firstTable, "notes");
      expect(checkedReads - firstReadCount).toBe(1);
      expect(rootSnapshotRevisions).toBe(1);
      expect(yield* third.working.documents.get(third.lifetime.context, third.id, firstId, "notes"))
        .toMatchObject({ label: "native-first" });
      expect(yield* third.working.documents.patch(third.lifetime.context, third.id, firstId,
        { label: "native-second" }, "notes")).toMatchObject({ label: "native-second" });
      yield* third.lifetime.seal;
      const thirdChanges = yield* third.working.close();
      expect(thirdChanges.attempts).toHaveLength(1);
      expect(thirdChanges.attempts[0]?.ordinal).toBe(0);
      expect(thirdChanges.dependencies).toHaveLength(0);
      expect(root.snapshot().dependencies.map(dependency => dependency.documentId)).toContain(firstId);
      expect(thirdChanges.changes).toHaveLength(0);
      // Root-local cached gets, patches and later source reuse stay tentative.
      // Only the uncached tombstone load uses checked SQL.
      expect(checkedReads - firstReadCount).toBe(1);
      expect(rootSnapshotRevisions).toBe(1);
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
      expect(seedRoot(root, { tableId: firstTable, rowId: firstRow,
        observed: seed.observed, overlay: { kind: "live", creationTime: firstTime, document: laterPending } })).toBe(true);
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
        .toMatchObject({ label: "later-pending" });
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
      expect(seedRoot(appUpdates, { tableId: firstTable, rowId: firstRow, observed: seed.observed,
        overlay: { kind: "live", creationTime: firstTime, document: pending } })).toBe(true);
      expect(seedRoot(appUpdates, { tableId: firstTable, rowId: firstRow, observed: seed.observed,
        overlay: { kind: "live", creationTime: firstTime, document: laterPending } })).toBe(true);
      expect(seedRoot(appUpdates, { tableId: firstTable, rowId: firstRow,
        observed: { kind: "missing", basis: { kind: "noVisibleRevision" } },
        overlay: { kind: "live", creationTime: firstTime, document: pending } })).toBe(false);
      const latestApp = yield* open(firstTable, "notes", appUpdates);
      expect(yield* latestApp.working.documents.get(latestApp.lifetime.context, latestApp.id, firstId))
        .toMatchObject({ label: "later-pending" });
      const cachedSeedReads = checkedReads;
      const cachedSeedSql = rootSnapshotRevisions;
      expect(seedRoot(appUpdates, { tableId: firstTable, rowId: firstRow, observed: seed.observed,
        overlay: { kind: "live", creationTime: firstTime, document: pending } })).toBe(true);
      // Application and native code share this same row. Later writes replace
      // cached membership while preserving the exact original dependency.
      expect(yield* latestApp.working.documents.getMany(latestApp.lifetime.context, latestApp.id, "notes", [firstId]))
        .toMatchObject([{ label: "pending" }]);
      expect(checkedReads).toBe(cachedSeedReads);
      expect(rootSnapshotRevisions).toBe(cachedSeedSql);
      expect(seedRoot(appUpdates, { tableId: firstTable, rowId: firstRow, observed: seed.observed,
        overlay: { kind: "deleted" } })).toBe(true);
      expect(yield* latestApp.working.documents.get(latestApp.lifetime.context, latestApp.id, firstId)).toEqual(null);
      expect(checkedReads).toBe(cachedSeedReads);
      yield* latestApp.lifetime.seal;
      yield* latestApp.working.close();
      appUpdates.close();
      const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 1_048_576 });
      const retained = yield* retainPreparedHost(runtime, Effect.gen(function* () {
        const input = { tables: [{ tableId: firstTable, logicalName: "notes" }, { tableId: secondTable, logicalName: "labels" }],
          indexes: [], unique: [] };
        const small = yield* prepareLogicalWriteMechanics(input, failure);
        const broad = yield* prepareLogicalWriteMechanics({ ...input, tables: [...input.tables,
          ...Array.from({ length: 100 }, (_, ordinal) => ({ tableId: decodeCatalogTableId(100 + ordinal), logicalName: `unused_${ordinal}` }))] }, failure);
        const extra = yield* prepareLogicalWriteMechanics({ tables: [{ tableId: decodeCatalogTableId(999), logicalName: "extra" }],
          indexes: [], unique: [] }, failure);
        const indexed = yield* prepareLogicalWriteMechanics({ ...input, indexes: [labelIndex] }, failure);
        const indexedBroad = yield* prepareLogicalWriteMechanics({ ...input, indexes: definitions }, failure);
        const paged = yield* prepareLogicalWriteMechanics({ ...input,
          tables: [{ tableId: firstTable, logicalName: "notes", relational: pageTable }, input.tables[1]!],
          relationalCapabilities: pageSchema.capabilities, indexes: definitions }, failure);
        return { small, broad, extra, indexed, indexedBroad, paged };
      }));
      const mechanics = yield* retained.use(Effect.succeed);
      const combined = yield* combineLogicalWriteMechanics([mechanics.small, mechanics.extra], failure);
      expect(yield* combineLogicalWriteMechanics([mechanics.small, mechanics.extra], failure)).toBe(combined);
      expect(Object.isFrozen(combined.tables)).toBe(true);
      expect(combined.tableName(firstTable)).toBe("notes");
      expect(combined.tableId("extra")).toBe(decodeCatalogTableId(999));
      expect(combined.tableName(decodeCatalogTableId(998))).toBeUndefined();
      expect(combined.tableId("missing")).toBeUndefined();
      const constructionRoot = makeLogicalDocumentRootEvaluator(pins, { identities: 8, workingBytes: 1_048_576 });
      expect(seedRoot(constructionRoot, seed)).toBe(true);
      let constructionReads = 0;
      let constructionDemands = 0;
      const refuseFiniteConstruction = (selected: PreparedLogicalDocumentWriteMechanics,
        overrides: Partial<Pick<LogicalDocumentWorkingSetInput<Error>, "tables" | "relationalCapabilities" |
          "searchDefinitions" | "rootAttemptFence" | "snapshotCommitSeq">> = {},
        indexes = mechanics.small.indexes, unique = mechanics.small.unique) => Effect.gen(function* () {
        const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
          { calls: 16, commandBytes: 262_144, commandMs: 60_000 }, attempt, {}, "refused-finite-construction", "write"),
        resource => resource.close);
        expect(yield* Effect.result(makeLogicalDocumentWorkingSet({ scopeId, clock, lifetime, snapshotCommitSeq,
          rootEvaluator: constructionRoot, rootAttempt: attempt, rootAttemptFence: pins.attemptFence,
          tables: mechanics.small.tables, searchDefinitions: mechanics.small.searchDefinitions,
          readTransaction: () => Effect.suspend(() => {
            constructionReads++;
            return Effect.fail(failure("unexpectedConstructionRead"));
          }),
          readReadiness: { kind: "finiteQueryRequired", mechanics: selected, captureStorage: () => Effect.suspend(() => {
            constructionDemands++;
            return Effect.fail(failure("unexpectedConstructionDemand"));
          }) },
          // Let construction itself check exact finite pins rather than an
          // earlier admission callback hiding its attachment refusal.
          requireAdmission: Effect.void, validateDocument: () => Effect.void,
          error: failure, uniqueConflict: () => failure("uniqueConflict"),
          limits: { pageRows: 8, identities: 8, documentBytes: 65_536 }, ...overrides,
        }, firstTime, unique, indexes))).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
        expect(constructionReads).toBe(0);
        expect(constructionDemands).toBe(0);
        expect(constructionRoot.snapshot().dependencies).toHaveLength(1);
      });
      let foreignMechanicsReads = 0;
      const forgedMechanics = new Proxy(mechanics.small, { get(target, key, receiver) {
        foreignMechanicsReads++;
        return Reflect.get(target, key, receiver);
      } });
      yield* refuseFiniteConstruction(forgedMechanics);
      expect(foreignMechanicsReads).toBe(0);
      // The actual issuer can prepare a full-profile value without a retained
      // lease; its private registry membership still cannot authorize finite reuse.
      const unleasedMechanics = yield* prepareLogicalWriteMechanics({ tables: mechanics.small.tables,
        indexes: mechanics.small.indexes, unique: mechanics.small.unique }, failure);
      yield* refuseFiniteConstruction(unleasedMechanics, { tables: unleasedMechanics.tables,
        searchDefinitions: unleasedMechanics.searchDefinitions }, unleasedMechanics.indexes, unleasedMechanics.unique);
      let foreignArrayReads = 0;
      const foreignArray = <Value>(values: readonly Value[]) => new Proxy([...values], {
        get(target, key, receiver) { foreignArrayReads++; return Reflect.get(target, key, receiver); },
        ownKeys(target) { foreignArrayReads++; return Reflect.ownKeys(target); },
      });
      yield* refuseFiniteConstruction(mechanics.small, { tables: foreignArray(mechanics.small.tables) });
      yield* refuseFiniteConstruction(mechanics.small, { relationalCapabilities: foreignArray([]) });
      yield* refuseFiniteConstruction(mechanics.small, { searchDefinitions: foreignArray(mechanics.small.searchDefinitions) });
      yield* refuseFiniteConstruction(mechanics.small, {}, foreignArray(mechanics.small.indexes));
      yield* refuseFiniteConstruction(mechanics.small, {}, mechanics.small.indexes, foreignArray(mechanics.small.unique));
      expect(foreignArrayReads).toBe(0);
      yield* refuseFiniteConstruction(mechanics.small, { rootAttemptFence: `${pins.attemptFence}-wrong` });
      yield* refuseFiniteConstruction(mechanics.small, { snapshotCommitSeq: CommitSeqSchema.make(2n) });
      constructionRoot.close();
      let demandAllowed = true;
      const demands: LogicalStorageReadDemand[] = [];
      const captureStorage = <K extends FiniteStorageCaptureOperation["kind"]>(
        operation: Extract<FiniteStorageCaptureOperation, { kind: K }>, demand: LogicalStorageReadDemand,
      ): Effect.Effect<FiniteStorageCaptureEnvelopes[K], Error> => {
        const named: FiniteStorageCaptureOperation = operation;
        const capture = Effect.suspend(() => {
          demands.push(demand);
          if (!demandAllowed) return Effect.fail(failure("notReady"));
          return readTransaction(tx => Effect.gen(function* () {
            if (named.kind === "rows") {
              const prepared = yield* prepareAppRowsSnapshotReadEffect(named.input)
                .pipe(Effect.mapError(cause => failure("statementFailure", cause)));
              const rawRows = yield* captureAppRowsAtSnapshotInTransactionEffect(tx, prepared,
                named.maximumTotalValueBytes, query => {
                  expect(active).toBe(true);
                  if (query.name === "snapshotRevision") rootSnapshotRevisions++;
                }).pipe(Effect.mapError(cause => failure("statementFailure", cause)));
              return { kind: "rows" as const, prepared, rawRows };
            }
            if (named.kind === "indexPage" || named.kind === "indexRows") {
              const prepared = yield* prepareAppIndexSnapshotReadEffect(named.input)
                .pipe(Effect.mapError(cause => failure("statementFailure", cause)));
              const captured = yield* runDrizzleStatementEffect(tx.execute(buildAppIndexSnapshotReadStatement(prepared)),
                cause => failure("statementFailure", cause));
              const rawRows = rowsFromDriverExecuteResult(captured, () => { throw failure("storedCorruption"); });
              if (named.kind === "indexPage") return { kind: "indexPage" as const, prepared, rawRows };
              const page = yield* decodeCapturedAppIndexSnapshotPageEffect(prepared, rawRows)
                .pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
              const excluded = new Set(named.excludeRowIds);
              const rowIds = [...new Set(page.entries.map(entry => entry.rowId))].filter(rowId => !excluded.has(rowId));
              const capturedRows = !page.isDone || rowIds.length === 0 || rowIds.length > 256 ? [] : yield* Effect.gen(function* () {
                const rowsPrepared = yield* prepareAppRowsSnapshotReadEffect({ scopeId: named.input.scopeId,
                  tableId: named.tableId, rowIds, snapshotCommitSeq: named.input.snapshotCommitSeq })
                  .pipe(Effect.mapError(cause => failure("statementFailure", cause)));
                return yield* captureAppRowsAtSnapshotInTransactionEffect(tx, rowsPrepared,
                  named.maximumTotalValueBytes, query => {
                    expect(active).toBe(true);
                    if (query.name === "snapshotRevision") rootSnapshotRevisions++;
                  }).pipe(Effect.mapError(cause => failure("statementFailure", cause)));
              });
              return { kind: "indexRows" as const, prepared, rawIndexRows: rawRows, rawRows: capturedRows };
            }
            if (named.kind === "transactionTime") {
              const times = yield* runDrizzleStatementEffect(tx.select({ timestamp: sql<string>`current_timestamp::text` })
                .from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, scopeId)), cause => failure("statementFailure", cause));
              const timestamp = times[0]?.timestamp;
              if (timestamp === undefined) return yield* Effect.die("Missing actual fixture database time");
              return { kind: "transactionTime" as const, timestamp };
            }
            return yield* Effect.die("This working-set fixture only captures row, index and time storage");
          }));
        });
        // SAFETY: each implemented named operation constructs its matching envelope;
        // unsupported operations die rather than pretending to return another kind.
        return capture as Effect.Effect<FiniteStorageCaptureEnvelopes[K], Error>;
      };
      const openPrepared = (evaluator: typeof root, prepared: PreparedLogicalDocumentWriteMechanics,
        maximumIdentities = 8) => Effect.gen(function* () {
        const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
          { calls: 16, commandBytes: 262_144, commandMs: 60_000 }, attempt, {}, "prepared-demand", "write"), resource => resource.close);
        const working = yield* makeLogicalDocumentWorkingSet({ scopeId, clock, lifetime, readTransaction, snapshotCommitSeq,
          rootEvaluator: evaluator, rootAttempt: attempt, rootAttemptFence: pins.attemptFence,
          tables: prepared.tables,
          ...(prepared.relationalCapabilities === undefined ? {} : { relationalCapabilities: prepared.relationalCapabilities }),
          searchDefinitions: prepared.searchDefinitions,
          readReadiness: { kind: "finiteQueryRequired", mechanics: prepared, captureStorage },
          requireAdmission: requireLogicalDocumentRootEvaluatorOpen(evaluator, pins, () => failure("closed")),
          validateDocument: () => Effect.void, error: failure, uniqueConflict: () => failure("uniqueConflict"),
          limits: { pageRows: maximumIdentities, identities: maximumIdentities, documentBytes: 65_536 },
        }, firstTime, prepared.unique, prepared.indexes);
        const id = yield* lifetime.begin(lifetime.context);
        return { working, lifetime, id };
      });
      for (const prepared of [mechanics.small, mechanics.broad]) {
        const selective = makeLogicalDocumentRootEvaluator(pins, { identities: 8, workingBytes: 1_048_576 });
        expect(seedRoot(selective, seed)).toBe(true);
        // The single pending owner refuses a mismatched original document
        // before it can influence a different identity or table.
        expect(seedRoot(selective, { tableId: firstTable, rowId: absentRow,
          observed: { kind: "present", revisionCommitSeq: CommitSeqSchema.make(1n) }, overlay: { kind: "deleted" } })).toBe(false);
        expect(seedRoot(selective, { tableId: secondTable, rowId: secondRow,
          observed: { kind: "present", revisionCommitSeq: CommitSeqSchema.make(2n) }, overlay: { kind: "deleted" } })).toBe(false);
        const borrowed = yield* openPrepared(selective, prepared);
        const beforeRead = checkedReads, beforeSql = rootSnapshotRevisions;
        const beforeDemand = demands.length;
        expect(yield* borrowed.working.documents.getMany(borrowed.lifetime.context, borrowed.id, "notes", [firstId]))
          .toMatchObject([{ label: "pending" }]);
        expect(checkedReads - beforeRead).toBe(0);
        expect(rootSnapshotRevisions - beforeSql).toBe(0);
        expect(demands.slice(beforeDemand).every(demand => demand.kind === "rows" && demand.tableId === firstTable)).toBe(true);
        expect(selective.snapshot().dependencies.map(dependency => dependency.documentId)).toEqual([firstId]);
        expect(yield* borrowed.working.documents.find(borrowed.lifetime.context, borrowed.id, "notes",
          { where: { _id: firstId }, offset: 0, limit: 1 })).toMatchObject({ docs: [{ label: "pending" }], total: 1 });
        expect(checkedReads - beforeRead).toBe(0);
        expect(yield* borrowed.working.documents.get(borrowed.lifetime.context, borrowed.id, absentId)).toBeNull();
        expect(checkedReads - beforeRead).toBe(1);
        selective.close();
      }
      const grouped = makeLogicalDocumentRootEvaluator(pins, { identities: 8, workingBytes: 1_048_576 });
      expect(seedRoot(grouped, seed)).toBe(true);
      expect(seedRoot(grouped, { tableId: firstTable, rowId: absentRow,
        observed: { kind: "missing", basis: { kind: "noVisibleRevision" } },
        overlay: { kind: "live", creationTime: firstTime, document: insertedPending } })).toBe(true);
      const batch = yield* openPrepared(grouped, mechanics.broad);
      const batchReads = checkedReads, batchSql = rootSnapshotRevisions;
      expect(yield* batch.working.documents.getMany(batch.lifetime.context, batch.id, "notes", [absentId, firstId]))
        .toMatchObject([{ label: "inserted-pending" }, { label: "pending" }]);
      expect(checkedReads - batchReads).toBe(0);
      expect(rootSnapshotRevisions - batchSql).toBe(0);
      expect(grouped.snapshot().dependencies.map(dependency => dependency.documentId).toSorted()).toEqual([firstId, absentId].toSorted());
      // A changed cached overlay preserves the original observation and output
      // order. The next uncached demand still authenticates current authority.
      expect(seedRoot(grouped, { ...seed, overlay: { kind: "live", creationTime: firstTime, document: laterPending } })).toBe(true);
      expect(yield* batch.working.documents.getMany(batch.lifetime.context, batch.id, "notes", [firstId]))
        .toMatchObject([{ label: "later-pending" }]);
      expect(checkedReads - batchReads).toBe(0);
      expect(rootSnapshotRevisions - batchSql).toBe(0);
      grouped.close();
      for (const scale of pendingScaleCases) {
        const stageScale = (evaluator: typeof root) => {
          expect(seedRoot(evaluator, seed)).toBe(true);
          for (const entry of scale.inserts) expect(seedRoot(evaluator, { tableId: firstTable, rowId: entry.rowId,
            observed: { kind: "missing", basis: { kind: "noVisibleRevision" } },
            overlay: { kind: "live", creationTime: firstTime, document: entry.document } })).toBe(true);
        };
        const pointRoot = makeLogicalDocumentRootEvaluator(pins, { identities: 128, workingBytes: 1_048_576 });
        stageScale(pointRoot);
        const point = yield* openPrepared(pointRoot, mechanics.broad, 128);
        const pointReads = checkedReads, pointSql = rootSnapshotRevisions, pointAdmissions = admissionTransactions;
        expect(yield* point.working.documents.get(point.lifetime.context, point.id, firstId))
          .toMatchObject({ label: "pending" });
        expect(checkedReads - pointReads).toBe(0);
        expect(rootSnapshotRevisions - pointSql).toBe(0);
        expect(admissionTransactions - pointAdmissions).toBe(0);
        expect(pointRoot.snapshot().dependencies).toHaveLength(scale.count);
        pointRoot.close();

        const batchRoot = makeLogicalDocumentRootEvaluator(pins, { identities: 128, workingBytes: 1_048_576 });
        stageScale(batchRoot);
        const scaled = yield* openPrepared(batchRoot, mechanics.broad, 128);
        const selectedIds = [firstId, ...scale.inserts.map(entry => entry.documentId)].reverse();
        const selectedLabels = ["pending", ...scale.inserts.map((_, ordinal) => `scale_${ordinal}`)].reverse();
        const scaledReads = checkedReads, scaledSql = rootSnapshotRevisions, scaledAdmissions = admissionTransactions;
        const found = yield* scaled.working.documents.getMany(scaled.lifetime.context, scaled.id, "notes", selectedIds);
        expect(found.map(document => document?.label)).toEqual(selectedLabels);
        expect(found).toHaveLength(scale.count);
        expect(checkedReads - scaledReads).toBe(0);
        expect(rootSnapshotRevisions - scaledSql).toBe(0);
        expect(admissionTransactions - scaledAdmissions).toBe(0);
        expect(batchRoot.snapshot().dependencies).toHaveLength(scale.count);
        batchRoot.close();

        // Capacity and original-identity refusals occur at the pending owner,
        // before a native operation can consume an invalid staged value.
        const resourceRoot = makeLogicalDocumentRootEvaluator(pins, { identities: 128,
          workingBytes: 1024 });
        expect(seedRoot(resourceRoot, { ...seed,
          overlay: { kind: "live", creationTime: firstTime, document: largePending } })).toBe(false);
        for (const entry of scale.inserts) expect(seedRoot(resourceRoot, { tableId: firstTable, rowId: entry.rowId,
          observed: { kind: "present", revisionCommitSeq: CommitSeqSchema.make(1n) }, overlay: { kind: "deleted" } })).toBe(false);
        const resource = yield* openPrepared(resourceRoot, mechanics.broad, 128);
        const resourceReads = checkedReads, resourceSql = rootSnapshotRevisions;
        expect(yield* resource.working.documents.get(resource.lifetime.context, resource.id, firstId))
          .toMatchObject({ label: "original" });
        expect(checkedReads - resourceReads).toBe(0);
        expect(rootSnapshotRevisions - resourceSql).toBe(0);
        expect(resourceRoot.snapshot().changes).toHaveLength(0);
        expect(resourceRoot.snapshot().dependencies.map(dependency => dependency.documentId)).toEqual([firstId]);
        resourceRoot.close();
      }
      for (const prepared of [mechanics.indexed, mechanics.indexedBroad]) {
        const membership = makeLogicalDocumentRootEvaluator(pins, { identities: 8, workingBytes: 1_048_576 });
        expect(seedRoot(membership, seed)).toBe(true); // original matches, overlay moves out
        expect(seedRoot(membership, { tableId: firstTable, rowId: absentRow,
          observed: { kind: "missing", basis: { kind: "noVisibleRevision" } },
          overlay: { kind: "live", creationTime: firstTime, document: entered } })).toBe(true);
        expect(seedRoot(membership, { tableId: secondTable, rowId: secondRow,
          observed: { kind: "present", revisionCommitSeq: CommitSeqSchema.make(2n) }, overlay: { kind: "deleted" } })).toBe(false);
        const indexed = yield* openPrepared(membership, prepared);
        const beforeRangeRead = checkedReads, beforeRangeSql = rootSnapshotRevisions, beforeRangeDemand = demands.length;
        expect(yield* indexed.working.documents.find(indexed.lifetime.context, indexed.id, "notes",
          { where: { label: "original" }, offset: 0, limit: 8 })).toMatchObject({ docs: [{ _id: absentId, label: "original" }], total: 1 });
        expect(checkedReads - beforeRangeRead).toBe(1);
        expect(rootSnapshotRevisions - beforeRangeSql).toBe(0);
        expect(demands[beforeRangeDemand]).toEqual({ kind: "index", tableId: firstTable, indexDefinitionId: labelIndex.indexDefinitionId });
        expect(membership.snapshot().dependencies.map(dependency => dependency.documentId).toSorted()).toEqual([firstId, absentId].toSorted());
        expect(seedRoot(membership, { ...seed, overlay: { kind: "deleted" } })).toBe(true);
        expect(yield* indexed.working.documents.find(indexed.lifetime.context, indexed.id, "notes",
          { where: { label: { gte: "a" } }, offset: 0, limit: 8 })).toMatchObject({ docs: [{ _id: absentId }], total: 1 });
        expect(rootSnapshotRevisions - beforeRangeSql).toBe(0);
        membership.close();
      }
      const pageRoot = makeLogicalDocumentRootEvaluator(pins, { identities: 8, workingBytes: 1_048_576 });
      expect(seedRoot(pageRoot, seed)).toBe(true);
      expect(seedRoot(pageRoot, { tableId: firstTable, rowId: absentRow,
        observed: { kind: "missing", basis: { kind: "noVisibleRevision" } },
        overlay: { kind: "live", creationTime: firstTime, document: entered } })).toBe(true);
      // An unrelated table's mismatched original is refused before page membership.
      expect(seedRoot(pageRoot, { tableId: secondTable, rowId: secondRow,
        observed: { kind: "present", revisionCommitSeq: CommitSeqSchema.make(2n) }, overlay: { kind: "deleted" } })).toBe(false);
      const paged = yield* openPrepared(pageRoot, mechanics.paged);
      const pageQuery = { fields: ["label"], order: { column: "label", direction: "asc" }, take: 1 };
      const beforePageReads = checkedReads, beforePageSql = rootSnapshotRevisions, beforePageAdmissions = admissionTransactions;
      expect(yield* paged.working.relationalPage(paged.lifetime.context, paged.id, "notes", pageQuery))
        .toEqual({ rows: [{ label: "original" }], hasMore: true });
      expect(checkedReads - beforePageReads).toBe(1);
      expect(rootSnapshotRevisions - beforePageSql).toBe(0);
      expect(admissionTransactions - beforePageAdmissions).toBe(0);
      expect(pageRoot.snapshot().dependencies.map(dependency => dependency.documentId).toSorted()).toEqual([firstId, absentId].toSorted());
      expect(seedRoot(pageRoot, { ...seed, overlay: { kind: "live", creationTime: firstTime, document: sortedPending } })).toBe(true);
      expect(yield* paged.working.relationalPage(paged.lifetime.context, paged.id, "notes", pageQuery))
        .toEqual({ rows: [{ label: "aaa" }], hasMore: true });
      expect(checkedReads - beforePageReads).toBe(2);
      expect(rootSnapshotRevisions - beforePageSql).toBe(0);
      expect(seedRoot(pageRoot, { ...seed, overlay: { kind: "deleted" } })).toBe(true);
      expect(yield* paged.working.relationalPage(paged.lifetime.context, paged.id, "notes", pageQuery))
        .toEqual({ rows: [{ label: "original" }], hasMore: false });
      expect(checkedReads - beforePageReads).toBe(3);
      expect(rootSnapshotRevisions - beforePageSql).toBe(0);
      expect(admissionTransactions - beforePageAdmissions).toBe(0);
      expect(pageRoot.snapshot().pageReads).toHaveLength(3);
      pageRoot.close();
      for (const cachedBase of [false, true]) {
        const ordered = makeLogicalDocumentRootEvaluator(pins, { identities: 8, workingBytes: 1024 });
        const bounded = yield* openPrepared(ordered, mechanics.small);
        if (cachedBase) expect(yield* bounded.working.documents.get(bounded.lifetime.context, bounded.id, firstId))
          .toMatchObject({ label: "original" });
        expect(seedRoot(ordered, { ...seed, overlay: { kind: "live", creationTime: firstTime, document: largePending } })).toBe(false);
        expect(seedRoot(ordered, { tableId: firstTable, rowId: absentRow,
          observed: { kind: "present", revisionCommitSeq: CommitSeqSchema.make(1n) }, overlay: { kind: "deleted" } })).toBe(false);
        const beforeOrderedSql = rootSnapshotRevisions;
        // Both rejected writes leave the valid original cached, independent
        // of whether native code observed it before the Application write.
        expect(yield* bounded.working.documents.get(bounded.lifetime.context, bounded.id, firstId))
          .toMatchObject({ label: "original" });
        expect(rootSnapshotRevisions - beforeOrderedSql).toBe(0);
        expect(ordered.snapshot().changes).toHaveLength(0);
        expect(ordered.snapshot().dependencies.map(dependency => dependency.documentId)).toEqual([firstId]);
        ordered.close();
      }
      const refusedDemand = makeLogicalDocumentRootEvaluator(pins, { identities: 8, workingBytes: 1_048_576 });
      expect(seedRoot(refusedDemand, seed)).toBe(true);
      const refusedPrepared = yield* openPrepared(refusedDemand, mechanics.small);
      const refusedSql = rootSnapshotRevisions;
      demandAllowed = false;
      expect(yield* Effect.result(refusedPrepared.working.documents.get(refusedPrepared.lifetime.context, refusedPrepared.id, absentId)))
        .toMatchObject({ _tag: "Failure", failure: { message: "notReady" } });
      expect(rootSnapshotRevisions).toBe(refusedSql);
      expect(refusedDemand.snapshot().dependencies).toHaveLength(1);
      demandAllowed = true;
      expect(yield* Effect.result(refusedPrepared.working.readTransactionTime(refusedPrepared.lifetime.context, refusedPrepared.id)))
        .toMatchObject({ _tag: "Failure", failure: { message: "rollbackOnly" } });
      refusedDemand.close();
      const clockRoot = makeLogicalDocumentRootEvaluator(pins, { identities: 8, workingBytes: 1_048_576 });
      expect(seedRoot(clockRoot, seed)).toBe(true);
      const clockPrepared = yield* openPrepared(clockRoot, mechanics.small);
      // Clock SQL authenticates fresh pins without consuming any staged row.
      const beforeClockReads = checkedReads;
      const invocationTime = yield* clockPrepared.working.readTransactionTime(clockPrepared.lifetime.context, clockPrepared.id);
      expect(invocationTime).toEqual(expect.any(String));
      expect(checkedReads - beforeClockReads).toBe(1);
      expect(yield* clockPrepared.working.readTransactionTime(clockPrepared.lifetime.context, clockPrepared.id)).toBe(invocationTime);
      expect(checkedReads - beforeClockReads).toBe(1);
      expect(demands.at(-1)).toEqual({ kind: "clock" });
      expect(rootSnapshotRevisions).toBe(refusedSql);
      expect(clockRoot.snapshot().dependencies).toHaveLength(1);
      clockRoot.close();
      yield* retained.close;
      expect(yield* Effect.result(combineLogicalWriteMechanics([mechanics.small, mechanics.extra], failure)))
        .toMatchObject({ _tag: "Failure", failure: { message: "closed" } });
      const deniedRoot = makeLogicalDocumentRootEvaluator(pins, { identities: 8, workingBytes: 1_048_576 });
      const denied = yield* open(secondTable, "labels", deniedRoot);
      expect((yield* Effect.result(denied.working.documents.get(denied.lifetime.context,
        denied.id, firstId)))._tag).toBe("Failure");
      expect(deniedRoot.snapshot().dependencies).toHaveLength(0);
      deniedRoot.close();
    })));
}
