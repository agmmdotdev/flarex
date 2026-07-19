import { setTimeout as delay } from "node:timers/promises";

import { Effect, Fiber } from "effect";
import {
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { decodeReplacementScopeIdV1 } from
  "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { TransactionRequestKeyV1Schema } from
  "flarex-protocol/transaction-session";
import { describe, expect, it } from "vitest";

import {
  PointCommitCorruptionV1Error,
  PointCommitStaleAuthorityV1Error,
  createPointCommitFinishingTransitionPortV1,
  type PointCommitFinishingTransitionCommandV1,
  type PointCommitSqlOperationV1,
  type PointCommitTransactionProofOptionsV1,
} from "../src/pointCommitTransaction";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import type { LocatedScopeClockReader } from
  "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import { createSessionJournalStorePersistenceV1 } from
  "../src/sessionJournalStore";
import {
  createStoredAttemptEvidenceLoaderV1,
  type StoredAttemptEvidenceAuthorityV1,
} from "../src/storedAttemptEvidence";
import {
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import { pointCommitFinishingCommandFromStoredAttemptV1 } from
  "./pointCommitTransactionTestSupport";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import { runEffect, runEffectFailure as runFailure } from
  "./effectTestRuntime";
import {
  abortPointMutationSessionAttempt,
  activatePointMutationSession,
  executionClaimForAnchor,
  expirePointMutationSessionAttempt,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

interface ScopeScenario {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof decodeReplacementScopeIdV1>;
  readonly schemaVersionId: ReturnType<
    typeof CatalogSchemaVersionIdSchema.make
  >;
  readonly ports: PointMutationSessionAuthorityResolutionPortsV1;
}

interface AttemptScenario {
  readonly anchor: PointMutationSessionAnchorV1;
  readonly command: PointCommitFinishingTransitionCommandV1;
  readonly scope: ScopeScenario;
}

describePostgres("real Postgres C05-A finishing transition", () => {
  it("uses the canonical lock order, bounded projections, and index-backed plans", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("9b000000");
      const scope = await createScope(persistence, randomUuid, "lock_order");
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "lock_order",
      );
      const steps: string[] = [];
      const queries = new Map<
        PointCommitSqlOperationV1,
        Readonly<{ readonly sql: string; readonly params: ReadonlyArray<unknown> }>
      >();
      const result = await runEffect(createPort(persistence, attempt.scope, {
        afterTransactionStep: (event) => {
          steps.push(event.step);
          return Promise.resolve();
        },
        observeQuery: (query) => queries.set(query.name, query),
      }).enterFinishing(attempt.command));

      expect(result.kind).toBe("transitioned");
      expect(steps).toEqual([
        "clockLocked",
        "sessionLocked",
        "leaseLocked",
        "journalRootLocked",
        "executionClaimLocked",
        "executionClaimDeleted",
        "sessionEnteredFinishing",
      ]);
      expect([...queries.keys()]).toEqual([
        "lockScopeClock",
        "lockSession",
        "lockLease",
        "lockJournalRoot",
        "readDatabaseTime",
        "deleteExecutionClaim",
        "enterFinishing",
      ]);
      const sessionQuery = requireObservedQuery(queries, "lockSession");
      expect(sessionQuery.sql).not.toContain("validated_args_json");
      expect(sessionQuery.sql).not.toContain("authorization_grant_json");
      expect(requireObservedQuery(queries, "lockJournalRoot").sql).toContain(
        "octet_length",
      );
      for (const name of [
        "lockScopeClock",
        "lockSession",
        "lockLease",
        "lockJournalRoot",
        "deleteExecutionClaim",
        "enterFinishing",
      ] as const) {
        expect(await explainObserved(
          persistence,
          requireObservedQuery(queries, name),
        )).toContain("Index Scan");
      }
      expect(await lifecycleOf(persistence, attempt.anchor.sessionId)).toBe(
        "finishing",
      );
      expect(await executionClaimCount(
        persistence,
        attempt.anchor.sessionId,
      )).toBe(0);
    });
  }, 120_000);

  it("converges duplicate transitions and serializes one scope without blocking another", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("9c000000");
      const firstScope = await createScope(
        persistence,
        randomUuid,
        "serialized_a",
      );
      const otherScope = await createScope(
        persistence,
        randomUuid,
        "serialized_b",
      );
      const duplicate = await createAttempt(
        persistence,
        randomUuid,
        firstScope,
        "duplicate",
      );
      const first = await createAttempt(
        persistence,
        randomUuid,
        firstScope,
        "serialized_a1",
      );
      const second = await createAttempt(
        persistence,
        randomUuid,
        firstScope,
        "serialized_a2",
      );
      const independent = await createAttempt(
        persistence,
        randomUuid,
        otherScope,
        "serialized_b1",
      );
      expect(new Set([
        duplicate.anchor.sessionId,
        first.anchor.sessionId,
        second.anchor.sessionId,
      ]).size).toBe(3);
      expect(new Set([
        duplicate.command.session.requestKey,
        first.command.session.requestKey,
        second.command.session.requestKey,
      ]).size).toBe(3);

      const duplicateEntered = deferredSignal();
      const duplicateRelease = deferredSignal();
      const duplicateFirst = runEffect(createPort(
        persistence,
        duplicate.scope,
        {
          afterTransactionStep: async (event) => {
            if (event.step !== "clockLocked") return;
            duplicateEntered.resolve();
            await duplicateRelease.promise;
          },
        },
      ).enterFinishing(duplicate.command));
      await duplicateEntered.promise;
      const duplicateSecond = runEffect(
        createPort(persistence, duplicate.scope).enterFinishing(
          duplicate.command,
        ),
      );
      try {
        await waitForBlockedPointCommit(persistence, 1);
      } finally {
        duplicateRelease.resolve();
      }
      const duplicateResults = await Promise.all([
        duplicateFirst,
        duplicateSecond,
      ]);
      expect(duplicateResults.map((item) => item.kind).sort()).toEqual([
        "observed",
        "transitioned",
      ]);
      expect(duplicateResults[0]?.finishingSessionUpdatedAtMilliseconds).toBe(
        duplicateResults[1]?.finishingSessionUpdatedAtMilliseconds,
      );

      const entered = deferredSignal();
      const release = deferredSignal();
      const order: string[] = [];
      const firstPromise = runEffect(createPort(persistence, first.scope, {
        afterTransactionStep: async (event) => {
          if (event.step !== "clockLocked") return;
          order.push("first-clock");
          entered.resolve();
          await release.promise;
        },
      }).enterFinishing(first.command));
      await entered.promise;
      const secondPromise = runEffect(createPort(
        persistence,
        second.scope,
        {
          afterTransactionStep: (event) => {
            if (event.step === "clockLocked") order.push("second-clock");
            return Promise.resolve();
          },
        },
      ).enterFinishing(second.command));
      try {
        await waitForBlockedPointCommit(persistence, 1);
        await withTimeout(
          runEffect(createPort(persistence, independent.scope).enterFinishing(
            independent.command,
          )),
          5_000,
          "independent C05-A scope",
        );
        expect(order).toEqual(["first-clock"]);
      } finally {
        release.resolve();
      }
      await Promise.all([firstPromise, secondPromise]);
      expect(order).toEqual(["first-clock", "second-clock"]);
    });
  }, 120_000);

  it("serializes abort and expiry outcomes without partial transition state", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("9d000000");
      const scope = await createScope(persistence, randomUuid, "terminal");
      const abortFirst = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "abort_first",
      );
      const abortLocked = deferredSignal();
      const abortRelease = deferredSignal();
      const abortFirstTerminalization =
        createPointMutationSessionAttemptTerminalizationPersistenceV1(
          resolutionPorts(persistence, {
            afterTerminalizationEvent: async (event) => {
              if (event.operation !== "abort" ||
                  event.phase !== "lock" ||
                  event.step !== "clockLocked") return;
              abortLocked.resolve();
              await abortRelease.promise;
            },
          }),
        );
      const abortFirstPromise = abortPointMutationSessionAttempt(
        abortFirstTerminalization,
        {
          selector: selectorFromAnchor(abortFirst.anchor),
          executionClaim: executionClaimForAnchor(abortFirst.anchor),
          expectedSnapshotToken: abortFirst.anchor.snapshotToken,
        },
      );
      await abortLocked.promise;
      const abortFirstTransition = runFailure(
        createPort(persistence, scope).enterFinishing(abortFirst.command),
      );
      try {
        await waitForBlockedPointCommit(persistence, 1);
      } finally {
        abortRelease.resolve();
      }
      await abortFirstPromise;
      expect(await abortFirstTransition).toMatchObject({
        _tag: "PointCommitStaleAuthorityV1Error",
        reason: "lifecycleChanged",
      });
      expect(await lifecycleOf(persistence, abortFirst.anchor.sessionId)).toBe(
        "aborted",
      );

      const transitionFirst = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "transition_first",
      );
      const transitionLocked = deferredSignal();
      const transitionRelease = deferredSignal();
      const transitionFirstPromise = runEffect(createPort(
        persistence,
        scope,
        {
          afterTransactionStep: async (event) => {
            if (event.step !== "clockLocked") return;
            transitionLocked.resolve();
            await transitionRelease.promise;
          },
        },
      ).enterFinishing(transitionFirst.command));
      await transitionLocked.promise;
      const terminalization =
        createPointMutationSessionAttemptTerminalizationPersistenceV1(
          scope.ports,
        );
      const transitionFirstAbort = abortPointMutationSessionAttempt(
        terminalization,
        {
          selector: selectorFromAnchor(transitionFirst.anchor),
          executionClaim: executionClaimForAnchor(transitionFirst.anchor),
          expectedSnapshotToken: transitionFirst.anchor.snapshotToken,
        },
      );
      try {
        await waitForBlockedPointCommit(persistence, 1);
      } finally {
        transitionRelease.resolve();
      }
      await transitionFirstPromise;
      await expect(transitionFirstAbort).rejects.toMatchObject({
        _tag: "PointMutationSessionAttemptTerminalizationV1Error",
        issue: { reason: "attemptNotTerminalizable" },
      });
      expect(await lifecycleOf(
        persistence,
        transitionFirst.anchor.sessionId,
      )).toBe("finishing");
      expect(await executionClaimCount(
        persistence,
        transitionFirst.anchor.sessionId,
      )).toBe(0);

      const expired = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "expired",
      );
      const createdAt = await sessionCreatedAt(
        persistence,
        expired.anchor.sessionId,
      );
      const expiry = createdAt + 1;
      await persistence.query(
        `
          update fx_system_tx_session
          set authorization_grant_expires_at = $2,
              hard_expires_at = $2
          where session_id = $1
        `,
        [expired.anchor.sessionId, new Date(expiry)],
      );
      await persistence.query(
        `
          update fx_system_snapshot_lease
          set lease_expires_at = $2
          where session_id = $1
        `,
        [expired.anchor.sessionId, new Date(expiry)],
      );
      const expiredCommand = Object.freeze({
        ...expired.command,
        session: Object.freeze({
          ...expired.command.session,
          authorizationGrantExpiresAtMilliseconds: expiry,
          hardExpiresAtMilliseconds: expiry,
        }),
        sealIdentity: Object.freeze({
          ...expired.command.sealIdentity,
          leaseExpiresAtMilliseconds: expiry,
        }),
      });
      const expiryRaceLocked = deferredSignal();
      const expiryRaceRelease = deferredSignal();
      const expiredTransition = runFailure(createPort(
        persistence,
        scope,
        {
          afterTransactionStep: async (event) => {
            if (event.step !== "clockLocked") return;
            expiryRaceLocked.resolve();
            await expiryRaceRelease.promise;
          },
        },
      ).enterFinishing(expiredCommand));
      await expiryRaceLocked.promise;
      const expiryPromise = expirePointMutationSessionAttempt(
        terminalization,
        selectorFromAnchor(expired.anchor),
      );
      try {
        await waitForBlockedPointCommit(persistence, 1);
      } finally {
        expiryRaceRelease.resolve();
      }
      expect(await expiredTransition).toMatchObject({
        _tag: "PointCommitStaleAuthorityV1Error",
        reason: "expired",
      });
      await expiryPromise;
      expect(await lifecycleOf(persistence, expired.anchor.sessionId)).toBe(
        "expired",
      );
    });
  }, 120_000);

  it("holds interruption through settlement and rolls back post-update failures", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("9e000000");
      const scope = await createScope(persistence, randomUuid, "settlement");
      const interrupted = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "interrupted",
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      let interruptionSettled = false;
      const fiber = Effect.runFork(createPort(persistence, scope, {
        afterTransactionStep: async (event) => {
          if (event.step !== "sessionEnteredFinishing") return;
          entered.resolve();
          await release.promise;
        },
      }).enterFinishing(interrupted.command));
      await entered.promise;
      const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
        interruptionSettled = true;
        return exit;
      });
      try {
        await delay(25);
        expect(interruptionSettled).toBe(false);
      } finally {
        release.resolve();
      }
      await interruption;
      expect(interruptionSettled).toBe(true);
      expect(await lifecycleOf(
        persistence,
        interrupted.anchor.sessionId,
      )).toBe("finishing");
      expect(await executionClaimCount(
        persistence,
        interrupted.anchor.sessionId,
      )).toBe(0);

      const rollback = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "rollback",
      );
      const failure = await runFailure(createPort(persistence, scope, {
        afterTransactionStep: async (event) => {
          if (event.step === "sessionEnteredFinishing") {
            throw new PointCommitCorruptionV1Error({
              reason: "finishingTransitionInvalid",
            });
          }
        },
      }).enterFinishing(rollback.command));
      expect(failure).toBeInstanceOf(PointCommitCorruptionV1Error);
      expect(await lifecycleOf(persistence, rollback.anchor.sessionId)).toBe(
        "running",
      );
      expect(await executionClaimCount(
        persistence,
        rollback.anchor.sessionId,
      )).toBe(1);
    });
  }, 120_000);
});

