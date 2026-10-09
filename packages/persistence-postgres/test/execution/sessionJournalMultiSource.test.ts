import { captureRecoveredAuthorityEffect, verifyCanonicalStoredEvidenceEffect } from "../../../executor/src/mutation/authentication/stored/authenticationVerification";
import { verifyCommitInputStateEffect } from "../../../executor/src/mutation/authentication/stored/commitInputVerification";
import { planPointCommitStateV1 } from "../../../executor/src/mutation/authentication/stored/pointCommitPlanning";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { makeCmsHost } from "../../src/frameworks/cmsTransaction/host";
import { defineCmsCommand } from "../../src/frameworks/cmsTransaction/commands";
import { preparedHostTestRuntime } from "./preparation/preparedHostRuntimeTestSupport";
import { PointCommitCorruptionV1Error, PointCommitConflictV1Error, AppDocumentInsertionConflictError } from "../../src/commit/pointCommitErrors";
import { createHash } from "node:crypto";
import { preparePublicationDefinitions } from "../../src/commit/publication/definitionPreparation";
import { Deferred, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { AppRowIdHexV1Schema, appDocumentIdV1FromRowIdentity, appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import { projectLogicalPointExpectation } from "../../src/storage/documents/logicalDocuments/pointEvidence";
import { makeLogicalDocumentWorkingSet, type LogicalDocumentChanges } from "../../src/storage/documents/logicalDocuments/workingSet";
import { makeBoundedRequestLifetime } from "../../src/execution/preparation/boundedRequestLifetime";
import { fxSystemTransactionJournalPoints, fxSystemTransactionJournalReceipts, fxAppRowCurrent, fxAppRowRevisions,
  fxAppIndexEntryCurrent, fxAppIndexEntryRevisions, fxAppUniqueKeys, fxSystemCommits, fxSystemIdempotency, fxSystemScopeClocks,
  fxSystemTransactionJournals, fxSystemSnapshotLeases, fxSystemTransactionSessions, fxSystemTransactionJournalWriteEvents, fxSystemCommitAppRowChanges, fxSystemCommitWakes } from "../../src/database/schema";
import { logicalCurrencyFixture } from "../../../medusa-adapter/test/support/logical-currency-fixture";
import { prepareLogicalStorageReadiness } from "../../src/storage/catalog/logicalStorageReadiness";
import { prepareLogicalSourceEvidence } from "../../src/storage/documents/logicalDocuments/sourceAdmission";
import { authenticatedGeneratedInsertionsResult } from "flarex-protocol/commit-protocol";
import { LogicalParticipantInvocationError, type LogicalParticipantAttemptReadTransaction } from "../../src/storage/documents/logicalDocuments/participantAdmission";
import { CommitSyscallSequenceV1Schema, canonicalizeSessionJournalEffect,
  canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { encodeAdmittedFrameworkOperationV1Result } from
  "flarex-protocol/internal/admitted-framework-operation-v1";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { selectApplicationMutationAdmission } from "../../src/application/applicationMutationAdmission";
import { createApplicationMutationSessionActivationPersistenceV1 } from "../../src/execution/transactionSessionActivation";
import { createSessionJournalStorePersistence } from "../../src/execution/sessionJournalStore";
import { issueLogicalParticipantAttemptAdmission, issueLogicalParticipantCommitAuthority,
  LogicalParticipantAdmissionError,
  type LogicalParticipantSelection } from "../../src/storage/documents/logicalDocuments/participantAdmission";
import { createStoredAttemptEvidenceLoaderV1 } from "../../src/execution/storedAttemptEvidence";
import { createPointCommitFinishingTransitionPortV1, createPointCommitPublisherPortV1 } from
  "../../src/commit/pointCommitTransaction";
import { pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1,
  pointCommitScalarCommandForLifecycleFromStoredAttemptV1, pointCommitFinishingCommandFromStoredAttemptV1 } from "../commit/pointCommitTransactionTestSupport";
import { createApplicationNativeMutationPGliteFixtureWithPersistence,
  createApplicationNativeMutationPostgresFixture } from
  "../application/applicationNativeMutationTestFixture";
import { applicationMutationActivationFixture } from "../application/applicationMutationActivationFixture";
import { TEST_GRANT_RETENTION_POLICY_V1 } from "./transactionSessionActivationTestSupport";
import { createPGlitePersistence } from "../../src/database/pglite";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { createFileScopedPostgresFixture, postgresUrl } from "../support/postgresHelpers";

const emptyChanges = Object.freeze({ changes: [], attempts: [], lifecycle: [], observedRows: [],
  noFinalRows: [], dependencies: [], scans: [], uniqueReads: [], indexReads: [], pageReads: [],
  searchReads: [], setNull: [], referenceReplacements: [] });

async function sourceBundleFixture(driver: "pglite" | "postgres", options: { runtimeHostIdentity: string; compatibilityDate: string }) {
  return await (async () => {
      if (driver === "postgres") {
        const control = await createFileScopedPostgresFixture();
        const target = await createFileScopedPostgresFixture();
        return { fixture: await createApplicationNativeMutationPostgresFixture({ ...options,
          physicalLocator: { kind: "database_per_scope", databaseKey: "application_native_mutation_target", schemaName: target.schemaName } },
          { control: control.persistence, target: target.persistence }),
        close: async () => { await target.dispose(); await control.dispose(); } };
      }
      const controlDb = newTestPGlite();
      const targetDb = newTestPGlite();
      const [control, target] = await Promise.all([
        createPGlitePersistence({ db: controlDb }), createPGlitePersistence({ db: targetDb }),
      ]);
      await Promise.all([control.migrate(), target.migrate()]);
      return { fixture: await createApplicationNativeMutationPGliteFixtureWithPersistence(
        options, { control, target }),
      close: async () => { await controlDb.close(); await targetDb.close(); } };
    })();
}

describe("neutral admitted operation source bundle", () => {
  for (const driver of ["pglite", "postgres"] as const) {
  it.skipIf(driver === "postgres" && postgresUrl === null)(
    `keeps three sources in one receipt, seal, and commit on ${driver}`, async () => {
    const options = {
      runtimeHostIdentity: "flarex.test/neutral-mixed-journal", compatibilityDate: "2026-09-27",
    };
    const resources = await sourceBundleFixture(driver, options);
    const { fixture } = resources;
    try {
      const active = await Effect.runPromise(fixture.activation.readActive());
      const app = await Effect.runPromise(selectApplicationMutationAdmission(active.selection, "users:create", {
        deploymentId: fixture.deploymentId, controlDb: fixture.control.drizzle,
        authority: fixture.authorityPorts, schema: fixture.schema,
      }));
      const activationInput = await applicationMutationActivationFixture({
        deploymentId: fixture.deploymentId, selection: active.selection,
        executionAuthority: app.executionAuthority, requestKey: "neutral-three-source-journal",
        grantId: "neutral-three-source-grant",
      });
      const activated = await Effect.runPromise(createApplicationMutationSessionActivationPersistenceV1(
        fixture.sessionAuthority, { leaseDurationMilliseconds: 60_000 }).activateEffect(activationInput));
      if (activated.status !== "created") throw new Error("Expected fresh attempt");
      const store = createSessionJournalStorePersistence(fixture.sessionAuthority,
        { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 });
      const attempt = await Effect.runPromise(store.openAttemptEffect({
        selector: { deploymentId: activated.anchor.deploymentId, scopeId: activated.anchor.scopeId,
          sessionId: activated.anchor.sessionId, attemptFence: activated.anchor.attemptFence },
        snapshotToken: activated.anchor.snapshotToken,
        schemaVersionId: fixture.active.basis.schemaVersionId,
        executionClaim: activated.executionClaim,
      }));
      const currentHeads = ["1", "1", "1"];
      const checks = [0, 0, 0];
      const sources = [0, 1, 2].map(index => {
        const sourceKey = `neutral.source.${index}`;
        const pinnedHead = Object.freeze({ sequence: "1", sha256: `${index + 1}`.repeat(64) });
        const selection: LogicalParticipantSelection = {
          bindAttemptEffect: (_application, selectedAttempt, root, readTransaction, methods) => Effect.sync(() =>
            issueLogicalParticipantAttemptAdmission({ preparedSource: selection, attempt: selectedAttempt, root, readTransaction,
              methods: new Set(methods), verifyBinding: () => {
                checks[index] = checks[index]! + 1;
                return currentHeads[index] === pinnedHead.sequence ? Effect.void :
                  Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
              },
              sourceKey, sourceSha256: `${index + 4}`.repeat(64), head: pinnedHead,
              tableIds: new Set([decodeCatalogTableId(100 + index)]), indexes: [], unique: [],
            })),
        };
        return Object.freeze({ selection, application: active.selection, methods: [`call-${index}`] });
      });
      const revision = "a".repeat(64);
      const bundle = await Effect.runPromise(store.admitLogicalParticipantsEffect(attempt, {
        participant: "neutral.workflow", operationMethods: ["run"], profileRevision: revision, sources,
      }));
      const encoded = Result.match(encodeAdmittedFrameworkOperationV1Result({
        format: "flarex.admitted-framework-operation", version: 1,
        participant: "neutral.workflow", operation: "run", args: { marker: "three sources" },
      }), { onFailure: cause => { throw cause; }, onSuccess: value => value });
      const request = { syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
        requestBytes: encoded.bytes, requestSha256: new Uint8Array(createHash("sha256").update(encoded.bytes).digest()),
        participant: "neutral.workflow", method: "run", profileRevision: revision };
      let invocations = 0;
      const borrow = () => Effect.succeed(Object.freeze({
        invoke: () => Effect.sync(() => {
          invocations += 1;
          return Object.freeze({ result: { completed: true }, changes: emptyChanges,
            eventIntents: [], workBytes: 1, workCalls: 1 });
        }),
        abort: Effect.void,
        currentUsage: () => Object.freeze({ workBytes: 1, workCalls: 1 }),
      }));
      await expect(Effect.runPromise(store.runAdmittedOperationEffect(attempt, bundle,
        { ...request, profileRevision: "b".repeat(64) }, borrow))).rejects.toBeDefined();
      await expect(Effect.runPromise(store.runAdmittedOperationEffect(attempt, bundle,
        { ...request, method: "other" }, borrow))).rejects.toBeDefined();
      expect(invocations).toBe(0);
      const completed = await Effect.runPromise(store.runAdmittedOperationEffect(attempt, bundle, request, borrow));
      expect(completed).toMatchObject({ kind: "completed", delivery: "executed", result: { completed: true } });
      expect(invocations).toBe(1);
      expect(checks.every(count => count > 0)).toBe(true);
      const receipt = await fixture.target.query<{ count: number }>(
        `select count(*)::int as count from fx_system_tx_journal_receipt where session_id = $1`,
        [activated.anchor.sessionId]);
      expect(receipt.rows[0]?.count).toBe(1);
      const replay = await Effect.runPromise(store.runAdmittedOperationEffect(attempt, bundle, request, borrow));
      expect(replay).toMatchObject({ kind: "completed", delivery: "replayed" });
      expect(invocations).toBe(1);
      const checksBeforeNextTransaction = [...checks];
      currentHeads[1] = "2";
      await expect(Effect.runPromise(store.runAdmittedOperationEffect(attempt, bundle,
        { ...request, syscallSequence: CommitSyscallSequenceV1Schema.make(2n) }, borrow)))
        .rejects.toBeDefined();
      expect(invocations).toBe(1);
      expect(checks[1]).toBeGreaterThan(checksBeforeNextTransaction[1]!);
      currentHeads[1] = "1";
      const prepared = await Effect.runPromise(store.prepareSealEffect(attempt));
      expect(prepared.journal.participantOperations[0]?.sourceContributions.map(source => source.sourceKey))
        .toEqual(["neutral.source.0", "neutral.source.1", "neutral.source.2"]);
      const canonical = await Effect.runPromise(canonicalizeSessionJournalEffect(prepared.journal));
      const successful = await Effect.runPromise(canonicalizeSuccessfulResultV1Effect({ completed: true }));
      const sealed = await Effect.runPromise(store.completeSealEffect(prepared.preparation, canonical, successful));
      expect(sealed).toMatchObject({ sessionId: activated.anchor.sessionId,
        finalSyscallSequence: 1n, journalSha256Hex: canonical.sha256Hex });
      const authority = { deploymentId: activated.anchor.deploymentId,
        scopeId: activated.anchor.scopeId, sessionId: activated.anchor.sessionId,
        attemptFence: activated.anchor.attemptFence,
        storageGeneration: activated.anchor.storageGeneration,
        storageGenerationFence: activated.anchor.storageGenerationFence,
        snapshotToken: activated.anchor.snapshotToken,
        schemaVersionId: fixture.active.basis.schemaVersionId,
        executionClaim: activated.executionClaim };
      const loader = createStoredAttemptEvidenceLoaderV1(fixture.sessionAuthority);
      const running = await Effect.runPromise(loader.loadEffect(authority));
      if (running.kind !== "loaded") throw new Error("Expected running sealed evidence");
      await Effect.runPromise(createPointCommitFinishingTransitionPortV1(fixture.sessionAuthority)
        .enterFinishing(await pointCommitFinishingCommandFromStoredAttemptV1(authority, running.evidence)));
      const finishing = await Effect.runPromise(loader.loadFinishingEffect({
        deploymentId: activated.anchor.deploymentId, scopeId: activated.anchor.scopeId,
        sessionId: activated.anchor.sessionId, attemptFence: activated.anchor.attemptFence,
      }));
      if (finishing.kind !== "loaded") throw new Error("Expected finishing evidence");
      const command = await pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1(
        authority, finishing.evidence);
      const sourceDefinitions = preparePublicationDefinitions([], []);
      const sourceAuthorities = [0, 1, 2].map(index => issueLogicalParticipantCommitAuthority({
        publicationDefinitions: sourceDefinitions,
        participant: "neutral.workflow", methods: new Set([`call-${index}`]),
        sourceKey: `neutral.source.${index}`, sourceSha256: `${index + 4}`.repeat(64),
        schemaVersionId: fixture.active.basis.schemaVersionId,
        tableIds: new Set([decodeCatalogTableId(100 + index)]),
        search: [], validateDocument: () => Result.succeed(undefined),
        verify: (_operation, contribution) =>
          currentHeads[index] === contribution.bindingHead.sequence ? Effect.void :
            Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" })),
      }));
      const profile = { participant: "neutral.workflow", operationMethods: ["run"],
        profileRevision: revision, sources: sourceAuthorities };
      const publisher = (profiles: typeof profile[]) => createPointCommitPublisherPortV1(
        fixture.sessionAuthority, { logicalOperationProfiles: profiles,
          intrinsicCreationTimeIndexes: fixture.intrinsicCreationTimeIndexes,
          developerIndexes: fixture.developerIndexes });
      const publicationCommand = { ...command, successfulResult: {
        valueCodecVersion: successful.evidence.valueCodecVersion, value: successful.valueJson,
        canonicalBytes: successful.canonicalBytes, semanticSizeBytes: successful.semanticSizeBytes,
        sha256Hex: successful.evidence.sha256Hex,
      } };
      await expect(Effect.runPromise(publisher([{ ...profile, profileRevision: "b".repeat(64) }])
        .publish(publicationCommand))).rejects.toBeDefined();
      await expect(Effect.runPromise(publisher([{ ...profile, sources: sourceAuthorities.slice(0, 2) }])
        .publish(publicationCommand))).rejects.toBeDefined();
      await expect(Effect.runPromise(publisher([{ ...profile, sources: [...sourceAuthorities].reverse() }])
        .publish(publicationCommand))).rejects.toBeDefined();
      const verifiedOrder: number[] = [];
      let refuseNeutral = true;
      const mixedAuthorities = [0, 1, 2].map(index => issueLogicalParticipantCommitAuthority({
        publicationDefinitions: sourceDefinitions,
        participant: "neutral.workflow", methods: new Set([`call-${index}`]),
        sourceKey: `neutral.source.${index}`, sourceSha256: `${index + 4}`.repeat(64),
        schemaVersionId: fixture.active.basis.schemaVersionId,
        tableIds: new Set([decodeCatalogTableId(100 + index)]), search: [],
        validateDocument: () => Result.succeed(undefined),
        ...(index !== 1 ? {} : { application: active.selection,
          projectApplicationFailure: (cause: unknown) => new LogicalParticipantAdmissionError({ reason: "invalidAuthority", cause }) }),
        verify: (_operation, _contribution, _tx, _authority, _clock, borrowed) => Effect.gen(function* () {
          verifiedOrder.push(index);
          if (index === 0 && refuseNeutral) return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
          if (index === 1) expect(borrowed).toBeDefined();
        }),
      }));
      const mixed = publisher([{ ...profile, sources: mixedAuthorities }]);
      await expect(Effect.runPromise(mixed.prove(command))).rejects.toBeDefined();
      expect(verifiedOrder).toEqual([0]);
      refuseNeutral = false;
      verifiedOrder.length = 0;
      await expect(Effect.runPromise(mixed.prove(command))).resolves.toMatchObject({ kind: "wouldCommit" });
      expect(verifiedOrder).toEqual([0, 1, 2]);
      const trusted = publisher([profile]);
      await expect(Effect.runPromise(trusted.prove(command))).resolves.toMatchObject({ kind: "wouldCommit" });
      await expect(Effect.runPromise(trusted.publish(publicationCommand)))
        .resolves.toMatchObject({ kind: "published" });

      // Reserved finite-entry authority is covered by the genuine owner in
      // finiteApplicationBindingCorrelation.test.ts; unreserved legacy roots are retired.
      // Preparation follows a durable invocation marker. Interruption must
      // settle that marker before joining, without running the native command.
      const interruptedInput = await applicationMutationActivationFixture({
        deploymentId: fixture.deploymentId, selection: active.selection,
        executionAuthority: app.executionAuthority, requestKey: "neutral-preparation-interrupted",
        grantId: "neutral-preparation-interrupted-grant",
      });
      const interruptedActivation = await Effect.runPromise(createApplicationMutationSessionActivationPersistenceV1(
        fixture.sessionAuthority, { leaseDurationMilliseconds: 60_000 }).activateEffect(interruptedInput));
      if (interruptedActivation.status !== "created") throw new Error("Expected fresh interrupted attempt");
      const interruptedAttempt = await Effect.runPromise(store.openAttemptEffect({
        selector: { deploymentId: interruptedActivation.anchor.deploymentId,
          scopeId: interruptedActivation.anchor.scopeId,
          sessionId: interruptedActivation.anchor.sessionId,
          attemptFence: interruptedActivation.anchor.attemptFence },
        snapshotToken: interruptedActivation.anchor.snapshotToken,
        schemaVersionId: fixture.active.basis.schemaVersionId,
        executionClaim: interruptedActivation.executionClaim,
      }));
      const interruptedBundle = await Effect.runPromise(store.admitLogicalParticipantsEffect(
        interruptedAttempt, { participant: "neutral.workflow", operationMethods: ["run"],
          profileRevision: revision, sources }));
      const preparationEntered = Deferred.makeUnsafe<void>();
      const releasePreparation = Deferred.makeUnsafe<void>();
      let interruptedInvocations = 0;
      const interruptedBorrow = () => Deferred.succeed(preparationEntered, undefined).pipe(
        Effect.andThen(Deferred.await(releasePreparation)),
        Effect.map(() => Object.freeze({
          invoke: () => Effect.sync(() => {
            interruptedInvocations += 1;
            return Object.freeze({ result: { unexpected: true }, changes: emptyChanges,
              eventIntents: [], workBytes: 1, workCalls: 1 });
          }),
          abort: Effect.void,
          currentUsage: () => Object.freeze({ workBytes: 0, workCalls: 0 }),
        })),
      );
      const interruptedFiber = Effect.runFork(store.runAdmittedOperationEffect(
        interruptedAttempt, interruptedBundle, request, interruptedBorrow));
      await Effect.runPromise(Deferred.await(preparationEntered).pipe(Effect.timeout(5_000)));
      const invoking = await fixture.target.query<{ state: string }>(
        `select state from fx_system_tx_journal where session_id = $1`,
        [interruptedActivation.anchor.sessionId]);
      expect(invoking.rows).toEqual([{ state: "operation_invoking" }]);
      let interruptedExit: Exit.Exit<unknown, unknown>;
      try {
        interruptedExit = await Effect.runPromise(Fiber.interrupt(interruptedFiber).pipe(
          Effect.andThen(Fiber.await(interruptedFiber)), Effect.timeout(5_000)));
      } finally {
        await Effect.runPromise(Deferred.succeed(releasePreparation, undefined));
      }
      expect(Exit.isFailure(interruptedExit)).toBe(true);
      expect(interruptedInvocations).toBe(0);
      const poisoned = await fixture.target.query<{ state: string }>(
        `select state from fx_system_tx_journal where session_id = $1`,
        [interruptedActivation.anchor.sessionId]);
      expect(poisoned.rows).toEqual([{ state: "operation_failed" }]);
      const failedReceipt = await fixture.target.query<{ outcome_kind: string }>(
        `select outcome_kind from fx_system_tx_journal_receipt where session_id = $1`,
        [interruptedActivation.anchor.sessionId]);
      expect(failedReceipt.rows).toEqual([{ outcome_kind: "admittedLogicalError" }]);
      const partialRows = await fixture.target.query<{ point_count: number; event_count: number }>(
        `select (select count(*)::int from fx_system_tx_journal_point where session_id = $1) as point_count,
          (select count(*)::int from fx_system_tx_journal_write_event where session_id = $1) as event_count`,
        [interruptedActivation.anchor.sessionId]);
      expect(partialRows.rows).toEqual([{ point_count: 0, event_count: 0 }]);
      await expect(Effect.runPromise(store.runAdmittedOperationEffect(interruptedAttempt,
        interruptedBundle, request, interruptedBorrow)))
        .resolves.toMatchObject({ kind: "stateRejected", issue: { reason: "journalFailed" } });
      expect(interruptedInvocations).toBe(0);
    } finally {
      await resources.close();
    }
  }, 120_000);

  const insertionCases = [
    ...[false, true].flatMap(priorRead => [false, true].map(netDeleted => ({ priorRead, netDeleted, collision: undefined }))),
    ...(["live", "tombstone"] as const).flatMap(kind => (["before", "after"] as const).map(timing =>
      ({ priorRead: false, netDeleted: true, collision: { kind, timing } }))),
    ...(["live", "tombstone"] as const).map(kind => ({ priorRead: true, netDeleted: true,
      collision: { kind, timing: "after" as const } })),
  ];
  for (const { priorRead, netDeleted, collision } of insertionCases) it.skipIf(driver === "postgres" && postgresUrl === null)(
    `retains authenticated generated insertion and same-ID read ${priorRead}, net deleted ${netDeleted}, collision ${collision === undefined ? "none" : `${collision.kind}-${collision.timing}`} on ${driver}`, async () => {
    const cleanup: Array<() => Promise<void>> = [];
    const logicalFixture = await logicalCurrencyFixture(driver, close => cleanup.push(close));
    const fixture = logicalFixture.application;
    try {
      const active = await Effect.runPromise(fixture.activation.readActive());
      const app = await Effect.runPromise(selectApplicationMutationAdmission(active.selection, "users:create", {
        deploymentId: fixture.deploymentId, controlDb: fixture.control.drizzle,
        authority: fixture.authorityPorts, schema: fixture.schema,
      }));
      const logical = logicalFixture.hostInput.logicalStorage;
      const location = { deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
        schemaVersionId: logicalFixture.schemaVersionId };
      const catalog = await Effect.runPromise(prepareLogicalStorageReadiness(logical.ports, logical.unique, location));
      if (catalog.status !== "prepared") throw new Error("Expected activated logical catalog");
      const sourceDefinition = catalog.requirements.evidence.candidate.sources.find(source => source.owner === "payload");
      if (sourceDefinition?.definition.kind !== "documents") throw new Error("Expected actual compiled Payload document source");
      const selectedSource = await Effect.runPromise(prepareLogicalSourceEvidence(logical.ports, logical.unique, location,
        { sourceKey: sourceDefinition.key, writeProfile: sourceDefinition.writeProfile,
          definition: sourceDefinition.definition, evidence: sourceDefinition.evidence },
        "payload", "documents", { kind: "prepared", catalog }));
      const table = selectedSource.tables.find(member => member.localName === "news");
      if (table === undefined) throw new Error("Expected actual news table");
      const tableId = table.tableId;
      const rowId = AppRowIdHexV1Schema.make("c1000000000000000000000000000001");
      const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
      const seedCollision = async () => {
        if (collision === undefined) throw new Error("Expected selected collision seed");
        const compiled = await Effect.runPromise(compilePayloadCollections([{ slug: "news", fields: [
          { name: "title", type: "text", required: true, unique: true },
        ] }]));
        const insertSeed = defineCmsCommand({ name: "seedInsertionCollision", mode: "write", run: ctx =>
          ctx.documents.insert(ctx.context, ctx.transactionId, "news", { title: "collision-seed",
            createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z" }) });
        const deleteSeed = defineCmsCommand({ name: "deleteInsertionCollision", mode: "write", run: ctx =>
          ctx.documents.delete(ctx.context, ctx.transactionId, documentId).pipe(Effect.as(null)) });
        const host = await Effect.runPromise(makeCmsHost({ hostRuntime: preparedHostTestRuntime(fixture.target.drizzle),
          database: fixture.target.drizzle, controlDatabase: fixture.control.drizzle, session: logicalFixture.session,
          deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId, authority: fixture.authorityPorts,
          application: fixture.activation, commands: [insertSeed, deleteSeed], identityAndAccessPolicy: { profile: "collision-seed" },
          materialization: {}, expectedContentIdentity: compiled.contentIdentity,
          logicalStorage: { ports: { controlDb: fixture.control.drizzle, authority: fixture.authorityPorts },
            unique: fixture.uniqueConstraintEligibility, schemaVersionId: logicalFixture.schemaVersionId,
            source: compiled.sourceContract } }));
        try {
          const rng = vi.spyOn(crypto, "getRandomValues").mockImplementation(input => {
            if (input instanceof Uint8Array && input.byteLength === 16) {
              input.set(Uint8Array.from(Buffer.from(rowId, "hex"))); return input;
            }
            throw new Error("Unexpected random request during genuine collision seed");
          });
          let inserted: unknown;
          try { inserted = await Effect.runPromise(host.run(host.newRequestKey(), insertSeed, null)); }
          finally { rng.mockRestore(); }
          expect(inserted).toMatchObject({ _id: documentId, title: "collision-seed" });
          if (collision.kind === "tombstone") await Effect.runPromise(host.run(host.newRequestKey(), deleteSeed, null));
          const revisions = await fixture.target.drizzle.select().from(fxAppRowRevisions).where(and(
            eq(fxAppRowRevisions.tableId, tableId), eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(rowId)))).orderBy(fxAppRowRevisions.commitSeq);
          expect(revisions).toHaveLength(collision.kind === "tombstone" ? 2 : 1);
          expect(revisions.at(-1)?.isTombstone).toBe(collision.kind === "tombstone");
          const latest = revisions.at(-1);
          if (latest === undefined) throw new Error("Expected actual seed publication revision");
          const current = await fixture.target.drizzle.select().from(fxAppRowCurrent).where(and(
            eq(fxAppRowCurrent.scopeUuid, latest.scopeUuid), eq(fxAppRowCurrent.tableId, tableId),
            eq(fxAppRowCurrent.rowId, appRowIdHexV1ToBytes(rowId))));
          expect(current).toHaveLength(1);
          expect(current[0]?.commitSeq).toBe(latest.commitSeq);
          const commits = await fixture.target.drizzle.select().from(fxSystemCommits).where(and(
            eq(fxSystemCommits.scopeUuid, latest.scopeUuid), eq(fxSystemCommits.commitSeq, latest.commitSeq)));
          expect(commits).toHaveLength(1);
          const indexes = await fixture.target.drizzle.select().from(fxAppIndexEntryCurrent)
            .where(eq(fxAppIndexEntryCurrent.rowId, appRowIdHexV1ToBytes(rowId)));
          const claims = await fixture.target.drizzle.select().from(fxAppUniqueKeys)
            .where(eq(fxAppUniqueKeys.rowId, appRowIdHexV1ToBytes(rowId)));
          expect(indexes).toHaveLength(collision.kind === "tombstone" ? 0 : 2);
          expect(claims).toHaveLength(collision.kind === "tombstone" ? 0 : 1);
        } finally { await Effect.runPromise(host.close); }
      };
      if (collision?.timing === "before") await seedCollision();
      const activationInput = await applicationMutationActivationFixture({ deploymentId: fixture.deploymentId,
        selection: active.selection, executionAuthority: app.executionAuthority,
        requestKey: "generated-insertion-journal", grantId: "generated-insertion-grant" });
      const activated = await Effect.runPromise(createApplicationMutationSessionActivationPersistenceV1(
        fixture.sessionAuthority, { leaseDurationMilliseconds: 60_000 }).activateEffect(activationInput));
      if (activated.status !== "created") throw new Error("Expected fresh attempt");
      const store = createSessionJournalStorePersistence(fixture.sessionAuthority,
        { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 });
      const attempt = await Effect.runPromise(store.openAttemptEffect({
        selector: { deploymentId: activated.anchor.deploymentId, scopeId: activated.anchor.scopeId,
          sessionId: activated.anchor.sessionId, attemptFence: activated.anchor.attemptFence },
        snapshotToken: activated.anchor.snapshotToken, schemaVersionId: fixture.active.basis.schemaVersionId,
        executionClaim: activated.executionClaim,
      }));
      let readTransaction: LogicalParticipantAttemptReadTransaction | undefined;
      const projectSourceFailure = (cause: unknown) => new LogicalParticipantAdmissionError({ reason: "invalidAuthority", cause });
      const selection: LogicalParticipantSelection = {
        bindAttemptEffect: (application, selectedAttempt, root, checkedRead, methods) => Effect.gen(function* () {
          readTransaction = checkedRead;
          const head = yield* checkedRead((tx, authority, clock) => selectedSource.withBinding(application, tx, authority,
            clock, binding => Effect.succeed(binding.head))).pipe(Effect.mapError(projectSourceFailure));
          const verifyBinding = (tx: Parameters<typeof selectedSource.withBinding>[1],
            authority: Parameters<typeof selectedSource.withBinding>[2], clock: Parameters<typeof selectedSource.withBinding>[3]) =>
            selectedSource.withBinding(application, tx, authority, clock, binding => binding.head.sequence === head.sequence &&
              binding.head.sha256 === head.sha256 ? Effect.void : Effect.fail(projectSourceFailure("binding changed")))
              .pipe(Effect.mapError(projectSourceFailure));
          return issueLogicalParticipantAttemptAdmission({ preparedSource: selection, attempt: selectedAttempt,
            root, readTransaction: checkedRead, methods: new Set(methods), verifyBinding,
            sourceKey: selectedSource.source.key, sourceSha256: selectedSource.source.sourceSha256,
            head, tableIds: new Set([tableId]), indexes: selectedSource.indexes, unique: selectedSource.unique });
        }),
      };
      const revision = "a".repeat(64);
      const bundle = await Effect.runPromise(store.admitLogicalParticipantsEffect(attempt, {
        participant: "neutral.generated", operationMethods: ["read", "insert", "patch", "delete"], profileRevision: revision,
        sources: [{ selection, application: active.selection, methods: ["read", "insert", "patch", "delete"] }],
      }));
      const readBefore = async () => fixture.target.drizzle.select().from(fxSystemTransactionJournalPoints)
        .where(eq(fxSystemTransactionJournalPoints.sessionId, activated.anchor.sessionId));
      let finalChanges: LogicalDocumentChanges | undefined;
      let sequence = 1n;
      const invoke = async (operation: "read" | "insert" | "patch" | "delete") => {
        const encoded = Result.getOrThrow(encodeAdmittedFrameworkOperationV1Result({
          format: "flarex.admitted-framework-operation", version: 1,
          participant: "neutral.generated", operation, args: {},
        }));
        return Effect.runPromise(store.runAdmittedOperationEffect(attempt, bundle, {
          syscallSequence: CommitSyscallSequenceV1Schema.make(sequence++), requestBytes: encoded.bytes,
          requestSha256: new Uint8Array(createHash("sha256").update(encoded.bytes).digest()),
          participant: "neutral.generated", method: operation, profileRevision: revision,
        }, borrowed => {
          const checkedRead = readTransaction;
          if (checkedRead === undefined || borrowed.pendingRows === undefined)
            return Effect.fail(new LogicalParticipantInvocationError({ kind: "infrastructure", cause: "Expected durable admitted read owner" }));
          const error = (reason: string, cause?: unknown) => new LogicalParticipantInvocationError({
            kind: "infrastructure", cause: { reason, cause } });
          return Effect.succeed({ abort: Effect.void, currentUsage: () => ({ workBytes: 1, workCalls: 1 }),
            invoke: () => Effect.scoped(Effect.gen(function* () {
              const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(error,
                { calls: 16, commandBytes: 262_144, commandMs: 60_000 }, {}, {}, "generated-journal", "write"), value => value.close);
              const working = yield* checkedRead((tx, _authority, clock) => makeLogicalDocumentWorkingSet({
                scopeId: clock.scopeId, clock, lifetime,
                readTransaction: work => checkedRead(tx => work(tx)).pipe(Effect.mapError(cause => error("invalidAuthority", cause))),
                snapshotCommitSeq: activated.anchor.snapshotToken.commitSeq,
                tables: [{ tableId, logicalName: "news" }], pendingRows: borrowed.pendingRows,
                requireAdmission: checkedRead(() => Effect.void).pipe(Effect.mapError(cause => error("invalidAuthority", cause))),
                validateDocument: () => Effect.void, error, uniqueConflict: () => error("uniqueConflict"),
                limits: { pageRows: 8, identities: 8, documentBytes: 65_536 },
              }, AppCreationTimeV1Schema.make(1), selectedSource.unique, selectedSource.indexes, undefined, tx));
              const transactionId = yield* lifetime.begin(lifetime.context);
              if (operation === "insert") {
                const rng = vi.spyOn(crypto, "getRandomValues").mockImplementation(input => {
                  if (input instanceof Uint8Array && input.byteLength === 16) {
                    input.set(Uint8Array.from(Buffer.from(rowId, "hex"))); return input;
                  }
                  throw new Error("Unexpected random request during generated insertion");
                });
                yield* working.documents.insert(lifetime.context, transactionId, "news", { title: "first" })
                  .pipe(Effect.ensuring(Effect.sync(() => rng.mockRestore())));
              } else if (operation === "patch") yield* working.documents.patch(lifetime.context, transactionId, documentId, { title: "second" }, "news");
              else if (operation === "delete") yield* working.documents.delete(lifetime.context, transactionId, documentId, "news");
              else expect(yield* working.documents.get(lifetime.context, transactionId, documentId, "news")).toBeNull();
              yield* lifetime.seal;
              const changes = yield* working.close();
              finalChanges = changes;
              return { result: { id: documentId }, changes,
                eventIntents: [], workBytes: 1, workCalls: 1 };
            })).pipe(Effect.mapError(cause => cause instanceof LogicalParticipantInvocationError ? cause : error("admission", cause))),
          });
        }));
      };
      if (priorRead) expect(await invoke("read")).toMatchObject({ kind: "completed", delivery: "executed" });
      const originalPoints = await readBefore();
      expect(await invoke("insert")).toMatchObject({ kind: "completed", delivery: "executed" });
      const afterInsert = await readBefore();
      expect(afterInsert).toHaveLength(1);
      expect(afterInsert[0]).toMatchObject({ dependencyKind: priorRead ? "missing_no_visible_revision" : "generated_insertion", dependencyRevisionCommitSeq: null });
      if (priorRead) expect(afterInsert[0]).toMatchObject({ dependencyKind: originalPoints[0]?.dependencyKind,
        dependencyRevisionCommitSeq: originalPoints[0]?.dependencyRevisionCommitSeq, createdAt: originalPoints[0]?.createdAt });
      expect(await invoke("patch")).toMatchObject({ kind: "completed", delivery: "executed" });
      if (netDeleted) expect(await invoke("delete")).toMatchObject({ kind: "completed", delivery: "executed" });
      const prepared = await Effect.runPromise(store.prepareSealEffect(attempt));
      expect(prepared.journal.readDependencies.filter(point => point.kind === "appRowPoint"))
        .toHaveLength(priorRead ? 1 : 0);
      const origins = Result.getOrThrow(authenticatedGeneratedInsertionsResult(prepared.journal.participantOperations));
      expect(origins.size).toBe(1);
      expect(origins.get(documentId)).toMatchObject({ tableId, rowId, effectOrdinal: 0,
        origin: { syscallSequence: priorRead ? 2n : 1n } });
      expect(prepared.journal.participantOperations).toHaveLength((priorRead ? 3 : 2) + (netDeleted ? 1 : 0));
      const canonical = await Effect.runPromise(canonicalizeSessionJournalEffect(prepared.journal));
      const successful = await Effect.runPromise(canonicalizeSuccessfulResultV1Effect({ id: documentId }));
      await Effect.runPromise(store.completeSealEffect(prepared.preparation, canonical, successful));
      const receipts = await fixture.target.drizzle.select().from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId, activated.anchor.sessionId));
      expect(receipts).toHaveLength((priorRead ? 3 : 2) + (netDeleted ? 1 : 0));
      expect((await readBefore())[0]).toMatchObject({ dependencyKind: afterInsert[0]?.dependencyKind,
        dependencyRevisionCommitSeq: afterInsert[0]?.dependencyRevisionCommitSeq });
      const authority = { deploymentId: activated.anchor.deploymentId, scopeId: activated.anchor.scopeId,
        sessionId: activated.anchor.sessionId, attemptFence: activated.anchor.attemptFence,
        storageGeneration: activated.anchor.storageGeneration, storageGenerationFence: activated.anchor.storageGenerationFence,
        snapshotToken: activated.anchor.snapshotToken, schemaVersionId: fixture.active.basis.schemaVersionId,
        executionClaim: activated.executionClaim };
      const loader = createStoredAttemptEvidenceLoaderV1(fixture.sessionAuthority);
      const running = await Effect.runPromise(loader.loadEffect(authority));
      if (running.kind !== "loaded") throw new Error("Expected actual running sealed journal");
      await Effect.runPromise(createPointCommitFinishingTransitionPortV1(fixture.sessionAuthority)
        .enterFinishing(await pointCommitFinishingCommandFromStoredAttemptV1(authority, running.evidence)));
      const finishing = await Effect.runPromise(loader.loadFinishingEffect({ deploymentId: activated.anchor.deploymentId,
        scopeId: activated.anchor.scopeId, sessionId: activated.anchor.sessionId, attemptFence: activated.anchor.attemptFence }));
      if (finishing.kind !== "loaded" || finalChanges === undefined) throw new Error("Expected actual finishing evidence and closed rows");
      const recoveredAuthority = await Effect.runPromise(captureRecoveredAuthorityEffect({
        deploymentId: authority.deploymentId, scopeId: authority.scopeId,
        sessionId: authority.sessionId, attemptFence: authority.attemptFence }, finishing.evidence));
      const authenticated = await Effect.runPromise(verifyCanonicalStoredEvidenceEffect(recoveredAuthority, finishing.evidence));
      expect(finishing.evidence.root.pointDependencyCount).toBe(1);
      expect(authenticated.journal.readDependencies.filter(point => point.kind === "appRowPoint")).toHaveLength(priorRead ? 1 : 0);
      expect(authenticated.points).toHaveLength(1);
      expect(authenticated.points[0]?.dependency.kind).toBe(priorRead ? "appRowPoint" : "generatedInsertion");
      const scalar = pointCommitScalarCommandForLifecycleFromStoredAttemptV1(authority, finishing.evidence, "finishing");
      const source = issueLogicalParticipantCommitAuthority({ publicationDefinitions: selectedSource.publicationDefinitions,
        participant: "neutral.generated", methods: new Set(["read", "insert", "patch", "delete"]), sourceKey: selectedSource.source.key,
        sourceSha256: selectedSource.source.sourceSha256, schemaVersionId: logicalFixture.schemaVersionId,
        tableIds: new Set([tableId]), search: [], validateDocument: () => Result.succeed(undefined),
        application: active.selection,
        projectApplicationFailure: cause => new LogicalParticipantAdmissionError({ reason: "invalidAuthority", cause }),
        verify: (_operation, contribution, tx, authority, clock, borrowed) => selectedSource.withBinding(active.selection,
          tx, authority, clock, binding => contribution.bindingHead.sequence === binding.head.sequence &&
            contribution.bindingHead.sha256 === binding.head.sha256 ? Effect.void : Effect.fail(projectSourceFailure("binding changed")), borrowed)
            .pipe(Effect.mapError(projectSourceFailure)) });
      const publisher = createPointCommitPublisherPortV1(fixture.sessionAuthority, {
        logicalOperationProfiles: [{ participant: "neutral.generated", operationMethods: ["read", "insert", "patch", "delete"],
          profileRevision: revision, sources: [source] }], intrinsicCreationTimeIndexes: fixture.intrinsicCreationTimeIndexes,
        developerIndexes: fixture.developerIndexes });
      const verifiedInput = await Effect.runPromise(verifyCommitInputStateEffect({ ...authenticated,
        schemaManifest: fixture.schemaAuthority.manifest, logicalParticipants: [source],
        functionValidationAuthority: { path: authenticated.session.functionPath, returnsValidator: null } }));
      const plan = Result.getOrThrow(planPointCommitStateV1(verifiedInput, {
        developerIndexMaintenance: "c08-a-v1", uniqueConstraints: { status: "eligible", tableIds: [tableId] } }));
      expect(plan.dependencies).toHaveLength(priorRead ? 1 : 0);
      expect(plan.rowIntents).toHaveLength(netDeleted ? 0 : 1);
      const rowIntents = plan.rowIntents;
      const command = { ...scalar, dependencies: plan.dependencies, indexRangeDependencies: plan.indexRangeDependencies,
        relationDependencies: plan.relationDependencies, rowIntents, journalBytes: plan.journalBytes };
      const readPublishedInventory = async () => ({
        rows: await fixture.target.drizzle.select().from(fxAppRowCurrent),
        revisions: await fixture.target.drizzle.select().from(fxAppRowRevisions),
        indexes: await fixture.target.drizzle.select().from(fxAppIndexEntryCurrent),
        indexRevisions: await fixture.target.drizzle.select().from(fxAppIndexEntryRevisions),
        claims: await fixture.target.drizzle.select().from(fxAppUniqueKeys),
        commits: await fixture.target.drizzle.select().from(fxSystemCommits),
        outcomes: await fixture.target.drizzle.select().from(fxSystemIdempotency),
        clocks: await fixture.target.drizzle.select().from(fxSystemScopeClocks),
        roots: await fixture.target.drizzle.select().from(fxSystemTransactionJournals),
        sessions: await fixture.target.drizzle.select().from(fxSystemTransactionSessions),
        leases: await fixture.target.drizzle.select().from(fxSystemSnapshotLeases),
        events: await fixture.target.drizzle.select().from(fxSystemTransactionJournalWriteEvents),
        facts: await fixture.target.drizzle.select().from(fxSystemCommitAppRowChanges),
        wakes: await fixture.target.drizzle.select().from(fxSystemCommitWakes),
        points: await readBefore(),
        receipts: await fixture.target.drizzle.select().from(fxSystemTransactionJournalReceipts),
      });
      if (netDeleted) {
        expect(rowIntents).toHaveLength(0);
        const generated = finalChanges.dependencies.find(point => point.documentId === documentId);
        if (generated === undefined) throw new Error("Expected genuine closed insertion obligation");
        const fabricated = { ...command, rowIntents: [{ ...projectLogicalPointExpectation(generated), kind: "deleted" as const }] };
        const before = await readPublishedInventory();
        const refused = await Effect.runPromise(Effect.result(publisher.prove(fabricated)));
        expect(Result.isFailure(refused)).toBe(true);
        if (Result.isSuccess(refused)) throw new Error("Fabricated deleted material intent unexpectedly accepted");
        expect(refused.failure).toBeInstanceOf(PointCommitCorruptionV1Error);
        expect(refused.failure).toMatchObject({ reason: "occEvidenceInvalid" });
        expect(await readPublishedInventory()).toEqual(before);
      }
      if (collision?.timing === "after") await seedCollision();
      if (collision !== undefined) {
        const inventory = await readPublishedInventory();
        const seededRevision = inventory.revisions.filter(row => row.tableId === tableId &&
          bytesEqualFullScan(row.rowId, appRowIdHexV1ToBytes(rowId))).toSorted((a,b) => a.commitSeq < b.commitSeq ? -1 : a.commitSeq > b.commitSeq ? 1 : 0).at(-1);
        if (seededRevision === undefined) throw new Error("Expected genuine committed collision revision");
        expect(seededRevision.commitSeq <= activated.anchor.snapshotToken.commitSeq).toBe(collision.timing === "before");
        const submitted: string[] = [];
        const refusalPublisher = createPointCommitPublisherPortV1(fixture.sessionAuthority, {
          logicalOperationProfiles: [{ participant: "neutral.generated", operationMethods: ["read", "insert", "patch", "delete"],
            profileRevision: revision, sources: [source] }], intrinsicCreationTimeIndexes: fixture.intrinsicCreationTimeIndexes,
          developerIndexes: fixture.developerIndexes, observeQuery: query => submitted.push(query.name) });
        const refused = await Effect.runPromise(Effect.result(refusalPublisher.prove(command)));
        expect(Result.isFailure(refused)).toBe(true);
        if (Result.isSuccess(refused)) throw new Error("Genuine stored insertion collision unexpectedly accepted");
        if (priorRead) {
          expect(refused.failure).toBeInstanceOf(PointCommitConflictV1Error);
          expect(refused.failure).toMatchObject({ conflict: { kind: "appRowPoint", documentId },
            snapshotCommitSeq: activated.anchor.snapshotToken.commitSeq, currentCommitSeq: seededRevision.commitSeq });
        } else {
          expect(refused.failure).toBeInstanceOf(AppDocumentInsertionConflictError);
          expect(refused.failure).toMatchObject({ documentId });
        }
        expect(submitted).not.toContain("applyPublication");
        expect(await readPublishedInventory()).toEqual(inventory);
        return;
      }
      await expect(Effect.runPromise(publisher.prove(command))).resolves.toMatchObject({ kind: "wouldCommit" });
      const publicationCommand = { ...command, successfulResult: {
        valueCodecVersion: successful.evidence.valueCodecVersion, value: successful.valueJson,
        canonicalBytes: successful.canonicalBytes, semanticSizeBytes: successful.semanticSizeBytes,
        sha256Hex: successful.evidence.sha256Hex } };
      const published = await Effect.runPromise(publisher.publish(publicationCommand));
      expect(published).toMatchObject({ kind: "published" });
      const durable = await readPublishedInventory();
      const current = await fixture.target.drizzle.select().from(fxAppRowCurrent).where(and(
        eq(fxAppRowCurrent.scopeUuid, published.token.scopeUuid), eq(fxAppRowCurrent.tableId, tableId),
        eq(fxAppRowCurrent.rowId, appRowIdHexV1ToBytes(rowId))));
      const revisions = await fixture.target.drizzle.select().from(fxAppRowRevisions).where(and(
        eq(fxAppRowRevisions.scopeUuid, published.token.scopeUuid), eq(fxAppRowRevisions.tableId, tableId),
        eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(rowId))));
      if (netDeleted) {
        expect(current).toHaveLength(0);
        expect(revisions).toHaveLength(0);
        expect(durable.indexes.some(row => bytesEqualFullScan(row.rowId, appRowIdHexV1ToBytes(rowId)))).toBe(false);
        expect(durable.indexRevisions.some(row => bytesEqualFullScan(row.rowId, appRowIdHexV1ToBytes(rowId)))).toBe(false);
        expect(durable.claims.some(row => bytesEqualFullScan(row.rowId, appRowIdHexV1ToBytes(rowId)))).toBe(false);
      } else {
        expect(current).toHaveLength(1);
        expect(current[0]).toMatchObject({ commitSeq: published.token.commitSeq });
        expect(revisions).toHaveLength(1);
        expect(revisions[0]).toMatchObject({ commitSeq: published.token.commitSeq, isTombstone: false });
        const storedBytes = revisions[0]?.valueBytes;
        const finalRow = finalChanges.changes[0];
        if (storedBytes === undefined || storedBytes === null || finalRow?.kind !== "live")
          throw new Error("Expected actual stored bytes and final live row");
        expect(bytesEqualFullScan(storedBytes, finalRow.document.canonicalBytes)).toBe(true);
      }
      expect(durable.commits.filter(commit => commit.commitSeq === published.token.commitSeq &&
        commit.scopeUuid === published.token.scopeUuid)).toHaveLength(1);
      expect(await Effect.runPromise(publisher.publish(publicationCommand))).toMatchObject({ kind: "replayed", token: published.token });
      expect(await readPublishedInventory()).toEqual(durable);


    } finally { for (const close of cleanup.reverse()) await close(); }
  }, 120_000);
  }
});
