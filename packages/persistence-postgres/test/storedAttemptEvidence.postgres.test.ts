import { Effect, Exit, Fiber, Schema } from "effect";
import { Client } from "pg";
import {
  CommitEnvelopeV1Schema,
  SESSION_JOURNAL_FORMAT_V1,
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { TRANSACTION_SESSION_PROTOCOL_VERSION_V1 } from "flarex-protocol/transaction-session";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "flarex-protocol/value";
import { describe, expect, it, vi } from "vitest";

import {
  createPointMutationSessionAttemptLoadingV1,
  type PointMutationSessionAttemptSelectorWireV1,
} from "../../executor/src/pointMutationSessionActivation";
import {
  createStoredAttemptAuthenticationV1,
} from "../../executor/src/storedAttemptAuthentication";
import {
  createPointCommitFinishingTransitionPortV1,
} from "../src/pointCommitTransaction";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import type { LocatedScopeClockReader } from "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  createSessionJournalStorePersistenceV1,
  type SessionJournalAttemptV1,
} from "../src/sessionJournalStore";
import {
  createStoredCommitAuthorityEvidenceLoaderV1,
  type StoredCommitAuthorityEvidenceAuthorityV1,
  type StoredCommitAuthorityEvidenceQueryV1,
} from "../src/storedCommitAuthorityEvidence";
import {
  createStoredAttemptEvidenceLoaderV1,
  type StoredAttemptEvidenceAuthorityV1,
  type StoredAttemptEvidenceLoadResultV1,
  type StoredAttemptEvidenceLoaderOptionsV1,
  type StoredAttemptEvidenceQueryV1,
} from "../src/storedAttemptEvidence";
import {
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import {
  pointCommitFinishingCommandFromStoredAttemptV1,
} from "./pointCommitTransactionTestSupport";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import {
  completeSessionJournalSeal as completeSeal,
  prepareSessionJournalSeal as prepareSeal,
  runEffect,
} from "./effectTestRuntime";
import {
  activatePointMutationSession,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const encodeEnvelope = Schema.encodeSync(CommitEnvelopeV1Schema);

describePostgres("real Postgres stored-attempt authority", () => {
  it("closes repeatable read before hashing and binds one complete sealed snapshot", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const observedQueries = new Map<
        StoredAttemptEvidenceQueryV1["name"],
        StoredAttemptEvidenceQueryV1
      >();
      const current = await scenario(persistence, "closed_before_hash", {
        observeQuery: (query) => {
          observedQueries.set(query.name, query);
        },
      });
      const prepared = await prepareSeal(current.store, current.attempt);
      const journal = await runEffect(
        canonicalizeSessionJournalV1Effect(prepared.journal),
      );
      const result = await runEffect(
        canonicalizeSuccessfulResultV1Effect({ ok: true }),
      );
      const envelope = await completeSeal(current.store,
        prepared.preparation,
        journal,
        result,
      );
      const loadedAttempt = await current.loading.load(selectorWire(
        current.anchor,
      ));
      const authentication = createStoredAttemptAuthenticationV1(
        current.loader,
      );
      const authority = await runEffect(
        authentication.deriveAuthority(loadedAttempt),
      );
      const before = await attemptTimestamps(
        persistence,
        current.anchor.sessionId,
      );

      const digestEntered = deferredSignal();
      const releaseDigest = deferredSignal();
      const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
      let gatedDigest = false;
      const digestSpy = vi.spyOn(crypto.subtle, "digest").mockImplementation(
        async (algorithm, data) => {
          if (!gatedDigest) {
            gatedDigest = true;
            digestEntered.resolve();
            await releaseDigest.promise;
          }
          return originalDigest(algorithm, data);
        },
      );
      const authenticationPromise = runEffect(authentication.authenticate(
        authority,
        encodeEnvelope(envelope),
      ));
      await digestEntered.promise;

      const locker = await persistence.pool.connect();
      let lockTransactionOpen = false;
      try {
        await locker.query("begin");
        lockTransactionOpen = true;
        await locker.query("set local lock_timeout = '2s'");
        await locker.query(`
          lock table
            fx_system_tx_session,
            fx_system_snapshot_lease,
            fx_system_tx_journal,
            fx_system_tx_journal_point
          in access exclusive mode nowait
        `);
        await locker.query("rollback");
        lockTransactionOpen = false;
      } finally {
        if (lockTransactionOpen) {
          await locker.query("rollback").catch(() => undefined);
        }
        locker.release();
        releaseDigest.resolve();
      }
      let authenticated: Awaited<typeof authenticationPromise>;
      try {
        authenticated = await authenticationPromise;
      } finally {
        releaseDigest.resolve();
        digestSpy.mockRestore();
      }

      expect(authentication.isAuthenticated(authenticated)).toBe(true);
      expect(await attemptTimestamps(
        persistence,
        current.anchor.sessionId,
      )).toEqual(before);
      const plans = await lookupPlans(persistence, observedQueries);
      expect(plans.session).toContain("Index Scan");
      expect(plans.session).toContain("session_id");
      expect(plans.sessionPrimaryKey).toContain("scope_uuid, session_id");
      expect(plans.lease).toContain(
        "fx_system_snapshot_lease_scope_uuid_session_id_pk",
      );
      expect(plans.root).toContain("fx_system_tx_journal_pk");
      expect(plans.points).toContain("fx_system_tx_journal_point_pk");
    });
  }, 120_000);

  it("bootstraps finishing recovery through the same bounded indexed snapshot", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const current = await scenario(persistence, "finishing_recovery");
      await sealScenario(current);
      const running = await runEffect(
        current.loader.loadEffect(current.authority),
      );
      if (running.kind !== "loaded") {
        throw new Error(`Expected running evidence, received ${running.kind}.`);
      }
      await runEffect(
        createPointCommitFinishingTransitionPortV1(
          resolutionPorts(persistence),
        ).enterFinishing(
          await pointCommitFinishingCommandFromStoredAttemptV1(
            current.authority,
            running.evidence,
          ),
        ),
      );

      const observedQueries = new Map<
        StoredAttemptEvidenceQueryV1["name"],
        StoredAttemptEvidenceQueryV1
      >();
      const recoveryLoader = createStoredAttemptEvidenceLoaderV1(
        resolutionPorts(persistence),
        { observeQuery: (query) => observedQueries.set(query.name, query) },
      );
      const recovered = await runEffect(recoveryLoader.loadFinishingEffect({
        deploymentId: current.anchor.deploymentId,
        scopeId: current.anchor.scopeId,
        sessionId: current.anchor.sessionId,
        attemptFence: current.anchor.attemptFence,
      }));
      expect(recovered).toMatchObject({
        kind: "loaded",
        evidence: { session: { lifecycle: "finishing" } },
      });
      expect([...observedQueries.keys()]).toEqual([
        "clock",
        "databaseTime",
        "session",
        "lease",
        "root",
        "points",
      ]);
      const plans = await lookupPlans(persistence, observedQueries);
      expect(plans.session).toContain("Index Scan");
      expect(plans.lease).toContain(
        "fx_system_snapshot_lease_scope_uuid_session_id_pk",
      );
      expect(plans.root).toContain("fx_system_tx_journal_pk");
      expect(plans.points).toContain("fx_system_tx_journal_point_pk");
    });
  }, 120_000);

  it("holds interruption until the finishing-recovery snapshot settles", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const current = await scenario(persistence, "finishing_recovery_interrupt");
      await sealScenario(current);
      const running = await runEffect(
        current.loader.loadEffect(current.authority),
      );
      if (running.kind !== "loaded") {
        throw new Error(`Expected running evidence, received ${running.kind}.`);
      }
      await runEffect(
        createPointCommitFinishingTransitionPortV1(
          resolutionPorts(persistence),
        ).enterFinishing(
          await pointCommitFinishingCommandFromStoredAttemptV1(
            current.authority,
            running.evidence,
          ),
        ),
      );

      const entered = deferredSignal();
      const release = deferredSignal();
      let interruptionSettled = false;
      const loader = createStoredAttemptEvidenceLoaderV1(
        resolutionPorts(persistence),
        {
          beforeRepeatableReadClose: async () => {
            entered.resolve();
            await release.promise;
          },
        },
      );
      const fiber = Effect.runFork(loader.loadFinishingEffect({
        deploymentId: current.anchor.deploymentId,
        scopeId: current.anchor.scopeId,
        sessionId: current.anchor.sessionId,
        attemptFence: current.anchor.attemptFence,
      }));
      await entered.promise;
      const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
        interruptionSettled = true;
        return exit;
      });
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        expect(interruptionSettled).toBe(false);
      } finally {
        release.resolve();
      }
      await interruption;
      expect(interruptionSettled).toBe(true);
      expect(Exit.hasInterrupts(await runEffect(Fiber.await(fiber)))).toBe(true);
    });
  }, 120_000);

  it("linearizes seal/load and treats detached success as non-authoritative", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const racing = await scenario(persistence, "seal_load_race");
      const prepared = await prepareSeal(racing.store, racing.attempt);
      const journal = await runEffect(
        canonicalizeSessionJournalV1Effect(prepared.journal),
      );
      const result = await runEffect(
        canonicalizeSuccessfulResultV1Effect(null),
      );
      const [loadResult, envelope] = await Promise.all([
        runEffect(racing.loader.loadEffect(racing.authority)),
        completeSeal(racing.store, prepared.preparation, journal, result),
      ]);
      expect(["loaded", "notPlannable"]).toContain(loadResult.kind);
      if (loadResult.kind === "loaded") {
        expect(loadResult.evidence.root.sealedFinalSyscallSequence).toBe(0n);
      } else {
        expect(loadResult).toMatchObject({
          kind: "notPlannable",
          reason: "rootNotSealed",
        });
      }

      const loadedAttempt = await racing.loading.load(selectorWire(
        racing.anchor,
      ));
      const authentication = createStoredAttemptAuthenticationV1(
        racing.loader,
      );
      const authority = await runEffect(
        authentication.deriveAuthority(loadedAttempt),
      );
      const authenticated = await runEffect(authentication.authenticate(
        authority,
        encodeEnvelope(envelope),
      ));
      expect(authentication.isAuthenticated(authenticated)).toBe(true);

      await persistence.query(
        `
          update fx_system_tx_session
          set lifecycle = 'expired', updated_at = clock_timestamp()
          where session_id = $1
        `,
        [racing.anchor.sessionId],
      );
      expect(authentication.isAuthenticated(authenticated)).toBe(true);
      await expect(runEffect(
        racing.loader.loadEffect(racing.authority),
      )).resolves
        .toMatchObject({
          kind: "notPlannable",
          reason: "lifecycle",
          lifecycle: "expired",
        });
    });
  }, 120_000);

  it("captures C04B1 authority coherently and closes SQL before schema hashing", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const current = await scenario(persistence, "commit_authority_rr");
      const prepared = await prepareSeal(current.store, current.attempt);
      const journal = await runEffect(
        canonicalizeSessionJournalV1Effect(prepared.journal),
      );
      const result = await runEffect(
        canonicalizeSuccessfulResultV1Effect({ ok: true }),
      );
      await completeSeal(current.store,
        prepared.preparation,
        journal,
        result,
      );
      const stored = await runEffect(
        current.loader.loadEffect(current.authority),
      );
      if (stored.kind !== "loaded") throw new Error("Expected C04A evidence.");
      const authority = commitAuthorityFromStoredEvidence(
        current.authority,
        stored.evidence,
      );
      const observed = new Map<
        StoredCommitAuthorityEvidenceQueryV1["name"],
        StoredCommitAuthorityEvidenceQueryV1
      >();
      const loader = createStoredCommitAuthorityEvidenceLoaderV1(
        resolutionPorts(persistence),
        { observeQuery: (query) => observed.set(query.name, query) },
      );
      const digestEntered = deferredSignal();
      const releaseDigest = deferredSignal();
      const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
      let gatedDigest = false;
      const digestSpy = vi.spyOn(crypto.subtle, "digest").mockImplementation(
        async (algorithm, data) => {
          if (!gatedDigest) {
            gatedDigest = true;
            digestEntered.resolve();
            await releaseDigest.promise;
          }
          return originalDigest(algorithm, data);
        },
      );
      const loadPromise = runEffect(loader.loadEffect(authority));
      await digestEntered.promise;

      const locker = await persistence.pool.connect();
      let lockTransactionOpen = false;
      try {
        await locker.query("begin");
        lockTransactionOpen = true;
        await locker.query("set local lock_timeout = '2s'");
        await locker.query(`
          lock table
            fx_system_scope_clock,
            fx_system_tx_session,
            fx_system_snapshot_lease,
            fx_system_tx_journal,
            fx_control_schema_version,
            fx_control_table
          in access exclusive mode nowait
        `);
        await locker.query("rollback");
        lockTransactionOpen = false;
      } finally {
        if (lockTransactionOpen) {
          await locker.query("rollback").catch(() => undefined);
        }
        locker.release();
        releaseDigest.resolve();
      }
      let loaded: Awaited<typeof loadPromise>;
      try {
        loaded = await loadPromise;
      } finally {
        releaseDigest.resolve();
        digestSpy.mockRestore();
      }
      expect(loaded).toMatchObject({ kind: "loaded" });
      expect([...observed.keys()]).toEqual([
        "clock",
        "authoritySizes",
        "lease",
        "root",
        "schemaSizes",
        "authorityPayload",
        "schemaPayload",
        "stableBindings",
      ]);
      const authorityPlan = await explainCommitAuthorityObserved(
        persistence,
        requireCommitObservedQuery(observed, "authoritySizes"),
      );
      const schemaPlan = await explainCommitAuthorityObserved(
        persistence,
        requireCommitObservedQuery(observed, "schemaSizes"),
      );
      expect(authorityPlan).toContain("fx_system_tx_session");
      expect(authorityPlan).toContain("Index Scan");
      expect(schemaPlan).toContain("fx_control_schema_version");
      expect(schemaPlan).toContain("Index Scan");
    });
  }, 120_000);

  it("keeps one coherent C04B1 snapshot across revocation and uses database-time expiry", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const racing = await scenario(persistence, "commit_authority_race");
      await sealScenario(racing);
      const racingStored = await runEffect(
        racing.loader.loadEffect(racing.authority),
      );
      if (racingStored.kind !== "loaded") {
        throw new Error("Expected C04A racing evidence.");
      }
      const racingAuthority = commitAuthorityFromStoredEvidence(
        racing.authority,
        racingStored.evidence,
      );
      if (postgresUrl === null) {
        throw new Error("Real Postgres URL disappeared during the test.");
      }
      const schemaResult = await persistence.pool.query<{
        schema_name: string;
      }>("select current_schema() as schema_name");
      const schemaName = schemaResult.rows[0]?.schema_name;
      if (schemaName === undefined) {
        throw new Error("Missing temporary Postgres schema.");
      }
      const revocationClient = new Client({ connectionString: postgresUrl });
      await revocationClient.connect();
      await revocationClient.query(
        "select set_config('search_path', $1, false)",
        [schemaName],
      );
      await revocationClient.query("set lock_timeout = '5s'");
      let revocationCommitted = false;
      const racingLoader = createStoredCommitAuthorityEvidenceLoaderV1(
        resolutionPorts(persistence),
        {
          afterSizeProjection: async () => {
            if (revocationCommitted) return;
            await revocationClient.query(
              `
                update fx_system_scope_clock
                set authorization_revocation_epoch =
                  authorization_revocation_epoch + 1
                where scope_id = $1
              `,
              [racing.anchor.scopeId],
            );
            revocationCommitted = true;
          },
        },
      );
      try {
        await expect(runEffect(racingLoader.loadEffect(racingAuthority))).resolves
          .toMatchObject({ kind: "loaded" });
        expect(revocationCommitted).toBe(true);
        await expect(runEffect(
          createStoredCommitAuthorityEvidenceLoaderV1(
            resolutionPorts(persistence),
          ).loadEffect(racingAuthority),
        )).resolves.toMatchObject({
          kind: "authorityMismatch",
          reason: "revocationEpochChanged",
        });
      } finally {
        await revocationClient.end();
      }

      const expired = await scenario(persistence, "commit_authority_expired");
      await sealScenario(expired);
      const expiredStored = await runEffect(
        expired.loader.loadEffect(expired.authority),
      );
      if (expiredStored.kind !== "loaded") {
        throw new Error("Expected C04A expiry evidence.");
      }
      const expiredAuthority = commitAuthorityFromStoredEvidence(
        expired.authority,
        expiredStored.evidence,
      );
      await persistence.query(
        `
          update fx_system_snapshot_lease
          set lease_expires_at = clock_timestamp() - interval '1 millisecond'
          where session_id = $1
        `,
        [expired.anchor.sessionId],
      );
      await expect(runEffect(
        createStoredCommitAuthorityEvidenceLoaderV1(
          resolutionPorts(persistence),
        ).loadEffect(expiredAuthority),
      )).resolves.toMatchObject({ kind: "notPlannable", reason: "expired" });
    });
  }, 120_000);
});

