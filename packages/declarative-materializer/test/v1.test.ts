import {
  CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
  CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
  makeCanonicalDeclarativeProgramBudgetV1,
  makeCanonicalDeclarativeProgramFixtureV1,
  type CanonicalDeclarativeProgramInputV1,
  type CanonicalDeclarativeProgramV1,
} from "@flarex/declarative-program/v1";
import { Result } from "effect";
import { describe, expect, expectTypeOf, test } from "vitest";

import {
  DECLARATIVE_V2_MATERIALIZER_FORMAT_V1,
  makeDeclarativeV2MaterializationBudgetV1,
  materializeDeclarativeV2ArtifactsV1,
  type DeclarativeV2ArtifactIngressPlanV1,
  type DeclarativeV2MaterializationBudgetInputV1,
  type DeclarativeV2MaterializationBudgetV1,
  type DeclarativeV2MaterializationV1Error,
  type DeclarativeV2PrebuiltModuleGraphInputV1,
} from "../src/v1";

const TEXT_DECODER = new TextDecoder();

const PROGRAM_BUDGET = Result.getOrThrow(
  makeCanonicalDeclarativeProgramBudgetV1({
    maximumModules: 4,
    maximumFunctions: 4,
    maximumIdentifierUtf8Bytes: 4_096,
    maximumValidatorNodes: 256,
    maximumValidatorDepth: 32,
    maximumValidatorStringUtf8Bytes: 4_096,
  }),
);

const MATERIALIZATION_BUDGET_INPUT = {
  maximumModules: 4,
  maximumEntryBindings: 4,
  maximumSourceBytes: 4_096,
  maximumSourceMapBytes: 4_096,
  maximumBytesMaterialized: 64_000,
  maximumSemanticRecords: 64,
  maximumSemanticRecordBytes: 16_000,
  maximumSemanticStreamBytes: 32_000,
} satisfies DeclarativeV2MaterializationBudgetInputV1;

function program(): CanonicalDeclarativeProgramV1 {
  const input = {
    format: CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
    version: CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
    schema: {
      tables: [{
        logicalName: "orders",
        definition: {
          kind: "appDocument",
          definitionVersion: 1,
          documentType: {
            type: "object",
            value: {
              status: {
                fieldType: { type: "string" },
                optional: false,
              },
            },
          },
        },
      }],
      indexes: [{
        tableLogicalName: "orders",
        descriptor: "by_status",
        fields: ["status"],
      }],
    },
    modules: [{
      modulePath: "orders",
      functions: [{
        exportName: "place",
        kind: "mutation",
        visibility: "public",
        argsValidator: {
          type: "object",
          value: {
            status: {
              fieldType: { type: "string" },
              optional: false,
            },
          },
        },
        returnsValidator: { type: "id", tableName: "orders" },
      }],
    }],
  } satisfies CanonicalDeclarativeProgramInputV1;
  return Result.getOrThrow(
    makeCanonicalDeclarativeProgramFixtureV1(input, PROGRAM_BUDGET),
  );
}

function graph(): {
  readonly value: DeclarativeV2PrebuiltModuleGraphInputV1;
  readonly executionBytes: Uint8Array;
  readonly functionBytes: Uint8Array;
  readonly sourceMapBytes: Uint8Array;
} {
  const executionBytes = new TextEncoder().encode("export const run = 1;");
  const functionBytes = new TextEncoder().encode("export const place = 1;");
  const sourceMapBytes = new TextEncoder().encode("{}");
  return {
    executionBytes,
    functionBytes,
    sourceMapBytes,
    value: {
      modules: [
        {
          path: "orders.js",
          roles: ["function"],
          sourceBytes: functionBytes,
          sourceMapBytes,
        },
        {
          path: "_flarex/execution.js",
          roles: ["execution"],
          sourceBytes: executionBytes,
          sourceMapBytes: null,
        },
      ],
      functionEntries: [{
        logicalModulePath: "orders",
        artifactModulePath: "orders.js",
      }],
      executionPath: "_flarex/execution.js",
      schemaPath: null,
      authPath: null,
    },
  };
}

