import { createHash } from "node:crypto";
import { Deferred, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";
import { CommitSyscallSequenceV1Schema, canonicalizeSessionJournalEffect,
  canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { encodeAdmittedFrameworkOperationV1Result } from
  "flarex-protocol/internal/admitted-framework-operation-v1";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { selectApplicationMutationAdmission } from "../src/applicationMutationAdmission";
import { createApplicationMutationSessionActivationPersistenceV1 } from "../src/transactionSessionActivation";
import { createSessionJournalStorePersistence } from "../src/sessionJournalStore";
import { issueLogicalParticipantAttemptAdmission, issueLogicalParticipantCommitAuthority,
  LogicalParticipantAdmissionError,
  type LogicalParticipantSelection } from "../src/logicalDocuments/participantAdmission";
import { createStoredAttemptEvidenceLoaderV1 } from "../src/storedAttemptEvidence";
import { createPointCommitFinishingTransitionPortV1, createPointCommitPublisherPortV1 } from
  "../src/pointCommitTransaction";
import { pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1,
  pointCommitFinishingCommandFromStoredAttemptV1 } from "./pointCommitTransactionTestSupport";
import { createApplicationNativeMutationPGliteFixtureWithPersistence,
  createApplicationNativeMutationPostgresFixture } from
  "./fixtures/applicationNativeMutationTestFixture";
import { applicationMutationActivationFixture } from "./applicationMutationActivationFixture";
import { TEST_GRANT_RETENTION_POLICY_V1 } from "./transactionSessionActivationTestSupport";
import { createPGlitePersistence } from "../src/pglite";
import { newTestPGlite } from "./pgliteSearchExtensions";
import { createFileScopedPostgresFixture, postgresUrl } from "./postgresHelpers";

const emptyChanges = Object.freeze({ changes: [], attempts: [], lifecycle: [], observedRows: [],
  noFinalRows: [], dependencies: [], scans: [], uniqueReads: [], indexReads: [], pageReads: [],
  searchReads: [], setNull: [], referenceReplacements: [] });

describe("neutral admitted operation source bundle", () => {
  for (const driver of ["pglite", "postgres"] as const) {
  it.skipIf(driver === "postgres" && postgresUrl === null)(
    `keeps three sources in one receipt, seal, and commit on ${driver}`, async () => {
    const options = {
      runtimeHostIdentity: "flarex.test/neutral-mixed-journal", compatibilityDate: "2026-09-27",
    };
    const resources = await (async () => {
      if (driver === "postgres") {
        const control = await createFileScopedPostgresFixture();
        const target = await createFileScopedPostgresFixture();
        return { fixture: await createApplicationNativeMutationPostgresFixture(options,
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
            issueLogicalParticipantAttemptAdmission({ attempt: selectedAttempt, root, readTransaction,
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
      const sourceAuthorities = [0, 1, 2].map(index => issueLogicalParticipantCommitAuthority({
        participant: "neutral.workflow", methods: new Set([`call-${index}`]),
        sourceKey: `neutral.source.${index}`, sourceSha256: `${index + 4}`.repeat(64),
        schemaVersionId: fixture.active.basis.schemaVersionId,
        tableIds: new Set([decodeCatalogTableId(100 + index)]),
        indexes: [], unique: [], search: [], validateDocument: () => Result.succeed(undefined),
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
      const trusted = publisher([profile]);
      await expect(Effect.runPromise(trusted.prove(command))).resolves.toMatchObject({ kind: "wouldCommit" });
      await expect(Effect.runPromise(trusted.publish(publicationCommand)))
        .resolves.toMatchObject({ kind: "published" });

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
  }
});
