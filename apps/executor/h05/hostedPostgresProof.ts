import assert from "node:assert/strict";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { env } from "node:process";
import type { PoolClient } from "pg";
import {
  createPostgresPersistence,
  type PostgresFlarexPersistence,
} from "@flarex/persistence-postgres/postgres";

import {
  deleteExecutorOccProofDeployment,
  executorOccProofStartBody,
  listExecutorOccProofDeploymentRows,
  runExecutorOccProof,
  seedExecutorOccProof,
  verifyExecutorOccProofState,
  type ExecutorOccProofEvidence,
  type ExecutorOccProofFixture,
  type ExecutorOccProofSqlEvidence,
  type ExecutorOccProofTransport,
} from "./executorOccProof";
import { h05ProbeEndpoint, h05ProbeHop } from "./probeProtocol";
import {
  decodeH05ProofRunId,
  h05ProofIdentity,
  type H05ProofRunId,
} from "./proofIdentity";
import {
  compileH05InvocationReceipt,
  h05AuthorizedInvocationCount,
  serializeH05InvocationEvidence,
  type H05InvocationEvidence,
  type H05InvocationReceipt,
} from "./receipt";

const hostedPostgresConnectionTimeoutMs = 15_000;
const hostedPostgresDnsTimeoutMs = 5_000;
const hostedPostgresQueryTimeoutMs = 30_000;
const hostedProbeRequestTimeoutMs = 20_000;

export interface HostedExecutorOccProofResult {
  readonly cleanup: { readonly proofRowsRemaining: 0 };
  readonly evidence: ExecutorOccProofEvidence;
  readonly fixture: ExecutorOccProofFixture;
  readonly invocation: H05InvocationReceipt;
  readonly invocationEvidenceJson: string;
  readonly runId: H05ProofRunId;
  readonly sql: ExecutorOccProofSqlEvidence;
}

interface HostedProbeTransport extends ExecutorOccProofTransport {
  evidence(): HostedProbeTransportEvidence;
}

export interface HostedProbeTransportEvidence {
  readonly authorizedResponses: typeof h05AuthorizedInvocationCount;
  readonly hopMarkedResponses: typeof h05AuthorizedInvocationCount;
  readonly noStoreResponses: 15;
  readonly unauthorizedHopAbsent: true;
  readonly unauthorizedStatus: 401;
}

export interface HostedExecutorOccProofConfig {
  readonly databaseHost: string;
  readonly databaseName: string;
  readonly databaseUrl: string;
  readonly fixture: ExecutorOccProofFixture;
  readonly probeToken: string;
  readonly probeUrl: URL;
  readonly runId: H05ProofRunId;
}