function budget(
  overrides: Partial<DeclarativeV2MaterializationBudgetInputV1> = {},
): DeclarativeV2MaterializationBudgetV1 {
  return Result.getOrThrow(makeDeclarativeV2MaterializationBudgetV1({
    ...MATERIALIZATION_BUDGET_INPUT,
    ...overrides,
  }));
}

function materialize(
  graphInput: unknown = graph().value,
  selectedBudget: DeclarativeV2MaterializationBudgetV1 = budget(),
): Result.Result<
  DeclarativeV2ArtifactIngressPlanV1,
  DeclarativeV2MaterializationV1Error
> {
  return materializeDeclarativeV2ArtifactsV1(
    program(),
    graphInput,
    selectedBudget,
  );
}

function success(): DeclarativeV2ArtifactIngressPlanV1 {
  return Result.getOrThrow(materialize());
}

describe("@flarex/declarative-materializer/v1", () => {
  test("keeps the budget nominal and emits an inert deterministic ingress plan", () => {
    expectTypeOf<DeclarativeV2MaterializationBudgetInputV1>()
      .not.toMatchTypeOf<DeclarativeV2MaterializationBudgetV1>();
    const plan = success();

    expect(plan.format).toBe(DECLARATIVE_V2_MATERIALIZER_FORMAT_V1);
    expect(plan.source.modules.map((module) => module.path)).toEqual([
      "_flarex/execution.js",
      "orders.js",
    ]);
    expect(plan.source.modules.map((module) => module.roles)).toEqual([8, 1]);
    expect(plan.source.functionEntries).toEqual([{
      logicalModulePath: "orders",
      artifactModulePath: "orders.js",
    }]);
    expect(plan.source).toMatchObject({
      executionPath: "_flarex/execution.js",
      schemaPath: null,
      authPath: null,
    });
    expect(plan.semantic.recordCount).toBe(11);
    expect(plan.usage).toMatchObject({
      modules: 2,
      entryBindings: 1,
      semanticRecords: 11,
      semanticStreamBytes: plan.semantic.bytes.byteLength,
    });
    expect(Object.keys(plan)).toEqual(["format", "source", "semantic", "usage"]);
    expect(JSON.stringify(plan)).not.toMatch(
      /root|selector|generation|fence|verified|candidate|readiness|activation/u,
    );
  });

  test("emits canonical ordered semantic records with a final LF", () => {
    const plan = success();
    const text = TEXT_DECODER.decode(plan.semantic.bytes);
    expect(text.endsWith("\n")).toBe(true);
    const lines = text.slice(0, -1).split("\n");
    expect(lines).toHaveLength(11);
    expect(lines.map((line) => JSON.parse(line).kind)).toEqual([
      "header",
      "module",
      "module",
      "function",
      "schema",
      "table",
      "index",
      "validator",
      "validator",
      "validator",
      "handler",
    ]);
    expect(JSON.parse(lines[3]!)).toEqual({
      argsValidatorId: "validator:0000000000000001",
      exportName: "place",
      functionKind: "mutation",
      kind: "function",
      modulePath: "orders.js",
      partition: null,
      path: "orders:place",
      returnsValidatorId: "validator:0000000000000002",
      visibility: "public",
    });
    expect(JSON.parse(lines[4]!)).toEqual({
      kind: "schema",
      schemaVersion: "flarex.declarative-materializer/v1",
    });
    expect(JSON.parse(lines[9]!)).toMatchObject({
      id: "validator:0000000000000003",
      kind: "validator",
    });
    expect(plan.semantic.maximumRecordBytes).toBe(
      Math.max(...lines.map((line) => new TextEncoder().encode(`${line}\n`).byteLength)),
    );
  });

  test("detaches source inputs and repeats byte-identically", () => {
    const fixture = graph();
    const first = Result.getOrThrow(materialize(fixture.value));
    fixture.executionBytes.fill(0);
    fixture.functionBytes.fill(0);
    fixture.sourceMapBytes.fill(0);
    expect(TEXT_DECODER.decode(first.source.modules[0]!.sourceBytes)).toBe(
      "export const run = 1;",
    );
    expect(TEXT_DECODER.decode(first.source.modules[1]!.sourceBytes)).toBe(
      "export const place = 1;",
    );
    expect(TEXT_DECODER.decode(
      first.source.modules[1]!.sourceMapBytes!,
    )).toBe("{}");

    const second = success();
    const third = success();
    expect(second.semantic.bytes).toEqual(third.semantic.bytes);
    expect(second.source.modules.map((module) => module.sourceBytes)).toEqual(
      third.source.modules.map((module) => module.sourceBytes),
    );
    expect(second.usage).toEqual(third.usage);
  });

  test.each([
    ["modules", { maximumModules: 1 }],
    ["entryBindings", { maximumEntryBindings: 0 }],
    ["sourceBytes", { maximumSourceBytes: 1 }],
    ["sourceMapBytes", { maximumSourceMapBytes: 1 }],
    ["semanticRecords", { maximumSemanticRecords: 10 }],
    ["semanticRecordBytes", { maximumSemanticRecordBytes: 1 }],
    ["semanticStreamBytes", { maximumSemanticStreamBytes: 1 }],
  ] as const)("reports the exact %s budget dimension", (dimension, overrides) => {
    const result = materialize(graph().value, budget(overrides));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        reason: "budgetExceeded",
        dimension,
      });
    }
  });

  test("reports the exact byte-materialization ceiling", () => {
    const receipt = success().usage;
    const result = materialize(
      graph().value,
      budget({ maximumBytesMaterialized: receipt.bytesMaterialized - 1 }),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        reason: "budgetExceeded",
        dimension: "bytesMaterialized",
      });
    }
  });

  test.each([
    ["unsupported role", () => {
      const fixture = graph().value;
      return {
        ...fixture,
        modules: [
          { ...fixture.modules[0]!, roles: ["function", "schema"] },
          fixture.modules[1]!,
        ],
      };
    }, "unsupportedRole"],
    ["missing logical binding", () => ({
      ...graph().value,
      functionEntries: [],
    }), "missingLogicalBinding"],
    ["missing function role", () => {
      const fixture = graph().value;
      return {
        ...fixture,
        modules: [
          { ...fixture.modules[0]!, roles: ["execution"] },
          { ...fixture.modules[1]!, roles: ["function"] },
        ],
      };
    }, "functionRoleRequired"],
    ["missing execution role", () => ({
      ...graph().value,
      executionPath: "orders.js",
    }), "executionRoleRequired"],
    ["noncanonical artifact path", () => ({
      ...graph().value,
      executionPath: "../execution.js",
    }), "invalidModulePath"],
    ["schema path", () => ({
      ...graph().value,
      schemaPath: "schema.js",
    }), "schemaRoleUnsupported"],
  ] as const)("rejects %s", (_label, makeGraph, reason) => {
    const result = materialize(makeGraph());
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe(reason);
    }
  });

  test.each([
    ["duplicate module paths", () => {
      const fixture = graph().value;
      return {
        ...fixture,
        modules: [
          fixture.modules[0]!,
          { ...fixture.modules[0]! },
          fixture.modules[1]!,
        ],
      };
    }, "duplicateModulePath"],
    ["duplicate logical bindings", () => {
      const fixture = graph().value;
      return {
        ...fixture,
        functionEntries: [
          fixture.functionEntries[0]!,
          {
            logicalModulePath: "orders",
            artifactModulePath: "other.js",
          },
        ],
      };
    }, "duplicateLogicalBinding"],
    ["duplicate artifact bindings", () => {
      const fixture = graph().value;
      return {
        ...fixture,
        functionEntries: [
          fixture.functionEntries[0]!,
          {
            logicalModulePath: "other",
            artifactModulePath: "orders.js",
          },
        ],
      };
    }, "duplicateArtifactBinding"],
    ["unknown logical modules", () => {
      const fixture = graph().value;
      return {
        ...fixture,
        functionEntries: [{
          logicalModulePath: "other",
          artifactModulePath: "orders.js",
        }],
      };
    }, "unknownLogicalModule"],
    ["missing artifact modules", () => {
      const fixture = graph().value;
      return {
        ...fixture,
        functionEntries: [{
          logicalModulePath: "orders",
          artifactModulePath: "missing.js",
        }],
      };
    }, "missingArtifactModule"],
    ["unbound function modules", () => {
      const fixture = graph().value;
      return {
        ...fixture,
        modules: [
          ...fixture.modules,
          {
            path: "orphan.js",
            roles: ["function"],
            sourceBytes: new TextEncoder().encode("export const orphan = 1;"),
            sourceMapBytes: null,
          },
        ],
      };
    }, "unexpectedFunctionModule"],
    ["multiple execution modules", () => {
      const fixture = graph().value;
      return {
        ...fixture,
        modules: [
          ...fixture.modules,
          {
            path: "_flarex/other-execution.js",
            roles: ["execution"],
            sourceBytes: new TextEncoder().encode("export const run = 2;"),
            sourceMapBytes: null,
          },
        ],
      };
    }, "multipleExecutionModules"],
    ["auth paths", () => ({
      ...graph().value,
      authPath: "auth.js",
    }), "authRoleUnsupported"],
  ] as const)("rejects %s explicitly", (_label, makeGraph, reason) => {
    const result = materialize(makeGraph());
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe(reason);
    }
  });

  test("rejects extra fields, accessors, and sparse module arrays", () => {
    expect(Result.isFailure(materialize({
      ...graph().value,
      extra: true,
    }))).toBe(true);

    const accessor = graph().value;
    Object.defineProperty(accessor, "modules", {
      enumerable: true,
      get: () => {
        throw new Error("must not run");
      },
    });
    expect(Result.isFailure(materialize(accessor))).toBe(true);

    const sparse = graph().value;
    const modules = [...sparse.modules];
    delete modules[0];
    expect(Result.isFailure(materialize({ ...sparse, modules }))).toBe(true);
  });

  test("keeps hostile array proxies inside the typed failure channel", () => {
    const fixture = graph().value;
    const lengthTrap = new Proxy(fixture.modules, {
      get: (target, property, receiver) => {
        if (property === "length") throw new Error("length trap");
        return Reflect.get(target, property, receiver);
      },
    });
    const lengthResult = materialize({ ...fixture, modules: lengthTrap });
    expect(Result.isSuccess(lengthResult)).toBe(true);

    const descriptorTrap = new Proxy(fixture.modules, {
      getOwnPropertyDescriptor: () => {
        throw new Error("descriptor trap");
      },
    });
    const descriptorResult = materialize({
      ...fixture,
      modules: descriptorTrap,
    });
    expect(Result.isFailure(descriptorResult)).toBe(true);
    if (Result.isFailure(descriptorResult)) {
      expect(descriptorResult.failure).toMatchObject({
        reason: "invalidInput",
        path: "modules",
      });
    }
  });

  test("rejects shared-backed module bytes before copying", () => {
    const fixture = graph().value;
    const sharedBytes = new Uint8Array(new SharedArrayBuffer(32));
    sharedBytes.set(new TextEncoder().encode("export const shared = 1;"));
    const result = materialize({
      ...fixture,
      modules: [
        { ...fixture.modules[0]!, sourceBytes: sharedBytes },
        fixture.modules[1]!,
      ],
    });
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        reason: "invalidSourceBytes",
        path: "modules[0].sourceBytes",
      });
    }
  });

  test("preserves declared graph-field first-failure order", () => {
    const result = materialize(
      { ...graph().value, schemaPath: "schema.js" },
      budget({ maximumModules: 0 }),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        reason: "budgetExceeded",
        dimension: "modules",
        path: "modules",
      });
    }
  });

  test("rejects malformed or forged budgets", () => {
    expect(Result.isFailure(makeDeclarativeV2MaterializationBudgetV1({
      ...MATERIALIZATION_BUDGET_INPUT,
      maximumModules: -1,
    }))).toBe(true);
    expect(Result.isFailure(makeDeclarativeV2MaterializationBudgetV1({
      ...MATERIALIZATION_BUDGET_INPUT,
      extra: true,
    }))).toBe(true);
    const accepted = budget();
    for (const forged of [
      MATERIALIZATION_BUDGET_INPUT,
      Object.freeze({ ...accepted }),
    ]) {
      const result: unknown = Reflect.apply(
        materializeDeclarativeV2ArtifactsV1,
        undefined,
        [program(), graph().value, forged],
      );
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { reason: "invalidBudget" },
      });
    }
  });
});
