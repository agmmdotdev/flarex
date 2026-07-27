import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodePointMutationExactRuntimeRequestV1Effect,
  decodePointMutationExactRuntimeResultV1Effect,
  POINT_MUTATION_EXACT_RUNTIME_FORMAT_V1,
  POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
  PointMutationExactRuntimeProtocolV1Error,
} from "../src/point-mutation-exact-runtime";
import {
  requirePointMutationArgumentSemanticSizeV1,
} from "../src/point-mutation-start";
import { normalizeFlarexValueV1 } from "../src/value";
import {
  MAX_VALIDATOR_JSON_DEPTH_V1,
  MAX_VALIDATOR_JSON_NODES_V1,
  MAX_VALIDATOR_JSON_OBJECT_FIELDS_V1,
} from "../src/validator-json";

describe("point mutation exact-runtime protocol", () => {
  it("decodes and owns a strict runtime-value request", async () => {
    const randomSeed = new Uint8Array(32).fill(7);
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const argumentsValue = { bytes, count: 2n };
    const request = testRequest({
      arguments: argumentsValue,
      randomSeed,
    });

    const decoded = await Effect.runPromise(
      decodePointMutationExactRuntimeRequestV1Effect(request),
    );
    randomSeed.fill(9);
    new Uint8Array(bytes).fill(8);

    expect(decoded).toMatchObject({
      format: POINT_MUTATION_EXACT_RUNTIME_FORMAT_V1,
      version: 1,
      artifact: {
        runtime: "dynamic-worker",
        executionModule: "_flarex/execution.js",
      },
      function: {
        path: "orders:complete",
        kind: "mutation",
        visibility: "public",
      },
      auth: {
        kind: "user",
        user: {
          tokenIdentifier: "token-1",
          issuer: "https://auth.example.com",
          subject: "user-1",
          email: "user@example.com",
          emailVerified: true,
          role: "admin",
        },
      },
      tables: [{ tableId: 1, logicalName: "orders" }],
    });
    expect(decoded.context.randomSeed).toEqual(new Uint8Array(32).fill(7));
    expect(new Uint8Array(decoded.arguments.bytes as ArrayBuffer))
      .toEqual(new Uint8Array([1, 2, 3]));
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.arguments)).toBe(true);
    expect(Object.isFrozen(decoded.tables)).toBe(true);
    expect(decoded.auth.kind).toBe("user");
    if (decoded.auth.kind === "user") {
      expect(Object.keys(decoded.auth.user)).toEqual([
        "tokenIdentifier",
        "issuer",
        "subject",
        "email",
        "emailVerified",
        "role",
      ]);
      expect(Object.isFrozen(decoded.auth.user)).toBe(true);
    }
  });

  it("rejects excess fields, version skew, and semantic-size drift", async () => {
    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeRequestV1Effect({
        ...testRequest(),
        authorityToken: "must-not-cross",
      }),
    )).rejects.toMatchObject({
      _tag: "PointMutationExactRuntimeProtocolV1Error",
      boundary: "request",
      reason: "invalidShape",
    });

    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeRequestV1Effect({
        ...testRequest(),
        version: 2,
      }),
    )).rejects.toBeInstanceOf(PointMutationExactRuntimeProtocolV1Error);

    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeRequestV1Effect({
        ...testRequest(),
        argumentArraySemanticBytes:
          testRequest().argumentArraySemanticBytes + 1,
      }),
    )).rejects.toMatchObject({
      boundary: "request",
      reason: "argumentSizeMismatch",
    });
  });

  it("rejects invalid capability projections and runtime argument roots", async () => {
    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeRequestV1Effect({
        ...testRequest(),
        artifact: {
          ...testRequest().artifact,
          executionModule: "_flarex/other.js",
        },
      }),
    )).rejects.toMatchObject({
      boundary: "request",
      reason: "invalidShape",
    });

    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeRequestV1Effect({
        ...testRequest(),
        auth: {
          kind: "user",
          user: {
            tokenIdentifier: "token-1",
            issuer: "https://auth.example.com",
            subject: "user-1",
            oversized: "x".repeat(65_536),
          },
        },
      }),
    )).rejects.toMatchObject({
      boundary: "request",
      reason: "invalidAuth",
    });

    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeRequestV1Effect({
        ...testRequest(),
        arguments: ["not", "an", "argument", "object"],
      }),
    )).rejects.toMatchObject({
      boundary: "request",
      reason: "invalidArguments",
    });

    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeRequestV1Effect({
        ...testRequest(),
        tables: [
          { tableId: 1, logicalName: "orders" },
          { tableId: 1, logicalName: "users" },
        ],
      }),
    )).rejects.toMatchObject({
      boundary: "request",
      reason: "invalidShape",
    });
  });

  it("applies bounded validator admission before recursive schema decoding", async () => {
    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeRequestV1Effect({
        ...testRequest(),
        function: {
          ...testRequest().function,
          returnsValidator: nestedArrayValidator(
            MAX_VALIDATOR_JSON_DEPTH_V1,
          ),
        },
      }),
    )).resolves.toMatchObject({
      function: {
        returnsValidator: { type: "array" },
      },
    });

    for (const returnsValidator of [
      nestedArrayValidator(MAX_VALIDATOR_JSON_DEPTH_V1 + 1),
      {
        type: "union",
        value: Array.from(
          { length: MAX_VALIDATOR_JSON_NODES_V1 },
          () => ({ type: "null" }),
        ),
      },
      {
        type: "object",
        value: Object.fromEntries(Array.from(
          { length: MAX_VALIDATOR_JSON_OBJECT_FIELDS_V1 + 1 },
          (_, index) => [
            `field${index}`,
            { fieldType: { type: "null" }, optional: false },
          ],
        )),
      },
    ]) {
      await expect(Effect.runPromise(
        decodePointMutationExactRuntimeRequestV1Effect({
          ...testRequest(),
          function: {
            ...testRequest().function,
            returnsValidator,
          },
        }),
      )).rejects.toMatchObject({
        boundary: "request",
        reason: "invalidShape",
      });
    }
  });

  it("decodes, copies, and bounds strict result envelopes", async () => {
    const bytes = new Uint8Array([4, 5, 6]).buffer;
    const decoded = await Effect.runPromise(
      decodePointMutationExactRuntimeResultV1Effect({
        format: POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
        version: 1,
        value: { bytes, total: 3n },
      }),
    );
    new Uint8Array(bytes).fill(0);

    expect(new Uint8Array(
      (decoded.value as { readonly bytes: ArrayBuffer }).bytes,
    )).toEqual(new Uint8Array([4, 5, 6]));
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.value)).toBe(true);

    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeResultV1Effect({
        format: POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
        version: 1,
        value: null,
        journal: "must-not-return",
      }),
    )).rejects.toMatchObject({
      boundary: "result",
      reason: "invalidShape",
    });

    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeResultV1Effect({
        format: POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
        version: 1,
        value: undefined,
      }),
    )).rejects.toMatchObject({
      boundary: "result",
      reason: "invalidResult",
    });

    for (const invalidValue of [
      { $reserved: true },
      { "non-ascii-é": true },
      { "control-\u001f": true },
    ]) {
      await expect(Effect.runPromise(
        decodePointMutationExactRuntimeResultV1Effect({
          format: POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
          version: 1,
          value: invalidValue,
        }),
      )).rejects.toMatchObject({
        boundary: "result",
        reason: "invalidResult",
      });
    }
  });
});

