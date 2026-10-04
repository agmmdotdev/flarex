import { documentValidationRecoverySource } from "../../executor/test/performance/support/documentValidationRecoverySource";
import { loadPublishedPhysicalRequirementSnapshotV1 } from "../../persistence-postgres/src/indexBuildReconciliation";
import { readLogicalStorageRequirements } from "../../persistence-postgres/src/logicalStorageDefinitions";
import { logicalTableKey } from "flarex-protocol/internal/logical-schema-candidate";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Option, Result, Schema } from "effect";
import { locateAppIndexDefinitionByIdEffect } from "../../persistence-postgres/src/appIndexDefinitions";
import { selectLogicalIndex } from "../../persistence-postgres/src/logicalDocuments/query";
import { describe, expect, it } from "vitest";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { decodeAppDocumentIdentityV1, appRowIdHexV1ToBytes } from
  "flarex-protocol/app-document-id";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { decodeCanonicalSessionJournalEffect } from "flarex-protocol/commit-protocol";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { fxAppRowRevisions, fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournals, fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournalPoints, fxSystemTransactionJournalWriteEvents,
  fxSystemIndexBuildStates, fxSystemCommits, fxSystemScopeClocks } from "../../persistence-postgres/src/schema";
import { fxSystemDataBindingHeads } from "../../persistence-postgres/src/frameworkSchema/binding/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { commerceError, logicalCommerceError } from "../../persistence-postgres/src/commerceTransaction/model";
import { decodeLogicalParticipantDependencyEvidence, defineCommerceCommand } from
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
      expect((await fixture.readSettlementLedger())?.syscallReceipts).toBe(7);
      const earlier = Schema.decodeUnknownSync(Schema.Struct({ earlier: Schema.Struct({ _id: Schema.String }) }))(value).earlier;
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
        await expect(Effect.runPromise(fixture.journal.sealSuccessfulResult(fixture.attempt, null))).rejects.toBeDefined();
      } finally { await fixture.close(); }
    }, 180_000);

  it.each(["required", "sameSourceUnused", "unrelated", "applicationUnused"] as const)(
    "checks demanded reads and current publication maintenance after %s readiness changes", async changed => {
      let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
      let readChecked = false;
      let checkingRead = false;
      let dataStatements = 0;
      let readHeadStatements = 0;
      let sealHeadStatements = 0;
      fixture = await createMixedMutationProductFixture({ driver, suffix: `selected-read-${changed.toLowerCase()}-${driver}`,
        hooks: {
          observeSql: (phase, sql) => {
            if (checkingRead && /\bfx_app_(?:row_rev|index_entry_(?:rev|current)|unique_key)\b/.test(sql)) dataStatements += 1;
            if (/\bfrom\s+"fx_system_(?:data_binding_head|application_active_head)"/i.test(sql)) {
              if (checkingRead) readHeadStatements += 1;
              if (phase === "seal") sealHeadStatements += 1;
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
              const updated = await fixture.currency.persistence.drizzle.update(fxSystemIndexBuildStates)
                .set({ lifecycle: "retiring", maintenanceActivationSequence: null,
                  maintenanceBytes: null, maintenanceSha256: null })
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
          await expect(Effect.runPromise(fixture.journal.sealSuccessfulResult(fixture.attempt, null)))
            .rejects.toMatchObject({ _tag: "SessionJournalSealV1Error", reason: "journalFailed" });
          expect(await committedInventory(fixture)).toEqual(before);
        } else {
          const value = await returnedWorkerValue(await fixture.runExecution());
          expect(readChecked, fixture.bridgeFailures.join("\n")).toBe(true);
          expect(value).toMatchObject({ updated: { id: fixture.seed.productId, handle: fixture.seed.newHandle },
            pending: { id: fixture.seed.productId, title: fixture.seed.newTitle }, listed: [{ id: fixture.seed.productId }] });
          expect(Object.fromEntries(fixture.nativeInvokeCount)).toMatchObject({ update: 1, retrieve: 1, listByHandle: 1 });
          await expectPristineFiniteChildren(fixture);
          fixture.setSqlPhase("seal");
          const envelope = await Effect.runPromise(fixture.journal.sealSuccessfulResult(fixture.attempt, value));
          if (fixture.hasSqlObserver) expect(sealHeadStatements).toBe(0);
          const publication = await fixture.prepareSealedPublication(envelope);
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

  it.each(["sourceHead", "readiness"] as const)(
    "retains fixed metadata at seal and refuses publication after %s changes following the last native read", async changed => {
      let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
      let changedBeforeClose = false;
      let localClosed = false;
      let localTransactionCount = 0;
      let sealHeadStatements = 0;
      fixture = await createMixedMutationProductFixture({ driver, suffix: `seal-${changed.toLowerCase()}-${driver}`,
        hooks: {
          observeSql: (phase, sql) => {
            if (phase === "seal" && /\bfrom\s+"fx_system_(?:data_binding_head|application_active_head)"/i.test(sql))
              sealHeadStatements += 1;
          },
          beforeProductClose: (method, borrowed) => method !== "listByHandle" ? Effect.void : Effect.gen(function* () {
            yield* Effect.tryPromise({
              try: async () => {
                if (changed === "sourceHead") {
                  const rows = await fixture.currency.persistence.drizzle.update(fxSystemDataBindingHeads)
                    .set({ sha256: "0".repeat(64) }).where(eq(fxSystemDataBindingHeads.scopeId, fixture.activation.anchor.scopeId))
                    .returning();
                  expect(rows).toHaveLength(1);
                } else {
                  const rows = await fixture.currency.persistence.drizzle.update(fxSystemIndexBuildStates)
                    .set({ lifecycle: "retiring", maintenanceActivationSequence: null,
                      maintenanceBytes: null, maintenanceSha256: null }).where(and(eq(fxSystemIndexBuildStates.scopeId, fixture.activation.anchor.scopeId),
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
        fixture.setSqlPhase("seal");
        const envelope = await Effect.runPromise(fixture.journal.sealSuccessfulResult(fixture.attempt, value));
        if (fixture.hasSqlObserver) expect(sealHeadStatements).toBe(0);
        await expect(Effect.runPromise(await fixture.prepareSealedPublication(envelope))).rejects.toMatchObject({
          _tag: "PointCommitCorruptionV1Error",
          reason: changed === "sourceHead" ? "activeApplicationHeadInvalid" : "intrinsicIndexBuildInvalid",
        });
        expect(await committedInventory(fixture)).toEqual(before);
        expect(fixture.getOpenTransactionDepth()).toBe(0);
      } finally { await fixture.close(); }
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
      await expect(Effect.runPromise(fixture.journal.sealSuccessfulResult(
        fixture.attempt, { afterRootClosure: true }))).rejects.toBeDefined();
    } finally { await fixture.close(); }
  }, 180_000);

  it("constructs a tentative Product context after claim loss and refuses the next database read", async () => {
    let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
    let localAfterRevocation = false;
    let checkedReadRefused = false;
    let beforeConstruction = 0;
    fixture = await createMixedMutationProductFixture({ driver, suffix: `local-claim-loss-${driver}`,
      hooks: { beforeProductBorrow: method => method !== "update" ? Effect.void : Effect.gen(function* () {
        const expiredAt = new Date(Date.now() - 60_000);
        const claimedAt = new Date(Date.now() - 120_000);
        yield* Effect.tryPromise({
          try: async () => { await fixture.currency.persistence.drizzle.update(fxSystemTransactionExecutionClaims)
            .set({ claimedAt, claimExpiresAt: expiredAt })
            .where(eq(fxSystemTransactionExecutionClaims.sessionId, fixture.activation.anchor.sessionId)); },
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
      await expect(fixture.runExecution()).rejects.toBeDefined();
      expect(localAfterRevocation).toBe(true);
      expect(checkedReadRefused).toBe(true);
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId, fixture.activation.anchor.sessionId));
      expect(receipts).toHaveLength(0);
      await expect(Effect.runPromise(fixture.journal.sealSuccessfulResult(
        fixture.attempt, { afterRevocation: true }))).rejects.toBeDefined();
    } finally { await fixture.close(); }
  }, 180_000);

  it("runs the selected native service on the exact journal attempt", async () => {
    let sealBindingReads = 0;
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `workerd-${driver}`,
      hooks: { observeSql: (phase, sql) => {
        if (phase === "seal" && /\bfrom\s+"fx_system_data_binding_head"/i.test(sql)) sealBindingReads++;
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
    fixture.setSqlPhase("seal");
    const envelope = await Effect.runPromise(fixture.journal.sealSuccessfulResult(fixture.attempt, returnedValue));
    if (fixture.hasSqlObserver) expect(sealBindingReads).toBe(0);
    fixture.setSqlPhase("verify");
    const publication = await fixture.prepareSealedPublication(envelope);
    const sealedRoots = await currency.persistence.drizzle.select().from(fxSystemTransactionJournals)
      .where(and(eq(fxSystemTransactionJournals.scopeUuid,
        projectScopeIdUuidV1(activation.anchor.scopeId).scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, activation.anchor.sessionId),
      eq(fxSystemTransactionJournals.attemptFence, activation.anchor.attemptFence)));
    expect(sealedRoots).toHaveLength(1);
    const sealedRoot = sealedRoots[0];
    if (sealedRoot?.sealedJournalBytes === null || sealedRoot?.sealedJournalBytes === undefined ||
      sealedRoot.sealedJournalSha256 === null) throw new Error("Missing sealed Product journal evidence");
    const sealedJournal = await Effect.runPromise(decodeCanonicalSessionJournalEffect({
      canonicalBytes: sealedRoot.sealedJournalBytes,
      expectedSha256Hex: encodeBytesToLowercaseHex(sealedRoot.sealedJournalSha256),
    }));
    const productReadEvidence = sealedJournal.journal.participantOperations
      .filter(operation => operation.participant === "medusa.product")
      .flatMap(operation => operation.sourceContributions)
      .filter(source => source.sourceKey === "medusa.product")
      .map(source => Result.getOrThrow(decodeLogicalParticipantDependencyEvidence(
        source.dependencyEvidence)));
    expect(productReadEvidence).toHaveLength(3);
    expect(productReadEvidence.some(evidence => evidence.indexRanges.length > 0 &&
      evidence.indexRanges.some(range => range.entries.length > 0))).toBe(true);
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
      // A focused receipt for the connected proof; seed and postcommit reads are excluded.
      expect(Object.fromEntries(sqlByPhase)).toMatchObject({ application: expect.any(Number),
        "product:update": expect.any(Number), seal: expect.any(Number), publish: expect.any(Number) });
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
      expect(roots).toHaveLength(1);
      expect(roots[0]).toMatchObject({ state: "open", lastSyscallSequence: 0n });
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId, fixture.activation.anchor.sessionId))
        .orderBy(asc(fxSystemTransactionJournalReceipts.lastSyscallSequence));
      expect(receipts).toHaveLength(0);
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      await expect(Effect.runPromise(fixture.journal.sealSuccessfulResult(
        fixture.attempt, { caught: true }))).rejects.toBeDefined();
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
