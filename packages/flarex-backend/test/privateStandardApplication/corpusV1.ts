import {
  CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
  CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
  type CanonicalDeclarativeProgramInputV1,
  type CanonicalDeclarativeProgramV1Error,
} from "@flarex/declarative-program/v1";
import type {
  DeclarativeV2MaterializationV1Error,
} from "@flarex/declarative-materializer/v1";

import {
  makeOrdersPrivateStandardApplicationDefinitionFixtureV1,
  type PrivateStandardApplicationDefinitionFixtureV1,
} from "./definitionFixtureV1";

const UTF8_ENCODER = new TextEncoder();

export const PRIVATE_STANDARD_APPLICATION_CORPUS_VERSION_V1 = 1 as const;

export const PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1 = Object.freeze({
  validOrdersPointMutation: "valid.orders-point-mutation",
  validMultiModuleFunctionMetadata:
    "valid.multi-module-function-metadata",
  canonicalDuplicateFunctionPath:
    "canonical.duplicate-function-path",
  canonicalUnknownIndexTable:
    "canonical.unknown-index-table",
  canonicalInvalidArgumentsValidator:
    "canonical.invalid-arguments-validator",
  canonicalFunctionBudgetExceeded:
    "canonical.function-budget-exceeded",
  materializationMissingLogicalBinding:
    "materialization.missing-logical-binding",
  materializationDuplicateArtifactBinding:
    "materialization.duplicate-artifact-binding",
  materializationExecutionRoleRequired:
    "materialization.execution-role-required",
  materializationSourceBudgetExceeded:
    "materialization.source-budget-exceeded",
  materializationSchemaRoleUnsupported:
    "materialization.schema-role-unsupported",
} as const);

export type PrivateStandardApplicationCorpusCaseIdV1 =
  typeof PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1[
    keyof typeof PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
  ];

export type PrivateStandardApplicationValidCaseIdV1 =
  | typeof PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .validOrdersPointMutation
  | typeof PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .validMultiModuleFunctionMetadata;

export type PrivateStandardApplicationCanonicalFailureCaseIdV1 =
  | typeof PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .canonicalDuplicateFunctionPath
  | typeof PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .canonicalUnknownIndexTable
  | typeof PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .canonicalInvalidArgumentsValidator
  | typeof PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .canonicalFunctionBudgetExceeded;

export type PrivateStandardApplicationMaterializationFailureCaseIdV1 =
  | typeof PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .materializationMissingLogicalBinding
  | typeof PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .materializationDuplicateArtifactBinding
  | typeof PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .materializationExecutionRoleRequired
  | typeof PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .materializationSourceBudgetExceeded
  | typeof PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .materializationSchemaRoleUnsupported;

const CORPUS_CASE_ID_ORDER_V1 = Object.freeze([
  PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .validOrdersPointMutation,
  PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .validMultiModuleFunctionMetadata,
  PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .canonicalDuplicateFunctionPath,
  PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .canonicalUnknownIndexTable,
  PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .canonicalInvalidArgumentsValidator,
  PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .canonicalFunctionBudgetExceeded,
  PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .materializationMissingLogicalBinding,
  PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .materializationDuplicateArtifactBinding,
  PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .materializationExecutionRoleRequired,
  PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .materializationSourceBudgetExceeded,
  PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
    .materializationSchemaRoleUnsupported,
] as const satisfies ReadonlyArray<
  PrivateStandardApplicationCorpusCaseIdV1
>);

export interface PrivateStandardApplicationValidFactsV1 {
  readonly logicalModulePaths: ReadonlyArray<string>;
  readonly functionPaths: ReadonlyArray<string>;
  readonly tableNames: ReadonlyArray<string>;
  readonly indexNames: ReadonlyArray<string>;
  readonly artifactModulePaths: ReadonlyArray<string>;
}

export type PrivateStandardApplicationCanonicalFailureV1 = Readonly<
  Pick<
    CanonicalDeclarativeProgramV1Error,
    | "_tag"
    | "operation"
    | "reason"
    | "path"
    | "dimension"
    | "observed"
    | "maximum"
  >
>;

export type PrivateStandardApplicationMaterializationFailureV1 = Readonly<
  Pick<
    DeclarativeV2MaterializationV1Error,
    | "_tag"
    | "operation"
    | "reason"
    | "path"
    | "dimension"
    | "observed"
    | "maximum"
  >
>;

