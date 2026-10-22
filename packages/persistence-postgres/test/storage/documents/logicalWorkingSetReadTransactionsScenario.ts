import type {
  FiniteStorageCaptureOperation,
  FiniteStorageCaptureEnvelopes,
} from "../../../src/execution/finiteStorageCapture";
import { fxSystemScopeExecutionAuthorities } from "../../../src/database/schema";
import { and, eq, sql } from "drizzle-orm";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Result } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { expect, vi } from "vitest";
import { canonicalizeAppDocumentV1, AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { isJsonObject } from "flarex-protocol/json";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1FromBytesResult, appRowIdHexV1ToBytes, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import {
  decodeCatalogTableId,
  decodeCatalogIndexDefinitionId,
  decodeCatalogIndexId,
} from "flarex-protocol/catalog";
import {
  decodeCatalogSchemaVersionId,
  decodeSchemaManifestAppDeveloperOrderedIndexSpecV1,
} from "flarex-protocol/schema-manifest";
import { lowerAppDeveloperOrderedIndexPhysicalSpecV1 } from "flarex-protocol/ordered-index";
import { canonicalizeAppIndexPhysicalSpecV1, canonicalAppIndexPhysicalSpecBytesHexV1ToBytes,
  appIndexPhysicalSpecSha256HexV1ToBytes } from "flarex-protocol/index-definition";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction, appendPreparedAppRowRevisionsInTransactionEffect, prepareAppRowsSnapshotReadResult,
  captureAppRowsAtSnapshotInTransactionEffect, readAppRowAtSnapshotInTransactionEffect,
  type AppRowReadResultV1, type ReadAppRowError } from "../../../src/storage/documents/appRows";
import { makeBoundedRequestLifetime } from "../../../src/execution/preparation/boundedRequestLifetime";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import {
  makeLogicalDocumentWorkingSet,
  prepareLogicalWriteMechanics,
  combineLogicalWriteMechanics,
} from "../../../src/storage/documents/logicalDocuments/workingSet";
import type {
  LogicalStorageReadDemand,
  LogicalDocumentWorkingSetInput,
  PreparedLogicalDocumentWriteMechanics,
} from "../../../src/storage/documents/logicalDocuments/model";
import {
  makePreparedHostRuntime,
  retainPreparedHost,
} from "../../../src/execution/preparation/preparedHostRuntime";
import {
  makeLogicalDocumentRootEvaluator,
  requireLogicalDocumentRootEvaluatorOpen,
} from "../../../src/storage/documents/logicalDocuments/rootEvaluator";
import type {
  SessionJournalAttempt,
} from "../../../src/execution/journal/api";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { getScopeClock, lockScopeClockForOrdinaryWriteInTransactionEffect,
  closeExactAttemptScopeClockObservation, openExactAttemptScopeClockObservation,
  readProtectedScopeTransactionTimestamp, hasProtectedScopeTransactionTimestampIssuer } from "../../../src/scope/scopeClock";
import { TransactionAuthorizationRevocationEpochSchema } from "flarex-protocol/transaction-session";
import { databaseTimestampFromUnknown } from "../../../src/database/databaseTimestamp";
import { insertCurrentScopeClockFixture } from "../../scope/scopeClockFixture";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../../../src/scope/scopeClock";
import {
  fxSystemScopeClocks,
  deployments,
  fxControlTables,
  fxControlScopes,
  fxControlIndexes,
  fxControlIndexDefinitions,
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxAppIndexEntryRevisions,
} from "../../../src/database/schema";
import {
  locateAppIndexDefinitionByIdEffect,
  type LocatedAppIndexDefinitionV1,
} from "../../../src/storage/indexes/appIndexDefinitions";
import { lowerAppDeveloperIndexKeyV1 } from "../../../src/storage/indexes/appDeveloperIndexCommitV1";
import { appendAppIndexEntryRevisionsInTransactionEffect, prepareAppIndexSnapshotReadResult,
  buildAppIndexSnapshotReadStatement } from "../../../src/storage/indexes/appIndexEntries";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { rowsFromDriverExecuteResult } from "../../../src/database/driverExecuteResult";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import {
  lockInstallationForCurrentTransaction,
  closeInstallationAdmission,
} from "../../../src/installation/installationLifecycle";
import { runEffect } from "../../support/effectTestRuntime";
import { capturePrivateJsonData } from "../../../src/values/privateJsonData";
import { prepareLogicalCanonicalDocumentSemantics, lowerLogicalCanonicalIndexKey,
  detachLogicalCanonicalDocument, forgetLogicalCanonicalDerivedKeys, logicalUniqueKeyRetentionBytes } from "../../../src/storage/documents/logicalDocuments/relationalRows";
import { APP_UNIQUE_KEY_CODEC_IDENTITY_V1, APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1 } from "flarex-protocol/app-unique-constraint-definition";
import { CatalogSchemaVersionSchema, SchemaManifestAppIndexDescriptorSchema } from "flarex-protocol/schema-manifest";
import { canonicalizeFlarexValueV1Effect, decodeFlarexValueSha256V1 } from "flarex-protocol/value";
import { prepareSchemaManifestAppSchemaBindingsV1Effect,
  applySchemaManifestAppSchemaBindingsV1InTransactionEffect } from "../../../src/storage/catalog/schemaManifestAppSchemaBindings";
import { prepareSchemaVersionArtifactEffect, ensureSchemaVersionArtifactInTransactionEffect } from "../../../src/storage/catalog/schemaVersionArtifacts";
import { prepareAppUniqueConstraintDefinitionBindingV1Effect,
  ensureAppUniqueConstraintDefinitionBindingV1InTransaction,
  locateAppUniqueConstraintDefinitionByIdEffect } from "../../../src/storage/unique/appUniqueConstraintDefinitions";
import { lowerCanonicalAppUniqueConstraintV1Result } from "../../../src/storage/unique/appUniqueConstraintCommitV1";
import { applyAppUniqueKeyMutationsInTransactionEffect,
  readAppUniqueKeySlotInTransactionEffect } from "../../../src/storage/unique/appUniqueKeys";

