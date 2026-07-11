import { describe, expect, it } from "vitest";
import type { PostgresFlarexPersistence } from "@flarex/persistence-postgres/postgres";

import {
  h04DeploymentId,
  h04ProjectId,
  h04ServiceBindingHop,
  type ServiceBindingPostgresResponse,
  type ServiceBindingPostgresRuntime,
  withTemporaryServiceBindingPostgres,
} from "./serviceBindingPostgresHarness";

describe(
  "private named executor service binding against real PostgreSQL",
  { timeout: 120_000 },
  () => {
    it("proves authenticated invoke, stale OCC conflict, abort, and fresh convergence", async () => {
      await withTemporaryServiceBindingPostgres(runServiceBindingScenario, verifyAuthoritativeState);
    });
  },
);

interface RuntimeEvidence {
  readonly staleSessionId: string;
  readonly freshSessionId: string;
  readonly winnerSessionId: string;
  readonly winnerTs: number;
  readonly freshTs: number;
}

async function runServiceBindingScenario(
  runtime: ServiceBindingPostgresRuntime,
): Promise<RuntimeEvidence> {
  expect(runtime.callerBindingKeys).toEqual(["FLAREX_EXECUTOR"]);
  expect(runtime.executorBindingKeys).toEqual([
    "FLAREX_EXECUTOR_TOKEN",
    "HYPERDRIVE_CACHE_DISABLED",
  ]);
  await expect(runtime.executorDirectUrl()).rejects.toThrow(
    'Direct access disabled in "flarex-executor" worker',
  );

  const unauthorized = await invokeJson(
    runtime,
    "/invoke/start",
    startBody(),
    false,
  );
  expect(unauthorized.response.status).toBe(401);
  expect(unauthorized.body).toEqual({
    error: "unauthorized",
    message: "Unauthorized Flarex executor request.",
  });

  const winnerStart = await startSession(runtime);
  const staleStart = await startSession(runtime);
  expect(staleStart.sessionId).not.toBe(winnerStart.sessionId);

  await expectSeedRead(runtime, winnerStart.sessionId);
  await expectSeedRead(runtime, staleStart.sessionId);
  await expectPatch(runtime, winnerStart.sessionId, {
    count: 1,
    winner: "A",
  });
  await expectPatch(runtime, staleStart.sessionId, {
    count: 2,
    stale: "B",
  });

  const winnerFinish = await invokeJson(runtime, "/invoke/finish", {
    deploymentId: h04DeploymentId,
    projectId: h04ProjectId,
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
        id: "1:team",
        prevTs: 10,
        ts: winnerTs,
        value: { name: "seed", count: 1, winner: "A" },
      },
    ],
  });

  const staleFinish = await invokeJson(runtime, "/invoke/finish", {
    deploymentId: h04DeploymentId,
    projectId: h04ProjectId,
    sessionId: staleStart.sessionId,
    value: { attempt: "stale" },
  });
  expect(staleFinish.response.status).toBe(409);
  expect(staleFinish.body).toEqual({
    error: "InvokeSessionOccConflictError",
    message: `OCC conflict for ${h04DeploymentId}/1:team: observed 10, current ${winnerTs}`,
  });

  const aborted = await invokeJson(runtime, "/invoke/abort", {
    deploymentId: h04DeploymentId,
    projectId: h04ProjectId,
    sessionId: staleStart.sessionId,
  });
  expect(aborted.response.status).toBe(200);
  expect(aborted.body).toEqual({ aborted: true });

  const afterAbort = await invokeJson(runtime, "/invoke/syscall", {
    deploymentId: h04DeploymentId,
    projectId: h04ProjectId,
    sessionId: staleStart.sessionId,
    op: "get",
    id: "1:team",
  });
  expect(afterAbort.response.status).toBe(409);
  expect(afterAbort.body).toMatchObject({
    error: "InvokeSessionNotActiveError",
  });

  await waitForClockAfter(winnerTs);
  const freshStart = await startSession(runtime);
  expect(freshStart.beginTs).toBeGreaterThan(winnerTs);
  const freshRead = await invokeJson(runtime, "/invoke/syscall", {
    deploymentId: h04DeploymentId,
    projectId: h04ProjectId,
    sessionId: freshStart.sessionId,
    op: "get",
    id: "1:team",
  });
  expect(freshRead.response.status).toBe(200);
  expect(freshRead.body).toEqual({
    value: { _id: "1:team", name: "seed", count: 1, winner: "A" },
    readSet: { documents: [{ tableId: 1, id: "1:team" }] },
  });
  await expectPatch(runtime, freshStart.sessionId, {
    count: 3,
    converged: true,
  });

  const freshFinish = await invokeJson(runtime, "/invoke/finish", {
    deploymentId: h04DeploymentId,
    projectId: h04ProjectId,
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
        id: "1:team",
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

async function verifyAuthoritativeState(
  persistence: PostgresFlarexPersistence,
  evidence: RuntimeEvidence,
): Promise<void> {
  await expect(
    persistence.getDocumentRevisionAtTs(
      h04DeploymentId,
      "1:team",
      Number.MAX_SAFE_INTEGER,
    ),
  ).resolves.toMatchObject({
    id: "1:team",
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
  await expect(
    persistence.getInvokeSessionMetadata(
      h04DeploymentId,
      evidence.winnerSessionId,
    ),
  ).resolves.toMatchObject({ state: "finished" });
  await expect(
    persistence.getInvokeSessionMetadata(
      h04DeploymentId,
      evidence.staleSessionId,
    ),
  ).resolves.toMatchObject({ state: "aborted" });
  await expect(
    persistence.getInvokeSessionMetadata(
      h04DeploymentId,
      evidence.freshSessionId,
    ),
  ).resolves.toMatchObject({ state: "finished" });

  await expect(
    persistence.listInvokeSessionDocumentReads(
      h04DeploymentId,
      evidence.winnerSessionId,
    ),
  ).resolves.toEqual([
    expect.objectContaining({ documentId: "1:team", observedTs: 10 }),
  ]);
  await expect(
    persistence.listInvokeSessionDocumentReads(
      h04DeploymentId,
      evidence.staleSessionId,
    ),
  ).resolves.toEqual([
    expect.objectContaining({ documentId: "1:team", observedTs: 10 }),
  ]);
  await expect(
    persistence.listInvokeSessionDocumentReads(
      h04DeploymentId,
      evidence.freshSessionId,
    ),
  ).resolves.toEqual([
    expect.objectContaining({
      documentId: "1:team",
      observedTs: evidence.winnerTs,
    }),
  ]);
  await expect(
    persistence.listInvokeSessionDocumentWrites(
      h04DeploymentId,
      evidence.staleSessionId,
    ),
  ).resolves.toEqual([
    expect.objectContaining({
      documentId: "1:team",
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
    [h04DeploymentId],
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
}

async function startSession(
  runtime: ServiceBindingPostgresRuntime,
): Promise<{ readonly beginTs: number; readonly sessionId: string }> {
  const started = await invokeJson(runtime, "/invoke/start", startBody());
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
      partitionKey: "1:team",
    },
    executionModule: "_flarex/execution.js",
  });
  return { sessionId, beginTs };
}

async function expectSeedRead(
  runtime: ServiceBindingPostgresRuntime,
  sessionId: string,
): Promise<void> {
  const read = await invokeJson(runtime, "/invoke/syscall", {
    deploymentId: h04DeploymentId,
    projectId: h04ProjectId,
    sessionId,
    op: "get",
    id: "1:team",
  });
  expect(read.response.status).toBe(200);
  expect(read.body).toEqual({
    value: { _id: "1:team", name: "seed", count: 0 },
    readSet: { documents: [{ tableId: 1, id: "1:team" }] },
  });
}

async function expectPatch(
  runtime: ServiceBindingPostgresRuntime,
  sessionId: string,
  value: Record<string, string | number | boolean>,
): Promise<void> {
  const patched = await invokeJson(runtime, "/invoke/syscall", {
    deploymentId: h04DeploymentId,
    projectId: h04ProjectId,
    sessionId,
    op: "patch",
    id: "1:team",
    value,
  });
  expect(patched.response.status).toBe(200);
  expect(patched.body).toEqual({
    value: null,
    readSet: { documents: [{ tableId: 1, id: "1:team" }] },
  });
}

function startBody(): Record<string, unknown> {
  return {
    deploymentId: h04DeploymentId,
    projectId: h04ProjectId,
    path: "messages:send",
    kind: "mutation",
    args: { teamId: "1:team", text: "h04" },
    partitionKey: "1:team",
  };
}

async function invokeJson(
  runtime: ServiceBindingPostgresRuntime,
  path: string,
  body: unknown,
  authorized = true,
): Promise<{
  readonly response: ServiceBindingPostgresResponse;
  readonly body: Record<string, unknown>;
}> {
  const response = await runtime.request(path, body, { authorized });
  expect(response.headers.get(h04ServiceBindingHop.header)).toBe(
    h04ServiceBindingHop.value,
  );
  const decoded: unknown = await response.json();
  if (!isRecord(decoded)) {
    throw new Error(`${path} returned a non-object JSON body.`);
  }
  if (decoded.error === "probe_service_binding_error") {
    throw new Error(
      `${path} service binding failed: ${String(decoded.message ?? "unknown error")}`,
    );
  }
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
