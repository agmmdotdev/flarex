import { readFrozenFiniteAttempt } from "../../persistence-postgres/src/sessionJournalStore";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodeAppDocumentIdentityV1, appRowIdHexV1ToBytes } from
  "flarex-protocol/app-document-id";
import { CommitSyscallSequenceV1Schema } from
  "flarex-protocol/commit-protocol";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { ADMITTED_FRAMEWORK_OPERATION_FORMAT_V1, ADMITTED_FRAMEWORK_OPERATION_VERSION_V1,
  encodeAdmittedFrameworkOperationV1Result } from
  "flarex-protocol/internal/admitted-framework-operation-v1";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { fxAppRowRevisions, fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournals, fxSystemCommits, fxSystemIndexBuildStates, fxSystemIdempotency, fxSystemScopeClocks } from
  "../../persistence-postgres/src/schema";
import { readLogicalStorageRequirements } from "../../persistence-postgres/src/logicalStorageDefinitions";
import { loadPublishedPhysicalRequirementSnapshotV1 } from "../../persistence-postgres/src/indexBuildReconciliation";
import { logicalTableKey } from "flarex-protocol/internal/logical-schema-candidate";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { admittedCommerceEventGroup } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { PointCommitConflictV1Error } from "../../persistence-postgres/src/pointCommitTransaction";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";
import { installOneCommitResponseFault } from "./support/postgresCommitResponseFault";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

const WorkerSuccess = Schema.Struct({ kind: Schema.Literal("result"),
  result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) });

