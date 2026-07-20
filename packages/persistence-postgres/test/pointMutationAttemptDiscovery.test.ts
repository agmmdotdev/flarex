import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import type { LocatedScopeClockReader } from
  "../src/scopeAuthorityResolution";
import {
  MAX_POINT_MUTATION_ATTEMPT_DISCOVERY_LIMIT_V1,
  PointMutationAttemptDiscoveryCorruptionV1Error,
  PointMutationAttemptDiscoveryInputV1Error,
  PointMutationAttemptDiscoveryScopeV1Error,
  createPointMutationAttemptDiscoveryV1,
} from "../src/pointMutationAttemptDiscovery";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import * as persistencePackage from "../src";
import {
  insertOpenTransactionJournalFixture,
  insertTransactionSessionFixture,
  transactionSessionFixture,
} from "./sessionAuthorityTestSupport";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  writeJournalThrough0032,
  writeJournalThrough0033,
} from "./idempotencySchemaTestSupport";

const DISCOVERY_SCOPE_UUID = "87000000-0000-0000-0000-000000000001";
const DISCOVERY_EPOCH_UUID = "87000000-0000-0000-0000-000000000002";
const DISCOVERY_SCOPE_ID = `scope_${DISCOVERY_SCOPE_UUID}`;
const DISCOVERY_EPOCH = `epoch_${DISCOVERY_EPOCH_UUID}`;
const DISCOVERY_DEPLOYMENT_ID = "deployment_attempt_discovery_v1";
const MIGRATION_NAME = "0033_transaction_attempt_discovery.sql";

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "attempt-discovery-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

