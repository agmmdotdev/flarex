import { Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
  CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
  canonicalDeclarativeFunctionPathV1,
  decodeCanonicalDeclarativeProgramV1,
  makeCanonicalDeclarativeProgramBudgetV1,
  makeCanonicalDeclarativeProgramFixtureV1,
  type CanonicalDeclarativeModulePathV1,
  type CanonicalDeclarativeProgramBudgetV1,
  type CanonicalDeclarativeProgramBudgetInputV1,
  type CanonicalDeclarativeProgramInputV1,
  type CanonicalDeclarativeProgramV1,
  type CanonicalDeclarativeProgramV1ErrorReason,
} from "../src/v1";

const STANDARD_BUDGET_INPUT = {
  maximumModules: 8,
  maximumFunctions: 16,
  maximumIdentifierUtf8Bytes: 4_096,
  maximumValidatorNodes: 256,
  maximumValidatorDepth: 32,
  maximumValidatorStringUtf8Bytes: 4_096,
} satisfies CanonicalDeclarativeProgramBudgetInputV1;

const STANDARD_BUDGET = budget();

type MutableDeep<T> =
  T extends ReadonlyArray<infer Item> ? MutableDeep<Item>[] :
  T extends object ? { -readonly [Key in keyof T]: MutableDeep<T[Key]> } :
  T;

function inputProgram(): MutableDeep<CanonicalDeclarativeProgramInputV1> {
  return {
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
                fieldType: {
                  type: "union",
                  value: [
                    { type: "literal", value: "open" },
                    { type: "literal", value: "closed" },
                  ],
                },
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
    modules: [
      {
        modulePath: "z",
        functions: [],
      },
      {
        modulePath: "orders",
        functions: [
          {
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
          },
          {
            exportName: "default",
            kind: "query",
            visibility: "internal",
            argsValidator: { type: "any" },
            returnsValidator: null,
          },
        ],
      },
    ],
  };
}

function decode(
  input: unknown = inputProgram(),
): CanonicalDeclarativeProgramV1 {
  return Result.getOrThrow(
    decodeCanonicalDeclarativeProgramV1(input, STANDARD_BUDGET),
  );
}