async function createScope(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
  label: string,
): Promise<ScopeScenario> {
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_c05a_postgres_${label}`,
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_c05a_postgres_${label}`,
  );
  const locator = Object.freeze({
    kind: "shared_database",
    databaseKey: `c05a-postgres-${label}`,
    schemaName: "public",
  }) satisfies SharedDatabaseScopePhysicalLocator;
  const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
    persistence,
    { physicalLocator: locator, randomUuid },
  ).ensure({ deploymentId, projectId: `project_c05a_postgres_${label}` });
  const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
  await setFlarexActivationClock(persistence, scopeId);
  await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [appTable("users")],
    indexes: [],
  });
  return Object.freeze({
    deploymentId,
    scopeId,
    schemaVersionId,
    ports: resolutionPorts(persistence),
  });
}

async function createAttempt(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
  scope: ScopeScenario,
  label: string,
): Promise<AttemptScenario> {
  const activation = await activatePointMutationSession(
    createPointMutationSessionActivationPersistenceV1(
      scope.ports,
      { leaseDurationMilliseconds: 300_000, randomUuid },
    ),
    pointMutationSessionActivationFixture(
      scope.deploymentId,
      scope.scopeId,
      {
        evidence: {
          requestKey: TransactionRequestKeyV1Schema.make(
            `request:c05a:${label}`,
          ),
          schemaVersionId: scope.schemaVersionId,
        },
      },
    ),
  );
  const store = createSessionJournalStorePersistenceV1(scope.ports, {
    randomUuid,
  });
  const attempt = await runEffect(store.openAttemptEffect({
    selector: selectorFromAnchor(activation.anchor),
    executionClaim: executionClaimForAnchor(activation.anchor),
    snapshotToken: activation.anchor.snapshotToken,
    schemaVersionId: scope.schemaVersionId,
  }));
  const prepared = await runEffect(store.prepareSealEffect(attempt));
  const journal = await runEffect(
    canonicalizeSessionJournalV1Effect(prepared.journal),
  );
  const result = await runEffect(
    canonicalizeSuccessfulResultV1Effect({ ok: label }),
  );
  await persistence.query(
    `
      with observed_time as (
        select clock_timestamp() as value
      )
      update fx_system_tx_journal
      set state = 'sealed',
          sealed_final_syscall_sequence = $2,
          sealed_journal_bytes = $3,
          sealed_journal_sha256 = $4,
          sealed_result_value_codec_version = $5,
          sealed_result_semantic_bytes = $6,
          sealed_result_bytes = $7,
          sealed_result_sha256 = $8,
          sealed_at = observed_time.value,
          updated_at = observed_time.value
      from observed_time
      where session_id = $1
        and state = 'open'
    `,
    [
      activation.anchor.sessionId,
      prepared.journal.finalSyscallSequence,
      journal.canonicalBytes,
      lowercaseHexToBytes(journal.sha256Hex),
      result.evidence.valueCodecVersion,
      result.semanticSizeBytes,
      result.canonicalBytes,
      lowercaseHexToBytes(result.evidence.sha256Hex),
    ],
  );
  const authority = authorityFromAnchor(
    activation.anchor,
    scope.schemaVersionId,
    executionClaimForAnchor(activation.anchor),
  );
  const loaded = await runEffect(
    createStoredAttemptEvidenceLoaderV1(scope.ports).loadEffect(authority),
  );
  if (loaded.kind !== "loaded") {
    throw new Error(`Expected running C05-A evidence, received ${loaded.kind}.`);
  }
  return Object.freeze({
    anchor: activation.anchor,
    command: await pointCommitFinishingCommandFromStoredAttemptV1(
      authority,
      loaded.evidence,
    ),
    scope,
  });
}

