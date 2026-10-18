import { CAPTURE_FINITE_STORAGE, captureFiniteStorageEffect } from "../../../../src/execution/finiteStorageCapture";
import { captureFiniteAttemptAnchor, projectCapturedFiniteAttemptAnchor, readFiniteAttemptAnchorRow } from "../../../../src/execution/finiteAttemptAnchor";
import { deriveTransactionExecutionClaimV1 } from "../../../../src/execution/claims/transactionExecutionClaimPersistence";
import { rememberPrimitiveActivationClaim, executionClaimForAnchor } from "./attemptFixture";
import {
  finiteEntryAttemptContextFromAnchor,
} from "../../../../src/execution/session/finiteSession";
import {
  FINITE_STORAGE_CAPTURE_AUTHORITY,
} from "../../../../src/execution/session/constructionContracts";
import {
  readFiniteRecoveryAttempt,
} from "../../../../src/execution/session/recoveryCapture";
import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { Effect, Result } from "effect";
import { MetadataSequenceSchema } from "flarex-protocol/commit-protocol";
import { FlarexDbV1StorageGenerationSchema, projectScopeIdUuidV1Result, SnapshotTokenSchema } from "flarex-protocol/storage-authority";
import { TransactionAttemptFenceSchema, TransactionSessionIdV1Schema, TRANSACTION_SESSION_PROTOCOL_VERSION_V1 } from "flarex-protocol/transaction-session";
import { expect } from "vitest";
import { createPostgresLocatedPointMutationSessionActivationTargetV1, type PostgresFlarexPersistence } from "../../../../src/database/postgres";
import { rowsFromDriverExecuteResult } from "../../../../src/database/driverExecuteResult";
import { fxSystemTransactionSessions } from "../../../../src/database/schema";
import { lockScopeClockForUpdateInTransactionEffect } from "../../../../src/scope/scopeClock";
import { captureFiniteMetadataReservation } from "../../../../src/execution/finiteMetadataReservation";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../../../../src/scope/scopeAuthorityResolution";
import { type SharedDatabaseScopePhysicalLocator } from "../../../../src/scope/scopeMetadataTypes";
import {
  isLocatedExactRunningAttemptKernelV1,
  type ExactRunningAttemptKernelInputV1,
} from "../../../../src/execution/session/kernelContracts";
import type {
  LocatedReadCommittedAttemptTargetV1,
} from "../../../../src/database/locatedTransactionIdentity";
import { createFileScopedPostgresFixture, createProtectedFileScopedPostgresFixture, createCoLocatedReadInstallationFixture, rollbackAndReleasePostgresClient } from "../../../support/postgresHelpers";
import { getCoLocatedReadInstallationReferencesResult } from "../../../../src/installation/installationLifecycle";
import { prepareProtectedMetadata } from "../../../../src/execution/preparation/preparedMetadataEpoch";
import { runEffect, runEffectFailure as runFailure } from "../../../support/effectTestRuntime";
import { pointMutationSessionActivationFixture } from "./activationEvidence";
import { provisionContext, createExecutionClaimAcquisition, selectorFromAnchor, expireFiniteExecutionClaim, sharedLocator, uuidFactory } from "./postgresFixture";

/** Hold the real claim row so the named statement retains its earlier authority
 * and installation locks. No consumer callback receives the statement's transaction. */