export async function runHostedExecutorOccProof(): Promise<HostedExecutorOccProofResult> {
  const config = decodeHostedExecutorOccProofConfig(env);
  let persistence: PostgresFlarexPersistence | undefined;
  let claimClient: PoolClient | undefined;
  let claimAcquired = false;
  let mutationStarted = false;
  let primaryFailed = false;
  let primaryError: unknown;
  let proofResult:
    | Omit<HostedExecutorOccProofResult, "cleanup">
    | undefined;
  let cleanup: HostedExecutorOccProofResult["cleanup"] | undefined;

  try {
    await assertRemotePostgresResolution(config.databaseHost);
    persistence = await createPostgresPersistence({
      connectionString: config.databaseUrl,
      migrationsSchema: "flarex_migrations",
      poolConfig: {
        application_name: "flarex-h05-hosted-proof",
        connectionTimeoutMillis: hostedPostgresConnectionTimeoutMs,
        idleTimeoutMillis: hostedPostgresConnectionTimeoutMs,
        lock_timeout: hostedPostgresConnectionTimeoutMs,
        max: 4,
        query_timeout: hostedPostgresQueryTimeoutMs,
        statement_timeout: hostedPostgresQueryTimeoutMs,
      },
    });
    claimClient = await persistence.pool.connect();
    claimAcquired = await tryAcquireH05RunClaim(
      claimClient,
      config.fixture.deploymentId,
    );
    if (!claimAcquired) {
      throw new Error(
        `Another H05 proof owns run ID ${config.runId}; choose a new FLAREX_H05_RUN_ID.`,
      );
    }
    await persistence.migrate();
    const existingRows = await listExecutorOccProofDeploymentRows(
      persistence,
      config.fixture.deploymentId,
    );
    if (existingRows.length > 0) {
      throw new Error(
        `H05 proof deployment ${config.fixture.deploymentId} already has rows in ${existingRows.join(", ")}; choose a new FLAREX_H05_RUN_ID.`,
      );
    }

    mutationStarted = true;
    await seedExecutorOccProof(persistence, config.fixture);
    const transport = hostedProbeTransport(config);
    await expectUnauthorizedProbe(transport, config.fixture);
    const evidence = await runExecutorOccProof(transport, config.fixture);
    const sql = await verifyExecutorOccProofState(
      persistence,
      config.fixture,
      evidence,
    );
    const invocationEvidence = compileHostedInvocationEvidence(
      evidence,
      sql,
      transport.evidence(),
    );
    const invocationEvidenceJson = serializeH05InvocationEvidence(
      invocationEvidence,
    );
    const invocation = compileH05InvocationReceipt(invocationEvidence);
    if (!invocation.ok) throw new Error(invocation.message);
    proofResult = {
      fixture: config.fixture,
      evidence,
      invocation: invocation.value,
      invocationEvidenceJson,
      runId: config.runId,
      sql,
    };
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    const activePersistence = persistence;
    if (activePersistence !== undefined && mutationStarted) {
      await recordCleanupError(cleanupErrors, async () => {
        await deleteExecutorOccProofDeployment(
          activePersistence,
          config.fixture.deploymentId,
        );
        cleanup = { proofRowsRemaining: 0 };
      });
    }
    const activeClaimClient = claimClient;
    if (activeClaimClient !== undefined) {
      await recordCleanupError(cleanupErrors, () =>
        releaseH05RunClaim(
          activeClaimClient,
          config.fixture.deploymentId,
          claimAcquired,
        ),
      );
    }
    if (activePersistence !== undefined) {
      await recordCleanupError(cleanupErrors, () => activePersistence.close());
    }
    if (cleanupErrors.length > 0) {
      const summary = cleanupErrors.map(errorMessage).join("; ");
      if (primaryFailed) {
        throw new AggregateError(
          [primaryError, ...cleanupErrors],
          `H05 hosted proof failed and scoped cleanup also failed: ${summary}`,
        );
      }
      throw new AggregateError(
        cleanupErrors,
        `H05 hosted proof scoped cleanup failed: ${summary}`,
      );
    }
  }

  if (proofResult === undefined || cleanup === undefined) {
    throw new Error(
      "H05 hosted proof completed without invocation or PostgreSQL cleanup evidence.",
    );
  }
  return {
    ...proofResult,
    cleanup,
  };
}

export async function proveExclusiveHostedExecutorOccProofRunClaim(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
): Promise<void> {
  let firstClient: PoolClient | undefined;
  let secondClient: PoolClient | undefined;
  let thirdClient: PoolClient | undefined;
  let firstAcquired = false;
  let secondAcquired = false;
  let thirdAcquired = false;
  let primaryFailed = false;
  let primaryError: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    firstClient = await persistence.pool.connect();
    firstAcquired = await tryAcquireH05RunClaim(firstClient, deploymentId);
    if (!firstAcquired) {
      throw new Error("The first H05 run-claim client did not acquire ownership.");
    }

    secondClient = await persistence.pool.connect();
    secondAcquired = await tryAcquireH05RunClaim(secondClient, deploymentId);
    if (secondAcquired) {
      throw new Error("A concurrent H05 run-claim client acquired ownership.");
    }
    await releaseH05RunClaim(secondClient, deploymentId, secondAcquired);
    secondClient = undefined;

    await releaseH05RunClaim(firstClient, deploymentId, firstAcquired);
    firstClient = undefined;

    thirdClient = await persistence.pool.connect();
    thirdAcquired = await tryAcquireH05RunClaim(thirdClient, deploymentId);
    if (!thirdAcquired) {
      throw new Error("The H05 run claim was not reusable after release.");
    }
    await releaseH05RunClaim(thirdClient, deploymentId, thirdAcquired);
    thirdClient = undefined;
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
    throw error;
  } finally {
    const activeThirdClient = thirdClient;
    if (activeThirdClient !== undefined) {
      await recordCleanupError(cleanupErrors, () =>
        releaseH05RunClaim(activeThirdClient, deploymentId, thirdAcquired),
      );
    }
    const activeSecondClient = secondClient;
    if (activeSecondClient !== undefined) {
      await recordCleanupError(cleanupErrors, () =>
        releaseH05RunClaim(activeSecondClient, deploymentId, secondAcquired),
      );
    }
    const activeFirstClient = firstClient;
    if (activeFirstClient !== undefined) {
      await recordCleanupError(cleanupErrors, () =>
        releaseH05RunClaim(activeFirstClient, deploymentId, firstAcquired),
      );
    }
    if (cleanupErrors.length > 0) {
      if (primaryFailed) {
        throw new AggregateError(
          [primaryError, ...cleanupErrors],
          "H05 run-claim proof failed and cleanup also failed.",
        );
      }
      throw new AggregateError(
        cleanupErrors,
        "Failed to clean up the H05 run-claim proof.",
      );
    }
  }
}