function testRequest(overrides: {
  readonly arguments?: unknown;
  readonly randomSeed?: Uint8Array;
} = {}) {
  const argumentsValue = overrides.arguments ?? { orderId: "1:order-1" };
  const normalized = normalizeFlarexValueV1(argumentsValue);
  if (
    typeof normalized.value !== "object" ||
    normalized.value === null ||
    Array.isArray(normalized.value) ||
    normalized.value instanceof ArrayBuffer
  ) {
    throw new Error("Test exact-runtime arguments must be an object.");
  }
  return {
    format: POINT_MUTATION_EXACT_RUNTIME_FORMAT_V1,
    version: 1,
    artifact: {
      runtime: "dynamic-worker",
      artifactId: "artifact_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourcePackageHash: "a".repeat(64),
      executionModule: "_flarex/execution.js",
    },
    function: {
      path: "orders:complete",
      executionModule: "_flarex/execution.js",
      kind: "mutation",
      visibility: "public",
      argsValidator: {
        type: "object",
        value: {},
      },
      returnsValidator: null,
    },
    auth: {
      kind: "user",
      user: {
        tokenIdentifier: "token-1",
        issuer: "https://auth.example.com",
        subject: "user-1",
        email: "user@example.com",
        emailVerified: true,
        role: "admin",
      },
    },
    arguments: normalized.value,
    argumentArraySemanticBytes: requirePointMutationArgumentSemanticSizeV1(
      normalized.semanticSizeBytes,
    ),
    tables: [{ tableId: 1, logicalName: "orders" }],
    context: {
      executionId: "execution-1",
      logScopeId: "log-scope-1",
      randomSeed: overrides.randomSeed ?? new Uint8Array(32).fill(3),
      executionTime: 100,
      initialCreationTimeCursor: 100,
    },
  } as const;
}

function nestedArrayValidator(depth: number): unknown {
  let validator: unknown = { type: "null" };
  for (let currentDepth = 1; currentDepth < depth; currentDepth += 1) {
    validator = { type: "array", value: validator };
  }
  return validator;
}