function createPort(
  persistence: PostgresFlarexPersistence,
  scope: ScopeScenario,
  options: PointCommitTransactionProofOptionsV1 = {},
) {
  return createPointCommitFinishingTransitionPortV1(scope.ports, options);
}

function resolutionPorts(
  persistence: PostgresFlarexPersistence,
  options: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
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
          options,
        ),
    },
  };
}

function authorityFromAnchor(
  anchor: PointMutationSessionAnchorV1,
  schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>,
  executionClaim: NonNullable<
    StoredAttemptEvidenceAuthorityV1["executionClaim"]
  >,
): StoredAttemptEvidenceAuthorityV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
    storageGeneration: anchor.storageGeneration,
    storageGenerationFence: anchor.storageGenerationFence,
    snapshotToken: anchor.snapshotToken,
    schemaVersionId,
    executionClaim,
  });
}

function selectorFromAnchor(anchor: PointMutationSessionAnchorV1) {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
  });
}

async function lifecycleOf(
  persistence: PostgresFlarexPersistence,
  sessionId: string,
): Promise<string> {
  const result = await persistence.query<{ lifecycle: string }>(
    "select lifecycle from fx_system_tx_session where session_id = $1",
    [sessionId],
  );
  const lifecycle = result.rows[0]?.lifecycle;
  if (lifecycle === undefined) throw new Error("Missing C05-A session.");
  return lifecycle;
}

