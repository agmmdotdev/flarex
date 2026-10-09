import {
  canonicalizeApplicationManifestV2,
  type ApplicationManifestV2,
} from "@flarex/analysis/application-analysis";
import { Result } from "effect";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";

const EXECUTION_SOURCE_SHA256 = "b".repeat(64);
const SCHEMA_SOURCE_SHA256 = "c".repeat(64);

interface RelationManifestV2Options {
  readonly many?: boolean;
  readonly minItems?: number;
}

export function relationManifestV2(
  rootSha256: string,
  options: RelationManifestV2Options = {},
): ApplicationManifestV2 {
  return canonicalRelationManifestV2(rootSha256, options).manifest;
}

export function relationManifestV2Text(
  rootSha256: string,
  options: RelationManifestV2Options = {},
): string {
  return canonicalRelationManifestV2(rootSha256, options).canonicalText;
}

function canonicalRelationManifestV2(
  rootSha256: string,
  options: RelationManifestV2Options,
) {
  const many = options.many === true;
  return Result.getOrThrow(canonicalizeApplicationManifestV2({
    format: "flarex.application-manifest",
    version: 2,
    sourceArtifact: {
      rootSha256,
      executionModulePath: "functions.js",
      schemaModulePath: "schema.js",
      modules: [
        {
          path: "functions.js",
          roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
          sourceSha256: EXECUTION_SOURCE_SHA256,
          sourceByteLength: 18,
        },
        {
          path: "schema.js",
          roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
          sourceSha256: SCHEMA_SOURCE_SHA256,
          sourceByteLength: 32,
        },
      ],
    },
    schema: {
      version: 2,
      tables: [
        {
          tableId: 1,
          name: "posts",
          validator: {
            type: "object",
            value: {
              author: {
                fieldType: many
                  ? {
                      type: "array",
                      value: { type: "id", tableName: "users" },
                    }
                  : { type: "id", tableName: "users" },
                optional: false,
              },
            },
          },
          placement: { kind: "global" },
        },
        {
          tableId: 2,
          name: "users",
          validator: {
            type: "object",
            value: {
              name: {
                fieldType: { type: "string" },
                optional: false,
              },
            },
          },
          placement: { kind: "global" },
        },
      ],
      indexes: [],
      relations: [{
        relationOrdinal: 1,
        sourceTableOrdinal: 1,
        targetTableOrdinal: 2,
        declaration: {
          format: "flarex.relation-declaration",
          version: 1,
          source: {
            table: "posts",
            path: [{ kind: "field", name: "author" }],
            forwardName: "author",
          },
          target: { table: "users" },
          value: many
            ? {
                cardinality: "many",
                minItems: options.minItems ?? 0,
                maxItems: 32,
                ordered: true,
                duplicates: "forbid",
              }
            : { cardinality: "one", required: true },
          inverse: { cardinality: "many", name: "posts" },
          localized: false,
          onTargetDelete: "restrict",
        },
      }],
    },
    functions: [],
  }));
}
