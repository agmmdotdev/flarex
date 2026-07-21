import { Result } from "effect";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  encodeCanonicalJson,
  isJson,
} from "flarex-protocol/json";

import {
  decodeCanonicalFunctionMetadataSetV1,
  decodeFunctionMetadataOperationBudgetV1,
  encodeFunctionMetadataSetV1,
  FunctionMetadataDuplicatePathV1Error,
  FunctionMetadataInvalidV1Error,
  FunctionMetadataNonCanonicalBytesV1Error,
  FunctionMetadataOperationBudgetV1Error,
  type CanonicalFunctionMetadataSetV1,
  type FunctionMetadataCodecV1Error,
  type FunctionMetadataOperationBudgetV1,
} from "../src/functionMetadataCodec";

const LARGE_BUDGET = budget({
  maximumFunctionsVisited: 100,
  maximumValidatorNodesVisited: 10_000,
  maximumCanonicalUtf8BytesMaterialized: 10_000_000,
});

describe("Function Metadata V1 codec", () => {
  it("requires explicit positive safe-integer operation budgets", () => {
    const accepted = decodeFunctionMetadataOperationBudgetV1({
      maximumFunctionsVisited: 1,
      maximumValidatorNodesVisited: 2,
      maximumCanonicalUtf8BytesMaterialized: 3,
    });
    expect(Result.isSuccess(accepted)).toBe(true);
    if (Result.isSuccess(accepted)) {
      expect(accepted.success).toEqual({
        maximumFunctionsVisited: 1,
        maximumValidatorNodesVisited: 2,
        maximumCanonicalUtf8BytesMaterialized: 3,
      });
      expect(Object.isFrozen(accepted.success)).toBe(true);
    }

    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const rejected = decodeFunctionMetadataOperationBudgetV1({
        maximumFunctionsVisited: invalid,
        maximumValidatorNodesVisited: 2,
        maximumCanonicalUtf8BytesMaterialized: 3,
      });
      expect(Result.isFailure(rejected)).toBe(true);
      if (Result.isFailure(rejected)) {
        expect(rejected.failure).toBeInstanceOf(FunctionMetadataInvalidV1Error);
      }
    }

    let inputVisited = false;
    const input: Record<string, unknown> = {};
    Object.defineProperty(input, "functions", {
      get() {
        inputVisited = true;
        throw new Error("invalid configuration must short-circuit");
      },
    });
    const invalidConfiguration = encodeFunctionMetadataSetV1(input, {
      maximumFunctionsVisited: 0,
      maximumValidatorNodesVisited: 1,
      maximumCanonicalUtf8BytesMaterialized: 1,
    });
    expect(Result.isFailure(invalidConfiguration)).toBe(true);
    expect(inputVisited).toBe(false);
  });

  it("normalizes every function kind and exact omission/null defaults", () => {
    const functions = ["query", "mutation", "action", "workflowMutation"]
      .map((kind, index) => ({
        path: `module${index}:run`,
        kind,
        ...(index === 1 ? { visibility: "internal" } : {}),
        ...(index === 2
          ? {
              visibility: null,
              args: null,
              returns: null,
              route: null,
              partition: null,
            }
          : {}),
        ...(index === 3
          ? {
              args: undefined,
              returns: undefined,
              route: undefined,
              partition: undefined,
              position: undefined,
            }
          : {}),
      }));
    const encoded = success(encodeFunctionMetadataSetV1({ functions }, LARGE_BUDGET));

    expect(encoded.functions).toHaveLength(4);
    for (const item of encoded.functions) {
      expect(item.metadata.argsValidator).toEqual({ type: "any" });
      expect(item.metadata.returnsValidator).toBeNull();
      expect(item.metadata.route).toBeNull();
      expect(item.metadata.partition).toBeNull();
      expect(item.metadata.position).toBeNull();
      expect(item.metadata.executionModule).toBe(
        item.metadata.functionPath.split(":", 1)[0],
      );
    }
    expect(encoded.functions.map((item) => item.metadata.kind)).toEqual([
      "query",
      "mutation",
      "action",
      "workflowMutation",
    ]);
    expect(encoded.functions[1]?.metadata.visibility).toBe("internal");
    expect(encoded.functions[0]?.metadata.visibility).toBe("public");
    expect(encoded.functions[2]?.metadata.visibility).toBe("public");
    expect(encoded.canonicalText).toContain('"argsValidator":{"type":"any"}');
    expect(encoded.canonicalText).toContain('"position":null');
  });

  it("rejects supplied null position while storing omitted position as null", () => {
    const omitted = success(encodeFunctionMetadataSetV1({
      functions: [{ path: "messages:send", kind: "mutation" }],
    }, LARGE_BUDGET));
    expect(omitted.functions[0]?.metadata.position).toBeNull();

    const suppliedNull = encodeFunctionMetadataSetV1({
      functions: [{ path: "messages:send", kind: "mutation", position: null }],
    }, LARGE_BUDGET);
    expect(Result.isFailure(suppliedNull)).toBe(true);
    if (Result.isFailure(suppliedNull)) {
      expect(suppliedNull.failure).toBeInstanceOf(FunctionMetadataInvalidV1Error);
      expect((suppliedNull.failure as FunctionMetadataInvalidV1Error).issue.path)
        .toBe("$functions.functions[0].position");
    }
  });

  it("retains route, partition, create-root, and source-position variants", () => {
    const encoded = success(encodeFunctionMetadataSetV1({
      functions: [
        {
          path: "messages:send",
          kind: "mutation",
          route: { type: "args", field: "conversationId" },
          partition: {
            type: "partition",
            table: "messages",
            selector: "by_conversationId",
            partitionField: "conversationId",
            argField: "conversationId",
          },
          position: { path: "messages.ts", startLine: 12, startColumn: 7 },
        },
        {
          path: "roots:create",
          kind: "workflowMutation",
          partition: {
            type: "partitionCreateRoot",
            table: "roots",
            partitionField: "_id",
          },
        },
      ],
    }, LARGE_BUDGET));

    expect(encoded.functions[0]?.metadata).toMatchObject({
      route: { type: "args", field: "conversationId" },
      partition: {
        type: "partition",
        table: "messages",
        selector: "by_conversationId",
        partitionField: "conversationId",
        argField: "conversationId",
      },
      position: { path: "messages.ts", startLine: 12, startColumn: 7 },
    });
    expect(encoded.functions[1]?.metadata.partition).toEqual({
      type: "partitionCreateRoot",
      table: "roots",
      partitionField: "_id",
    });
    expect(success(decodeCanonicalFunctionMetadataSetV1(
      encoded.canonicalBytes,
      LARGE_BUDGET,
    )).functions.map((item) => item.metadata)).toEqual(
      encoded.functions.map((item) => item.metadata),
    );
  });

  it("round-trips every ValidatorJsonV1 variant and preserves union order", () => {
    const validators = [
      { type: "null" },
      { type: "number" },
      { type: "bigint" },
      { type: "boolean" },
      { type: "string" },
      { type: "bytes" },
      { type: "any" },
      { type: "id", tableName: "users" },
      { type: "literal", value: "ready" },
      { type: "array", value: { type: "boolean" } },
      {
        type: "object",
        value: Object.fromEntries([
          ["z", { optional: true, fieldType: { type: "string" } }],
          ["__proto__", { optional: false, fieldType: { type: "boolean" } }],
          ["a", { optional: false, fieldType: { type: "number" } }],
        ]),
      },
      {
        type: "record",
        keys: { type: "string" },
        values: { type: "number" },
      },
      {
        type: "union",
        value: [
          { type: "literal", value: "second" },
          { type: "literal", value: "first" },
        ],
      },
    ];
    const encoded = success(encodeFunctionMetadataSetV1({
      functions: [{
        path: "validators:all",
        kind: "mutation",
        args: { type: "union", value: validators },
        returns: { type: "object", value: {} },
      }],
    }, LARGE_BUDGET));
    const decoded = success(decodeCanonicalFunctionMetadataSetV1(
      encoded.canonicalBytes,
      LARGE_BUDGET,
    ));

    expect(decoded.functions[0]?.metadata.argsValidator).toEqual({
      type: "union",
      value: validators,
    });
    expect(encoded.canonicalText.indexOf('"a"')).toBeLessThan(
      encoded.canonicalText.indexOf('"z"'),
    );
    expect(encoded.canonicalText).toContain('"__proto__"');
    expect(encoded.canonicalText.indexOf('"second"')).toBeLessThan(
      encoded.canonicalText.indexOf('"first"'),
    );
  });

  it("delegates exact special literal spellings to Value Codec V1", () => {
    const firstNaN = float64FromBits(0x7ff8_0000_0000_0001n);
    const secondNaN = float64FromBits(0x7ff8_0000_0000_0002n);
    const literals = [
      0,
      -0,
      Infinity,
      -Infinity,
      firstNaN,
      secondNaN,
      "nul\0text",
    ];
    const encoded = success(encodeFunctionMetadataSetV1({
      functions: [{
        path: "validators:special",
        kind: "mutation",
        args: {
          type: "union",
          value: literals.map((value) => ({ type: "literal", value })),
        },
      }],
    }, LARGE_BUDGET));
    const decoded = success(decodeCanonicalFunctionMetadataSetV1(
      encoded.canonicalBytes,
      LARGE_BUDGET,
    ));
    const validator = decoded.functions[0]?.metadata.argsValidator;
    if (validator?.type !== "union") throw new Error("Expected union validator.");
    const decodedValues = validator.value.map((member) =>
      member.type === "literal" ? member.value : null
    );

    expect(Object.is(decodedValues[0], 0)).toBe(true);
    expect(Object.is(decodedValues[1], -0)).toBe(true);
    expect(decodedValues[2]).toBe(Infinity);
    expect(decodedValues[3]).toBe(-Infinity);
    expect(float64Bits(decodedValues[4] as number)).toBe(0x7ff8_0000_0000_0001n);
    expect(float64Bits(decodedValues[5] as number)).toBe(0x7ff8_0000_0000_0002n);
    expect(decodedValues[6]).toBe("nul\0text");
    expect(encoded.canonicalText.match(/"\$float"/gu)).toHaveLength(5);
    expect(encoded.canonicalText).toContain('"$string"');
    expectMatchesProtocolCanonicalEncoding(encoded);
  });

  it("rejects malformed Value Codec literal tags", () => {
    const encoded = success(encodeFunctionMetadataSetV1({
      functions: [{
        path: "validators:special",
        kind: "mutation",
        args: { type: "literal", value: -0 },
      }],
    }, LARGE_BUDGET));
    const malformed = encoded.canonicalText.replace(
      /"\$float":"[^"]+"/u,
      '"$float":"AAAA"',
    );
    const result = decodeCanonicalFunctionMetadataSetV1(
      new TextEncoder().encode(malformed),
      LARGE_BUDGET,
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(FunctionMetadataNonCanonicalBytesV1Error);
      expect((result.failure as FunctionMetadataNonCanonicalBytesV1Error).reason)
        .toBe("invalidShape");
    }
  });

  it("reports the second duplicate path before traversing later fields", () => {
    let laterFieldVisited = false;
    const duplicate = { path: "messages:send" } as Record<string, unknown>;
    Object.defineProperty(duplicate, "kind", {
      enumerable: true,
      get() {
        laterFieldVisited = true;
        throw new Error("must not be visited");
      },
    });
    const result = encodeFunctionMetadataSetV1({
      functions: [
        { path: "messages:send", kind: "mutation" },
        duplicate,
      ],
    }, LARGE_BUDGET);

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toEqual(new FunctionMetadataDuplicatePathV1Error({
        functionPath: "messages:send",
        firstIndex: 0,
        duplicateIndex: 1,
      }));
    }
    expect(laterFieldVisited).toBe(false);
  });

  it("preserves first-failure order across source functions", () => {
    let secondVisited = false;
    const second: Record<string, unknown> = {};
    Object.defineProperty(second, "path", {
      enumerable: true,
      get() {
        secondVisited = true;
        throw new Error("must not be visited");
      },
    });
    const result = encodeFunctionMetadataSetV1({
      functions: [
        { path: "messages:first", kind: "unsupported" },
        second,
      ],
    }, LARGE_BUDGET);
    expect(Result.isFailure(result)).toBe(true);
    expect(secondVisited).toBe(false);
  });

  it("orders paths by UTF-16 and reconstructs the exact complete set", () => {
    const encoded = success(encodeFunctionMetadataSetV1({
      functions: [
        { path: "\u{1f600}:run", kind: "query" },
        { path: "\ud800:run", kind: "query" },
        { path: "z:run", kind: "query" },
        { path: "ä:run", kind: "query" },
        { path: "a:run", kind: "query" },
      ],
    }, LARGE_BUDGET));
    expect(encoded.functions.map((item) => item.metadata.functionPath)).toEqual([
      "a:run",
      "z:run",
      "ä:run",
      "\ud800:run",
      "\u{1f600}:run",
    ]);

    const reconstructed =
      '{"format":"flarex.function-metadata-set","functions":[' +
      encoded.functions.map((item) => item.canonicalText).join(",") +
      '],"version":1}';
    expect(reconstructed).toBe(encoded.canonicalText);
    expect(new TextEncoder().encode(reconstructed)).toEqual(encoded.canonicalBytes);
    expect(encoded.canonicalUtf8BytesMaterialized).toBe(
      encoded.canonicalBytes.length +
        encoded.functions.reduce(
          (total, item) => total + item.canonicalBytes.length,
          0,
        ),
    );
    expect(createHash("sha256").update(encoded.canonicalBytes).digest("hex"))
      .toBe(createHash("sha256").update(new TextEncoder().encode(reconstructed)).digest("hex"));
    expectMatchesProtocolCanonicalEncoding(encoded);
  });

  it("rejects invalid UTF-8, JSON, shape, ordering, and noncanonical spelling", () => {
    const encoded = success(encodeFunctionMetadataSetV1({
      functions: [{ path: "messages:send", kind: "mutation" }],
    }, LARGE_BUDGET));
    const ordered = success(encodeFunctionMetadataSetV1({
      functions: [
        { path: "a:run", kind: "query" },
        { path: "b:run", kind: "query" },
      ],
    }, LARGE_BUDGET));
    const unordered = new TextEncoder().encode(
      '{"format":"flarex.function-metadata-set","functions":[' +
        [...ordered.functions].reverse().map((item) => item.canonicalText).join(",") +
        '],"version":1}',
    );
    const cases: ReadonlyArray<readonly [Uint8Array, string]> = [
      [new Uint8Array([0xc3, 0x28]), "invalidUtf8"],
      [new TextEncoder().encode("{"), "invalidJson"],
      [new TextEncoder().encode("{}"), "invalidShape"],
      [unordered, "invalidShape"],
      [new TextEncoder().encode(encoded.canonicalText.replace(",\"functions\"", ", \"functions\"")), "nonCanonical"],
      [new TextEncoder().encode(encoded.canonicalText.replace(
        '"functions":[{"argsValidator"',
        '"functions":[{"unexpected":true,"argsValidator"',
      )), "nonCanonical"],
    ];
    for (const [bytes, reason] of cases) {
      const decoded = decodeCanonicalFunctionMetadataSetV1(bytes, LARGE_BUDGET);
      expect(Result.isFailure(decoded)).toBe(true);
      if (Result.isFailure(decoded)) {
        expect(decoded.failure).toBeInstanceOf(FunctionMetadataNonCanonicalBytesV1Error);
        expect((decoded.failure as FunctionMetadataNonCanonicalBytesV1Error).reason)
          .toBe(reason);
      }
    }

    const invalidStoredPath = new TextEncoder().encode(
      encoded.canonicalText.replace(
        '"functionPath":"messages:send"',
        '"functionPath":":send"',
      ),
    );
    const invalidPathResult = decodeCanonicalFunctionMetadataSetV1(
      invalidStoredPath,
      LARGE_BUDGET,
    );
    expect(Result.isFailure(invalidPathResult)).toBe(true);
    if (Result.isFailure(invalidPathResult)) {
      expect(invalidPathResult.failure).toBeInstanceOf(
        FunctionMetadataNonCanonicalBytesV1Error,
      );
      expect((invalidPathResult.failure as FunctionMetadataNonCanonicalBytesV1Error).reason)
        .toBe("invalidShape");
    }
  });

  it("detaches caller metadata and stored bytes", () => {
    const nested = { type: "array", value: { type: "string" } };
    const input = {
      functions: [{
        path: "messages:send",
        kind: "mutation",
        args: nested,
        route: { type: "args", field: "conversationId" },
      }],
    };
    const encoded = success(encodeFunctionMetadataSetV1(input, LARGE_BUDGET));
    nested.value.type = "number";
    input.functions[0]!.route.field = "changed";
    expect(encoded.functions[0]?.metadata.argsValidator).toEqual({
      type: "array",
      value: { type: "string" },
    });
    expect(encoded.functions[0]?.metadata.route).toEqual({
      type: "args",
      field: "conversationId",
    });

    const storedInput = new Uint8Array(encoded.canonicalBytes);
    const decoded = success(decodeCanonicalFunctionMetadataSetV1(
      storedInput,
      LARGE_BUDGET,
    ));
    storedInput.fill(0);
    expect(decoded.canonicalBytes).toEqual(encoded.canonicalBytes);
    expect(decoded.canonicalBytes).not.toBe(storedInput);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.functions)).toBe(true);
    expect(Object.isFrozen(decoded.functions[0]?.metadata)).toBe(true);
  });

  it("enforces exact and +1 function, validator-node, and byte budgets", () => {
    const input = {
      functions: [
        {
          path: "a:run",
          kind: "mutation",
          args: {
            type: "object",
            value: {
              value: {
                optional: false,
                fieldType: { type: "array", value: { type: "string" } },
              },
            },
          },
        },
        { path: "b:run", kind: "query" },
      ],
    };
    const baseline = success(encodeFunctionMetadataSetV1(input, LARGE_BUDGET));

    success(encodeFunctionMetadataSetV1(input, budget({
      maximumFunctionsVisited: baseline.functionsVisited,
      maximumValidatorNodesVisited: baseline.validatorNodesVisited,
      maximumCanonicalUtf8BytesMaterialized:
        baseline.canonicalUtf8BytesMaterialized,
    })));

    const functionOverflow = encodeFunctionMetadataSetV1(input, budget({
      maximumFunctionsVisited: baseline.functionsVisited - 1,
      maximumValidatorNodesVisited: baseline.validatorNodesVisited,
      maximumCanonicalUtf8BytesMaterialized:
        baseline.canonicalUtf8BytesMaterialized,
    }));
    expectBudgetFailure(functionOverflow, "functionsVisited", 2, 1);

    const nodeOverflow = encodeFunctionMetadataSetV1(input, budget({
      maximumFunctionsVisited: baseline.functionsVisited,
      maximumValidatorNodesVisited: baseline.validatorNodesVisited - 1,
      maximumCanonicalUtf8BytesMaterialized:
        baseline.canonicalUtf8BytesMaterialized,
    }));
    expectBudgetFailure(
      nodeOverflow,
      "validatorNodesVisited",
      baseline.validatorNodesVisited,
      baseline.validatorNodesVisited - 1,
    );

    const byteOverflow = encodeFunctionMetadataSetV1(input, budget({
      maximumFunctionsVisited: baseline.functionsVisited,
      maximumValidatorNodesVisited: baseline.validatorNodesVisited,
      maximumCanonicalUtf8BytesMaterialized:
        baseline.canonicalUtf8BytesMaterialized - 1,
    }));
    expect(Result.isFailure(byteOverflow)).toBe(true);
    if (Result.isFailure(byteOverflow)) {
      expect(byteOverflow.failure).toBeInstanceOf(FunctionMetadataOperationBudgetV1Error);
      const error = byteOverflow.failure as FunctionMetadataOperationBudgetV1Error;
      expect(error.dimension).toBe("canonicalUtf8BytesMaterialized");
      expect(error.maximum).toBe(baseline.canonicalUtf8BytesMaterialized - 1);
      expect(error.observed).toBe(baseline.canonicalUtf8BytesMaterialized);
    }

    const decodeBaseline = success(decodeCanonicalFunctionMetadataSetV1(
      baseline.canonicalBytes,
      LARGE_BUDGET,
    ));
    const decodeBytes = decodeBaseline.canonicalUtf8BytesMaterialized;
    success(decodeCanonicalFunctionMetadataSetV1(
      baseline.canonicalBytes,
      budget({
        maximumFunctionsVisited: decodeBaseline.functionsVisited,
        maximumValidatorNodesVisited: decodeBaseline.validatorNodesVisited,
        maximumCanonicalUtf8BytesMaterialized: decodeBytes,
      }),
    ));
    const decodeOverflow = decodeCanonicalFunctionMetadataSetV1(
      baseline.canonicalBytes,
      budget({
        maximumFunctionsVisited: decodeBaseline.functionsVisited,
        maximumValidatorNodesVisited: decodeBaseline.validatorNodesVisited,
        maximumCanonicalUtf8BytesMaterialized: decodeBytes - 1,
      }),
    );
    expectBudgetFailure(
      decodeOverflow,
      "canonicalUtf8BytesMaterialized",
      decodeBytes,
      decodeBytes - 1,
    );
  });

  it("fails function-count preflight before visiting an over-budget item", () => {
    let visited = false;
    const second: Record<string, unknown> = {};
    Object.defineProperty(second, "path", {
      enumerable: true,
      get() {
        visited = true;
        throw new Error("must not be visited");
      },
    });
    const result = encodeFunctionMetadataSetV1({
      functions: [{ path: "a:run", kind: "query" }, second],
    }, budget({
      maximumFunctionsVisited: 1,
      maximumValidatorNodesVisited: 10,
      maximumCanonicalUtf8BytesMaterialized: 10_000,
    }));
    expectBudgetFailure(result, "functionsVisited", 2, 1);
    expect(visited).toBe(false);
  });

  it("charges the next validator node before traversing it", () => {
    let childVisited = false;
    const child = new Proxy({ type: "string" }, {
      getPrototypeOf(target) {
        childVisited = true;
        return Reflect.getPrototypeOf(target);
      },
    });
    const result = encodeFunctionMetadataSetV1({
      functions: [{
        path: "messages:send",
        kind: "mutation",
        args: { type: "array", value: child },
      }],
    }, budget({
      maximumFunctionsVisited: 1,
      maximumValidatorNodesVisited: 1,
      maximumCanonicalUtf8BytesMaterialized: 10_000,
    }));
    expectBudgetFailure(result, "validatorNodesVisited", 2, 1);
    expect(childVisited).toBe(false);
  });

  it("preflights oversized stored input before decoding", () => {
    const result = decodeCanonicalFunctionMetadataSetV1(
      new Uint8Array(101),
      budget({
        maximumFunctionsVisited: 1,
        maximumValidatorNodesVisited: 1,
        maximumCanonicalUtf8BytesMaterialized: 100,
      }),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(FunctionMetadataOperationBudgetV1Error);
      expect(result.failure).toMatchObject({
        dimension: "canonicalUtf8BytesMaterialized",
        observed: 101,
        maximum: 100,
      });
    }
  });

  it("uses intrinsic byte length and classifies detached stored views", () => {
    const encoded = success(encodeFunctionMetadataSetV1({
      functions: [{ path: "messages:send", kind: "mutation" }],
    }, LARGE_BUDGET));
    const spoofed = new Uint8Array(encoded.canonicalBytes);
    Object.defineProperty(spoofed, "byteLength", { value: 1 });
    const maximum = encoded.canonicalBytes.length - 1;
    const spoofedResult = decodeCanonicalFunctionMetadataSetV1(
      spoofed,
      budget({
        maximumFunctionsVisited: 10,
        maximumValidatorNodesVisited: 10,
        maximumCanonicalUtf8BytesMaterialized: maximum,
      }),
    );
    expectBudgetFailure(
      spoofedResult,
      "canonicalUtf8BytesMaterialized",
      maximum + 1,
      maximum,
    );

    const detached = new Uint8Array(encoded.canonicalBytes);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    const detachedResult = decodeCanonicalFunctionMetadataSetV1(
      detached,
      LARGE_BUDGET,
    );
    expect(Result.isFailure(detachedResult)).toBe(true);
    if (Result.isFailure(detachedResult)) {
      expect(detachedResult.failure).toBeInstanceOf(
        FunctionMetadataNonCanonicalBytesV1Error,
      );
      expect((detachedResult.failure as FunctionMetadataNonCanonicalBytesV1Error).reason)
        .toBe("invalidBytes");
    }
  });

  it("rejects oversized canonical strings before byte materialization", () => {
    const maximum = 256;
    const result = encodeFunctionMetadataSetV1({
      functions: [{
        path: `large:${"x".repeat(10_000)}`,
        kind: "query",
      }],
    }, budget({
      maximumFunctionsVisited: 1,
      maximumValidatorNodesVisited: 1,
      maximumCanonicalUtf8BytesMaterialized: maximum,
    }));
    expectBudgetFailure(
      result,
      "canonicalUtf8BytesMaterialized",
      maximum + 1,
      maximum,
    );
  });

  it("parses and canonicalizes deeply nested validators without call-stack recursion", () => {
    const depth = 12_000;
    let validator: unknown = { type: "string" };
    for (let index = 0; index < depth; index += 1) {
      validator = { type: "array", value: validator };
    }
    const deepBudget = budget({
      maximumFunctionsVisited: 1,
      maximumValidatorNodesVisited: depth + 1,
      maximumCanonicalUtf8BytesMaterialized: 100_000_000,
    });
    const encoded = success(encodeFunctionMetadataSetV1({
      functions: [{ path: "deep:run", kind: "query", args: validator }],
    }, deepBudget));
    expect(encoded.validatorNodesVisited).toBe(depth + 1);
    const decoded = success(decodeCanonicalFunctionMetadataSetV1(
      encoded.canonicalBytes,
      deepBudget,
    ));
    expect(decoded.validatorNodesVisited).toBe(depth + 1);
    expect(decoded.canonicalBytes).toEqual(encoded.canonicalBytes);
  });
});

