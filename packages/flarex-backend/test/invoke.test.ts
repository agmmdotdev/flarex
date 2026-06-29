import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  executeInvoke,
  InvokeArgumentValidationError,
  InvokeFunctionNotFoundError,
  InvokeReturnValidationError,
  invokeValidationErrorToHttpError,
  loadActiveDeployment,
  resolveInvokeFunctionForRequest,
  resolveFunctionExecutionScope,
  validateReturnEffect,
  type BackendFunctionRegistry,
} from "../src/invoke";
import { encodeIndexValues, indexKeyAfterPrefix } from "../src/indexKeys";
import { SingleShardTransaction } from "../src/transaction";
import type {
  AnalyzedStartPushRequest,
  ActiveDeploymentStatus,
  DeploymentFunctions,
  DeploymentSchema,
  Env,
  PushStatus,
} from "../src/types";
import { createBackendHarness, type BackendHarness } from "./backendHarness";

let harness: BackendHarness;
let env: Env;
const testDeploymentSchemas = new Map<string, DeploymentSchema>();
const testDeploymentFunctions = new Map<string, DeploymentFunctions>();

beforeAll(async () => {
  harness = await createBackendHarness();
  env = await harness.mf.getBindings<Env>();
});

afterAll(async () => {
  await harness.dispose();
});

