import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  hashCanonicalTaskCatalogV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  produceApplicationTaskBindingsV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { Result } from "effect";
import {
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
  type ApplicationAnalysisProjection,
} from "../../../src/application/applicationAnalysisRegistration";
import { makeApplicationPublicationRepository } from "../../../src/application/applicationPublication";
import {
  makeApplicationTaskBindingRepository,
} from "../../../src/application/tasks/applicationTaskBindings";
import { runEffect } from "../../support/effectTestRuntime";
import {
  ROOT,
  RUNTIME_HOST_IDENTITY,
  COMPATIBILITY_DATE,
  taskSha256,
  applicationManifest,
  preparedDefinition,
  taskManifest,
} from "./readinessArtifacts";
import { type TestPersistence, readinessFixture } from "./readinessFixture";
import { uuidSequence } from "./readinessEvidence";

export async function createApplicationRevision(
  target: TestPersistence,
  authority: ApplicationAnalysisAuthority,
  manifest: Readonly<{
    readonly manifest: ApplicationManifestV1;
    readonly canonicalText: string;
  }>,
  options: Readonly<{
    requestKey?: string;
    uuidSequences?: ReadonlyArray<number>;
  }> = {},
): Promise<Extract<ApplicationAnalysisProjection, { readonly status: "analyzed" }>> {
  const sequences = options.uuidSequences ?? [11, 12, 13];
  const analyses = makeApplicationAnalysisRepository(target.drizzle, {
    randomUuid: uuidSequence(...sequences),
  });
  const pending = await runEffect(analyses.begin({
    authority,
    requestKey: options.requestKey ?? "request:application-readiness:1",
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: "application-analyzer",
    analyzerPolicyIdentity: "application-analyzer-policy",
  }));
  const analyzed = await runEffect(analyses.settle(authority, {
    kind: "analyzed",
    candidateId: pending.candidateId,
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: "application-analyzer",
    analyzerPolicyIdentity: "application-analyzer-policy",
    canonicalManifest: manifest.canonicalText,
  }));
  if (analyzed.status !== "analyzed") {
    throw new Error("Expected analyzed Application readiness fixture.");
  }
  return analyzed;
}

export async function createAdditionalApplicationRevision(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  includeTask = false,
): Promise<string> {
  const manifest = applicationManifest(true, false);
  const analysis = await createApplicationRevision(
    fixture.target,
    fixture.authority,
    manifest,
    {
      requestKey: "request:application-readiness:2",
      uuidSequences: [21, 22, 23],
    },
  );
  const publication = await runEffect(
    makeApplicationPublicationRepository(fixture.target.drizzle).publish({
      authority: fixture.authority,
      revisionId: analysis.revision.revisionId,
      candidateId: analysis.candidateId,
      analysisId: analysis.analysisId,
      manifestSha256: analysis.manifestSha256,
      manifest: Result.getOrThrow(
        canonicalizeApplicationManifestV1(analysis.manifest),
      ).manifest,
    }),
  );
  const catalog = await runEffect(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: includeTask ? [taskManifest()] : [],
  }, taskSha256));
  const bindings = await runEffect(produceApplicationTaskBindingsV1({
    definition: preparedDefinition(),
    catalog,
    authority: {
      scopeId: publication.scopeId,
      revisionId: publication.revisionId,
      candidateId: publication.candidateId,
      analysisId: publication.analysisId,
      sourceArtifactRootSha256: publication.sourceArtifactRootSha256,
      publicationSha256: publication.publicationSha256,
    },
    runtimePolicy: {
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
    },
  }, taskSha256));
  await runEffect(
    makeApplicationTaskBindingRepository(fixture.target.drizzle).register({
      authority: fixture.authority,
      bindings,
    }),
  );
  return publication.revisionId;
}
