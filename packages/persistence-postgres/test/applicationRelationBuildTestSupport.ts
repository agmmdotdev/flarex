import { webcrypto } from "node:crypto";

import {
  canonicalizeApplicationManifestV2,
  type ApplicationManifestV2,
} from "@flarex/analysis/application-analysis";
import {
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Result } from "effect";
import {
  appDocumentIdV1FromRowIdentity,
  decodeAppRowIdHexV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";

import type { PublishApplicationRelationBindingInput } from
  "../src/applicationRelationBinding";

export interface RelationBuildPublicationOptions {
  readonly decisions?: PublishApplicationRelationBindingInput["decisions"];
  readonly extraUserField?: boolean;
  readonly inverseName?: string;
  readonly many?: boolean;
  readonly maximumItems?: number;
}

export function ensureRelationBuildTestWebCrypto(): void {
  if (globalThis.crypto !== undefined) return;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
}

export async function relationBuildPublicationInput(
  deploymentId: string,
  ordinal: number,
  options: RelationBuildPublicationOptions = {},
): Promise<PublishApplicationRelationBindingInput> {
  const canonical = Result.getOrThrow(canonicalizeApplicationManifestV2(
    relationBuildManifestInput(
      ordinal.toString(16).padStart(64, "a").slice(-64),
      options,
    ),
  ));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(canonical.canonicalBytes),
  ));
  return Object.freeze({
    deploymentId,
    manifest: canonical.manifest,
    manifestSha256: encodeBytesToLowercaseHex(digest),
    decisions: options.decisions ?? Object.freeze([{
      relationOrdinal: 1,
      evolution: Object.freeze({ kind: "new" as const }),
    }]),
  });
}

export function relationBuildRowId(ordinal: number): AppRowIdHexV1 {
  return decodeAppRowIdHexV1(ordinal.toString(16).padStart(32, "0"));
}

export function relationBuildDocumentId(
  tableIdValue: number,
  ordinal: number,
): string {
  return appDocumentIdV1FromRowIdentity({
    tableId: decodeCatalogTableId(tableIdValue),
    rowId: relationBuildRowId(ordinal),
  });
}

function relationBuildManifestInput(
  rootSha256: string,
  options: RelationBuildPublicationOptions,
): ApplicationManifestV2 {
  const many = options.many === true;
  return Result.getOrThrow(canonicalizeApplicationManifestV2({
    format: "flarex.application-manifest",
    version: 2,
    sourceArtifact: {
      rootSha256,
      executionModulePath: "functions.js",
      schemaModulePath: "schema.js",
      modules: [{
        path: "functions.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: "e".repeat(64),
        sourceByteLength: 18,
      }, {
        path: "schema.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
        sourceSha256: "f".repeat(64),
        sourceByteLength: 32,
      }],
    },
    schema: {
      version: 2,
      tables: [{
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
      }, {
        tableId: 2,
        name: "users",
        validator: {
          type: "object",
          value: {
            name: {
              fieldType: { type: "string" },
              optional: false,
            },
            ...(options.extraUserField === true
              ? {
                  nickname: {
                    fieldType: { type: "string" as const },
                    optional: true,
                  },
                }
              : {}),
          },
        },
        placement: { kind: "global" },
      }],
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
                minItems: 0,
                maxItems: options.maximumItems ?? 1_024,
                ordered: true,
                duplicates: "forbid",
              }
            : { cardinality: "one", required: true },
          inverse: {
            cardinality: "many",
            name: options.inverseName ?? "posts",
          },
          localized: false,
          onTargetDelete: "restrict",
        },
      }],
    },
    functions: [],
  })).manifest;
}
