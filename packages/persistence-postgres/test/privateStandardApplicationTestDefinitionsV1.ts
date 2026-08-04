import type {
  StandardApplicationDefinitionInputV1,
} from "@flarex/standard-application-definition/v1";

const UTF8 = new TextEncoder();

export function makePrivateStandardCookingDefinitionV1():
  StandardApplicationDefinitionInputV1 {
  return makeCreateAndReadDefinitionV1({
    tableName: "recipes",
    mutationModulePath: "recipeCommands",
    queryModulePath: "recipes",
    mutationArtifactPath: "recipeMutation",
    queryArtifactPath: "recipeQuery",
    fields: {
      title: { type: "string" },
      servings: { type: "number" },
    },
  });
}

export function makePrivateStandardEnglishLearningDefinitionV1():
  StandardApplicationDefinitionInputV1 {
  return makeCreateAndReadDefinitionV1({
    tableName: "lessons",
    mutationModulePath: "lessonCommands",
    queryModulePath: "lessons",
    mutationArtifactPath: "lessonMutation",
    queryArtifactPath: "lessonQuery",
    fields: {
      term: { type: "string" },
      translation: { type: "string" },
      mastery: { type: "number" },
    },
  });
}

interface CreateAndReadDefinitionInputV1 {
  readonly tableName: string;
  readonly mutationModulePath: string;
  readonly queryModulePath: string;
  readonly mutationArtifactPath: string;
  readonly queryArtifactPath: string;
  readonly fields: Readonly<Record<string, Readonly<{
    readonly type: "number" | "string";
  }>>>;
}

function makeCreateAndReadDefinitionV1(
  input: CreateAndReadDefinitionInputV1,
): StandardApplicationDefinitionInputV1 {
  const makeDocumentFields = () => Object.fromEntries(
    Object.entries(input.fields).map(([fieldName, field]) => [
      fieldName,
      {
        fieldType: { type: field.type },
        optional: false,
      },
    ]),
  );
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
