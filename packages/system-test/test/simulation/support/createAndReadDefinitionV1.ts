import type {
  StandardApplicationDefinitionInputV1,
} from "@flarex/standard-application-definition/v1";
import type { ObjectValidatorJsonV1 } from
  "flarex-protocol/validator-json";

type CreateAndReadFunctionInputV1 =
  StandardApplicationDefinitionInputV1["programInput"]["modules"][number][
    "functions"
  ][number];

export interface CreateAndReadAdditionalFunctionModuleV1 {
  readonly modulePath: string;
  readonly artifactModulePath: string;
  readonly sourceBytes: Uint8Array;
  readonly functions: ReadonlyArray<CreateAndReadFunctionInputV1>;
}

export interface CreateAndReadDefinitionInputV1 {
  readonly tableName: string;
  readonly mutationModulePath: string;
  readonly queryModulePath: string;
  readonly mutationArtifactPath: string;
  readonly queryArtifactPath: string;
  readonly mutationSourceBytes: Uint8Array;
  readonly querySourceBytes: Uint8Array;
  readonly fields: ObjectValidatorJsonV1["value"];
  readonly additionalFunctionModules?:
    ReadonlyArray<CreateAndReadAdditionalFunctionModuleV1>;
  readonly pointMutationLifecycle?: Readonly<{
    readonly patchModulePath: string;
    readonly patchArtifactPath: string;
    readonly patchSourceBytes: Uint8Array;
    readonly replaceModulePath: string;
    readonly replaceArtifactPath: string;
    readonly replaceSourceBytes: Uint8Array;
    readonly deleteModulePath: string;
    readonly deleteArtifactPath: string;
    readonly deleteSourceBytes: Uint8Array;
  }>;
}

