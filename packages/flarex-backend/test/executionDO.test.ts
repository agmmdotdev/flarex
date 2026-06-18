import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeIndexValues, indexKeyAfterPrefix } from "../src/indexKeys";
import { SingleShardTransaction } from "../src/transaction";
import type {
  AnalyzedStartPushRequest,
  DeploymentFunctions,
  DeploymentSchema,
  Env,
  InvokeResponse,
  PushStatus,
} from "../src/types";
import { createBackendHarness, type BackendHarness } from "./backendHarness";

let harness: BackendHarness;
let env: Env;

type TestResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

beforeAll(async () => {
  harness = await createBackendHarness();
  env = await harness.mf.getBindings<Env>();
});

afterAll(async () => {
  await harness.dispose();
});

describe("ExecutionDO sessions", () => {
  it("commits mutation syscalls only after finish", async () => {
    await activateDeployment("execution-mutation-deployment", lessonSchema(), {
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
    await activateDeployment("execution-return-deployment", lessonSchema(), {
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
    await activateDeployment("execution-query-deployment", schema, {
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

  it("resolves function metadata from the active deployment, not the mutable function table", async () => {
    await activateDeployment("execution-active-deployment", lessonSchema(), {
      functions: [{ path: "lessons:list", kind: "query" }],
    });
    await putFunctions("execution-active-deployment", {
      functions: [{ path: "lessons:stale", kind: "query" }],
    });

    const response = await startExecutionResponse("execution-active-deployment", {
      path: "lessons:stale",
      kind: "query",
      partitionKey: "user:u1",
      args: null,
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Unknown active Flarex function metadata: lessons:stale",
    });
  });

  it("rejects execution sessions whose route does not match routeFromArgs metadata", async () => {
    await activateDeployment("execution-route-policy-deployment", lessonSchema(), {
      functions: [
        {
          path: "lessons:list",
          kind: "query",
          route: { type: "args", field: "userId" },
        },
      ],
    });

    const response = await startExecutionResponse("execution-route-policy-deployment", {
      path: "lessons:list",
      kind: "query",
      partitionKey: "user:wrong",
      args: { userId: "user:right" },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "RouteValidationError: partitionKey must match args.userId for lessons:list.",
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

async function activateDeployment(
  deploymentId: string,
  schema: DeploymentSchema,
  functions: DeploymentFunctions,
): Promise<void> {
  const start = await startPush(deploymentId, {
    sourcePackage: sourcePackageForFunctions(functions),
    analysis: { schema, functions },
  });
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/${start.pushId}/finish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  expect(response.ok).toBe(true);
}

async function startPush(
  deploymentId: string,
  body: AnalyzedStartPushRequest,
): Promise<PushStatus> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/start-analyzed`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  expect(response.ok).toBe(true);
  return response.json() as Promise<PushStatus>;
}

function sourcePackageForFunctions(functions: DeploymentFunctions): AnalyzedStartPushRequest["sourcePackage"] {
  const functionModules = [
    ...new Set(functions.functions.map(fn => `${fn.path.split(":")[0]}.js`)),
  ].sort();
  const modules = ["__flarex_execution.js", "__flarex_schema.js", ...functionModules].map(path => ({
    path,
    environment: "isolate" as const,
    sha256: "0".repeat(64),
  }));
  return {
    modules,
    functions: functionModules,
    schema: "__flarex_schema.js",
    execution: "__flarex_execution.js",
  };
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
  const response = await startExecutionResponse(deploymentId, body);
  expect(response.ok).toBe(true);
  return response.json() as Promise<{ sessionId: string }>;
}

async function startExecutionResponse(
  deploymentId: string,
  body: { path: string; kind: string; partitionKey: string; args: unknown },
): Promise<TestResponse> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/executions/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return response;
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