function budget(
  input: FunctionMetadataOperationBudgetV1,
): FunctionMetadataOperationBudgetV1 {
  return success(decodeFunctionMetadataOperationBudgetV1(input));
}

function success<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function expectBudgetFailure(
  result: Result.Result<unknown, FunctionMetadataCodecV1Error>,
  dimension: FunctionMetadataOperationBudgetV1Error["dimension"],
  observed: number,
  maximum: number,
): void {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure).toBeInstanceOf(FunctionMetadataOperationBudgetV1Error);
    expect(result.failure).toMatchObject({ dimension, observed, maximum });
  }
}

function float64FromBits(bits: bigint): number {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, bits, false);
  return new DataView(buffer).getFloat64(0, false);
}

function float64Bits(value: number): bigint {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, false);
  return new DataView(buffer).getBigUint64(0, false);
}

function expectMatchesProtocolCanonicalEncoding(
  encoded: CanonicalFunctionMetadataSetV1,
): void {
  const decoded: unknown = JSON.parse(encoded.canonicalText);
  if (!isJson(decoded)) throw new Error("Expected canonical JSON test evidence.");
  expect(encodeCanonicalJson(decoded, (issue) => {
    throw new Error(`Unexpected canonical JSON invariant ${issue.reason}.`);
  })).toBe(encoded.canonicalText);
}