export function decodeHostedExecutorOccProofConfig(
  input: Readonly<Record<string, string | undefined>>,
): HostedExecutorOccProofConfig {
  if (input.FLAREX_H05_ALLOW_STAGING_MUTATION !== "yes") {
    throw new Error(
      "FLAREX_H05_ALLOW_STAGING_MUTATION=yes is required for the hosted proof.",
    );
  }
  const rawDatabaseUrl = requiredValue(
    input.FLAREX_H05_POSTGRES_DATABASE_URL,
    "FLAREX_H05_POSTGRES_DATABASE_URL",
  );
  const parsedDatabaseUrl = parseUrlWithoutInputLeak(
    rawDatabaseUrl,
    "FLAREX_H05_POSTGRES_DATABASE_URL",
  );
  if (
    parsedDatabaseUrl.protocol !== "postgres:" &&
    parsedDatabaseUrl.protocol !== "postgresql:"
  ) {
    throw new Error(
      "FLAREX_H05_POSTGRES_DATABASE_URL must use postgres or postgresql.",
    );
  }
  if (isLocalPostgresHost(parsedDatabaseUrl.hostname)) {
    throw new Error(
      "FLAREX_H05_POSTGRES_DATABASE_URL must target a remote host, not loopback or an unspecified address.",
    );
  }
  if (parsedDatabaseUrl.pathname === "" || parsedDatabaseUrl.pathname === "/") {
    throw new Error(
      "FLAREX_H05_POSTGRES_DATABASE_URL must name a dedicated staging database.",
    );
  }
  const databaseName = decodeDatabaseName(parsedDatabaseUrl.pathname);
  const expectedDatabaseName = requiredValue(
    input.FLAREX_H05_EXPECTED_DATABASE_NAME,
    "FLAREX_H05_EXPECTED_DATABASE_NAME",
  );
  if (databaseName !== expectedDatabaseName) {
    throw new Error(
      "FLAREX_H05_EXPECTED_DATABASE_NAME must exactly match the database URL target.",
    );
  }
  if (["postgres", "template0", "template1"].includes(databaseName)) {
    throw new Error(
      "FLAREX_H05_POSTGRES_DATABASE_URL must not target a default PostgreSQL database.",
    );
  }
  const sslModes = parsedDatabaseUrl.searchParams.getAll("sslmode");
  if (
    sslModes.length !== 1 ||
    !["require", "verify-ca", "verify-full"].includes(
      sslModes[0]?.toLowerCase() ?? "",
    )
  ) {
    throw new Error(
      "FLAREX_H05_POSTGRES_DATABASE_URL must set exactly one sslmode=require, verify-ca, or verify-full.",
    );
  }
  const databaseParameterNames = [
    ...parsedDatabaseUrl.searchParams.keys(),
  ];
  if (
    parsedDatabaseUrl.hash !== "" ||
    databaseParameterNames.some((name) => name !== "sslmode")
  ) {
    throw new Error(
      "FLAREX_H05_POSTGRES_DATABASE_URL may set only the validated sslmode query parameter and no fragment.",
    );
  }
  const databaseUrl = parsedDatabaseUrl.toString();

  const rawProbeUrl = requiredValue(
    input.FLAREX_H05_PROBE_URL,
    "FLAREX_H05_PROBE_URL",
  );
  const probeUrl = parseUrlWithoutInputLeak(
    rawProbeUrl,
    "FLAREX_H05_PROBE_URL",
  );
  if (probeUrl.protocol !== "https:") {
    throw new Error("FLAREX_H05_PROBE_URL must use HTTPS.");
  }
  if (
    probeUrl.username !== "" ||
    probeUrl.password !== "" ||
    probeUrl.pathname !== "/" ||
    probeUrl.search !== "" ||
    probeUrl.hash !== ""
  ) {
    throw new Error(
      "FLAREX_H05_PROBE_URL must be an HTTPS origin without credentials, query, or fragment.",
    );
  }
  probeUrl.pathname = "/";

  const probeToken = requiredValue(
    input.FLAREX_H05_PROBE_TOKEN,
    "FLAREX_H05_PROBE_TOKEN",
  );
  const runId = decodeH05ProofRunId(input.FLAREX_H05_RUN_ID);
  if (!runId.ok) throw new Error(runId.message);
  const identity = h05ProofIdentity(runId.value);

  return {
    databaseHost: normalizePostgresHost(parsedDatabaseUrl.hostname),
    databaseName,
    databaseUrl,
    probeUrl,
    probeToken,
    runId: identity.runId,
    fixture: {
      deploymentId: identity.deploymentId,
      markerText: identity.markerText,
      projectId: identity.projectId,
    },
  };
}