export type PrivateStandardApplicationCorpusCaseV1 =
  | Readonly<{
      readonly kind: "valid";
      readonly id: PrivateStandardApplicationValidCaseIdV1;
      readonly fixture: PrivateStandardApplicationDefinitionFixtureV1;
      readonly expected: PrivateStandardApplicationValidFactsV1;
    }>
  | Readonly<{
      readonly kind: "canonicalFailure";
      readonly id:
        PrivateStandardApplicationCanonicalFailureCaseIdV1;
      readonly fixture: PrivateStandardApplicationDefinitionFixtureV1;
      readonly expected: PrivateStandardApplicationCanonicalFailureV1;
    }>
  | Readonly<{
      readonly kind: "materializationFailure";
      readonly id:
        PrivateStandardApplicationMaterializationFailureCaseIdV1;
      readonly fixture: PrivateStandardApplicationDefinitionFixtureV1;
      readonly expected: PrivateStandardApplicationMaterializationFailureV1;
    }>;

export interface PrivateStandardApplicationCorpusSelectionInputV1 {
  readonly seed: number;
  readonly maximumCases: number;
}

export interface PrivateStandardApplicationCorpusReplayV1 {
  readonly corpusVersion:
    typeof PRIVATE_STANDARD_APPLICATION_CORPUS_VERSION_V1;
  readonly seed: number;
  readonly caseIds: ReadonlyArray<
    PrivateStandardApplicationCorpusCaseIdV1
  >;
}

export function listPrivateStandardApplicationCorpusCaseIdsV1():
  ReadonlyArray<PrivateStandardApplicationCorpusCaseIdV1>
{
  return [...CORPUS_CASE_ID_ORDER_V1];
}

export function selectPrivateStandardApplicationCorpusV1(
  input: PrivateStandardApplicationCorpusSelectionInputV1,
): PrivateStandardApplicationCorpusReplayV1 {
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) {
    throw new RangeError(
      "Private standard application corpus seed must be a non-negative safe integer.",
    );
  }
  if (
    !Number.isSafeInteger(input.maximumCases) ||
    input.maximumCases < 0
  ) {
    throw new RangeError(
      "Private standard application corpus maximumCases must be a non-negative safe integer.",
    );
  }

  const caseCount = Math.min(
    input.maximumCases,
    CORPUS_CASE_ID_ORDER_V1.length,
  );
  const start = input.seed % CORPUS_CASE_ID_ORDER_V1.length;
  const caseIds: PrivateStandardApplicationCorpusCaseIdV1[] = [];
  for (let offset = 0; offset < caseCount; offset += 1) {
    const caseId = CORPUS_CASE_ID_ORDER_V1[
      (start + offset) % CORPUS_CASE_ID_ORDER_V1.length
    ];
    if (caseId === undefined) {
      throw new Error("Private standard application corpus order is invalid.");
    }
    caseIds.push(caseId);
  }

  return {
    corpusVersion: PRIVATE_STANDARD_APPLICATION_CORPUS_VERSION_V1,
    seed: input.seed,
    caseIds,
  };
}