interface Scenario {
  readonly anchor: PointMutationSessionAnchorV1;
  readonly authority: StoredAttemptEvidenceAuthorityV1;
  readonly store: ReturnType<typeof createSessionJournalStorePersistenceV1>;
  readonly attempt: SessionJournalAttemptV1;
  readonly loader: ReturnType<typeof createStoredAttemptEvidenceLoaderV1>;
  readonly loading: ReturnType<
    typeof createPointMutationSessionAttemptLoadingV1
  >;
}

async function scenario(
  persistence: PostgresFlarexPersistence,
  label: string,
  loaderOptions: StoredAttemptEvidenceLoaderOptionsV1 = {},
): Promise<Scenario> {
  const randomUuid = uuidFactory("94000000");
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_stored_attempt_postgres_${label}`,
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_stored_attempt_postgres_${label}`,
  );
  const locator = sharedLocator(`stored-attempt-${label}`);
  const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
    persistence,
    { physicalLocator: locator, randomUuid },
  ).ensure({
    deploymentId,
    projectId: `project_stored_attempt_postgres_${label}`,
  });
  const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
  await setFlarexActivationClock(persistence, scopeId);
  await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [appTable("users")],
    indexes: [],
  });
  const ports = resolutionPorts(persistence);
  const activation = await activatePointMutationSession(
    createPointMutationSessionActivationPersistenceV1(
      ports,
      { leaseDurationMilliseconds: 60_000, randomUuid },
    ),
    pointMutationSessionActivationFixture(
      deploymentId,
      scopeId,
      { evidence: { schemaVersionId } },
    ),
  );
  const store = createSessionJournalStorePersistenceV1(ports, {
    randomUuid,
  });
  const attempt = await runEffect(
    store.openAttemptEffect({
      selector: {
        deploymentId,
        scopeId,
        sessionId: activation.anchor.sessionId,
        attemptFence: activation.anchor.attemptFence,
      },
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId,
    }),
  );
  return Object.freeze({
    anchor: activation.anchor,
    authority: Object.freeze({
      deploymentId,
      scopeId,
      sessionId: activation.anchor.sessionId,
      attemptFence: activation.anchor.attemptFence,
      storageGeneration: activation.anchor.storageGeneration,
      storageGenerationFence: activation.anchor.storageGenerationFence,
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId,
    }),
    store,
    attempt,
    loader: createStoredAttemptEvidenceLoaderV1(ports, loaderOptions),
    loading: createPointMutationSessionAttemptLoadingV1(
      createPointMutationSessionAttemptLoadPersistenceV1(ports),
    ),
  });
}