describe("@flarex/declarative-program/v1", () => {
  it("keeps decoded programs nominal", () => {
    expectTypeOf<CanonicalDeclarativeProgramInputV1>()
      .not.toMatchTypeOf<CanonicalDeclarativeProgramV1>();
    expectTypeOf<CanonicalDeclarativeProgramBudgetInputV1>()
      .not.toMatchTypeOf<CanonicalDeclarativeProgramBudgetV1>();
  });

  it("normalizes order and derives function paths once", () => {
    const program = decode();

    expect(program.modules.map((module) => module.modulePath)).toEqual([
      "orders",
      "z",
    ]);
    expect(program.modules[0]?.functions.map((fn) => fn.exportName)).toEqual([
      "default",
      "place",
    ]);
    const module = program.modules[0];
    const first = module?.functions[0];
    const second = module?.functions[1];
    if (module === undefined || first === undefined || second === undefined) {
      throw new Error("Expected normalized functions.");
    }
    expect(canonicalDeclarativeFunctionPathV1(
      module.modulePath,
      first.exportName,
    )).toBe("orders");
    expect(canonicalDeclarativeFunctionPathV1(
      module.modulePath,
      second.exportName,
    )).toBe("orders:place");
  });

  it("establishes detached, recursively frozen ownership", () => {
    const input = inputProgram();
    const program = decode(input);
    const table = input.schema.tables[0];
    const index = input.schema.indexes[0];
    const module = input.modules[1];
    if (table === undefined || index === undefined || module === undefined) {
      throw new Error("Expected mutable input members.");
    }

    table.definition.documentType.value.status = {
      fieldType: { type: "number" },
      optional: true,
    };
    index.fields[0] = "changed";
    module.functions.length = 0;

    expect(program.schema.tables[0]?.definition.documentType).toMatchObject({
      value: {
        status: {
          fieldType: {
            type: "union",
            value: [
              { type: "literal", value: "open" },
              { type: "literal", value: "closed" },
            ],
          },
          optional: false,
        },
      },
    });
    expect(program.schema.indexes[0]?.fields).toEqual(["status"]);
    expect(program.modules[0]?.functions).toHaveLength(2);
    expect(Object.isFrozen(program)).toBe(true);
    expect(Object.isFrozen(program.schema)).toBe(true);
    expect(Object.isFrozen(program.schema.tables)).toBe(true);
    expect(Object.isFrozen(
      program.schema.tables[0]?.definition.documentType,
    )).toBe(true);
    expect(Object.isFrozen(program.modules[0]?.functions)).toBe(true);
  });

  it("uses the same decoder for direct fixtures", () => {
    const decoded = decode();
    const fixture = Result.getOrThrow(
      makeCanonicalDeclarativeProgramFixtureV1(
        inputProgram(),
        STANDARD_BUDGET,
      ),
    );

    expect(fixture).toEqual(decoded);
    expect(decode()).toEqual(decoded);
    expect(decode()).not.toBe(decoded);
  });

  it("rejects unknown fields, accessors, and sparse arrays without invoking getters", () => {
    const unknownField = {
      ...inputProgram(),
      extra: true,
    };
    expectFailureReason(unknownField, "invalidInput");

    let invoked = false;
    const accessor = inputProgram();
    Object.defineProperty(accessor, "modules", {
      enumerable: true,
      get() {
        invoked = true;
        return [];
      },
    });
    expectFailureReason(accessor, "invalidInput");
    expect(invoked).toBe(false);

    const sparse = inputProgram();
    const sparseModules = new Array<unknown>(2);
    sparseModules[1] = sparse.modules[0];
    Object.defineProperty(sparse, "modules", {
      enumerable: true,
      value: sparseModules,
    });
    expectFailureReason(sparse, "invalidInput");
  });

  it("rejects duplicate module and derived function paths", () => {
    const duplicateModule = inputProgram();
    duplicateModule.modules.push({
      modulePath: "orders",
      functions: [],
    });
    duplicateModule.modules.push({
      modulePath: "bad:module",
      functions: [],
    });
    expectFailureDetails(duplicateModule, {
      reason: "duplicateModulePath",
      path: "orders",
    });

    const duplicateFunction = inputProgram();
    const orders = duplicateFunction.modules[1];
    if (orders === undefined) throw new Error("Expected orders module.");
    orders.functions.push({
      exportName: "place",
      kind: "mutation",
      visibility: "public",
      argsValidator: { type: "any" },
      returnsValidator: null,
    });
    orders.functions.push({
      exportName: "bad:name",
      kind: "mutation",
      visibility: "public",
      argsValidator: { type: "any" },
      returnsValidator: null,
    });
    expectFailureDetails(duplicateFunction, {
      reason: "duplicateFunctionPath",
      path: "orders:place",
    });
  });

  it("rejects duplicate table and table-index identities", () => {
    const duplicateTable = inputProgram();
    const table = duplicateTable.schema.tables[0];
    if (table === undefined) throw new Error("Expected table.");
    duplicateTable.schema.tables.push(table);
    duplicateTable.schema.tables.push({
      ...table,
      logicalName: "",
    });
    expectFailureDetails(duplicateTable, {
      reason: "invalidSchema",
      path: "schema.tables[1].logicalName",
    });

    const duplicateIndex = inputProgram();
    const index = duplicateIndex.schema.indexes[0];
    if (index === undefined) throw new Error("Expected index.");
    duplicateIndex.schema.indexes.push(index);
    duplicateIndex.schema.indexes.push({
      ...index,
      descriptor: "",
    });
    expectFailureDetails(duplicateIndex, {
      reason: "invalidSchema",
      path: "schema.indexes[1].descriptor",
    });

    const duplicateFields = inputProgram();
    duplicateFields.schema.indexes.push({
      tableLogicalName: "orders",
      descriptor: "by_status_again",
      fields: ["status"],
    });
    duplicateFields.schema.indexes.push({
      tableLogicalName: "orders",
      descriptor: "",
      fields: ["later"],
    });
    expectFailureDetails(duplicateFields, {
      reason: "invalidSchema",
      path: "schema.indexes[1].fields",
    });
  });

  it("enforces the per-table index ceiling before later members", () => {
    const input = inputProgram();
    input.schema.indexes.length = 0;
    for (let index = 0; index < 65; index += 1) {
      input.schema.indexes.push({
        tableLogicalName: "orders",
        descriptor: `by_${index}`,
        fields: [`field${index}`],
      });
    }
    input.schema.indexes.push({
      tableLogicalName: "orders",
      descriptor: "",
      fields: ["later"],
    });

    expectFailureDetails(input, {
      reason: "invalidSchema",
      path: "schema.indexes[64]",
    });
  });

  it("rejects invalid paths, malformed validators, and missing index tables", () => {
    const invalidPath = inputProgram();
    const orders = invalidPath.modules[1];
    if (orders === undefined) throw new Error("Expected orders module.");
    orders.modulePath = "bad:module";
    expectFailureReason(invalidPath, "invalidModulePath");

    const invalidValidator = inputProgram();
    const fn = invalidValidator.modules[1]?.functions[0];
    if (fn === undefined) throw new Error("Expected mutation.");
    fn.argsValidator = { type: "string" };
    expectFailureReason(invalidValidator, "invalidValidator");

    const missingTable = inputProgram();
    const declaration = missingTable.schema.indexes[0];
    if (declaration === undefined) throw new Error("Expected index.");
    declaration.tableLogicalName = "missing";
    missingTable.schema.indexes.push({
      ...declaration,
      descriptor: "",
    });
    expectFailureDetails(missingTable, {
      reason: "unknownIndexTable",
      path: "schema.indexes[0].tableLogicalName",
    });
  });

  it("rejects non-JSON-safe numeric literals", () => {
    for (
      const value of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        -0,
      ]
    ) {
      const input = inputProgram();
      const fn = input.modules[1]?.functions[0];
      if (fn === undefined) throw new Error("Expected mutation.");
      fn.returnsValidator = { type: "literal", value };
      expectFailureReason(input, "invalidValidator");
    }

    const finiteEdge = inputProgram();
    const finiteFn = finiteEdge.modules[1]?.functions[0];
    if (finiteFn === undefined) throw new Error("Expected mutation.");
    finiteFn.returnsValidator = {
      type: "literal",
      value: Number.MAX_VALUE,
    };
    expect(decode(finiteEdge).modules[0]?.functions[1]?.returnsValidator)
      .toEqual({ type: "literal", value: Number.MAX_VALUE });
  });

  it("admits a bounded linear validator without subtree revalidation", () => {
    let validator: unknown = { type: "string" };
    for (let depth = 0; depth < 64; depth += 1) {
      validator = { type: "array", value: validator };
    }
    const input = inputProgram();
    const fn = input.modules[1]?.functions[0];
    if (fn === undefined) throw new Error("Expected mutation.");
    fn.returnsValidator = validator;

    const decoded = Result.getOrThrow(
      decodeCanonicalDeclarativeProgramV1(input, budget({
        maximumValidatorDepth: 65,
      })),
    );
    expect(decoded.modules[0]?.functions[1]?.returnsValidator).toMatchObject({
      type: "array",
    });
  });

  it("rejects forged budgets and every bounded dimension", () => {
    const forgedBudgetResult: ReturnType<
      typeof decodeCanonicalDeclarativeProgramV1
    > = Reflect.apply(
      decodeCanonicalDeclarativeProgramV1,
      undefined,
      [inputProgram(), STANDARD_BUDGET_INPUT],
    );
    expect(Result.isFailure(forgedBudgetResult)).toBe(true);
    if (Result.isFailure(forgedBudgetResult)) {
      expect(forgedBudgetResult.failure.reason).toBe("invalidBudget");
    }
    expect(Result.isFailure(makeCanonicalDeclarativeProgramBudgetV1({
      ...STANDARD_BUDGET_INPUT,
      maximumValidatorDepth: 0,
    }))).toBe(true);
    expect(Result.isFailure(makeCanonicalDeclarativeProgramBudgetV1({
      ...STANDARD_BUDGET_INPUT,
      maximumValidatorDepth: 129,
    }))).toBe(true);

    expectBudgetDimension({ maximumModules: 1 }, "modules");
    expectBudgetDimension({ maximumFunctions: 1 }, "functions");
    expectBudgetDimension(
      { maximumIdentifierUtf8Bytes: 1 },
      "identifierUtf8Bytes",
    );
    expectBudgetDimension({ maximumValidatorNodes: 1 }, "validatorNodes");
    expectBudgetDimension({ maximumValidatorDepth: 1 }, "validatorDepth");
    expectBudgetDimension(
      { maximumValidatorStringUtf8Bytes: 1 },
      "validatorStringUtf8Bytes",
    );
  });

  it("accepts branded module paths only after decoding", () => {
    const modulePath = decode().modules[0]?.modulePath;
    if (modulePath === undefined) throw new Error("Expected module path.");
    expectTypeOf(modulePath).toMatchTypeOf<CanonicalDeclarativeModulePathV1>();
    expectTypeOf<string>().not.toMatchTypeOf<CanonicalDeclarativeModulePathV1>();
  });
});