describe("O08-B2b2b1 inert point-attempt discovery", () => {
  it("returns only frozen inert hints in the exact global order", async () => {
    const persistence = await discoveryPersistence();
    const tiedAt = "2025-01-01T00:00:00.000Z";
    const expiredId = discoverySessionIdAt(1);
    const finishingId = discoverySessionIdAt(2);
    await insertDiscoveryCandidate(persistence, {
      sessionId: finishingId,
      source: "finishingSession",
      eligibleAt: tiedAt,
    });
    await insertDiscoveryCandidate(persistence, {
      sessionId: expiredId,
      source: "expiredClaim",
      eligibleAt: tiedAt,
    });

    const before = await discoveryStateCounts(persistence);
    const page = await runEffect(discovery(persistence).discoverEffect({
      deploymentId: DISCOVERY_DEPLOYMENT_ID,
      scopeId: DISCOVERY_SCOPE_ID,
      limit: 10,
    }));
    const after = await discoveryStateCounts(persistence);

    expect(page.candidates.map((candidate) => ({
      source: candidate.source,
      sessionId: candidate.selector.sessionId,
    }))).toEqual([
      { source: "expiredClaim", sessionId: expiredId },
      { source: "finishingSession", sessionId: finishingId },
    ]);
    expect(page.continuation).toBeNull();
    expect(before).toEqual(after);
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.candidates)).toBe(true);
    expect(Object.isFrozen(page.candidates[0])).toBe(true);
    expect(Object.isFrozen(page.candidates[0]?.selector)).toBe(true);
    expect(page.candidates[0]).not.toHaveProperty("claimOwner");
    expect(page.candidates[0]).not.toHaveProperty("claimFence");
    expect(page.candidates[0]).not.toHaveProperty("journal");
    expect(persistencePackage).not.toHaveProperty(
      "createPointMutationAttemptDiscoveryV1",
    );
  });

  it("paginates a quiescent sweep without gaps or duplicates at 1 and 100", async () => {
    const persistence = await discoveryPersistence();
    for (let sequence = 1; sequence <= 102; sequence += 1) {
      await insertDiscoveryCandidate(persistence, {
        sessionId: discoverySessionIdAt(100 + sequence),
        source: "finishingSession",
        eligibleAt: new Date(
          Date.UTC(2025, 0, 1, 0, 0, 0, sequence),
        ).toISOString(),
      });
    }
    const repository = discovery(persistence);
    const first = await runEffect(repository.discoverEffect({
      deploymentId: DISCOVERY_DEPLOYMENT_ID,
      scopeId: DISCOVERY_SCOPE_ID,
      limit: 100,
    }));
    expect(first.candidates).toHaveLength(100);
    expect(first.continuation).not.toBeNull();
    expect(Object.isFrozen(first.continuation)).toBe(true);
    const second = await runEffect(repository.discoverEffect({
      deploymentId: DISCOVERY_DEPLOYMENT_ID,
      scopeId: DISCOVERY_SCOPE_ID,
      limit: 100,
      continuation: first.continuation,
    }));
    expect(second.candidates).toHaveLength(2);
    expect(second.continuation).toBeNull();
    expect(second.horizon).toBe(first.horizon);
    const allIds = [...first.candidates, ...second.candidates].map(
      (candidate) => candidate.selector.sessionId,
    );
    expect(new Set(allIds).size).toBe(102);

    const oneAtATime: string[] = [];
    let continuation: unknown = undefined;
    do {
      const page = await runEffect(repository.discoverEffect({
        deploymentId: DISCOVERY_DEPLOYMENT_ID,
        scopeId: DISCOVERY_SCOPE_ID,
        limit: 1,
        ...(continuation === undefined ? {} : { continuation }),
      }));
      oneAtATime.push(...page.candidates.map(
        (candidate) => candidate.selector.sessionId,
      ));
      continuation = page.continuation ?? undefined;
    } while (continuation !== undefined);
    expect(oneAtATime).toEqual(allIds);
  }, 30_000);

  it("rejects malformed, mismatched, and future continuations before authority is widened", async () => {
    const persistence = await discoveryPersistence();
    const repository = discovery(persistence);
    const malformed = await runEffectFailure(repository.discoverEffect({
      deploymentId: DISCOVERY_DEPLOYMENT_ID,
      scopeId: DISCOVERY_SCOPE_ID,
      limit: 1,
      extra: true,
    }));
    expect(malformed).toBeInstanceOf(
      PointMutationAttemptDiscoveryInputV1Error,
    );

    for (const postgresUnsafeTimestamp of [
      "-010000-01-01T00:00:00.000Z",
      "+010000-01-01T00:00:00.000Z",
      "0000-01-01T00:00:00.000Z",
    ]) {
      const unsafeTimestamp = await runEffectFailure(
        repository.discoverEffect({
          deploymentId: DISCOVERY_DEPLOYMENT_ID,
          scopeId: DISCOVERY_SCOPE_ID,
          limit: 1,
          continuation: {
            codecVersion: 1,
            deploymentId: DISCOVERY_DEPLOYMENT_ID,
            scopeId: DISCOVERY_SCOPE_ID,
            storageGeneration: "flarexdb_v1",
            storageGenerationFence: "1",
            epoch: DISCOVERY_EPOCH,
            horizon: postgresUnsafeTimestamp,
            lastEligibleAt: postgresUnsafeTimestamp,
            lastSource: "expiredClaim",
            lastSessionId: discoverySessionIdAt(1),
            lastAttemptFence: "1",
          },
        }),
      );
      expect(unsafeTimestamp).toMatchObject({
        _tag: "PointMutationAttemptDiscoveryInputV1Error",
        reason: "invalidInput",
      });
    }

    const mismatched = await runEffectFailure(repository.discoverEffect({
      deploymentId: DISCOVERY_DEPLOYMENT_ID,
      scopeId: DISCOVERY_SCOPE_ID,
      limit: 1,
      continuation: {
        codecVersion: 1,
        deploymentId: "different_deployment",
        scopeId: DISCOVERY_SCOPE_ID,
        storageGeneration: "flarexdb_v1",
        storageGenerationFence: "1",
        epoch: DISCOVERY_EPOCH,
        horizon: "2025-01-01T00:00:00.000Z",
        lastEligibleAt: "2025-01-01T00:00:00.000Z",
        lastSource: "expiredClaim",
        lastSessionId: discoverySessionIdAt(1),
        lastAttemptFence: "1",
      },
    }));
    expect(mismatched).toMatchObject({
      _tag: "PointMutationAttemptDiscoveryInputV1Error",
      reason: "continuationLocatorMismatch",
    });

    const future = await runEffectFailure(repository.discoverEffect({
      deploymentId: DISCOVERY_DEPLOYMENT_ID,
      scopeId: DISCOVERY_SCOPE_ID,
      limit: 1,
      continuation: {
        codecVersion: 1,
        deploymentId: DISCOVERY_DEPLOYMENT_ID,
        scopeId: DISCOVERY_SCOPE_ID,
        storageGeneration: "flarexdb_v1",
        storageGenerationFence: "1",
        epoch: DISCOVERY_EPOCH,
        horizon: "2099-01-01T00:00:00.000Z",
        lastEligibleAt: "2025-01-01T00:00:00.000Z",
        lastSource: "expiredClaim",
        lastSessionId: discoverySessionIdAt(1),
        lastAttemptFence: "1",
      },
    }));
    expect(future).toBeInstanceOf(PointMutationAttemptDiscoveryInputV1Error);
  });

  it("defers eligibility after the original horizon to a fresh sweep", async () => {
    const persistence = await discoveryPersistence();
    await insertDiscoveryCandidate(persistence, {
      sessionId: discoverySessionIdAt(501),
      source: "finishingSession",
      eligibleAt: "2025-01-01T00:00:00.000Z",
    });
    await insertDiscoveryCandidate(persistence, {
      sessionId: discoverySessionIdAt(502),
      source: "finishingSession",
      eligibleAt: "2025-01-01T00:00:00.001Z",
    });
    const repository = discovery(persistence);
    const first = await runEffect(repository.discoverEffect({
      deploymentId: DISCOVERY_DEPLOYMENT_ID,
      scopeId: DISCOVERY_SCOPE_ID,
      limit: 1,
    }));
    if (first.continuation === null) {
      throw new Error("Expected a continuation for the fixed-horizon proof.");
    }
    const afterHorizon = await databaseTimestampAfter(
      persistence,
      first.horizon,
    );
    await insertDiscoveryCandidate(persistence, {
      sessionId: discoverySessionIdAt(503),
      source: "finishingSession",
      eligibleAt: afterHorizon,
    });
    const next = await runEffect(repository.discoverEffect({
      deploymentId: DISCOVERY_DEPLOYMENT_ID,
      scopeId: DISCOVERY_SCOPE_ID,
      limit: 10,
      continuation: first.continuation,
    }));
    expect(next.candidates.map((candidate) => candidate.selector.sessionId))
      .toEqual([discoverySessionIdAt(502)]);
    expect(next.candidates).not.toContainEqual(expect.objectContaining({
      selector: expect.objectContaining({
        sessionId: discoverySessionIdAt(503),
      }),
    }));
    const fresh = await runEffect(repository.discoverEffect({
      deploymentId: DISCOVERY_DEPLOYMENT_ID,
      scopeId: DISCOVERY_SCOPE_ID,
      limit: 10,
    }));
    expect(fresh.candidates).toContainEqual(expect.objectContaining({
      selector: expect.objectContaining({
        sessionId: discoverySessionIdAt(503),
      }),
    }));
  });

  it("binds continuation to authority and excludes old-generation sessions", async () => {
    const persistence = await discoveryPersistence();
    for (const sequence of [551, 552]) {
      await insertDiscoveryCandidate(persistence, {
        sessionId: discoverySessionIdAt(sequence),
        source: "finishingSession",
        eligibleAt: new Date(
          Date.UTC(2025, 0, 1, 0, 0, 0, sequence - 550),
        ).toISOString(),
      });
    }
    const repository = discovery(persistence);
    const first = await runEffect(repository.discoverEffect({
      deploymentId: DISCOVERY_DEPLOYMENT_ID,
      scopeId: DISCOVERY_SCOPE_ID,
      limit: 1,
    }));
    expect(first.continuation).not.toBeNull();

    await persistence.query(
      `update fx_system_scope_clock
       set storage_generation_fence = 2
       where scope_uuid = $1::uuid`,
      [DISCOVERY_SCOPE_UUID],
    );
    const staleContinuation = await runEffectFailure(
      repository.discoverEffect({
        deploymentId: DISCOVERY_DEPLOYMENT_ID,
        scopeId: DISCOVERY_SCOPE_ID,
        limit: 10,
        continuation: first.continuation,
      }),
    );
    expect(staleContinuation).toBeInstanceOf(
      PointMutationAttemptDiscoveryScopeV1Error,
    );
    expect(staleContinuation).toMatchObject({ reason: "scopeAuthorityChanged" });

    const fresh = await runEffect(repository.discoverEffect({
      deploymentId: DISCOVERY_DEPLOYMENT_ID,
      scopeId: DISCOVERY_SCOPE_ID,
      limit: 10,
    }));
    expect(fresh.candidates).toEqual([]);
  });

  it("rejects non-millisecond candidate ordering evidence", async () => {
    const persistence = await discoveryPersistence();
    const sessionId = discoverySessionIdAt(575);
    await insertDiscoveryCandidate(persistence, {
      sessionId,
      source: "finishingSession",
      eligibleAt: "2025-01-01T00:00:00.000Z",
    });
    await persistence.query(
      `update fx_system_tx_session
       set updated_at = '2025-01-01T00:00:00.000123Z'::timestamptz
       where scope_uuid = $1::uuid and session_id = $2::uuid`,
      [DISCOVERY_SCOPE_UUID, sessionId],
    );
    const failure = await runEffectFailure(
      discovery(persistence).discoverEffect({
        deploymentId: DISCOVERY_DEPLOYMENT_ID,
        scopeId: DISCOVERY_SCOPE_ID,
        limit: 10,
      }),
    );
    expect(failure).toBeInstanceOf(
      PointMutationAttemptDiscoveryCorruptionV1Error,
    );
    expect(failure).toMatchObject({ reason: "candidateInvalid" });
  });

  it("fails closed when one exact finishing selector retains any claim", async () => {
    for (const [sequence, claimExpiresAt] of [
      [601, "2025-01-01T00:00:00.000Z"],
      [602, "2099-01-01T00:00:00.000Z"],
    ] as const) {
      const persistence = await discoveryPersistence();
      const sessionId = discoverySessionIdAt(sequence);
      await insertDiscoveryCandidate(persistence, {
        sessionId,
        source: "expiredClaim",
        eligibleAt: "2025-01-01T00:00:00.000Z",
      });
      await persistence.query(
        `update fx_system_tx_session set lifecycle = 'finishing'
         where scope_uuid = $1::uuid and session_id = $2::uuid`,
        [DISCOVERY_SCOPE_UUID, sessionId],
      );
      await persistence.query(
        `update fx_system_tx_execution_claim set claim_expires_at = $3::timestamptz
         where scope_uuid = $1::uuid and session_id = $2::uuid`,
        [DISCOVERY_SCOPE_UUID, sessionId, claimExpiresAt],
      );
      const failure = await runEffectFailure(
        discovery(persistence).discoverEffect({
          deploymentId: DISCOVERY_DEPLOYMENT_ID,
          scopeId: DISCOVERY_SCOPE_ID,
          limit: 10,
        }),
      );
      expect(failure).toBeInstanceOf(
        PointMutationAttemptDiscoveryCorruptionV1Error,
      );
      expect(failure).toMatchObject({ reason: "finishingClaimPresent" });
    }
  });

  it("installs exactly the two indexes and upgrades 0032 atomically", async () => {
    const fresh = await createPGlitePersistence();
    await fresh.migrate();
    await fresh.migrate();
    await expect(readDiscoveryIndexes(fresh)).resolves.toEqual(
      expectedDiscoveryIndexes(),
    );

    const fixture = await migrationFixture();
    const db = new PGlite();
    try {
      const previous = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await previous.migrate();
      await installDiscoveryAuthority(previous);
      await insertDiscoveryCandidate(previous, {
        sessionId: discoverySessionIdAt(701),
        source: "finishingSession",
        eligibleAt: "2025-01-01T00:00:00.000Z",
      });
      const before = await discoveryStateCounts(previous);

      await writeJournalThrough0033(
        fixture.currentJournal,
        fixture.temporaryJournal,
      );
      const migration = await readFile(fixture.copiedMigration, "utf8");
      await writeFile(
        fixture.copiedMigration,
        `${migration}\n--> statement-breakpoint\nselect * from fx_b2b2b1_missing_table;\n`,
        "utf8",
      );
      const current = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await expect(current.migrate()).rejects.toThrow();
      await expect(readDiscoveryIndexes(current)).resolves.toEqual([]);
      await expect(discoveryStateCounts(current)).resolves.toEqual(before);
      await expect(readMigrationReceiptCount(current)).resolves.toBe(33);

      await writeFile(fixture.copiedMigration, migration, "utf8");
      await expect(current.migrate()).resolves.toBeUndefined();
      await expect(current.migrate()).resolves.toBeUndefined();
      await expect(readDiscoveryIndexes(current)).resolves.toEqual(
        expectedDiscoveryIndexes(),
      );
      await expect(discoveryStateCounts(current)).resolves.toEqual(before);
      await expect(readMigrationReceiptCount(current)).resolves.toBe(34);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    }
  }, 30_000);

  it("enforces the exact public limit contract", async () => {
    expect(MAX_POINT_MUTATION_ATTEMPT_DISCOVERY_LIMIT_V1).toBe(100);
    const persistence = await discoveryPersistence();
    for (const limit of [0, 101]) {
      const failure = await runEffectFailure(
        discovery(persistence).discoverEffect({
          deploymentId: DISCOVERY_DEPLOYMENT_ID,
          scopeId: DISCOVERY_SCOPE_ID,
          limit,
        }),
      );
      expect(failure).toBeInstanceOf(
        PointMutationAttemptDiscoveryInputV1Error,
      );
    }
  });
});

