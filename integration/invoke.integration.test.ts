import { describe, expect, it } from "vitest";

import { createFlarexExecutor } from "@flarex/executor";
import { createFlarexNitroHandler } from "@flarex/executor-nitro";
import { createPGlitePersistence } from "@flarex/persistence-postgres/pglite";
import type { ArtifactSourcePackage } from "flarex/artifacts";

describe("Nitro invoke integration", () => {
  it("runs insert, patch, delete mutation syscalls through Nitro and PGlite", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    let nextSessionId = "session_integration";
    let nowMs = 1781913600000;
    const executor = createFlarexExecutor({
      clock: { now: () => new Date(nowMs) },
      ids: { nextId: () => nextSessionId },
      persistence,
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

  it("rejects invalid inserted documents before commit", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T00:00:00.000Z") },
      ids: { nextId: () => "session_invalid" },
      persistence,
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
});

async function runMutationSession(
  handler: (event: { request: Request }) => Promise<Response>,
  deploymentId: string,
  syscalls: Array<Record<string, unknown>>,
): Promise<void> {
  const start = await postJson(handler, "/invoke/start", {
    deploymentId,
    projectId: "project_integration",
    path: "messages:mutate",
    kind: "mutation",
    args: { teamId: "1:team" },
    partitionKey: "1:team",
  });
  expect(start.status).toBe(200);
  const started = (await start.json()) as { sessionId: string };
  for (const syscall of syscalls) {
    const response = await postJson(handler, "/invoke/syscall", {
      deploymentId,
      projectId: "project_integration",
      sessionId: started.sessionId,
      ...syscall,
    });
    expect(response.status).toBe(200);
  }
  const finish = await postJson(handler, "/invoke/finish", {
    deploymentId,
    projectId: "project_integration",
    sessionId: started.sessionId,
    value: null,
  });
  expect(finish.status).toBe(200);
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
      indexes: [],
    },
    functions: {
      functions: [
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