export function makePrivateStandardApplicationCorpusCaseV1(
  id: PrivateStandardApplicationCorpusCaseIdV1,
): PrivateStandardApplicationCorpusCaseV1 {
  switch (id) {
    case PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
      .validOrdersPointMutation:
      return validCase(
        id,
        makeOrdersPrivateStandardApplicationDefinitionFixtureV1(),
        {
          logicalModulePaths: ["orders"],
          functionPaths: ["orders:place"],
          tableNames: ["orders"],
          indexNames: ["orders:by_status"],
          artifactModulePaths: [
            "_flarex/execution.js",
            "orders.js",
          ],
        },
      );
    case PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
      .validMultiModuleFunctionMetadata:
      return validCase(
        id,
        makeMultiModuleFunctionMetadataFixtureV1(),
        {
          logicalModulePaths: ["orders", "reports", "users"],
          functionPaths: [
            "orders:list",
            "orders:place",
            "orders:reconcile",
            "reports:export",
            "users:disable",
            "users:get",
          ],
          tableNames: ["orders", "users"],
          indexNames: [
            "orders:by_customer",
            "orders:by_status",
            "users:by_email",
          ],
          artifactModulePaths: [
            "_flarex/execution.js",
            "orders.js",
            "reports.js",
            "users.js",
          ],
        },
      );
    case PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
      .canonicalDuplicateFunctionPath:
      return canonicalFailureCase(
        id,
        makeDuplicateFunctionPathFixtureV1(),
        {
          _tag: "CanonicalDeclarativeProgramV1Error",
          operation: "decodeProgram",
          reason: "duplicateFunctionPath",
          path: "orders:place",
        },
      );
    case PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
      .canonicalUnknownIndexTable:
      return canonicalFailureCase(
        id,
        makeUnknownIndexTableFixtureV1(),
        {
          _tag: "CanonicalDeclarativeProgramV1Error",
          operation: "decodeProgram",
          reason: "unknownIndexTable",
          path: "schema.indexes[0].tableLogicalName",
        },
      );
    case PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
      .canonicalInvalidArgumentsValidator:
      return canonicalFailureCase(
        id,
        makeInvalidArgumentsValidatorFixtureV1(),
        {
          _tag: "CanonicalDeclarativeProgramV1Error",
          operation: "decodeProgram",
          reason: "invalidValidator",
          path: "modules.orders.functions[0].argsValidator",
        },
      );
    case PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
      .canonicalFunctionBudgetExceeded:
      return canonicalFailureCase(
        id,
        makeCanonicalFunctionBudgetExceededFixtureV1(),
        {
          _tag: "CanonicalDeclarativeProgramV1Error",
          operation: "decodeProgram",
          reason: "budgetExceeded",
          path: "modules[0].functions",
          dimension: "functions",
          observed: 1,
          maximum: 0,
        },
      );
    case PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
      .materializationMissingLogicalBinding:
      return materializationFailureCase(
        id,
        makeMissingLogicalBindingFixtureV1(),
        {
          _tag: "DeclarativeV2MaterializationV1Error",
          operation: "materialize",
          reason: "missingLogicalBinding",
          path: "orders",
        },
      );
    case PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
      .materializationDuplicateArtifactBinding:
      return materializationFailureCase(
        id,
        makeDuplicateArtifactBindingFixtureV1(),
        {
          _tag: "DeclarativeV2MaterializationV1Error",
          operation: "materialize",
          reason: "duplicateArtifactBinding",
          path: "functionEntries[1].artifactModulePath",
        },
      );
    case PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
      .materializationExecutionRoleRequired:
      return materializationFailureCase(
        id,
        makeExecutionRoleRequiredFixtureV1(),
        {
          _tag: "DeclarativeV2MaterializationV1Error",
          operation: "materialize",
          reason: "executionRoleRequired",
          path: "orders.js",
        },
      );
    case PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
      .materializationSourceBudgetExceeded:
      return materializationFailureCase(
        id,
        makeSourceBudgetExceededFixtureV1(),
        {
          _tag: "DeclarativeV2MaterializationV1Error",
          operation: "materialize",
          reason: "budgetExceeded",
          dimension: "sourceBytes",
          observed: 24,
          maximum: 1,
          path: "modules[0].sourceBytes",
        },
      );
    case PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
      .materializationSchemaRoleUnsupported:
      return materializationFailureCase(
        id,
        makeSchemaRoleUnsupportedFixtureV1(),
        {
          _tag: "DeclarativeV2MaterializationV1Error",
          operation: "materialize",
          reason: "schemaRoleUnsupported",
          path: "schemaPath",
        },
      );
  }
  return unreachableCaseId(id);
}

function validCase(
  id: PrivateStandardApplicationValidCaseIdV1,
  fixture: PrivateStandardApplicationDefinitionFixtureV1,
  expected: PrivateStandardApplicationValidFactsV1,
): PrivateStandardApplicationCorpusCaseV1 {
  return { kind: "valid", id, fixture, expected };
}

function canonicalFailureCase(
  id: PrivateStandardApplicationCanonicalFailureCaseIdV1,
  fixture: PrivateStandardApplicationDefinitionFixtureV1,
  expected: PrivateStandardApplicationCanonicalFailureV1,
): PrivateStandardApplicationCorpusCaseV1 {
  return { kind: "canonicalFailure", id, fixture, expected };
}

function materializationFailureCase(
  id: PrivateStandardApplicationMaterializationFailureCaseIdV1,
  fixture: PrivateStandardApplicationDefinitionFixtureV1,
  expected: PrivateStandardApplicationMaterializationFailureV1,
): PrivateStandardApplicationCorpusCaseV1 {
  return { kind: "materializationFailure", id, fixture, expected };
}