async function sealScenario(current: Scenario): Promise<void> {
  const prepared = await prepareSeal(current.store, current.attempt);
  const journal = await runEffect(
    canonicalizeSessionJournalV1Effect(prepared.journal),
  );
  const result = await runEffect(
    canonicalizeSuccessfulResultV1Effect({ ok: true }),
  );
  await completeSeal(current.store, prepared.preparation, journal, result);
}

function resolutionPorts(
  persistence: PostgresFlarexPersistence,
): PointMutationSessionAuthorityResolutionPortsV1 {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared placement must not read split receipts.");
      },
    },
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createPostgresLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
        ),
    },
  };
}

function commitAuthorityFromStoredEvidence(
  authority: Scenario["authority"],
  evidence: Extract<
    StoredAttemptEvidenceLoadResultV1,
    { readonly kind: "loaded" }
  >["evidence"],
): StoredCommitAuthorityEvidenceAuthorityV1 {
  return Object.freeze({
    ...authority,
    session: Object.freeze(structuredClone(evidence.session)),
    sealIdentity: Object.freeze({
      scopeUuid: evidence.scopeUuid,
      lifecycle: evidence.session.lifecycle,
      sessionUpdatedAtMilliseconds: evidence.session.updatedAtMilliseconds,
      leaseExpiresAtMilliseconds: evidence.lease.leaseExpiresAtMilliseconds,
      rootCreatedAtMilliseconds: evidence.root.createdAtMilliseconds,
      rootUpdatedAtMilliseconds: evidence.root.updatedAtMilliseconds,
      sealedAtMilliseconds: evidence.root.sealedAtMilliseconds,
      finalSyscallSequence: evidence.root.sealedFinalSyscallSequence,
      creationTimeSeed: evidence.root.creationTimeSeed,
      nextCreationTime: evidence.root.nextCreationTime,
      journalFormat: SESSION_JOURNAL_FORMAT_V1,
      journalProtocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
      journalValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      journalByteLength: evidence.root.journalBytes.byteLength,
      journalSha256: new Uint8Array(evidence.root.journalSha256),
      resultValueCodecVersion: evidence.root.resultValueCodecVersion,
      resultSemanticBytes: evidence.root.resultSemanticBytes,
      resultByteLength: evidence.root.resultBytes.byteLength,
      resultSha256: new Uint8Array(evidence.root.resultSha256),
      readDocuments: evidence.root.readDocuments,
      readSemanticBytes: evidence.root.readSemanticBytes,
      pointDependencyCount: evidence.root.pointDependencyCount,
      writeOperations: evidence.root.writeOperations,
      writeSemanticBytes: evidence.root.writeSemanticBytes,
      materialWriteEventEvidenceBytes:
        evidence.root.materialWriteEventEvidenceBytes,
    }),
  });
}

