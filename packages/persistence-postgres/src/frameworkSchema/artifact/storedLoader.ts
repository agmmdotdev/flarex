import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect } from "effect";

import type { FlarexMetadataDatabase } from "../../deployments";
import { detachDriverRows } from "../../detachDriverRows";
import { runDrizzleStatementEffect } from "../../drizzleStatementEffect";
import type { FrameworkSchemaArtifactPersistenceStage } from "./errors";
import type { DecodedFrameworkSchemaArtifactIdentity } from "./policy";
import {
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES,
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_DEPENDENCIES,
} from "./policy";
import {
  fxControlFrameworkSchemaArtifactDependencies,
  fxControlFrameworkSchemaArtifacts,
} from "./schema";
import type {
  StoredFrameworkSchemaArtifactDependencyRow,
  StoredFrameworkSchemaArtifactRow,
} from "./storedCodec";

export type FrameworkSchemaArtifactStoredQueryStage = Extract<
  FrameworkSchemaArtifactPersistenceStage,
  "readArtifact" | "readDependencies"
>;

export interface FrameworkSchemaArtifactStoredQueryIssue {
  readonly _tag: "FrameworkSchemaArtifactStoredQueryIssue";
  readonly persistenceStage: FrameworkSchemaArtifactStoredQueryStage;
  readonly cause: unknown;
}

export interface DetachedStoredFrameworkSchemaArtifact {
  readonly artifactRow: StoredFrameworkSchemaArtifactRow;
  readonly dependencyRows:
    readonly StoredFrameworkSchemaArtifactDependencyRow[];
}

export interface LoadStoredFrameworkSchemaArtifactInput {
  readonly decodedIdentity: DecodedFrameworkSchemaArtifactIdentity;
  readonly observePersistenceStage: (
    stage: FrameworkSchemaArtifactStoredQueryStage,
  ) => void;
}

const dependencyTargetArtifact = alias(
  fxControlFrameworkSchemaArtifacts,
  "fx_framework_artifact_dependency_target",
);

/** Load and detach stored rows without assigning a caller operation. */
export const loadStoredFrameworkSchemaArtifactEffect = Effect.fn(
  "FrameworkSchemaArtifactStoredLoader.load",
)(function* (
  database: FlarexMetadataDatabase,
  input: LoadStoredFrameworkSchemaArtifactInput,
): Effect.fn.Return<
  DetachedStoredFrameworkSchemaArtifact | null,
  FrameworkSchemaArtifactStoredQueryIssue
> {
  const { identity, artifactSha256Bytes } = input.decodedIdentity;
  input.observePersistenceStage("readArtifact");
  const artifactQuery = database.select({
    artifactStorageId:
      fxControlFrameworkSchemaArtifacts.artifactStorageId,
    deploymentId: fxControlFrameworkSchemaArtifacts.deploymentId,
    owner: fxControlFrameworkSchemaArtifacts.owner,
    lineageId: fxControlFrameworkSchemaArtifacts.lineageId,
    artifactSha256: fxControlFrameworkSchemaArtifacts.artifactSha256,
    frameFormat: fxControlFrameworkSchemaArtifacts.frameFormat,
    frameVersion: fxControlFrameworkSchemaArtifacts.frameVersion,
    canonicalByteLength:
      fxControlFrameworkSchemaArtifacts.canonicalByteLength,
    observedCanonicalByteLength: sql<number>`octet_length(
      ${fxControlFrameworkSchemaArtifacts.canonicalBytes}
    )`,
    canonicalBytes: sql<Uint8Array | null>`case
      when octet_length(${fxControlFrameworkSchemaArtifacts.canonicalBytes})
        <= ${MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES}
      then ${fxControlFrameworkSchemaArtifacts.canonicalBytes}
      else null
    end`,
    admittedAt: fxControlFrameworkSchemaArtifacts.admittedAt,
  }).from(fxControlFrameworkSchemaArtifacts).where(and(
    eq(
      fxControlFrameworkSchemaArtifacts.deploymentId,
      identity.deploymentId,
    ),
    eq(fxControlFrameworkSchemaArtifacts.owner, identity.owner),
    eq(fxControlFrameworkSchemaArtifacts.lineageId, identity.lineageId),
    eq(
      fxControlFrameworkSchemaArtifacts.artifactSha256,
      artifactSha256Bytes,
    ),
  )).limit(1);
  const artifactRows = yield* executeStoredQueryEffect(
    artifactQuery,
    "readArtifact",
  ).pipe(Effect.map(detachDriverRows));
  const artifactRow = artifactRows[0];
  if (artifactRow === undefined) return null;

  input.observePersistenceStage("readDependencies");
  const dependencyQuery = database.select({
    artifactStorageId:
      fxControlFrameworkSchemaArtifactDependencies.artifactStorageId,
    dependencyStorageId:
      fxControlFrameworkSchemaArtifactDependencies.dependencyStorageId,
    deploymentId:
      fxControlFrameworkSchemaArtifactDependencies.deploymentId,
    owner: fxControlFrameworkSchemaArtifactDependencies.owner,
    artifactLineageId:
      fxControlFrameworkSchemaArtifactDependencies.artifactLineageId,
    dependencyOrdinal:
      fxControlFrameworkSchemaArtifactDependencies.dependencyOrdinal,
    dependencyLineageId:
      fxControlFrameworkSchemaArtifactDependencies.dependencyLineageId,
    dependencyArtifactSha256: dependencyTargetArtifact.artifactSha256,
    dependencyRowCountText: sql<string>`(
      count(*) over ()
    )::text`,
  }).from(fxControlFrameworkSchemaArtifactDependencies).leftJoin(
    dependencyTargetArtifact,
    and(
      eq(
        dependencyTargetArtifact.artifactStorageId,
        fxControlFrameworkSchemaArtifactDependencies.dependencyStorageId,
      ),
      eq(
        dependencyTargetArtifact.deploymentId,
        fxControlFrameworkSchemaArtifactDependencies.deploymentId,
      ),
      eq(
        dependencyTargetArtifact.owner,
        fxControlFrameworkSchemaArtifactDependencies.owner,
      ),
      eq(
        dependencyTargetArtifact.lineageId,
        fxControlFrameworkSchemaArtifactDependencies.dependencyLineageId,
      ),
    ),
  ).where(eq(
    fxControlFrameworkSchemaArtifactDependencies.artifactStorageId,
    artifactRow.artifactStorageId,
  )).orderBy(asc(
    fxControlFrameworkSchemaArtifactDependencies.dependencyOrdinal,
  )).limit(MAX_FRAMEWORK_SCHEMA_ARTIFACT_DEPENDENCIES);
  const dependencyRows = yield* executeStoredQueryEffect(
    dependencyQuery,
    "readDependencies",
  ).pipe(Effect.map(detachDriverRows));

  return Object.freeze({ artifactRow, dependencyRows });
});

function executeStoredQueryEffect<Row extends object>(
  query: PromiseLike<ReadonlyArray<Row>>,
  persistenceStage: FrameworkSchemaArtifactStoredQueryStage,
): Effect.Effect<
  ReadonlyArray<Row>,
  FrameworkSchemaArtifactStoredQueryIssue,
  never
> {
  return runDrizzleStatementEffect(query, cause => Object.freeze({
    _tag: "FrameworkSchemaArtifactStoredQueryIssue" as const,
    persistenceStage,
    cause,
  }));
}
