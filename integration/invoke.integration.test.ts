import { describe, expect, it } from "vitest";

import { createFlarexExecutor } from "@flarex/executor";
import type { LiveQueryInvalidationTriggerInput } from "@flarex/executor";
import { createFlarexNitroHandler } from "@flarex/executor-nitro";
import { createMemoryFreshnessMirrorStore } from "@flarex/freshness";
import { indexBoundsForExpressions } from "@flarex/persistence-postgres";
import { createPGlitePersistence } from "@flarex/persistence-postgres/pglite";
import type { ArtifactSourcePackage } from "flarex/artifacts";

import { withPGliteIntegrationDeploymentAuthority } from "./executorPersistence";

describe("Nitro invoke integration", () => {
  it("runs insert, patch, delete mutation syscalls through Nitro and PGlite", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const freshnessStore = createMemoryFreshnessMirrorStore();
    const triggerCalls: LiveQueryInvalidationTriggerInput[] = [];
    let nextSessionId = "session_integration";
    let nowMs = 1781913600000;
    const executor = createFlarexExecutor({
      clock: { now: () => new Date(nowMs) },
      ids: { nextId: () => nextSessionId },
      persistence: withPGliteIntegrationDeploymentAuthority(persistence),
      liveQueryInvalidation: {
        freshnessStore,
        notifyTrigger: input => {
          triggerCalls.push(input);
        },
      },
    });
    const handler = createFlarexNitroHandler({ executor });

    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment_integration",
      projectId: "project_integration",
      sourcePackage: sourcePackage(),
      analysisJson: analysisJson(),
    });
    await executor.activateDeploymentPackage({
      deploymentId: "deployment_integration",
      projectId: "project_integration",
      packageId: registered.package.packageId,
      schemaVersion: 1,
    });
    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_integration",
      projectId: "project_integration",
      connectionId: "connection:deployment_integration:session_1",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "1:team" },
      partitionKey: "1:team",
      beginTs: 1781913600000,
      readSet: { tables: [{ tableId: 2, observedTs: 1781913600000 }] },
      resultJson: [],
    });

    const start = await postJson(handler, "/invoke/start", {
      deploymentId: "deployment_integration",
      projectId: "project_integration",
      path: "messages:mutate",
      kind: "mutation",
      args: { teamId: "1:team" },
      partitionKey: "1:team",
    });
    expect(start.status).toBe(200);
    const started = await start.json();
    expect(started).toMatchObject({
      sessionId: "session_integration",
      function: { path: "messages:mutate", kind: "mutation" },
      scope: { kind: "partition", partitionKey: "1:team" },
    });

    const insert = await postJson(handler, "/invoke/syscall", {
      deploymentId: "deployment_integration",
      projectId: "project_integration",
      sessionId: "session_integration",
      op: "insert",
      table: "messages",
      id: "2:message",
      value: { text: "hello", count: 1 },
    });
    expect(insert.status).toBe(200);
    await expect(insert.json()).resolves.toEqual({ value: "2:message" });

    const finishInsert = await postJson(handler, "/invoke/finish", {
      deploymentId: "deployment_integration",
      projectId: "project_integration",
      sessionId: "session_integration",
      value: null,
    });
    expect(finishInsert.status).toBe(200);
    await expect(finishInsert.json()).resolves.toMatchObject({
      committedTs: 1781913600001,
      writes: [
        {
          tableId: 2,
          id: "2:message",
          prevTs: null,
          ts: 1781913600001,
          value: { text: "hello", count: 1 },
        },
      ],
    });
    await expect(
      persistence.getDocumentRevisionAtTs(
        "deployment_integration",
        "2:message",
        1781913600001,
      ),
    ).resolves.toMatchObject({
      value: { text: "hello", count: 1 },
      deleted: false,
    });
    await expect(
      executor.findStaleLiveQuerySubscriptions({
        deploymentId: "deployment_integration",
        freshnessStore,
      }),
    ).resolves.toMatchObject({
      stale: [
        {
          subscription: {
            deploymentId: "deployment_integration",
            connectionId: "connection:deployment_integration:session_1",
            queryId: 1,
          },
          freshness: {
            status: "stale",
            stale: [
              {
                kind: "table",
                id: "2",
                observedTs: 1781913600000,
                version: 1781913600001,
              },
            ],
          },
        },
      ],
    });
    expect(triggerCalls).toEqual([
      {
        deploymentId: "deployment_integration",
        projectId: "project_integration",
        sessionId: "session_integration",
        functionPath: "messages:mutate",
        committedTs: 1781913600001,
        writes: [
          {
            tableId: 2,
            id: "2:message",
            prevTs: null,
            ts: 1781913600001,
            value: { text: "hello", count: 1 },
          },
        ],
      },
    ]);

    nextSessionId = "session_query";
    nowMs = 1781913600001;
    const queryStart = await postJson(handler, "/invoke/start", {
      deploymentId: "deployment_integration",
      projectId: "project_integration",
      path: "messages:list",
      kind: "query",
      args: { teamId: "1:team" },
      partitionKey: "1:team",
    });
    expect(queryStart.status).toBe(200);
    const query = await postJson(handler, "/invoke/syscall", {
      deploymentId: "deployment_integration",
      projectId: "project_integration",
      sessionId: "session_query",
      op: "query",
      request: { table: "messages" },
    });
    expect(query.status).toBe(200);
    await expect(query.json()).resolves.toEqual({
      value: {
        page: [{ _id: "2:message", text: "hello", count: 1 }],
        isDone: true,
        continueCursor: "2:message",
      },
      readSet: { tables: [{ tableId: 2 }] },
    });
    const finishQuery = await postJson(handler, "/invoke/finish", {
      deploymentId: "deployment_integration",
      projectId: "project_integration",
      sessionId: "session_query",
      value: { ok: true },
    });
    expect(finishQuery.status).toBe(200);
    await expect(finishQuery.json()).resolves.toEqual({
      value: { ok: true },
      readSet: { tables: [{ tableId: 2 }] },
    });

    nextSessionId = "session_index_query";
    nowMs = 1781913600001;
    const indexBounds = indexBoundsForExpressions(["text"], [
      { op: "eq", field: "text", value: "hello" },
    ]);
    const indexQueryStart = await postJson(handler, "/invoke/start", {
      deploymentId: "deployment_integration",
      projectId: "project_integration",
      path: "messages:list",
      kind: "query",
      args: { teamId: "1:team" },
      partitionKey: "1:team",
    });
    expect(indexQueryStart.status).toBe(200);
    const indexQuery = await postJson(handler, "/invoke/syscall", {
      deploymentId: "deployment_integration",
      projectId: "project_integration",
      sessionId: "session_index_query",
      op: "query",
      request: {
        table: "messages",
        index: "by_text",
        range: {
          expressions: [{ op: "eq", field: "text", value: "hello" }],
        },
      },
    });
    expect(indexQuery.status).toBe(200);
    await expect(indexQuery.json()).resolves.toEqual({
      value: {
        page: [{ _id: "2:message", text: "hello", count: 1 }],
        isDone: true,
        continueCursor: expect.any(String),
      },
      readSet: {
        documents: [{ tableId: 2, id: "2:message", observedTs: 1781913600001 }],
        indexes: [{ indexId: 1, ...indexBounds }],
      },
    });
    const finishIndexQuery = await postJson(handler, "/invoke/finish", {
      deploymentId: "deployment_integration",
      projectId: "project_integration",
      sessionId: "session_index_query",
      value: { ok: true },
    });
    expect(finishIndexQuery.status).toBe(200);
    await expect(finishIndexQuery.json()).resolves.toEqual({
      value: { ok: true },
      readSet: {
        documents: [{ tableId: 2, id: "2:message", observedTs: 1781913600001 }],
        indexes: [{ indexId: 1, ...indexBounds }],
      },
    });

    nextSessionId = "session_patch";
    nowMs = 1781913600001;
    await runMutationSession(handler, "deployment_integration", [
      {
        op: "patch",
        id: "2:message",
        value: { count: 2 },
      },
    ]);
    await expect(
      persistence.getDocumentRevisionAtTs(
        "deployment_integration",
        "2:message",
        1781913600002,
      ),
    ).resolves.toMatchObject({
      ts: 1781913600002,
      prevTs: 1781913600001,
      value: { text: "hello", count: 2 },
      deleted: false,
    });

    nextSessionId = "session_delete";
    nowMs = 1781913600002;
    await runMutationSession(handler, "deployment_integration", [
      {
        op: "delete",
        id: "2:message",
      },
    ]);
    await expect(
      persistence.getDocumentRevisionAtTs(
        "deployment_integration",
        "2:message",
        1781913600003,
      ),
    ).resolves.toMatchObject({
      ts: 1781913600003,
      prevTs: 1781913600002,
      value: null,
      deleted: true,
    });
  });

  it("triggers live query invalidation for every committed mutation write shape", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const freshnessStore = createMemoryFreshnessMirrorStore();
    const triggerCalls: LiveQueryInvalidationTriggerInput[] = [];
    let nextSessionId = "session_seed";
    let nowMs = 1781913600100;
    const executor = createFlarexExecutor({
      clock: { now: () => new Date(nowMs) },
      ids: { nextId: () => nextSessionId },
      persistence: withPGliteIntegrationDeploymentAuthority(persistence),
      liveQueryInvalidation: {
        freshnessStore,
        notifyTrigger: input => {
          triggerCalls.push(input);
        },
      },
    });
    const handler = createFlarexNitroHandler({ executor });

    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment_write_shapes",
      projectId: "project_integration",
      sourcePackage: sourcePackage(),
      analysisJson: analysisJson(),
    });
    await executor.activateDeploymentPackage({
      deploymentId: "deployment_write_shapes",
      projectId: "project_integration",
      packageId: registered.package.packageId,
      schemaVersion: 1,
    });

    const seed = await runMutationSession(handler, "deployment_write_shapes", [
      {
        op: "insert",
        table: "messages",
        id: "2:message",
        value: { text: "hello", count: 1 },
      },
    ]);
    expect(seed).toMatchObject({
      committedTs: 1781913600101,
      writes: [
        {
          tableId: 2,
          id: "2:message",
          prevTs: null,
          ts: 1781913600101,
          value: { text: "hello", count: 1 },
        },
      ],
    });

    nextSessionId = "session_patch_shape";
    nowMs = 1781913600101;
    const patch = await runMutationSession(handler, "deployment_write_shapes", [
      { op: "patch", id: "2:message", value: { count: 2 } },
    ]);
    expect(patch).toMatchObject({
      committedTs: 1781913600102,
      writes: [
        {
          tableId: 2,
          id: "2:message",
          prevTs: 1781913600101,
          ts: 1781913600102,
          value: { text: "hello", count: 2 },
        },
      ],
    });

    nextSessionId = "session_replace_shape";
    nowMs = 1781913600102;
    const replace = await runMutationSession(handler, "deployment_write_shapes", [
      {
        op: "replace",
        id: "2:message",
        value: { text: "replaced", count: 3 },
      },
    ]);
    expect(replace).toMatchObject({
      committedTs: 1781913600103,
      writes: [
        {
          tableId: 2,
          id: "2:message",
          prevTs: 1781913600102,
          ts: 1781913600103,
          value: { text: "replaced", count: 3 },
        },
      ],
    });

    nextSessionId = "session_multi_shape";
    nowMs = 1781913600103;
    const multi = await runMutationSession(handler, "deployment_write_shapes", [
      {
        op: "insert",
        table: "messages",
        id: "2:second",
        value: { text: "second", count: 1 },
      },
      { op: "patch", id: "2:message", value: { count: 4 } },
    ]);
    expect(multi).toMatchObject({
      committedTs: 1781913600104,
      writes: expect.arrayContaining([
        expect.objectContaining({
          tableId: 2,
          id: "2:second",
          prevTs: null,
          ts: 1781913600104,
          value: { text: "second", count: 1 },
        }),
        expect.objectContaining({
          tableId: 2,
          id: "2:message",
          prevTs: 1781913600103,
          ts: 1781913600104,
          value: { text: "replaced", count: 4 },
        }),
      ]),
    });

    nextSessionId = "session_delete_shape";
    nowMs = 1781913600104;
    const deleted = await runMutationSession(handler, "deployment_write_shapes", [
      { op: "delete", id: "2:second" },
    ]);
    expect(deleted).toMatchObject({
      committedTs: 1781913600105,
      writes: [
        {
          tableId: 2,
          id: "2:second",
          prevTs: 1781913600104,
          ts: 1781913600105,
          value: null,
        },
      ],
    });

    const triggerCountBeforeNoWrite = triggerCalls.length;
    nextSessionId = "session_no_write_shape";
    nowMs = 1781913600105;
    const noWrite = await runMutationSession(handler, "deployment_write_shapes", []);
    expect(noWrite).toMatchObject({
      value: null,
      writes: [],
    });
    expect(triggerCalls).toHaveLength(triggerCountBeforeNoWrite);

    expect(triggerCalls.map(call => ({
      sessionId: call.sessionId,
      committedTs: call.committedTs,
      ids: call.writes.map(write => write.id).sort(),
    }))).toEqual([
      {
        sessionId: "session_seed",
        committedTs: 1781913600101,
        ids: ["2:message"],
      },
      {
        sessionId: "session_patch_shape",
        committedTs: 1781913600102,
        ids: ["2:message"],
      },
      {
        sessionId: "session_replace_shape",
        committedTs: 1781913600103,
        ids: ["2:message"],
      },
      {
        sessionId: "session_multi_shape",
        committedTs: 1781913600104,
        ids: ["2:message", "2:second"],
      },
      {
        sessionId: "session_delete_shape",
        committedTs: 1781913600105,
        ids: ["2:second"],
      },
    ]);
    expect(freshnessStore.getDocumentVersion(
      "deployment_write_shapes",
      "2:message",
    )).toMatchObject({ version: 1781913600104 });
    expect(freshnessStore.getDocumentVersion(
      "deployment_write_shapes",
      "2:second",
    )).toMatchObject({ version: 1781913600105 });
    expect(freshnessStore.getTableVersion("deployment_write_shapes", 2))
      .toMatchObject({ version: 1781913600105 });
  });

  it("rejects invalid inserted documents before commit", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T00:00:00.000Z") },
      ids: { nextId: () => "session_invalid" },
      persistence: withPGliteIntegrationDeploymentAuthority(persistence),
    });
    const handler = createFlarexNitroHandler({ executor });

    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment_invalid",
      projectId: "project_integration",
      sourcePackage: sourcePackage(),
      analysisJson: analysisJson(),
    });
    await executor.activateDeploymentPackage({
      deploymentId: "deployment_invalid",
      projectId: "project_integration",
      packageId: registered.package.packageId,
      schemaVersion: 1,
    });

    const start = await postJson(handler, "/invoke/start", {
      deploymentId: "deployment_invalid",
      projectId: "project_integration",
      path: "messages:mutate",
      kind: "mutation",
      args: { teamId: "1:team" },
      partitionKey: "1:team",
    });
    expect(start.status).toBe(200);

    const insert = await postJson(handler, "/invoke/syscall", {
      deploymentId: "deployment_invalid",
      projectId: "project_integration",
      sessionId: "session_invalid",
      op: "insert",
      table: "messages",
      id: "2:bad",
      value: { text: 123, count: 1 },
    });
    expect(insert.status).toBe(200);

    const finish = await postJson(handler, "/invoke/finish", {
      deploymentId: "deployment_invalid",
      projectId: "project_integration",
      sessionId: "session_invalid",
      value: null,
    });
    expect(finish.status).toBe(400);
    await expect(finish.json()).resolves.toMatchObject({
      error: "InvokeSessionDocumentValidationError",
    });
    await expect(
      persistence.getDocumentRevisionAtTs("deployment_invalid", "2:bad", 1781913600001),
    ).resolves.toBeNull();
  });

  it("aborts invoke sessions without committing staged writes", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T00:00:00.000Z") },
      ids: { nextId: () => "session_abort" },
      persistence: withPGliteIntegrationDeploymentAuthority(persistence),
    });
    const handler = createFlarexNitroHandler({ executor });

    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment_abort",
      projectId: "project_integration",
      sourcePackage: sourcePackage(),
      analysisJson: analysisJson(),
    });
    await executor.activateDeploymentPackage({
      deploymentId: "deployment_abort",
      projectId: "project_integration",
      packageId: registered.package.packageId,
      schemaVersion: 1,
    });

    const start = await postJson(handler, "/invoke/start", {
      deploymentId: "deployment_abort",
      projectId: "project_integration",
      path: "messages:mutate",
      kind: "mutation",
      args: { teamId: "1:team" },
      partitionKey: "1:team",
    });
    expect(start.status).toBe(200);

    const insert = await postJson(handler, "/invoke/syscall", {
      deploymentId: "deployment_abort",
      projectId: "project_integration",
      sessionId: "session_abort",
      op: "insert",
      table: "messages",
      id: "2:aborted",
      value: { text: "abort", count: 1 },
    });
    expect(insert.status).toBe(200);

    const abort = await postJson(handler, "/invoke/abort", {
      deploymentId: "deployment_abort",
      projectId: "project_integration",
      sessionId: "session_abort",
    });
    expect(abort.status).toBe(200);
    await expect(abort.json()).resolves.toEqual({ aborted: true });

    await expect(
      persistence.getInvokeSessionMetadata("deployment_abort", "session_abort"),
    ).resolves.toMatchObject({ state: "aborted" });
    await expect(
      persistence.getDocumentRevisionAtTs("deployment_abort", "2:aborted", 1781913600001),
    ).resolves.toBeNull();

    const finish = await postJson(handler, "/invoke/finish", {
      deploymentId: "deployment_abort",
      projectId: "project_integration",
      sessionId: "session_abort",
      value: null,
    });
    expect(finish.status).toBe(409);
    await expect(finish.json()).resolves.toMatchObject({
      error: "InvokeSessionNotActiveError",
    });
  });
});

