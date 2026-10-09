import { readFrozenFiniteAttempt } from "../../persistence-postgres/src/execution/sessionJournalStore";
import { documentValidationRecoverySource } from "../../executor/test/performance/support/documentValidationRecoverySource";
import { loadPublishedPhysicalRequirementSnapshotV1 } from "../../persistence-postgres/src/storage/indexes/indexBuildReconciliation";
import { readLogicalStorageRequirements } from "../../persistence-postgres/src/storage/catalog/logicalStorageDefinitions";
import { logicalTableKey } from "flarex-protocol/internal/logical-schema-candidate";
import { and, asc, eq, sql } from "drizzle-orm";
import { Effect, Option, Result, Schema } from "effect";
import { locateAppIndexDefinitionByIdEffect } from "../../persistence-postgres/src/storage/indexes/appIndexDefinitions";
import { selectLogicalIndex } from "../../persistence-postgres/src/storage/documents/logicalDocuments/query";
import { describe, expect, it, vi } from "vitest";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { decodeAppDocumentIdentityV1, appRowIdHexV1ToBytes } from
  "flarex-protocol/app-document-id";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { fxAppRowRevisions, fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournals, fxSystemTransactionSessions,
  fxSystemTransactionJournalPoints, fxSystemTransactionJournalWriteEvents,
  fxSystemIndexBuildStates, fxSystemCommits, fxSystemScopeClocks, fxSystemIdempotency } from "../../persistence-postgres/src/database/schema";
import { PointCommitConflictV1Error } from "../../persistence-postgres/src/commit/pointCommitErrors";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { APPLICATION_EXECUTION_METADATA_OWNER } from "../../persistence-postgres/src/execution/finiteMetadataDependencies";
import { MiniflareApplicationAnalysisWorkerLoader, makeStandardApplicationCurrentAnalysisV1 } from "../../system-test/support/standardApplicationCurrentAnalysisHarness";
import { changedMixedMutationExecutableSource } from "./support/mixedMutationApplicationSource";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { commerceError, logicalCommerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { defineCommerceCommand } from
  "@flarex/persistence-postgres/internal/commerce-adapter";
import { executePrivateProductAttemptOperation } from "../../medusa-adapter/src/product-attempt";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

type ProductFixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;

async function committedInventory(fixture: ProductFixture) {
  const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
  const database = fixture.currency.persistence.drizzle;
  return Promise.all([
    database.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid))
      .orderBy(fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
    database.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid))
      .orderBy(fxSystemCommits.commitSeq),
    database.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid))
      .orderBy(fxSystemCommitEvents.commitSeq),
    database.select({ lastCommitSeq: fxSystemScopeClocks.lastCommitSeq }).from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, fixture.activation.anchor.scopeId)),
  ]);
}