describe.each(drivers)("finite native Product launch workflow in one Worker attempt on %s", driver => {
  it("keeps Product child reads available after Pricing readiness loss and refuses complete workflow acceptance", async () => {
    let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
    let changed = false;
    let dataStatements = 0;
    let freezeStatements = 0;
    let priceSetTableId: CatalogTableId | undefined;
    fixture = await createMixedMutationProductFixture({ driver, workflow: true,
      suffix: `launch-union-required-pricing-${driver}`, payloadProfile: "success",
      hooks: {
        observeSql: (phase) => { if (phase === "freeze") freezeStatements++; },
        observeWorkflowSql: sql => {
          if (changed && /\bfx_app_(?:row_rev|index_entry_(?:rev|current)|unique_key)\b/.test(sql)) dataStatements++;
        },
        beforeWorkflowBorrow: () => Effect.gen(function* () {
          const requirements = yield* readLogicalStorageRequirements(fixture.currency.control.drizzle,
            fixture.currency.deploymentId, fixture.logicalSchemaVersionId).pipe(
              Effect.mapError(cause => commerceError("resourceFailure", cause)));
          const pricing = requirements.evidence.candidate.sources.find(source => source.key === "medusa.pricing");
          if (pricing === undefined) throw new Error("Missing issued Pricing source");
          const priceSetBinding = pricing.bindings.filter(binding => binding.kind === "definition")
            .find(binding => binding.localName === "price_set");
          const priceSetTable = priceSetBinding === undefined ? undefined : requirements.evidence.tableBindings
            .find(table => logicalTableKey(table.table) === logicalTableKey(priceSetBinding.table));
          if (priceSetTable === undefined) throw new Error("Missing required Pricing price_set write table");
          priceSetTableId = priceSetTable.tableId;
          const snapshot = yield* loadPublishedPhysicalRequirementSnapshotV1(fixture.currency.control.drizzle,
            { deploymentId: fixture.currency.deploymentId, schemaVersionId: fixture.logicalSchemaVersionId }).pipe(
              Effect.mapError(cause => commerceError("resourceFailure", cause)));
          const index = snapshot?.definitions.find(definition => definition.access.tableId === priceSetTableId &&
            definition.access.kind === "by_creation_time");
          if (index === undefined) throw new Error("Missing required Pricing index");
          yield* Effect.tryPromise({ try: async () => {
            const updated = await fixture.currency.testOwner.drizzle.update(fxSystemIndexBuildStates)
              .set({ lifecycle: "retiring", maintenanceActivationSequence: null, }).where(and(
                eq(fxSystemIndexBuildStates.scopeId, fixture.activation.anchor.scopeId),
                eq(fxSystemIndexBuildStates.indexDefinitionId, index.indexDefinitionId))).returning();
            expect(updated).toHaveLength(1);
          }, catch: cause => commerceError("resourceFailure", cause) });
          changed = true;
        }),
      },
    });
    try {
      const database = fixture.currency.persistence.drizzle;
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const inventory = () => Promise.all([
        database.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid))
          .orderBy(fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
        database.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid)).orderBy(fxSystemCommits.commitSeq),
        database.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid))
          .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal),
        database.select().from(fxSystemIdempotency).where(eq(fxSystemIdempotency.scopeUuid, scopeUuid)),
        database.select({ commitSeq: fxSystemScopeClocks.lastCommitSeq }).from(fxSystemScopeClocks)
          .where(eq(fxSystemScopeClocks.scopeId, fixture.activation.anchor.scopeId)),
      ]);
      const before = await inventory();
      // Losing only write maintenance does not deny unrelated Product reads or
      // local Pricing creation. The final touched-table owner must refuse it.
      const success = Schema.decodeUnknownSync(WorkerSuccess)(await fixture.runExecution());
      const value = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
      expect(value).toMatchObject({ workflow: { product: { id: fixture.seed.productId },
        pricing: { priceSets: [expect.objectContaining({ id: expect.any(String) })] } } });
      expect(changed).toBe(true);
      expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);
      // This hook is installed by the optional currency SQL observer. The
      // PostgreSQL fixture's native result remains the read-success witness
      // when client dispatch observations are unavailable.
      if (fixture.hasSqlObserver) expect(dataStatements).toBeGreaterThan(0);
      expect(await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId, fixture.activation.anchor.sessionId))).toHaveLength(0);
      expect(await inventory()).toEqual(before);
      fixture.setSqlPhase("freeze");
      const frozen = await Effect.runPromise(fixture.freeze(value));
      if (fixture.hasSqlObserver) expect(freezeStatements).toBe(0);
      const captured = readFrozenFiniteAttempt(frozen);
      if (captured === undefined || priceSetTableId === undefined) throw new Error("Missing genuine frozen Pricing write evidence");
      expect(captured.graph.changes.some(change => change.tableId === priceSetTableId && change.kind === "live")).toBe(true);
      await expect(Effect.runPromise(await fixture.prepareFrozenPublication(frozen))).rejects.toMatchObject({
        _tag: "PointCommitCorruptionV1Error", reason: "intrinsicIndexBuildInvalid",
      });
      expect(await inventory()).toEqual(before);
      expect(fixture.getOpenTransactionDepth()).toBe(0);
    } finally { await fixture.close(); }
  }, 180_000);

  it.skipIf(driver !== "pglite")(
    "cancels a pending native Product child and closes its borrowed capability", async () => {
      const entered = await Effect.runPromise(Deferred.make<void>());
      const release = await Effect.runPromise(Deferred.make<void>());
      let held = false;
      let nativeStarted = false;
      const observedWorkflowSql: string[] = [];
      const fixture = await createMixedMutationProductFixture({ driver, workflow: true,
        suffix: "launch-native-child-cancel", payloadProfile: "success",
        hooks: { beforeNative: method => Effect.sync(() => {
          if (method === "workflow:run") nativeStarted = true;
        }), observeWorkflowSql: async statement => {
          if (observedWorkflowSql.length < 20) observedWorkflowSql.push(statement.slice(0, 180));
          if (!nativeStarted || held ||
            !/\bfrom\s+"?fx_app_(?:row_rev|index_entry_rev)\b/i.test(statement)) return;
          held = true;
          await Effect.runPromise(Deferred.succeed(entered, undefined));
          await Effect.runPromise(Deferred.await(release));
        } },
      });
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const beforeRows = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
        .where(eq(fxAppRowRevisions.scopeUuid, scopeUuid));
      const encoded = Result.getOrThrow(encodeAdmittedFrameworkOperationV1Result({
        format: ADMITTED_FRAMEWORK_OPERATION_FORMAT_V1,
        version: ADMITTED_FRAMEWORK_OPERATION_VERSION_V1,
        participant: "medusa.workflow", operation: "run", args: {
          product_id: fixture.seed.productId, tag_id: fixture.seed.tagId,
          variant_title: "Launch variant", usd_amount: 50,
        },
      }));
      const admitted = fixture.runAdmitted({
        syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
        operation: encoded.operation, requestBytes: encoded.bytes,
        requestSha256: createHash("sha256").update(encoded.bytes).digest(),
      });
      fixture.setSqlPhase("workflow:run");
      const fiber = Effect.runFork(admitted);
      try {
        await Promise.race([Effect.runPromise(Deferred.await(entered)),
          Effect.runPromise(Fiber.await(fiber)).then(() => {
            throw new Error(`Workflow ended before active Product child SQL: ` +
              `nativeStarted=${nativeStarted}, targetReads=${observedWorkflowSql.length}, ` +
              `sample=${JSON.stringify(observedWorkflowSql.slice(0, 5))}`);
          })]);
        expect(held).toBe(true);
        expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);
        expect(fixture.serviceTransactionDepth).toEqual([0]);
        const interrupting = Effect.runPromise(Fiber.interrupt(fiber));
        await Effect.runPromise(Deferred.succeed(release, undefined));
        await interrupting;
        const interrupted = await Effect.runPromise(Fiber.await(fiber));
        expect(Exit.isFailure(interrupted)).toBe(true);
        if (Exit.isFailure(interrupted)) expect(Cause.hasInterrupts(interrupted.cause)).toBe(true);
        expect(fixture.getOpenTransactionDepth()).toBe(0);
        const roots = await fixture.currency.persistence.drizzle.select()
          .from(fxSystemTransactionJournals)
          .where(eq(fxSystemTransactionJournals.sessionId,
            fixture.activation.anchor.sessionId));
        expect(roots).toHaveLength(0);
        const receipts = await fixture.currency.persistence.drizzle.select()
          .from(fxSystemTransactionJournalReceipts)
          .where(eq(fxSystemTransactionJournalReceipts.sessionId,
            fixture.activation.anchor.sessionId));
        expect(receipts).toHaveLength(0);
        expect(await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
          .where(eq(fxAppRowRevisions.scopeUuid, scopeUuid))).toEqual(beforeRows);
        const events = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
          .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
        expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
        expect(await fixture.readCurrentProduct()).toMatchObject({
          id: fixture.seed.productId,
          tags: [expect.objectContaining({ id: fixture.seed.tagId, value: "preview" })],
          variants: [],
        });
        await expect(fixture.retryClosedWorkflow({ product_id: fixture.seed.productId,
          tag_id: fixture.seed.tagId, variant_title: "forbidden", usd_amount: 50 }))
          .rejects.toMatchObject({ _tag: "CommerceTransactionError", reason: "closed" });
        expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);
        await expect(Effect.runPromise(fixture.freeze(null)))
          .rejects.toMatchObject({ _tag: "SessionJournalSealV1Error", reason: "journalFailed" });
      } finally {
        await Effect.runPromise(Deferred.succeed(release, undefined));
        await Effect.runPromise(Fiber.interrupt(fiber));
        await fixture.close();
      }
    }, 180_000);

  it("replays a tentative workflow result after bridge acknowledgement loss within the same root", async () => {
    let loseAcknowledgement = true;
    const fixture = await createMixedMutationProductFixture({ driver, workflow: true,
      suffix: `launch-ack-loss-${driver}`, payloadProfile: "success",
      hooks: { afterStoreAckBeforeBridgeReply: method => {
        if (method === "run" && loseAcknowledgement) {
          loseAcknowledgement = false;
          throw new Error("injected workflow bridge acknowledgement loss");
        }
      } },
    });
    try {
      const first = await fixture.runExecution().catch(cause => cause);
      if (!(first instanceof Error)) {
        expect(first).not.toMatchObject({ result: { kind: "success" } });
      }
      expect(fixture.bridgeFailures.join("\n"))
        .toContain("injected workflow bridge acknowledgement loss");
      expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);
      const request = fixture.getAdmittedRequest("medusa.workflow", "run");
      if (request === undefined) throw new Error("Missing accepted workflow request");
      const retained = await Effect.runPromise(fixture.runAdmitted(request));
      expect(retained).toMatchObject({ pricing: { variants: [expect.objectContaining({
        product_id: fixture.seed.productId })] }, tags: [expect.objectContaining({
        id: fixture.seed.tagId, value: "launched" })] });
      expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);
      const second = Schema.decodeUnknownSync(WorkerSuccess)(await fixture.runExecution());
      const result = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
        second.result.result))).value;
      expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId,
          fixture.activation.anchor.sessionId));
      expect(receipts.filter(receipt => receipt.outcomeKind === "admittedLogicalResult"))
        .toHaveLength(0);
      const publication = await fixture.preparePublication(result);
      const sealedReceipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId,
          fixture.activation.anchor.sessionId));
      expect(sealedReceipts).toHaveLength(0);
      expect(await Effect.runPromise(publication)).toMatchObject({ kind: "published" });
    } finally { await fixture.close(); }
  }, 240_000);

  it("publishes a frozen workflow root and replays its durable outcome without rerunning either child", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, workflow: true,
      suffix: `launch-sealed-${driver}`, payloadProfile: "success" });
    try {
      const success = Schema.decodeUnknownSync(WorkerSuccess)(await fixture.runExecution());
      const result = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
        success.result.result))).value;
      expect(fixture.bridgeFailures).toEqual([]);
      expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);
      const envelope = await Effect.runPromise(fixture.freeze(result));
      const sealed = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId,
          fixture.activation.anchor.sessionId));
      expect(sealed).toHaveLength(0);
      expect(await Effect.runPromise(await fixture.prepareFrozenPublication(envelope)))
        .toMatchObject({ kind: "published" });
      expect(await fixture.replayPublication()).toMatchObject({ kind: "replayed" });
      expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);
    } finally { await fixture.close(); }
  }, 240_000);

  it("reexecutes both native children and dependent writes with fresh IDs after a whole-root conflict", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, workflow: true,
      suffix: `launch-retry-${driver}`, payloadProfile: "success" });
    try {
      const first = Schema.decodeUnknownSync(WorkerSuccess)(await fixture.runExecution());
      const original = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
        first.result.result))).value;
      const ids = Schema.Struct({ id: Schema.String,
        workflow: Schema.Struct({ pricing: Schema.Struct({
          variants: Schema.Array(Schema.Struct({ id: Schema.String })),
          priceSets: Schema.Array(Schema.Struct({ id: Schema.String,
            prices: Schema.Array(Schema.Struct({ id: Schema.String })) })),
          links: Schema.Array(Schema.Struct({ id: Schema.String,
            variant_id: Schema.String, price_set_id: Schema.String })),
        }), tags: Schema.Array(Schema.Struct({ id: Schema.String })) }),
        final: Schema.Struct({ id: Schema.String }) });
      const old = Schema.decodeUnknownSync(ids)(original);
      await fixture.runStandaloneProductUpdate({ title: `${fixture.seed.newTitle} concurrent`,
        handle: `${fixture.seed.newHandle}-concurrent` });
      if (driver === "postgres") {
        expect(fixture.standaloneProductPgConnections).toHaveLength(1);
        expect(fixture.standaloneProductPgConnections[0]?.standalonePid)
          .not.toBe(fixture.standaloneProductPgConnections[0]?.primaryTargetPid);
      }
      const conflict = await fixture.prepareOccPublication(original)
        .then(publication => Effect.runPromise(publication)).then(() => null, cause => cause);
      expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
      expect(await fixture.retryWholeAttempt(conflict)).toMatchObject({ kind: "published" });
      const freshContext = fixture.retryContexts[0];
      if (freshContext === undefined) throw new Error("Missing fresh retry context");
      expect(freshContext.attemptFence).toBeGreaterThan(fixture.activation.anchor.attemptFence);
      expect(freshContext.snapshotToken.commitSeq).toBeGreaterThan(
        fixture.activation.anchor.snapshotToken.commitSeq);
      const fresh = Schema.decodeUnknownSync(ids)(fixture.retryReturnedValues[0]);
      expect(fresh.id).not.toBe(old.id);
      expect(fresh.workflow.pricing.variants[0]?.id).not.toBe(old.workflow.pricing.variants[0]?.id);
      expect(fresh.workflow.pricing.priceSets[0]?.id).not.toBe(old.workflow.pricing.priceSets[0]?.id);
      expect(fresh.workflow.pricing.priceSets[0]?.prices[0]?.id)
        .not.toBe(old.workflow.pricing.priceSets[0]?.prices[0]?.id);
      expect(fresh.final.id).not.toBe(old.final.id);
      expect(fresh.workflow.pricing.links).toEqual([expect.objectContaining({
        variant_id: fresh.workflow.pricing.variants[0]?.id,
        price_set_id: fresh.workflow.pricing.priceSets[0]?.id,
      })]);
      expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(2);
      expect(fixture.payload?.runtimeHistory).toHaveLength(2);
      expect(fixture.payload?.runtimeHistory.map(runtime => runtime.observations.hookRuns()))
        .toEqual([1, 1]);
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const appTableId = decodeAppDocumentIdentityV1(fresh.id).tableId;
      const committed = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
        .where(and(eq(fxAppRowRevisions.scopeUuid, scopeUuid),
          eq(fxAppRowRevisions.tableId, appTableId)));
      expect(committed).toHaveLength(1);
      expect(encodeBytesToLowercaseHex(committed[0]!.rowId))
        .toBe(decodeAppDocumentIdentityV1(fresh.id).rowId);
      if (committed[0]?.valueBytes == null || committed[0].valueSha256 == null)
        throw new Error("Missing retried productLaunch record");
      const record = await decodeCanonicalFlarexValueEvidenceV1({
        canonicalBytes: committed[0].valueBytes, sha256: committed[0].valueSha256,
        profile: "appDocument" });
      expect(record.value).toMatchObject({ productId: fixture.seed.productId,
        variantId: fresh.workflow.pricing.variants[0]?.id,
        priceSetId: fresh.workflow.pricing.priceSets[0]?.id,
        priceId: fresh.workflow.pricing.priceSets[0]?.prices[0]?.id,
        tagId: fixture.seed.tagId, payloadPostId: fresh.final.id });
      const events = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
      const freshEventGroup = admittedCommerceEventGroup({ scopeUuid,
        sessionId: fixture.activation.anchor.sessionId,
        attemptFence: freshContext.attemptFence });
      expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
      expect(events.filter(event => event.envelope.group === freshEventGroup)).toHaveLength(7);
    } finally { await fixture.close(); }
  }, 240_000);

  it("rolls back after both native children when the workflow callback fails before acknowledgement", async () => {
    let completedChildren = false;
    const fixture = await createMixedMutationProductFixture({ driver, workflow: true,
      suffix: `launch-late-workflow-${driver}`, payloadProfile: "success",
      hooks: { afterNativeBeforeAck: method => method === "workflow:run"
        ? Effect.sync(() => { completedChildren = true; }).pipe(
          Effect.andThen(Effect.fail(commerceError("invalidInput")))) : Effect.void },
    });
    try {
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const before = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
        .where(eq(fxAppRowRevisions.scopeUuid, scopeUuid));
      const outcome = await fixture.runExecution().catch(cause => cause);
      if (!(outcome instanceof Error)) expect(outcome).not.toMatchObject({ kind: "result",
        result: { kind: "success" } });
      expect(completedChildren).toBe(true);
      expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);
      expect(await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
        .where(eq(fxAppRowRevisions.scopeUuid, scopeUuid))).toEqual(before);
      const events = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
      expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
      const roots = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId, fixture.activation.anchor.sessionId));
      expect(roots).toHaveLength(0);
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId,
          fixture.activation.anchor.sessionId));
      expect(receipts).toHaveLength(0);
      await expect(Effect.runPromise(fixture.freeze(null))).rejects.toBeDefined();
    } finally { await fixture.close(); }
  }, 180_000);

  it("keeps the root rollback-only when user code catches a rejected workflow", async () => {
    let completedChildren = false;
    const fixture = await createMixedMutationProductFixture({ driver, workflow: true,
      suffix: `launch-caught-${driver}`, payloadProfile: "success",
      hooks: { afterNativeBeforeAck: method => method === "workflow:run"
        ? Effect.sync(() => { completedChildren = true; }).pipe(
          Effect.andThen(Effect.fail(commerceError("invalidInput")))) : Effect.void },
    });
    try {
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const beforeRows = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
        .where(eq(fxAppRowRevisions.scopeUuid, scopeUuid));
      const source = `export default { productLaunch: { launch: { isMutation: true,
        isPublic: true, _handler: async (ctx) => {
          const id = await ctx.db.insert("productLaunch", {
            productId: ${JSON.stringify(fixture.seed.productId)}, phase: "draft" });
          let caught = false;
          try { await ctx.privateMixed.call("medusa.workflow", "run", {
            product_id: ${JSON.stringify(fixture.seed.productId)},
            tag_id: ${JSON.stringify(fixture.seed.tagId)},
            variant_title: "Launch variant", usd_amount: 50 }); }
          catch { caught = true; }
          await ctx.db.patch(id, { phase: caught ? "caught" : "unexpected" });
          return { caught };
        },
      } } };`;
      const outcome = await fixture.runExecution(source).catch(cause => cause);
      if (!(outcome instanceof Error)) expect(outcome).not.toMatchObject({ kind: "result",
        result: { kind: "success" } });
      expect(completedChildren).toBe(true);
      expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);
      const rows = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
        .where(eq(fxAppRowRevisions.scopeUuid, scopeUuid));
      expect(rows).toEqual(beforeRows);
      const events = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
      expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
      const roots = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId, fixture.activation.anchor.sessionId));
      expect(roots).toHaveLength(0);
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId,
          fixture.activation.anchor.sessionId));
      expect(receipts).toHaveLength(0);
      await expect(Effect.runPromise(fixture.freeze(null))).rejects.toBeDefined();
    } finally { await fixture.close(); }
  }, 180_000);

  it("rolls back native children and Payload work after the final Local API read fails", async () => {
    let reads = 0;
    const fixture = await createMixedMutationProductFixture({ driver, workflow: true,
      suffix: `launch-late-payload-${driver}`, payloadProfile: "success",
      hooks: { afterPayloadBeforeAck: method => {
        if (method !== "payload-findByID" || ++reads !== 2) return Effect.void;
        return Effect.fail(new CmsTransactionError({ reason: "documentInvalid" }));
      } },
    });
    try {
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const before = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
        .where(eq(fxAppRowRevisions.scopeUuid, scopeUuid));
      const outcome = await fixture.runExecution().catch(cause => cause);
      if (!(outcome instanceof Error)) expect(outcome).not.toMatchObject({ kind: "result",
        result: { kind: "success" } });
      expect(reads).toBe(2);
      expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);
      expect(await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
        .where(eq(fxAppRowRevisions.scopeUuid, scopeUuid))).toEqual(before);
      const events = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
      expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
      const roots = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId, fixture.activation.anchor.sessionId));
      expect(roots).toHaveLength(0);
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId,
          fixture.activation.anchor.sessionId));
      expect(receipts).toHaveLength(0);
      await expect(Effect.runPromise(fixture.freeze(null))).rejects.toBeDefined();
    } finally { await fixture.close(); }
  }, 180_000);

  it("settles Application, Product, Pricing, Link and Payload with one retained result and both event families", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, workflow: true,
      suffix: `launch-${driver}`, payloadProfile: "success" });
    try {
      expect(fixture.baseline).toMatchObject({ id: fixture.seed.productId,
        options: [{ values: [{ value: "0" }] }],
        tags: [{ id: fixture.seed.tagId, value: "preview" }], variants: [] });
      const workerd = Schema.decodeUnknownSync(WorkerSuccess)(await fixture.runExecution());
      const returnedValue = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
        workerd.result.result))).value;
      const result = Schema.decodeUnknownSync(Schema.Struct({
        id: Schema.String,
        workflow: Schema.Struct({
          pricing: Schema.Struct({
            variants: Schema.Array(Schema.Struct({ id: Schema.String, product_id: Schema.String })),
            priceSets: Schema.Array(Schema.Struct({ id: Schema.String,
              prices: Schema.Array(Schema.Struct({ id: Schema.String,
                currency_code: Schema.String, amount: Schema.Number,
                price_rules: Schema.Array(Schema.Unknown) })) })),
            links: Schema.Array(Schema.Struct({ id: Schema.String,
              variant_id: Schema.String, price_set_id: Schema.String })),
          }),
          tags: Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.String })),
          product: Schema.Struct({ id: Schema.String, title: Schema.String,
            tags: Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.String })) }),
        }),
        final: Schema.Struct({ id: Schema.String, title: Schema.String }),
      }))(returnedValue);
      expect(result.workflow.pricing.variants).toHaveLength(1);
      expect(result.workflow.pricing.priceSets).toHaveLength(1);
      expect(result.workflow.pricing.priceSets[0]?.prices).toHaveLength(1);
      expect(result.workflow.pricing.priceSets[0]?.prices[0]).toMatchObject({
        currency_code: "USD", amount: 50, price_rules: [] });
      expect(result.workflow.pricing.links).toEqual([expect.objectContaining({
        variant_id: result.workflow.pricing.variants[0]?.id,
        price_set_id: result.workflow.pricing.priceSets[0]?.id })]);
      expect(result.workflow.tags).toEqual([expect.objectContaining({
        id: fixture.seed.tagId, value: "launched" })]);
      expect(result.workflow.product.tags).toContainEqual(expect.objectContaining({
        id: fixture.seed.tagId, value: "launched" }));
      expect(result.workflow.pricing.variants[0]?.product_id).toBe(fixture.seed.productId);
      expect(fixture.getOpenTransactionDepth()).toBe(0);
      expect(fixture.serviceTransactionDepth.every(depth => depth === 0)).toBe(true);
      expect(fixture.pgTransactionObservations.every(observation =>
        observation.openTransactions === 0)).toBe(true);
      const workflowRequest = fixture.getAdmittedRequest("medusa.workflow", "run");
      if (workflowRequest === undefined) throw new Error("Missing authenticated workflow request");
      expect(await Effect.runPromise(fixture.runAdmitted(workflowRequest))).toMatchObject(result.workflow);
      expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);

      const frozen = await Effect.runPromise(fixture.freeze(returnedValue));
      const captured = readFrozenFiniteAttempt(frozen);
      if (captured === undefined) throw new Error("Missing authentic frozen workflow graph");
      const participantOperations = captured.operations.filter(operation => operation.kind === "participant");
      const publication = await fixture.prepareFrozenPublication(frozen);
      const roots = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId, fixture.activation.anchor.sessionId));
      expect(roots).toHaveLength(0);
      expect(await Effect.runPromise(publication)).toMatchObject({ kind: "published" });
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const id = decodeAppDocumentIdentityV1(result.id);
      const launchRows = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
        .where(and(eq(fxAppRowRevisions.scopeUuid, scopeUuid),
          eq(fxAppRowRevisions.tableId, id.tableId),
          eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(id.rowId))));
      const launch = launchRows.at(-1);
      if (launch?.valueBytes == null || launch.valueSha256 == null)
        throw new Error("Missing committed productLaunch document");
      const committedLaunch = await decodeCanonicalFlarexValueEvidenceV1({
        canonicalBytes: launch.valueBytes, sha256: launch.valueSha256, profile: "appDocument" });
      expect(committedLaunch.value).toMatchObject({ productId: fixture.seed.productId,
        phase: "launched", variantId: result.workflow.pricing.variants[0]?.id,
        priceSetId: result.workflow.pricing.priceSets[0]?.id,
        priceId: result.workflow.pricing.priceSets[0]?.prices[0]?.id,
        tagId: fixture.seed.tagId, payloadPostId: result.final.id });

      const revisions = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
        .where(eq(fxAppRowRevisions.scopeUuid, scopeUuid));
      const documents = await Promise.all(revisions.filter(row => row.valueBytes != null &&
        row.valueSha256 != null).map(async row => (await decodeCanonicalFlarexValueEvidenceV1({
          canonicalBytes: row.valueBytes!, sha256: row.valueSha256!, profile: "appDocument",
        })).value));
      expect(documents).toContainEqual(expect.objectContaining({
        id: result.workflow.pricing.links[0]?.id,
        variant_id: result.workflow.pricing.variants[0]?.id,
        price_set_id: result.workflow.pricing.priceSets[0]?.id,
      }));
      expect(await fixture.readCurrentProduct()).toMatchObject({
        id: fixture.seed.productId, title: fixture.seed.newTitle,
        tags: [expect.objectContaining({ id: fixture.seed.tagId, value: "launched" })],
      });
      const workflow = participantOperations.filter(operation =>
        operation.participant === "medusa.workflow");
      expect(workflow).toHaveLength(1);
      expect(workflow[0]?.sourceRefs.map(source => source.sourceKey)).toEqual([
        "medusa.product", "medusa.pricing", "medusa.link.productVariantPriceSet",
      ]);
      expect(workflow[0]?.eventIntents.some(event => event.sourceKey === null &&
        typeof event.intent === "object" && event.intent !== null &&
        "contract" in event.intent && event.intent.contract === "product-tag.updated")).toBe(true);
      const events = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
      const committed = events.filter(event => event.envelope.group === fixture.eventGroup);
      expect(committed).toHaveLength(participantOperations.reduce((count, operation) =>
        count + operation.eventIntents.length, 0));
      const expectedOrderedContracts = participantOperations.flatMap(operation =>
        operation.eventIntents.map(({ intent }) => {
          if (typeof intent !== "object" || intent === null ||
            !("contract" in intent) || typeof intent.contract !== "string")
            throw new Error("Missing admitted event contract in frozen graph");
          return intent.contract;
        }));
      const orderedCommitted = committed.toSorted((left, right) =>
        left.eventOrdinal - right.eventOrdinal);
      expect(orderedCommitted.map(event => event.eventOrdinal))
        .toEqual(expectedOrderedContracts.map((_, ordinal) => ordinal));
      const orderedContracts = orderedCommitted.map(event => event.envelope.contract);
      expect(orderedContracts).toEqual(expectedOrderedContracts);
      const tagModuleOrdinal = orderedContracts.indexOf("product.product-tag.updated");
      expect(tagModuleOrdinal).toBeGreaterThan(0);
      for (const contract of ["product.product-variant.created", "pricing.price-set.created",
        "pricing.price.created", "LinkProductVariantPriceSet.attached"]) {
        const ordinal = orderedContracts.indexOf(contract);
        expect(ordinal).toBeGreaterThanOrEqual(0);
        expect(ordinal).toBeLessThan(tagModuleOrdinal);
      }
      expect(orderedContracts.at(-1)).toBe("product-tag.updated");
      expect(committed.map(event => event.envelope.contract).sort()).toEqual([
        "product.product.updated", "product.product-variant.created", "pricing.price-set.created", "pricing.price.created",
        "LinkProductVariantPriceSet.attached", "product.product-tag.updated", "product-tag.updated",
      ].sort());
    } finally { await fixture.close(); }
  }, 180_000);
});

