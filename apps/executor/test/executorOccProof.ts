import { expect } from "vitest";
import {
  createFlarexExecutor,
  withReadyDeploymentAuthority,
} from "@flarex/executor";
import type {
  InvokeSessionState,
  SharedDatabaseScopePhysicalLocator,
} from "@flarex/persistence-postgres";
import {
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "@flarex/persistence-postgres/postgres";

export interface ExecutorOccProofFixture {
  readonly deploymentId: string;
  readonly markerText: string;
  readonly projectId: string;
}

export interface ExecutorOccProofResponse {
  readonly headers: { get(name: string): string | null };
  readonly status: number;
  json(): Promise<unknown>;
}

export interface ExecutorOccProofTransport {
  readonly hop: {
    readonly header: string;
    readonly value: string;
  };
  request(
    path: string,
    body: unknown,
    options?: { readonly authorized?: boolean },
  ): Promise<ExecutorOccProofResponse>;
}

export interface ExecutorOccProofEvidence {
  readonly freshSessionId: string;
  readonly freshTs: number;
  readonly staleSessionId: string;
  readonly winnerSessionId: string;
  readonly winnerTs: number;
}

export interface ExecutorOccProofSqlEvidence {
  readonly activeSessions: number;
  readonly commits: number;
  readonly documentRevisions: number;
  readonly finalPrevTs: number | null;
  readonly finalTs: number;
  readonly freshObservedTs: number;
  readonly freshState: InvokeSessionState;
  readonly outboxEvents: number;
  readonly sessions: number;
  readonly staleObservedTs: number;
  readonly staleState: InvokeSessionState;
  readonly winnerObservedTs: number;
  readonly winnerState: InvokeSessionState;
}

export interface ExecutorOccProofCleanupEvidence {
  readonly scopeIds: readonly string[];
}

const seedDocumentId = "1:team";
const seedDocumentTs = 10;

export async function seedExecutorOccProof(
  persistence: PostgresFlarexPersistence,
  fixture: ExecutorOccProofFixture,
): Promise<void> {
  const physicalLocator = Object.freeze({
    kind: "shared_database",
    databaseKey: "primary",
    schemaName: "public",
  }) satisfies SharedDatabaseScopePhysicalLocator;
  const executorPersistence = withReadyDeploymentAuthority(
    persistence,
    createPostgresSharedScopeAuthorityProvisioner(persistence, {
      physicalLocator,
    }),
  );
  const executor = createFlarexExecutor({ persistence: executorPersistence });
  const registered = await executor.registerDeploymentPackage({
    deploymentId: fixture.deploymentId,
    projectId: fixture.projectId,
    sourcePackage: sourcePackage(),
    analysisJson: analysisJson(),
  });
  await executor.activateDeploymentPackage({
    deploymentId: fixture.deploymentId,
    projectId: fixture.projectId,
    packageId: registered.package.packageId,
    schemaVersion: 5,
  });
  await persistence.insertDocumentRevision({
    deploymentId: fixture.deploymentId,
    id: seedDocumentId,
    ts: seedDocumentTs,
    value: { name: "seed", count: 0 },
  });
}

export async function runExecutorOccProof(
  runtime: ExecutorOccProofTransport,
  fixture: ExecutorOccProofFixture,
): Promise<ExecutorOccProofEvidence> {
  const winnerStart = await startSession(runtime, fixture);
  const staleStart = await startSession(runtime, fixture);
  expect(staleStart.sessionId).not.toBe(winnerStart.sessionId);

  await expectSeedRead(runtime, fixture, winnerStart.sessionId);
  await expectSeedRead(runtime, fixture, staleStart.sessionId);
  await expectPatch(runtime, fixture, winnerStart.sessionId, {
    count: 1,
    winner: "A",
  });
  await expectPatch(runtime, fixture, staleStart.sessionId, {
    count: 2,
    stale: "B",
  });

  const winnerFinish = await invokeJson(runtime, "/invoke/finish", {
    deploymentId: fixture.deploymentId,
    projectId: fixture.projectId,
    sessionId: winnerStart.sessionId,
    value: { attempt: "winner" },
  });
  expect(winnerFinish.response.status).toBe(200);
  const winnerTs = numberField(winnerFinish.body, "committedTs");
  expect(winnerFinish.body).toEqual({
    value: { attempt: "winner" },
    committedTs: winnerTs,
    writes: [
      {
        tableId: 1,
        id: seedDocumentId,
        prevTs: seedDocumentTs,
        ts: winnerTs,
        value: { name: "seed", count: 1, winner: "A" },
      },
    ],
  });

  const staleFinish = await invokeJson(runtime, "/invoke/finish", {
    deploymentId: fixture.deploymentId,
    projectId: fixture.projectId,
    sessionId: staleStart.sessionId,
    value: { attempt: "stale" },
  });
  expect(staleFinish.response.status).toBe(409);
  expect(staleFinish.body).toEqual({
    error: "InvokeSessionOccConflictError",
    message: `OCC conflict for ${fixture.deploymentId}/${seedDocumentId}: observed ${seedDocumentTs}, current ${winnerTs}`,
  });

  const aborted = await invokeJson(runtime, "/invoke/abort", {
    deploymentId: fixture.deploymentId,
    projectId: fixture.projectId,
    sessionId: staleStart.sessionId,
  });
  expect(aborted.response.status).toBe(200);
  expect(aborted.body).toEqual({ aborted: true });

  const afterAbort = await invokeJson(runtime, "/invoke/syscall", {
    deploymentId: fixture.deploymentId,
    projectId: fixture.projectId,
    sessionId: staleStart.sessionId,
    op: "get",
    id: seedDocumentId,
  });
  expect(afterAbort.response.status).toBe(409);
  expect(afterAbort.body).toMatchObject({
    error: "InvokeSessionNotActiveError",
  });

  await waitForClockAfter(winnerTs);
  const freshStart = await startSession(runtime, fixture);
  expect(freshStart.beginTs).toBeGreaterThan(winnerTs);
  const freshRead = await invokeJson(runtime, "/invoke/syscall", {
    deploymentId: fixture.deploymentId,
    projectId: fixture.projectId,
    sessionId: freshStart.sessionId,
    op: "get",
    id: seedDocumentId,
  });
  expect(freshRead.response.status).toBe(200);
  expect(freshRead.body).toEqual({
    value: { _id: seedDocumentId, name: "seed", count: 1, winner: "A" },
    readSet: { documents: [{ tableId: 1, id: seedDocumentId }] },
  });
  await expectPatch(runtime, fixture, freshStart.sessionId, {
    count: 3,
    converged: true,
  });

  const freshFinish = await invokeJson(runtime, "/invoke/finish", {
    deploymentId: fixture.deploymentId,
    projectId: fixture.projectId,
    sessionId: freshStart.sessionId,
    value: { attempt: "fresh" },
  });
  expect(freshFinish.response.status).toBe(200);
  const freshTs = numberField(freshFinish.body, "committedTs");
  expect(freshFinish.body).toEqual({
    value: { attempt: "fresh" },
    committedTs: freshTs,
    writes: [
      {
        tableId: 1,
        id: seedDocumentId,
        prevTs: winnerTs,
        ts: freshTs,
        value: {
          name: "seed",
          count: 3,
          winner: "A",
          converged: true,
        },
      },
    ],
  });

  return {
    winnerSessionId: winnerStart.sessionId,
    staleSessionId: staleStart.sessionId,
    freshSessionId: freshStart.sessionId,
    winnerTs,
    freshTs,
  };
}

export async function verifyExecutorOccProofState(
  persistence: PostgresFlarexPersistence,
  fixture: ExecutorOccProofFixture,
  evidence: ExecutorOccProofEvidence,
): Promise<ExecutorOccProofSqlEvidence> {
  const finalRevision = await persistence.getDocumentRevisionAtTs(
    fixture.deploymentId,
    seedDocumentId,
    Number.MAX_SAFE_INTEGER,
  );
  expect(finalRevision).toMatchObject({
    id: seedDocumentId,
    ts: evidence.freshTs,
    prevTs: evidence.winnerTs,
    value: {
      name: "seed",
      count: 3,
      winner: "A",
      converged: true,
    },
    deleted: false,
  });
  if (finalRevision === null) {
    throw new Error("Executor OCC proof final document revision is missing.");
  }

  const winnerSession = await persistence.getInvokeSessionMetadata(
    fixture.deploymentId,
    evidence.winnerSessionId,
  );
  const staleSession = await persistence.getInvokeSessionMetadata(
    fixture.deploymentId,
    evidence.staleSessionId,
  );
  const freshSession = await persistence.getInvokeSessionMetadata(
    fixture.deploymentId,
    evidence.freshSessionId,
  );
  expect(winnerSession).toMatchObject({ state: "finished" });
  expect(staleSession).toMatchObject({ state: "aborted" });
  expect(freshSession).toMatchObject({ state: "finished" });
  if (
    winnerSession === null ||
    staleSession === null ||
    freshSession === null
  ) {
    throw new Error("Executor OCC proof session metadata is missing.");
  }

  const winnerReads = await persistence.listInvokeSessionDocumentReads(
    fixture.deploymentId,
    evidence.winnerSessionId,
  );
  const staleReads = await persistence.listInvokeSessionDocumentReads(
    fixture.deploymentId,
    evidence.staleSessionId,
  );
  const freshReads = await persistence.listInvokeSessionDocumentReads(
    fixture.deploymentId,
    evidence.freshSessionId,
  );
  expect(winnerReads).toEqual([
    expect.objectContaining({
      documentId: seedDocumentId,
      observedTs: seedDocumentTs,
    }),
  ]);
  expect(staleReads).toEqual([
    expect.objectContaining({
      documentId: seedDocumentId,
      observedTs: seedDocumentTs,
    }),
  ]);
  expect(freshReads).toEqual([
    expect.objectContaining({
      documentId: seedDocumentId,
      observedTs: evidence.winnerTs,
    }),
  ]);
  const winnerRead = winnerReads[0];
  const staleRead = staleReads[0];
  const freshRead = freshReads[0];
  if (
    winnerRead === undefined ||
    staleRead === undefined ||
    freshRead === undefined
  ) {
    throw new Error("Executor OCC proof document read evidence is missing.");
  }

  await expect(
    persistence.listInvokeSessionDocumentWrites(
      fixture.deploymentId,
      evidence.staleSessionId,
    ),
  ).resolves.toEqual([
    expect.objectContaining({
      documentId: seedDocumentId,
      op: "patch",
      valueJson: { count: 2, stale: "B" },
    }),
  ]);

  const counts = await persistence.query<{
    active_sessions: number;
    commits: number;
    document_revisions: number;
    outbox_events: number;
    sessions: number;
  }>(
    `select
       (select count(*)::int from invoke_sessions where deployment_id = $1) as sessions,
       (select count(*)::int from invoke_sessions where deployment_id = $1 and state = 'active') as active_sessions,
       (select count(*)::int from documents where deployment_id = $1) as document_revisions,
       (select count(*)::int from commits where deployment_id = $1) as commits,
       (select count(*)::int from outbox where deployment_id = $1) as outbox_events`,
    [fixture.deploymentId],
  );
  expect(counts.rows).toEqual([
    {
      sessions: 3,
      active_sessions: 0,
      document_revisions: 3,
      commits: 2,
      outbox_events: 2,
    },
  ]);
  const countRow = counts.rows[0];
  if (countRow === undefined) {
    throw new Error("Executor OCC proof SQL count evidence is missing.");
  }

  return {
    sessions: countRow.sessions,
    activeSessions: countRow.active_sessions,
    documentRevisions: countRow.document_revisions,
    commits: countRow.commits,
    outboxEvents: countRow.outbox_events,
    finalTs: finalRevision.ts,
    finalPrevTs: finalRevision.prevTs,
    winnerState: requireInvokeSessionState(winnerSession.state),
    staleState: requireInvokeSessionState(staleSession.state),
    freshState: requireInvokeSessionState(freshSession.state),
    winnerObservedTs: requireObservedTs(winnerRead.observedTs, "winner"),
    staleObservedTs: requireObservedTs(staleRead.observedTs, "stale"),
    freshObservedTs: requireObservedTs(freshRead.observedTs, "fresh"),
  };
}

export async function deleteExecutorOccProofDeployment(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
): Promise<ExecutorOccProofCleanupEvidence> {
  await assertExecutorOccProofCleanupCoverage(persistence);
  let scopeIds: string[] = [];
  await persistence.transaction(async (tx) => {
    const scopes = await tx.query<{ scope_id: string }>(
      "select id as scope_id from fx_control_scope where deployment_id = $1",
      [deploymentId],
    );
    if (scopes.rows.length > 1) {
      throw new Error(
        `Executor OCC proof deployment ${deploymentId} unexpectedly owns multiple scopes.`,
      );
    }
    scopeIds = scopes.rows.map((scope) => scope.scope_id);

    for (const table of deploymentScopedCleanupTables) {
      await tx.query(`delete from ${table} where deployment_id = $1`, [
        deploymentId,
      ]);
    }
    for (const scope of scopes.rows) {
      await tx.query(
        "delete from fx_control_scope_provisioning where scope_id = $1",
        [scope.scope_id],
      );
      await tx.query("delete from fx_system_scope_clock where scope_id = $1", [
        scope.scope_id,
      ]);
    }
    await tx.query("delete from fx_control_scope where deployment_id = $1", [
      deploymentId,
    ]);
    await tx.query("delete from deployments where deployment_id = $1", [
      deploymentId,
    ]);
  });

  const remaining = await listExecutorOccProofDeploymentRows(
    persistence,
    deploymentId,
    scopeIds,
  );
  if (remaining.length > 0) {
    throw new Error(
      `Executor OCC proof cleanup retained deployment rows in: ${remaining.join(", ")}`,
    );
  }
  return { scopeIds };
}

export async function listExecutorOccProofDeploymentRows(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
  capturedScopeIds?: readonly string[],
): Promise<string[]> {
  await assertExecutorOccProofCleanupCoverage(persistence);
  const remaining: string[] = [];
  for (const table of [
    ...deploymentScopedCleanupTables,
    "fx_control_scope",
    "deployments",
  ] as const) {
    const result = await persistence.query<{ count: number }>(
      `select count(*)::int as count from ${table} where deployment_id = $1`,
      [deploymentId],
    );
    if (result.rows[0]?.count !== 0) remaining.push(table);
  }
  const scopeIds =
    capturedScopeIds ??
    (
      await persistence.query<{ scope_id: string }>(
        "select id as scope_id from fx_control_scope where deployment_id = $1",
        [deploymentId],
      )
    ).rows.map((scope) => scope.scope_id);
  if (scopeIds.length > 0) {
    for (const table of scopeScopedCleanupTables) {
      const result = await persistence.query<{ count: number }>(
        `select count(*)::int as count from ${table} where scope_id = any($1::text[])`,
        [scopeIds],
      );
      if (result.rows[0]?.count !== 0) remaining.push(table);
    }
  }
  return remaining;
}

export async function assertExecutorOccProofCleanupCoverage(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  const result = await persistence.query<{ table_name: string }>(
    `select distinct columns.table_name
     from information_schema.columns as columns
     join information_schema.tables as tables
       on tables.table_schema = columns.table_schema
      and tables.table_name = columns.table_name
     where columns.table_schema = current_schema()
       and columns.column_name = 'deployment_id'
       and tables.table_type = 'BASE TABLE'
     order by columns.table_name`,
  );
  const actual = result.rows.map((row) => row.table_name);
  const expected = [
    ...deploymentScopedCleanupTables,
    "deployments",
    "fx_control_scope",
  ].sort();
  const missing = expected.filter((table) => !actual.includes(table));
  const unexpected = actual.filter((table) => !expected.includes(table));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Executor OCC proof cleanup table coverage drifted (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}).`,
    );
  }
}

const deploymentScopedCleanupTables = [
  "invoke_session_document_reads",
  "invoke_session_table_reads",
  "invoke_session_index_reads",
  "invoke_session_document_writes",
  "invoke_sessions",
  "live_query_deliveries",
  "live_query_subscriptions",
  "live_query_connections",
  "freshness_processed_events",
  "document_freshness_versions",
  "table_freshness_versions",
  "outbox",
  "commits",
  "indexes",
  "documents",
  "leases",
  "read_only",
  "persistence_globals",
  "deployment_packages",
] as const;

const scopeScopedCleanupTables = [
  "fx_control_scope_provisioning",
  "fx_system_scope_clock",
] as const;

function requireObservedTs(
  value: number | null,
  session: "winner" | "stale" | "fresh",
): number {
  if (value !== null) return value;
  throw new Error(
    `Executor OCC proof ${session} read has no observed timestamp.`,
  );
}

function requireInvokeSessionState(value: string): InvokeSessionState {
  if (value === "active" || value === "finished" || value === "aborted") {
    return value;
  }
  throw new Error(`Executor OCC proof observed invalid session state ${value}.`);
}

function sourcePackage(): Parameters<
  ReturnType<typeof createFlarexExecutor>["registerDeploymentPackage"]
>[0]["sourcePackage"] {
  return {
    modules: [
      {
        path: "messages.js",
        environment: "isolate",
        sha256: "a".repeat(64),
      },
    ],
    functions: ["messages.js"],
    execution: "_flarex/execution.js",
  };
}

function analysisJson(): Record<string, unknown> {
  return {
    schema: {
      version: 5,
      tables: [
        {
          tableId: 1,
          name: "teams",
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [
        {
          indexId: 1,
          tableId: 1,
          name: "by_name",
          fields: ["name"],
        },
      ],
    },
    functions: {
      functions: [
        {
          path: "messages:send",
          kind: "mutation",
          route: { type: "args", field: "teamId" },
          partition: {
            type: "partition",
            table: "teams",
            selector: "byId",
            partitionField: "_id",
            argField: "teamId",
          },
        },
      ],
    },
  };
}

async function startSession(
  runtime: ExecutorOccProofTransport,
  fixture: ExecutorOccProofFixture,
): Promise<{ readonly beginTs: number; readonly sessionId: string }> {
  const started = await invokeJson(
    runtime,
    "/invoke/start",
    startBody(fixture),
  );
  expect(started.response.status).toBe(200);
  const sessionId = stringField(started.body, "sessionId");
  const beginTs = numberField(started.body, "beginTs");
  expect(started.body).toEqual({
    sessionId,
    beginTs,
    identity: { kind: "anonymous" },
    schemaVersion: 5,
    function: { path: "messages:send", kind: "mutation" },
    scope: {
      kind: "partition",
      table: "teams",
      selector: "byId",
      partitionField: "_id",
      argField: "teamId",
      partitionKey: seedDocumentId,
    },
    executionModule: "_flarex/execution.js",
  });
  return { sessionId, beginTs };
}

async function expectSeedRead(
  runtime: ExecutorOccProofTransport,
  fixture: ExecutorOccProofFixture,
  sessionId: string,
): Promise<void> {
  const read = await invokeJson(runtime, "/invoke/syscall", {
    deploymentId: fixture.deploymentId,
    projectId: fixture.projectId,
    sessionId,
    op: "get",
    id: seedDocumentId,
  });
  expect(read.response.status).toBe(200);
  expect(read.body).toEqual({
    value: { _id: seedDocumentId, name: "seed", count: 0 },
    readSet: { documents: [{ tableId: 1, id: seedDocumentId }] },
  });
}

async function expectPatch(
  runtime: ExecutorOccProofTransport,
  fixture: ExecutorOccProofFixture,
  sessionId: string,
  value: Record<string, string | number | boolean>,
): Promise<void> {
  const patched = await invokeJson(runtime, "/invoke/syscall", {
    deploymentId: fixture.deploymentId,
    projectId: fixture.projectId,
    sessionId,
    op: "patch",
    id: seedDocumentId,
    value,
  });
  expect(patched.response.status).toBe(200);
  expect(patched.body).toEqual({
    value: null,
    readSet: { documents: [{ tableId: 1, id: seedDocumentId }] },
  });
}

export function executorOccProofStartBody(
  fixture: ExecutorOccProofFixture,
): Record<string, unknown> {
  return startBody(fixture);
}

function startBody(
  fixture: ExecutorOccProofFixture,
): Record<string, unknown> {
  return {
    deploymentId: fixture.deploymentId,
    projectId: fixture.projectId,
    path: "messages:send",
    kind: "mutation",
    args: { teamId: seedDocumentId, text: fixture.markerText },
    partitionKey: seedDocumentId,
  };
}

async function invokeJson(
  runtime: ExecutorOccProofTransport,
  path: string,
  body: unknown,
): Promise<{
  readonly response: ExecutorOccProofResponse;
  readonly body: Record<string, unknown>;
}> {
  const response = await runtime.request(path, body);
  const decoded: unknown = await response.json();
  if (!isRecord(decoded)) {
    throw new Error(`${path} returned a non-object JSON body.`);
  }
  if (
    decoded.error === "probe_service_binding_error" ||
    decoded.error === "executor_binding_failed"
  ) {
    throw new Error(
      `${path} service binding failed: ${String(decoded.message ?? "unknown error")}`,
    );
  }
  expect(response.headers.get(runtime.hop.header)).toBe(runtime.hop.value);
  return { response, body: decoded };
}

function stringField(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];
  if (typeof fieldValue === "string" && fieldValue.length > 0) return fieldValue;
  throw new Error(`${field} must be a non-empty string.`);
}

function numberField(value: Record<string, unknown>, field: string): number {
  const fieldValue = value[field];
  if (typeof fieldValue === "number" && Number.isSafeInteger(fieldValue)) {
    return fieldValue;
  }
  throw new Error(`${field} must be a safe integer.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function waitForClockAfter(timestamp: number): Promise<void> {
  const target = timestamp + 2;
  const deadline = Date.now() + 2_000;
  while (Date.now() < target && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  if (Date.now() < target) {
    throw new Error(`Wall clock did not advance beyond commit timestamp ${timestamp}.`);
  }
}
