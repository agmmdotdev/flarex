import { captureFiniteStorageEffect } from "../../../src/execution/finiteStorageCapture";
import { readFiniteAttemptAnchorRow } from "../../../src/execution/finiteAttemptAnchor";
import {
  isLocatedLivenessTarget,
  RENEW_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1,
} from "../../../src/execution/claims/transactionExecutionClaimLiveness";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Result } from "effect";
import { makeGrantRetentionPolicyV1Result } from "flarex-protocol/grant-retention-policy";
import {
  CommitSeqSchema,
  LegacyV1StorageGenerationSchema,
  StorageGenerationFenceSchema,
  projectScopeEpochUuidV1Result,
  projectScopeIdUuidV1Result,
  ScopeEpochSchema,
} from "flarex-protocol/storage-authority";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionPolicyVersionV1Schema,
  TransactionRequestSha256V1Schema,
} from "flarex-protocol/transaction-session";
import type { PoolClient } from "pg";
import { describe, expect, it, vi, type MockInstance } from "vitest";
import { createPostgresLocatedRetainedHistoryFloorTarget } from "../../../src/database/postgres";
import type { AppRowTransaction } from "../../../src/storage/documents/appRows";
import {
  fxControlScopes,
  fxSystemCommits,
  fxSystemScopeClocks,
  fxSystemScopeExecutionAuthorities,
  fxSystemTransactionSessions,
} from "../../../src/database/schema";
import {
  advanceScopeAuthorizationRevocationEpochInTransactionEffect,
  lockScopeClockForOrdinaryWriteInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
} from "../../../src/scope/scopeClock";
import {
  createRetainedHistoryFloorPublicationPort,
  createTestNoReconnectRetainedHistoryFloorPublicationPinFacet,
  publishRetainedHistoryFloorEffect,
} from "../../../src/storage/history/retainedHistoryFloorObservation";
import {
  postgresUrl,
  rollbackAndReleasePostgresClient,
  withTemporaryPostgresPersistence,
} from "../../support/postgresHelpers";
import { prepareInstalledAttemptScopeAuthority } from "../../../src/scope/scopeAuthorityControlRead";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "../../../src/database/locatedReadCommittedRunner";
import { withInstallationMaintenance } from "../../../src/database/postgresInstallationMaintenance";
import { runEffect, runEffectFailure as runFailure } from "../../support/effectTestRuntime";
import { provisionContext } from "./support/postgresFixture";
import { transactionBackendPid, waitForTransactionEntryOrFailure, deferred } from "./support/postgresLocks";
import {
  withFiniteKernelFixture,
  holdNamedFiniteCapture,
  withInstalledFiniteKernelFixture,
  finiteBarrierFixture,
  expectInstalledRefusalBeforeClaimRelease,
  captureExpiredFiniteFixtureRecovery,
  expectFiniteRefusalBeforeData,
  waitForAuthorityWaiter,
  waitForFiniteLeaseExpiry,
} from "./support/postgresFiniteFixture";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("finite running authority barrier", () => {

  for (const [dimension, reason] of [
    ["generation", "unsupportedStorageGeneration"],
    ["fence", "storageGenerationFenceChanged"],
    ["epoch", "scopeEpochChanged"],
  ] as const) {
    it(`refuses changed ${dimension} before data and before later claim refusal`, async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        const fixture = await finiteBarrierFixture(persistence, `refuse_${dimension}`, false);
        const currentInput = await captureExpiredFiniteFixtureRecovery(persistence, fixture);
        const nextFence = StorageGenerationFenceSchema.make(currentInput.preliminaryAuthority.storageGenerationFence + 1n);
        const nextEpoch = ScopeEpochSchema.make("epoch_64000000-0000-4000-8000-000000000902");
        await persistence.drizzle.update(fxSystemScopeExecutionAuthorities).set(
          dimension === "generation" ? { storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1") }
            : dimension === "fence" ? { storageGenerationFence: nextFence } : { epoch: nextEpoch },
        ).where(eq(fxSystemScopeExecutionAuthorities.scopeId, fixture.context.scopeId));
        await expectFiniteRefusalBeforeData(persistence, fixture, currentInput, reason);
        // Add only later refusals: generation precedes fence/epoch; fence
        // precedes epoch; every authority refusal precedes the stale claim.
        if (dimension !== "epoch") await persistence.drizzle.update(fxSystemScopeExecutionAuthorities).set({
          ...(dimension === "generation" ? { storageGenerationFence: nextFence } : {}), epoch: nextEpoch,
        }).where(eq(fxSystemScopeExecutionAuthorities.scopeId, fixture.context.scopeId));
        await expectFiniteRefusalBeforeData(persistence, fixture,
          { ...currentInput, executionClaim: fixture.input.executionClaim }, reason);
      }, { transport: "finiteCapture" });
    }, 120_000);
  }


  for (const dimension of ["owner", "fence"] as const) {
    it(`refuses an independently stale claim ${dimension} before data`, async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        const fixture = await finiteBarrierFixture(persistence, `refuse_claim_${dimension}`, false);
        // Trusted negative storage fixture changes exactly one persisted claim
        // scalar. The original issued owner input remains unchanged.
        await persistence.query(`update fx_system_tx_session set ${dimension === "owner"
          ? "finite_claim_owner = $2::uuid" : "finite_claim_fence = $2::bigint"} where session_id = $1`,
        [fixture.activated.anchor.sessionId, dimension === "owner"
          ? "64000000-0000-4000-8000-000000000901" : fixture.input.executionClaim.claimFence + 1n]);
        await expectFiniteRefusalBeforeData(persistence, fixture, fixture.input, "ownershipChanged");
      }, { transport: "finiteCapture" });
    }, 120_000);
  }


  for (const profile of ["direct", "installed"] as const) {
  it.skipIf(profile === "installed" && !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
    `allows sequencer publication while retaining authority through lease expiry and floor publication${profile === "installed" ? " (qualified installed)" : ""}`, async () => {
    await withFiniteKernelFixture("floor", profile, true, async (persistence, fixture) => {
      const held = await holdNamedFiniteCapture(persistence, fixture);
      const reading = held.reading;
      void reading.catch(() => undefined);
      let publication: Promise<unknown> | undefined;
      try {
        const readerPid = held.readerPid;
        // The actual ordinary writer takes authority SHARE and the sequencer's
        // exclusive publication lock; the original snapshot remains zero.
        await persistence.drizzle.transaction(async tx => {
          await tx.execute(sql`set local lock_timeout = '2s'`);
          const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.context.scopeId));
          await tx.insert(fxSystemCommits).values({ scopeUuid: Result.getOrThrow(projectScopeIdUuidV1Result(fixture.context.scopeId)).scopeUuid,
            epochUuid: Result.getOrThrow(projectScopeEpochUuidV1Result(fixture.activated.anchor.snapshotToken.epoch)).epochUuid,
            commitSeq: CommitSeqSchema.make(1n), changeCount: 0,
            committedAt: sql`clock_timestamp() - interval '30 seconds'` });
          expect(clock.lastCommitSeq).toBe(0n);
          await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(1n) })
            .where(eq(fxSystemScopeClocks.scopeId, fixture.context.scopeId));
        });
        const port = createRetainedHistoryFloorPublicationPort({ authority: {
          scopeMetadata: persistence, provisioningReceipts: {
            getScopeAuthorityProvisioningReceipt: async () => { throw new Error("Shared scope has no split receipt"); },
          }, scopeClockTargets: { resolve: async locator => createPostgresLocatedRetainedHistoryFloorTarget(persistence, locator) },
        }, grantRetentionPolicy: Result.getOrThrow(makeGrantRetentionPolicyV1Result({
          maximumGrantLifetimeMilliseconds: 1_000, maximumFutureIssuedAtSkewMilliseconds: 0,
          maximumLiveSnapshotRetentionMilliseconds: 10_000,
        })), pinFacets: [createTestNoReconnectRetainedHistoryFloorPublicationPinFacet()] });
        publication = runEffect(publishRetainedHistoryFloorEffect(port, fixture.context.deploymentId));
        void publication.catch(() => undefined);
        await waitForAuthorityWaiter(persistence, readerPid);
        await waitForFiniteLeaseExpiry(persistence, fixture.activated.anchor.sessionId);
        expect((await persistence.query(`select oldest_available_commit_seq::text as floor
          from fx_system_scope_execution_authority where scope_id = $1`, [fixture.context.scopeId])).rows)
          .toEqual([{ floor: "0" }]);
        // Expiring the lease does not remove the authority lock held by SQL.
        await waitForAuthorityWaiter(persistence, readerPid);
        await held.release();
        expect(await held.verdict).toMatchObject({ _tag: "Failure", failure: { _tag: "FiniteStorageCaptureError", reason: "expired" } });
        expect(await publication).toMatchObject({ disposition: "advanced", currentFloor: 1n });
        let enteredAgain = false;
        const failure = await runFailure(captureFiniteStorageEffect(fixture.target,
          fixture.input, { kind: "transactionTime" }).pipe(Effect.tap(() => Effect.sync(() => { enteredAgain = true; }))));
        expect(failure).toMatchObject({ _tag: "FiniteStorageCaptureError", reason: "expired" });
        expect(enteredAgain).toBe(false);
      } finally {
        await held.release();
        await reading.catch(() => undefined);
        await publication?.catch(() => undefined);
      }
    });
  }, 120_000);
  }


  for (const profile of ["direct", "installed"] as const) {
  it.skipIf(profile === "installed" && !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
    `holds revocation behind the finite reader and refuses the next frontier${profile === "installed" ? " (qualified installed)" : ""}`, async () => {
    await withFiniteKernelFixture("revocation", profile, false, async (persistence, fixture) => {
      const held = await holdNamedFiniteCapture(persistence, fixture);
      const reading = held.reading;
      void reading.catch(() => undefined);
      let revocation: Promise<unknown> | undefined;
      try {
        const readerPid = held.readerPid;
        revocation = persistence.drizzle.transaction(tx => runEffect(
          advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, fixture.context.scopeId)));
        void revocation.catch(() => undefined);
        await waitForAuthorityWaiter(persistence, readerPid);
        await held.release(); await reading; await revocation;
        let enteredAgain = false;
        expect(await runFailure(captureFiniteStorageEffect(fixture.target,
          fixture.input, { kind: "transactionTime" }).pipe(Effect.tap(() => Effect.sync(() => { enteredAgain = true; })))))
          .toMatchObject({ _tag: "FiniteStorageCaptureError", reason: "authorizationRevocationEpochChanged" });
        expect(enteredAgain).toBe(false);
      } finally { await held.release(); await reading.catch(() => undefined); await revocation?.catch(() => undefined); }
    });
  }, 120_000);
  }


  for (const profile of ["direct", "installed"] as const) {
  it.skipIf(profile === "installed" && !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
    `samples expiry after waiting for the live claim lock${profile === "installed" ? " (qualified installed)" : ""}`, async () => {
    await withFiniteKernelFixture("expiry", profile, true, async (persistence, fixture) => {
      const held = await persistence.pool.connect();
      let pending: Promise<unknown> | undefined;
      let entered = false;
      try {
        await held.query("begin");
        await held.query("select 1 from fx_system_tx_session where session_id = $1 for update",
          [fixture.activated.anchor.sessionId]);
        const pid = (await held.query<{ pid: number }>("select pg_backend_pid()::int as pid")).rows[0]?.pid;
        if (pid === undefined) throw new Error("Missing blocker PID");
        pending = runFailure(captureFiniteStorageEffect(fixture.target,
          fixture.input, { kind: "transactionTime" }).pipe(Effect.tap(() => Effect.sync(() => { entered = true; }))));
        await waitForAuthorityWaiter(persistence, pid, false);
        await waitForFiniteLeaseExpiry(persistence, fixture.activated.anchor.sessionId);
        await held.query("rollback");
        expect(await pending).toMatchObject({ _tag: "FiniteStorageCaptureError", reason: "expired" });
        expect(entered).toBe(false);
      } finally { await rollbackAndReleasePostgresClient(held); await pending?.catch(() => undefined); }
    });
  }, 120_000);
  }


  it.skipIf(!process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
    "validates qualified finite admission before compact locks and preserves isolation, Cause and maintenance drain", async () => {
    await withInstalledFiniteKernelFixture("composition", false, async (persistence, fixture, owner, controlOwner) => {
      const spies: MockInstance<PoolClient["query"]>[] = [];
      const observe = (client: PoolClient) => { spies.push(vi.spyOn(client, "query")); };
      persistence.pool.on("acquire", observe);
      try {
        const captured = await runEffect(captureFiniteStorageEffect(fixture.target, fixture.input, { kind: "transactionTime" }));
        expect(Number.isFinite(new Date(captured.timestamp).getTime())).toBe(true);
        const statements = spies.flatMap(spy => spy.mock.calls.map(call => {
          const query: unknown = call[0];
          return typeof query === "string" ? query : typeof query === "object" && query !== null &&
            "text" in query && typeof query.text === "string" ? query.text : "";
        }));
        const captures = statements.filter(statement => statement.includes("fx_accept_finite_storage_capture"));
        expect(captures).toHaveLength(1);
        const capture = captures[0];
        if (capture === undefined) throw new Error("Missing actual named capture statement");
        expect(capture).toContain("fx_lock_control_scope_placement");
        expect(capture).toContain("preflight as materialized");
        expect(capture).toContain("first_frontier as materialized");
        expect(capture).toContain("second_frontier as materialized");
        expect(capture).toContain("locked_placement as materialized");
        expect(capture).toContain("accepted_capture as materialized");
        expect(statements.filter(statement => statement.includes("fx_lock_control_scope_placement"))).toHaveLength(1);
        expect(capture).not.toContain("fx_accept_finite_placement_frontier");
        expect(capture).not.toContain("fx_lock_read_scope_placement");
        expect(capture).not.toContain("sealed_journal_bytes");
        expect(capture).not.toContain("validated_args_json");
        expect(capture).not.toContain("authorization_grant_json");
        expect(statements.some(statement => statement.toLowerCase().startsWith("begin"))).toBe(false);
        expect(statements.some(statement => statement.toLowerCase().startsWith("commit"))).toBe(false);
      } finally {
        persistence.pool.off("acquire", observe);
        for (const spy of spies) spy.mockRestore();
      }

      const peer = await provisionContext(owner.persistence, "installed_peer", fixture.context.physicalLocator, randomUUID);
      const peerDeployment = await owner.persistence.getDeploymentMetadata(peer.deploymentId);
      if (peerDeployment === null) throw new Error("Missing actual peer deployment");
      await controlOwner.persistence.insertDeploymentMetadata(peerDeployment);
      await controlOwner.persistence.insertScopeMetadata({ deploymentId: peer.deploymentId, scopeId: peer.scopeId,
        physicalLocator: peer.physicalLocator });
      let callbacks = 0;
      const peerFailure = await runFailure(captureFiniteStorageEffect(fixture.target,
        { ...fixture.input, selector: { ...fixture.input.selector, deploymentId: peer.deploymentId, scopeId: peer.scopeId } }, { kind: "transactionTime" }).pipe(Effect.tap(() => Effect.sync(() => { callbacks++; }))));
      expect(peerFailure).toMatchObject({ _tag: "FiniteStorageCaptureError", reason: "invalidInput" });
      expect(callbacks).toBe(0);
      await expectFiniteRefusalBeforeData(persistence, fixture, { ...fixture.input,
        preliminaryAuthority: { ...fixture.input.preliminaryAuthority, storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1") } },
        "unsupportedStorageGeneration");

      const defect = new Error("Deferred finite decoder defect");
      const outcome = await Effect.runPromiseExit(captureFiniteStorageEffect(fixture.target, fixture.input,
        { kind: "transactionTime" }).pipe(Effect.flatMap(() => Effect.die(defect))));
      if (!Exit.isFailure(outcome)) throw new Error("Unexpected successful deferred decoder defect");
      expect(outcome.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);

      const held = await holdNamedFiniteCapture(persistence, fixture);
      let maintenanceWasEntered = false;
      const reading = held.reading;
      void reading.catch(() => undefined);
      let maintaining: Promise<unknown> | undefined;
      try {
        const readerPid = held.readerPid;
        maintaining = runEffect(withInstallationMaintenance(owner.persistence.pool.options, owner.schemaName,
          () => Effect.sync(() => { maintenanceWasEntered = true; })));
        void maintaining.catch(() => undefined);
        await waitForAuthorityWaiter(owner.persistence, readerPid, false);
        await held.release();
        await reading;
        await maintaining;
        expect(maintenanceWasEntered).toBe(true);
        expect((await owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
        // The next real runtime checkout must retain its startup budget. A
        // scalar timeout refusal must not mask the drained installation's
        // original native admission failure.
        const nextCaptureClient = await persistence.pool.connect();
        try {
          expect((await nextCaptureClient.query("show statement_timeout")).rows).toEqual([{ statement_timeout: "30s" }]);
          await expect(nextCaptureClient.query(`select * from ${owner.schemaName}.fx_lock_installation_admission()`))
            .rejects.toMatchObject({ code: "55000" });
        } finally { nextCaptureClient.release(); }
        const failure = await runFailure(captureFiniteStorageEffect(fixture.target,
          fixture.input, { kind: "transactionTime" }).pipe(Effect.tap(() => Effect.sync(() => { callbacks++; }))));
        expect(failure.cause).toMatchObject({ cause: { code: "55000" } });
        expect(failure).toMatchObject({ _tag: "FiniteStorageCaptureError", reason: "resourceFailure",
          cause: { cause: { code: "55000" } } });
        expect(callbacks).toBe(0);
      } finally { await held.release(); await reading.catch(() => undefined); await maintaining?.catch(() => undefined); }
    });
  }, 180_000);


  for (const profile of ["direct", "installed"] as const) {
    it.skipIf(profile === "installed" && !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
      `preserves exact anchor body, digest and scalar corruption refusal in the frontier projection (${profile})`, async () => {
      await withFiniteKernelFixture("body_integrity", profile, false, async (persistence, fixture) => {
        const sessionId = fixture.activated.anchor.sessionId;
        const original = (await persistence.drizzle.select({ body: fxSystemTransactionSessions.finiteAttemptBytes,
          digest: fxSystemTransactionSessions.finiteAttemptSha256 }).from(fxSystemTransactionSessions)
          .where(eq(fxSystemTransactionSessions.sessionId, sessionId)))[0];
        if (original?.body === null || original?.body === undefined || original.digest === null)
          throw new Error("Missing genuine finite anchor body");
        for (const corrupt of ["body", "digest"] as const) {
          const body = new Uint8Array(original.body), digest = new Uint8Array(original.digest);
          if (corrupt === "body") body[body.length - 1] = body[body.length - 1]! ^ 1;
          else digest[0] = digest[0]! ^ 1;
          await persistence.drizzle.update(fxSystemTransactionSessions).set({ finiteAttemptBytes: body,
            finiteAttemptSha256: digest }).where(eq(fxSystemTransactionSessions.sessionId, sessionId));
          for (const input of [fixture.input]) {
            let entered = false;
            const failure = await runFailure(captureFiniteStorageEffect(fixture.target,
              input, { kind: "transactionTime" }).pipe(Effect.tap(() => Effect.sync(() => { entered = true; }))));
            expect(failure).toMatchObject({ _tag: "FiniteStorageCaptureError", reason: "storedCorruption" });
            expect(entered).toBe(false);
          }
          await persistence.drizzle.update(fxSystemTransactionSessions).set({ finiteAttemptBytes: original.body,
            finiteAttemptSha256: original.digest }).where(eq(fxSystemTransactionSessions.sessionId, sessionId));
        }
        const storedRequest = (await persistence.drizzle.select({ digest: fxSystemTransactionSessions.requestSha256 })
          .from(fxSystemTransactionSessions).where(eq(fxSystemTransactionSessions.sessionId, sessionId)))[0];
        if (storedRequest === undefined) throw new Error("Missing original request pin");
        const changedRequest = new Uint8Array(storedRequest.digest);
        changedRequest[0] = changedRequest[0]! ^ 1;
        await persistence.drizzle.update(fxSystemTransactionSessions).set({ requestSha256: TransactionRequestSha256V1Schema.make(changedRequest) })
          .where(eq(fxSystemTransactionSessions.sessionId, sessionId));
        let enteredWithChangedRequest = false;
        expect(await runFailure(captureFiniteStorageEffect(fixture.target, fixture.input, { kind: "transactionTime" }).pipe(Effect.tap(() => Effect.sync(() => { enteredWithChangedRequest = true; })))))
          .toMatchObject({ _tag: "FiniteStorageCaptureError", reason: "storedCorruption" });
        expect(enteredWithChangedRequest).toBe(false);
        await persistence.drizzle.update(fxSystemTransactionSessions).set({ requestSha256: storedRequest.digest })
          .where(eq(fxSystemTransactionSessions.sessionId, sessionId));
        const acceptedRow = (await persistence.drizzle.select().from(fxSystemTransactionSessions)
          .where(eq(fxSystemTransactionSessions.sessionId, sessionId)))[0];
        if (acceptedRow === undefined) throw new Error("Missing genuinely accepted finite session");
        await persistence.drizzle.update(fxSystemTransactionSessions).set({
          policyVersion: TransactionPolicyVersionV1Schema.make(`${acceptedRow.policyVersion}_changed`),
        }).where(eq(fxSystemTransactionSessions.sessionId, sessionId));
        let enteredWithChangedPolicy = false;
        expect(await runFailure(captureFiniteStorageEffect(fixture.target, fixture.input, { kind: "transactionTime" }).pipe(Effect.tap(() => Effect.sync(() => { enteredWithChangedPolicy = true; })))))
          .toMatchObject({ _tag: "FiniteStorageCaptureError", reason: "storedCorruption" });
        expect(enteredWithChangedPolicy).toBe(false);
        await persistence.drizzle.update(fxSystemTransactionSessions).set({ policyVersion: acceptedRow.policyVersion })
          .where(eq(fxSystemTransactionSessions.sessionId, sessionId));
        // The persisted protocol constraint remains intact. Decode unsupported
        // protocol scalars on a detached copy of this genuine accepted row, both
        // with the original capture and at cold durable resolution.
        const unsupportedProtocol = { ...acceptedRow };
        Reflect.set(unsupportedProtocol, "protocolVersion", TRANSACTION_SESSION_PROTOCOL_VERSION_V1 + 1);
        for (const anchor of [fixture.input.finiteAnchor, undefined]) {
          let enteredWithUnsupportedProtocol = false;
          expect(await runFailure(readFiniteAttemptAnchorRow(unsupportedProtocol, anchor).pipe(
            Effect.flatMap(() => Effect.sync(() => { enteredWithUnsupportedProtocol = true; })),
          ))).toMatchObject({ _tag: "FiniteAttemptAnchorError", reason: "storedCorruption" });
          expect(enteredWithUnsupportedProtocol).toBe(false);
        }
        expect(await runFailure(captureFiniteStorageEffect(fixture.target, { selector: fixture.input.selector,
          executionClaim: fixture.input.executionClaim, preliminaryAuthority: fixture.input.preliminaryAuthority },
          { kind: "transactionTime" }))).toMatchObject({ _tag: "FiniteStorageCaptureError", reason: "invalidInput" });
        await runEffect(captureFiniteStorageEffect(fixture.target, fixture.input, { kind: "transactionTime" }));
      });
    }, 120_000);
  }


  it.skipIf(!process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
    "requires the original installed acceptance issuer, selection and protection before COMMIT", async () => {
    await withInstalledFiniteKernelFixture("accepting_issuer", false, async (persistence, fixture, owner, _controlOwner, installation) => {
      const original = Result.getOrThrow(prepareInstalledAttemptScopeAuthority(installation,
        persistence.drizzle, fixture.context.physicalLocator));
      const foreign = Result.getOrThrow(prepareInstalledAttemptScopeAuthority(installation,
        persistence.drizzle, fixture.context.physicalLocator));
      const selection = { deploymentId: fixture.context.deploymentId, scopeId: fixture.context.scopeId };
      const runner = createDefaultLocatedReadCommittedTransactionRunnerV1(persistence.drizzle, { kind: "coLocated", installation },
        { owner: original, selection, protection: "attempt" });
      const before = await persistence.drizzle.select().from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, fixture.activated.anchor.sessionId));
      for (const accept of [undefined, foreign, original]) {
        await expect(runner(async tx => {
          if (accept !== undefined) await runEffect(accept.lock(tx, selection, accept === original ? "share" : "attempt"));
          await tx.update(fxSystemTransactionSessions).set({ updatedAt: sql`clock_timestamp()` })
            .where(eq(fxSystemTransactionSessions.sessionId, fixture.activated.anchor.sessionId));
        })).rejects.toMatchObject({ name: "LocatedReadCommittedTransactionFailureV1", issue: { kind: "callbackRolledBack" } });
        expect(await persistence.drizzle.select().from(fxSystemTransactionSessions)
          .where(eq(fxSystemTransactionSessions.sessionId, fixture.activated.anchor.sessionId))).toEqual(before);
      }
      const wrongSelection = createDefaultLocatedReadCommittedTransactionRunnerV1(persistence.drizzle, { kind: "coLocated", installation },
        { owner: original, selection: { ...selection, deploymentId: `${selection.deploymentId}_wrong` }, protection: "attempt" });
      await expect(wrongSelection(async tx => {
        await runEffect(original.lock(tx, selection, "attempt"));
      })).rejects.toMatchObject({ name: "LocatedReadCommittedTransactionFailureV1", issue: { kind: "callbackRolledBack" } });
      let wrongDatabaseCallbacks = 0;
      const wrongDatabase = createDefaultLocatedReadCommittedTransactionRunnerV1(owner.persistence.drizzle, { kind: "coLocated", installation },
        { owner: original, selection, protection: "attempt" });
      await expect(wrongDatabase(async () => { wrongDatabaseCallbacks++; })).rejects.toMatchObject({
        name: "LocatedReadCommittedTransactionFailureV1", issue: { kind: "infrastructureFailure", phase: "beginOrConfigure" },
      });
      expect(wrongDatabaseCallbacks).toBe(0);
      let acceptedTransaction: AppRowTransaction | undefined;
      let businessCallbacks = 0;
      await runner(async tx => {
        await runEffect(original.lock(tx, selection, "attempt"));
        Result.getOrThrowWith(original.requireAcceptedTransaction(tx, selection, "attempt"), cause => cause);
        acceptedTransaction = tx;
        businessCallbacks++;
      });
      expect(businessCallbacks).toBe(1);
      if (acceptedTransaction === undefined) throw new Error("Missing genuine accepted transaction");
      expect(original.requireAcceptedTransaction(acceptedTransaction, selection, "attempt"))
        .toMatchObject({ _tag: "Failure", failure: { _tag: "InstallationLifecycleError", reason: "invalidCapability" } });
    });
  }, 180_000);


  it.skipIf(!process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
    "takes liveness time after waiting for the compact anchor", async () => {
    await withInstalledFiniteKernelFixture("anchor_projection_wait", true, async (persistence, fixture, owner) => {
      const holder = await owner.persistence.pool.connect();
      let reading: Promise<unknown> | undefined;
      let callbacks = 0;
      try {
        await holder.query("begin");
        const pid = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid;
        if (pid === undefined) throw new Error("Missing compact anchor holder PID");
        await holder.query("select session_id from fx_system_tx_session where session_id=$1 for update",
          [fixture.activated.anchor.sessionId]);
        reading = runFailure(captureFiniteStorageEffect(fixture.target, fixture.input, { kind: "transactionTime" }).pipe(Effect.tap(() => Effect.sync(() => { callbacks++; }))));
        await waitForAuthorityWaiter(persistence, pid, false);
        await waitForFiniteLeaseExpiry(owner.persistence, fixture.activated.anchor.sessionId);
        await holder.query("commit");
        expect(await reading).toMatchObject({ _tag: "FiniteStorageCaptureError", reason: "expired" });
        expect(callbacks).toBe(0);
      } finally { await rollbackAndReleasePostgresClient(holder); await reading?.catch(() => undefined); }
    });
  }, 180_000);


  it.skipIf(!process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
    "rejects changed control placement in the installed finite initial renewal transaction", async () => {
    await withInstalledFiniteKernelFixture("renew_placement", false, async (persistence, fixture, _owner, controlOwner) => {
      if (!isLocatedLivenessTarget(fixture.target)) throw new Error("Missing genuine renewal target");
      const before = (await persistence.drizzle.select({ lease: fxSystemTransactionSessions.finiteLeaseExpiresAt,
        claim: fxSystemTransactionSessions.finiteClaimExpiresAt }).from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, fixture.activated.anchor.sessionId)))[0];
      if (before === undefined) throw new Error("Missing original live attempt");
      // A genuine control writer changes the placement after retained routing
      // capture. Target acceptance must refuse before changing either deadline.
      await controlOwner.persistence.drizzle.update(fxControlScopes).set({ physicalLocator: {
        ...fixture.context.physicalLocator, schemaName: controlOwner.schemaName,
      } }).where(eq(fxControlScopes.scopeId, fixture.context.scopeId));
      expect(await runFailure(fixture.target[RENEW_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1]({
        selector: fixture.input.selector, executionClaim: fixture.input.executionClaim,
        preliminaryAuthority: fixture.input.preliminaryAuthority, installedFinite: true,
        claimDurationMilliseconds: 60_000, leaseRenewalDurationMilliseconds: 120_000,
        maximumLiveSnapshotRetentionMilliseconds: 3_600_000,
      }))).toMatchObject({ _tag: "PointMutationExecutionClaimLivenessPersistenceV1Error", operation: "transaction" });
      expect((await persistence.drizzle.select({ lease: fxSystemTransactionSessions.finiteLeaseExpiresAt,
        claim: fxSystemTransactionSessions.finiteClaimExpiresAt }).from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, fixture.activated.anchor.sessionId)))[0]).toEqual(before);
    });
  }, 120_000);


  for (const fault of ["clockTimestamp", "metadataSequence"] as const) {
    it.skipIf(!process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
      `preserves installed ${fault} corruption before claim waits and stale generation refusal`, async () => {
      await withInstalledFiniteKernelFixture(`corrupt_${fault}`, false, async (persistence, fixture, owner) => {
        if (fault === "clockTimestamp") {
          await owner.persistence.query(`update fx_system_scope_clock set updated_at = 'infinity' where scope_id = $1`, [fixture.context.scopeId]);
        } else {
          // Privileged stored-corruption fault: retain the exact decoder proof
          // even when a constraint has been deliberately removed after startup.
          await owner.persistence.query(`alter table fx_system_scope_clock
            drop constraint fx_system_scope_clock_last_metadata_sequence_non_negative_check`);
          await owner.persistence.query(`update fx_system_scope_clock set last_metadata_sequence = -1 where scope_id = $1`, [fixture.context.scopeId]);
        }
        await expectInstalledRefusalBeforeClaimRelease(fixture, owner.persistence, {
          _tag: "FiniteStorageCaptureError", reason: "storedCorruption",
        });
        let callbacks = 0;
        const failure = await runFailure(captureFiniteStorageEffect(fixture.target, { ...fixture.input,
          preliminaryAuthority: { ...fixture.input.preliminaryAuthority, storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1") } }, { kind: "transactionTime" }).pipe(Effect.tap(() => Effect.sync(() => { callbacks++; }))));
        expect(failure).toMatchObject({ _tag: "FiniteStorageCaptureError", reason: "storedCorruption" });
        expect(callbacks).toBe(0);
        expect((await persistence.query(`select count(*)::int as leases from fx_system_snapshot_lease
          where session_id = $1`, [fixture.activated.anchor.sessionId])).rows).toEqual([{ leases: 0 }]);
      });
    }, 180_000);
  }


  it.skipIf(!process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
    "refuses installed locator drift before compact execution-claim waits", async () => {
    await withInstalledFiniteKernelFixture("locator_wait", false, async (_persistence, fixture, owner, controlOwner) => {
      await controlOwner.persistence.drizzle.update(fxControlScopes).set({ physicalLocator: {
        ...fixture.context.physicalLocator, databaseKey: `${fixture.context.physicalLocator.databaseKey}_drift`,
      } }).where(eq(fxControlScopes.scopeId, fixture.context.scopeId));
      await expectInstalledRefusalBeforeClaimRelease(fixture, owner.persistence, {
        _tag: "FiniteStorageCaptureError", reason: "invalidAuthority",
      });
    });
  }, 180_000);


  it.skipIf(!process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
    "observes the actual sequencer after a retained-floor authority wait in installed finite admission", async () => {
    await withInstalledFiniteKernelFixture("floor_wait", true, async (persistence, fixture, owner) => {
      const entered = deferred<number>(), release = deferred<void>();
      // Controlled valid transition fixture under the real UPDATE clock owner.
      // The separate publication test exercises retention-policy calculation.
      const writing = owner.persistence.drizzle.transaction(async tx => {
        const clock = await runEffect(lockScopeClockForUpdateInTransactionEffect(tx, fixture.context.scopeId));
        expect(clock.lastCommitSeq).toBe(0n);
        entered.resolve(await transactionBackendPid(tx));
        await release.promise;
        await tx.insert(fxSystemCommits).values({ scopeUuid: Result.getOrThrow(projectScopeIdUuidV1Result(fixture.context.scopeId)).scopeUuid,
          epochUuid: Result.getOrThrow(projectScopeEpochUuidV1Result(fixture.activated.anchor.snapshotToken.epoch)).epochUuid,
          commitSeq: CommitSeqSchema.make(1n), changeCount: 0, committedAt: sql`clock_timestamp() - interval '30 seconds'` });
        await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(1n) })
          .where(eq(fxSystemScopeClocks.scopeId, fixture.context.scopeId));
        await tx.update(fxSystemScopeExecutionAuthorities).set({ oldestAvailableCommitSeq: CommitSeqSchema.make(1n) })
          .where(eq(fxSystemScopeExecutionAuthorities.scopeId, fixture.context.scopeId));
      });
      void writing.catch(() => undefined);
      let reading: Promise<unknown> | undefined;
      let callbacks = 0;
      try {
        const writerPid = await waitForTransactionEntryOrFailure(entered.promise, writing, "installed authority transition");
        reading = runFailure(captureFiniteStorageEffect(fixture.target, fixture.input, { kind: "transactionTime" }).pipe(Effect.tap(() => Effect.sync(() => { callbacks++; }))));
        // Observe as the actual reader login: the ordinary owner cannot see
        // another restricted role's pg_stat_activity wait-event fields.
        await waitForAuthorityWaiter(persistence, writerPid, false);
        await waitForFiniteLeaseExpiry(owner.persistence, fixture.activated.anchor.sessionId);
        release.resolve(undefined);
        await writing;
        expect(await reading).toMatchObject({ _tag: "FiniteStorageCaptureError", reason: "expired" });
        expect(callbacks).toBe(0);
        expect((await persistence.query(`select c.last_commit_seq::text as sequence, a.oldest_available_commit_seq::text as floor
          from fx_system_scope_clock c join fx_system_scope_execution_authority a using(scope_id)
          where c.scope_id = $1`, [fixture.context.scopeId])).rows).toEqual([{ sequence: "1", floor: "1" }]);
      } finally { release.resolve(undefined); await writing.catch(() => undefined); await reading?.catch(() => undefined); }
    });
  }, 180_000);
});
