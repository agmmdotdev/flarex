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
          partition: lessonPartition(),
        },
      ],
    });

    const start = await startExecution("execution-mutation-deployment", {
      path: "lessons:complete",
      kind: "mutation",
      partitionKey: "u1",
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
      "u1",
    );
    await expect(beforeFinish.get(1, "1:progress-intro")).resolves.toBeNull();

    await syscall("execution-mutation-deployment", start.sessionId, {
      op: "patch",
      id: "1:progress-intro",
      value: { completed: true },
    });
    await syscall("execution-mutation-deployment", start.sessionId, {
      op: "replace",
      id: "1:progress-intro",
      value: { userId: "u1", lessonId: "intro", completed: true },
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
          args: {
            type: "object",
            value: {
              userId: { fieldType: { type: "string" }, optional: false },
            },
          },
          partition: lessonPartition(),
        },
      ],
    });

    const start = await startExecution("execution-return-deployment", {
      path: "lessons:badReturn",
      kind: "mutation",
      partitionKey: "u1",
      args: { userId: "u1" },
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

    const tx = await SingleShardTransaction.begin(env, "execution-return-deployment", "u1");
    await expect(tx.get(1, "1:bad-return")).resolves.toBeNull();

    const afterFailedFinish = await syscallResponse(
      "execution-return-deployment",
      start.sessionId,
      { op: "get", id: "1:bad-return" },
    );
    expect(afterFailedFinish.status).toBe(409);
    await expect(afterFailedFinish.json()).resolves.toEqual({
      error: "Execution session has not started.",
    });
  });

  it("runs create-root mutation sessions through preallocated root insert syscalls", async () => {
    const schema = userProfileSchema();
    await activateDeployment("execution-create-root-deployment", schema, {
      functions: [
        {
          path: "users:create",
          kind: "mutation",
          args: {
            type: "object",
            value: {
              name: { fieldType: { type: "string" }, optional: false },
            },
          },
          partition: createUsersPartition(),
        },
      ],
    });

    const start = await startExecution("execution-create-root-deployment", {
      path: "users:create",
      kind: "mutation",
      args: { name: "Ada" },
    });

    const userId = await syscall("execution-create-root-deployment", start.sessionId, {
      op: "insert",
      table: "users",
      value: { name: "Ada" },
    }) as string;
    expect(userId).toMatch(/^2:/);

    const profileId = await syscall("execution-create-root-deployment", start.sessionId, {
      op: "insert",
      table: "profiles",
      id: "1:profile",
      value: { userId, bio: "Hello" },
    }) as string;
    expect(profileId).toBe("1:profile");

    const finish = await finishExecution("execution-create-root-deployment", start.sessionId, {
      userId,
      profileId,
    });
    expect(finish.value).toEqual({ userId, profileId });
    expect(finish.writes).toEqual([
      { tableId: 2, id: userId, prevTs: null, ts: 1, value: { name: "Ada" } },
      {
        tableId: 1,
        id: "1:profile",
        prevTs: null,
        ts: 1,
        value: { userId, bio: "Hello" },
      },
    ]);

    const tx = await SingleShardTransaction.begin(
      env,
      "execution-create-root-deployment",
      String(userId),
    );
    await expect(tx.get(2, String(userId))).resolves.toMatchObject({ value: { name: "Ada" } });
    await expect(tx.get(1, "1:profile")).resolves.toMatchObject({
      value: { userId, bio: "Hello" },
    });
  });

  it("rejects create-root sessions that skip or override the preallocated root id", async () => {
    await activateDeployment("execution-create-root-reject-deployment", userProfileSchema(), {
      functions: [
        {
          path: "users:create",
          kind: "mutation",
          args: {
            type: "object",
            value: {
              name: { fieldType: { type: "string" }, optional: false },
            },
          },
          partition: createUsersPartition(),
        },
      ],
    });

    const missingRoot = await startExecution("execution-create-root-reject-deployment", {
      path: "users:create",
      kind: "mutation",
      args: { name: "Ada" },
    });
    const missingRootFinish = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/execution-create-root-reject-deployment/executions/${missingRoot.sessionId}/finish`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: null }),
      },
    );
    expect(missingRootFinish.status).toBe(500);
    await expect(missingRootFinish.json()).resolves.toMatchObject({
      error: expect.stringMatching(/^Create-root transaction must insert root document 2:/),
    });

    const wrongRoot = await startExecution("execution-create-root-reject-deployment", {
      path: "users:create",
      kind: "mutation",
      args: { name: "Grace" },
    });
    const wrongRootInsert = await syscallResponse(
      "execution-create-root-reject-deployment",
      wrongRoot.sessionId,
      {
        op: "insert",
        table: "users",
        id: "2:wrong",
        value: { name: "Grace" },
      },
    );
    expect(wrongRootInsert.status).toBe(500);
    await expect(wrongRootInsert.json()).resolves.toMatchObject({
      error: expect.stringMatching(/^Create-root insert for table 2 must use preallocated root id 2:/),
    });
  });

  it("serves indexed query syscalls from a session snapshot", async () => {
    const schema = lessonSchema();
    await activateDeployment("execution-query-deployment", schema, {
      functions: [
        {
          path: "lessons:list",
          kind: "query",
          args: {
            type: "object",
            value: {
              userId: { fieldType: { type: "string" }, optional: false },
            },
          },
          partition: lessonPartition(),
        },
      ],
    });
    await SingleShardTransaction.ensureSchema(env, "execution-query-deployment", "u1", schema);
    const seed = await SingleShardTransaction.begin(env, "execution-query-deployment", "u1");
    seed.insert(1, { userId: "u1", lessonId: "intro", completed: true }, "1:intro");
    await seed.commit({ source: "seed" });

    const start = await startExecution("execution-query-deployment", {
      path: "lessons:list",
      kind: "query",
      partitionKey: "u1",
      args: { userId: "u1" },
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
    expect(finish.readTs).toBe(start.beginTs);
  });

  it("aborts execution sessions without committing staged syscalls", async () => {
    await activateDeployment("execution-abort-deployment", lessonSchema(), {
      functions: [
        {
          path: "lessons:abort",
          kind: "mutation",
          args: {
            type: "object",
            value: {
              userId: { fieldType: { type: "string" }, optional: false },
            },
          },
          partition: lessonPartition(),
        },
      ],
    });

    const start = await startExecution("execution-abort-deployment", {
      path: "lessons:abort",
      kind: "mutation",
      partitionKey: "u1",
      args: { userId: "u1" },
    });
    await syscall("execution-abort-deployment", start.sessionId, {
      op: "insert",
      table: "lessonProgress",
      id: "1:aborted-progress",
      value: { userId: "u1", lessonId: "abort", completed: false },
    });

    const aborted = await abortExecutionResponse(
      "execution-abort-deployment",
      start.sessionId,
      {},
    );
    expect(aborted.status).toBe(200);
    await expect(aborted.json()).resolves.toEqual({ aborted: true });

    const tx = await SingleShardTransaction.begin(env, "execution-abort-deployment", "u1");
    await expect(tx.get(1, "1:aborted-progress")).resolves.toBeNull();

    const afterAbort = await syscallResponse(
      "execution-abort-deployment",
      start.sessionId,
      { op: "get", id: "1:aborted-progress" },
    );
    expect(afterAbort.status).toBe(409);
    await expect(afterAbort.json()).resolves.toEqual({
      error: "Execution session has not started.",
    });
  });

  it("resolves function metadata from the active deployment", async () => {
    await activateDeployment("execution-active-deployment", lessonSchema(), {
      functions: [{ path: "lessons:list", kind: "query" }],
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

  it("maps missing active deployment loads at the execution adapter edge", async () => {
    const response = await startExecutionResponse("execution-missing-active-deployment", {
      path: "lessons:list",
      kind: "query",
      partitionKey: "user:u1",
      args: null,
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to load active deployment execution-missing-active-deployment.",
    });
  });

  it("rejects execution sessions without partition metadata", async () => {
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
      error: "PartitionValidationError: function lessons:list must declare partition metadata.",
    });
  });

  it("uses stored partition metadata as the authoritative execution session scope", async () => {
    await activateDeployment("execution-partition-scope-deployment", teamSchema(), {
      functions: [
        {
          path: "teams:create",
          kind: "mutation",
          args: {
            type: "object",
            value: {
              teamSlug: { fieldType: { type: "string" }, optional: false },
            },
          },
          partition: {
            type: "partition",
            table: "teams",
            selector: "bySlug",
            partitionField: "slug",
            argField: "teamSlug",
          },
        },
      ],
    });

    const response = await startExecutionResponse("execution-partition-scope-deployment", {
      path: "teams:create",
      kind: "mutation",
      partitionKey: "wrong",
      args: { teamSlug: "acme" },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "PartitionValidationError: partitionKey must match args.teamSlug for teams:create.",
    });
  });

  it("maps execution start argument validation at the adapter edge", async () => {
    await activateDeployment("execution-start-args-deployment", lessonSchema(), {
      functions: [
        {
          path: "lessons:list",
          kind: "query",
          args: {
            type: "object",
            value: {
              userId: { fieldType: { type: "string" }, optional: false },
            },
          },
          partition: lessonPartition(),
        },
      ],
    });

    const response = await startExecutionResponse("execution-start-args-deployment", {
      path: "lessons:list",
      kind: "query",
      partitionKey: "u1",
      args: { userId: 42 },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "ArgumentValidationError: $args.userId: Expected a string.",
    });
  });

  it("maps execution start function kind validation at the adapter edge", async () => {
    await activateDeployment("execution-start-kind-deployment", lessonSchema(), {
      functions: [
        {
          path: "lessons:complete",
          kind: "mutation",
          args: {
            type: "object",
            value: {
              userId: { fieldType: { type: "string" }, optional: false },
            },
          },
          partition: lessonPartition(),
        },
        {
          path: "lessons:runAction",
          kind: "action",
        },
      ],
    });

    const mismatch = await startExecutionResponse("execution-start-kind-deployment", {
      path: "lessons:complete",
      kind: "query",
      partitionKey: "u1",
      args: { userId: "u1" },
    });
    expect(mismatch.status).toBe(400);
    await expect(mismatch.json()).resolves.toEqual({
      error: "Function kind mismatch. Request has query, function is mutation.",
    });

    const unsupported = await startExecutionResponse("execution-start-kind-deployment", {
      path: "lessons:runAction",
      kind: "query",
      partitionKey: "u1",
      args: null,
    });
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toEqual({
      error: "action execution is not implemented by execution sessions.",
    });
  });

  it("decodes public execution start bodies before creating a session", async () => {
    await activateDeployment("execution-start-boundary-deployment", lessonSchema(), {
      functions: [
        {
          path: "lessons:list",
          kind: "query",
          args: {
            type: "object",
            value: {
              userId: { fieldType: { type: "string" }, optional: false },
            },
          },
          partition: lessonPartition(),
        },
      ],
    });

    const invalid = await startExecutionResponse("execution-start-boundary-deployment", {
      path: "lessons:list",
      kind: "query",
      partitionKey: "u1",
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error:
        "Execution start request must include string deploymentId, string path, JSON args, and optional string partitionKey, projectId, idempotencyKey, and query or mutation kind.",
    });

    const malformed = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/execution-start-boundary-deployment/executions/start",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });

    const routeDeploymentWins = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/execution-start-boundary-deployment/executions/start",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deploymentId: "missing-body-deployment",
          path: "lessons:list",
          kind: "query",
          partitionKey: "u1",
          args: { userId: "u1" },
        }),
      },
    );
    expect(routeDeploymentWins.ok).toBe(true);
    await expect(routeDeploymentWins.json()).resolves.toMatchObject({
      beginTs: expect.any(Number),
      kind: "query",
      schemaVersion: 1,
      sessionId: expect.any(String),
    });
  });

  it("decodes execution syscall bodies before session dispatch", async () => {
    const invalid = await syscallResponse(
      "execution-syscall-boundary-deployment",
      "missing-session",
      {
        op: "query",
        request: {
          table: "lessonProgress",
          order: "sideways",
        },
      },
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error:
        "Execution syscall request must be a valid get, query, insert, patch, replace, or delete operation.",
    });

    const unknownSession = await syscallResponse(
      "execution-syscall-boundary-deployment",
      "missing-session",
      { op: "get", id: "1:progress" },
    );
    expect(unknownSession.status).toBe(409);
    await expect(unknownSession.json()).resolves.toEqual({
      error: "Execution session has not started.",
    });

    const malformed = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/execution-syscall-boundary-deployment/executions/missing-session/syscall",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });

    const missingSession = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/execution-syscall-boundary-deployment/executions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "get", id: "1:progress" }),
      },
    );
    expect(missingSession.status).toBe(400);
    await expect(missingSession.json()).resolves.toEqual({
      error: "Missing execution session id.",
    });

    const missingAction = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/execution-syscall-boundary-deployment/executions/missing-session",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "get", id: "1:progress" }),
      },
    );
    expect(missingAction.status).toBe(400);
    await expect(missingAction.json()).resolves.toEqual({
      error: "Missing execution action.",
    });

    const unknownAction = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/execution-syscall-boundary-deployment/executions/missing-session/unknown",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "get", id: "1:progress" }),
      },
    );
    expect(unknownAction.status).toBe(404);
    await expect(unknownAction.json()).resolves.toEqual({
      error: "Execution route not found.",
    });
  });

  it("decodes execution finish bodies before session dispatch", async () => {
    const invalid = await finishExecutionResponse(
      "execution-finish-boundary-deployment",
      "missing-session",
      {},
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: "Execution finish request must include JSON value.",
    });

    const unknownSession = await finishExecutionResponse(
      "execution-finish-boundary-deployment",
      "missing-session",
      { value: null },
    );
    expect(unknownSession.status).toBe(409);
    await expect(unknownSession.json()).resolves.toEqual({
      error: "Execution session has not started.",
    });

    const malformed = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/execution-finish-boundary-deployment/executions/missing-session/finish",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });
  });

  it("keeps execution abort as a bodyless control message", async () => {
    const emptyAbort = await abortExecutionResponse(
      "execution-abort-boundary-deployment",
      "missing-session",
      {},
    );
    expect(emptyAbort.status).toBe(200);
    await expect(emptyAbort.json()).resolves.toEqual({ aborted: true });

    const ignoredBody = await abortExecutionResponse(
      "execution-abort-boundary-deployment",
      "missing-session",
      { ignored: true },
    );
    expect(ignoredBody.status).toBe(200);
    await expect(ignoredBody.json()).resolves.toEqual({ aborted: true });

    const malformed = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/execution-abort-boundary-deployment/executions/missing-session/abort",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: "Request body must be JSON.",
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
      {
        tableId: 2,
        name: "users",
        placement: { kind: "partitionBy", field: "_id" },
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

function lessonPartition() {
  return {
    type: "partition" as const,
    table: "users",
    selector: "byId",
    partitionField: "_id",
    argField: "userId",
  };
}

function teamSchema(): DeploymentSchema {
  return {
    version: 1,
    tables: [
      {
        tableId: 1,
        name: "teams",
        placement: { kind: "partitionBy", field: "slug" },
      },
    ],
    indexes: [],
  };
}

function userProfileSchema(): DeploymentSchema {
  return {
    version: 1,
    tables: [
      {
        tableId: 1,
        name: "profiles",
        placement: { kind: "colocateWith", table: "users", field: "userId" },
      },
      {
        tableId: 2,
        name: "users",
        placement: { kind: "partitionBy", field: "_id" },
      },
    ],
    indexes: [],
  };
}

function createUsersPartition() {
  return {
    type: "partitionCreateRoot" as const,
    table: "users",
    partitionField: "_id" as const,
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

async function startExecution(
  deploymentId: string,
  body: { path: string; kind: string; partitionKey?: string; args: unknown },
): Promise<{ sessionId: string; beginTs: number }> {
  const response = await startExecutionResponse(deploymentId, body);
  expect(response.ok).toBe(true);
  return startExecutionResult(await response.json());
}

async function startExecutionResponse(
  deploymentId: string,
  body: {
    path: string;
    kind: string;
    partitionKey?: string;
    args?: unknown;
  },
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
  const response = await syscallResponse(deploymentId, sessionId, body);
  expect(response.ok).toBe(true);
  return response.json();
}

async function syscallResponse(
  deploymentId: string,
  sessionId: string,
  body: unknown,
): Promise<TestResponse> {
  return harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/executions/${sessionId}/syscall`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

async function finishExecution(
  deploymentId: string,
  sessionId: string,
  value: unknown,
): Promise<InvokeResponse> {
  const response = await finishExecutionResponse(deploymentId, sessionId, {
    value,
  });
  expect(response.ok).toBe(true);
  return response.json() as Promise<InvokeResponse>;
}

async function finishExecutionResponse(
  deploymentId: string,
  sessionId: string,
  body: unknown,
): Promise<TestResponse> {
  return harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/executions/${sessionId}/finish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

async function abortExecutionResponse(
  deploymentId: string,
  sessionId: string,
  body: unknown,
): Promise<TestResponse> {
  return harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/executions/${sessionId}/abort`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function startExecutionResult(value: unknown): { sessionId: string; beginTs: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Execution start response must be an object.");
  }
  const result = value as Record<string, unknown>;
  if (typeof result.sessionId !== "string") {
    throw new Error("Execution start response sessionId must be a string.");
  }
  if (typeof result.beginTs !== "number") {
    throw new Error("Execution start response beginTs must be a number.");
  }
  return {
    sessionId: result.sessionId,
    beginTs: result.beginTs,
  };
}
