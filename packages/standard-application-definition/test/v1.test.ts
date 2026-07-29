import {
  CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
  CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
  makeCanonicalDeclarativeProgramBudgetV1,
  type CanonicalDeclarativeProgramBudgetInputV1,
  type CanonicalDeclarativeProgramInputV1,
} from "@flarex/declarative-program/v1";
import {
  makeDeclarativeV2MaterializationBudgetV1,
  type DeclarativeV2MaterializationBudgetInputV1,
  type DeclarativeV2MaterializationBudgetV1,
  type DeclarativeV2PrebuiltModuleGraphInputV1,
} from "@flarex/declarative-materializer/v1";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  materializeStandardApplicationArtifactsV1,
  prepareStandardApplicationDefinitionV1,
  prepareStandardApplicationProgramV1,
  type StandardApplicationDefinitionInputV1,
} from "../src/v1";

const UTF8_ENCODER = new TextEncoder();

describe("Standard Application definition V1", () => {
  it("prepares canonical schema, function, source, and semantic outputs", () => {
    const prepared = Result.getOrThrow(
      prepareStandardApplicationDefinitionV1(makeOrdersDefinition()),
    );

    expect(prepared.program.schema.tables.map((table) => table.logicalName))
      .toEqual(["orders"]);
    expect(prepared.program.schema.indexes).toMatchObject([{
      tableLogicalName: "orders",
      descriptor: "by_status",
      fields: ["status"],
    }]);
    expect(prepared.program.modules[0]?.functions[0]).toMatchObject({
      exportName: "place",
      kind: "mutation",
      visibility: "public",
    });
    expect(
      prepared.artifactIngressPlan.source.modules.map((module) => module.path),
    ).toEqual([
      "_flarex/execution.js",
      "orders.js",
    ]);
    expect(prepared.artifactIngressPlan.semantic.recordCount)
      .toBeGreaterThan(0);
  });

  it("preserves canonical-program failures without materializer wrapping", () => {
    const input = makeOrdersDefinition();
    const originalFunction = input.programInput.modules[0]?.functions[0];
    if (originalFunction === undefined) {
      throw new Error("Expected the orders definition to contain one function.");
    }
    const duplicateFunctionInput = {
      ...input,
      programInput: {
        ...input.programInput,
        modules: [{
          modulePath: "orders",
          functions: [
            originalFunction,
            originalFunction,
          ],
        }],
      },
      materializationBudgetInput: {
        ...input.materializationBudgetInput,
        maximumModules: -1,
      },
    } satisfies StandardApplicationDefinitionInputV1;

    expect(resultFailure(
      prepareStandardApplicationDefinitionV1(duplicateFunctionInput),
    )).toMatchObject({
      _tag: "CanonicalDeclarativeProgramV1Error",
      operation: "decodeProgram",
      reason: "duplicateFunctionPath",
      path: "orders:place",
    });
  });

  it("preserves materialization failures after canonical preparation", () => {
    const input = makeOrdersDefinition();
    const missingBindingInput = {
      ...input,
      graphInput: {
        ...input.graphInput,
        functionEntries: [],
      },
    } satisfies StandardApplicationDefinitionInputV1;

    expect(resultFailure(
      prepareStandardApplicationDefinitionV1(missingBindingInput),
    )).toMatchObject({
      _tag: "DeclarativeV2MaterializationV1Error",
      operation: "materialize",
      reason: "missingLogicalBinding",
      path: "orders",
    });
  });

  it("preserves budget creation as the first failure boundary", () => {
    const input = makeOrdersDefinition();
    const invalidBudgets = {
      ...input,
      programBudgetInput: {
        ...input.programBudgetInput,
        maximumModules: -1,
      },
      materializationBudgetInput: {
        ...input.materializationBudgetInput,
        maximumModules: -1,
      },
    } satisfies StandardApplicationDefinitionInputV1;

    expect(resultFailure(
      prepareStandardApplicationDefinitionV1(invalidBudgets),
    )).toMatchObject({
      _tag: "CanonicalDeclarativeProgramV1Error",
      operation: "createBudget",
      reason: "invalidBudget",
    });
  });

  it("returns deterministic outputs from freshly allocated inputs", () => {
    const firstInput = makeOrdersDefinition();
    const secondInput = makeOrdersDefinition();
    const first = Result.getOrThrow(
      prepareStandardApplicationDefinitionV1(firstInput),
    );
    const second = Result.getOrThrow(
      prepareStandardApplicationDefinitionV1(secondInput),
    );

    expect(secondInput).not.toBe(firstInput);
    expect(secondInput.programInput).not.toBe(firstInput.programInput);
    expect(secondInput.graphInput).not.toBe(firstInput.graphInput);
    expect(secondInput.graphInput.modules[0]?.sourceBytes.buffer)
      .not.toBe(firstInput.graphInput.modules[0]?.sourceBytes.buffer);
    expect(second.program).not.toBe(first.program);
    expect(second.artifactIngressPlan)
      .not.toBe(first.artifactIngressPlan);
    expect(second.program).toEqual(first.program);
    expect(second.artifactIngressPlan.semantic.bytes)
      .toEqual(first.artifactIngressPlan.semantic.bytes);
    expect(second.artifactIngressPlan.source.modules.map(
      (module) => module.sourceBytes,
    )).toEqual(first.artifactIngressPlan.source.modules.map(
      (module) => module.sourceBytes,
    ));
  });

  it("exposes the same owner results through the two producer stages", () => {
    const input = makeOrdersDefinition();
    const programBudget = Result.getOrThrow(
      makeCanonicalDeclarativeProgramBudgetV1(input.programBudgetInput),
    );
    const program = Result.getOrThrow(prepareStandardApplicationProgramV1(
      input.programInput,
      programBudget,
    ));
    const materializationBudget = Result.getOrThrow(
      makeDeclarativeV2MaterializationBudgetV1(
        input.materializationBudgetInput,
      ),
    );
    const artifactIngressPlan = Result.getOrThrow(
      materializeStandardApplicationArtifactsV1(
        program,
        input.graphInput,
        materializationBudget,
      ),
    );
    const combined = Result.getOrThrow(
      prepareStandardApplicationDefinitionV1(makeOrdersDefinition()),
    );

    expect(program).toEqual(combined.program);
    expect(artifactIngressPlan).toEqual(combined.artifactIngressPlan);
  });

  it("preserves opaque materialization-budget authentication in the stage API", () => {
    const input = makeOrdersDefinition();
    const programBudget = Result.getOrThrow(
      makeCanonicalDeclarativeProgramBudgetV1(input.programBudgetInput),
    );
    const program = Result.getOrThrow(prepareStandardApplicationProgramV1(
      input.programInput,
      programBudget,
    ));
    const materializationBudget = Result.getOrThrow(
      makeDeclarativeV2MaterializationBudgetV1(
        input.materializationBudgetInput,
      ),
    );
    let budgetRead = false;
    const forgedBudget: DeclarativeV2MaterializationBudgetV1 = Object.create(
      materializationBudget,
      {
        maximumModules: {
          enumerable: true,
          get() {
            budgetRead = true;
            throw new Error("must not read forged budget");
          },
        },
      },
    );

    expect(resultFailure(materializeStandardApplicationArtifactsV1(
      program,
      input.graphInput,
      forgedBudget,
    ))).toMatchObject({
      _tag: "DeclarativeV2MaterializationV1Error",
      operation: "materialize",
      reason: "invalidBudget",
    });
    expect(budgetRead).toBe(false);
  });
});