export async function holdNamedFiniteCapture(persistence: PostgresFlarexPersistence,
  fixture: Awaited<ReturnType<typeof finiteBarrierFixture>>) {
  const holder = await persistence.pool.connect();
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await rollbackAndReleasePostgresClient(holder);
  };
  let reading: Promise<import("../../../../src/execution/finiteStorageCapture").FiniteStorageCaptureEnvelopes["transactionTime"]> | undefined;
  try {
    await holder.query("begin");
    await holder.query("select session_id from fx_system_tx_session where session_id=$1 for update",
      [fixture.activated.anchor.sessionId]);
    const pid = (await holder.query<{ pid: number }>("select pg_backend_pid()::int as pid")).rows[0]?.pid;
    if (pid === undefined) throw new Error("Missing actual claim holder PID");
    let captureSettled = false;
    const verdict = runEffect(captureFiniteStorageEffect(fixture.target, fixture.input, { kind: "transactionTime" }).pipe(Effect.result))
      .then(result => { captureSettled = true; return result; });
    reading = verdict.then(result => Result.getOrThrowWith(result, cause => cause));
    void reading.catch(() => undefined);
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const waiting = await persistence.query<{ pid: number }>(`select pid from pg_stat_activity
        where datname=current_database() and state='active' and wait_event_type='Lock'
          and $1::int=any(pg_blocking_pids(pid))`, [pid]);
      // The exact session-row holder identifies this reader. Its compiled
      // projection can exceed pg_stat_activity's truncated SQL prefix.
      expect(waiting.rows.length).toBeLessThanOrEqual(1);
      const readerPid = waiting.rows[0]?.pid;
      if (readerPid !== undefined) return { reading, verdict, readerPid, release };
      if (captureSettled) {
        Result.getOrThrowWith(await verdict, cause => cause);
        throw new Error("Named capture completed before waiting on the actual claim row");
      }
      await delay(25);
    }
    throw new Error("Named capture did not wait on the actual claim row");
  } catch (cause) {
    await release();
    await reading?.catch(() => undefined);
    throw cause;
  }
}

export async function withInstalledFiniteKernelFixture(label: string, expireSoon: boolean,
  work: (persistence: PostgresFlarexPersistence, fixture: Awaited<ReturnType<typeof finiteBarrierFixture>>,
    owner: Awaited<ReturnType<typeof createFileScopedPostgresFixture>>,
    controlOwner: Awaited<ReturnType<typeof createFileScopedPostgresFixture>>,
    installation: Awaited<ReturnType<typeof createCoLocatedReadInstallationFixture>>["installation"]) => Promise<void>,
  existingOwners?: Readonly<{
    targetOwner: Awaited<ReturnType<typeof createFileScopedPostgresFixture>>;
    controlOwner: Awaited<ReturnType<typeof createFileScopedPostgresFixture>>;
  }>) {
  const disposals: Array<() => Promise<void>> = [];
  const failures: unknown[] = [];
  let operationFailed = false;
  try {
    const targetOwner = existingOwners?.targetOwner ?? await createFileScopedPostgresFixture();
    if (existingOwners === undefined) disposals.unshift(targetOwner.dispose);
    const controlOwner = existingOwners?.controlOwner ?? await createFileScopedPostgresFixture();
    if (existingOwners === undefined) disposals.unshift(controlOwner.dispose);
    const fixture = await finiteBarrierFixture(targetOwner.persistence, label, false,
      { ...sharedLocator(`installed-finite-${label}`), schemaName: targetOwner.schemaName });
    // Placement is owned by the actual control installation; the existing
    // target owner created the genuine single session anchor and reservation.
    const deployment = await targetOwner.persistence.getDeploymentMetadata(fixture.context.deploymentId);
    if (deployment === null) throw new Error("Missing actual finite fixture deployment");
    await controlOwner.persistence.insertDeploymentMetadata(deployment);
    await controlOwner.persistence.insertScopeMetadata({ deploymentId: fixture.context.deploymentId,
      scopeId: fixture.context.scopeId, physicalLocator: fixture.context.physicalLocator });
    const targetRuntime = await createProtectedFileScopedPostgresFixture("managed", targetOwner, "finiteCapture");
    disposals.unshift(targetRuntime.dispose);
    const controlRuntime = await createProtectedFileScopedPostgresFixture("managed", controlOwner);
    disposals.unshift(controlRuntime.dispose);
    const pair = await createCoLocatedReadInstallationFixture({ target: targetRuntime,
      control: controlRuntime, controlOwner });
    const refs = Result.getOrThrow(getCoLocatedReadInstallationReferencesResult(pair.installation, targetRuntime.persistence.drizzle));
    const controlProtection = await runEffect(prepareProtectedMetadata(targetRuntime.persistence.drizzle, refs.controlInstallation));
    const target = createPostgresLocatedPointMutationSessionActivationTargetV1(targetRuntime.persistence,
      fixture.context.physicalLocator, { managedInstallation: { installation: pair.installation, controlProtection } });
    if (!isLocatedExactRunningAttemptKernelV1(target) || !(CAPTURE_FINITE_STORAGE in target))
      throw new Error("Expected installed full and compact attempt facets");
    if (expireSoon) await targetOwner.persistence.query(`update fx_system_tx_session
      set finite_claim_expires_at=least(finite_claim_expires_at, statement_timestamp()+interval '2 seconds'),
      finite_lease_expires_at=statement_timestamp()+interval '2 seconds' where session_id=$1`, [fixture.activated.anchor.sessionId]);
    await work(targetRuntime.persistence, { ...fixture, target }, targetOwner, controlOwner, pair.installation);
  } catch (cause) {
    operationFailed = true;
    failures.push(cause);
  } finally {
    for (const dispose of disposals) {
      try { await dispose(); }
      catch (cause) { failures.push(cause); }
    }
  }
  if (operationFailed && failures.length === 1) throw failures[0];
  if (failures.length > 0) throw new AggregateError(failures, operationFailed
    ? "Installed finite fixture operation and cleanup failed" : "Installed finite fixture cleanup failed");
}