describe("executeInvoke", () => {
  it("reports invoke argument validation as a typed Effect failure before adapter mapping", async () => {
    await putSchema("typed-argument-validation-deployment", {
      version: 1,
      tables: [],
      indexes: [],
    });
    const activeDeployment = await loadActiveDeployment(env, "typed-argument-validation-deployment");
    const functions: BackendFunctionRegistry = {
      "users:greet": {
        kind: "query",
        args: {
          type: "object",
          value: {
            name: { fieldType: { type: "string" }, optional: false },
          },
        },
        handler: () => null,
      },
    };

    const failure = await Effect.runPromise(
      resolveInvokeFunctionForRequest(
        activeDeployment,
        {
          path: "users:greet",
          kind: "query",
          partitionKey: "user:u1",
          args: { name: 42 },
        },
        functions,
      ).pipe(
        Effect.catchTag("InvokeArgumentValidationError", error => Effect.succeed(error)),
      ),
    );

    expect(failure).toBeInstanceOf(InvokeArgumentValidationError);
    if (!(failure instanceof InvokeArgumentValidationError)) {
      throw new Error("Expected InvokeArgumentValidationError.");
    }
    expect(failure.message).toBe("$args.name: Expected a string.");
    expect(invokeValidationErrorToHttpError(failure)).toMatchObject({
      status: 400,
      message: "ArgumentValidationError: $args.name: Expected a string.",
    });
  });

  it("reports invoke return validation as a typed Effect failure before adapter mapping", async () => {
    const failure = await Effect.runPromise(
      validateReturnEffect(
        { type: "string" },
        123,
        emptyActiveDeployment().analysis.schema,
      ).pipe(
        Effect.catchTag("InvokeReturnValidationError", error => Effect.succeed(error)),
      ),
    );

    expect(failure).toBeInstanceOf(InvokeReturnValidationError);
    if (!(failure instanceof InvokeReturnValidationError)) {
      throw new Error("Expected InvokeReturnValidationError.");
    }
    expect(failure.message).toBe("$return: Expected a string.");
    expect(invokeValidationErrorToHttpError(failure)).toMatchObject({
      status: 400,
      message: "ReturnValidationError: $return: Expected a string.",
    });
  });

  it("keeps unknown invoke functions typed until the adapter boundary", async () => {
    const failure = await Effect.runPromise(
      resolveInvokeFunctionForRequest(
        emptyActiveDeployment(),
        {
          path: "missing:function",
          kind: "query",
          args: null,
        },
        {},
      ).pipe(
        Effect.catchTag("InvokeFunctionNotFoundError", error => Effect.succeed(error)),
      ),
    );

    expect(failure).toBeInstanceOf(InvokeFunctionNotFoundError);
    if (!(failure instanceof InvokeFunctionNotFoundError)) {
      throw new Error("Expected InvokeFunctionNotFoundError.");
    }
    expect(invokeValidationErrorToHttpError(failure)).toMatchObject({
      status: 404,
      message: "Unknown Flarex function: missing:function",
    });
  });

  it("plans create-root partitions by preallocating the root id before execution", () => {
    const schema: DeploymentSchema = {
      version: 1,
      tables: [
        {
          tableId: 2,
          name: "users",
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [],
    };

    const scope = resolveFunctionExecutionScope(
      {
        type: "partitionCreateRoot",
        table: "users",
        partitionField: "_id",
      },
      null,
      {
        path: "users:create",
        args: { name: "Ada" },
      },
      schema,
      {
        allocateRootId: table => `${table.tableId}:preallocated-user`,
      },
    );

    expect(scope).toEqual({
      kind: "partitionCreateRoot",
      table: "users",
      partitionField: "_id",
      partitionKey: "2:preallocated-user",
      preallocatedRootId: "2:preallocated-user",
    });
  });

  it("rejects invalid create-root execution plans before transaction begin", () => {
    const schema: DeploymentSchema = {
      version: 1,
      tables: [
        {
          tableId: 2,
          name: "users",
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [],
    };
    const partition = {
      type: "partitionCreateRoot" as const,
      table: "users",
      partitionField: "_id" as const,
    };

    expect(() =>
      resolveFunctionExecutionScope(
        partition,
        { type: "args", field: "userId" },
        { path: "users:create", args: { name: "Ada" } },
        schema,
      ),
    ).toThrow("create-root partition for users:create cannot declare route metadata.");

    expect(() =>
      resolveFunctionExecutionScope(
        partition,
        null,
        {
          path: "users:create",
          args: { name: "Ada" },
          partitionKey: "2:client-supplied",
        },
        schema,
        { allocateRootId: () => "2:preallocated-user" },
      ),
    ).toThrow(
      "partitionKey cannot be supplied for create-root users:create; backend preallocated 2:preallocated-user.",
    );

    expect(() =>
      resolveFunctionExecutionScope(
        partition,
        null,
        { path: "users:create", args: { name: "Ada" } },
        schema,
        { allocateRootId: () => "1:not-a-user" },
      ),
    ).toThrow(
      "preallocated root id for users:create must be an ID for table users.",
    );
  });

  it("executes create-root partitions by consuming the preallocated id on root insert", async () => {
    await putSchema("create-root-execution-deployment", {
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
    });

    const result = await executeInvoke(
      env,
      "create-root-execution-deployment",
      {
        path: "users:create",
        kind: "mutation",
        args: { name: "Ada" },
      },
      {
        "users:create": {
          kind: "mutation",
          partition: createUsersPartition(),
          handler: async ctx => {
            const userId = await ctx.db.insert("users", { name: "Ada" });
            const profileId = await ctx.db.insert("profiles", { userId, bio: "Hello" }, "1:profile");
            return { userId, profileId };
          },
        },
      },
    );

    expect(result.value).toMatchObject({ profileId: "1:profile" });
    const userId = (result.value as { userId: string }).userId;
    expect(userId).toMatch(/^2:/);
    expect(result.writes).toEqual([
      expect.objectContaining({
        tableId: 2,
        id: userId,
        value: { name: "Ada" },
      }),
      expect.objectContaining({
        tableId: 1,
        id: "1:profile",
        value: { userId, bio: "Hello" },
      }),
    ]);

    const tx = await SingleShardTransaction.begin(env, "create-root-execution-deployment", userId);
    await expect(tx.get(2, userId)).resolves.toMatchObject({ value: { name: "Ada" } });
    await expect(tx.get(1, "1:profile")).resolves.toMatchObject({
      value: { userId, bio: "Hello" },
    });
  });

  it("requires create-root handlers to consume exactly one preallocated root insert", async () => {
    await putSchema("create-root-consumption-deployment", {
      version: 1,
      tables: [
        {
          tableId: 2,
          name: "users",
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [],
    });

    await expect(
      executeInvoke(
        env,
        "create-root-consumption-deployment",
        {
          path: "users:missingRoot",
          kind: "mutation",
          args: { name: "Ada" },
        },
        {
          "users:missingRoot": {
            kind: "mutation",
            partition: createUsersPartition(),
            handler: async () => null,
          },
        },
      ),
    ).rejects.toThrow("Create-root transaction must insert root document 2:");

    await expect(
      executeInvoke(
        env,
        "create-root-consumption-deployment",
        {
          path: "users:wrongRoot",
          kind: "mutation",
          args: { name: "Ada" },
        },
        {
          "users:wrongRoot": {
            kind: "mutation",
            partition: createUsersPartition(),
            handler: async ctx => ctx.db.insert("users", { name: "Ada" }, "2:wrong"),
          },
        },
      ),
    ).rejects.toThrow("Create-root insert for table 2 must use preallocated root id 2:");

    await expect(
      executeInvoke(
        env,
        "create-root-consumption-deployment",
        {
          path: "users:doubleRoot",
          kind: "mutation",
          args: { name: "Ada" },
        },
        {
          "users:doubleRoot": {
            kind: "mutation",
            partition: createUsersPartition(),
            handler: async ctx => {
              await ctx.db.insert("users", { name: "Ada" });
              await ctx.db.insert("users", { name: "Grace" });
              return null;
            },
          },
        },
      ),
    ).rejects.toThrow("Create-root transaction already inserted root document 2:");

    await expect(
      executeInvoke(
        env,
        "create-root-consumption-deployment",
        {
          path: "users:deleteRoot",
          kind: "mutation",
          args: { name: "Ada" },
        },
        {
          "users:deleteRoot": {
            kind: "mutation",
            partition: createUsersPartition(),
            handler: async ctx => {
              const id = await ctx.db.insert("users", { name: "Ada" });
              await ctx.db.delete(id);
              return null;
            },
          },
        },
      ),
    ).rejects.toThrow("Create-root transaction must commit root document 2:");
  });

  it("executes a registered mutation against SingleShardTransaction", async () => {
    await putSchema("invoke-deployment", {
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
    });

    const functions: BackendFunctionRegistry = {
      "lessons:complete": {
        kind: "mutation",
        partition: userPartition(),
        handler: async (ctx, args) => {
          const input = args as { userId: string; lessonId: string };
          const id = await ctx.db.insert(
            "lessonProgress",
            {
              userId: input.userId,
              lessonId: input.lessonId,
              completed: false,
            },
            `1:progress-${input.lessonId}`,
          );
          await ctx.db.patch(id, { completed: true });
          return { id };
        },
      },
      "lessons:byUserLesson": {
        kind: "query",
        partition: userPartition(),
        handler: async (ctx, args) => {
          const input = args as { userId: string; lessonId: string };
          return ctx.db
            .query("lessonProgress")
            .withIndex("by_user_lesson", q =>
              q.eq("userId", input.userId).eq("lessonId", input.lessonId),
            )
            .collect();
        },
      },
      "lessons:byUser": {
        kind: "query",
        partition: userPartition(),
        handler: async (ctx, args) => {
          const input = args as { userId: string };
          return ctx.db
            .query("lessonProgress")
            .withIndex("by_user_lesson", q => q.eq("userId", input.userId))
            .collect();
        },
      },
      "lessons:range": {
        kind: "query",
        partition: userPartition(),
        handler: async (ctx, args) => {
          const input = args as { userId: string; from: string; to: string };
          return ctx.db
            .query("lessonProgress")
            .withIndex("by_user_lesson", q =>
              q.eq("userId", input.userId).gte("lessonId", input.from).lt("lessonId", input.to),
            )
            .collect();
        },
      },
    };

    const result = await executeInvoke(
      env,
      "invoke-deployment",
      {
        path: "lessons:complete",
        kind: "mutation",
        partitionKey: "u1",
        idempotencyKey: "complete-once",
        args: { userId: "u1", lessonId: "lesson-1" },
      },
      functions,
    );

    expect(result.value).toEqual({ id: "1:progress-lesson-1" });
    expect(result.committedTs).toBe(1);
    expect(result.writes).toHaveLength(1);
    expect(result.writes?.[0]?.value).toEqual({
      userId: "u1",
      lessonId: "lesson-1",
      completed: true,
    });

    const tx = await SingleShardTransaction.begin(env, "invoke-deployment", "u1");
    await expect(tx.get(1, "1:progress-lesson-1")).resolves.toMatchObject({
      value: {
        userId: "u1",
        lessonId: "lesson-1",
        completed: true,
      },
    });

    const indexed = await executeInvoke(
      env,
      "invoke-deployment",
      {
        path: "lessons:byUserLesson",
        kind: "query",
        partitionKey: "u1",
        args: { userId: "u1", lessonId: "lesson-1" },
      },
      functions,
    );
    expect(indexed.value).toEqual([
      {
        _id: "1:progress-lesson-1",
        userId: "u1",
        lessonId: "lesson-1",
        completed: true,
      },
    ]);
    const exactKey = encodeIndexValues(["u1", "lesson-1"]);
    expect(indexed.readSet).toEqual({
      indexes: [
        {
          indexId: 1,
          lower: exactKey,
          upper: indexKeyAfterPrefix(exactKey),
        },
      ],
    });

    const byUser = await executeInvoke(
      env,
      "invoke-deployment",
      {
        path: "lessons:byUser",
        kind: "query",
        partitionKey: "u1",
        args: { userId: "u1" },
      },
      functions,
    );
    expect(byUser.value).toHaveLength(1);
    const userPrefix = encodeIndexValues(["u1"]);
    expect(byUser.readSet).toEqual({
      indexes: [
        {
          indexId: 1,
          lower: userPrefix,
          upper: indexKeyAfterPrefix(userPrefix),
        },
      ],
    });

    await executeInvoke(
      env,
      "invoke-deployment",
      {
        path: "lessons:complete",
        kind: "mutation",
        partitionKey: "u1",
        args: { userId: "u1", lessonId: "lesson-2" },
      },
      functions,
    );
    const ranged = await executeInvoke(
      env,
      "invoke-deployment",
      {
        path: "lessons:range",
        kind: "query",
        partitionKey: "u1",
        args: { userId: "u1", from: "lesson-2", to: "lesson-3" },
      },
      functions,
    );
    expect(ranged.value).toEqual([
      expect.objectContaining({ userId: "u1", lessonId: "lesson-2" }),
    ]);
  });

  it("executes a registered query without committing writes", async () => {
    await putSchema("query-deployment", {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "users",
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [],
    });

    const seed = await SingleShardTransaction.begin(env, "query-deployment", "user:u1");
    seed.insert(1, { name: "Ada" }, "1:user");
    await seed.commit({ source: "seed" });

    const functions: BackendFunctionRegistry = {
      "users:get": {
        kind: "query",
        partition: userPartition(),
        handler: ctx => ctx.db.get("1:user"),
      },
    };

    const result = await executeInvoke(
      env,
      "query-deployment",
      {
        path: "users:get",
        kind: "query",
        partitionKey: "user:u1",
        args: { userId: "user:u1" },
      },
      functions,
    );

    expect(result.value).toEqual({ _id: "1:user", name: "Ada" });
    expect(result.readSet).toEqual({ documents: [{ tableId: 1, id: "1:user" }] });
    expect(result.committedTs).toBeUndefined();
  });

  it("rejects invalid arguments before executing the function", async () => {
    await putSchema("argument-validation-deployment", {
      version: 1,
      tables: [],
      indexes: [],
    });
    let executed = false;
    const functions: BackendFunctionRegistry = {
      "users:greet": {
        kind: "query",
        args: {
          type: "object",
          value: {
            name: { fieldType: { type: "string" }, optional: false },
          },
        },
        handler: () => {
          executed = true;
          return null;
        },
      },
    };

    await expect(
      executeInvoke(
        env,
        "argument-validation-deployment",
        {
          path: "users:greet",
          kind: "query",
          partitionKey: "user:u1",
          args: { name: 42 },
        },
        functions,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "ArgumentValidationError: $args.name: Expected a string.",
    });
    expect(executed).toBe(false);
  });

  it("uses deployment-owned function metadata for invoke validation", async () => {
    await putSchema("function-metadata-deployment", {
      version: 1,
      tables: [],
      indexes: [],
    });
    await putFunctions("function-metadata-deployment", {
      functions: [
        {
          path: "users:greet",
          kind: "query",
          visibility: "public",
          args: {
            type: "object",
            value: {
              name: { fieldType: { type: "string" }, optional: false },
            },
          },
          returns: null,
          route: null,
        },
      ],
    });

    let executed = false;
    const functions: BackendFunctionRegistry = {
      "users:greet": {
        kind: "query",
        handler: () => {
          executed = true;
          return "hello";
        },
      },
    };

    await expect(
      executeInvoke(
        env,
        "function-metadata-deployment",
        {
          path: "users:greet",
          kind: "query",
          partitionKey: "user:u1",
          args: { name: 42 },
        },
        functions,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "ArgumentValidationError: $args.name: Expected a string.",
    });
    expect(executed).toBe(false);

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/function-metadata-deployment/deployment",
    );
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      analysis: {
        functions: {
          functions: [
            {
              path: "users:greet",
              kind: "query",
              visibility: "public",
              args: {
                type: "object",
                value: {
                  name: { fieldType: { type: "string" }, optional: false },
                },
              },
              returns: null,
              route: null,
              partition: null,
            },
          ],
        },
      },
    });
  });

  it("rejects invoke functions without partition metadata", async () => {
    await putSchema("invoke-route-policy-deployment", {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "lessonProgress",
          placement: { kind: "partitionBy", field: "userId" },
        },
      ],
      indexes: [],
    });

    const functions: BackendFunctionRegistry = {
      "lessons:list": {
        kind: "query",
        route: { type: "args", field: "userId" },
        handler: async () => [],
      },
    };

    await expect(
      executeInvoke(
        env,
        "invoke-route-policy-deployment",
        {
          path: "lessons:list",
          kind: "query",
          partitionKey: "user:wrong",
          args: { userId: "user:right" },
        },
        functions,
      ),
    ).rejects.toThrow(
      "PartitionValidationError: function lessons:list must declare partition metadata.",
    );
  });

  it("uses stored partition metadata as the authoritative invoke execution scope", async () => {
    await putSchema("invoke-partition-scope-deployment", {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "teams",
          placement: { kind: "partitionBy", field: "slug" },
        },
      ],
      indexes: [],
    });
    await putFunctions("invoke-partition-scope-deployment", {
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

    const functions: BackendFunctionRegistry = {
      "teams:create": {
        kind: "mutation",
        handler: async () => null,
      },
    };

    await expect(
      executeInvoke(
        env,
        "invoke-partition-scope-deployment",
        {
          path: "teams:create",
          kind: "mutation",
          partitionKey: "wrong",
          args: { teamSlug: "acme" },
        },
        functions,
      ),
    ).rejects.toThrow(
      "PartitionValidationError: partitionKey must match args.teamSlug for teams:create.",
    );

    await expect(
      executeInvoke(
        env,
        "invoke-partition-scope-deployment",
        {
          path: "teams:create",
          kind: "mutation",
          partitionKey: "acme",
          args: { teamSlug: "acme" },
        },
        functions,
      ),
    ).resolves.toMatchObject({ value: null });
  });

  it("enforces colocateWith placement on user-code reads and writes", async () => {
    await putSchema("placement-validation-deployment", {
      version: 1,
      tables: [
        {
          tableId: 2,
          name: "users",
          placement: { kind: "partitionBy", field: "_id" },
        },
        {
          tableId: 1,
          name: "scores",
          placement: { kind: "colocateWith", table: "users", field: "userId" },
        },
      ],
      indexes: [],
    });

    const seed = await SingleShardTransaction.begin(
      env,
      "placement-validation-deployment",
      "u1",
    );
    seed.insert(1, { userId: "u1", score: 10 }, "1:score");
    seed.insert(1, { userId: "u2", score: 99 }, "1:misplaced");
    await seed.commit({ source: "seed" });

    const functions: BackendFunctionRegistry = {
      "scores:insertWrongOwner": {
        kind: "mutation",
        partition: userPartition(),
        handler: ctx => ctx.db.insert("scores", { userId: "u2", score: 1 }, "1:wrong"),
      },
      "scores:moveOwner": {
        kind: "mutation",
        partition: userPartition(),
        handler: async ctx => {
          await ctx.db.patch("1:score", { userId: "u2" });
          return null;
        },
      },
      "scores:readMisplaced": {
        kind: "query",
        partition: userPartition(),
        handler: ctx => ctx.db.get("1:misplaced"),
      },
    };

    for (const path of ["scores:insertWrongOwner", "scores:moveOwner", "scores:readMisplaced"]) {
      await expect(
        executeInvoke(
          env,
          "placement-validation-deployment",
          {
            path,
            kind: path === "scores:readMisplaced" ? "query" : "mutation",
            partitionKey: "u1",
            args: { userId: "u1" },
          },
          functions,
        ),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("PlacementValidationError"),
      });
    }

    const check = await SingleShardTransaction.begin(
      env,
      "placement-validation-deployment",
      "u1",
    );
    await expect(check.get(1, "1:wrong")).resolves.toBeNull();
    await expect(check.get(1, "1:score")).resolves.toMatchObject({
      value: { userId: "u1", score: 10 },
    });
  });

  it("requires colocated index queries to constrain the placement field", async () => {
    const schema = {
      version: 1,
      tables: [
        {
          tableId: 2,
          name: "users",
          placement: { kind: "partitionBy", field: "_id" },
        },
        {
          tableId: 1,
          name: "scores",
          placement: { kind: "colocateWith", table: "users", field: "userId" },
        },
      ],
      indexes: [
        { indexId: 1, tableId: 1, name: "by_user_score", fields: ["userId", "score"] },
        { indexId: 2, tableId: 1, name: "by_score", fields: ["score"] },
      ],
    } satisfies DeploymentSchema;
    await putSchema("placement-query-deployment", schema);
    await SingleShardTransaction.ensureSchema(env, "placement-query-deployment", "u1", schema);
    const seed = await SingleShardTransaction.begin(env, "placement-query-deployment", "u1");
    seed.insert(1, { userId: "u1", score: 10 }, "1:u1-score");
    await seed.commit({ source: "seed" });

    const functions: BackendFunctionRegistry = {
      "scores:missingOwner": {
        kind: "query",
        partition: userPartition(),
        handler: ctx =>
          ctx.db.query("scores").withIndex("by_score", q => q.eq("score", 10)).collect(),
      },
      "scores:wrongOwner": {
        kind: "query",
        partition: userPartition(),
        handler: ctx =>
          ctx.db.query("scores").withIndex("by_user_score", q => q.eq("userId", "u2")).collect(),
      },
      "scores:validOwner": {
        kind: "query",
        partition: userPartition(),
        handler: ctx =>
          ctx.db
            .query("scores")
            .withIndex("by_user_score", q => q.eq("userId", "u1").eq("score", 10))
            .collect(),
      },
    };

    await expect(
      executeInvoke(
        env,
        "placement-query-deployment",
        {
          path: "scores:missingOwner",
          kind: "query",
          partitionKey: "u1",
          args: { userId: "u1" },
        },
        functions,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'PlacementValidationError: query on scores must include q.eq("userId", partitionKey).',
    });

    await expect(
      executeInvoke(
        env,
        "placement-query-deployment",
        {
          path: "scores:wrongOwner",
          kind: "query",
          partitionKey: "u1",
          args: { userId: "u1" },
        },
        functions,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "PlacementValidationError: query on scores must constrain userId to partitionKey u1.",
    });

    await expect(
      executeInvoke(
        env,
        "placement-query-deployment",
        {
          path: "scores:validOwner",
          kind: "query",
          partitionKey: "u1",
          args: { userId: "u1" },
        },
        functions,
      ),
    ).resolves.toMatchObject({
      value: [{ _id: "1:u1-score", userId: "u1", score: 10 }],
    });
  });

  it("enforces partitionBy field placement on user-code reads, writes, and queries", async () => {
    const schema = {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "cartItems",
          placement: { kind: "partitionBy", field: "cartId" },
        },
      ],
      indexes: [
        { indexId: 1, tableId: 1, name: "by_cart_sku", fields: ["cartId", "sku"] },
        { indexId: 2, tableId: 1, name: "by_sku", fields: ["sku"] },
      ],
    } satisfies DeploymentSchema;
    await putSchema("partition-field-deployment", schema);
    await SingleShardTransaction.ensureSchema(env, "partition-field-deployment", "cart:1", schema);
    const seed = await SingleShardTransaction.begin(env, "partition-field-deployment", "cart:1");
    seed.insert(1, { cartId: "cart:1", sku: "tea", quantity: 1 }, "1:tea");
    await seed.commit({ source: "seed" });

    const functions: BackendFunctionRegistry = {
      "cartItems:insertWrongCart": {
        kind: "mutation",
        partition: cartPartition(),
        handler: ctx =>
          ctx.db.insert(
            "cartItems",
            { cartId: "cart:2", sku: "coffee", quantity: 1 },
            "1:coffee",
          ),
      },
      "cartItems:moveCart": {
        kind: "mutation",
        partition: cartPartition(),
        handler: async ctx => {
          await ctx.db.patch("1:tea", { cartId: "cart:2" });
          return null;
        },
      },
      "cartItems:missingCartQuery": {
        kind: "query",
        partition: cartPartition(),
        handler: ctx =>
          ctx.db.query("cartItems").withIndex("by_sku", q => q.eq("sku", "tea")).collect(),
      },
      "cartItems:wrongCartQuery": {
        kind: "query",
        partition: cartPartition(),
        handler: ctx =>
          ctx.db.query("cartItems").withIndex("by_cart_sku", q => q.eq("cartId", "cart:2")).collect(),
      },
      "cartItems:validCartQuery": {
        kind: "query",
        partition: cartPartition(),
        handler: ctx =>
          ctx.db
            .query("cartItems")
            .withIndex("by_cart_sku", q => q.eq("cartId", "cart:1").eq("sku", "tea"))
            .collect(),
      },
    };

    for (const path of [
      "cartItems:insertWrongCart",
      "cartItems:moveCart",
      "cartItems:missingCartQuery",
      "cartItems:wrongCartQuery",
    ]) {
      await expect(
        executeInvoke(
          env,
          "partition-field-deployment",
          {
            path,
            kind: path.endsWith("Query") ? "query" : "mutation",
            partitionKey: "cart:1",
            args: { cartId: "cart:1" },
          },
          functions,
        ),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("PlacementValidationError"),
      });
    }

    await expect(
      executeInvoke(
        env,
        "partition-field-deployment",
        {
          path: "cartItems:validCartQuery",
        kind: "query",
        partitionKey: "cart:1",
        args: { cartId: "cart:1" },
      },
        functions,
      ),
    ).resolves.toMatchObject({
      value: [{ _id: "1:tea", cartId: "cart:1", sku: "tea", quantity: 1 }],
    });
  });

  it("validates ID validators against deployment table mappings", async () => {
    await putSchema("id-validation-deployment", {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "users",
          validator: {
            type: "object",
            value: {
              bestFriendId: { fieldType: { type: "id", tableName: "users" }, optional: false },
            },
          },
          placement: { kind: "partitionBy", field: "_id" },
        },
        {
          tableId: 2,
          name: "teams",
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [],
    });
    await putFunctions("id-validation-deployment", {
      functions: [
        {
          path: "users:byId",
          kind: "query",
          args: {
            type: "object",
            value: {
              userId: { fieldType: { type: "id", tableName: "users" }, optional: false },
            },
          },
          returns: { type: "id", tableName: "users" },
          partition: userPartition(),
        },
      ],
    });

    const functions: BackendFunctionRegistry = {
      "users:byId": {
        kind: "query",
        handler: (_ctx, args) => (args as { userId: string }).userId,
      },
    };

    await expect(
      executeInvoke(
        env,
        "id-validation-deployment",
        {
          path: "users:byId",
          kind: "query",
          partitionKey: "1:ada",
          args: { userId: "2:team-core" },
        },
        functions,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "ArgumentValidationError: $args.userId: Expected an ID for table users, got an ID for table teams.",
    });

    await expect(
      executeInvoke(
        env,
        "id-validation-deployment",
        {
          path: "users:byId",
          kind: "query",
          partitionKey: "1:ada",
          args: { userId: "1:ada" },
        },
        functions,
      ),
    ).resolves.toMatchObject({ value: "1:ada" });

    const badWrite = await SingleShardTransaction.begin(
      env,
      "id-validation-deployment",
      "1:ada",
    );
    badWrite.insert(1, { bestFriendId: "2:team-core" }, "1:ada");
    await expect(badWrite.commit({ source: "bad-id-write" })).rejects.toMatchObject({
      status: 400,
      body: {
        error:
          "DocumentValidationError: $document(users).bestFriendId: Expected an ID for table users, got an ID for table teams.",
      },
    });
  });

  it("validates query and mutation returns before responding or committing", async () => {
    await putSchema("return-validation-deployment", {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "users",
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [],
    });
    await putFunctions("return-validation-deployment", {
      functions: [
        {
          path: "users:queryBadReturn",
          kind: "query",
          args: {
            type: "object",
            value: {
              userId: { fieldType: { type: "string" }, optional: false },
            },
          },
          returns: { type: "string" },
          partition: userPartition(),
        },
        {
          path: "users:mutationBadReturn",
          kind: "mutation",
          args: {
            type: "object",
            value: {
              userId: { fieldType: { type: "string" }, optional: false },
            },
          },
          returns: { type: "string" },
          partition: userPartition(),
        },
      ],
    });

    const functions: BackendFunctionRegistry = {
      "users:queryBadReturn": {
        kind: "query",
        handler: () => 123,
      },
      "users:mutationBadReturn": {
        kind: "mutation",
        handler: async ctx => {
          await ctx.db.insert("users", { name: "Ada" }, "1:ada-return");
          return 123;
        },
      },
    };

    await expect(
      executeInvoke(
        env,
        "return-validation-deployment",
        {
          path: "users:queryBadReturn",
          kind: "query",
          partitionKey: "user:ada",
          args: { userId: "user:ada" },
        },
        functions,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "ReturnValidationError: $return: Expected a string.",
    });

    await expect(
      executeInvoke(
        env,
        "return-validation-deployment",
        {
          path: "users:mutationBadReturn",
          kind: "mutation",
          partitionKey: "user:ada",
          args: { userId: "user:ada" },
        },
        functions,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "ReturnValidationError: $return: Expected a string.",
    });

    const tx = await SingleShardTransaction.begin(
      env,
      "return-validation-deployment",
      "user:ada",
    );
    await expect(tx.get(1, "1:ada-return")).resolves.toBeNull();
  });

  it("rejects malformed validator metadata at deployment time", async () => {
    const schemaResponse = await startPushResponse(
      "invalid-validator-deployment-schema",
      {
        sourcePackage: sourcePackageForFunctions({ functions: [] }),
        analysis: {
          schema: {
            version: 1,
            tables: [
              {
                tableId: 1,
                name: "users",
                validator: { type: "object", value: { name: { optional: false } } } as never,
                placement: { kind: "partitionBy", field: "_id" },
              },
            ],
            indexes: [],
          },
          functions: { functions: [] },
        },
      },
    );
    expect(schemaResponse.status).toBe(400);

    const functionsResponse = await startPushResponse(
      "invalid-validator-deployment-functions",
      {
        sourcePackage: sourcePackageForFunctions({
          functions: [
            {
              path: "users:get",
              kind: "query",
              args: { type: "nope" } as never,
            },
          ],
        }),
        analysis: {
          schema: { version: 1, tables: [], indexes: [] },
          functions: {
            functions: [
              {
                path: "users:get",
                kind: "query",
                args: { type: "nope" } as never,
              },
            ],
          },
        },
      },
    );
    expect(functionsResponse.status).toBe(400);
  });

  it("validates inserted and patched documents against the deployed schema", async () => {
    await putSchema("document-validation-deployment", {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "users",
          validator: {
            type: "object",
            value: {
              name: { fieldType: { type: "string" }, optional: false },
              age: { fieldType: { type: "number" }, optional: false },
            },
          },
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [],
    });
    const functions: BackendFunctionRegistry = {
      "users:insertInvalid": {
        kind: "mutation",
        partition: userPartition(),
        handler: ctx => ctx.db.insert("users", { name: "Ada", age: "old" }, "1:ada"),
      },
      "users:patchInvalid": {
        kind: "mutation",
        partition: userPartition(),
        handler: async ctx => {
          await ctx.db.patch("1:ada", { age: "old" });
          return null;
        },
      },
    };

    await expect(
      executeInvoke(
        env,
        "document-validation-deployment",
        {
          path: "users:insertInvalid",
          kind: "mutation",
          partitionKey: "user:ada",
          args: { userId: "user:ada" },
        },
        functions,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "DocumentValidationError: $document(users).age: Expected a finite number.",
    });

    const bypass = await SingleShardTransaction.begin(
      env,
      "document-validation-deployment",
      "user:ada",
    );
    bypass.insert(1, { name: "Bypass", age: "old" }, "1:bypass");
    await expect(bypass.commit({ source: "direct-commit" })).rejects.toMatchObject({
      status: 400,
      body: {
        error: "DocumentValidationError: $document(users).age: Expected a finite number.",
      },
    });

    const seed = await SingleShardTransaction.begin(
      env,
      "document-validation-deployment",
      "user:ada",
    );
    seed.insert(1, { name: "Ada", age: 20 }, "1:ada");
    await seed.commit({ source: "seed" });

    await expect(
      executeInvoke(
        env,
        "document-validation-deployment",
        {
          path: "users:patchInvalid",
          kind: "mutation",
          partitionKey: "user:ada",
          args: { userId: "user:ada" },
        },
        functions,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "DocumentValidationError: $document(users).age: Expected a finite number.",
    });
  });

  it("rejects a mutation when a concurrent write enters its index range", async () => {
    await putSchema("range-conflict-deployment", {
      version: 1,
      tables: [
        {
          tableId: 2,
          name: "users",
          placement: { kind: "partitionBy", field: "_id" },
        },
        {
          tableId: 1,
          name: "scores",
          placement: { kind: "colocateWith", table: "users", field: "userId" },
        },
      ],
      indexes: [{ indexId: 1, tableId: 1, name: "by_user_score", fields: ["userId", "score"] }],
    });

    const functions: BackendFunctionRegistry = {
      "scores:staleMutation": {
        kind: "mutation",
        partition: userPartition(),
        handler: async ctx => {
          await ctx.db
            .query("scores")
            .withIndex("by_user_score", q => q.eq("userId", "u1"))
            .collect();

          const concurrent = await SingleShardTransaction.begin(
            env,
            "range-conflict-deployment",
            "u1",
          );
          concurrent.insert(1, { userId: "u1", score: 10 }, "1:concurrent");
          await concurrent.commit({ source: "concurrent" });

          await ctx.db.insert("scores", { userId: "u1", score: 1 }, "1:outer");
          return null;
        },
      },
    };

    await expect(
      executeInvoke(
        env,
        "range-conflict-deployment",
        {
          path: "scores:staleMutation",
          kind: "mutation",
          partitionKey: "u1",
          args: { userId: "u1" },
        },
        functions,
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: "OCC_CONFLICT" },
    });
  });

  it("paginates duplicate index values by appended document id", async () => {
    const schema: DeploymentSchema = {
      version: 1,
      tables: [
        {
          tableId: 2,
          name: "users",
          placement: { kind: "partitionBy", field: "_id" },
        },
        {
          tableId: 1,
          name: "scores",
          placement: { kind: "colocateWith", table: "users", field: "userId" },
        },
      ],
      indexes: [{ indexId: 1, tableId: 1, name: "by_user_score", fields: ["userId", "score"] }],
    };
    await putSchema("pagination-deployment", schema);
    await SingleShardTransaction.ensureSchema(env, "pagination-deployment", "u1", schema);

    const seed = await SingleShardTransaction.begin(env, "pagination-deployment", "u1");
    for (const id of ["1:a", "1:b", "1:c"]) {
      seed.insert(1, { userId: "u1", score: 10 }, id);
    }
    await seed.commit({ source: "seed" });

    const functions: BackendFunctionRegistry = {
      "scores:page": {
        kind: "query",
        partition: userPartition(),
        handler: (ctx, args) => {
          const input = args as {
            cursor: string | null;
            order: "asc" | "desc";
          };
          return ctx.db
            .query("scores")
            .withIndex("by_user_score", q => q.eq("userId", "u1").eq("score", 10))
            .order(input.order)
            .paginate({ numItems: 2, cursor: input.cursor });
        },
      },
    };

    const first = await pageScores(functions, "asc", null);
    expect((first.value as { page: Array<{ _id: string }> }).page.map(document => document._id))
      .toEqual(["1:a", "1:b"]);
    expect(first.value).toMatchObject({ isDone: false });
    const second = await pageScores(
      functions,
      "asc",
      (first.value as { continueCursor: string }).continueCursor,
    );
    expect((second.value as { page: Array<{ _id: string }> }).page.map(document => document._id))
      .toEqual(["1:c"]);
    expect(second.value).toMatchObject({ isDone: true });

    const descending = await pageScores(functions, "desc", null);
    expect(
      (descending.value as { page: Array<{ _id: string }> }).page.map(document => document._id),
    ).toEqual(["1:c", "1:b"]);
  });

  it("exposes the Worker invoke route and reports unknown functions", async () => {
    await putSchema("route-deployment", { version: 1, tables: [], indexes: [] });

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/route-deployment/invoke",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: "missing:function",
          kind: "mutation",
          partitionKey: "u1",
          args: null,
        }),
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Unknown Flarex function: missing:function",
    });

    const topLevel = await harness.mf.dispatchFetch(
      "http://flarex.test/invoke",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deploymentId: "route-deployment",
          path: "missing:function",
        }),
      },
    );
    expect(topLevel.status).toBe(404);
    await expect(topLevel.json()).resolves.toEqual({
      error: "Unknown Flarex function: missing:function",
    });

    const headerDeployment = await harness.mf.dispatchFetch(
      "http://flarex.test/invoke",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-flarex-deployment": "route-deployment",
        },
        body: JSON.stringify({
          deploymentId: "missing-body-deployment",
          path: "missing:function",
        }),
      },
    );
    expect(headerDeployment.status).toBe(404);
    await expect(headerDeployment.json()).resolves.toEqual({
      error: "Unknown Flarex function: missing:function",
    });
  });

  it("decodes public Worker invoke bodies before execution", async () => {
    await putSchema("route-boundary-deployment", { version: 1, tables: [], indexes: [] });

    const invalidScoped = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/route-boundary-deployment/invoke",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: 42,
          kind: "query",
        }),
      },
    );
    expect(invalidScoped.status).toBe(400);
    await expect(invalidScoped.json()).resolves.toEqual({
      error:
        "Invoke request body may include string deploymentId, path, partitionKey, idempotencyKey, query or mutation kind, and JSON args.",
    });

    const invalidTopLevel = await harness.mf.dispatchFetch(
      "http://flarex.test/invoke",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-flarex-deployment": "route-boundary-deployment",
        },
        body: JSON.stringify({
          path: "missing:function",
          kind: "action",
        }),
      },
    );
    expect(invalidTopLevel.status).toBe(400);
    await expect(invalidTopLevel.json()).resolves.toEqual({
      error:
        "Invoke request body may include string deploymentId, path, partitionKey, idempotencyKey, query or mutation kind, and JSON args.",
    });

    const malformed = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/route-boundary-deployment/invoke",
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

    const missingDeployment = await harness.mf.dispatchFetch(
      "http://flarex.test/invoke",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: "missing:function",
          kind: "query",
        }),
      },
    );
    expect(missingDeployment.status).toBe(400);
    await expect(missingDeployment.json()).resolves.toEqual({
      error: "Missing deployment id.",
    });
  });
});