function discovery(persistence: PGliteFlarexPersistence) {
  return createPointMutationAttemptDiscoveryV1({
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared discovery must not read split receipts.");
      },
    },
    scopeDiscoveryTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createPGliteLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
        ),
    },
  });
}

async function discoveryPersistence(): Promise<PGliteFlarexPersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  await installDiscoveryAuthority(persistence);
  return persistence;
}

async function installDiscoveryAuthority(
  persistence: PGliteFlarexPersistence,
): Promise<void> {
  await persistence.query(
    `insert into deployments (deployment_id, project_id)
     values ($1, 'project_attempt_discovery_v1')`,
    [DISCOVERY_DEPLOYMENT_ID],
  );
  await persistence.query(
    `insert into fx_control_scope
       (id, deployment_id, isolation_kind, physical_locator_json)
     values ($1, $2, 'shared_database', $3::jsonb)`,
    [DISCOVERY_SCOPE_ID, DISCOVERY_DEPLOYMENT_ID, JSON.stringify(sharedLocator)],
  );
  await persistence.query(
    `insert into fx_system_scope_clock
       (scope_id, storage_generation, storage_generation_fence,
        last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
    [DISCOVERY_SCOPE_ID, DISCOVERY_EPOCH],
  );
}

async function insertDiscoveryCandidate(
  persistence: PGliteFlarexPersistence,
  input: Readonly<{
    sessionId: string;
    source: "expiredClaim" | "finishingSession";
    eligibleAt: string;
  }>,
): Promise<void> {
  await insertTransactionSessionFixture(
    persistence,
    transactionSessionFixture(input.sessionId, {
      scopeUuid: DISCOVERY_SCOPE_UUID,
      lifecycle: input.source === "expiredClaim" ? "running" : "finishing",
      createdAt: input.eligibleAt,
      updatedAt: input.eligibleAt,
    }),
  );
  if (input.source === "finishingSession") return;
  await insertOpenTransactionJournalFixture(persistence, {
    scopeUuid: DISCOVERY_SCOPE_UUID,
    sessionId: input.sessionId,
    createdAt: input.eligibleAt,
  });
  await persistence.query(
    `insert into fx_system_tx_execution_claim
       (scope_uuid, session_id, attempt_fence, claim_fence, claim_owner,
        claimed_at, claim_expires_at)
     values ($1::uuid, $2::uuid, 1, 1,
             '87000000-0000-4000-8000-000000000001'::uuid,
             $3::timestamptz - interval '1 second', $3::timestamptz)`,
    [DISCOVERY_SCOPE_UUID, input.sessionId, input.eligibleAt],
  );
}

function discoverySessionIdAt(sequence: number): string {
  return `87000000-0000-0000-0000-${sequence.toString().padStart(12, "0")}`;
}

async function discoveryStateCounts(
  persistence: PGliteFlarexPersistence,
): Promise<Readonly<{
  sessions: number;
  roots: number;
  claims: number;
  outcomes: number;
}>> {
  const result = await persistence.query<{
    sessions: number;
    roots: number;
    claims: number;
    outcomes: number;
  }>(`
    select
      (select count(*)::int from fx_system_tx_session
       where scope_uuid = '${DISCOVERY_SCOPE_UUID}'::uuid) as sessions,
      (select count(*)::int from fx_system_tx_journal
       where scope_uuid = '${DISCOVERY_SCOPE_UUID}'::uuid) as roots,
      (select count(*)::int from fx_system_tx_execution_claim
       where scope_uuid = '${DISCOVERY_SCOPE_UUID}'::uuid) as claims,
      (select count(*)::int from fx_system_idempotency
       where scope_uuid = '${DISCOVERY_SCOPE_UUID}'::uuid) as outcomes
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Expected discovery counts.");
  return Object.freeze(row);
}

async function databaseTimestampAfter(
  persistence: PGliteFlarexPersistence,
  horizon: string,
): Promise<string> {
  const horizonMilliseconds = Date.parse(horizon);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await persistence.query<{ now: Date }>(
      "select date_trunc('milliseconds', statement_timestamp()) as now",
    );
    const now = result.rows[0]?.now;
    if (now !== undefined && now.valueOf() > horizonMilliseconds) {
      return now.toISOString();
    }
    await delay(1);
  }
  throw new Error("Database time did not advance past the discovery horizon.");
}