export async function finiteBarrierFixture(persistence: PostgresFlarexPersistence, label: string, expireSoon = true,
  physicalLocator?: SharedDatabaseScopePhysicalLocator) {
  const configuredSchema = /^-c search_path=([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(persistence.pool.options.options ?? "")?.[1];
  if (physicalLocator === undefined && configuredSchema === undefined)
    throw new Error("Finite fixture needs its actual configured physical schema");
  const selectedLocator = physicalLocator ?? { ...sharedLocator(`finite-barrier-${label}`), schemaName: configuredSchema! };
  const ids = uuidFactory();
  const context = await provisionContext(persistence, `finite_barrier_${label}`, selectedLocator, ids);
  const prepared = pointMutationSessionActivationFixture(context.deploymentId, context.scopeId);
  const activated = await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
    const locked = yield* lockScopeClockForUpdateInTransactionEffect(tx, context.scopeId);
    const nowRows = yield* Effect.tryPromise({ try: () => tx.execute(sql`select floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text as now`), catch: cause => cause });
    const nowValue = rowsFromDriverExecuteResult(nowRows, () => { throw new Error("Missing primitive fixture DB time rows"); })[0];
    if (typeof nowValue !== "object" || nowValue === null || !("now" in nowValue) || typeof nowValue.now !== "string")
      return yield* Effect.die("Missing primitive fixture DB time");
    const databaseNow = new Date(Number(nowValue.now));
    const sessionId = TransactionSessionIdV1Schema.make(ids());
    const attemptFence = TransactionAttemptFenceSchema.make(1n);
    const snapshotToken = SnapshotTokenSchema.make({ scopeId: context.scopeId, epoch: locked.epoch, commitSeq: locked.lastCommitSeq });
    const reservation = yield* captureFiniteMetadataReservation({ deploymentId: context.deploymentId, scopeId: context.scopeId,
      sessionId, attemptFence, storageGeneration: "flarexdb_v1", storageGenerationFence: locked.storageGenerationFence,
      snapshotToken, schemaVersionId: prepared.evidence.schemaVersionId, metadataWatermark: MetadataSequenceSchema.make(0n),
      application: { revisionId: "controlled_barrier_fixture", activationSequence: "1", headSha256: "a".repeat(64),
        activationSha256: "b".repeat(64), schemaVersionId: prepared.evidence.schemaVersionId, manifestSha256: "c".repeat(64) }, binding: null });
    const anchorCapture = yield* captureFiniteAttemptAnchor({ snapshotToken, reservation });
    const projected = yield* Effect.fromResult(projectCapturedFiniteAttemptAnchor(anchorCapture));
    const hardExpiresAt = prepared.evidence.authorizationGrantExpiresAt;
    const leaseExpiresAt = new Date(databaseNow.getTime() + (expireSoon ? 2_000 : 60_000));
    const claim = yield* Effect.fromResult(deriveTransactionExecutionClaimV1({ scopeUuid: Result.getOrThrow(projectScopeIdUuidV1Result(context.scopeId)).scopeUuid, sessionId, attemptFence,
      claimFence: 1n, claimOwner: ids(), databaseNow, durationMilliseconds: 60_000, leaseExpiresAt,
      authorizationGrantExpiresAt: hardExpiresAt, hardExpiresAt }));
    const row = { scopeUuid: Result.getOrThrow(projectScopeIdUuidV1Result(context.scopeId)).scopeUuid, sessionId, ...prepared.evidence, ...projected,
      executionAuthorityGeneration: "legacy_dynamic_worker_v1" as const, applicationExecutionAuthorityJson: null,
      applicationExecutionAuthorityCanonicalBytes: null, applicationExecutionAuthoritySha256: null,
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"), storageGenerationFence: locked.storageGenerationFence,
      lifecycle: "running" as const, attemptFence, protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1, hardExpiresAt,
      createdAt: databaseNow, updatedAt: databaseNow, finiteLeaseExpiresAt: leaseExpiresAt,
      finiteClaimOwner: claim.claimOwner, finiteClaimFence: claim.claimFence, finiteClaimedAt: claim.claimedAt, finiteClaimExpiresAt: claim.claimExpiresAt,
    } satisfies typeof fxSystemTransactionSessions.$inferSelect;
    const stored = yield* Effect.tryPromise({ try: () => tx.insert(fxSystemTransactionSessions).values(row).returning(), catch: cause => cause });
    if (stored.length !== 1 || stored[0] === undefined) return yield* Effect.die("Missing primitive finite anchor insert");
    const finite = yield* readFiniteAttemptAnchorRow(stored[0], anchorCapture);
    const kernel = yield* finiteEntryAttemptContextFromAnchor(finite, context.deploymentId, locked, databaseNow);
    expect(kernel.executionAuthorityGeneration).toBe("legacy_dynamic_worker_v1");
    expect(kernel.session.executionProfile).toBe("finiteRoot");
    expect(kernel.session.finiteAttemptBytes).toBeInstanceOf(Uint8Array);
    expect(kernel.finiteAttempt.snapshotToken).toEqual(kernel.anchor.snapshotToken);
    return { status: "created" as const, anchor: kernel.anchor, executionClaim: kernel.executionClaim, anchorCapture };
  })));
  rememberPrimitiveActivationClaim(activated.anchor, activated.executionClaim);
  let target: LocatedReadCommittedAttemptTargetV1;
  const originalScopeAuthorityResolutionPorts = {
    scopeMetadata: persistence, provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => { throw new Error("Shared scope has no split receipt"); },
    }, scopeClockTargets: { resolve: async () => target },
  };
  const candidate = createPostgresLocatedPointMutationSessionActivationTargetV1(persistence, context.physicalLocator,
    { [FINITE_STORAGE_CAPTURE_AUTHORITY]: originalScopeAuthorityResolutionPorts });
  if (!isLocatedExactRunningAttemptKernelV1(candidate)) throw new Error("Missing genuine located transaction owner");
  target = candidate;
  const located = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(context.deploymentId, originalScopeAuthorityResolutionPorts));
  if (!isLocatedExactRunningAttemptKernelV1(located.target) || !(CAPTURE_FINITE_STORAGE in located.target))
    throw new Error("Expected full and finite attempt owner facets");
  const input = { selector: selectorFromAnchor(activated.anchor), preliminaryAuthority: located.authority,
    executionClaim: executionClaimForAnchor(activated.anchor), finiteAnchor: activated.anchorCapture };
  return { context, activated, target: located.target, input };
}