function selectorWire(
  anchor: PointMutationSessionAnchorV1,
): PointMutationSessionAttemptSelectorWireV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence.toString(),
  });
}

function sharedLocator(
  databaseKey: string,
): SharedDatabaseScopePhysicalLocator {
  return Object.freeze({
    kind: "shared_database",
    databaseKey,
    schemaName: "public",
  });
}

function appTable(
  logicalName: string,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          name: {
            fieldType: { type: "string" },
            optional: true,
          },
        },
      },
    },
  };
}

function uuidFactory(prefix: string): () => string {
  let sequence = 1;
  return () => {
    const suffix = sequence.toString().padStart(12, "0");
    sequence += 1;
    return `${prefix}-0000-4000-8000-${suffix}`;
  };
}

async function attemptTimestamps(
  persistence: PostgresFlarexPersistence,
  sessionId: PointMutationSessionAnchorV1["sessionId"],
): Promise<Readonly<Record<string, string>>> {
  const result = await persistence.query<Readonly<Record<string, string>>>(
    `
      select
        (select updated_at::text from fx_system_tx_session
          where session_id = $1) as session_updated_at,
        (select updated_at::text from fx_system_tx_journal
          where session_id = $1) as root_updated_at
    `,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing attempt timestamps.");
  return row;
}

async function lookupPlans(
  persistence: PostgresFlarexPersistence,
  queries: ReadonlyMap<
    StoredAttemptEvidenceQueryV1["name"],
    StoredAttemptEvidenceQueryV1
  >,
): Promise<Readonly<Record<
  "session" | "sessionPrimaryKey" | "lease" | "root" | "points",
  string
>>> {
  const client = await persistence.pool.connect();
  try {
    await client.query("set enable_seqscan = off");
    const sessionPrimaryKey = await client.query<{ definition: string }>(`
      select pg_get_indexdef(indexrelid) as definition
      from pg_index
      where indrelid = 'fx_system_tx_session'::regclass
        and indisprimary
    `);
    const sessionPrimaryKeyDefinition =
      sessionPrimaryKey.rows[0]?.definition;
    if (sessionPrimaryKeyDefinition === undefined) {
      throw new Error("Missing transaction-session primary key.");
    }
    return Object.freeze({
      session: await explainObserved(
        client,
        requireObservedQuery(queries, "session"),
      ),
      sessionPrimaryKey: sessionPrimaryKeyDefinition,
      lease: await explainObserved(
        client,
        requireObservedQuery(queries, "lease"),
      ),
      root: await explainObserved(
        client,
        requireObservedQuery(queries, "root"),
      ),
      points: await explainObserved(
        client,
        requireObservedQuery(queries, "points"),
      ),
    });
  } finally {
    client.release();
  }
}

function requireCommitObservedQuery(
  queries: ReadonlyMap<
    StoredCommitAuthorityEvidenceQueryV1["name"],
    StoredCommitAuthorityEvidenceQueryV1
  >,
  name: StoredCommitAuthorityEvidenceQueryV1["name"],
): StoredCommitAuthorityEvidenceQueryV1 {
  const query = queries.get(name);
  if (query === undefined) {
    throw new Error(`C04B1 loader did not execute its ${name} query.`);
  }
  return query;
}

async function explainCommitAuthorityObserved(
  persistence: PostgresFlarexPersistence,
  query: StoredCommitAuthorityEvidenceQueryV1,
): Promise<string> {
  const client = await persistence.pool.connect();
  try {
    await client.query("set enable_seqscan = off");
    const result = await client.query(
      `explain (format json) ${query.sql}`,
      [...query.params],
    );
    return JSON.stringify(result.rows);
  } finally {
    client.release();
  }
}

function requireObservedQuery(
  queries: ReadonlyMap<
    StoredAttemptEvidenceQueryV1["name"],
    StoredAttemptEvidenceQueryV1
  >,
  name: StoredAttemptEvidenceQueryV1["name"],
): StoredAttemptEvidenceQueryV1 {
  const query = queries.get(name);
  if (query === undefined) {
    throw new Error(`Loader did not execute its ${name} query.`);
  }
  return query;
}

async function explainObserved(
  client: {
    query(
      text: string,
      values?: readonly unknown[],
    ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
  },
  query: StoredAttemptEvidenceQueryV1,
): Promise<string> {
  const result = await client.query(
    `explain (format json) ${query.sql}`,
    query.params,
  );
  return JSON.stringify(result.rows);
}

function deferredSignal(): Readonly<{
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}> {
  let resolver: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return Object.freeze({
    promise,
    resolve: () => resolver?.(),
  });
}