/** A neutral two-table working-set witness shared by PGlite and ordinary PG. */
export async function logicalWorkingSetReadTransactionsScenario(db: FlarexMetadataDatabase): Promise<void> {
    const withInstallation = <A, E, R>(tx: FlarexMetadataTransaction, work: Effect.Effect<A, E, R>) =>
      lockInstallationForCurrentTransaction(tx).pipe(Effect.andThen(work),
        Effect.ensuring(Effect.sync(() => closeInstallationAdmission(tx))));
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
      db.transaction(async tx => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try { return await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, input); }
        finally { closeInstallationAdmission(tx); }
      });
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
    await db.transaction(tx => runEffect(withInstallation(tx, appendAppIndexEntryRevisionsInTransactionEffect(tx, [{ kind: "live", scopeId,
      definition: labelIndex, encodedKey: labelKey, rowId: firstRow, writeEpoch: epoch, commitSeq: CommitSeqSchema.make(1n) }]))));
    const clock = await getScopeClock(db, scopeId);
    if (clock === null) throw new Error("Missing neutral working-set scope");
    const failure = (reason: string, cause?: unknown) => new Error(reason, { cause });
    const attempt = {} as SessionJournalAttempt;
    const snapshotCommitSeq = CommitSeqSchema.make(3n);
    // The return allowance is checked after tentative mutation. A validator
    // failure at the earlier callback must leave no attempt; a later return
    // refusal must retain the attempt and original Cause until owner cleanup.
    await db.transaction(tx => runEffect(Effect.scoped(Effect.gen(function* () {
      for (const at of ["validator", "return"] as const) {
        const writePins = { attempt, scopeId, snapshotCommitSeq, attemptFence: `write-order-${at}` };
        const writeRoot = yield* Effect.acquireRelease(Effect.sync(() => makeLogicalDocumentRootEvaluator(writePins,
          { identities: 8, workingBytes: 262_144 })), evaluator => Effect.sync(() => evaluator.close()));
        const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
          { calls: 16, commandBytes: 262_144, commandMs: 60_000 }, attempt, {}, `write-order-${at}`, "write"), resource => resource.close);
        let returnBytes = 0;
        let validations = 0;
        const validatorFailure = failure("validatorFirst");
        const working = yield* makeLogicalDocumentWorkingSet({ scopeId, clock, lifetime, tx,
          snapshotCommitSeq, rootEvaluator: writeRoot, rootAttempt: attempt, rootAttemptFence: writePins.attemptFence,
          tables: [{ tableId: firstTable, logicalName: "notes" }], readReadiness: { kind: "full" },
          requireAdmission: requireLogicalDocumentRootEvaluatorOpen(writeRoot, writePins, () => failure("closed")),
          validateDocument: ({ document }) => Effect.gen(function* () {
            validations++;
            if (at === "validator") return yield* Effect.fail(validatorFailure);
            returnBytes = yield* Effect.fromResult(capturePrivateJsonData(document.value, 65_536, failure).pipe(Result.map(value => value.bytes)));
            // Retaining the attempt also records its identity's first row use.
            yield* Effect.fromResult(lifetime.charge(lifetime.remainingBytes() - document.canonicalBytes.byteLength - 128 - 32 - returnBytes + 1));
          }), error: failure, uniqueConflict: () => failure("uniqueConflict"),
          limits: { pageRows: 8, identities: 8, documentBytes: 65_536 },
        }, firstTime, [], []);
        const id = yield* lifetime.begin(lifetime.context);
        const written = yield* Effect.exit(working.documents.insert(lifetime.context, id, "notes", { label: "pending-return" }));
        if (Exit.isSuccess(written)) throw failure("Expected ordered write refusal");
        expect(written.cause.reasons).toHaveLength(1);
        const [writeReason] = written.cause.reasons;
        if (writeReason === undefined || !Cause.isFailReason(writeReason)) throw failure("Expected one typed write refusal");
        expect(writeReason.error.message).toBe(at === "validator" ? "validatorFirst" : "limitExceeded");
        if (at === "validator") expect(writeReason.error).toBe(validatorFailure);
        else expect(lifetime.remainingBytes()).toBe(returnBytes - 1);
        expect(working.attemptCount()).toBe(at === "validator" ? 0 : 1);
        const refusedActivity = yield* Effect.result(working.activitySnapshot());
        if (Result.isSuccess(refusedActivity)) throw failure("Expected rollback-only activity refusal");
        expect(refusedActivity.failure.message).toBe("rollbackOnly");
        expect(refusedActivity.failure.cause).toEqual(written.cause);
        // The trusted root can inspect retained tentative state after refusal;
        // the request's activity reader must keep rejecting that same lifetime.
        const activity = writeRoot.snapshot();
        expect(activity.attempts).toHaveLength(at === "validator" ? 0 : 1);
        expect(activity.observedRows).toHaveLength(at === "validator" ? 0 : 1);
        if (at === "return") expect(activity.observedRows[0]?.value).toMatchObject({ label: "pending-return" });
        const later = yield* Effect.result(working.documents.insert(lifetime.context, id, "notes", { label: "unreached" }));
        if (Result.isSuccess(later)) throw failure("Expected rollback-only refusal");
        expect(later.failure.message).toBe("rollbackOnly");
        expect(later.failure.cause).toEqual(written.cause);
        expect(validations).toBe(1);
      }
    }))));
    const keyDocument = await canonicalizeAppDocumentV1({ tableId: firstTable, rowId: firstRow,
      creationTime: firstTime, fields: { label: "owned-key-cache" } });
    const keySemantics = prepareLogicalCanonicalDocumentSemantics(() => Result.succeed(true), () => failure("storedCorruption"));
    Result.getOrThrow(keySemantics.validate(keyDocument));
    const retentionFailure = failure("limitExceeded");
    let mayRetain = false;
    const retainedKeyCharges: number[] = [];
    const retainedKeyDocuments = new Set<typeof keyDocument>();
    const keyOwner = { identity: retainedKeyDocuments, error: failure, retain: (document: typeof keyDocument, bytes: number) => {
      retainedKeyCharges.push(bytes);
      if (!mayRetain) return Result.fail(retentionFailure);
      retainedKeyDocuments.add(document);
      return Result.succeed(undefined);
    } };
    const refusedRetention = lowerLogicalCanonicalIndexKey(labelIndex, keyDocument, firstTime, keyOwner, "storedCorruption");
    if (Result.isSuccess(refusedRetention)) throw new Error("Missing retained-key budget refusal");
    expect(refusedRetention.failure).toBe(retentionFailure);
    mayRetain = true;
    const retainedKey = Result.getOrThrow(lowerLogicalCanonicalIndexKey(labelIndex, keyDocument, firstTime, keyOwner, "storedCorruption"));
    expect(retainedKeyCharges).toHaveLength(2); // A refused retention never installs a cache entry.
    expect(retainedKeyCharges[1]).toBe(128 + 2 * (retainedKey?.length ?? 0));
    expect(Result.getOrThrow(lowerLogicalCanonicalIndexKey(labelIndex, keyDocument, firstTime, keyOwner, "storedCorruption"))).toBe(retainedKey);
    expect(retainedKeyCharges).toHaveLength(2);
    forgetLogicalCanonicalDerivedKeys(keyDocument, keyOwner.identity);
    Result.getOrThrow(lowerLogicalCanonicalIndexKey(labelIndex, keyDocument, firstTime, keyOwner, "storedCorruption"));
    expect(retainedKeyCharges).toHaveLength(3);
    const detachedKeyDocument = detachLogicalCanonicalDocument(keyDocument);
    expect(Result.getOrThrow(lowerLogicalCanonicalIndexKey(labelIndex, detachedKeyDocument, firstTime, keyOwner, "storedCorruption"))).toBe(retainedKey);
    // Canonical interpretation transfers, but the new revision must establish
    // its own bounded derived-key retention even with the same local owner.
    expect(retainedKeyCharges).toHaveLength(4);
    expect(Result.getOrThrow(lowerLogicalCanonicalIndexKey(labelIndex, detachedKeyDocument, firstTime, keyOwner, "storedCorruption"))).toBe(retainedKey);
    expect(retainedKeyCharges).toHaveLength(4);
    keyDocument.sha256.fill(0);
    expect(lowerLogicalCanonicalIndexKey(labelIndex, keyDocument, firstTime, keyOwner, "storedCorruption"))
      .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    expect(lowerLogicalCanonicalIndexKey(labelIndex, keyDocument, firstTime, keyOwner, "documentInvalid"))
      .toMatchObject({ _tag: "Failure", failure: { message: "documentInvalid" } });
    expect(retainedKeyCharges).toHaveLength(4);
    forgetLogicalCanonicalDerivedKeys(keyDocument, keyOwner.identity);
    forgetLogicalCanonicalDerivedKeys(detachedKeyDocument, keyOwner.identity);
    let checkedReads = 0;
    let admissionTransactions = 0;
    let allowed = true;
    let active = false;
    const requireAdmission = Effect.suspend(() => {
      if (active) return Effect.fail(failure("nestedAdmission"));
      admissionTransactions++;
      return runEffectTransaction<void, Error, Error, FlarexMetadataTransaction>(
        callback => db.transaction(callback), "Neutral source admission", tx => withInstallation(tx,
        Effect.acquireUseRelease(Effect.sync(() => { active = true; }), () =>
          lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId).pipe(
            Effect.mapError(cause => failure("statementFailure", cause)),
            Effect.flatMap(() => allowed ? Effect.void : Effect.fail(failure("sourceMismatch")))),
        () => Effect.sync(() => { active = false; }))),
      cause => failure("statementFailure", cause));
    });
    const readTransaction = <A, E>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
      Effect.suspend(() => {
        checkedReads++;
        return runEffectTransaction<A, E | Error, Error, FlarexMetadataTransaction>(
          callback => db.transaction(callback), "Neutral checked read", tx => withInstallation(tx, Effect.gen(function* () {
            yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId)
              .pipe(Effect.mapError(cause => failure("statementFailure", cause)));
            return yield* Effect.acquireUseRelease(Effect.sync(() => { active = true; }), () => Effect.gen(function* () {
              if (!allowed) return yield* Effect.fail(failure("sourceMismatch"));
              return yield* work(tx);
            }),
              () => Effect.sync(() => { active = false; }));
          })), cause => failure("statementFailure", cause));
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
          { tableId: firstTable, rowId: firstRow, evidence: { kind: "present", revisionCommitSeq: CommitSeqSchema.make(1n) },
            overlay: { kind: "live", creationTime: firstTime, document: pending } },
          { tableId: secondTable, rowId: secondRow, evidence: { kind: "missing",
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
    const pins = { attempt, scopeId, snapshotCommitSeq, attemptFence: "working-set-root-1" };
    const root = makeLogicalDocumentRootEvaluator(pins, { identities: 8, workingBytes: 1_048_576 });
    const originalRevision = await runEffect(runEffectTransaction<AppRowReadResultV1, ReadAppRowError | Error, Error, FlarexMetadataTransaction>(
      callback => db.transaction(callback), "Original finite fixture revision", tx =>
        withInstallation(tx, readAppRowAtSnapshotInTransactionEffect(tx, { scopeId, tableId: firstTable, rowId: firstRow,
          snapshotCommitSeq: CommitSeqSchema.make(1n) })), cause => failure("originalRevision", cause)));
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
      let fullAdmissionOpen = true, fullAdmissionChecks = 0;
      const openFull = (selected: PreparedLogicalDocumentWriteMechanics,
        overrides: Partial<Pick<LogicalDocumentWorkingSetInput<Error>, "tables" | "relationalCapabilities" |
          "searchDefinitions" | "readTransaction">> = {}, indexes = selected.indexes, unique = selected.unique) => Effect.gen(function* () {
        const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
          { calls: 16, commandBytes: 262_144, commandMs: 60_000 }, attempt, {}, "full-prepared-mechanics", "write"),
        resource => resource.close);
        const working = yield* makeLogicalDocumentWorkingSet({ scopeId, clock, lifetime, readTransaction,
          writeMechanics: selected, readReadiness: { kind: "full" },
          tables: selected === forgedMechanics ? mechanics.small.tables : selected.tables,
          ...(selected === forgedMechanics || selected.relationalCapabilities === undefined ? {} : {
            relationalCapabilities: selected.relationalCapabilities }),
          searchDefinitions: selected === forgedMechanics ? mechanics.small.searchDefinitions : selected.searchDefinitions,
          requireAdmission: Effect.suspend(() => {
            fullAdmissionChecks++;
            return fullAdmissionOpen ? Effect.void : Effect.fail(failure("bindingChanged"));
          }), validateDocument: () => Effect.void, error: failure, uniqueConflict: () => failure("uniqueConflict"),
          limits: { pageRows: 8, identities: 8, documentBytes: 65_536 }, ...overrides,
        }, firstTime, unique, indexes);
        const id = yield* lifetime.begin(lifetime.context);
        return { working, lifetime, id };
      });
      // Request-owned full mechanics are authentic without granting finite capture.
      const full = yield* openFull(unleasedMechanics);
      const checksAtConstruction = fullAdmissionChecks;
      const fullInserted = yield* full.working.documents.insert(full.lifetime.context, full.id, "notes", { label: "full-pending" });
      expect(fullAdmissionChecks).toBeGreaterThan(checksAtConstruction);
      expect(fullInserted).toMatchObject({ label: "full-pending" });
      // Full mutation-input validation precedes the first row's storage work.
      // A later invalid row or duplicate key wins over a valid row's read refusal.
      const readRefusal = failure("mutation-read-refusal");
      let mutationStorageEntries = 0;
      const openValidation = () => openFull(mechanics.paged, { readTransaction: () => Effect.suspend(() => {
        mutationStorageEntries++;
        return Effect.fail(readRefusal);
      }) });
      const validMutation = { label: "validation-order" };
      for (const [input, reason] of [
        [[validMutation, { ...validMutation, foreign: "invalid" }], "documentInvalid"],
        [[validMutation, validMutation], "invalidInput"],
      ] as const) {
        const validation = yield* openValidation();
        expect(yield* Effect.result(validation.working.relationalChange(validation.lifetime.context, validation.id,
          "notes", "insert", input))).toMatchObject({ _tag: "Failure", failure: { message: reason } });
        expect(mutationStorageEntries).toBe(0);
      }
      const validation = yield* openValidation();
      expect(yield* Effect.result(validation.working.relationalChange(validation.lifetime.context, validation.id,
        "notes", "insert", [validMutation]))).toMatchObject({ _tag: "Failure", failure: readRefusal });
      expect(mutationStorageEntries).toBe(1);
      const leasedFull = yield* openFull(mechanics.small);
      const leasedInserted = yield* leasedFull.working.documents.insert(leasedFull.lifetime.context,
        leasedFull.id, "notes", { label: "leased-pending" });
      if (typeof leasedInserted._id !== "string") throw new Error("Missing retained full prepared identity");
      expect(yield* leasedFull.working.documents.get(leasedFull.lifetime.context, leasedFull.id, leasedInserted._id))
        .toMatchObject({ label: "leased-pending" });
      if (typeof fullInserted._id !== "string") throw new Error("Missing full prepared identity");
      fullAdmissionOpen = false;
      let refusedInputReads = 0;
      const refusedInput = new Proxy({}, { ownKeys() { refusedInputReads++; return []; } });
      expect(yield* Effect.result(full.working.documents.patch(full.lifetime.context, full.id,
        fullInserted._id, refusedInput, "notes"))).toMatchObject({ _tag: "Failure", failure: { message: "bindingChanged" } });
      expect(refusedInputReads).toBe(0);
      fullAdmissionOpen = true;
      expect(yield* Effect.result(openFull(forgedMechanics, {}, mechanics.small.indexes, mechanics.small.unique)))
        .toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
      expect(foreignMechanicsReads).toBe(0);
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
      for (const overrides of [{ tables: foreignArray(mechanics.small.tables) },
        { relationalCapabilities: foreignArray([]) }, { searchDefinitions: foreignArray(mechanics.small.searchDefinitions) }])
        expect(yield* Effect.result(openFull(mechanics.small, overrides)))
          .toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
      expect(yield* Effect.result(openFull(mechanics.small, {}, foreignArray(mechanics.small.indexes))))
        .toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
      expect(yield* Effect.result(openFull(mechanics.small, {}, mechanics.small.indexes, foreignArray(mechanics.small.unique))))
        .toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
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
              const prepared = yield* Effect.fromResult(prepareAppRowsSnapshotReadResult(named.input)
                .pipe(Result.mapError(cause => failure("statementFailure", cause))));
              const rawRows = yield* captureAppRowsAtSnapshotInTransactionEffect(tx, prepared,
                named.maximumTotalValueBytes, query => {
                  expect(active).toBe(true);
                  if (query.name === "snapshotRevision") rootSnapshotRevisions++;
                }).pipe(Effect.mapError(cause => failure("statementFailure", cause)));
              return { kind: "rows" as const, prepared, rawRows };
            }
            if (named.kind === "indexPage") {
              const prepared = yield* Effect.fromResult(prepareAppIndexSnapshotReadResult(named.input)
                .pipe(Result.mapError(cause => failure("statementFailure", cause))));
              const captured = yield* runDrizzleStatementEffect(tx.execute(buildAppIndexSnapshotReadStatement(prepared)),
                cause => failure("statementFailure", cause));
              const rawRows = rowsFromDriverExecuteResult(captured, () => { throw failure("storedCorruption"); });
              return { kind: "indexPage" as const, prepared, rawRows };
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
      const returnedPage = yield* paged.working.relationalPage(paged.lifetime.context, paged.id, "notes", pageQuery);
      const returnedRow = returnedPage.rows[0];
      if (returnedRow === undefined) throw new Error("Missing captured projected page row");
      expect(Object.isFrozen(returnedRow)).toBe(true);
      expect(Reflect.set(returnedRow, "label", "escaped")).toBe(false);
      expect(pageRoot.snapshot().observedRows[0]?.value).toMatchObject({ label: "original" });
      const selectedRows = yield* paged.working.relationalFind(paged.lifetime.context, paged.id, "notes", pageQuery);
      expect(selectedRows.docs).toEqual([{ label: "original" }]);
      expect(Object.isFrozen(selectedRows.docs[0])).toBe(true);
      const programStore = yield* paged.working.relationalTable(paged.lifetime.context, paged.id, "notes");
      const suppliedQuery = { fields: ["label"], order: { column: "label", direction: "asc" },
        predicate: { kind: "in", column: "label", values: ["original"] } };
      let programInputReads = 0;
      const programInput = new Proxy(suppliedQuery, { ownKeys(target) { programInputReads++; return Reflect.ownKeys(target); } });
      const sourceProgram = programStore.prepareRead(programInput);
      const programCalls = paged.lifetime.usedCalls();
      expect(programInputReads).toBe(0); // Construction has no capture, call, or authority work.
      expect(yield* sourceProgram.find(paged.lifetime.context)).toEqual([{ label: "original" }]);
      expect(programInputReads).toBeGreaterThan(0);
      const capturedInputReads = programInputReads;
      suppliedQuery.predicate.values[0] = "changed-caller-input";
      const bytesBeforeCount = paged.lifetime.remainingBytes();
      expect(yield* sourceProgram.count(paged.lifetime.context)).toBe(1);
      expect(programInputReads).toBe(capturedInputReads);
      expect(bytesBeforeCount - paged.lifetime.remainingBytes()).toBeGreaterThanOrEqual(
        Result.getOrThrow(capturePrivateJsonData({ ...suppliedQuery,
          predicate: { ...suppliedQuery.predicate, values: ["original"] } }, 1_048_576, failure)).bytes);
      expect(paged.lifetime.usedCalls() - programCalls).toBe(2);
      // Preparation retains interpretation, not results or the pending overlay.
      // This is an inserted overlay over original absence. The fixture seed
      // helper treats missing+deleted as no work; use the genuine write owner.
      yield* paged.working.documents.delete(paged.lifetime.context, paged.id, absentId, "notes");
      expect(yield* sourceProgram.count(paged.lifetime.context)).toBe(0);
      pageRoot.close();
      expect(yield* Effect.result(sourceProgram.find(paged.lifetime.context)))
        .toMatchObject({ _tag: "Failure", failure: { message: "closed" } });
      expect(programInputReads).toBe(capturedInputReads);
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
      expect(yield* Effect.result(openFull(mechanics.small)))
        .toMatchObject({ _tag: "Failure", failure: { message: "closed" } });
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

/** Full Commerce/Application working sets share the original native writer
 * transaction's time. Unissued ordinary and finite profiles remain distinct. */
export async function logicalWorkingSetNativeWriteTimeScenario(db: FlarexMetadataDatabase): Promise<void> {
  const scopeId = ScopeIdSchema.make("scope_53000000-0000-0000-0000-000000000009");
  await insertCurrentScopeClockFixture(db, { scopeId, epoch: "epoch_53000000-0000-0000-0000-00000000000a" });
  const failure = (reason: string, cause?: unknown) => new Error(reason, { cause });
  const open = (tx: FlarexMetadataTransaction, clock: NonNullable<Awaited<ReturnType<typeof getScopeClock>>>) => Effect.gen(function* () {
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
      { calls: 16, commandBytes: 262_144, commandMs: 60_000 }, {}, {}, "native-full-write-time", "write"), resource => resource.close);
    const working = yield* makeLogicalDocumentWorkingSet({ scopeId, clock, lifetime, tx,
      tables: [], readReadiness: { kind: "full" }, requireAdmission: Effect.void,
      validateDocument: () => Effect.void,
      error: failure, uniqueConflict: () => failure("uniqueConflict"),
      limits: { pageRows: 8, identities: 8, documentBytes: 65_536 },
    }, AppCreationTimeV1Schema.make(1), [], []);
    const id = yield* lifetime.begin(lifetime.context);
    return { working, read: working.readTransactionTime(lifetime.context, id) };
  });
  await db.transaction(async tx => {
    const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId));
    const rawTime = Result.getOrThrow(readProtectedScopeTransactionTimestamp(tx, scopeId));
    const expected = databaseTimestampFromUnknown(rawTime)?.toISOString();
    expect(expected).toEqual(expect.any(String));
    expect(hasProtectedScopeTransactionTimestampIssuer(tx)).toBe(true);
    const prepare = vi.spyOn(tx._.session, "prepareQuery");
    try {
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const cachedThenClosed = yield* open(tx, clock);
        expect(yield* cachedThenClosed.read).toBe(expected);
        const cachedThenReopened = yield* open(tx, clock);
        expect(yield* cachedThenReopened.read).toBe(expected);
        const third = yield* open(tx, clock);
        expect(yield* third.read).toBe(expected);
        expect(prepare).not.toHaveBeenCalled();
        const expired = yield* open(tx, clock);
        closeExactAttemptScopeClockObservation(tx);
        expect(hasProtectedScopeTransactionTimestampIssuer(tx)).toBe(true);
        expect(yield* Effect.result(cachedThenClosed.read)).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
        expect(yield* Effect.result(expired.read)).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
        expect(prepare).not.toHaveBeenCalled();
        // Even the same transaction and timestamp cannot revive the old loan.
        openExactAttemptScopeClockObservation(tx, clock, TransactionAuthorizationRevocationEpochSchema.make(0n), "attempt", { timestamp: rawTime });
        expect(yield* Effect.result(cachedThenReopened.read)).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
        expect(prepare).not.toHaveBeenCalled();
        closeExactAttemptScopeClockObservation(tx);
        // A malformed native driver field is refused only when time is used.
        openExactAttemptScopeClockObservation(tx, clock, TransactionAuthorizationRevocationEpochSchema.make(0n), "attempt", { timestamp: "invalid-native-time" });
        const malformed = yield* open(tx, clock);
        expect(yield* Effect.result(malformed.read)).toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
        expect(prepare).not.toHaveBeenCalled();
      })));
    } finally { prepare.mockRestore(); closeExactAttemptScopeClockObservation(tx); }
  });
  await db.transaction(async tx => {
    const clock = await getScopeClock(tx, scopeId);
    if (clock === null) throw new Error("Missing ordinary full scope");
    expect(hasProtectedScopeTransactionTimestampIssuer(tx)).toBe(false);
    const prepare = vi.spyOn(tx._.session, "prepareQuery");
    try {
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const ordinary = yield* open(tx, clock);
        const timestamp = yield* ordinary.read;
        expect(timestamp).toEqual(expect.any(String));
        expect(prepare.mock.calls.filter(args => args[0].sql.includes("current_timestamp"))).toHaveLength(1);
        expect(yield* ordinary.read).toBe(timestamp);
        expect(prepare).toHaveBeenCalledOnce();
      })));
    } finally { prepare.mockRestore(); }
  });
}