export async function expectInstalledRefusalBeforeClaimRelease(
  fixture: Awaited<ReturnType<typeof finiteBarrierFixture>>, owner: PostgresFlarexPersistence,
  expected: Readonly<Record<string, unknown>>) {
  const holder = await owner.pool.connect();
  let pending: Promise<unknown> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let callbacks = 0;
  try {
    await holder.query("begin");
    const held = await holder.query(`select session_id from fx_system_tx_session
      where session_id = $1 for update`, [fixture.activated.anchor.sessionId]);
    expect(held.rows).toHaveLength(1);
    pending = runFailure(captureFiniteStorageEffect(fixture.target, fixture.input, { kind: "transactionTime" }).pipe(Effect.tap(() => Effect.sync(() => { callbacks++; }))));
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Installed admission waited for a later execution-claim lock")), 2_000);
    });
    // The holder remains locked until finally. A later-lock regression fails
    // this bounded witness, then releases the blocker and drains the request.
    expect(await Promise.race([pending, deadline])).toMatchObject(expected);
    expect(callbacks).toBe(0);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await rollbackAndReleasePostgresClient(holder);
    await pending?.catch(() => undefined);
  }
}

export async function captureExpiredFiniteFixtureRecovery(persistence: PostgresFlarexPersistence,
  fixture: Awaited<ReturnType<typeof finiteBarrierFixture>>) {
  // Expiry makes the original data capability unavailable. Acquisition returns
  // inert recovery evidence; only the resolver can fence nonacceptance.
  await runEffect(captureFiniteStorageEffect(fixture.target,
    fixture.input, { kind: "transactionTime" }));
  await expireFiniteExecutionClaim(persistence, fixture.activated.anchor.sessionId);
  await expectFiniteRefusalBeforeData(persistence, fixture, fixture.input, "expired");
  const before = await persistence.drizzle.select().from(fxSystemTransactionSessions)
    .where(eq(fxSystemTransactionSessions.sessionId, fixture.activated.anchor.sessionId));
  const acquired = await runEffect(createExecutionClaimAcquisition(persistence,
    "64000000-0000-4000-8000-000000000901").acquireEffect(fixture.input.selector));
  if (acquired.kind !== "finiteRecovery") throw new Error("Expected inert finite recovery capture");
  const recovery = Result.getOrThrow(readFiniteRecoveryAttempt(acquired.capture));
  expect(recovery.anchor.sessionId).toBe(fixture.activated.anchor.sessionId);
  expect(recovery.anchor.snapshotToken).toEqual(fixture.activated.anchor.snapshotToken);
  expect(recovery.executionClaim.claimOwner).toBe(fixture.input.executionClaim.claimOwner);
  expect(recovery.executionClaim.claimFence).toBe(fixture.input.executionClaim.claimFence);
  expect(await persistence.drizzle.select().from(fxSystemTransactionSessions)
    .where(eq(fxSystemTransactionSessions.sessionId, fixture.activated.anchor.sessionId))).toEqual(before);
  await expectFiniteRefusalBeforeData(persistence, fixture, fixture.input, "expired");
  return fixture.input;
}