async function readDiscoveryIndexes(
  persistence: PGliteFlarexPersistence,
): Promise<ReadonlyArray<Readonly<{
  tablename: string;
  indexname: string;
  indexdef: string;
}>>> {
  const result = await persistence.query<{
    tablename: string;
    indexname: string;
    indexdef: string;
  }>(`
    select tablename, indexname, indexdef
    from pg_indexes
    where schemaname = current_schema()
      and indexname in (
        'fx_system_tx_execution_claim_expiry_idx',
        'fx_system_tx_session_finishing_discovery_idx'
      )
    order by indexname
  `);
  return result.rows.map((row) => Object.freeze({
    tablename: row.tablename,
    indexname: row.indexname,
    indexdef: normalizeIndexDefinition(row.indexdef),
  }));
}

function expectedDiscoveryIndexes(): ReadonlyArray<Readonly<{
  tablename: string;
  indexname: string;
  indexdef: string;
}>> {
  return [
    Object.freeze({
      tablename: "fx_system_tx_execution_claim",
      indexname: "fx_system_tx_execution_claim_expiry_idx",
      indexdef: "scope_uuid, claim_expires_at, session_id, attempt_fence",
    }),
    Object.freeze({
      tablename: "fx_system_tx_session",
      indexname: "fx_system_tx_session_finishing_discovery_idx",
      indexdef:
        "scope_uuid, updated_at, session_id, attempt_fence where lifecycle = finishing",
    }),
  ];
}

