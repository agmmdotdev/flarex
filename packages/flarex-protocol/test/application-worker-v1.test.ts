import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  APPLICATION_ACTION_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_ACTION_WORKER_REQUEST_VERSION_V1,
  APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
  APPLICATION_WORKER_RESULT_FORMAT_V1,
  APPLICATION_WORKER_RESULT_VERSION_V1,
  MAX_APPLICATION_ACTION_ARGUMENT_SEMANTIC_BYTES_V1,
  MAX_APPLICATION_QUERY_ARGUMENT_SEMANTIC_BYTES_V1,
  MAX_APPLICATION_WORKER_AUTH_SEMANTIC_BYTES_V1,
  MAX_APPLICATION_WORKER_APPLICATION_ERROR_TEXT_BYTES_V1,
  MAX_APPLICATION_WORKER_CONTEXT_TEXT_BYTES_V1,
  MAX_APPLICATION_WORKER_MEMBER_INSPECTIONS_V1,
  MAX_APPLICATION_WORKER_RESULT_SEMANTIC_BYTES_V1,
  MAX_APPLICATION_WORKER_VALUE_NODES_V1,
  MAX_APPLICATION_WRITE_ARGUMENT_SEMANTIC_BYTES_V1,
  decodeApplicationActionWorkerRequestV1Effect,
  decodeApplicationTransactionWorkerRequestV1Effect,
  decodeApplicationWorkerResultV1Effect,
} from "../src/application-worker-v1";
import { normalizeFlarexValueV1 } from "../src/value";