function hostedProbeTransport(
  config: HostedExecutorOccProofConfig,
): HostedProbeTransport {
  const endpoint = new URL(h05ProbeEndpoint(config.runId), config.probeUrl);
  let authorizedResponses = 0;
  let hopMarkedResponses = 0;
  let noStoreResponses = 0;
  let unauthorizedHopAbsent = false;
  let unauthorizedStatus: number | undefined;
  return {
    hop: h05ProbeHop,
    request: async (path, body, options = {}) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.authorized === false
            ? {}
            : { authorization: `Bearer ${config.probeToken}` }),
        },
        body: JSON.stringify({ path, body }),
        signal: AbortSignal.timeout(hostedProbeRequestTimeoutMs),
      });
      if (response.headers.get("cache-control") !== "no-store") {
        throw new Error("H05 probe response must disable caching.");
      }
      noStoreResponses += 1;
      if (options.authorized === false) {
        if (unauthorizedStatus !== undefined) {
          throw new Error("H05 proof issued more than one unauthorized probe.");
        }
        unauthorizedStatus = response.status;
        unauthorizedHopAbsent = response.headers.get(h05ProbeHop.header) === null;
      } else {
        authorizedResponses += 1;
        if (response.headers.get(h05ProbeHop.header) === h05ProbeHop.value) {
          hopMarkedResponses += 1;
        }
      }
      return response;
    },
    evidence: () => {
      assert.equal(unauthorizedStatus, 401);
      assert.equal(unauthorizedHopAbsent, true);
      assert.equal(authorizedResponses, h05AuthorizedInvocationCount);
      assert.equal(hopMarkedResponses, h05AuthorizedInvocationCount);
      assert.equal(noStoreResponses, 15);
      return {
        unauthorizedStatus: 401,
        unauthorizedHopAbsent: true,
        authorizedResponses: h05AuthorizedInvocationCount,
        hopMarkedResponses: h05AuthorizedInvocationCount,
        noStoreResponses: 15,
      };
    },
  };
}

async function expectUnauthorizedProbe(
  transport: ExecutorOccProofTransport,
  fixture: ExecutorOccProofFixture,
): Promise<void> {
  const response = await transport.request(
    "/invoke/start",
    executorOccProofStartBody(fixture),
    { authorized: false },
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.get(transport.hop.header), null);
  assert.deepEqual(await response.json(), {
    error: "unauthorized",
    message: "Unauthorized H05 executor probe request.",
  });
}