function normalizeIndexDefinition(value: string): string {
  const columns = value.match(/\(([^)]+)\)/)?.[1]
    ?.replaceAll('"', "")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (columns === undefined) return value;
  const predicate = value.match(/\bwhere\b\s*\((.+)\)\s*$/i)?.[1]
    ?.replaceAll('"', "")
    .replaceAll("'", "")
    .replaceAll("::text", "")
    .replaceAll(/\s+/g, " ")
    .trim();
  return predicate === undefined
    ? columns
    : `${columns} where ${predicate}`;
}

async function readMigrationReceiptCount(
  persistence: PGliteFlarexPersistence,
): Promise<number> {
  const result = await persistence.query<{ count: number }>(
    `select count(*)::int as count from drizzle.__drizzle_migrations`,
  );
  const count = result.rows[0]?.count;
  if (count === undefined) throw new Error("Expected migration receipt count.");
  return count;
}

async function migrationFixture(): Promise<Readonly<{
  root: string;
  migrationsFolder: string;
  currentJournal: string;
  temporaryJournal: string;
  copiedMigration: string;
}>> {
  const root = await mkdtemp(resolve(tmpdir(), "flarex-b2b2b1-pglite-"));
  const migrationsFolder = resolve(root, "drizzle");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const currentMigrationsFolder = resolve(packageRoot, "drizzle");
  const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
  const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
  await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
  await writeJournalThrough0032(currentJournal, temporaryJournal);
  return Object.freeze({
    root,
    migrationsFolder,
    currentJournal,
    temporaryJournal,
    copiedMigration: resolve(migrationsFolder, MIGRATION_NAME),
  });
}
