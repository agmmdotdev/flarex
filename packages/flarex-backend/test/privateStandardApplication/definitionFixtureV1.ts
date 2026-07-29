import {
  CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
  CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
  type CanonicalDeclarativeProgramBudgetInputV1,
  type CanonicalDeclarativeProgramInputV1,
} from "@flarex/declarative-program/v1";
import type {
  DeclarativeV2MaterializationBudgetInputV1,
  DeclarativeV2PrebuiltModuleGraphInputV1,
} from "@flarex/declarative-materializer/v1";

const UTF8_ENCODER = new TextEncoder();

export interface PrivateStandardApplicationDefinitionFixtureV1 {
  readonly programBudgetInput: CanonicalDeclarativeProgramBudgetInputV1;
  readonly programInput: CanonicalDeclarativeProgramInputV1;
  readonly materializationBudgetInput:
    DeclarativeV2MaterializationBudgetInputV1;
  readonly graphInput: DeclarativeV2PrebuiltModuleGraphInputV1;
}

export function makeOrdersPrivateStandardApplicationDefinitionFixtureV1(
  ordersSource = "export const place = 1;\n",
): PrivateStandardApplicationDefinitionFixtureV1 {
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
        sourceBytes: UTF8_ENCODER.encode(ordersSource),
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
