import {
  canonicalizeApplicationManifestV2,
  type ApplicationManifestV2,
} from "@flarex/analysis/application-analysis";
import {
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Result } from "effect";
import { canonicalizeApplicationMutationExecutionAuthorityV1 } from
  "flarex-protocol/internal/application-mutation-authority-v1";
import { canonicalizeApplicationRuntimeTargetV1 } from
  "flarex-protocol/internal/application-runtime-target-v1";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import type { CatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
import type { TransactionGrantDeploymentIdV1 } from
  "flarex-protocol/transaction-grant";

import type { PublishApplicationRelationBindingInput } from
  "../../../../src/application/relations/binding";
import type { StoredAttemptEvidenceAuthorityV1 } from
  "../../../../src/execution/storedAttemptEvidence";
import type {
  PointMutationSessionAnchorV1,
} from "../../../../src/execution/session/contracts";
import {
  runEffect,
  runSessionJournalPointOperation,
} from "../../../support/effectTestRuntime";

interface RelationCommitTestSqlClient {
  readonly query: <
    Row extends Record<string, unknown> = Record<string, unknown>,
  >(
    sql: string,
    params?: readonly unknown[],
  ) => Promise<Readonly<{ readonly rows: Row[] }>>;
}

export function selectorFromRelationAnchor(
  anchor: PointMutationSessionAnchorV1,
) {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
  });
}

export function relationAuthorityFromAnchor(
  anchor: PointMutationSessionAnchorV1,
  schemaVersionId: CatalogSchemaVersionId,
  executionClaim: NonNullable<
    StoredAttemptEvidenceAuthorityV1["executionClaim"]
  >,
): StoredAttemptEvidenceAuthorityV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
    storageGeneration: anchor.storageGeneration,
    storageGenerationFence: anchor.storageGenerationFence,
    snapshotToken: anchor.snapshotToken,
    schemaVersionId,
    executionClaim,
  });
}

export function requireRelationInsertedDocumentId(
  result: Awaited<ReturnType<typeof runSessionJournalPointOperation>>,
) {
  if (result.kind !== "completed" || result.outcome.kind !== "inserted") {
    throw new Error("Expected a completed C09 insert.");
  }
  return result.outcome.documentId;
}

export async function relationBindingPublicationInput(
  deploymentId: TransactionGrantDeploymentIdV1,
  sequence: number,
  valueCardinality: "one" | "many" = "one",
): Promise<PublishApplicationRelationBindingInput> {
  const rootSha256 = sequence.toString(16).padStart(64, "a").slice(-64);
  const canonical = Result.getOrThrow(canonicalizeApplicationManifestV2(
    relationManifest(rootSha256, valueCardinality),
  ));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(canonical.canonicalBytes),
  ));
  return Object.freeze({
    deploymentId,
    manifest: canonical.manifest,
    manifestSha256: encodeBytesToLowercaseHex(digest),
    decisions: Object.freeze([{
      relationOrdinal: 1,
      evolution: Object.freeze({ kind: "new" as const }),
    }]),
  });
}

/** Install exact canonical Application authority on a legacy test session. */
export async function installApplicationRelationCommitAuthorityForTest(
  persistence: RelationCommitTestSqlClient,
  input: Readonly<{
    readonly scopeId: string;
    readonly schemaVersionId: CatalogSchemaVersionId;
    readonly sessionId: string;
  }>,
): Promise<void> {
  const target = Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1({
    format: "flarex.application-runtime-target",
    version: 1,
    scopeId: input.scopeId,
    revisionId: "revision-c09-active-readiness-test",
    candidateId: "candidate-c09-active-readiness-test",
    analysisId: "analysis-c09-active-readiness-test",
    sourceArtifactRootSha256: "1".repeat(64),
    manifestSha256: "2".repeat(64),
    schemaSha256: "3".repeat(64),
    functionCatalogSha256: "4".repeat(64),
    publicationSha256: "5".repeat(64),
    executionModulePath: "_flarex/application.js",
    function: {
      path: "posts:create",
      moduleName: "posts",
      exportName: "create",
      kind: "mutation",
      visibility: "public",
      args: { type: "object", value: {} },
      returns: { type: "null" },
      partition: null,
      entrySha256: "6".repeat(64),
    },
  }));
  const runtimeTargetSha256 = new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(target.canonicalBytes),
    ),
  );
  const authority = await runEffect(
    canonicalizeApplicationMutationExecutionAuthorityV1({
      format: "flarex.application-mutation-execution-authority",
      version: 1,
      runtimeTarget: target.target,
      runtimeTargetSha256: encodeBytesToLowercaseHex(runtimeTargetSha256),
      activationSequence: "1",
      activeHeadSha256: "7".repeat(64),
      schemaVersionId: input.schemaVersionId,
    }),
  );
  const updated = await persistence.query<{ readonly session_id: string }>(`
    update fx_system_tx_session
       set execution_authority_generation = 'application_v1',
           package_id = null,
           artifact_runtime = null,
           artifact_id = null,
           source_package_hash = null,
           execution_module = null,
           application_execution_authority_json = $1::jsonb,
           application_execution_authority_canonical_bytes = $2,
           application_execution_authority_sha256 = $3
     where session_id = $4
     returning session_id
  `, [
    JSON.stringify(authority.authorityJson),
    authority.canonicalBytes,
    authority.sha256,
    input.sessionId,
  ]);
  if (updated.rows.length !== 1) {
    throw new Error("Expected one C09 Application authority test session.");
  }
}



function relationManifest(
  rootSha256: string,
  valueCardinality: "one" | "many",
): ApplicationManifestV2 {
  const authorFieldType = valueCardinality === "many"
    ? {
        type: "array" as const,
        value: { type: "id" as const, tableName: "users" },
      }
    : { type: "id" as const, tableName: "users" };
  const relationValue = valueCardinality === "many"
    ? {
        cardinality: "many" as const,
        minItems: 0,
        maxItems: 500,
        ordered: true,
        duplicates: "forbid" as const,
      }
    : { cardinality: "one" as const, required: true };
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
              fieldType: authorFieldType,
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
          value: relationValue,
          inverse: { cardinality: "many", name: "posts" },
          localized: false,
          onTargetDelete: "restrict",
        },
      }],
    },
    functions: [],
  })).manifest;
}