async function putSchema(deploymentId: string, schema: DeploymentSchema): Promise<void> {
  testDeploymentSchemas.set(deploymentId, schema);
  await activateTestDeployment(deploymentId);
}

async function putFunctions(
  deploymentId: string,
  functions: DeploymentFunctions,
): Promise<void> {
  testDeploymentFunctions.set(deploymentId, functions);
  await activateTestDeployment(deploymentId);
}

async function activateTestDeployment(deploymentId: string): Promise<void> {
  const schema = testDeploymentSchemas.get(deploymentId) ?? {
    version: 1,
    tables: [],
    indexes: [],
  };
  const functions = testDeploymentFunctions.get(deploymentId) ?? { functions: [] };
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
  const response = await startPushResponse(deploymentId, body);
  expect(response.ok).toBe(true);
  return response.json() as Promise<PushStatus>;
}

async function startPushResponse(
  deploymentId: string,
  body: AnalyzedStartPushRequest,
): Promise<Awaited<ReturnType<BackendHarness["mf"]["dispatchFetch"]>>> {
  return harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/start-analyzed`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function emptyActiveDeployment(): ActiveDeploymentStatus {
  return {
    activePushId: "typed-active-push",
    activatedAt: 1_700_000,
    schemaVersion: 1,
    executionArtifactRef: {
      runtime: "dynamic-worker",
      artifactId: "artifact_1234567890abcdef1234567890abcdef",
      sourcePackageHash: "a".repeat(64),
      executionModule: "_flarex/execution.js",
    },
    sourcePackage: sourcePackageForFunctions({ functions: [] }),
    analysis: {
      schema: {
        version: 1,
        tables: [],
        indexes: [],
      },
      functions: {
        functions: [],
      },
    },
    codegenAnalysis: {
      schema: {
        version: 1,
        tables: [],
        indexes: [],
      },
      functions: [],
    },
  };
}

function sourcePackageForFunctions(functions: DeploymentFunctions): AnalyzedStartPushRequest["sourcePackage"] {
  const functionModules = [
    ...new Set(functions.functions.map(fn => `${fn.path.split(":")[0]}.js`)),
  ].sort();
  const modules = ["_flarex/execution.js", "_flarex/schema.js", ...functionModules].map(path => ({
    path,
    environment: "isolate" as const,
    sha256: "0".repeat(64),
    source: "export default {};",
  }));
  return {
    modules,
    functions: functionModules,
    schema: "_flarex/schema.js",
    execution: "_flarex/execution.js",
  };
}

function userPartition() {
  return {
    type: "partition" as const,
    table: "users",
    selector: "byId",
    partitionField: "_id",
    argField: "userId",
  };
}

function createUsersPartition() {
  return {
    type: "partitionCreateRoot" as const,
    table: "users",
    partitionField: "_id" as const,
  };
}

function cartPartition() {
  return {
    type: "partition" as const,
    table: "cartItems",
    selector: "byCartId",
    partitionField: "cartId",
    argField: "cartId",
  };
}

function pageScores(
  functions: BackendFunctionRegistry,
  order: "asc" | "desc",
  cursor: string | null,
) {
  return executeInvoke(
    env,
    "pagination-deployment",
    {
      path: "scores:page",
      kind: "query",
      partitionKey: "u1",
      args: { userId: "u1", order, cursor },
    },
    functions,
  );
}