async function executionClaimCount(
  persistence: PostgresFlarexPersistence,
  sessionId: string,
): Promise<number> {
  const result = await persistence.query<{ count: number }>(
    `select count(*)::int as count
     from fx_system_tx_execution_claim
     where session_id = $1`,
    [sessionId],
  );
  return result.rows[0]?.count ?? 0;
}

async function sessionCreatedAt(
  persistence: PostgresFlarexPersistence,
  sessionId: string,
): Promise<number> {
  const result = await persistence.query<{ milliseconds: string }>(
    `
      select floor(extract(epoch from created_at) * 1000)::bigint::text
        as milliseconds
      from fx_system_tx_session
      where session_id = $1
    `,
    [sessionId],
  );
  const milliseconds = result.rows[0]?.milliseconds;
  if (milliseconds === undefined) throw new Error("Missing session time.");
  return Number(milliseconds);
}

async function waitForBlockedPointCommit(
  persistence: PostgresFlarexPersistence,
  expectedBlocked: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(
      `
        select count(*)::int as blocked
        from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and cardinality(pg_blocking_pids(pid)) > 0
          and query ilike '%fx_system_scope_clock%'
      `,
    );
    if ((result.rows[0]?.blocked ?? 0) >= expectedBlocked) return;
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for ${expectedBlocked} blocked C05-A transaction(s).`,
  );
}

function requireObservedQuery(
  queries: ReadonlyMap<
    PointCommitSqlOperationV1,
    Readonly<{ readonly sql: string; readonly params: ReadonlyArray<unknown> }>
  >,
  name: PointCommitSqlOperationV1,
) {
  const query = queries.get(name);
  if (query === undefined) throw new Error(`Missing C05-A ${name} query.`);
  return query;
}

async function explainObserved(
  persistence: PostgresFlarexPersistence,
  query: Readonly<{
    readonly sql: string;
    readonly params: ReadonlyArray<unknown>;
  }>,
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

function appTable(
  logicalName: string,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: { type: "object", value: {} },
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

function deferredSignal(): Readonly<{
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}> {
  let resolver: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return Object.freeze({ promise, resolve: () => resolver?.() });
}

async function withTimeout<Value>(
  promise: Promise<Value>,
  milliseconds: number,
  label: string,
): Promise<Value> {
  return Promise.race([
    promise,
    delay(milliseconds).then(() => {
      throw new Error(`${label} did not complete within ${milliseconds} ms.`);
    }),
  ]);
}

function lowercaseHexToBytes(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/.test(value)) {
    throw new Error("Expected lowercase hexadecimal test evidence.");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.byteLength; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