export async function expectFiniteRefusalBeforeData(persistence: PostgresFlarexPersistence,
  fixture: Awaited<ReturnType<typeof finiteBarrierFixture>>, input: ExactRunningAttemptKernelInputV1, reason: string) {
  const inventory = () => persistence.query(`select to_jsonb(s) as session from fx_system_tx_session s
    where s.scope_uuid = $1 and s.session_id = $2`,
    [Result.getOrThrow(projectScopeIdUuidV1Result(fixture.context.scopeId)).scopeUuid, fixture.activated.anchor.sessionId]);
  const before = await inventory();
  expect(before.rows).toHaveLength(1);
  let reachedData = false;
  const failure = await runFailure(captureFiniteStorageEffect(fixture.target, input, { kind: "transactionTime" }).pipe(Effect.tap(() => Effect.sync(() => { reachedData = true; }))));
  expect(failure).toMatchObject({ _tag: "FiniteStorageCaptureError", reason });
  expect(reachedData).toBe(false);
  expect(await inventory()).toEqual(before);
}

export async function waitForAuthorityWaiter(persistence: PostgresFlarexPersistence, blockerPid: number, authorityWriter = true) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ waiting: boolean }>(`select exists(select 1 from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
        and $1::int = any(pg_blocking_pids(pid))
        and ($2::boolean = false or query like '%fx_system_scope_execution_authority%')) as waiting`,
    [blockerPid, authorityWriter]);
    if (result.rows[0]?.waiting === true) return;
    await delay(25);
  }
  throw new Error("No expected blocked authority transaction");
}

export async function waitForFiniteLeaseExpiry(persistence: PostgresFlarexPersistence, sessionId: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const row = await persistence.query<{ expired: boolean }>(`select finite_lease_expires_at <= clock_timestamp() as expired
      from fx_system_tx_session where session_id = $1`, [sessionId]);
    if (row.rows[0]?.expired === true) return;
    await delay(25);
  }
  throw new Error("Lease did not expire while its owner was blocked");
}