function makeMultiModuleFunctionMetadataFixtureV1():
  PrivateStandardApplicationDefinitionFixtureV1
{
  const programInput = {
    format: CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
    version: CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
    schema: {
      tables: [
        {
          logicalName: "users",
          definition: appDocumentDefinition("email"),
        },
        {
          logicalName: "orders",
          definition: appDocumentDefinition("status"),
        },
      ],
      indexes: [
        {
          tableLogicalName: "orders",
          descriptor: "by_status",
          fields: ["status"],
        },
        {
          tableLogicalName: "orders",
          descriptor: "by_customer",
          fields: ["customerId"],
        },
        {
          tableLogicalName: "users",
          descriptor: "by_email",
          fields: ["email"],
        },
      ],
    },
    modules: [
      {
        modulePath: "users",
        functions: [
          functionDefinition("get", "query", "public"),
          functionDefinition("disable", "mutation", "internal"),
        ],
      },
      {
        modulePath: "orders",
        functions: [
          functionDefinition("place", "mutation", "public"),
          functionDefinition("list", "query", "public"),
          functionDefinition(
            "reconcile",
            "workflowMutation",
            "internal",
          ),
        ],
      },
      {
        modulePath: "reports",
        functions: [
          functionDefinition("export", "action", "internal"),
        ],
      },
    ],
  } satisfies CanonicalDeclarativeProgramInputV1;

  return {
    programBudgetInput: {
      maximumModules: 3,
      maximumFunctions: 6,
      maximumIdentifierUtf8Bytes: 4_096,
      maximumValidatorNodes: 512,
      maximumValidatorDepth: 32,
      maximumValidatorStringUtf8Bytes: 4_096,
    },
    programInput,
    materializationBudgetInput: {
      maximumModules: 4,
      maximumEntryBindings: 3,
      maximumSourceBytes: 4_096,
      maximumSourceMapBytes: 0,
      maximumBytesMaterialized: 64_000,
      maximumSemanticRecords: 128,
      maximumSemanticRecordBytes: 16_000,
      maximumSemanticStreamBytes: 48_000,
    },
    graphInput: {
      modules: [
        functionModule(
          "users.js",
          "export const get = 1;\nexport const disable = 1;\n",
        ),
        functionModule(
          "orders.js",
          "export const list = 1;\nexport const place = 1;\nexport const reconcile = 1;\n",
        ),
        functionModule(
          "reports.js",
          "const exportReport = 1;\nexport { exportReport as export };\n",
        ),
        {
          path: "_flarex/execution.js",
          roles: ["execution"],
          sourceBytes: UTF8_ENCODER.encode("export const run = 1;\n"),
          sourceMapBytes: null,
        },
      ],
      functionEntries: [
        {
          logicalModulePath: "users",
          artifactModulePath: "users.js",
        },
        {
          logicalModulePath: "orders",
          artifactModulePath: "orders.js",
        },
        {
          logicalModulePath: "reports",
          artifactModulePath: "reports.js",
        },
      ],
      executionPath: "_flarex/execution.js",
      schemaPath: null,
      authPath: null,
    },
  };
}

function makeDuplicateFunctionPathFixtureV1():
  PrivateStandardApplicationDefinitionFixtureV1
{
  const fixture =
    makeOrdersPrivateStandardApplicationDefinitionFixtureV1();
  const orders = programModule(fixture, "orders");
  const place = programFunction(orders, "place");
  return {
    ...fixture,
    programInput: {
      ...fixture.programInput,
      modules: [{
        ...orders,
        functions: [...orders.functions, { ...place }],
      }],
    },
  };
}

function makeUnknownIndexTableFixtureV1():
  PrivateStandardApplicationDefinitionFixtureV1
{
  const fixture =
    makeOrdersPrivateStandardApplicationDefinitionFixtureV1();
  const index = fixture.programInput.schema.indexes[0];
  if (index === undefined) {
    throw new Error("Expected orders index fixture.");
  }
  return {
    ...fixture,
    programInput: {
      ...fixture.programInput,
      schema: {
        ...fixture.programInput.schema,
        indexes: [{
          ...index,
          tableLogicalName: "missing",
        }],
      },
    },
  };
}

function makeInvalidArgumentsValidatorFixtureV1():
  PrivateStandardApplicationDefinitionFixtureV1
{
  const fixture =
    makeOrdersPrivateStandardApplicationDefinitionFixtureV1();
  const orders = programModule(fixture, "orders");
  const place = programFunction(orders, "place");
  return {
    ...fixture,
    programInput: {
      ...fixture.programInput,
      modules: [{
        ...orders,
        functions: [{
          ...place,
          argsValidator: { type: "string" },
        }],
      }],
    },
  };
}