export function compileHostedInvocationEvidence(
  evidence: ExecutorOccProofEvidence,
  sql: ExecutorOccProofSqlEvidence,
  transport: HostedProbeTransportEvidence,
): H05InvocationEvidence {
  assert.equal(sql.sessions, 3);
  assert.equal(sql.activeSessions, 0);
  assert.equal(sql.documentRevisions, 3);
  assert.equal(sql.commits, 2);
  assert.equal(sql.outboxEvents, 2);
  assert.equal(sql.finalTs, evidence.freshTs);
  assert.equal(sql.finalPrevTs, evidence.winnerTs);
  assert.equal(sql.winnerState, "finished");
  assert.equal(sql.staleState, "aborted");
  assert.equal(sql.freshState, "finished");
  assert.equal(sql.winnerObservedTs, 10);
  assert.equal(sql.staleObservedTs, 10);
  assert.equal(sql.freshObservedTs, evidence.winnerTs);

  return {
    source: "hosted-occ-proof-harness",
    unauthorizedStatus: transport.unauthorizedStatus,
    unauthorizedHopAbsent: transport.unauthorizedHopAbsent,
    authorizedResponses: transport.authorizedResponses,
    hopMarkedResponses: transport.hopMarkedResponses,
    noStoreResponses: transport.noStoreResponses,
    hop: h05ProbeHop,
    winner: {
      committedTs: evidence.winnerTs,
      observedTs: 10,
      state: "finished",
    },
    stale: {
      conflictStatus: 409,
      observedTs: 10,
      currentTs: evidence.winnerTs,
      abortStatus: 200,
      afterAbortStatus: 409,
      state: "aborted",
    },
    fresh: {
      committedTs: evidence.freshTs,
      observedTs: evidence.winnerTs,
      previousTs: evidence.winnerTs,
      state: "finished",
    },
    sql: {
      sessions: 3,
      activeSessions: 0,
      documentRevisions: 3,
      commits: 2,
      outboxEvents: 2,
      finalTs: evidence.freshTs,
      finalPrevTs: evidence.winnerTs,
    },
  };
}

async function tryAcquireH05RunClaim(
  client: PoolClient,
  deploymentId: string,
): Promise<boolean> {
  const result = await client.query<{ acquired: boolean }>(
    "select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired",
    [`flarex-h05-proof:${deploymentId}`],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("PostgreSQL did not return the H05 run-claim result.");
  }
  return row.acquired;
}

async function releaseH05RunClaim(
  client: PoolClient,
  deploymentId: string,
  acquired: boolean,
): Promise<void> {
  const errors: unknown[] = [];
  if (acquired) {
    try {
      const result = await client.query<{ released: boolean }>(
        "select pg_advisory_unlock(hashtextextended($1, 0)) as released",
        [`flarex-h05-proof:${deploymentId}`],
      );
      if (result.rows[0]?.released !== true) {
        throw new Error("PostgreSQL did not release the H05 run claim.");
      }
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    client.release(
      errors.length === 0 ? undefined : normalizeError(errors[0]),
    );
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "Failed to release the H05 run claim.");
  }
}

function parseUrlWithoutInputLeak(value: string, name: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
}

function decodeDatabaseName(pathname: string): string {
  try {
    return decodeURIComponent(pathname.slice(1));
  } catch {
    throw new Error(
      "FLAREX_H05_POSTGRES_DATABASE_URL must contain a valid encoded database name.",
    );
  }
}

function isLocalPostgresHost(hostname: string): boolean {
  const normalized = normalizePostgresHost(hostname);
  if (
    normalized === "localhost" ||
    normalized === "localhost.localdomain" ||
    normalized.endsWith(".localhost")
  ) {
    return true;
  }
  if (
    normalized === "0" ||
    normalized === "0.0.0.0" ||
    /^127(?:\.|$)/.test(normalized)
  ) {
    return true;
  }
  const ipVersion = isIP(normalized);
  if (ipVersion !== 6) return false;
  const nonZeroHex = normalized.replaceAll(":", "").replace(/^0+/, "");
  if (nonZeroHex === "" || nonZeroHex === "1") return true;
  return /(?:^|:)ffff:(?:127\.|7f[0-9a-f]{2}:)/.test(normalized);
}

function normalizePostgresHost(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.+$/, "");
}

async function assertRemotePostgresResolution(hostname: string): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("PostgreSQL hostname lookup timed out.")),
          hostedPostgresDnsTimeoutMs,
        );
      }),
    ]);
    if (
      addresses.length === 0 ||
      addresses.some((address) => isLocalPostgresHost(address.address))
    ) {
      throw new Error("PostgreSQL hostname resolved to a local address.");
    }
  } catch {
    throw new Error(
      "FLAREX_H05_POSTGRES_DATABASE_URL hostname must resolve remotely before staging mutation.",
    );
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function requiredValue(
  value: string | undefined,
  name: string,
): string {
  const normalized = value?.trim();
  if (normalized !== undefined && normalized.length > 0) return normalized;
  throw new Error(`${name} is required.`);
}

async function recordCleanupError(
  errors: unknown[],
  cleanup: () => Promise<unknown>,
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    errors.push(error);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