/** Real native membership and AppRows transport, including mutable trusted
 * charges during a pending driver response and between accepted packets. */
export async function logicalWorkingSetCurrentIndexBudgetScenario(db: FlarexMetadataDatabase): Promise<void> {
  const scopeId = ScopeIdSchema.make("scope_53000000-0000-0000-0000-00000000000b");
  const epoch = ScopeEpochSchema.make("epoch_53000000-0000-0000-0000-00000000000c");
  const tableId = decodeCatalogTableId(43);
  const schemaVersionId = decodeCatalogSchemaVersionId("schema_current_index_budget");
  const deploymentId = "deployment_current_index_budget";
  const creationTime = AppCreationTimeV1Schema.make(1);
  const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
  const failure = (reason: string, cause?: unknown) => new Error(reason, { cause });
  const withInstallation = <A, E, R>(tx: FlarexMetadataTransaction, work: Effect.Effect<A, E, R>) =>
    lockInstallationForCurrentTransaction(tx).pipe(Effect.andThen(work),
      Effect.ensuring(Effect.sync(() => closeInstallationAdmission(tx))));
  await insertCurrentScopeClockFixture(db, { scopeId, epoch });
  await db.insert(deployments).values({ deploymentId, projectId: "project_current_index_budget" });
  await db.insert(fxControlTables).values({ deploymentId, tableId, namespace: "app", logicalName: "notes" });
  await db.insert(fxControlScopes).values({ scopeId, deploymentId, isolationKind: "shared_database",
    physicalLocator: { kind: "shared_database", databaseKey: "current-index-budget", schemaName: "public" } });
  const logicalIndexId = decodeCatalogIndexId(102), indexDefinitionId = decodeCatalogIndexDefinitionId(102);
  const physicalSpec = lowerAppDeveloperOrderedIndexPhysicalSpecV1(decodeSchemaManifestAppDeveloperOrderedIndexSpecV1({
    kind: "developerOrdered", specVersion: 1, fields: ["label"],
  }));
  const canonical = await canonicalizeAppIndexPhysicalSpecV1(physicalSpec);
  await db.insert(fxControlIndexes).values({ deploymentId, logicalIndexId, tableId, descriptor: "by_label" });
  await db.insert(fxControlIndexDefinitions).values({ deploymentId, indexDefinitionId, accessKind: "developer",
    accessIdentityId: logicalIndexId, logicalIndexId, tableId, physicalSpecCodecVersion: canonical.codecVersion,
    physicalSpecJson: physicalSpec, physicalSpecBytes: canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(canonical.canonicalBytesHex),
    physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(canonical.sha256Hex) });
  const definition = await runEffect(locateAppIndexDefinitionByIdEffect(db, scopeId, indexDefinitionId));
  if (definition === null) throw failure("Missing current budget index");
  const fixtures = await Promise.all(Array.from({ length: 301 }, async (_, ordinal) => {
    const rowId = decodeAppRowIdHexV1((4096 + ordinal).toString(16).padStart(32, "0"));
    const document = await canonicalizeAppDocumentV1({ tableId, rowId, creationTime,
      fields: { label: ordinal === 300 ? "single" : "packet", payload: "x".repeat(1024) } });
    const encodedKey = Result.getOrThrow(lowerAppDeveloperIndexKeyV1(definition, document, creationTime));
    if (encodedKey === null) throw failure("Missing current budget membership");
    return { rowId, document, encodedKey };
  }));
  await db.transaction(tx => runEffect(withInstallation(tx, Effect.gen(function* () {
    yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId);
    yield* appendPreparedAppRowRevisionsInTransactionEffect(tx, fixtures.map(row => ({ kind: "live" as const,
      scopeId, tableId, rowId: row.rowId, writeEpoch: epoch, commitSeq: CommitSeqSchema.make(1n), prevCommitSeq: null,
      schemaVersionId, creationTime, document: row.document })));
    yield* appendAppIndexEntryRevisionsInTransactionEffect(tx, fixtures.map(row => ({ kind: "live" as const,
      scopeId, definition, encodedKey: row.encodedKey, rowId: row.rowId, writeEpoch: epoch, commitSeq: CommitSeqSchema.make(1n) })));
    yield* runDrizzleStatementEffect(tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(1n) })
      .where(eq(fxSystemScopeClocks.scopeId, scopeId)), cause => failure("fixtureStatement", cause));
  }))));
  const absentRowId = decodeAppRowIdHexV1((4095).toString(16).padStart(32, "0"));
  const absentDocument = await canonicalizeAppDocumentV1({ tableId, rowId: absentRowId, creationTime,
    fields: { label: "packet", payload: "x".repeat(1024) } });
  const absentKey = Result.getOrThrow(lowerAppDeveloperIndexKeyV1(definition, absentDocument, creationTime));
  if (absentKey === null) throw failure("Missing later negative-observation membership");
  const cachedAbsent = { rowId: absentRowId, document: absentDocument, encodedKey: absentKey };
  const single = fixtures[300], lastInFirstPacket = fixtures[255], cachedRemoved = fixtures[258];
  if (single === undefined || lastInFirstPacket === undefined || cachedRemoved === undefined)
    throw failure("Missing current budget rows");
  const singleQuery = { where: { label: "single" }, offset: 0, limit: 1 };
  const packetQuery = { where: { label: "packet" }, offset: 0, limit: 1 };
  const packetRows = fixtures.slice(0, 300);
  const membershipBytes = (selected: typeof fixtures) => 128 + selected.reduce((bytes, row) => bytes + 128 + row.encodedKey.length / 2, 0);
  const queryBytes = (query: typeof singleQuery) => Result.getOrThrow(capturePrivateJsonData(query, 1_048_576, failure)).bytes;
  const firstPacketBytes = packetRows.slice(0, 256).reduce((bytes, row) => bytes + row.document.canonicalBytes.byteLength, 0);
  // Each first live observation retains its dependency, row and row-use entry.
  const firstPacketCharges = firstPacketBytes + 256 * (128 + 128 + 32);
  const secondPacketBytes = packetRows.slice(256).reduce((bytes, row) => bytes + row.document.canonicalBytes.byteLength, 0);
  await db.transaction(tx => runEffect(withInstallation(tx, Effect.scoped(Effect.gen(function* () {
    const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId);
    const transported: string[] = [];
    const capturedPackets: number[] = [];
    let omitDemandedRow = false;
    let omittedDemandedRow = false;
    let pendingMembership: Readonly<{ entered: Deferred.Deferred<void>; release: Deferred.Deferred<void> }> | undefined;
    const prepare = tx._.session.prepareQuery.bind(tx._.session);
    const spy = vi.spyOn(tx._.session, "prepareQuery").mockImplementation((...args) => {
      const prepared = prepare(...args);
      const execute = prepared.execute.bind(prepared);
      return new Proxy(prepared, { get(target, key, receiver) {
        if (key !== "execute") return Reflect.get(target, key, receiver);
        return async (...bindings: Parameters<typeof prepared.execute>) => {
          const pending = args[0].sql.includes("fx_app_index_entry_current") ? pendingMembership : undefined;
          if (pending !== undefined) {
            pendingMembership = undefined;
            await runEffect(Deferred.succeed(pending.entered, undefined));
            await runEffect(Deferred.await(pending.release));
          }
          const result = await execute(...bindings);
          const rows: readonly unknown[] = Array.isArray(result) ? result :
            isNonArrayRecord(result) && Array.isArray(result.rows) ? result.rows : [];
          let bodies = 0;
          for (const row of rows) {
            if (!isNonArrayRecord(row) || !isNonArrayRecord(row.revision) || !(row.revision.valueBytes instanceof Uint8Array)) continue;
            const identity = isNonArrayRecord(row.pointer) ? row.pointer.rowId : row.revision.rowId;
            if (!(identity instanceof Uint8Array)) throw failure("Missing native body identity");
            const rowId = Result.getOrThrow(appRowIdHexV1FromBytesResult(identity));
            transported.push(rowId);
            bodies++;
          }
          if (args[0].sql.includes("fx_app_row_current")) {
            capturedPackets.push(bodies);
            if (omitDemandedRow) {
              omitDemandedRow = false;
              for (const row of rows) {
                if (!isNonArrayRecord(row) || !isNonArrayRecord(row.pointer) || !(row.pointer.rowId instanceof Uint8Array)) continue;
                if (Result.getOrThrow(appRowIdHexV1FromBytesResult(row.pointer.rowId)) !== single.rowId) continue;
                // Deliberately corrupt the real native driver envelope. The FK
                // prohibits this absent-pointer state in persisted index rows.
                Object.defineProperties(row, { pointer: { value: null }, revision: { value: null } });
                omittedDemandedRow = true;
              }
            }
          }
          return result;
        };
      } });
    });
    const open = (commandBytes: number, identities = 301, onBatch?: () => Effect.Effect<void, Error>) => Effect.gen(function* () {
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
        { calls: 32, commandBytes, commandMs: 60_000 }, {}, {}, "current-index-budget", "write"), owner => owner.close);
      const working = yield* makeLogicalDocumentWorkingSet({ scopeId, clock, lifetime, tx,
        tables: [{ tableId, logicalName: "notes" }], requireAdmission: Effect.void, readReadiness: { kind: "full" },
        validateDocument: () => Effect.void, error: failure, uniqueConflict: () => failure("uniqueConflict"),
        limits: { pageRows: 8, identities, documentBytes: 2048 },
      }, creationTime, [], [definition], { beforeRead: selection => selection === "batch" && onBatch !== undefined ? onBatch() : Effect.void });
      const id = yield* lifetime.begin(lifetime.context);
      return { lifetime, working, id };
    });
    try {
      // An actual trusted charge can run while the driver Promise is pending.
      const pending = yield* open(8000);
      const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
      pendingMembership = { entered, release };
      const reading = yield* Effect.forkChild(Effect.result(pending.working.documents.find(pending.lifetime.context, pending.id, "notes", singleQuery)));
      yield* Deferred.await(entered);
      const allowedAfterMembership = single.document.canonicalBytes.byteLength - 1;
      yield* Effect.fromResult(pending.lifetime.charge(pending.lifetime.remainingBytes() - membershipBytes([single]) - allowedAfterMembership));
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(reading)).toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
      expect(transported).toEqual([]);
      expect(pending.lifetime.remainingBytes()).toBe(allowedAfterMembership);
      transported.length = 0; capturedPackets.length = 0;

      // The accepting owner may also charge after membership, before body demand.
      let betweenCharge: () => Effect.Effect<void, Error> = () => Effect.void;
      const between = yield* open(8000, 301, () => betweenCharge());
      betweenCharge = () => Effect.fromResult(between.lifetime.charge(between.lifetime.remainingBytes() - allowedAfterMembership));
      expect(yield* Effect.result(between.working.documents.find(between.lifetime.context, between.id, "notes", singleQuery)))
        .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
      expect(transported).toEqual([]);
      transported.length = 0; capturedPackets.length = 0;

      const bounded = yield* open(queryBytes(packetQuery) + membershipBytes(packetRows) + firstPacketCharges + secondPacketBytes - 1);
      expect(yield* Effect.result(bounded.working.documents.find(bounded.lifetime.context, bounded.id, "notes", packetQuery)))
        .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
      expect(transported).toEqual(packetRows.slice(0, 256).map(row => row.rowId));
      expect(capturedPackets).toEqual([256, 0]);
      expect(bounded.lifetime.remainingBytes()).toBe(secondPacketBytes - 1);
      transported.length = 0; capturedPackets.length = 0;

      // A late corrupt row must win over a charge that would fail earlier in
      // this packet. The complete native AppRows decoder runs before hydration.
      const rowCondition = and(eq(fxAppRowRevisions.scopeUuid, scopeUuid), eq(fxAppRowRevisions.tableId, tableId),
        eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(lastInFirstPacket.rowId)));
      yield* runDrizzleStatementEffect(tx.update(fxAppRowRevisions).set({ valueSha256: sql`decode(repeat('00', 32), 'hex')` })
        .where(rowCondition), cause => failure("fixtureStatement", cause));
      const decoderBudget = queryBytes(packetQuery) + membershipBytes(packetRows) + firstPacketBytes + 128;
      const corrupt = yield* open(decoderBudget);
      expect(yield* Effect.result(corrupt.working.documents.find(corrupt.lifetime.context, corrupt.id, "notes", packetQuery)))
        .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
      expect(corrupt.lifetime.remainingBytes()).toBe(firstPacketBytes + 128);
      expect(transported).toEqual(packetRows.slice(0, 256).map(row => row.rowId));
      expect(capturedPackets).toEqual([256]);
      yield* runDrizzleStatementEffect(tx.update(fxAppRowRevisions).set({ valueSha256: lastInFirstPacket.document.sha256 })
        .where(rowCondition), cause => failure("fixtureStatement", cause));
      transported.length = 0; capturedPackets.length = 0;
      const charging = yield* open(decoderBudget);
      expect(yield* Effect.result(charging.working.documents.find(charging.lifetime.context, charging.id, "notes", packetQuery)))
        .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
      expect(charging.lifetime.remainingBytes()).toBeLessThan(firstPacketBytes + 128);
      expect(transported).toEqual(packetRows.slice(0, 256).map(row => row.rowId));
      expect(capturedPackets).toEqual([256]);
      transported.length = 0; capturedPackets.length = 0;

      // Retain a negative observation while its stored pointer becomes visible,
      // and a removed positive observation. Neither may re-enter packet bodies.
      const cached = yield* open(2_097_152);
      const absentId = appDocumentIdV1FromRowIdentity({ tableId, rowId: cachedAbsent.rowId });
      const removedId = appDocumentIdV1FromRowIdentity({ tableId, rowId: cachedRemoved.rowId });
      expect(yield* cached.working.documents.get(cached.lifetime.context, cached.id, absentId, "notes")).toBeNull();
      // The identity genuinely did not exist at the negative read. Its row is
      // now published before its index membership, respecting the native FK.
      yield* appendPreparedAppRowRevisionsInTransactionEffect(tx, [{ kind: "live", scopeId, tableId,
        rowId: cachedAbsent.rowId, writeEpoch: epoch, commitSeq: CommitSeqSchema.make(2n), prevCommitSeq: null,
        schemaVersionId, creationTime, document: cachedAbsent.document }]);
      yield* appendAppIndexEntryRevisionsInTransactionEffect(tx, [{ kind: "live", scopeId, definition,
        encodedKey: cachedAbsent.encodedKey, rowId: cachedAbsent.rowId, writeEpoch: epoch, commitSeq: CommitSeqSchema.make(2n) }]);
      yield* runDrizzleStatementEffect(tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(2n) })
        .where(eq(fxSystemScopeClocks.scopeId, scopeId)), cause => failure("fixtureStatement", cause));
      yield* cached.working.documents.delete(cached.lifetime.context, cached.id, removedId, "notes");
      transported.length = 0; capturedPackets.length = 0;
      expect(yield* Effect.result(cached.working.documents.find(cached.lifetime.context, cached.id, "notes", packetQuery)))
        .toMatchObject({ _tag: "Failure", failure: { message: "writeConflict" } });
      const unseen = packetRows.filter(row => row.rowId !== cachedRemoved.rowId);
      expect(transported).toEqual(unseen.map(row => row.rowId));
      expect(capturedPackets).toEqual([256, 43]);
      transported.length = 0; capturedPackets.length = 0;

      // Authenticate the hidden lookahead before overflow; neither verdict may
      // demand a stored body or ignore corruption in the hidden membership.
      const lookahead = packetRows.at(-1);
      if (lookahead === undefined) return yield* Effect.die(failure("Missing lookahead membership"));
      const hiddenCondition = and(eq(fxAppIndexEntryRevisions.scopeUuid, scopeUuid),
        eq(fxAppIndexEntryRevisions.indexDefinitionId, indexDefinitionId),
        eq(fxAppIndexEntryRevisions.rowId, appRowIdHexV1ToBytes(lookahead.rowId)));
      const [hidden] = yield* runDrizzleStatementEffect(tx.select().from(fxAppIndexEntryRevisions).where(hiddenCondition),
        cause => failure("fixtureStatement", cause));
      if (hidden === undefined) return yield* Effect.die(failure("Missing stored lookahead membership"));
      yield* runDrizzleStatementEffect(tx.update(fxAppIndexEntryRevisions).set({ keySha256: new Uint8Array(32) })
        .where(hiddenCondition), cause => failure("fixtureStatement", cause));
      const badLookahead = yield* open(2_097_152, 300);
      expect(yield* Effect.result(badLookahead.working.documents.find(badLookahead.lifetime.context, badLookahead.id, "notes", packetQuery)))
        .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption", cause: { _tag: "AppIndexEntryStorageCorruptionError" } } });
      expect(transported).toEqual([]);
      expect(capturedPackets).toEqual([]);
      yield* runDrizzleStatementEffect(tx.update(fxAppIndexEntryRevisions).set({ keySha256: hidden.keySha256 })
        .where(hiddenCondition), cause => failure("fixtureStatement", cause));
      const overflow = yield* open(2_097_152, 300);
      expect(yield* Effect.result(overflow.working.documents.find(overflow.lifetime.context, overflow.id, "notes", packetQuery)))
        .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
      expect(transported).toEqual([]);
      expect(capturedPackets).toEqual([]);

      // Missing-row refusal is a native driver-corruption witness, not a
      // forbidden persisted state produced by deleting a referenced pointer.
      transported.length = 0; capturedPackets.length = 0;
      omitDemandedRow = true;
      const missing = yield* open(8000);
      expect(yield* Effect.result(missing.working.documents.find(missing.lifetime.context, missing.id, "notes", singleQuery)))
        .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption", cause: {
          _tag: "AppRowStorageCorruptionError", reason: "current index membership has no stored row",
          identity: { scopeId, tableId, rowId: single.rowId },
        } } });
      expect(omittedDemandedRow).toBe(true);
      expect(transported).toEqual([single.rowId]);
      expect(capturedPackets).toEqual([1]);
    } finally { spy.mockRestore(); }
  })))));
}

