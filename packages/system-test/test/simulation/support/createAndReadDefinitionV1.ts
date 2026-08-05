import type {
  StandardApplicationDefinitionInputV1,
} from "@flarex/standard-application-definition/v1";
import type { ObjectValidatorJsonV1 } from
  "flarex-protocol/validator-json";

const UTF8 = new TextEncoder();

export interface CreateAndReadDefinitionInputV1 {
  readonly tableName: string;
  readonly mutationModulePath: string;
  readonly queryModulePath: string;
  readonly mutationArtifactPath: string;
  readonly queryArtifactPath: string;
  readonly fields: ObjectValidatorJsonV1["value"];
}

export function makeCreateAndReadDefinitionV1(
  input: CreateAndReadDefinitionInputV1,
): StandardApplicationDefinitionInputV1 {
  const makeDocumentFields = (): ObjectValidatorJsonV1["value"] =>
    Object.fromEntries(Object.entries(input.fields).map(
      ([fieldName, field]) => [fieldName, { ...field }],
    ));
  return {
    programBudgetInput: {
      maximumModules: 2,
      maximumFunctions: 2,
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
      }, {
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
      maximumModules: 2,
      maximumEntryBindings: 2,
      maximumSourceBytes: 8_192,
      maximumSourceMapBytes: 1_024,
      maximumBytesMaterialized: 64_000,
      maximumSemanticRecords: 64,
      maximumSemanticRecordBytes: 8_000,
      maximumSemanticStreamBytes: 32_000,
    },
    graphInput: {
      modules: [{
        path: input.mutationArtifactPath,
        roles: ["function", "execution"],
        sourceBytes: UTF8.encode(
          'import{databaseInsert}from"flarex:platform";' +
            `export function create(_,a){return databaseInsert("${input.tableName}",a)}`,
        ),
        sourceMapBytes: null,
      }, {
        path: input.queryArtifactPath,
        roles: ["function"],
        sourceBytes: UTF8.encode(
          'import{databaseGet}from"flarex:platform";' +
            "export function get(_,a){return databaseGet(a.id)}",
        ),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: input.mutationModulePath,
        artifactModulePath: input.mutationArtifactPath,
      }, {
        logicalModulePath: input.queryModulePath,
        artifactModulePath: input.queryArtifactPath,
      }],
      executionPath: input.mutationArtifactPath,
      schemaPath: null,
      authPath: null,
    },
  };
}
