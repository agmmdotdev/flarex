import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeIndexValues, indexKeyAfterPrefix } from "../src/indexKeys";
import { SingleShardTransaction } from "../src/transaction";
import type { DeploymentSchema, Env, InvokeResponse } from "../src/types";
import { createBackendHarness, type BackendHarness } from "./backendHarness";

let harness: BackendHarness;
let env: Env;

beforeAll(async () => {
  harness = await createBackendHarness();
  env = await harness.mf.getBindings<Env>();
});

afterAll(async () => {
  await harness.dispose();
});

describe("ExecutionDO sessions", () => {
  it("commits mutation syscalls only after finish", async () => {
    await putSchema("execution-mutation-deployment", lessonSchema());
    await putFunctions("execution-mutation-deployment", {
      functions: [
        {
          path: "lessons:complete",
          kind: "mutation",
          args: {
            type: "object",
            value: {
              userId: { fieldType: { type: "string" }, optional: false },
              lessonId: { fieldType: { type: "string" }, optional: false },
            },
          },
          returns: {
            type: "object",
            value: {
              ok: { fieldType: { type: "boolean" }, optional: false },
            },
          },
        },
      ],
    });

    const start = await startExecution("execution-mutation-deployment", {
      path: "lessons:complete",
      kind: "mutation",
      partitionKey: "user:u1",
      args: { userId: "u1", lessonId: "intro" },
    });

    const inserted = await syscall("execution-mutation-deployment", start.sessionId, {
      op: "insert",
      table: "lessonProgress",
      id: "1:progress-intro",
      value: { userId: "u1", lessonId: "intro", completed: false },
    });
    expect(inserted).toBe("1:progress-intro");

    const beforeFinish = await SingleShardTransaction.begin(
      env,
      "execution-mutation-deployment",
      "user:u1",
    );
    await expect(beforeFinish.get(1, "1:progress-intro")).resolves.toBeNull();

    await syscall("execution-mutation-deployment", start.sessionId, {
      op: "patch",
      id: "1:progress-intro",
      value: { completed: true },
    });

    const finish = await finishExecution("execution-mutation-deployment", start.sessionId, {
      ok: true,
    });
    expect(finish).toMatchObject({
      value: { ok: true },
      committedTs: 1,
      writes: [
        {
          id: "1:progress-intro",
          value: { userId: "u1", lessonId: "intro", completed: true },
        },
      ],
    });
  });

  it("validates returns before committing mutation syscalls", async () => {
    await putSchema("execution-return-deployment", lessonSchema());
    await putFunctions("execution-return-deployment", {
      functions: [
        {
          path: "lessons:badReturn",
          kind: "mutation",
          returns: {
            type: "object",
            value: {
              ok: { fieldType: { type: "boolean" }, optional: false },
            },
          },
        },
      ],
    });

    const start = await startExecution("execution-return-deployment", {
      path: "lessons:badReturn",
      kind: "mutation",
      partitionKey: "user:u1",
      args: null,
    });
    await syscall("execution-return-deployment", start.sessionId, {
      op: "insert",
      table: "lessonProgress",
      id: "1:bad-return",
      value: { userId: "u1", lessonId: "bad", completed: false },
    });

    const response = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/execution-return-deployment/executions/${start.sessionId}/finish`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: { ok: "yes" } }),
      },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "ReturnValidationError: $return.ok: Expected a boolean.",
    });

    const tx = await SingleShardTransaction.begin(env, "execution-return-deployment", "user:u1");
    await expect(tx.get(1, "1:bad-return")).resolves.toBeNull();
  });

  it("serves indexed query syscalls from a session snapshot", async () => {
    const schema = lessonSchema();
    await putSchema("execution-query-deployment", schema);
    await putFunctions("execution-query-deployment", {
      functions: [{ path: "lessons:list", kind: "query" }],
    });
    await SingleShardTransaction.ensureSchema(env, "execution-query-deployment", "user:u1", schema);
    const seed = await SingleShardTransaction.begin(env, "execution-query-deployment", "user:u1");
    seed.insert(1, { userId: "u1", lessonId: "intro", completed: true }, "1:intro");
    await seed.commit({ source: "seed" });

    const start = await startExecution("execution-query-deployment", {
      path: "lessons:list",
      kind: "query",
      partitionKey: "user:u1",
      args: null,
    });
    const queryResult = await syscall("execution-query-deployment", start.sessionId, {
      op: "query",
      request: {
        table: "lessonProgress",
        index: "by_user_lesson",
        range: { expressions: [{ op: "eq", field: "userId", value: "u1" }] },
      },
    });
    expect(queryResult).toMatchObject({ isDone: true });
    expect((queryResult as { page: unknown[] }).page).toEqual([
      {
        _id: "1:intro",
        userId: "u1",
        lessonId: "intro",
        completed: true,
      },
    ]);

    const finish = await finishExecution(
      "execution-query-deployment",
      start.sessionId,
      (queryResult as { page: unknown[] }).page,
    );
    const lower = encodeIndexValues(["u1"]);
    expect(finish.readSet).toEqual({
      indexes: [
        {
          indexId: 1,
          lower,
          upper: indexKeyAfterPrefix(lower),
        },
      ],
    });
  });
});

function lessonSchema(): DeploymentSchema {
  return {
    version: 1,
    tables: [
      {
        tableId: 1,
        name: "lessonProgress",
        placement: { kind: "colocateWith", table: "users", field: "userId" },
      },
    ],
    indexes: [
      {
        indexId: 1,
        tableId: 1,
        name: "by_user_lesson",
        fields: ["userId", "lessonId"],
      },
    ],
  };
}

async function putSchema(deploymentId: string, schema: DeploymentSchema): Promise<void> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/schema`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(schema),
    },
  );
  expect(response.ok).toBe(true);
}

async function putFunctions(
  deploymentId: string,
  functions: { functions: Array<{ path: string; kind: string; args?: unknown; returns?: unknown }> },
): Promise<void> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/functions`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(functions),
    },
  );
  expect(response.ok).toBe(true);
}

async function startExecution(
  deploymentId: string,
  body: { path: string; kind: string; partitionKey: string; args: unknown },
): Promise<{ sessionId: string }> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/executions/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  expect(response.ok).toBe(true);
  return response.json() as Promise<{ sessionId: string }>;
}

async function syscall(deploymentId: string, sessionId: string, body: unknown): Promise<unknown> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/executions/${sessionId}/syscall`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  expect(response.ok).toBe(true);
  return response.json();
}

async function finishExecution(
  deploymentId: string,
  sessionId: string,
  value: unknown,
): Promise<InvokeResponse> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/executions/${sessionId}/finish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    },
  );
  expect(response.ok).toBe(true);
  return response.json() as Promise<InvokeResponse>;
}