/** Unique slot acceptance cannot lend a budget for a later point body. */
export async function logicalWorkingSetCurrentUniqueBudgetScenario(db: FlarexMetadataDatabase): Promise<void> {
  const scopeId = ScopeIdSchema.make("scope_53000000-0000-0000-0000-00000000000d");
  const epoch = ScopeEpochSchema.make("epoch_53000000-0000-0000-0000-00000000000e");
  const schemaVersionId = decodeCatalogSchemaVersionId("schema_current_unique_budget");
  const deploymentId = "deployment_current_unique_budget";
  const creationTime = AppCreationTimeV1Schema.make(1);
  const failure = (reason: string, cause?: unknown) => new Error(reason, { cause });
  const withInstallation = <A, E, R>(tx: FlarexMetadataTransaction, work: Effect.Effect<A, E, R>) =>
    lockInstallationForCurrentTransaction(tx).pipe(Effect.andThen(work),
      Effect.ensuring(Effect.sync(() => closeInstallationAdmission(tx))));
  await insertCurrentScopeClockFixture(db, { scopeId, epoch });
  await db.insert(deployments).values({ deploymentId, projectId: "project_current_unique_budget" });
  const bindings = await runEffect(prepareSchemaManifestAppSchemaBindingsV1Effect(db, { deploymentId,
    tables: [{ logicalName: "notes", definition: { kind: "appDocument", definitionVersion: 1,
      documentType: { type: "object", value: { name: { fieldType: { type: "string" }, optional: false },
        payload: { fieldType: { type: "string" }, optional: false } } } } }], indexes: [] }));
  const manifest = await db.transaction(tx => runEffect(applySchemaManifestAppSchemaBindingsV1InTransactionEffect(tx, bindings)));
  const table = manifest.tableDefinitions.tables[0];
  if (table === undefined) throw failure("Missing unique budget table");
  const tableId = table.tableId;
  const artifact = await runEffect(prepareSchemaVersionArtifactEffect({ deploymentId, schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1), manifest }));
  await db.transaction(tx => runEffect(ensureSchemaVersionArtifactInTransactionEffect(tx, artifact)));
  await db.insert(fxControlScopes).values({ scopeId, deploymentId, isolationKind: "shared_database",
    physicalLocator: { kind: "shared_database", databaseKey: "current-unique-budget", schemaName: "public" } });
  const preparedDefinition = await runEffect(prepareAppUniqueConstraintDefinitionBindingV1Effect(db, {
    deploymentId, schemaVersionId, tableId, descriptor: SchemaManifestAppIndexDescriptorSchema.make("by_name"),
    physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({ kind: "appUniqueConstraint", specVersion: 1,
      orderedFields: ["name"], sparse: true, localePolicy: { kind: "none" },
      keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1, keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1 }) }));
  const ensured = await db.transaction(tx => runEffect(ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, preparedDefinition)));
  const definition = await runEffect(locateAppUniqueConstraintDefinitionByIdEffect(db, deploymentId,
    scopeId, schemaVersionId, ensured.definition.uniqueConstraintDefinitionId));
  if (definition === null) throw failure("Missing unique budget definition");
  const rowId = decodeAppRowIdHexV1("5300000000000000000000000000000f");
  const laterRowId = decodeAppRowIdHexV1("53000000000000000000000000000010");
  const document = await canonicalizeAppDocumentV1({ tableId, rowId, creationTime,
    fields: { name: "owner", payload: "x".repeat(1024) } });
  const laterDocument = await canonicalizeAppDocumentV1({ tableId, rowId: laterRowId, creationTime,
    fields: { name: "later", payload: "x".repeat(1024) } });
  const ownerKey = Result.getOrThrow(lowerCanonicalAppUniqueConstraintV1Result(definition, document));
  const laterKey = Result.getOrThrow(lowerCanonicalAppUniqueConstraintV1Result(definition, laterDocument));
  if (ownerKey.kind !== "claim" || laterKey.kind !== "claim") throw failure("Missing unique budget claims");
  await db.transaction(tx => runEffect(withInstallation(tx, Effect.gen(function* () {
    yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId);
    yield* appendPreparedAppRowRevisionsInTransactionEffect(tx, [{ kind: "live", scopeId, tableId, rowId,
      writeEpoch: epoch, commitSeq: CommitSeqSchema.make(1n), prevCommitSeq: null, schemaVersionId, creationTime, document }]);
    yield* applyAppUniqueKeyMutationsInTransactionEffect(tx, [{ scopeId, tableId, rowId,
      constraintId: definition.uniqueConstraintDefinitionId, writeEpoch: epoch, previous: null, next: ownerKey.projection }]);
    yield* runDrizzleStatementEffect(tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(1n) })
      .where(eq(fxSystemScopeClocks.scopeId, scopeId)), cause => failure("fixtureStatement", cause));
  }))));
  const query = { where: { name: "owner" }, offset: 0, limit: 1 };
  const absentQuery = { where: { name: "absent" }, offset: 0, limit: 1 };
  const laterQuery = { where: { name: "later" }, offset: 0, limit: 1 };
  const queryBytes = (input: typeof query) => Result.getOrThrow(capturePrivateJsonData(input, 1_048_576, failure)).bytes;
  const outputBytes = Result.getOrThrow(capturePrivateJsonData(document.value, 1_048_576, failure)).bytes;
  const absentKey = Result.getOrThrow(lowerCanonicalAppUniqueConstraintV1Result(definition,
    await runEffect(canonicalizeFlarexValueV1Effect(absentQuery.where, "appDocument"))));
  if (absentKey.kind !== "claim") throw failure("Missing absent unique key");
  const allowedAtPoint = document.canonicalBytes.byteLength - 1;
  await db.transaction(tx => runEffect(withInstallation(tx, Effect.scoped(Effect.gen(function* () {
    const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId);
    const transported: string[] = [];
    let uniqueQueries = 0;
    let pendingUnique: Readonly<{ entered: Deferred.Deferred<void>; release: Deferred.Deferred<void> }> | undefined;
    const prepare = tx._.session.prepareQuery.bind(tx._.session);
    const spy = vi.spyOn(tx._.session, "prepareQuery").mockImplementation((...args) => {
      const prepared = prepare(...args), execute = prepared.execute.bind(prepared);
      return new Proxy(prepared, { get(target, key, receiver) {
        if (key !== "execute") return Reflect.get(target, key, receiver);
        return async (...parameters: Parameters<typeof prepared.execute>) => {
          if (args[0].sql.includes("fx_app_unique_key")) {
            uniqueQueries++;
            const pending = pendingUnique;
            if (pending !== undefined) {
              pendingUnique = undefined;
              await runEffect(Deferred.succeed(pending.entered, undefined));
              await runEffect(Deferred.await(pending.release));
            }
          }
          const result = await execute(...parameters);
          const rows: readonly unknown[] = Array.isArray(result) ? result :
            isNonArrayRecord(result) && Array.isArray(result.rows) ? result.rows : [];
          for (const row of rows) {
            if (!isNonArrayRecord(row) || !isNonArrayRecord(row.revision) || !(row.revision.valueBytes instanceof Uint8Array)) continue;
            const identity = isNonArrayRecord(row.pointer) ? row.pointer.rowId : row.revision.rowId;
            if (!(identity instanceof Uint8Array)) throw failure("Missing unique native body identity");
            transported.push(Result.getOrThrow(appRowIdHexV1FromBytesResult(identity)));
          }
          return result;
        };
      } });
    });
    const open = (onPoint?: () => Effect.Effect<void, Error>) => Effect.gen(function* () {
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
        { calls: 32, commandBytes: 8000, commandMs: 60_000 }, {}, {}, "current-unique-budget", "write"), owner => owner.close);
      const working = yield* makeLogicalDocumentWorkingSet({ scopeId, clock, lifetime, tx,
        tables: [{ tableId, logicalName: "notes" }], requireAdmission: Effect.void, readReadiness: { kind: "full" },
        validateDocument: () => Effect.void, error: failure, uniqueConflict: () => failure("uniqueConflict"),
        limits: { pageRows: 8, identities: 8, documentBytes: 2048 } }, creationTime, [definition], [],
      { beforeRead: selection => selection === "point" && onPoint !== undefined ? onPoint() : Effect.void });
      const id = yield* lifetime.begin(lifetime.context);
      return { lifetime, working, id };
    });
    const rowCondition = and(eq(fxAppRowRevisions.scopeUuid, projectScopeIdUuidV1(scopeId).scopeUuid),
      eq(fxAppRowRevisions.tableId, tableId), eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(rowId)));
    try {
      // Charge the genuine lifetime while the unique owner's driver Promise is
      // pending. The subsequent point permission must see this reduced budget.
      const pending = yield* open();
      const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
      pendingUnique = { entered, release };
      const reading = yield* Effect.forkChild(Effect.result(pending.working.documents.find(pending.lifetime.context,
        pending.id, "notes", query)));
      yield* Deferred.await(entered);
      yield* Effect.fromResult(pending.lifetime.charge(pending.lifetime.remainingBytes() - allowedAtPoint));
      yield* Deferred.succeed(release, undefined);
      const pendingOutcome = yield* Fiber.join(reading);
      expect(pendingOutcome).toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
      expect(transported).toEqual([]);
      expect(pendingOutcome).toMatchObject({ _tag: "Failure", failure: { cause: {
        _tag: "InvalidAppRowReadInputError", issue: { reason: "rowLimitExceeded" } } } });
      expect(pending.lifetime.remainingBytes()).toBe(allowedAtPoint);
      transported.length = 0;

      // A real accepting callback charge has the same ordering, including when
      // canonical row corruption would otherwise be discovered first.
      yield* runDrizzleStatementEffect(tx.update(fxAppRowRevisions).set({ valueSha256: decodeFlarexValueSha256V1(new Uint8Array(32)) })
        .where(rowCondition), cause => failure("fixtureStatement", cause));
      let betweenCharge: () => Effect.Effect<void, Error> = () => Effect.void;
      const between = yield* open(() => betweenCharge());
      betweenCharge = () => Effect.fromResult(between.lifetime.charge(between.lifetime.remainingBytes() - allowedAtPoint));
      expect(yield* Effect.result(between.working.documents.find(between.lifetime.context, between.id, "notes", query)))
        .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded", cause: {
          _tag: "InvalidAppRowReadInputError", issue: { reason: "rowLimitExceeded" } } } });
      expect(transported).toEqual([]);
      expect(between.lifetime.remainingBytes()).toBe(allowedAtPoint);
      const corrupt = yield* open();
      const beforeCorrupt = corrupt.lifetime.remainingBytes();
      expect(yield* Effect.result(corrupt.working.documents.find(corrupt.lifetime.context, corrupt.id, "notes", query)))
        .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption", cause: { _tag: "AppRowStorageCorruptionError" } } });
      expect(corrupt.lifetime.remainingBytes()).toBe(beforeCorrupt - queryBytes(query));
      expect(transported).toEqual([rowId]);
      yield* runDrizzleStatementEffect(tx.update(fxAppRowRevisions).set({ valueSha256: document.sha256 })
        .where(rowCondition), cause => failure("fixtureStatement", cause));
      transported.length = 0;

      const fresh = yield* open();
      const beforeFresh = fresh.lifetime.remainingBytes();
      uniqueQueries = 0;
      expect(yield* fresh.working.documents.find(fresh.lifetime.context, fresh.id, "notes", query))
        .toMatchObject({ docs: [document.value], total: 1 });
      // Fresh agreement precedes the first output capture, so no reusable
      // canonical-row verdict exists yet and no derived key is retained.
      expect(fresh.lifetime.remainingBytes()).toBe(beforeFresh - queryBytes(query) - 256 - 32 - document.canonicalBytes.byteLength
        - 128 - ownerKey.canonicalKeyBytes.byteLength - outputBytes);
      expect(uniqueQueries).toBe(1);
      expect(transported).toEqual([rowId]);
      transported.length = 0;

      // A successful slot retains the final unique observation charge even if
      // its owner was already read, or locally removed, by this working set.
      const cached = yield* open();
      const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
      expect(yield* cached.working.documents.get(cached.lifetime.context, cached.id, documentId, "notes")).not.toBeNull();
      transported.length = 0; uniqueQueries = 0;
      const beforeCached = cached.lifetime.remainingBytes();
      expect(yield* cached.working.documents.find(cached.lifetime.context, cached.id, "notes", query))
        .toMatchObject({ docs: [document.value], total: 1 });
      // The preceding get issued the canonical-row verdict. Agreement now
      // retains its derived owner key once, after the original point frontier.
      expect(cached.lifetime.remainingBytes()).toBe(beforeCached - queryBytes(query) - 128 - ownerKey.canonicalKeyBytes.byteLength
        - logicalUniqueKeyRetentionBytes(ownerKey) - outputBytes);
      expect(uniqueQueries).toBe(1);
      expect(transported).toEqual([]);
      yield* cached.working.documents.delete(cached.lifetime.context, cached.id, documentId, "notes");
      uniqueQueries = 0;
      expect(yield* cached.working.documents.find(cached.lifetime.context, cached.id, "notes", query)).toEqual({ docs: [], total: 0 });
      expect(uniqueQueries).toBe(0);
      expect(transported).toEqual([]);
      const removed = yield* open();
      yield* removed.working.documents.delete(removed.lifetime.context, removed.id, documentId, "notes");
      transported.length = 0; uniqueQueries = 0;
      const beforeRemoved = removed.lifetime.remainingBytes();
      expect(yield* removed.working.documents.find(removed.lifetime.context, removed.id, "notes", query)).toEqual({ docs: [], total: 0 });
      // Direct deletion does not capture a returned row or issue a reusable
      // verdict; retain the original slot-observation charge exactly.
      expect(removed.lifetime.remainingBytes()).toBe(beforeRemoved - queryBytes(query) - 128 - ownerKey.canonicalKeyBytes.byteLength);
      expect(uniqueQueries).toBe(1);
      expect(transported).toEqual([]);

      const absent = yield* open();
      const beforeAbsent = absent.lifetime.remainingBytes();
      uniqueQueries = 0;
      expect(yield* absent.working.documents.find(absent.lifetime.context, absent.id, "notes", absentQuery)).toEqual({ docs: [], total: 0 });
      expect(absent.lifetime.remainingBytes()).toBe(beforeAbsent - queryBytes(absentQuery) - 128 - absentKey.canonicalKeyBytes.byteLength);
      expect(uniqueQueries).toBe(1);
      expect(transported).toEqual([]);
      uniqueQueries = 0;
      const omitted = yield* readAppUniqueKeySlotInTransactionEffect(tx, { scopeId,
        constraintId: definition.uniqueConstraintDefinitionId,
        key: { sparse: true, localeKey: null, values: [{ kind: "missing" }] } });
      expect(Option.isNone(omitted)).toBe(true);
      expect(uniqueQueries).toBe(0);
      expect(transported).toEqual([]);

      // An earlier genuine absence stays authoritative even after a row and
      // claim become visible; authenticating its slot must not recapture it.
      const negative = yield* open();
      const laterId = appDocumentIdV1FromRowIdentity({ tableId, rowId: laterRowId });
      expect(yield* negative.working.documents.get(negative.lifetime.context, negative.id, laterId, "notes")).toBeNull();
      yield* appendPreparedAppRowRevisionsInTransactionEffect(tx, [{ kind: "live", scopeId, tableId, rowId: laterRowId,
        writeEpoch: epoch, commitSeq: CommitSeqSchema.make(2n), prevCommitSeq: null, schemaVersionId, creationTime, document: laterDocument }]);
      yield* applyAppUniqueKeyMutationsInTransactionEffect(tx, [{ scopeId, tableId, rowId: laterRowId,
        constraintId: definition.uniqueConstraintDefinitionId, writeEpoch: epoch, previous: null, next: laterKey.projection }]);
      yield* runDrizzleStatementEffect(tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(2n) })
        .where(eq(fxSystemScopeClocks.scopeId, scopeId)), cause => failure("fixtureStatement", cause));
      transported.length = 0; uniqueQueries = 0;
      const beforeNegative = negative.lifetime.remainingBytes();
      expect(yield* Effect.result(negative.working.documents.find(negative.lifetime.context, negative.id, "notes", laterQuery)))
        .toMatchObject({ _tag: "Failure", failure: { message: "writeConflict" } });
      expect(negative.lifetime.remainingBytes()).toBe(beforeNegative - queryBytes(laterQuery));
      expect(uniqueQueries).toBe(1);
      expect(transported).toEqual([]);
    } finally { spy.mockRestore(); }
  })))));
}
