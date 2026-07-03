import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  decodeActiveDeploymentResponse,
  deleteDocumentEffect,
  executeInvoke,
  executeInvokeEffect,
  getDocumentEffect,
  insertDocumentEffect,
  InvokeActiveDeploymentLoadError,
  InvokeArgumentValidationError,
  InvokeDocumentIdParseError,
  InvokeDocumentNotFoundError,
  InvokeDocumentPlacementError,
  InvokeDocumentValidationError,
  InvokeFunctionNotFoundError,
  InvokeKindValidationError,
  InvokeExecutionOperationError,
  InvokePartitionValidationError,
  InvokeQueryPlanningError,
  InvokeReturnValidationError,
  InvokeTableNotFoundError,
  findQueryIndexEffect,
  invokeActiveDeploymentLoadErrorToHttpError,
  invokeRuntimeErrorToHttpError,
  invokeValidationErrorToHttpError,
  loadActiveDeployment,
  loadActiveDeploymentEffect,
  loadActiveFunctionMetadata,
  loadActiveFunctionMetadataEffect,
  partitionKeyFromArgsEffect,
  parseInvokeKind,
  parseInvokeKindEffect,
  patchDocumentEffect,
  queryDocumentsEffect,
  queryIndexBoundsEffect,
  readActiveDeploymentResponseJson,
  requireQueryIndexEffect,
  resolveInvokeFunctionForRequest,
  resolveFunctionExecutionScope,
  resolveFunctionExecutionScopeEffect,
  tableFromDocumentIdEffect,
  tableForNameEffect,
  validateDocumentEffect,
  validateDocumentPlacementEffect,
  validatePartitionPolicyAgainstSchemaEffect,
  validateQueryPlacementEffect,
  validateReturnEffect,
  validateUniqueQueryResultEffect,
  type BackendFunctionRegistry,
  type InvokeTransactionOperation,
} from "../src/invoke";
import { encodeIndexValues, indexKeyAfterPrefix } from "../src/indexKeys";
import { SingleShardTransaction, type TransactionOperationError } from "../src/transaction";
import type {
  AnalyzedStartPushRequest,
  ActiveDeploymentStatus,
  DeploymentFunctions,
  DeploymentSchema,
  Env,
  PushStatus,
  SchemaTable,
} from "../src/types";
import {
  ANALYZED_START_TEST_AUTHORIZATION,
  createBackendHarness,
  type BackendHarness,
} from "./backendHarness";
import { sourcePackageForFunctions } from "./sourcePackageFixtures";

let harness: BackendHarness;
let env: Env;
const testDeploymentSchemas = new Map<string, DeploymentSchema>();
const testDeploymentFunctions = new Map<string, DeploymentFunctions>();

function runInvokeTransactionOperation<A>(
  operation: InvokeTransactionOperation<A>,
): Effect.Effect<A, Error | TransactionOperationError> {
  if (Effect.isEffect(operation)) {
    return operation;
  }
  return Effect.tryPromise({
    try: operation,
    catch: cause => new Error(cause instanceof Error ? cause.message : String(cause)),
  });
}

beforeAll(async () => {
  harness = await createBackendHarness();
  env = await harness.mf.getBindings<Env>();
});

afterAll(async () => {
  await harness.dispose();
});