describe.skipIf(process.env.FLAREX_POSTGRES_DATABASE_URL === undefined)(
  "finite workflow PostgreSQL acknowledgement recovery", () => {
    it("resolves final workflow COMMIT acknowledgement loss without rerunning callbacks", async () => {
      const fixture = await createMixedMutationProductFixture({ driver: "postgres", workflow: true,
        suffix: "launch-driver-commit-loss", payloadProfile: "success" });
      if (fixture.currency.resource.kind !== "postgres") throw new Error("PostgreSQL fixture required");
      try {
        const success = Schema.decodeUnknownSync(WorkerSuccess)(await fixture.runExecution());
        expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);
        const value = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
          success.result.result))).value;
        const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
        const commitsBefore = await fixture.currency.persistence.drizzle.select().from(fxSystemCommits)
          .where(eq(fxSystemCommits.scopeUuid, scopeUuid));
        const publication = await fixture.preparePublication(value);
        const fault = await installOneCommitResponseFault(fixture, commitsBefore.length,
          () => { throw new Error("injected workflow COMMIT acknowledgement loss"); });
        expect(await Effect.runPromise(publication).finally(fault.restore)).toMatchObject({ kind: "replayed" });
        expect(fault.fired()).toBe(true);
        const roots = await fixture.currency.persistence.drizzle.select()
          .from(fxSystemTransactionJournals)
          .where(eq(fxSystemTransactionJournals.sessionId, fixture.activation.anchor.sessionId));
        expect(roots).toHaveLength(0);
        const receipts = await fixture.currency.persistence.drizzle.select()
          .from(fxSystemTransactionJournalReceipts)
          .where(eq(fxSystemTransactionJournalReceipts.sessionId,
            fixture.activation.anchor.sessionId));
        expect(receipts).toHaveLength(0);
        const request = fixture.getAdmittedRequest("medusa.workflow", "run");
        if (request === undefined) throw new Error("Missing workflow request");
        await expect(Effect.runPromise(fixture.runAdmitted(request))).rejects.toBeDefined();
        expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);
        const events = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
          .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
        expect(events.filter(event => event.envelope.group === fixture.eventGroup).length).toBeGreaterThan(0);
        expect(await fixture.replayPublication()).toMatchObject({ kind: "replayed" });
        expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);
      } finally {
        await fixture.close();
      }
    }, 240_000);

    it("recovers final publication after a lost COMMIT response without replaying native children or events", async () => {
      const fixture = await createMixedMutationProductFixture({ driver: "postgres", workflow: true,
        suffix: "launch-publication-commit-loss", payloadProfile: "success" });
      try {
        const success = Schema.decodeUnknownSync(WorkerSuccess)(await fixture.runExecution());
        const returnedValue = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
          success.result.result))).value;
        const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
        const commitsBefore = await fixture.currency.persistence.drizzle.select().from(fxSystemCommits)
          .where(eq(fxSystemCommits.scopeUuid, scopeUuid));
        const publication = await fixture.preparePublication(returnedValue);
        const fault = await installOneCommitResponseFault(fixture, commitsBefore.length,
          () => { throw new Error("injected workflow publication COMMIT response loss"); });
        const first = await Effect.runPromise(publication).finally(fault.restore);
        expect(fault.fired()).toBe(true);
        expect(first.kind).toBe("replayed");
        if (first.kind !== "replayed") throw new Error("Missing recovered publication outcome");
        const commitsAfter = await fixture.currency.persistence.drizzle.select().from(fxSystemCommits)
          .where(eq(fxSystemCommits.scopeUuid, scopeUuid));
        expect(commitsAfter).toHaveLength(commitsBefore.length + 1);
        const events = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
          .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
        const committed = events.filter(event => event.envelope.group === fixture.eventGroup);
        expect(committed).toHaveLength(7);
        const replay = await fixture.replayPublication();
        expect(replay.kind).toBe("replayed");
        if (replay.kind !== "replayed") throw new Error("Missing retained publication replay");
        expect(replay.successfulResult).toEqual(first.successfulResult);
        expect(replay.token).toEqual(first.token);
        expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);
        const afterReplay = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
          .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
        expect(afterReplay.filter(event => event.envelope.group === fixture.eventGroup))
          .toEqual(committed);
      } finally { await fixture.close(); }
    }, 240_000);
  },
);
