import {
  APPLICATION_MANIFEST_FORMAT_V1,
  canonicalizeApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
  type ApplicationAnalysisProjection,
} from "@flarex/persistence-postgres/internal/application-analysis-registration";
import {
  applicationRuntimeTargetFromPublication,
  makeApplicationPublicationRepository,
  type ApplicationPublication,
} from "@flarex/persistence-postgres/internal/application-publication";
import type { StandardApplicationAnalysis } from
  "@flarex/standard-application-analysis/application";
import { Effect, Result } from "effect";
import { SOURCE_ARTIFACT_V2_ROLE_EXECUTION } from
  "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import type { CanonicalApplicationRuntimeTargetV1 } from
  "flarex-protocol/internal/application-runtime-target-v1";
import {
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";

import {
  APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
  APPLICATION_ANALYSIS_HOST_FORMAT,
  APPLICATION_ANALYSIS_HOST_VERSION,
  APPLICATION_ANALYSIS_POLICY_IDENTITY,
} from "../src/ApplicationAnalysisHost";
import { makeApplicationAnalysisContext } from
  "../src/ApplicationAnalysisComposition";

const ROOT = "a".repeat(64);
const SOURCE = "b".repeat(64);

type AnalysisDatabase = Parameters<typeof makeApplicationAnalysisRepository>[0];

export interface ConnectedAnalysisPersistence {
  readonly drizzle: AnalysisDatabase;
  readonly query: <Row extends Record<string, unknown>>(
    text: string,
    values?: ReadonlyArray<unknown>,
  ) => Promise<Readonly<{ readonly rows: Row[] }>>;
}

export interface ConnectedApplicationAnalysisProof {
  readonly first: StandardApplicationAnalysis;
  readonly replay: StandardApplicationAnalysis;
  readonly stored: Extract<ApplicationAnalysisProjection, { status: "analyzed" }>;
  readonly publication: ApplicationPublication;
  readonly runtimeTarget: CanonicalApplicationRuntimeTargetV1;
  readonly hostCalls: number;
  readonly revisionCount: string | undefined;
}

export async function proveConnectedApplicationAnalysis(
  persistence: ConnectedAnalysisPersistence,
  identity: string,
): Promise<ConnectedApplicationAnalysisProof> {
  const authority: ApplicationAnalysisAuthority = Object.freeze({
    scopeId: ScopeIdSchema.make(`scope_application_analysis_${identity}`),
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(1n),
    epoch: ScopeEpochSchema.make(`epoch_application_analysis_${identity}`),
  });
  await persistence.query(
    `insert into fx_system_scope_clock
      (scope_id, storage_generation, storage_generation_fence,
       last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
    [authority.scopeId, authority.epoch],
  );

  const repository = makeApplicationAnalysisRepository(persistence.drizzle);
  const canonical = Result.getOrThrow(canonicalizeApplicationManifestV1({
    format: APPLICATION_MANIFEST_FORMAT_V1,
    version: 1,
    sourceArtifact: {
      rootSha256: ROOT,
      executionModulePath: "_flarex/application.js",
      schemaModulePath: null,
      modules: [{
        path: "_flarex/application.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: SOURCE,
        sourceByteLength: 64,
      }],
    },
    schema: { version: 1, tables: [], indexes: [] },
    functions: [{
      path: "status:get",
      moduleName: "status",
      exportName: "get",
      kind: "query",
      visibility: "public",
      args: { type: "object", value: {} },
      returns: { type: "null" },
      partition: null,
    }],
  }));
  let hostCalls = 0;
  const analysis = makeApplicationAnalysisContext({
    authority,
    repository,
    host: {
      analyze: () => {
        hostCalls += 1;
        return Effect.succeed(Object.freeze({
          format: APPLICATION_ANALYSIS_HOST_FORMAT,
          version: APPLICATION_ANALYSIS_HOST_VERSION,
          kind: "analyzed" as const,
          sourceArtifactRootSha256: ROOT,
          analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
          analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
          manifest: canonical.manifest,
          canonicalManifest: canonical.canonicalText,
        }));
      },
    },
  });
  const request = Object.freeze({
    requestKey: `request:application-analysis:${identity}`,
    sourceArtifactRootSha256: ROOT,
  });
  const first = await Effect.runPromise(analysis.analyze(request));
  const replay = await Effect.runPromise(analysis.analyze(request));
  if (first.kind !== "analyzed") {
    throw new Error("Connected Application Analysis did not analyze the source.");
  }
  const stored = await Effect.runPromise(
    repository.inspect(authority, first.receipt.candidateId),
  );
  if (stored.status !== "analyzed") {
    throw new Error("Connected Application Analysis revision was not retained.");
  }

  const publication = await Effect.runPromise(
    makeApplicationPublicationRepository(persistence.drizzle).publish({
      authority,
      revisionId: stored.revision.revisionId,
      candidateId: stored.candidateId,
      analysisId: stored.analysisId,
      manifestSha256: stored.manifestSha256,
      manifest: stored.manifest,
    }),
  );
  const runtimeTarget = Result.getOrThrow(
    applicationRuntimeTargetFromPublication(publication, "status:get"),
  );
  const revisions = await persistence.query<{ readonly count: string }>(
    "select count(*)::text as count from fx_system_application_revision_v2 where scope_id = $1",
    [authority.scopeId],
  );

  return Object.freeze({
    first,
    replay,
    stored,
    publication,
    runtimeTarget,
    hostCalls,
    revisionCount: revisions.rows[0]?.count,
  });
}
