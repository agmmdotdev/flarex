import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";

import {
  produceStandardApplicationSource,
  STANDARD_APPLICATION_EXECUTION_MODULE_PATH,
  STANDARD_APPLICATION_SCHEMA_MODULE_PATH,
} from "../src/applicationSource";
import { prepareStandardApplicationDefinitionV1 } from "../src/v1";

const UTF8 = new TextDecoder();

describe("Standard Application executable source", () => {
  it("preserves handler bytes and generates real registrations and schema", () => {
    const handlerBytes = new TextEncoder().encode(
      "export async function create(ctx, args) { return ctx.db.insert('users', args); }\n",
    );
    const prepared = Result.getOrThrow(prepareStandardApplicationDefinitionV1({
      programBudgetInput: {
        maximumModules: 1,
        maximumFunctions: 1,
        maximumIdentifierUtf8Bytes: 1_024,
        maximumValidatorNodes: 64,
        maximumValidatorDepth: 16,
        maximumValidatorStringUtf8Bytes: 1_024,
      },
      programInput: {
        format: "flarex.declarative-program/v1",
        version: 1,
        schema: {
          tables: [{
            logicalName: "users",
            definition: {
              kind: "appDocument",
              definitionVersion: 1,
              documentType: {
                type: "object",
                value: {
                  name: {
                    fieldType: { type: "string" },
                    optional: false,
                  },
                },
              },
            },
          }],
          indexes: [{
            tableLogicalName: "users",
            descriptor: "by_name",
            fields: ["name"],
          }],
        },
        modules: [{
          modulePath: "users",
          functions: [{
            exportName: "create",
            kind: "mutation",
            visibility: "public",
            argsValidator: {
              type: "object",
              value: {
                name: {
                  fieldType: { type: "string" },
                  optional: false,
                },
              },
            },
            returnsValidator: { type: "id", tableName: "users" },
          }],
        }],
      },
      materializationBudgetInput: {
        maximumModules: 1,
        maximumEntryBindings: 1,
        maximumSourceBytes: 4_096,
        maximumSourceMapBytes: 0,
        maximumBytesMaterialized: 32_768,
        maximumSemanticRecords: 32,
        maximumSemanticRecordBytes: 8_192,
        maximumSemanticStreamBytes: 32_768,
      },
      graphInput: {
        modules: [{
          path: "functions/users.js",
          roles: ["function", "execution"],
          sourceBytes: handlerBytes,
          sourceMapBytes: null,
        }],
        functionEntries: [{
          logicalModulePath: "users",
          artifactModulePath: "functions/users.js",
        }],
        executionPath: "functions/users.js",
        schemaPath: null,
        authPath: null,
      },
    }));

    const source = Result.getOrThrow(produceStandardApplicationSource(prepared));
    const handler = source.modules.find(module => module.path === "functions/users.js");
    const execution = source.modules.find(
      module => module.path === STANDARD_APPLICATION_EXECUTION_MODULE_PATH,
    );
    const schema = source.modules.find(
      module => module.path === STANDARD_APPLICATION_SCHEMA_MODULE_PATH,
    );

    expect(source).toMatchObject({
      executionPath: STANDARD_APPLICATION_EXECUTION_MODULE_PATH,
      schemaPath: STANDARD_APPLICATION_SCHEMA_MODULE_PATH,
      authPath: null,
    });
    expect(handler?.roles).toBe(SOURCE_ARTIFACT_V2_ROLE_FUNCTION);
    expect(handler?.sourceBytes).not.toBe(handlerBytes);
    expect(handler?.sourceBytes).toEqual(handlerBytes);
    expect(execution?.roles).toBe(SOURCE_ARTIFACT_V2_ROLE_EXECUTION);
    expect(UTF8.decode(execution?.sourceBytes)).toContain(
      'import * as applicationModule0 from "../functions/users.js";',
    );
    expect(UTF8.decode(execution?.sourceBytes)).toContain(
      '"users": { "create": mutation({ args: v.object({ "name": v.string() })',
    );
    expect(schema?.roles).toBe(SOURCE_ARTIFACT_V2_ROLE_SCHEMA);
    expect(UTF8.decode(schema?.sourceBytes)).toContain(
      '"users": definePartitionTable(v.object({ "name": v.string() })).index("by_name", ["name"])',
    );
  });

  it("fails before overwriting a reserved generated path", () => {
    const prepared = Result.getOrThrow(prepareStandardApplicationDefinitionV1({
      programBudgetInput: {
        maximumModules: 1,
        maximumFunctions: 0,
        maximumIdentifierUtf8Bytes: 1_024,
        maximumValidatorNodes: 8,
        maximumValidatorDepth: 4,
        maximumValidatorStringUtf8Bytes: 1_024,
      },
      programInput: {
        format: "flarex.declarative-program/v1",
        version: 1,
        schema: { tables: [], indexes: [] },
        modules: [{ modulePath: "empty", functions: [] }],
      },
      materializationBudgetInput: {
        maximumModules: 1,
        maximumEntryBindings: 1,
        maximumSourceBytes: 128,
        maximumSourceMapBytes: 0,
        maximumBytesMaterialized: 4_096,
        maximumSemanticRecords: 8,
        maximumSemanticRecordBytes: 1_024,
        maximumSemanticStreamBytes: 4_096,
      },
      graphInput: {
        modules: [{
          path: STANDARD_APPLICATION_EXECUTION_MODULE_PATH,
          roles: ["function", "execution"],
          sourceBytes: new TextEncoder().encode("export {};\n"),
          sourceMapBytes: null,
        }],
        functionEntries: [{
          logicalModulePath: "empty",
          artifactModulePath: STANDARD_APPLICATION_EXECUTION_MODULE_PATH,
        }],
        executionPath: STANDARD_APPLICATION_EXECUTION_MODULE_PATH,
        schemaPath: null,
        authPath: null,
      },
    }));
    const result = produceStandardApplicationSource(prepared);

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        reason: "reservedPathCollision",
        path: STANDARD_APPLICATION_EXECUTION_MODULE_PATH,
      });
    }
  });

  it.each([
    [["functions.js", "flarex/server"], "flarex/server"],
    [["nested/functions.js", "nested/flarex/values"], "nested/flarex/values"],
    [["functions.js", "_flarex/flarex/server"], "_flarex/flarex/server"],
  ] as const)(
    "rejects source paths that collide with trusted analyzer shims: %s",
    (paths, collision) => {
      const result = produceStandardApplicationSource(collisionPrepared(paths));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          reason: "reservedPathCollision",
          path: collision,
        });
      }
    },
  );
});

