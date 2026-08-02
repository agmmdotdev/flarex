import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodePointQueryExactRuntimeRequestV1Effect,
  decodePointQueryExactRuntimeResultV1Effect,
  POINT_QUERY_EXACT_RUNTIME_FORMAT_V1,
  POINT_QUERY_EXACT_RUNTIME_RESULT_FORMAT_V1,
} from "../src/point-query-exact-runtime";
import { normalizeFlarexValueV1 } from "../src/value";

describe("point-query exact-runtime protocol", () => {
  it("owns one strict query-only request and result", async () => {
    const randomSeed = new Uint8Array(32).fill(7);
    const argumentsValue = { id: "1:00000000-0000-0000-0000-000000000001" };
    const decoded = await Effect.runPromise(
      decodePointQueryExactRuntimeRequestV1Effect(request({
        arguments: argumentsValue,
        argumentSemanticBytes: normalizeFlarexValueV1(argumentsValue)
          .semanticSizeBytes,
        context: { ...request().context, randomSeed },
      })),
    );
    randomSeed.fill(9);
    expect(decoded).toMatchObject({
      format: POINT_QUERY_EXACT_RUNTIME_FORMAT_V1,
      version: 1,
      function: { path: "orders:get", kind: "query", visibility: "public" },
      auth: { kind: "anonymous" },
      tables: [{ tableId: 1, logicalName: "orders" }],
    });
    expect(decoded.context.randomSeed).toEqual(new Uint8Array(32).fill(7));
    expect(Object.isFrozen(decoded)).toBe(true);

    const result = await Effect.runPromise(
      decodePointQueryExactRuntimeResultV1Effect({
        format: POINT_QUERY_EXACT_RUNTIME_RESULT_FORMAT_V1,
        version: 1,
        value: { status: "open" },
      }),
    );
    expect(result.value).toEqual({ status: "open" });
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it("owns nested validator projections after decode", async () => {
    const argsValidator = {
      type: "object",
      value: {
        id: { fieldType: { type: "string" }, optional: false },
      },
    };
    const input = request({
      function: { ...request().function, argsValidator },
    });
    const decoded = await Effect.runPromise(
      decodePointQueryExactRuntimeRequestV1Effect(input),
    );
    argsValidator.value.id.fieldType.type = "number";
    expect(decoded.function.argsValidator).toEqual({
      type: "object",
      value: {
        id: { fieldType: { type: "string" }, optional: false },
      },
    });
    expect(Object.isFrozen(decoded.function.argsValidator)).toBe(true);
    expect(Object.isFrozen(
      (decoded.function.argsValidator as typeof argsValidator).value.id,
    )).toBe(true);
  });

  it("preserves accepted own undefined authentication claims", async () => {
    const decoded = await Effect.runPromise(
      decodePointQueryExactRuntimeRequestV1Effect(request({
        auth: {
          kind: "user",
          user: {
            tokenIdentifier: "token-undefined",
            subject: "user-undefined",
            issuer: "https://auth.example.com",
            name: undefined,
          },
        },
      })),
    );
    expect(decoded.auth.kind).toBe("user");
    if (decoded.auth.kind !== "user") throw new Error("Expected user auth.");
    expect(Object.hasOwn(decoded.auth.user, "name")).toBe(true);
    expect(decoded.auth.user.name).toBeUndefined();
  });

  it("rejects mutation metadata, semantic drift, hostile auth, and result excess", async () => {
    await expect(Effect.runPromise(
      decodePointQueryExactRuntimeRequestV1Effect({
        ...request(),
        function: { ...request().function, kind: "mutation" },
      }),
    )).rejects.toMatchObject({ boundary: "request", reason: "invalidShape" });
    await expect(Effect.runPromise(
      decodePointQueryExactRuntimeRequestV1Effect({
        ...request(),
        function: {
          ...request().function,
          argsValidator: { type: "string" },
        },
      }),
    )).rejects.toMatchObject({ boundary: "request", reason: "invalidShape" });
    await expect(Effect.runPromise(
      decodePointQueryExactRuntimeRequestV1Effect({
        ...request(),
        argumentSemanticBytes: request().argumentSemanticBytes + 1,
      }),
    )).rejects.toMatchObject({ boundary: "request", reason: "invalidArguments" });
    await expect(Effect.runPromise(
      decodePointQueryExactRuntimeRequestV1Effect({
        ...request(),
        auth: { kind: "user", user: { tokenIdentifier: "only-field" } },
      }),
    )).rejects.toMatchObject({ boundary: "request", reason: "invalidAuth" });
    await expect(Effect.runPromise(
      decodePointQueryExactRuntimeResultV1Effect({
        format: POINT_QUERY_EXACT_RUNTIME_RESULT_FORMAT_V1,
        version: 1,
        value: null,
        journal: [],
      }),
    )).rejects.toMatchObject({ boundary: "result", reason: "invalidShape" });
  });
});

function request(overrides: Readonly<Record<string, unknown>> = {}) {
  const argumentsValue = {};
  return {
    format: POINT_QUERY_EXACT_RUNTIME_FORMAT_V1,
    version: 1,
    runtimeTargetSha256: new Uint8Array(32).fill(1),
    artifact: {
      runtime: "dynamic-worker",
      artifactId: `artifact_${"a".repeat(32)}`,
      sourcePackageHash: "a".repeat(64),
      executionModule: "orders.js",
    },
    function: {
      path: "orders:get",
      executionModule: "orders.js",
      kind: "query",
      visibility: "public",
      argsValidator: { type: "any" },
      returnsValidator: null,
    },
    auth: { kind: "anonymous" },
    arguments: argumentsValue,
    argumentSemanticBytes: normalizeFlarexValueV1(argumentsValue).semanticSizeBytes,
    tables: [{ tableId: 1, logicalName: "orders" }],
    context: {
      executionId: "query-1",
      randomSeed: new Uint8Array(32).fill(2),
      executionTime: 100,
      snapshotCommitSeq: 7n,
    },
    ...overrides,
  };
}