async function runMutationSession(
  handler: (event: { request: Request }) => Promise<Response>,
  deploymentId: string,
  syscalls: Array<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const start = await postJson(handler, "/invoke/start", {
    deploymentId,
    projectId: "project_integration",
    path: "messages:mutate",
    kind: "mutation",
    args: { teamId: "1:team" },
    partitionKey: "1:team",
  });
  expect(start.status).toBe(200);
  const started = await start.json();
  expect(isStartedInvokeSession(started)).toBe(true);
  for (const syscall of syscalls) {
    const response = await postJson(handler, "/invoke/syscall", {
      deploymentId,
      projectId: "project_integration",
      sessionId: started.sessionId,
      ...syscall,
    });
    if (response.status !== 200) {
      throw new Error(`Unexpected syscall status ${response.status}: ${await response.text()}`);
    }
    expect(response.status).toBe(200);
  }
  const finish = await postJson(handler, "/invoke/finish", {
    deploymentId,
    projectId: "project_integration",
    sessionId: started.sessionId,
    value: null,
  });
  expect(finish.status).toBe(200);
  const body = await finish.json();
  expect(isRecord(body)).toBe(true);
  return body;
}

async function postJson(
  handler: (event: { request: Request }) => Promise<Response>,
  path: string,
  body: unknown,
): Promise<Response> {
  return handler({
    request: new Request(`https://executor.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStartedInvokeSession(
  value: unknown,
): value is { sessionId: string } {
  return isRecord(value) && typeof value.sessionId === "string";
}

function sourcePackage(): ArtifactSourcePackage {
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
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "teams",
          placement: { kind: "partitionBy", field: "_id" },
        },
        {
          tableId: 2,
          name: "messages",
          placement: { kind: "colocateWith", table: "teams", field: "teamId" },
          validator: {
            type: "object",
            value: {
              text: { fieldType: { type: "string" }, optional: false },
              count: { fieldType: { type: "number" }, optional: false },
            },
          },
        },
      ],
      indexes: [
        {
          indexId: 1,
          tableId: 2,
          name: "by_text",
          fields: ["text"],
          state: "enabled",
        },
      ],
    },
    functions: {
      functions: [
        {
          path: "messages:list",
          kind: "query",
          route: { type: "args", field: "teamId" },
          partition: {
            type: "partition",
            table: "teams",
            selector: "byId",
            partitionField: "_id",
            argField: "teamId",
          },
        },
        {
          path: "messages:mutate",
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