function collisionPrepared(paths: ReadonlyArray<string>) {
  return Result.getOrThrow(prepareStandardApplicationDefinitionV1({
    programBudgetInput: {
      maximumModules: paths.length,
      maximumFunctions: 0,
      maximumIdentifierUtf8Bytes: 1_024,
      maximumValidatorNodes: 8,
      maximumValidatorDepth: 4,
      maximumValidatorStringUtf8Bytes: 1_024,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: { tables: [], indexes: [] },
      modules: paths.map((_, index) => ({
        modulePath: `empty_${index}`,
        functions: [],
      })),
    },
    materializationBudgetInput: {
      maximumModules: paths.length,
      maximumEntryBindings: paths.length,
      maximumSourceBytes: 1_024,
      maximumSourceMapBytes: 0,
      maximumBytesMaterialized: 8_192,
      maximumSemanticRecords: 8,
      maximumSemanticRecordBytes: 1_024,
      maximumSemanticStreamBytes: 4_096,
    },
    graphInput: {
      modules: paths.map((path, index) => ({
        path,
        roles: index === 0 ? ["function", "execution"] : ["function"],
        sourceBytes: new TextEncoder().encode("export {};\n"),
        sourceMapBytes: null,
      })),
      functionEntries: paths.map((path, index) => ({
        logicalModulePath: `empty_${index}`,
        artifactModulePath: path,
      })),
      executionPath: paths[0] ?? "missing",
      schemaPath: null,
      authPath: null,
    },
  }));
}