function makeCanonicalFunctionBudgetExceededFixtureV1():
  PrivateStandardApplicationDefinitionFixtureV1
{
  const fixture =
    makeOrdersPrivateStandardApplicationDefinitionFixtureV1();
  return {
    ...fixture,
    programBudgetInput: {
      ...fixture.programBudgetInput,
      maximumFunctions: 0,
    },
  };
}

function makeMissingLogicalBindingFixtureV1():
  PrivateStandardApplicationDefinitionFixtureV1
{
  const fixture =
    makeOrdersPrivateStandardApplicationDefinitionFixtureV1();
  return {
    ...fixture,
    graphInput: {
      ...fixture.graphInput,
      functionEntries: [],
    },
  };
}

function makeDuplicateArtifactBindingFixtureV1():
  PrivateStandardApplicationDefinitionFixtureV1
{
  const fixture =
    makeOrdersPrivateStandardApplicationDefinitionFixtureV1();
  const binding = fixture.graphInput.functionEntries[0];
  if (binding === undefined) {
    throw new Error("Expected orders function-entry binding.");
  }
  return {
    ...fixture,
    materializationBudgetInput: {
      ...fixture.materializationBudgetInput,
      maximumEntryBindings: 2,
    },
    graphInput: {
      ...fixture.graphInput,
      functionEntries: [
        binding,
        {
          logicalModulePath: "other",
          artifactModulePath: binding.artifactModulePath,
        },
      ],
    },
  };
}

function makeExecutionRoleRequiredFixtureV1():
  PrivateStandardApplicationDefinitionFixtureV1
{
  const fixture =
    makeOrdersPrivateStandardApplicationDefinitionFixtureV1();
  return {
    ...fixture,
    graphInput: {
      ...fixture.graphInput,
      executionPath: "orders.js",
    },
  };
}

function makeSourceBudgetExceededFixtureV1():
  PrivateStandardApplicationDefinitionFixtureV1
{
  const fixture =
    makeOrdersPrivateStandardApplicationDefinitionFixtureV1();
  return {
    ...fixture,
    materializationBudgetInput: {
      ...fixture.materializationBudgetInput,
      maximumSourceBytes: 1,
    },
  };
}

function makeSchemaRoleUnsupportedFixtureV1():
  PrivateStandardApplicationDefinitionFixtureV1
{
  const fixture =
    makeOrdersPrivateStandardApplicationDefinitionFixtureV1();
  return {
    ...fixture,
    graphInput: {
      ...fixture.graphInput,
      schemaPath: "schema.js",
    },
  };
}

function appDocumentDefinition(fieldName: string) {
  return {
    kind: "appDocument",
    definitionVersion: 1,
    documentType: {
      type: "object",
      value: {
        [fieldName]: {
          fieldType: { type: "string" },
          optional: false,
        },
      },
    },
  } as const;
}

function functionDefinition(
  exportName: string,
  kind: "query" | "mutation" | "workflowMutation" | "action",
  visibility: "public" | "internal",
) {
  return {
    exportName,
    kind,
    visibility,
    argsValidator: { type: "any" },
    returnsValidator: null,
  } as const;
}

function functionModule(path: string, source: string) {
  return {
    path,
    roles: ["function"],
    sourceBytes: UTF8_ENCODER.encode(source),
    sourceMapBytes: null,
  } as const;
}

type ProgramModuleInputV1 =
  CanonicalDeclarativeProgramInputV1["modules"][number];

type ProgramFunctionInputV1 =
  ProgramModuleInputV1["functions"][number];

function programModule(
  fixture: PrivateStandardApplicationDefinitionFixtureV1,
  modulePath: string,
): ProgramModuleInputV1 {
  const module = fixture.programInput.modules.find(
    (candidate) => candidate.modulePath === modulePath,
  );
  if (module === undefined) {
    throw new Error(`Expected canonical fixture module ${modulePath}.`);
  }
  return module;
}

function programFunction(
  module: ProgramModuleInputV1,
  exportName: string,
): ProgramFunctionInputV1 {
  const fn = module.functions.find(
    (candidate) => candidate.exportName === exportName,
  );
  if (fn === undefined) {
    throw new Error(
      `Expected canonical fixture function ${module.modulePath}:${exportName}.`,
    );
  }
  return fn;
}

function unreachableCaseId(id: never): never {
  throw new Error(`Unhandled private standard application corpus case ${id}.`);
}
