import { analyzeCanonicalDeclarativeProgramV1 } from "@flarex/analysis/internal/canonical-declarative-program-v1";
import {
  CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
  decodeCanonicalDeclarativeProgramV1,
  makeCanonicalDeclarativeProgramBudgetV1,
} from "@flarex/declarative-program/v1";
import { Effect, Result } from "effect";
import {
  defineGlobalTable,
  definePartitionTable,
  defineProjection,
  defineSchema,
  mutation,
} from "flarex/server";
import { v } from "flarex/values";
import { describe, expect, it } from "vitest";
import { canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect } from "../src/declarativeProgramV1.ts";

const BUDGET = Result.getOrThrow(makeCanonicalDeclarativeProgramBudgetV1({
  maximumModules: 4,
  maximumFunctions: 8,
  maximumIdentifierUtf8Bytes: 4_096,
  maximumValidatorNodes: 128,
  maximumValidatorDepth: 16,
  maximumValidatorStringUtf8Bytes: 4_096,
}));

const IDENTIFIER_BUDGET = Result.getOrThrow(
  makeCanonicalDeclarativeProgramBudgetV1({
    maximumModules: 4,
    maximumFunctions: 8,
    maximumIdentifierUtf8Bytes: 1,
    maximumValidatorNodes: 128,
    maximumValidatorDepth: 16,
    maximumValidatorStringUtf8Bytes: 4_096,
  }),
);

const VALIDATOR_NODE_BUDGET = Result.getOrThrow(
  makeCanonicalDeclarativeProgramBudgetV1({
    maximumModules: 4,
    maximumFunctions: 8,
    maximumIdentifierUtf8Bytes: 4_096,
    maximumValidatorNodes: 1,
    maximumValidatorDepth: 16,
    maximumValidatorStringUtf8Bytes: 4_096,
  }),
);

const placeOrder = mutation({
  args: { status: v.string() },
  returns: v.null(),
  handler: async () => null,
});

const sdkSchema = defineSchema({
  orders: defineGlobalTable({
    status: v.string(),
  }).index("by_status", ["status"]),
});

function malformedSdkLiteral(value: unknown) {
  return {
    isFlarexValidator: true,
    isOptional: "required",
    json: { type: "literal", value },
  };
}

function schemaWithMalformedSdkLiteral() {
  const table = defineGlobalTable({ status: v.string() });
  const schema = defineSchema({ orders: table });
  Object.defineProperty(table, "validator", {
    value: {
      isFlarexValidator: true,
      json: {
        type: "object",
        value: {
          status: {
            fieldType: { type: "literal", value: Number.NaN },
            optional: false,
          },
        },
      },
    },
  });
  return schema;
}

function directProgramInput() {
  return {
    format: CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
    version: 1 as const,
    schema: {
      tables: [{
        logicalName: "orders",
        definition: {
          kind: "appDocument" as const,
          definitionVersion: 1 as const,
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
        kind: "mutation" as const,
        visibility: "public" as const,
        argsValidator: {
          type: "object",
          value: {
            status: {
              fieldType: { type: "string" },
              optional: false,
            },
          },
        },
        returnsValidator: { type: "null" },
      }],
    }],
  };
}