describe("executeInvoke", () => {
  it("reports active deployment load failures as typed Effect failures before adapter mapping", async () => {
    const failure = await Effect.runPromise(Effect.flip(
      loadActiveDeploymentEffect(env, "typed-missing-active-deployment"),
    ));

    expect(failure).toBeInstanceOf(InvokeActiveDeploymentLoadError);
    expect(failure).toMatchObject({
      _tag: "InvokeActiveDeploymentLoadError",
      deploymentId: "typed-missing-active-deployment",
      status: 404,
      message: "Failed to load active deployment typed-missing-active-deployment.",
    });
    expect(invokeActiveDeploymentLoadErrorToHttpError(failure)).toMatchObject({
      status: 404,
      message: "Failed to load active deployment typed-missing-active-deployment.",
    });
    await expect(loadActiveDeployment(env, "typed-missing-active-deployment"))
      .rejects.toMatchObject({
        status: 404,
        message: "Failed to load active deployment typed-missing-active-deployment.",
      });
  });

  it("decodes active deployment responses through typed Effect helpers", async () => {
    const deployment = emptyActiveDeployment();
    await expect(Effect.runPromise(readActiveDeploymentResponseJson(
      "typed-active-response-deployment",
      Response.json(deployment),
    ))).resolves.toEqual(deployment);
    await expect(Effect.runPromise(decodeActiveDeploymentResponse(
      "typed-active-response-deployment",
      deployment,
    ))).resolves.toEqual(deployment);
  });

  it("keeps active deployment response body failures typed before adapter mapping", async () => {
    const jsonFailure = await Effect.runPromise(Effect.flip(readActiveDeploymentResponseJson(
      "typed-active-response-json-failure",
      new Response("{", { status: 200 }),
    )));
    expect(jsonFailure).toBeInstanceOf(InvokeActiveDeploymentLoadError);
    expect(jsonFailure).toMatchObject({
      _tag: "InvokeActiveDeploymentLoadError",
      deploymentId: "typed-active-response-json-failure",
      status: 500,
      message: "Failed to load active deployment typed-active-response-json-failure.",
    });

    const schemaFailure = await Effect.runPromise(Effect.flip(decodeActiveDeploymentResponse(
      "typed-active-response-schema-failure",
      null,
    )));
    expect(schemaFailure).toBeInstanceOf(InvokeActiveDeploymentLoadError);
    expect(schemaFailure).toMatchObject({
      _tag: "InvokeActiveDeploymentLoadError",
      deploymentId: "typed-active-response-schema-failure",
      status: 500,
      message: "Failed to load active deployment typed-active-response-schema-failure.",
    });
  });

  it("reports active function metadata lookup failures as typed Effect failures", async () => {
    await putFunctions("typed-active-metadata-deployment", { functions: [] });

    const failure = await Effect.runPromise(Effect.flip(
      loadActiveFunctionMetadataEffect(
        env,
        "typed-active-metadata-deployment",
        "missing:function",
      ),
    ));

    expect(failure).toMatchObject({
      _tag: "InvokeActiveFunctionMetadataNotFoundError",
      path: "missing:function",
    });
    expect(invokeRuntimeErrorToHttpError(failure)).toMatchObject({
      status: 404,
      message: "Unknown active Flarex function metadata: missing:function",
    });
    await expect(loadActiveFunctionMetadata(
      env,
      "typed-active-metadata-deployment",
      "missing:function",
    )).rejects.toMatchObject({
      status: 404,
      message: "Unknown active Flarex function metadata: missing:function",
    });
  });

  it("reports invalid invoke kind parsing as a typed Effect failure", async () => {
    await expect(Effect.runPromise(parseInvokeKindEffect("action")))
      .rejects.toBeInstanceOf(InvokeKindValidationError);

    const failure = await Effect.runPromise(Effect.flip(parseInvokeKindEffect("action")));
    expect(failure).toMatchObject({
      _tag: "InvokeKindValidationError",
      message: "Invoke kind must be query or mutation.",
    });
    expect(invokeValidationErrorToHttpError(failure)).toMatchObject({
      status: 400,
      message: "Invoke kind must be query or mutation.",
    });
    expect(() => parseInvokeKind("action")).toThrow("Invoke kind must be query or mutation.");
  });

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

  it("keeps executeInvoke validation typed until the adapter boundary", async () => {
    await putSchema("typed-execute-validation-deployment", {
      version: 1,
      tables: [],
      indexes: [],
    });
    const failure = await Effect.runPromise(Effect.flip(
      executeInvokeEffect(
        env,
        "typed-execute-validation-deployment",
        {
          path: "users:greet",
          kind: "query",
          args: { name: 42 },
        },
        {
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
        },
      ),
    ));

    expect(failure).toBeInstanceOf(InvokeArgumentValidationError);
    if (!(failure instanceof InvokeArgumentValidationError)) {
      throw new Error("Expected InvokeArgumentValidationError.");
    }
    expect(invokeValidationErrorToHttpError(failure)).toMatchObject({
      status: 400,
      message: "ArgumentValidationError: $args.name: Expected a string.",
    });
  });

  it("keeps executeInvoke handler failures typed as operation errors", async () => {
    await putSchema("typed-execute-handler-deployment", usersPartitionSchema());
    const failure = await Effect.runPromise(Effect.flip(
      executeInvokeEffect(
        env,
        "typed-execute-handler-deployment",
        {
          path: "users:explode",
          kind: "query",
          partitionKey: "u1",
          args: { userId: "u1" },
        },
        {
          "users:explode": {
            kind: "query",
            partition: userPartition(),
            handler: () => {
              throw new Error("handler exploded");
            },
          },
        },
      ),
    ));

    expect(failure).toBeInstanceOf(InvokeExecutionOperationError);
    if (!(failure instanceof InvokeExecutionOperationError)) {
      throw new Error("Expected InvokeExecutionOperationError.");
    }
    expect(failure).toMatchObject({
      operation: "handler",
      status: 500,
      message: "handler exploded",
    });
    await expect(executeInvoke(
      env,
      "typed-execute-handler-deployment",
      {
        path: "users:explode",
        kind: "query",
        partitionKey: "u1",
        args: { userId: "u1" },
      },
      {
        "users:explode": {
          kind: "query",
          partition: userPartition(),
          handler: () => {
            throw new Error("handler exploded");
          },
        },
      },
    )).rejects.toThrow("handler exploded");
  });

  it("keeps fake invoke-tag handler throws typed as operation errors", async () => {
    await putSchema("typed-execute-handler-fake-tag-deployment", usersPartitionSchema());
    const fakeTaggedError = {
      _tag: "InvokeQueryPlanningError",
      message: "spoofed query planning failure",
    };
    const failure = await Effect.runPromise(Effect.flip(
      executeInvokeEffect(
        env,
        "typed-execute-handler-fake-tag-deployment",
        {
          path: "users:spoof",
          kind: "query",
          partitionKey: "u1",
          args: { userId: "u1" },
        },
        {
          "users:spoof": {
            kind: "query",
            partition: userPartition(),
            handler: () => {
              throw fakeTaggedError;
            },
          },
        },
      ),
    ));

    expect(failure).toBeInstanceOf(InvokeExecutionOperationError);
    if (!(failure instanceof InvokeExecutionOperationError)) {
      throw new Error("Expected InvokeExecutionOperationError.");
    }
    expect(failure).toMatchObject({
      operation: "handler",
      status: 500,
      cause: fakeTaggedError,
    });
  });

  it("keeps commit partition failures typed until invoke adapter mapping", async () => {
    const deploymentId = "typed-execute-commit-conflict-deployment";
    await putSchema(deploymentId, usersPartitionSchema());
    await SingleShardTransaction.ensureSchema(env, deploymentId, "u1", usersPartitionSchema());
    const seed = await SingleShardTransaction.begin(env, deploymentId, "u1");
    seed.insert(2, { name: "Ada" }, "2:user");
    await seed.commit({ source: "seed" });

    const failure = await Effect.runPromise(Effect.flip(
      executeInvokeEffect(
        env,
        deploymentId,
        {
          path: "users:conflict",
          kind: "mutation",
          partitionKey: "u1",
          args: { userId: "u1", id: "2:user" },
        },
        {
          "users:conflict": {
            kind: "mutation",
            partition: userPartition(),
            handler: async (ctx, args) => {
              if (typeof args !== "object" || args === null || Array.isArray(args)) {
                throw new Error("Expected object args.");
              }
              const id = args.id;
              if (typeof id !== "string") {
                throw new Error("Expected string id.");
              }
              await ctx.db.get(id);
              const concurrent = await SingleShardTransaction.begin(env, deploymentId, "u1");
              concurrent.replace(2, id, { name: "Grace" });
              await concurrent.commit({ source: "concurrent" });
              await ctx.db.replace(id, { name: "Ada stale" });
              return null;
            },
          },
        },
      ),
    ));

    expect(failure).toBeInstanceOf(InvokeExecutionOperationError);
    if (!(failure instanceof InvokeExecutionOperationError)) {
      throw new Error("Expected InvokeExecutionOperationError.");
    }
    expect(failure).toMatchObject({
      operation: "commit",
      status: 409,
      cause: {
        _tag: "PartitionResponseError",
        status: 409,
        body: {
          code: "OCC_CONFLICT",
        },
      },
    });
    await expect(executeInvoke(
      env,
      deploymentId,
      {
        path: "users:conflict",
        kind: "mutation",
        partitionKey: "u1",
        args: { userId: "u1", id: "2:user" },
      },
      {
        "users:conflict": {
          kind: "mutation",
          partition: userPartition(),
          handler: async (ctx, args) => {
            if (typeof args !== "object" || args === null || Array.isArray(args)) {
              throw new Error("Expected object args.");
            }
            const id = args.id;
            if (typeof id !== "string") {
              throw new Error("Expected string id.");
            }
            await ctx.db.get(id);
            const concurrent = await SingleShardTransaction.begin(env, deploymentId, "u1");
            concurrent.replace(2, id, { name: "Marie" });
            await concurrent.commit({ source: "concurrent-adapter" });
            await ctx.db.replace(id, { name: "Ada stale adapter" });
            return null;
          },
        },
      },
    )).rejects.toMatchObject({
      status: 409,
      body: {
        code: "OCC_CONFLICT",
      },
    });
  });

  it("keeps handler transaction staging failures typed until invoke adapter mapping", async () => {
    const deploymentId = "typed-execute-handler-staging-failure-deployment";
    await putSchema(deploymentId, usersPartitionSchema());

    const functions: BackendFunctionRegistry = {
      "users:duplicateStage": {
        kind: "mutation",
        partition: userPartition(),
        handler: async ctx => {
          await ctx.db.insert("users", { name: "Ada" }, "2:duplicate");
          await ctx.db.insert("users", { name: "Grace" }, "2:duplicate");
          return null;
        },
      },
    };
    const request = {
      path: "users:duplicateStage",
      kind: "mutation" as const,
      partitionKey: "u1",
      args: { userId: "u1" },
    };
    const failure = await Effect.runPromise(Effect.flip(
      executeInvokeEffect(env, deploymentId, request, functions),
    ));

    expect(failure).toBeInstanceOf(InvokeExecutionOperationError);
    if (!(failure instanceof InvokeExecutionOperationError)) {
      throw new Error("Expected InvokeExecutionOperationError.");
    }
    expect(failure).toMatchObject({
      operation: "handler",
      status: 500,
      cause: {
        _tag: "TransactionInvariantError",
        message: "Document 2:duplicate already has a staged write.",
      },
    });
    await expect(executeInvoke(env, deploymentId, request, functions))
      .rejects.toMatchObject({
        status: 500,
        message: "Document 2:duplicate already has a staged write.",
      });
  });

  it("keeps executeInvoke handler document validation typed before adapter mapping", async () => {
    await putSchema("typed-execute-handler-document-validation-deployment", {
      version: 1,
      tables: [
        {
          tableId: 2,
          name: "users",
          validator: {
            type: "object",
            value: {
              age: { fieldType: { type: "number" }, optional: false },
              userId: { fieldType: { type: "string" }, optional: false },
            },
          },
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [],
    });
    const failure = await Effect.runPromise(Effect.flip(
      executeInvokeEffect(
        env,
        "typed-execute-handler-document-validation-deployment",
        {
          path: "users:insertInvalid",
          kind: "mutation",
          partitionKey: "u1",
          args: { userId: "u1" },
        },
        {
          "users:insertInvalid": {
            kind: "mutation",
            partition: userPartition(),
            handler: ctx => ctx.db.insert("users", { userId: "u1", age: "old" }, "2:ada"),
          },
        },
      ),
    ));

    expect(failure).toBeInstanceOf(InvokeDocumentValidationError);
    if (!(failure instanceof InvokeDocumentValidationError)) {
      throw new Error("Expected InvokeDocumentValidationError.");
    }
    expect(invokeValidationErrorToHttpError(failure)).toMatchObject({
      status: 400,
      message: "DocumentValidationError: $document(users).age: Expected a finite number.",
    });
  });

  it("keeps executeInvoke handler query planning typed before adapter mapping", async () => {
    await putSchema("typed-execute-handler-query-planning-deployment", {
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
    const failure = await Effect.runPromise(Effect.flip(
      executeInvokeEffect(
        env,
        "typed-execute-handler-query-planning-deployment",
        {
          path: "scores:list",
          kind: "query",
          partitionKey: "u1",
          args: { userId: "u1" },
        },
        {
          "scores:list": {
            kind: "query",
            partition: userPartition(),
            handler: ctx => ctx.db.query("scores").collect(),
          },
        },
      ),
    ));

    expect(failure).toBeInstanceOf(InvokeQueryPlanningError);
    if (!(failure instanceof InvokeQueryPlanningError)) {
      throw new Error("Expected InvokeQueryPlanningError.");
    }
    expect(invokeValidationErrorToHttpError(failure)).toMatchObject({
      status: 400,
      message: "Flarex table scans are not implemented. Use withIndex().",
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

  it("keeps invoke table and document-id validation typed until adapter mapping", async () => {
    const schema = emptyActiveDeployment().analysis.schema;

    const missingTable = await Effect.runPromise(
      tableForNameEffect(schema, "missing").pipe(
        Effect.catchTag("InvokeTableNotFoundError", error => Effect.succeed(error)),
      ),
    );
    expect(missingTable).toBeInstanceOf(InvokeTableNotFoundError);
    if (!(missingTable instanceof InvokeTableNotFoundError)) {
      throw new Error("Expected InvokeTableNotFoundError.");
    }
    expect(invokeValidationErrorToHttpError(missingTable)).toMatchObject({
      status: 400,
      message: "Unknown table: missing.",
    });

    const malformedId = await Effect.runPromise(
      tableFromDocumentIdEffect("not-an-id", schema).pipe(
        Effect.catchTag("InvokeDocumentIdParseError", error => Effect.succeed(error)),
      ),
    );
    expect(malformedId).toBeInstanceOf(InvokeDocumentIdParseError);
    if (!(malformedId instanceof InvokeDocumentIdParseError)) {
      throw new Error("Expected InvokeDocumentIdParseError.");
    }
    expect(invokeValidationErrorToHttpError(malformedId)).toMatchObject({
      status: 400,
      message: "Document id not-an-id does not contain a numeric table id prefix.",
    });
  });

  it("keeps invoke document validation typed until adapter mapping", async () => {
    const table = usersTableWithValidator();
    const failure = await Effect.runPromise(
      validateDocumentEffect(table, { age: "old" }).pipe(
        Effect.catchTag("InvokeDocumentValidationError", error => Effect.succeed(error)),
      ),
    );

    expect(failure).toBeInstanceOf(InvokeDocumentValidationError);
    if (!(failure instanceof InvokeDocumentValidationError)) {
      throw new Error("Expected InvokeDocumentValidationError.");
    }
    expect(invokeValidationErrorToHttpError(failure)).toMatchObject({
      status: 400,
      message: "DocumentValidationError: $document(users).age: Expected a finite number.",
    });
  });

  it("keeps document syscall helpers typed until adapter mapping", async () => {
    const deploymentId = "typed-document-helper-deployment";
    const schema = {
      version: 1,
      tables: [usersTableWithValidator()],
      indexes: [],
    };
    await SingleShardTransaction.ensureSchema(env, deploymentId, "u1", schema);
    const tx = await SingleShardTransaction.begin(env, deploymentId, "u1");
    const runTransaction = <A>(operation: InvokeTransactionOperation<A>) =>
      runInvokeTransactionOperation(operation);

    const malformedGet = await Effect.runPromise(Effect.flip(
      getDocumentEffect(tx, schema, "not-an-id", runTransaction),
    ));
    expect(malformedGet).toBeInstanceOf(InvokeDocumentIdParseError);
    if (!(malformedGet instanceof InvokeDocumentIdParseError)) {
      throw new Error("Expected InvokeDocumentIdParseError.");
    }
    expect(invokeValidationErrorToHttpError(malformedGet)).toMatchObject({
      status: 400,
      message: "Document id not-an-id does not contain a numeric table id prefix.",
    });

    const invalidInsert = await Effect.runPromise(Effect.flip(
      insertDocumentEffect(
        tx,
        schema,
        "users",
        { age: "old", userId: "u1" },
        "1:bad-user",
        runTransaction,
      ),
    ));
    expect(invalidInsert).toBeInstanceOf(InvokeDocumentValidationError);
    if (!(invalidInsert instanceof InvokeDocumentValidationError)) {
      throw new Error("Expected InvokeDocumentValidationError.");
    }
    expect(invokeValidationErrorToHttpError(invalidInsert)).toMatchObject({
      status: 400,
      message: "DocumentValidationError: $document(users).age: Expected a finite number.",
    });

    const missingPatch = await Effect.runPromise(Effect.flip(
      patchDocumentEffect(tx, schema, "1:missing-user", { age: 42 }, runTransaction),
    ));
    expect(missingPatch).toBeInstanceOf(InvokeDocumentNotFoundError);
    if (!(missingPatch instanceof InvokeDocumentNotFoundError)) {
      throw new Error("Expected InvokeDocumentNotFoundError.");
    }
    expect(invokeValidationErrorToHttpError(missingPatch)).toMatchObject({
      status: 404,
      message: "Document not found: 1:missing-user",
    });

    const malformedDelete = await Effect.runPromise(Effect.flip(
      deleteDocumentEffect(tx, schema, "not-an-id", runTransaction),
    ));
    expect(malformedDelete).toBeInstanceOf(InvokeDocumentIdParseError);
  });

  it("keeps invoke placement validation typed until adapter mapping", async () => {
    const table = usersTableWithValidator();
    const documentFailure = await Effect.runPromise(
      validateDocumentPlacementEffect(table, { age: 42, userId: "u2" }, "u1").pipe(
        Effect.catchTag("InvokeDocumentPlacementError", error => Effect.succeed(error)),
      ),
    );
    expect(documentFailure).toBeInstanceOf(InvokeDocumentPlacementError);
    if (!(documentFailure instanceof InvokeDocumentPlacementError)) {
      throw new Error("Expected InvokeDocumentPlacementError.");
    }
    expect(invokeValidationErrorToHttpError(documentFailure)).toMatchObject({
      status: 400,
      message: "PlacementValidationError: $document(users).userId must match partitionKey u1.",
    });

    const queryFailure = await Effect.runPromise(
      validateQueryPlacementEffect(table, [], "u1").pipe(
        Effect.catchTag("InvokeDocumentPlacementError", error => Effect.succeed(error)),
      ),
    );
    expect(queryFailure).toBeInstanceOf(InvokeDocumentPlacementError);
    if (!(queryFailure instanceof InvokeDocumentPlacementError)) {
      throw new Error("Expected InvokeDocumentPlacementError.");
    }
    expect(invokeValidationErrorToHttpError(queryFailure)).toMatchObject({
      status: 400,
      message: 'PlacementValidationError: query on users must include q.eq("userId", partitionKey).',
    });
  });

  it("keeps invoke partition scope validation typed until adapter mapping", async () => {
    const schema = usersPartitionSchema();
    const missingPartition = await Effect.runPromise(
      resolveFunctionExecutionScopeEffect(
        null,
        null,
        { path: "users:list", args: { userId: "u1" }, partitionKey: "u1" },
        schema,
      ).pipe(
        Effect.catchTag("InvokePartitionValidationError", error => Effect.succeed(error)),
      ),
    );
    expect(missingPartition).toBeInstanceOf(InvokePartitionValidationError);
    if (!(missingPartition instanceof InvokePartitionValidationError)) {
      throw new Error("Expected InvokePartitionValidationError.");
    }
    expect(invokeValidationErrorToHttpError(missingPartition)).toMatchObject({
      status: 400,
      message: "PartitionValidationError: function users:list must declare partition metadata.",
    });

    const badArgs = await Effect.runPromise(
      partitionKeyFromArgsEffect(
        { path: "users:list", args: null },
        "userId",
        "partition users.byId",
      ).pipe(
        Effect.catchTag("InvokePartitionValidationError", error => Effect.succeed(error)),
      ),
    );
    expect(badArgs).toBeInstanceOf(InvokePartitionValidationError);
    if (!(badArgs instanceof InvokePartitionValidationError)) {
      throw new Error("Expected InvokePartitionValidationError.");
    }
    expect(invokeValidationErrorToHttpError(badArgs)).toMatchObject({
      status: 400,
      message: "PartitionValidationError: users:list partition users.byId requires object arguments.",
    });
  });

  it("keeps partition policy and create-root validation typed until adapter mapping", async () => {
    const schema = usersPartitionSchema();
    const selectorMismatch = await Effect.runPromise(
      validatePartitionPolicyAgainstSchemaEffect(
        {
          type: "partition",
          table: "users",
          selector: "bySlug",
          partitionField: "_id",
          argField: "userId",
        },
        "users:list",
        schema,
      ).pipe(
        Effect.catchTag("InvokePartitionValidationError", error => Effect.succeed(error)),
      ),
    );
    expect(selectorMismatch).toBeInstanceOf(InvokePartitionValidationError);
    if (!(selectorMismatch instanceof InvokePartitionValidationError)) {
      throw new Error("Expected InvokePartitionValidationError.");
    }
    expect(invokeValidationErrorToHttpError(selectorMismatch)).toMatchObject({
      status: 400,
      message: 'PartitionValidationError: users:list expected partition selector byId for users partition field "_id".',
    });

    const badPreallocation = await Effect.runPromise(
      resolveFunctionExecutionScopeEffect(
        {
          type: "partitionCreateRoot",
          table: "users",
          partitionField: "_id",
        },
        null,
        { path: "users:create", args: { name: "Ada" } },
        schema,
        { allocateRootId: () => "1:not-a-users-id" },
      ).pipe(
        Effect.catchTag("InvokePartitionValidationError", error => Effect.succeed(error)),
      ),
    );
    expect(badPreallocation).toBeInstanceOf(InvokePartitionValidationError);
    if (!(badPreallocation instanceof InvokePartitionValidationError)) {
      throw new Error("Expected InvokePartitionValidationError.");
    }
    expect(invokeValidationErrorToHttpError(badPreallocation)).toMatchObject({
      status: 500,
      message: "PartitionValidationError: preallocated root id for users:create must be an ID for table users.",
    });
  });

  it("keeps invoke query planning validation typed until adapter mapping", async () => {
    const schema = usersQuerySchema();
    const table = schema.tables[0]!;
    const index = schema.indexes[0]!;

    const missingIndex = await Effect.runPromise(
      requireQueryIndexEffect(undefined).pipe(
        Effect.catchTag("InvokeQueryPlanningError", error => Effect.succeed(error)),
      ),
    );
    expect(missingIndex).toBeInstanceOf(InvokeQueryPlanningError);
    if (!(missingIndex instanceof InvokeQueryPlanningError)) {
      throw new Error("Expected InvokeQueryPlanningError.");
    }
    expect(invokeValidationErrorToHttpError(missingIndex)).toMatchObject({
      status: 400,
      message: "Flarex table scans are not implemented. Use withIndex().",
    });

    const unknownIndex = await Effect.runPromise(
      findQueryIndexEffect(schema, table, "missing").pipe(
        Effect.catchTag("InvokeQueryPlanningError", error => Effect.succeed(error)),
      ),
    );
    expect(unknownIndex).toBeInstanceOf(InvokeQueryPlanningError);
    if (!(unknownIndex instanceof InvokeQueryPlanningError)) {
      throw new Error("Expected InvokeQueryPlanningError.");
    }
    expect(invokeValidationErrorToHttpError(unknownIndex)).toMatchObject({
      status: 400,
      message: "Unknown index users.missing.",
    });

    const invalidRange = await Effect.runPromise(
      queryIndexBoundsEffect("users", "by_user_score", index, [
        { op: "gte", field: "userId", value: "u1" },
        { op: "gt", field: "userId", value: "u2" },
      ]).pipe(
        Effect.catchTag("InvokeQueryPlanningError", error => Effect.succeed(error)),
      ),
    );
    expect(invalidRange).toBeInstanceOf(InvokeQueryPlanningError);
    if (!(invalidRange instanceof InvokeQueryPlanningError)) {
      throw new Error("Expected InvokeQueryPlanningError.");
    }
    expect(invokeValidationErrorToHttpError(invalidRange)).toMatchObject({
      status: 400,
      message: "Invalid range for index users.by_user_score: Index range can have only one lower bound.",
    });

    const nonUnique = await Effect.runPromise(
      validateUniqueQueryResultEffect([{ id: 1 }, { id: 2 }]).pipe(
        Effect.catchTag("InvokeQueryPlanningError", error => Effect.succeed(error)),
      ),
    );
    expect(nonUnique).toBeInstanceOf(InvokeQueryPlanningError);
    if (!(nonUnique instanceof InvokeQueryPlanningError)) {
      throw new Error("Expected InvokeQueryPlanningError.");
    }
    expect(invokeValidationErrorToHttpError(nonUnique)).toMatchObject({
      status: 400,
      message: "Query returned more than one document.",
    });
  });

  it("keeps query document helper planning typed until adapter mapping", async () => {
    const deploymentId = "typed-query-helper-deployment";
    const schema = {
      version: 1,
      tables: [usersTableWithValidator()],
      indexes: [{ indexId: 1, tableId: 1, name: "by_user_score", fields: ["userId", "score"] }],
    } satisfies DeploymentSchema;
    await SingleShardTransaction.ensureSchema(env, deploymentId, "u1", schema);
    const tx = await SingleShardTransaction.begin(env, deploymentId, "u1");
    const runTransaction = <A>(operation: InvokeTransactionOperation<A>) =>
      runInvokeTransactionOperation(operation);

    const missingIndex = await Effect.runPromise(Effect.flip(
      queryDocumentsEffect(tx, schema, { table: "users" }, runTransaction),
    ));
    expect(missingIndex).toBeInstanceOf(InvokeQueryPlanningError);
    if (!(missingIndex instanceof InvokeQueryPlanningError)) {
      throw new Error("Expected InvokeQueryPlanningError.");
    }
    expect(invokeValidationErrorToHttpError(missingIndex)).toMatchObject({
      status: 400,
      message: "Flarex table scans are not implemented. Use withIndex().",
    });

    const missingPlacement = await Effect.runPromise(Effect.flip(
      queryDocumentsEffect(
        tx,
        schema,
        { table: "users", index: "by_user_score", range: { expressions: [] } },
        runTransaction,
      ),
    ));
    expect(missingPlacement).toBeInstanceOf(InvokeDocumentPlacementError);
    if (!(missingPlacement instanceof InvokeDocumentPlacementError)) {
      throw new Error("Expected InvokeDocumentPlacementError.");
    }
    expect(invokeValidationErrorToHttpError(missingPlacement)).toMatchObject({
      status: 400,
      message: 'PlacementValidationError: query on users must include q.eq("userId", partitionKey).',
    });
  });

  it("maps invoke query planning failures through the query API compatibility adapter", async () => {
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
      ],
    } satisfies DeploymentSchema;
    await putSchema("query-planning-adapter-deployment", schema);
    await SingleShardTransaction.ensureSchema(
      env,
      "query-planning-adapter-deployment",
      "u1",
      schema,
    );
    const seed = await SingleShardTransaction.begin(
      env,
      "query-planning-adapter-deployment",
      "u1",
    );
    seed.insert(1, { userId: "u1", score: 10 }, "1:score-a");
    seed.insert(1, { userId: "u1", score: 10 }, "1:score-b");
    await seed.commit({ source: "seed" });

    const functions: BackendFunctionRegistry = {
      "scores:tableScan": {
        kind: "query",
        partition: userPartition(),
        handler: ctx => ctx.db.query("scores").collect(),
      },
      "scores:unknownIndex": {
        kind: "query",
        partition: userPartition(),
        handler: ctx => ctx.db.query("scores").withIndex("missing").collect(),
      },
      "scores:invalidRange": {
        kind: "query",
        partition: userPartition(),
        handler: ctx =>
          ctx.db
            .query("scores")
            .withIndex("by_user_score", q =>
              q.eq("userId", "u1").gte("score", 10).gt("score", 20),
            )
            .collect(),
      },
      "scores:notUnique": {
        kind: "query",
        partition: userPartition(),
        handler: ctx =>
          ctx.db
            .query("scores")
            .withIndex("by_user_score", q => q.eq("userId", "u1").eq("score", 10))
            .unique(),
      },
    };

    await expect(
      executeInvoke(
        env,
        "query-planning-adapter-deployment",
        {
          path: "scores:tableScan",
          kind: "query",
          partitionKey: "u1",
          args: { userId: "u1" },
        },
        functions,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "Flarex table scans are not implemented. Use withIndex().",
    });

    await expect(
      executeInvoke(
        env,
        "query-planning-adapter-deployment",
        {
          path: "scores:unknownIndex",
          kind: "query",
          partitionKey: "u1",
          args: { userId: "u1" },
        },
        functions,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "Unknown index scores.missing.",
    });

    await expect(
      executeInvoke(
        env,
        "query-planning-adapter-deployment",
        {
          path: "scores:invalidRange",
          kind: "query",
          partitionKey: "u1",
          args: { userId: "u1" },
        },
        functions,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "Invalid range for index scores.by_user_score: Index range can have only one lower bound.",
    });

    await expect(
      executeInvoke(
        env,
        "query-planning-adapter-deployment",
        {
          path: "scores:notUnique",
          kind: "query",
          partitionKey: "u1",
          args: { userId: "u1" },
        },
        functions,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "Query returned more than one document.",
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

    const missingPath = await harness.mf.dispatchFetch(
      "http://flarex.test/invoke",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-flarex-deployment": "route-boundary-deployment",
        },
        body: JSON.stringify({
          kind: "query",
        }),
      },
    );
    expect(missingPath.status).toBe(400);
    await expect(missingPath.json()).resolves.toEqual({
      error: "Missing function path.",
    });

    const missingPartitionKey = await harness.mf.dispatchFetch(
      "http://flarex.test/invoke",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-flarex-deployment": "route-boundary-deployment",
        },
        body: JSON.stringify({
          path: "missing:function",
          kind: "query",
          partitionKey: "",
        }),
      },
    );
    expect(missingPartitionKey.status).toBe(400);
    await expect(missingPartitionKey.json()).resolves.toEqual({
      error: "Missing partition key.",
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
      headers: {
        authorization: ANALYZED_START_TEST_AUTHORIZATION,
        "content-type": "application/json",
      },
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

function usersTableWithValidator(): SchemaTable {
  return {
    tableId: 1,
    name: "users",
    validator: {
      type: "object",
      value: {
        age: { fieldType: { type: "number" }, optional: false },
        userId: { fieldType: { type: "string" }, optional: false },
      },
    },
    placement: { kind: "colocateWith", table: "users", field: "userId" },
  };
}

function usersPartitionSchema(): DeploymentSchema {
  return {
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
}

function usersQuerySchema(): DeploymentSchema {
  return {
    version: 1,
    tables: [
      {
        tableId: 1,
        name: "users",
        placement: { kind: "partitionBy", field: "_id" },
      },
    ],
    indexes: [
      {
        indexId: 1,
        tableId: 1,
        name: "by_user_score",
        fields: ["userId", "score"],
      },
    ],
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