function makeOrdersDefinition(): StandardApplicationDefinitionInputV1 {
  const programBudgetInput = {
    maximumModules: 2,
    maximumFunctions: 2,
    maximumIdentifierUtf8Bytes: 4_096,
    maximumValidatorNodes: 256,
    maximumValidatorDepth: 32,
    maximumValidatorStringUtf8Bytes: 4_096,
  } satisfies CanonicalDeclarativeProgramBudgetInputV1;
  const programInput = {
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
        argsValidator: { type: "any" },
        returnsValidator: null,
      }],
    }],
  } satisfies CanonicalDeclarativeProgramInputV1;
  const materializationBudgetInput = {
    maximumModules: 2,
    maximumEntryBindings: 1,
    maximumSourceBytes: 2_048,
    maximumSourceMapBytes: 1_024,
    maximumBytesMaterialized: 32_000,
    maximumSemanticRecords: 32,
    maximumSemanticRecordBytes: 8_000,
    maximumSemanticStreamBytes: 16_000,
  } satisfies DeclarativeV2MaterializationBudgetInputV1;
  const graphInput = {
    modules: [
      {
        path: "orders.js",
        roles: ["function"],
        sourceBytes: UTF8_ENCODER.encode("export const place = 1;\n"),
        sourceMapBytes: UTF8_ENCODER.encode("{\"version\":3}\n"),
      },
      {
        path: "_flarex/execution.js",
        roles: ["execution"],
        sourceBytes: UTF8_ENCODER.encode("export const run = 1;\n"),
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
  } satisfies DeclarativeV2PrebuiltModuleGraphInputV1;

  return {
    programBudgetInput,
    programInput,
    materializationBudgetInput,
    graphInput,
  };
}

function resultFailure<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Failure {
  return Result.match(result, {
    onFailure: (failure) => failure,
    onSuccess: () => {
      throw new Error("Expected Standard Application preparation to fail.");
    },
  });
}