describe("canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect", () => {
  it("matches the direct fixture and canonical analyzer result", async () => {
    const fromSdk = await Effect.runPromise(
      canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect({
        schemaDefinition: sdkSchema,
        executionModules: {
          orders: { place: placeOrder },
        },
      }, BUDGET),
    );
    const fromFixture = Result.getOrThrow(
      decodeCanonicalDeclarativeProgramV1(directProgramInput(), BUDGET),
    );

    expect(fromSdk).toEqual(fromFixture);
    expect(fromSdk.schema).toEqual(sdkSchema.applicationSchemaDefinition);
    expect(analyzeCanonicalDeclarativeProgramV1(fromSdk)).toEqual(
      analyzeCanonicalDeclarativeProgramV1(fromFixture),
    );
  });

  it("keeps post-schema index chaining aligned with canonical analysis", async () => {
    const orders = defineGlobalTable({ status: v.string() });
    const schema = defineSchema({ orders });
    orders.index("by_status", ["status"]);

    const program = await Effect.runPromise(
      canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect({
        schemaDefinition: schema,
        executionModules: {
          orders: { place: placeOrder },
        },
      }, BUDGET),
    );

    expect(program.schema).toEqual(schema.applicationSchemaDefinition);
    expect(program.schema.indexes).toEqual([{
      tableLogicalName: "orders",
      descriptor: "by_status",
      fields: ["status"],
    }]);
  });

  it("preserves the SDK omitted-return compatibility marker as canonical null", async () => {
    const withoutReturnValidator = mutation({
      args: { status: v.string() },
      handler: async () => null,
    });

    const program = await Effect.runPromise(
      canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect({
        schemaDefinition: sdkSchema,
        executionModules: {
          orders: { withoutReturnValidator },
        },
      }, BUDGET),
    );

    expect(program.modules).toEqual([{
      modulePath: "orders",
      functions: [{
        exportName: "withoutReturnValidator",
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
        returnsValidator: null,
      }],
    }]);
  });

  it("rejects partitioned SDK tables in the opt-in slice", async () => {
    const schemaDefinition = defineSchema({
      orders: definePartitionTable({ status: v.string() }),
    });

    await expect(Effect.runPromise(
      canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect({
        schemaDefinition,
        executionModules: {},
      }, BUDGET),
    )).rejects.toMatchObject({
      _tag: "CanonicalDeclarativeProgramV1SdkAdapterError",
      reason: "unsupportedTablePlacement",
      path: "schema.tables.orders.placement",
    });
  });

  it("rejects table policy before invoking function exporters", async () => {
    let exporterInvoked = false;
    const functionWithThrowingExporter = Object.assign(mutation({
      args: { status: v.string() },
      handler: async () => null,
    }), {
      exportArgs: () => {
        exporterInvoked = true;
        throw new Error("must not run");
      },
    });

    await expect(Effect.runPromise(
      canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect({
        schemaDefinition: defineSchema({
          orders: definePartitionTable({ status: v.string() }),
        }),
        executionModules: {
          orders: { place: functionWithThrowingExporter },
        },
      }, BUDGET),
    )).rejects.toMatchObject({
      _tag: "CanonicalDeclarativeProgramV1SdkAdapterError",
      reason: "unsupportedTablePlacement",
    });
    expect(exporterInvoked).toBe(false);
  });

  it("rejects partitioned SDK functions in the opt-in slice", async () => {
    const partitioned = Object.assign(mutation({
      args: { status: v.string() },
      handler: async () => null,
    }), {
      exportPartition: () => JSON.stringify({
        type: "partitionRoot",
        table: "orders",
        partitionField: "_id",
      }),
    });

    await expect(Effect.runPromise(
      canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect({
        schemaDefinition: sdkSchema,
        executionModules: {
          orders: { place: partitioned },
        },
      }, BUDGET),
    )).rejects.toMatchObject({
      _tag: "CanonicalDeclarativeProgramV1SdkAdapterError",
      reason: "unsupportedFunctionPartition",
      path: "modules.orders.functions.place.partition",
    });
  });

  it("rejects malformed schema metadata before inspecting function partitions", async () => {
    const partitioned = Object.assign(mutation({
      args: { status: v.string() },
      handler: async () => null,
    }), {
      exportPartition: () => JSON.stringify({
        type: "partitionRoot",
        table: "orders",
        partitionField: "_id",
      }),
    });
    const schemaWithNonCanonicalLiteral = schemaWithMalformedSdkLiteral();

    await expect(Effect.runPromise(
      canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect({
        schemaDefinition: schemaWithNonCanonicalLiteral,
        executionModules: {
          orders: { partitioned },
        },
      }, BUDGET),
    )).rejects.toMatchObject({ _tag: "AnalyzerValidatorError" });
  });

  it("rejects malformed SDK schema metadata at the protocol decoder boundary", async () => {
    const schemaWithNonCanonicalLiteral = schemaWithMalformedSdkLiteral();

    await expect(Effect.runPromise(
      canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect({
        schemaDefinition: schemaWithNonCanonicalLiteral,
        executionModules: {},
      }, BUDGET),
    )).rejects.toMatchObject({ _tag: "AnalyzerValidatorError" });
  });

  it("rejects malformed schema metadata before canonical budget evaluation", async () => {
    const schemaWithNonCanonicalLiteral = schemaWithMalformedSdkLiteral();

    await expect(Effect.runPromise(
      canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect({
        schemaDefinition: schemaWithNonCanonicalLiteral,
        executionModules: {},
      }, IDENTIFIER_BUDGET),
    )).rejects.toMatchObject({ _tag: "AnalyzerValidatorError" });
  });

  it("rejects over-budget validators before Standard ownership lowering", async () => {
    const schemaWithNestedValidator = defineSchema({
      orders: defineGlobalTable({ status: v.string() }),
    });

    await expect(Effect.runPromise(
      canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect({
        schemaDefinition: schemaWithNestedValidator,
        executionModules: {},
      }, VALIDATOR_NODE_BUDGET),
    )).rejects.toMatchObject({
      _tag: "CanonicalDeclarativeProgramV1Error",
      reason: "budgetExceeded",
      dimension: "validatorNodes",
      path: "schema.tables[0].definition.documentType.value.status.fieldType",
    });
  });

  it("rejects unsupported schema members", async () => {
    await expect(Effect.runPromise(
      canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect({
        schemaDefinition: defineSchema({
          combined: defineProjection({ sources: ["orders"] }),
        }),
        executionModules: {},
      }, BUDGET),
    )).rejects.toMatchObject({
      _tag: "CanonicalDeclarativeProgramV1SdkAdapterError",
      reason: "unsupportedSchemaMember",
      path: "schema.tables.combined",
    });
  });

  it("maps SDK schema inspection exceptions at the adapter boundary", async () => {
    const nativeFailure = new Error("schema getter failed");
    const schemaDefinition = Object.defineProperty({}, "tables", {
      enumerable: true,
      get() {
        throw nativeFailure;
      },
    });

    await expect(Effect.runPromise(
      canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect({
        schemaDefinition,
        executionModules: {},
      }, BUDGET),
    )).rejects.toMatchObject({
      _tag: "CanonicalDeclarativeProgramV1SdkAdapterError",
      reason: "sdkInspectionFailed",
      path: "schema.tables",
      cause: nativeFailure,
    });
  });

  it("maps nested SDK schema accessors at the adapter boundary", async () => {
    const member = Object.defineProperty({}, "kind", {
      enumerable: true,
      get() {
        throw new Error("member getter failed");
      },
    });

    await expect(Effect.runPromise(
      canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect({
        schemaDefinition: {
          tables: { orders: member },
        },
        executionModules: {},
      }, BUDGET),
    )).rejects.toMatchObject({
      _tag: "CanonicalDeclarativeProgramV1SdkAdapterError",
      reason: "sdkInspectionFailed",
      path: "schema.tables",
    });
  });

  it("maps a later stateful schema getter failure through the analyzer", async () => {
    const nativeFailure = new Error("second schema read failed");
    let reads = 0;
    const schemaDefinition = Object.defineProperty({}, "tables", {
      enumerable: true,
      get() {
        reads += 1;
        if (reads === 1) return sdkSchema.tables;
        throw nativeFailure;
      },
    });

    await expect(Effect.runPromise(
      canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect({
        schemaDefinition,
        executionModules: {},
      }, BUDGET),
    )).rejects.toMatchObject({
      _tag: "AnalyzerSchemaError",
      cause: nativeFailure,
    });
  });

  it("rejects non-finite SDK validator literals", async () => {
    const nonFiniteReturn = mutation({
      args: {},
      // @ts-expect-error Deliberately forge malformed legacy SDK metadata.
      returns: malformedSdkLiteral(Number.NaN),
      handler: async () => Number.NaN,
    });

    await expect(Effect.runPromise(
      canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect({
        schemaDefinition: sdkSchema,
        executionModules: {
          orders: { nonFiniteReturn },
        },
      }, BUDGET),
    )).rejects.toMatchObject({
      _tag: "AnalyzerValidatorError",
    });
  });

  it("rejects SDK-only bigint literal semantics instead of widening Standard V1", async () => {
    const bigintLiteralReturn = mutation({
      args: {},
      // @ts-expect-error Deliberately forge malformed legacy SDK metadata.
      returns: malformedSdkLiteral(1n),
      handler: (): 1n => 1n,
    });

    await expect(Effect.runPromise(
      canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect({
        schemaDefinition: sdkSchema,
        executionModules: {
          orders: { bigintLiteralReturn },
        },
      }, BUDGET),
    )).rejects.toMatchObject({
      _tag: "AnalyzerValidatorError",
    });
  });
});