export function makeCreateAndReadDefinitionV1(
  input: CreateAndReadDefinitionInputV1,
): StandardApplicationDefinitionInputV1 {
  const makeDocumentFields = (): ObjectValidatorJsonV1["value"] =>
    Object.fromEntries(Object.entries(input.fields).map(
      ([fieldName, field]) => [fieldName, { ...field }],
    ));
  const makePatchFields = (): ObjectValidatorJsonV1["value"] =>
    Object.fromEntries(Object.entries(input.fields).map(
      ([fieldName, field]) => [fieldName, { ...field, optional: true }],
    ));
  const lifecycle = input.pointMutationLifecycle;
  const additionalFunctionModules = input.additionalFunctionModules ?? [];
  const lifecycleProgramModules = lifecycle === undefined ? [] : [{
    modulePath: lifecycle.patchModulePath,
    functions: [{
      exportName: "patch",
      kind: "mutation" as const,
      visibility: "public" as const,
      argsValidator: {
        type: "object" as const,
        value: {
          id: {
            optional: false,
            fieldType: { type: "id" as const, tableName: input.tableName },
          },
          patch: {
            optional: false,
            fieldType: {
              type: "object" as const,
              value: makePatchFields(),
            },
          },
        },
      },
      returnsValidator: { type: "null" as const },
    }],
  }, {
    modulePath: lifecycle.replaceModulePath,
    functions: [{
      exportName: "replace",
      kind: "mutation" as const,
      visibility: "public" as const,
      argsValidator: {
        type: "object" as const,
        value: {
          id: {
            optional: false,
            fieldType: { type: "id" as const, tableName: input.tableName },
          },
          fields: {
            optional: false,
            fieldType: {
              type: "object" as const,
              value: makeDocumentFields(),
            },
          },
        },
      },
      returnsValidator: { type: "null" as const },
    }],
  }, {
    modulePath: lifecycle.deleteModulePath,
    functions: [{
      exportName: "remove",
      kind: "mutation" as const,
      visibility: "public" as const,
      argsValidator: {
        type: "object" as const,
        value: {
          id: {
            optional: false,
            fieldType: { type: "id" as const, tableName: input.tableName },
          },
        },
      },
      returnsValidator: { type: "null" as const },
    }],
  }];
  const lifecycleGraphModules = lifecycle === undefined ? [] : [{
    path: lifecycle.patchArtifactPath,
    roles: ["function" as const],
    sourceBytes: new Uint8Array(lifecycle.patchSourceBytes),
    sourceMapBytes: null,
  }, {
    path: lifecycle.replaceArtifactPath,
    roles: ["function" as const],
    sourceBytes: new Uint8Array(lifecycle.replaceSourceBytes),
    sourceMapBytes: null,
  }, {
    path: lifecycle.deleteArtifactPath,
    roles: ["function" as const],
    sourceBytes: new Uint8Array(lifecycle.deleteSourceBytes),
    sourceMapBytes: null,
  }];
  const lifecycleFunctionEntries = lifecycle === undefined ? [] : [{
    logicalModulePath: lifecycle.patchModulePath,
    artifactModulePath: lifecycle.patchArtifactPath,
  }, {
    logicalModulePath: lifecycle.replaceModulePath,
    artifactModulePath: lifecycle.replaceArtifactPath,
  }, {
    logicalModulePath: lifecycle.deleteModulePath,
    artifactModulePath: lifecycle.deleteArtifactPath,
  }];
  const additionalProgramModules = additionalFunctionModules.map(module => ({
    modulePath: module.modulePath,
    functions: module.functions.map(fn => ({ ...fn })),
  }));
  const additionalGraphModules = additionalFunctionModules.map(module => ({
    path: module.artifactModulePath,
    roles: ["function" as const],
    sourceBytes: new Uint8Array(module.sourceBytes),
    sourceMapBytes: null,
  }));
  const additionalFunctionEntries = additionalFunctionModules.map(module => ({
    logicalModulePath: module.modulePath,
    artifactModulePath: module.artifactModulePath,
  }));
  const baseModuleCount = lifecycle === undefined ? 2 : 5;
  const moduleCount = baseModuleCount + additionalFunctionModules.length;
  const functionCount = baseModuleCount + additionalFunctionModules.reduce(
    (count, module) => count + module.functions.length,
    0,
  );
  return {
    programBudgetInput: {
      maximumModules: moduleCount,
      maximumFunctions: functionCount,
      maximumIdentifierUtf8Bytes: 4_096,
      maximumValidatorNodes: 512,
      maximumValidatorDepth: 32,
      maximumValidatorStringUtf8Bytes: 4_096,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: {
        tables: [{
          logicalName: input.tableName,
          definition: {
            kind: "appDocument",
            definitionVersion: 1,
            documentType: {
              type: "object",
              value: makeDocumentFields(),
            },
          },
        }],
        indexes: [],
      },
      modules: [{
        modulePath: input.mutationModulePath,
        functions: [{
          exportName: "create",
          kind: "mutation",
          visibility: "public",
          argsValidator: {
            type: "object",
            value: makeDocumentFields(),
          },
          returnsValidator: { type: "id", tableName: input.tableName },
        }],
      }, ...lifecycleProgramModules, ...additionalProgramModules, {
        modulePath: input.queryModulePath,
        functions: [{
          exportName: "get",
          kind: "query",
          visibility: "public",
          argsValidator: {
            type: "object",
            value: {
              id: {
                optional: false,
                fieldType: { type: "string" },
              },
            },
          },
          returnsValidator: {
            type: "union",
            value: [{
              type: "object",
              value: {
                _id: {
                  optional: false,
                  fieldType: { type: "id", tableName: input.tableName },
                },
                _creationTime: {
                  optional: false,
                  fieldType: { type: "number" },
                },
                ...makeDocumentFields(),
              },
            }, { type: "null" }],
          },
        }],
      }],
    },
    materializationBudgetInput: {
      maximumModules: moduleCount,
      maximumEntryBindings: moduleCount,
      maximumSourceBytes: additionalFunctionModules.length === 0
        ? 8_192
        : 16_384,
      maximumSourceMapBytes: 1_024,
      maximumBytesMaterialized: additionalFunctionModules.length === 0
        ? 64_000
        : 128_000,
      maximumSemanticRecords: moduleCount * 32,
      maximumSemanticRecordBytes: 8_000,
      maximumSemanticStreamBytes: 32_000,
    },
    graphInput: {
      modules: [{
        path: input.mutationArtifactPath,
        roles: ["function", "execution"],
        sourceBytes: new Uint8Array(input.mutationSourceBytes),
        sourceMapBytes: null,
      }, ...lifecycleGraphModules, ...additionalGraphModules, {
        path: input.queryArtifactPath,
        roles: ["function"],
        sourceBytes: new Uint8Array(input.querySourceBytes),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: input.mutationModulePath,
        artifactModulePath: input.mutationArtifactPath,
      }, ...lifecycleFunctionEntries, ...additionalFunctionEntries, {
        logicalModulePath: input.queryModulePath,
        artifactModulePath: input.queryArtifactPath,
      }],
      executionPath: input.mutationArtifactPath,
      schemaPath: null,
      authPath: null,
    },
  };
}
