import { createApplicationNativeMutationSourceBundle, type ApplicationNativeMutationSourceBundle } from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import type { ApplicationCoreDefinition } from
  "@flarex/persistence-postgres/internal/system-test/core-application-fixture";
import { APPLICATION_ANALYSIS_ANALYZER_IDENTITY, APPLICATION_ANALYSIS_POLICY_IDENTITY,
  applicationAnalysisHostEffectWithCapabilities } from "@flarex/source-analyzer-v2/internal/application-analysis-host";
import { Effect } from "effect";
import { MiniflareApplicationAnalysisWorkerLoader } from "./standardApplicationCurrentAnalysisHarness";
import { runSystemTestEffectV1 } from "./systemTestEffectBoundaryV1";

/** Genuine cold Analysis shared by fresh portable and actual-host test composition. */
export async function createCoreApplicationDefinition(
  suppliedSource?: ApplicationNativeMutationSourceBundle,
): Promise<ApplicationCoreDefinition> {
  const source = suppliedSource ?? await createApplicationNativeMutationSourceBundle(false, 0, 0, true, false, false, true, true);
  const loader = new MiniflareApplicationAnalysisWorkerLoader();
  try {
    const analysis = await runSystemTestEffectV1(applicationAnalysisHostEffectWithCapabilities({
      source: { read: rootSha256 => rootSha256 === source.sourceArtifact.rootSha256
        ? Effect.succeed(source) : Effect.die("Core Application analysis requested a foreign source artifact.") },
      loader,
    }, { format: "flarex.application-analysis-host-request", version: 1,
      sourceArtifactRootSha256: source.sourceArtifact.rootSha256,
      analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
      analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
    }));
    if (analysis.kind !== "analyzed") throw new Error("Core Application cold registration was rejected.", { cause: analysis });
    if (analysis.manifest.version !== 1)
      throw new Error("The core fixture requires a relation-free Application Manifest V1.");
    return Object.freeze({ source, manifest: analysis.manifest, coldAnalysisLoads: loader.loads });
  } finally { await loader.dispose(); }
}

/** Literal declarations execute through the same cold SDK/Analysis owner. */
export async function createCoreLiteralApplicationDefinition(): Promise<ApplicationCoreDefinition> {
  return createCoreApplicationDefinition(await createApplicationNativeMutationSourceBundle(
    false, 0, 0, true, false, false, true, true, false, true,
  ));
}