function budget(
  overrides: Partial<CanonicalDeclarativeProgramBudgetInputV1> = {},
) {
  return Result.getOrThrow(makeCanonicalDeclarativeProgramBudgetV1({
    ...STANDARD_BUDGET_INPUT,
    ...overrides,
  }));
}

function expectBudgetDimension(
  overrides: Partial<CanonicalDeclarativeProgramBudgetInputV1>,
  dimension:
    | "modules"
    | "functions"
    | "identifierUtf8Bytes"
    | "validatorNodes"
    | "validatorDepth"
    | "validatorStringUtf8Bytes",
): void {
  const result = decodeCanonicalDeclarativeProgramV1(
    inputProgram(),
    budget(overrides),
  );
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure).toMatchObject({
      reason: "budgetExceeded",
      dimension,
    });
  }
}

function expectFailureReason(
  input: unknown,
  reason: CanonicalDeclarativeProgramV1ErrorReason,
  budget: CanonicalDeclarativeProgramBudgetV1 = STANDARD_BUDGET,
): void {
  const result = decodeCanonicalDeclarativeProgramV1(input, budget);
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure.reason).toBe(reason);
  }
}

function expectFailureDetails(
  input: unknown,
  expected: {
    readonly reason: CanonicalDeclarativeProgramV1ErrorReason;
    readonly path: string;
  },
): void {
  const result = decodeCanonicalDeclarativeProgramV1(input, STANDARD_BUDGET);
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure).toMatchObject(expected);
  }
}