describe("Application worker V1 protocol", () => {
  it("owns one exact public query request", async () => {
    const input = transactionRequest("query", "public");
    const decoded = await Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(input),
    );

    input.target.function.path = "changed:get";
    input.arguments.userId = "changed";
    input.auth.user.subject = "changed";
    input.tables[0]!.logicalName = "changed";
    input.context.randomSeed.fill(99);

    expect(decoded.target.function.path).toBe("users:get");
    expect(decoded.arguments).toEqual({ userId: "user-1" });
    expect(decoded.auth).toMatchObject({
      kind: "user",
      user: { subject: "user-1" },
    });
    expect(decoded.tables).toEqual([{ tableId: 1, logicalName: "users" }]);
    expect(decoded.context.randomSeed[0]).toBe(7);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.tables)).toBe(true);
  });

  it.each([
    ["query", "internal"],
    ["mutation", "public"],
    ["mutation", "internal"],
    ["workflowMutation", "public"],
    ["workflowMutation", "internal"],
  ] as const)("admits %s at %s visibility", async (kind, visibility) => {
    const decoded = await Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(
        transactionRequest(kind, visibility),
      ),
    );
    expect(decoded.target.function).toMatchObject({ kind, visibility });
    expect(decoded.context.mode).toBe(kind === "query" ? "query" : "write");
  });

  it("rejects action targets and query/write context mismatches", async () => {
    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(
        transactionRequest("action", "public"),
      ),
    )).rejects.toMatchObject({
      boundary: "transactionRequest",
      reason: "invalidTargetKind",
      path: "target.function.kind",
    });

    const query = transactionRequest("query", "public");
    query.context = writeContext();
    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(query),
    )).rejects.toMatchObject({
      reason: "invalidTargetKind",
      path: "context.mode",
    });
  });

  it("rejects malformed tables and argument-size mismatches", async () => {
    const duplicateTables = transactionRequest("mutation", "public");
    duplicateTables.tables.push({ tableId: 1, logicalName: "other" });
    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(duplicateTables),
    )).rejects.toMatchObject({
      reason: "invalidShape",
      path: "tables[1]",
    });

    const reservedTable = transactionRequest("query", "public");
    reservedTable.tables[0]!.logicalName = "_system";
    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(reservedTable),
    )).rejects.toMatchObject({
      reason: "invalidShape",
      path: "tables[0].logicalName",
    });

    const wrongSize = transactionRequest("mutation", "public");
    wrongSize.argumentSemanticBytes += 1;
    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(wrongSize),
    )).rejects.toMatchObject({ reason: "argumentSizeMismatch" });
  });

  it("rejects an over-advertised transaction before traversing context", async () => {
    let contextTraversal = 0;
    const input = transactionRequest("query", "public");
    input.argumentSemanticBytes =
      MAX_APPLICATION_QUERY_ARGUMENT_SEMANTIC_BYTES_V1 + 1;
    input.context = new Proxy(input.context, {
      ownKeys() {
        contextTraversal += 1;
        return [];
      },
    });

    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(input),
    )).rejects.toMatchObject({ reason: "argumentSizeMismatch" });
    expect(contextTraversal).toBe(0);
  });

  it("bounds context text before UTF-8 sizing", async () => {
    const exact = transactionRequest("query", "public");
    exact.context.executionId = "x".repeat(
      MAX_APPLICATION_WORKER_CONTEXT_TEXT_BYTES_V1,
    );
    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(exact),
    )).resolves.toMatchObject({ context: { mode: "query" } });

    const over = transactionRequest("query", "public");
    over.context.executionId = "x".repeat(
      MAX_APPLICATION_WORKER_CONTEXT_TEXT_BYTES_V1 + 1,
    );
    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(over),
    )).rejects.toMatchObject({ reason: "invalidShape", path: "context" });
  });

  it.each([
    ["query", MAX_APPLICATION_QUERY_ARGUMENT_SEMANTIC_BYTES_V1],
    ["mutation", MAX_APPLICATION_WRITE_ARGUMENT_SEMANTIC_BYTES_V1],
  ] as const)("enforces the %s argument budget during traversal", async (
    kind,
    maximum,
  ) => {
    const exact = transactionRequest(kind, "public");
    exact.arguments = objectAtSemanticSize(maximum);
    exact.argumentSemanticBytes = maximum;
    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(exact),
    )).resolves.toMatchObject({ argumentSemanticBytes: maximum });

    let lateTraversal = 0;
    const over = transactionRequest(kind, "public");
    over.arguments = {
      a: [
        "x".repeat(maximum - 9),
        new Proxy({}, {
          getPrototypeOf(target) {
            lateTraversal += 1;
            return Reflect.getPrototypeOf(target);
          },
        }),
      ],
    };
    over.argumentSemanticBytes = maximum;
    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(over),
    )).rejects.toMatchObject({ reason: "invalidArguments" });
    expect(lateTraversal).toBe(0);

    const advertisedOver = transactionRequest(kind, "public");
    advertisedOver.argumentSemanticBytes = maximum + 1;
    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(advertisedOver),
    )).rejects.toMatchObject({ reason: "argumentSizeMismatch" });
  });

  it("enforces the auth budget during traversal", async () => {
    const exact = transactionRequest("query", "public");
    exact.auth.user = userIdentityAtSemanticSize(
      MAX_APPLICATION_WORKER_AUTH_SEMANTIC_BYTES_V1,
    );
    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(exact),
    )).resolves.toMatchObject({ auth: { kind: "user" } });

    const over = transactionRequest("query", "public");
    over.auth.user = userIdentityAtSemanticSize(
      MAX_APPLICATION_WORKER_AUTH_SEMANTIC_BYTES_V1 + 1,
    );
    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(over),
    )).rejects.toMatchObject({ reason: "invalidAuth", path: "auth.user" });
  });

  it("normalizes the budgeted owned snapshot instead of rereading caller input", async () => {
    const earlier = { payload: "original" };
    const target = { a: earlier, z: true };
    const semanticSizeBytes = normalizeFlarexValueV1(target).semanticSizeBytes;
    const input = transactionRequest("query", "public");
    input.arguments = new Proxy(target, {
      getOwnPropertyDescriptor(raw, key) {
        if (key === "z") {
          earlier.payload = "x".repeat(
            MAX_APPLICATION_QUERY_ARGUMENT_SEMANTIC_BYTES_V1,
          );
        }
        return Reflect.getOwnPropertyDescriptor(raw, key);
      },
    });
    input.argumentSemanticBytes = semanticSizeBytes;

    const decoded = await Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(input),
    );

    expect(decoded.arguments).toEqual({
      a: { payload: "original" },
      z: true,
    });
    expect(earlier.payload).not.toBe("original");
  });

  it("does not invoke a prototype constructor name accessor", async () => {
    let nameReads = 0;
    const constructor = function Candidate(): void {};
    Object.defineProperty(constructor, "name", {
      get() {
        nameReads += 1;
        return "Object";
      },
      configurable: true,
    });
    const prototype = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(prototype, "constructor", {
      value: constructor,
      configurable: true,
    });
    const argumentsValue = Object.create(prototype) as Record<string, unknown>;
    argumentsValue.value = true;
    const input = transactionRequest("query", "public");
    input.arguments = argumentsValue;

    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(input),
    )).rejects.toMatchObject({ reason: "invalidArguments" });
    expect(nameReads).toBe(0);
  });

  it("rejects excessive nesting before reflecting on the next object", async () => {
    let prototypeReads = 0;
    let nested: unknown = new Proxy({}, {
      getPrototypeOf(target) {
        prototypeReads += 1;
        return Reflect.getPrototypeOf(target);
      },
    });
    for (let depth = 0; depth < 64; depth += 1) {
      nested = { value: nested };
    }
    const input = transactionRequest("query", "public");
    input.arguments = nested as Record<string, unknown>;
    input.argumentSemanticBytes = 1;

    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(input),
    )).rejects.toMatchObject({ reason: "invalidArguments" });
    expect(prototypeReads).toBe(0);
  });

  it("owns action inputs and rejects transaction targets", async () => {
    const input = actionRequest("internal");
    const decoded = await Effect.runPromise(
      decodeApplicationActionWorkerRequestV1Effect(input),
    );
    input.context.randomSeed.fill(88);
    input.context.hostPolicySha256.fill(77);
    input.arguments.orderId = "changed";

    expect(decoded.target.function).toMatchObject({
      kind: "action",
      visibility: "internal",
    });
    expect(decoded.arguments).toEqual({ orderId: "order-1" });
    expect(decoded.context.randomSeed[0]).toBe(11);
    expect(decoded.context.hostPolicySha256[0]).toBe(12);

    const invalid = actionRequest("public");
    invalid.target.function.kind = "mutation";
    await expect(Effect.runPromise(
      decodeApplicationActionWorkerRequestV1Effect(invalid),
    )).rejects.toMatchObject({ reason: "invalidTargetKind" });
  });

  it("enforces the action argument ceiling on owned byte buffers", async () => {
    const exact = actionRequest("public");
    exact.arguments = objectWithArrayBufferAtSemanticSize(
      MAX_APPLICATION_ACTION_ARGUMENT_SEMANTIC_BYTES_V1,
    );
    exact.argumentSemanticBytes =
      MAX_APPLICATION_ACTION_ARGUMENT_SEMANTIC_BYTES_V1;
    await expect(Effect.runPromise(
      decodeApplicationActionWorkerRequestV1Effect(exact),
    )).resolves.toMatchObject({
      argumentSemanticBytes: MAX_APPLICATION_ACTION_ARGUMENT_SEMANTIC_BYTES_V1,
    });

    const over = actionRequest("public");
    over.arguments = objectWithArrayBufferAtSemanticSize(
      MAX_APPLICATION_ACTION_ARGUMENT_SEMANTIC_BYTES_V1 + 1,
    );
    over.argumentSemanticBytes =
      MAX_APPLICATION_ACTION_ARGUMENT_SEMANTIC_BYTES_V1;
    await expect(Effect.runPromise(
      decodeApplicationActionWorkerRequestV1Effect(over),
    )).rejects.toMatchObject({ reason: "invalidArguments" });
  });

  it("rejects invalid action deadlines, digest sizes, and extra fields", async () => {
    const deadline = actionRequest("public");
    deadline.context.executionDeadline = deadline.context.executionTime - 1;
    await expect(Effect.runPromise(
      decodeApplicationActionWorkerRequestV1Effect(deadline),
    )).rejects.toMatchObject({ reason: "invalidShape", path: "context" });

    const digest = actionRequest("public");
    digest.context.hostPolicySha256 = new Uint8Array(31);
    await expect(Effect.runPromise(
      decodeApplicationActionWorkerRequestV1Effect(digest),
    )).rejects.toMatchObject({
      reason: "invalidShape",
      path: "context.hostPolicySha256",
    });

    const generation = actionRequest("public");
    generation.context.executionGeneration = 0n;
    await expect(Effect.runPromise(
      decodeApplicationActionWorkerRequestV1Effect(generation),
    )).rejects.toMatchObject({ reason: "invalidShape", path: "context" });

    await expect(Effect.runPromise(
      decodeApplicationActionWorkerRequestV1Effect({
        ...actionRequest("public"),
        artifact: "forbidden",
      }),
    )).rejects.toMatchObject({ reason: "invalidShape", path: "$request" });
  });

  it("normalizes one shared result envelope", async () => {
    const input = {
      format: APPLICATION_WORKER_RESULT_FORMAT_V1,
      version: APPLICATION_WORKER_RESULT_VERSION_V1,
      kind: "success" as const,
      value: { ok: true, count: 1n },
    };
    const decoded = await Effect.runPromise(
      decodeApplicationWorkerResultV1Effect(input),
    );
    input.value.ok = false;

    expect(decoded.kind).toBe("success");
    if (decoded.kind !== "success") {
      throw new Error("Expected a success result.");
    }
    expect(decoded.value).toEqual({ ok: true, count: 1n });
    expect(Object.isFrozen(decoded.value)).toBe(true);
    await expect(Effect.runPromise(
      decodeApplicationWorkerResultV1Effect({ ...input, extra: true }),
    )).rejects.toMatchObject({ boundary: "result", reason: "invalidShape" });
  });

  it("owns one bounded structured application-error result", async () => {
    const input = {
      format: APPLICATION_WORKER_RESULT_FORMAT_V1,
      version: APPLICATION_WORKER_RESULT_VERSION_V1,
      kind: "applicationError" as const,
      error: {
        code: "ORDER_CLOSED",
        message: "Order is closed.",
        data: { orderId: "order-1", retryable: false },
      },
    };
    const decoded = await Effect.runPromise(
      decodeApplicationWorkerResultV1Effect(input),
    );
    input.error.data.orderId = "changed";

    expect(decoded).toEqual({
      format: APPLICATION_WORKER_RESULT_FORMAT_V1,
      version: APPLICATION_WORKER_RESULT_VERSION_V1,
      kind: "applicationError",
      error: {
        code: "ORDER_CLOSED",
        message: "Order is closed.",
        data: { orderId: "order-1", retryable: false },
      },
    });
    if (decoded.kind !== "applicationError") {
      throw new Error("Expected an application-error result.");
    }
    expect(Object.isFrozen(decoded.error)).toBe(true);
    expect(Object.isFrozen(decoded.error.data)).toBe(true);

    await expect(Effect.runPromise(
      decodeApplicationWorkerResultV1Effect({
        ...input,
        error: {
          code: "x".repeat(
            MAX_APPLICATION_WORKER_APPLICATION_ERROR_TEXT_BYTES_V1 + 1,
          ),
          message: "invalid",
        },
      }),
    )).rejects.toMatchObject({
      boundary: "result",
      reason: "invalidApplicationError",
      path: "error",
    });
  });

  it("maps hostile nested result reflection to a typed failure", async () => {
    await expect(Effect.runPromise(
      decodeApplicationWorkerResultV1Effect({
        format: APPLICATION_WORKER_RESULT_FORMAT_V1,
        version: APPLICATION_WORKER_RESULT_VERSION_V1,
        kind: "success",
        value: {
          nested: new Proxy({}, {
            ownKeys() {
              throw new Error("ownKeys trap");
            },
          }),
        },
      }),
    )).rejects.toMatchObject({ reason: "invalidResult", path: "value" });

    let accessorReads = 0;
    const accessor = {};
    Object.defineProperty(accessor, "danger", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return true;
      },
    });
    await expect(Effect.runPromise(
      decodeApplicationWorkerResultV1Effect({
        format: APPLICATION_WORKER_RESULT_FORMAT_V1,
        version: APPLICATION_WORKER_RESULT_VERSION_V1,
        kind: "success",
        value: { nested: accessor },
      }),
    )).rejects.toMatchObject({ reason: "invalidResult", path: "value" });
    expect(accessorReads).toBe(0);
  });

  it("enforces the shared result ceiling on owned byte buffers", async () => {
    const exact = await Effect.runPromise(
      decodeApplicationWorkerResultV1Effect({
        format: APPLICATION_WORKER_RESULT_FORMAT_V1,
        version: APPLICATION_WORKER_RESULT_VERSION_V1,
        kind: "success",
        value: new ArrayBuffer(
          MAX_APPLICATION_WORKER_RESULT_SEMANTIC_BYTES_V1 - 2,
        ),
      }),
    );
    expect(exact.kind).toBe("success");
    if (exact.kind !== "success") {
      throw new Error("Expected a success result.");
    }
    expect(exact.value).toBeInstanceOf(ArrayBuffer);
    if (!(exact.value instanceof ArrayBuffer)) {
      throw new Error("Expected an owned ArrayBuffer result.");
    }
    expect(exact.value.byteLength).toBe(
      MAX_APPLICATION_WORKER_RESULT_SEMANTIC_BYTES_V1 - 2,
    );

    await expect(Effect.runPromise(
      decodeApplicationWorkerResultV1Effect({
        format: APPLICATION_WORKER_RESULT_FORMAT_V1,
        version: APPLICATION_WORKER_RESULT_VERSION_V1,
        kind: "success",
        value: new ArrayBuffer(
          MAX_APPLICATION_WORKER_RESULT_SEMANTIC_BYTES_V1 - 1,
        ),
      }),
    )).rejects.toMatchObject({ reason: "invalidResult", path: "value" });
  });

  it("pins the node ceiling before the next member descriptor", async () => {
    const sharedLevel = new Array<unknown>(8_192).fill(true);
    const exactFinalLevel = new Array<unknown>(8_183).fill(true);
    const exactLevels = [
      ...new Array<ReadonlyArray<unknown>>(7).fill(sharedLevel),
      exactFinalLevel,
    ];
    await expect(Effect.runPromise(
      decodeApplicationWorkerResultV1Effect({
        format: APPLICATION_WORKER_RESULT_FORMAT_V1,
        version: APPLICATION_WORKER_RESULT_VERSION_V1,
        kind: "success",
        value: exactLevels,
      }),
    )).resolves.toMatchObject({ value: expect.any(Array) });

    let lateDescriptorReads = 0;
    const finalLevel = new Proxy(new Array<unknown>(8_184).fill(true), {
      getOwnPropertyDescriptor(target, property) {
        if (property === "8183") lateDescriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const overLevels = [
      ...new Array<ReadonlyArray<unknown>>(7).fill(sharedLevel),
      finalLevel,
    ];
    const consumedBeforeLastLevel = 1 + 7 * (1 + 8_192) + 1;
    expect(
      MAX_APPLICATION_WORKER_VALUE_NODES_V1 - consumedBeforeLastLevel,
    ).toBe(8_183);

    await expect(Effect.runPromise(
      decodeApplicationWorkerResultV1Effect({
        format: APPLICATION_WORKER_RESULT_FORMAT_V1,
        version: APPLICATION_WORKER_RESULT_VERSION_V1,
        kind: "success",
        value: overLevels,
      }),
    )).rejects.toMatchObject({ reason: "invalidResult", path: "value" });
    expect(lateDescriptorReads).toBe(0);
  });

  it("caps repeated undefined-member inspections", async () => {
    let descriptorReads = 0;
    const raw: Record<string, unknown> = {};
    for (let index = 0; index < 1_024; index += 1) {
      raw[`field${index}`] = undefined;
    }
    const shared = new Proxy(raw, {
      getOwnPropertyDescriptor(target, property) {
        descriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const sharedLevel = new Array<unknown>(8_192).fill(shared);
    const levels = new Array<ReadonlyArray<unknown>>(8).fill(sharedLevel);

    await expect(Effect.runPromise(
      decodeApplicationWorkerResultV1Effect({
        format: APPLICATION_WORKER_RESULT_FORMAT_V1,
        version: APPLICATION_WORKER_RESULT_VERSION_V1,
        kind: "success",
        value: levels,
      }),
    )).rejects.toMatchObject({ reason: "invalidResult", path: "value" });
    expect(descriptorReads).toBeLessThanOrEqual(
      MAX_APPLICATION_WORKER_MEMBER_INSPECTIONS_V1,
    );
  });

  it("converts hostile reflection into typed failures without invoking accessors", async () => {
    const hostile = new Proxy(transactionRequest("query", "public"), {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
    });
    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(hostile),
    )).rejects.toMatchObject({ reason: "invalidShape", path: "$request" });

    let reads = 0;
    const accessor = transactionRequest("query", "public");
    Object.defineProperty(accessor, "arguments", {
      enumerable: true,
      get() {
        reads += 1;
        return { userId: "user-1" };
      },
    });
    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(accessor),
    )).rejects.toMatchObject({ reason: "invalidShape" });
    expect(reads).toBe(0);
  });

  it("snapshots union discriminants through one descriptor pass", async () => {
    const input = transactionRequest("query", "public");
    const authReads = new Map<PropertyKey, number>();
    input.auth = new Proxy(input.auth, {
      getOwnPropertyDescriptor(target, property) {
        authReads.set(property, (authReads.get(property) ?? 0) + 1);
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const contextReads = new Map<PropertyKey, number>();
    input.context = new Proxy(input.context, {
      getOwnPropertyDescriptor(target, property) {
        contextReads.set(property, (contextReads.get(property) ?? 0) + 1);
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    await expect(Effect.runPromise(
      decodeApplicationTransactionWorkerRequestV1Effect(input),
    )).resolves.toMatchObject({ context: { mode: "query" } });
    expect(authReads.get("kind")).toBe(1);
    expect(authReads.get("user")).toBe(1);
    expect(contextReads.get("mode")).toBe(1);
  });
});

type FunctionKind = "query" | "mutation" | "workflowMutation" | "action";
type Visibility = "public" | "internal";

function transactionRequest(kind: FunctionKind, visibility: Visibility) {
  const argumentsValue: Record<string, unknown> = { userId: "user-1" };
  return {
    format: APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
    version: APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
    target: target(kind, visibility),
    auth: userAuth(),
    arguments: argumentsValue,
    argumentSemanticBytes: normalizeFlarexValueV1(argumentsValue)
      .semanticSizeBytes,
    tables: [{ tableId: 1, logicalName: "users" }],
    context: kind === "query" ? queryContext() : writeContext(),
  };
}

function actionRequest(visibility: Visibility) {
  const argumentsValue: Record<string, unknown> = { orderId: "order-1" };
  return {
    format: APPLICATION_ACTION_WORKER_REQUEST_FORMAT_V1,
    version: APPLICATION_ACTION_WORKER_REQUEST_VERSION_V1,
    target: target("action", visibility),
    auth: userAuth(),
    arguments: argumentsValue,
    argumentSemanticBytes: normalizeFlarexValueV1(argumentsValue)
      .semanticSizeBytes,
    context: {
      executionId: "execution-1",
      invocationId: "invocation-1",
      executionGeneration: 1n,
      executionTime: 1_800_000_000_000,
      executionDeadline: 1_800_000_030_000,
      randomSeed: new Uint8Array(32).fill(11),
      hostPolicySha256: new Uint8Array(32).fill(12),
    },
  };
}

function queryContext() {
  return {
    mode: "query" as const,
    executionId: "execution-1",
    randomSeed: new Uint8Array(32).fill(7),
    executionTime: 1_800_000_000_000,
    snapshotCommitSeq: 9n,
  };
}

function writeContext() {
  return {
    mode: "write" as const,
    executionId: "execution-1",
    logScopeId: "log-scope-1",
    randomSeed: new Uint8Array(32).fill(8),
    executionTime: 1_800_000_000_000,
    initialCreationTimeCursor: 1_800_000_000_001,
  };
}

function userAuth(): {
  kind: "user";
  user: Record<string, unknown>;
} {
  return {
    kind: "user" as const,
    user: {
      tokenIdentifier: "issuer|user-1",
      subject: "user-1",
      issuer: "issuer",
    },
  };
}

function objectAtSemanticSize(size: number): Record<string, unknown> {
  const key = "payload";
  return { [key]: "x".repeat(size - key.length - 5) };
}

function objectWithArrayBufferAtSemanticSize(
  size: number,
): Record<string, unknown> {
  const key = "payload";
  return { [key]: new ArrayBuffer(size - key.length - 5) };
}

function userIdentityAtSemanticSize(size: number): Record<string, unknown> {
  const identity: Record<string, unknown> = {
    tokenIdentifier: "i",
    subject: "s",
    issuer: "i",
    claim: "",
  };
  const base = normalizeFlarexValueV1(identity).semanticSizeBytes;
  identity.claim = "x".repeat(size - base);
  expect(normalizeFlarexValueV1(identity).semanticSizeBytes).toBe(size);
  return identity;
}

function target(kind: FunctionKind, visibility: Visibility) {
  return {
    format: "flarex.application-runtime-target" as const,
    version: 1 as const,
    scopeId: "scope",
    revisionId: "revision",
    candidateId: "candidate",
    analysisId: "analysis",
    sourceArtifactRootSha256: "1".repeat(64),
    manifestSha256: "2".repeat(64),
    schemaSha256: "3".repeat(64),
    functionCatalogSha256: "4".repeat(64),
    publicationSha256: "5".repeat(64),
    executionModulePath: "_flarex/application.js",
    function: {
      path: "users:get",
      moduleName: "users",
      exportName: "get",
      kind,
      visibility,
      args: { type: "object" as const, value: {} },
      returns: { type: "null" as const },
      partition: null,
      entrySha256: "6".repeat(64),
    },
  };
}