async function returnedWorkerValue(raw: unknown) {
  const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
    result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
  return (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
}

async function expectPristineFiniteChildren(fixture: ProductFixture) {
  for (const table of [fxSystemTransactionJournalReceipts, fxSystemTransactionJournalPoints,
    fxSystemTransactionJournalWriteEvents]) {
    expect(await fixture.currency.persistence.drizzle.select().from(table)
      .where(eq(table.sessionId, fixture.activation.anchor.sessionId))).toHaveLength(0);
  }
}

describe.each(drivers)("native Product in one Application mutation attempt on %s", driver => {
  it("plans known Application points locally with exact replay and catchable validation", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `local-application-points-${driver}` });
    try {
      const table = await Effect.runPromise(fixture.bound.resolvePointTable("users"));
      fixture.setSqlPhase("application");
      const point = async (operation: Readonly<Record<string, unknown>> & { readonly syscallSequence: string }) => {
        const result = await Effect.runPromise(fixture.bound.runPointOperation(table,
          { ...operation, syscallSequence: CommitSyscallSequenceV1Schema.make(BigInt(operation.syscallSequence)) }));
        if (result.kind !== "completed") throw new Error(`Point operation ${result.kind}`);
        return result.outcome;
      };
      const inserted = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("inserted"), documentId: Schema.String }))(
        await point({ kind: "insert", syscallSequence: "1", fields: { name: "before" } }));
      const afterInsert = fixture.getTransactionCounts();
      const afterInsertSql = fixture.sqlByPhase.get("application");
      const connections = fixture.currency.resource.kind === "postgres"
        ? [...new Set([fixture.currency.resource.control.pool, fixture.currency.resource.target.pool])]
          .map(pool => vi.spyOn(pool, "connect")) : [];
      try {
        const patch = { kind: "patch", syscallSequence: "2", documentId: inserted.documentId, patch: { name: "patched" } };
        expect(await point(patch)).toMatchObject({ kind: "unit", operation: "patch" });
        expect(await point(patch)).toMatchObject({ kind: "unit", operation: "patch" });
        await expect(point({ ...patch, syscallSequence: "3", patch: { name: 123 } }))
          .rejects.toMatchObject({ _tag: "ApplicationRevisionSyscallDocumentValidationV1Error" });
        expect(await point({ kind: "replace", syscallSequence: "3", documentId: inserted.documentId, fields: { name: "replaced" } }))
          .toMatchObject({ kind: "unit", operation: "replace" });
        expect(await point({ kind: "get", syscallSequence: "4", documentId: inserted.documentId }))
          .toMatchObject({ kind: "present", document: { name: "replaced" } });
        expect(await point({ kind: "delete", syscallSequence: "5", documentId: inserted.documentId }))
          .toMatchObject({ kind: "unit", operation: "delete" });
        expect(await point({ kind: "get", syscallSequence: "6", documentId: inserted.documentId }))
          .toMatchObject({ kind: "missing" });
        if (fixture.hasSqlObserver) {
          expect(fixture.getTransactionCounts()).toEqual(afterInsert);
          expect(fixture.sqlByPhase.get("application")).toBe(afterInsertSql);
        }
        for (const connection of connections) expect(connection).not.toHaveBeenCalled();
      } finally { for (const connection of connections) connection.mockRestore(); }
      const frozen = readFrozenFiniteAttempt(await Effect.runPromise(fixture.freeze({ id: inserted.documentId })));
      expect(frozen?.operations.map(operation => operation.sequence)).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
      await expect(point({ kind: "get", syscallSequence: "7", documentId: inserted.documentId })).rejects.toBeDefined();
    } finally { await fixture.close(); }
  }, 180_000);

  it("recovers a genuine document rejection through the authenticated Worker bridge", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `validation-recovery-${driver}` });
    try {
      const raw = await fixture.runExecution(documentValidationRecoverySource(fixture.seed));
      const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
        result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
      const value = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
      expect(value).toMatchObject({ caughtDocumentValidation: true,
        earlier: { name: "earlier accepted" },
        updated: { id: fixture.seed.productId, title: fixture.seed.newTitle },
        pending: { id: fixture.seed.productId, title: fixture.seed.newTitle } });
      expect(await fixture.publish(value)).toMatchObject({ kind: "published" });
      expect((await fixture.readSettlementLedger())?.syscallReceipts).toBe(8);
      const documents = Schema.decodeUnknownSync(Schema.Struct({
        earlier: Schema.Struct({ _id: Schema.String, _creationTime: Schema.Number }),
        later: Schema.Struct({ _creationTime: Schema.Number }),
      }))(value);
      expect(documents.later._creationTime).toBe(documents.earlier._creationTime +
        2 ** (Math.floor(Math.log2(documents.earlier._creationTime)) - 52));
      const earlier = documents.earlier;
      expect(await fixture.readCurrentApplicationDocument(earlier._id)).toMatchObject({ name: "earlier accepted" });
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      expect(await fixture.readCurrentProduct()).toMatchObject({ id: fixture.seed.productId, title: fixture.seed.newTitle });
    } finally { await fixture.close(); }
  }, 180_000);

  it.each(["closed", "callBudget", "caughtRefusal"] as const)(
    "gates the actual Product adapter capture path before foreign inspection after %s", async refusal => {
      let captures = 0;
      let decodes = 0;
      let nativeEntered = false;
      let checkedRefusal = false;
      const event = new Proxy({}, { ownKeys: () => { captures++; throw new Error("foreign Product data"); } });
      let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
      fixture = await createMixedMutationProductFixture({ driver, suffix: `native-capture-${refusal}-${driver}`,
        hooks: { afterProductBorrow: (method, borrowed, rootEvaluator) => method !== "update" ? Effect.void :
          Effect.gen(function* () {
            if (rootEvaluator === undefined) throw new Error("Missing finite root evaluator");
            const firstFailure = commerceError("unadmittedEvent");
            const command = defineCommerceCommand("productUpdate", "write", context => Effect.gen(function* () {
              nativeEntered = true;
              if (refusal === "closed") rootEvaluator.close();
              else if (refusal === "callBudget") {
                while (borrowed.currentUsage().workCalls < context.resources.calls) yield* context.table("product");
              } else {
                const refused = yield* Effect.result(context.refuse(firstFailure));
                expect(refused).toMatchObject({ _tag: "Failure", failure: firstFailure });
                // The native callback catches a refusal and returns foreign data.
                // The post-callback checkpoint must reject before receipt policy capture.
                return event;
              }
              yield* context.captureLocalEvent(event);
              return null;
            }));
            const binding = Object.freeze({ ...fixture.binding,
              update: () => Result.succeed({ command, args: {} }),
              logicalPolicy: Object.freeze({ ...fixture.binding.logicalPolicy,
                capture: (value: unknown) => Effect.sync(() => { decodes++; }).pipe(
                  Effect.andThen(fixture.binding.logicalPolicy.capture(value))) }),
            });
            const failed = yield* Effect.result(executePrivateProductAttemptOperation(binding,
              borrowed, "update", {}, fixture.eventPolicy));
            expect(failed).toMatchObject({ _tag: "Failure", failure: {
              reason: refusal === "closed" ? "closed" : refusal === "callBudget" ? "limitExceeded" : "rollbackOnly",
            } });
            expect(nativeEntered).toBe(true);
            expect(captures).toBe(0);
            expect(decodes).toBe(0);
            checkedRefusal = true;
          }) } });
      try {
        await expect(fixture.runExecution()).rejects.toBeDefined();
        expect(checkedRefusal).toBe(true);
        expect(captures).toBe(0);
        expect(await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionJournalReceipts)
          .where(eq(fxSystemTransactionJournalReceipts.sessionId, fixture.activation.anchor.sessionId))).toHaveLength(0);
        await expect(Effect.runPromise(fixture.freeze(null))).rejects.toBeDefined();
      } finally { await fixture.close(); }
    }, 180_000);

  it.each(["required", "sameSourceUnused", "unrelated", "applicationUnused"] as const)(
    "checks demanded reads and current publication maintenance after %s readiness changes", async changed => {
      let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
      let readChecked = false;
      let checkingRead = false;
      let dataStatements = 0;
      let readHeadStatements = 0;
      let freezeHeadStatements = 0;
      fixture = await createMixedMutationProductFixture({ driver, suffix: `selected-read-${changed.toLowerCase()}-${driver}`,
        hooks: {
          observeSql: (phase, sql) => {
            if (checkingRead && /\bfx_app_(?:row_rev|index_entry_(?:rev|current)|unique_key)\b/.test(sql)) dataStatements += 1;
            if (/\bfrom\s+"fx_system_(?:data_binding_head|application_active_head)"/i.test(sql)) {
              if (checkingRead) readHeadStatements += 1;
              if (phase === "freeze") freezeHeadStatements += 1;
            }
          },
          afterProductBorrow: (method, borrowed) => method !== "update" ? Effect.void : Effect.gen(function* () {
            const requirements = yield* readLogicalStorageRequirements(fixture.currency.control.drizzle,
              fixture.currency.deploymentId, fixture.logicalSchemaVersionId).pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
            const source = requirements.evidence.candidate.sources.find(source => source.key ===
              (changed === "unrelated" ? "medusa.currency" : "medusa.product"));
            if (source === undefined) throw new Error("Missing native readiness source");
            const tableIds = new Set(source.bindings.filter(binding => binding.kind === "definition")
              .flatMap(binding => requirements.evidence.tableBindings.filter(table =>
                logicalTableKey(table.table) === logicalTableKey(binding.table)).map(table => table.tableId)));
            const snapshot = yield* loadPublishedPhysicalRequirementSnapshotV1(fixture.currency.control.drizzle,
              { deploymentId: fixture.currency.deploymentId, schemaVersionId: changed === "applicationUnused" ?
                fixture.schemaVersionId : fixture.logicalSchemaVersionId }).pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
            const located = yield* Effect.forEach(snapshot?.definitions.filter(definition =>
              changed === "applicationUnused" || tableIds.has(definition.access.tableId)) ?? [],
              definition => locateAppIndexDefinitionByIdEffect(fixture.currency.control.drizzle,
                fixture.activation.anchor.scopeId, definition.indexDefinitionId)).pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
            const productTable = source.bindings.find(binding => binding.localName === "product");
            const productTableId = productTable === undefined ? undefined : requirements.evidence.tableBindings
              .find(table => logicalTableKey(table.table) === logicalTableKey(productTable.table))?.tableId;
            const selected = productTableId === undefined ? Option.none() : yield* Effect.fromResult(selectLogicalIndex(
              located.filter(index => index !== null).filter(index => index.access.kind === "developer"), productTableId,
              { id: fixture.seed.productId }, logicalCommerceError));
            const index = changed === "required" ? Option.isSome(selected) ? selected.value.definition : undefined :
              located.find(index => index !== null &&
                (changed === "applicationUnused" ? index.access.kind === "by_creation_time" : index.access.kind === "developer") &&
                (changed !== "sameSourceUnused" || index.access.tableId === productTableId &&
                  index.physicalSpec.orderedFields[0]?.kind === "documentPath" &&
                  !["id", "handle"].includes(index.physicalSpec.orderedFields[0].path)));
            if (index === undefined || index === null) throw new Error("Missing source readiness index");
            yield* Effect.tryPromise({ try: async () => {
              const updated = await fixture.currency.testOwner.drizzle.update(fxSystemIndexBuildStates)
                .set({ lifecycle: "retiring", maintenanceActivationSequence: null })
                .where(and(eq(fxSystemIndexBuildStates.scopeId, fixture.activation.anchor.scopeId),
                  eq(fxSystemIndexBuildStates.indexDefinitionId, index.indexDefinitionId))).returning();
              expect(updated).toHaveLength(1);
            }, catch: cause => commerceError("resourceFailure", cause) });
            const store = yield* borrowed.context.table("product");
            checkingRead = true;
            const read = yield* Effect.result(store.find(borrowed.context.manager, {
              predicate: { kind: "in", column: "id", values: [fixture.seed.productId] },
              order: { column: "id", direction: "asc" },
            }));
            checkingRead = false;
            if (fixture.hasSqlObserver) expect(readHeadStatements).toBe(0);
            if (changed === "required") {
              expect(read).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
              expect(dataStatements).toBe(0);
            } else {
              expect(read).toMatchObject({ _tag: "Success", success: [{ id: fixture.seed.productId }] });
              if (fixture.hasSqlObserver) expect(dataStatements).toBeGreaterThan(0);
            }
            readChecked = true;
          }),
        } });
      try {
        const before = await committedInventory(fixture);
        if (changed === "required") {
          await expect(fixture.runExecution()).rejects.toBeDefined();
          expect(readChecked, fixture.bridgeFailures.join("\n")).toBe(true);
          await expectPristineFiniteChildren(fixture);
          await expect(Effect.runPromise(fixture.freeze(null)))
            .rejects.toMatchObject({ _tag: "SessionJournalSealV1Error", reason: "journalFailed" });
          expect(await committedInventory(fixture)).toEqual(before);
        } else {
          const value = await returnedWorkerValue(await fixture.runExecution());
          expect(readChecked, fixture.bridgeFailures.join("\n")).toBe(true);
          expect(value).toMatchObject({ updated: { id: fixture.seed.productId, handle: fixture.seed.newHandle },
            pending: { id: fixture.seed.productId, title: fixture.seed.newTitle }, listed: [{ id: fixture.seed.productId }] });
          expect(Object.fromEntries(fixture.nativeInvokeCount)).toMatchObject({ update: 1, retrieve: 1, listByHandle: 1 });
          await expectPristineFiniteChildren(fixture);
          fixture.setSqlPhase("freeze");
          const envelope = await Effect.runPromise(fixture.freeze(value));
          if (fixture.hasSqlObserver) expect(freezeHeadStatements).toBe(0);
          const publication = await fixture.prepareFrozenPublication(envelope);
          if (changed === "unrelated") {
            expect(await Effect.runPromise(publication)).toMatchObject({ kind: "published" });
            expect(await fixture.readCurrentProduct()).toMatchObject({ id: fixture.seed.productId,
              title: fixture.seed.newTitle, handle: fixture.seed.newHandle });
            const events = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
              .where(eq(fxSystemCommitEvents.scopeUuid, projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid));
            expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(1);
            const after = await committedInventory(fixture);
            expect(after[1]).toHaveLength(before[1].length + 1);
            const originalClock = before[3][0];
            if (originalClock === undefined) throw new Error("Missing original commit sequence");
            expect(after[3][0]?.lastCommitSeq).toBe(originalClock.lastCommitSeq + 1n);
          } else {
            await expect(Effect.runPromise(publication)).rejects.toMatchObject({
              _tag: "PointCommitCorruptionV1Error",
              reason: changed === "applicationUnused" ? "intrinsicIndexBuildInvalid" : "developerIndexBuildInvalid",
            });
            expect(await committedInventory(fixture)).toEqual(before);
          }
        }
        expect(fixture.getOpenTransactionDepth()).toBe(0);
      } finally { await fixture.close(); }
    }, 180_000);

  it.each(["consumedExecutable", "readiness"] as const)(
    "retains fixed metadata at freeze and refuses publication after %s changes following the last native read", async changed => {
      let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
      let changedBeforeClose = false;
      let localClosed = false;
      let localTransactionCount = 0;
      let freezeHeadStatements = 0;
      let freezeStatements = 0;
      let analysisLoader: MiniflareApplicationAnalysisWorkerLoader | undefined;
      fixture = await createMixedMutationProductFixture({ driver, suffix: `freeze-${changed.toLowerCase()}-${driver}`,
        hooks: {
          observeSql: (phase, sql) => {
            if (phase === "freeze") freezeStatements += 1;
            if (phase === "freeze" && /\bfrom\s+"fx_system_(?:data_binding_head|application_active_head)"/i.test(sql))
              freezeHeadStatements += 1;
          },
          beforeProductClose: (method, borrowed) => method !== "listByHandle" ? Effect.void : Effect.gen(function* () {
            yield* Effect.tryPromise({
              try: async () => {
                if (changed === "consumedExecutable") {
                  // Change the actual consumed executable through its canonical
                  // owner after the last native read. Privileged hash-only head
                  // tampering is outside the finite metadata contract.
                  const { application, currency } = fixture;
                  const scopeId = fixture.activation.anchor.scopeId;
                  const original = await Effect.runPromise(application.activation.readActive());
                  const beforeClock = await currency.persistence.getScopeClock(scopeId);
                  if (beforeClock === null) throw new Error("Missing original metadata clock");
                  analysisLoader = new MiniflareApplicationAnalysisWorkerLoader();
                  const source = await changedMixedMutationExecutableSource(fixture);
                  const revised = await application.registerRevision({ requestKey: `late-executable-${driver}`,
                    analysis: makeStandardApplicationCurrentAnalysisV1(source, analysisLoader, `late-executable-${driver}`) });
                  const schema = await application.preparePublishedSchema(revised.manifest);
                  expect(schema.schemaVersionId).toBe(original.basis.schemaVersionId);
                  expect(await Effect.runPromise(application.readiness.settle({ deploymentId: currency.deploymentId,
                    scopeId, revisionId: revised.publication.revisionId }))).toMatchObject({ status: "ready" });
                  expect(await Effect.runPromise(application.activation.activate({ revisionId: revised.publication.revisionId,
                    expectedActiveHead: original.expectedActiveHead }))).toMatchObject({ status: "activated", disposition: "inserted" });
                  const afterClock = await currency.persistence.getScopeClock(scopeId);
                  if (afterClock === null) throw new Error("Missing changed metadata clock");
                  expect(afterClock.lastCommitSeq).toBe(beforeClock.lastCommitSeq);
                  expect(afterClock.lastMetadataSequence).toBeGreaterThan(beforeClock.lastMetadataSequence);
                } else {
                  const rows = await fixture.currency.testOwner.drizzle.update(fxSystemIndexBuildStates)
                    .set({ lifecycle: "retiring", maintenanceActivationSequence: null }).where(and(eq(fxSystemIndexBuildStates.scopeId, fixture.activation.anchor.scopeId),
                      eq(fxSystemIndexBuildStates.lifecycle, "enabled"))).returning();
                  expect(rows.length).toBeGreaterThan(0);
                }
              }, catch: cause => commerceError("resourceFailure", cause),
            });
            changedBeforeClose = true;
            localTransactionCount = fixture.getTransactionCounts().beginCount;
            yield* borrowed.context.table("product");
            if (fixture.hasSqlObserver) expect(fixture.getTransactionCounts().beginCount).toBe(localTransactionCount);
          }),
          afterNativeBeforeAck: method => method !== "listByHandle" ? Effect.void : Effect.sync(() => {
            localClosed = true;
            if (fixture.hasSqlObserver) expect(fixture.getTransactionCounts().beginCount).toBe(localTransactionCount);
          }),
        } });
      try {
        const before = await committedInventory(fixture);
        const value = await returnedWorkerValue(await fixture.runExecution());
        expect(changedBeforeClose).toBe(true);
        expect(localClosed).toBe(true);
        expect(value).toMatchObject({ updated: { id: fixture.seed.productId, handle: fixture.seed.newHandle },
          pending: { id: fixture.seed.productId, title: fixture.seed.newTitle }, listed: [{ id: fixture.seed.productId }] });
        expect(Object.fromEntries(fixture.nativeInvokeCount)).toMatchObject({ update: 1, retrieve: 1, listByHandle: 1 });
        await expectPristineFiniteChildren(fixture);
        fixture.setSqlPhase("freeze");
        const envelope = await Effect.runPromise(fixture.freeze(value));
        if (fixture.hasSqlObserver) {
          expect(freezeHeadStatements).toBe(0);
          expect(freezeStatements).toBe(0);
        }
        const publication = await fixture.prepareFrozenPublication(envelope);
        if (changed === "consumedExecutable") {
          const conflict = await Effect.runPromise(publication).then(() => null, cause => cause);
          expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
          if (!(conflict instanceof PointCommitConflictV1Error) || conflict.conflict.kind !== "metadata")
            throw new Error("Expected consumed executable metadata conflict", { cause: conflict });
          expect(conflict.conflict).toMatchObject(APPLICATION_EXECUTION_METADATA_OWNER);
          expect(conflict.snapshotCommitSeq).toBe(fixture.activation.anchor.snapshotToken.commitSeq);
          expect(conflict.currentCommitSeq).toBe(conflict.snapshotCommitSeq);
          expect(conflict.conflict.lastChangedMetadataSequence).toBeGreaterThan(conflict.conflict.capturedMetadataWatermark);
        } else await expect(Effect.runPromise(publication)).rejects.toMatchObject({
          _tag: "PointCommitCorruptionV1Error", reason: "intrinsicIndexBuildInvalid",
        });
        expect(await committedInventory(fixture)).toEqual(before);
        expect(fixture.getOpenTransactionDepth()).toBe(0);
      } finally { try { await analysisLoader?.dispose(); } finally { await fixture.close(); } }
    }, 180_000);

  it("refuses event capture after root closure before the borrowed lifetime closes", async () => {
    let captures = 0;
    let closedRootRefused = false;
    const event = new Proxy({}, { ownKeys: () => { captures++; throw new Error("foreign event capture"); } });
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `local-root-closure-${driver}`,
      hooks: { afterProductBorrow: (method, borrowed, rootEvaluator) => method !== "update" ? Effect.void :
        Effect.gen(function* () {
          if (rootEvaluator === undefined) throw new Error("Missing finite root evaluator");
          rootEvaluator.close();
          const refusal = yield* Effect.result(borrowed.context.captureLocalEvent(event));
          expect(refusal).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
          expect(captures).toBe(0);
          closedRootRefused = true;
        }) } });
    try {
      await expect(fixture.runExecution()).rejects.toBeDefined();
      expect(closedRootRefused).toBe(true);
      expect(captures).toBe(0);
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId, fixture.activation.anchor.sessionId));
      expect(receipts).toHaveLength(0);
      await expect(Effect.runPromise(fixture.freeze({ afterRootClosure: true }))).rejects.toBeDefined();
    } finally { await fixture.close(); }
  }, 180_000);

  it("constructs a tentative Product context after claim expiry, refuses the next read and rejects expired-owner cleanup", async () => {
    let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
    let localAfterRevocation = false;
    let checkedReadRefused = false;
    let beforeConstruction = 0;
    fixture = await createMixedMutationProductFixture({ driver, suffix: `local-claim-loss-${driver}`,
      hooks: { beforeProductBorrow: method => method !== "update" ? Effect.void : Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: async () => { const updated = await fixture.currency.persistence.drizzle.update(fxSystemTransactionSessions)
            .set({ finiteClaimExpiresAt: sql`${fxSystemTransactionSessions.finiteClaimedAt} + interval '1 millisecond'` })
            .where(and(eq(fxSystemTransactionSessions.sessionId, fixture.activation.anchor.sessionId),
              sql`${fxSystemTransactionSessions.finiteClaimedAt} + interval '1 millisecond' < clock_timestamp()`)).returning();
            expect(updated).toHaveLength(1); },
          catch: cause => commerceError("resourceFailure", cause),
        });
        beforeConstruction = fixture.getTransactionCounts().beginCount;
      }), afterProductBorrow: (method, borrowed) => method !== "update" ? Effect.void : Effect.gen(function* () {
        if (fixture.hasSqlObserver) expect(fixture.getTransactionCounts().beginCount).toBe(beforeConstruction);
        const beforeLocal = fixture.getTransactionCounts().beginCount;
        yield* borrowed.context.table("product");
        localAfterRevocation = true;
        if (fixture.hasSqlObserver) expect(fixture.getTransactionCounts().beginCount).toBe(beforeLocal);
        const transactionTime = borrowed.context.transactionTime;
        if (transactionTime === undefined) throw new Error("Missing borrowed transaction time");
        const observed = yield* Effect.result(transactionTime);
        expect(observed).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
        checkedReadRefused = true;
      }) } });
    try {
      const before = await committedInventory(fixture);
      const [request] = await fixture.currency.persistence.drizzle.select({
        scopeUuid: fxSystemTransactionSessions.scopeUuid, requestKey: fxSystemTransactionSessions.requestKey,
      }).from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, fixture.activation.anchor.sessionId));
      if (request === undefined) throw new Error("Missing exact finite request identity");
      const beforeOutcomes = await fixture.currency.persistence.drizzle.select().from(fxSystemIdempotency)
        .where(eq(fxSystemIdempotency.scopeUuid, request.scopeUuid)).orderBy(asc(fxSystemIdempotency.requestKey));
      expect(beforeOutcomes.length).toBeGreaterThan(0);
      expect(beforeOutcomes.some(outcome => outcome.requestKey === request.requestKey)).toBe(false);
      await expect(fixture.runExecution()).rejects.toBeDefined();
      expect(localAfterRevocation).toBe(true);
      expect(checkedReadRefused).toBe(true);
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId, fixture.activation.anchor.sessionId));
      expect(receipts).toHaveLength(0);
      await expect(Effect.runPromise(fixture.freeze({ afterRevocation: true }))).rejects.toBeDefined();
      expect(await committedInventory(fixture)).toEqual(before);
      expect(await fixture.currency.persistence.drizzle.select().from(fxSystemIdempotency)
        .where(eq(fxSystemIdempotency.scopeUuid, request.scopeUuid)).orderBy(asc(fxSystemIdempotency.requestKey)))
        .toEqual(beforeOutcomes);
      expect(await fixture.currency.persistence.drizzle.select().from(fxSystemIdempotency)
        .where(and(eq(fxSystemIdempotency.scopeUuid, request.scopeUuid),
          eq(fxSystemIdempotency.requestKey, request.requestKey)))).toHaveLength(0);
    } finally {
      try {
        if (fixture.hasSqlObserver) expect(fixture.getOpenTransactionDepth()).toBe(0);
        if (driver === "postgres") expect(await fixture.observePgNativeSqlTransactions()).toMatchObject({ openTransactions: 0 });
      } finally {
        await expect(fixture.close()).rejects.toMatchObject({
          _tag: "PointMutationSessionAttemptTerminalizationV1Error", issue: { reason: "executionClaimUnavailable" },
        });
      }
      if (fixture.hasSqlObserver) expect(fixture.getOpenTransactionDepth()).toBe(0);
    }
  }, 180_000);

  it("runs the selected native service on the exact finite attempt", async () => {
    let freezeBindingReads = 0;
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `workerd-${driver}`,
      hooks: { observeSql: (phase, sql) => {
        if (phase === "freeze" && /\bfrom\s+"fx_system_data_binding_head"/i.test(sql)) freezeBindingReads++;
      } } });
    try {
      const { currency, product, seed, baseline, activation,
        binding, eventGroup, runAdmitted,
        serviceTransactionDepth, sqlByPhase } = fixture;
      const workerd = await fixture.runExecution();
    expect(workerd).toMatchObject({ kind: "result", result: { kind: "success",
      result: { format: "flarex.point-mutation-exact-runtime-result", version: 1,
        value: { updated: { id: seed.productId, handle: seed.newHandle },
        pending: { id: seed.productId, title: seed.newTitle },
        listed: [{ id: seed.productId }] } } } });
    const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
      result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(workerd);
    const returnedValue = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
      success.result.result))).value;
    const updateRequest = fixture.getUpdateRequest();
    if (updateRequest === undefined) throw new Error("Missing admitted update frame");
    fixture.setSqlPhase("replay");
    const replayed = await Effect.runPromise(runAdmitted(updateRequest));
    expect(replayed).toMatchObject({ id: seed.productId, title: seed.newTitle,
      handle: seed.newHandle });
    const reopened = await Effect.runPromise(fixture.reopenJournalAttempt());
    expect(reopened).toBe(fixture.attempt);
    const reopenedRunner = fixture.journal.runAdmittedOperation;
    if (reopenedRunner === undefined) throw new Error("Missing admitted Product runner");
    const replayedFromReopened = await Effect.runPromise(reopenedRunner(reopened,
      updateRequest));
    expect(replayedFromReopened).toMatchObject({ id: seed.productId,
      title: seed.newTitle, handle: seed.newHandle });
    expect(fixture.nativeInvokeCount.get("update")).toBe(1);
    expect(fixture.hasSqlObserver).toBe(driver === "pglite");
    if (fixture.hasSqlObserver) {
      expect(serviceTransactionDepth).toEqual([0, 0, 0]);
      expect(fixture.getTransactionCounts().beginCount).toBeGreaterThan(0);
      expect(fixture.getTransactionCounts().settleCount).toBeGreaterThan(0);
      expect(fixture.getOpenTransactionDepth()).toBe(0);
    } else {
      expect(fixture.pgTransactionObservations).toHaveLength(3);
      expect(fixture.pgTransactionObservations.every(observed =>
        observed.targetBackends > 0 && observed.openTransactions === 0)).toBe(true);
    }
    expect(baseline).toMatchObject({ id: seed.productId, tags: [{ id: seed.tagId }] });
    fixture.setSqlPhase("freeze");
    const envelope = await Effect.runPromise(fixture.freeze(returnedValue));
    if (fixture.hasSqlObserver) expect(freezeBindingReads).toBe(0);
    fixture.setSqlPhase("verify");
    const publication = await fixture.prepareFrozenPublication(envelope);
    const persistedRoots = await currency.persistence.drizzle.select().from(fxSystemTransactionJournals)
      .where(and(eq(fxSystemTransactionJournals.scopeUuid,
        projectScopeIdUuidV1(activation.anchor.scopeId).scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, activation.anchor.sessionId),
      eq(fxSystemTransactionJournals.attemptFence, activation.anchor.attemptFence)));
    expect(persistedRoots).toHaveLength(0);
    const captured = readFrozenFiniteAttempt(envelope);
    if (captured === undefined) throw new Error("Missing authentic frozen Product graph");
    expect(captured.operations.filter(operation => operation.kind === "participant" && operation.participant === "medusa.product")).toHaveLength(3);
    expect(captured.graph.indexReads.some(read => read.entries.length > 0)).toBe(true);
    const published = await Effect.runPromise(publication);
    expect(published).toMatchObject({ kind: "published" });
    const appResult = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(returnedValue);
    const appIdentity = decodeAppDocumentIdentityV1(appResult.id);
    const committedApp = await currency.persistence.drizzle.select().from(fxAppRowRevisions).where(and(
      eq(fxAppRowRevisions.scopeUuid, projectScopeIdUuidV1(activation.anchor.scopeId).scopeUuid),
      eq(fxAppRowRevisions.tableId, appIdentity.tableId),
      eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(appIdentity.rowId)),
    )).orderBy(fxAppRowRevisions.commitSeq);
    const appRevision = committedApp.at(-1);
    if (appRevision?.valueBytes === null || appRevision?.valueBytes === undefined ||
      appRevision.valueSha256 === null) throw new Error("Missing committed dependent Application row");
    const appDocument = await decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes: appRevision.valueBytes, sha256: appRevision.valueSha256, profile: "appDocument",
    });
    expect(appDocument.value).toMatchObject({ name: seed.newTitle });
    const committedEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents).where(
      eq(fxSystemCommitEvents.scopeUuid, projectScopeIdUuidV1(activation.anchor.scopeId).scopeUuid));
    const productUpdateEvents = committedEvents.filter(event =>
      event.envelope.contract === binding.metadata.product.updatedEvent &&
      event.envelope.group === eventGroup);
    expect(productUpdateEvents).toHaveLength(1);
    expect(productUpdateEvents[0]?.envelope.message).toMatchObject({ name: binding.metadata.product.updatedEvent });
    fixture.setSqlPhase("postcommit-read");
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [product.runtime.commands.retrieve, product.runtime.commands.list] }));
    try {
      const after = await Effect.runPromise(read.read(product.runtime.commands.retrieve, {
        id: seed.productId, config: { relations: ["options.values", "tags",
          "variants.options", "images", "categories"] },
      }));
      expect(after).toMatchObject({ id: seed.productId, title: seed.newTitle, handle: seed.newHandle,
        options: baseline.options, tags: baseline.tags, variants: baseline.variants,
        images: baseline.images, categories: baseline.categories });
      const titleSearch = await Effect.runPromise(read.read(product.runtime.commands.list,
        { filters: { q: seed.newTitle } }));
      expect(titleSearch).toEqual(expect.arrayContaining([expect.objectContaining({ id: seed.productId })]));
    } finally { await Effect.runPromise(read.close); }
    if (fixture.hasSqlObserver) {
      expect(sqlByPhase.get("product:update")).toBeGreaterThan(0);
      expect(sqlByPhase.get("publish")).toBeGreaterThan(0);
      expect(sqlByPhase.get("product:retrieve") ?? 0).toBe(0);
      expect(sqlByPhase.get("product:listByHandle") ?? 0).toBe(0);
      expect(sqlByPhase.get("freeze") ?? 0).toBe(0);
      // A focused receipt for the connected proof; seed and postcommit reads are excluded.
      expect(Object.fromEntries(sqlByPhase)).toMatchObject({ application: expect.any(Number),
        "product:update": expect.any(Number), publish: expect.any(Number) });
      console.info("Mixed attempt SQL statements by phase", Object.fromEntries(sqlByPhase));
    }
    } finally { await fixture.close(); }
  }, 180_000);

  it("keeps a missing native Product failure sticky when the Worker catches it", async () => {
    const fixture = await createMixedMutationProductFixture({
      driver, suffix: `missing-product-${driver}`,
    });
    try {
      const missing = { ...fixture.seed.updateInput, id: `prod_missing_${driver}` };
      const workerError = await fixture.runExecution(`export default { users: { create: {
        isMutation: true, isPublic: true, _handler: async (ctx) => {
          const id = await ctx.db.insert("users", { name: "pending" });
          let caught = false;
          try { await ctx.privateMixed.call("medusa.product", "update", ${JSON.stringify(missing)}); }
          catch { caught = true; }
          return { id, caught };
        },
      } } };`).then(() => null, cause => cause);
      if (!(workerError instanceof Error)) throw new Error("Expected sticky journal boundary failure after catch");
      expect(workerError.message).toContain("PointMutationExactRuntimeJournalBoundaryV1Error");
      expect(fixture.bridgeFailures.join("\n")).toContain("PointMutationJournalParticipantRejectedV1Error");
      const roots = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId, fixture.activation.anchor.sessionId));
      expect(roots).toHaveLength(0);
      const anchors = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, fixture.activation.anchor.sessionId));
      expect(anchors).toMatchObject([{ lifecycle: "running", executionProfile: "finiteRoot" }]);
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId, fixture.activation.anchor.sessionId))
        .orderBy(asc(fxSystemTransactionJournalReceipts.lastSyscallSequence));
      expect(receipts).toHaveLength(0);
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      await expect(Effect.runPromise(fixture.freeze({ caught: true }))).rejects.toBeDefined();
    } finally { await fixture.close(); }
  }, 180_000);

  it.skipIf(driver !== "postgres")(
    "detects a held runtime SQL transaction during the native callback", async () => {
      const fixture = await createMixedMutationProductFixture({ driver,
        suffix: "held-native-sql-negative-control" });
      if (fixture.currency.resource.kind !== "postgres")
        throw new Error("PostgreSQL fixture required");
      const held = await fixture.currency.resource.target.pool.connect();
      try {
        await held.query("BEGIN");
        await held.query("SELECT 1");
        const observed = await fixture.observePgNativeSqlTransactions();
        expect(observed?.targetBackends).toBeGreaterThan(1);
        expect(observed?.openTransactions).toBeGreaterThan(0);
        const failure = await fixture.runExecution().then(() => null, cause => cause);
        expect(failure).toBeInstanceOf(Error);
        expect(fixture.bridgeFailures.join("\n"))
          .toContain("Product native callback overlapped target SQL transaction");
        expect(fixture.nativeInvokeCount.get("update") ?? 0).toBe(0);
      } finally {
        await held.query("ROLLBACK");
        held.release();
        await fixture.close();
      }
    }, 180_000);
});
