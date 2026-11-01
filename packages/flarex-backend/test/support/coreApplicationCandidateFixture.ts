import { canonicalizeApplicationManifest } from "@flarex/analysis/application-analysis";
import { createCoreApplicationDefinition } from "../../../system-test/support/applicationCoreDefinition";
import { createApplicationNativeMutationSourceBundle } from "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { createHash } from "node:crypto";
import { Result } from "effect";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import type { AuthConfig } from "flarex-protocol/auth";
import { SOURCE_ARTIFACT_V2_ROLE_FUNCTION } from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import type { CoreApplicationCandidate, CoreApplicationCoreProfile } from "flarex-protocol/internal/core-application";
import type { PushSourcePackage } from "../../src/types";
import { sourceModuleSha256ForTest } from "../sourcePackageHashFixture";

let definition: ReturnType<typeof createCoreApplicationDefinition> | undefined;

/** Real analyzed metadata for transport-boundary tests; full public installation is proved separately. */
export async function coreApplicationCandidateFixture(deploymentId: string, authConfig?: AuthConfig) {
  const current = await (definition ??= ordinaryDefinition());
  const sourcePackage: PushSourcePackage = {
    modules: current.source.modules.map(module => ({ path: module.path, environment: "isolate", source: module.source,
      sha256: sourceModuleSha256ForTest(module.source) })),
    functions: current.source.modules.filter(module => (module.roles & SOURCE_ARTIFACT_V2_ROLE_FUNCTION) !== 0).map(module => module.path),
    execution: current.source.sourceArtifact.executionModulePath,
    sourceModuleDigestFormat: "sha256-framed-v1",
    ...(current.source.sourceArtifact.schemaModulePath === null ? {} : { schema: current.source.sourceArtifact.schemaModulePath }),
    ...(authConfig === undefined ? {} : { authConfig }),
  };
  const reference = await executionArtifactRefForSourcePackage(sourcePackage);
  const route = { deploymentId, scopeUuid: "11111111-1111-4111-8111-111111111111", epochUuid: "22222222-2222-4222-8222-222222222222" };
  const candidate: CoreApplicationCandidate = { format: "flarex.core-application.candidate", version: 1, route,
    pushId: "public-core-candidate", state: "active", sourcePackage,
    sourceArtifactRootSha256: current.source.sourceArtifact.rootSha256,
    sourcePackageHash: reference.sourcePackageHash,
    canonicalManifest: Result.getOrThrow(canonicalizeApplicationManifest(current.manifest)).canonicalText,
    createdAt: 1000, updatedAt: 2000, indexesReady: true };
  const profile: CoreApplicationCoreProfile = { format: "flarex.core-application.profile", version: 1, kind: "core", route,
    sourceArtifactRootSha256: candidate.sourceArtifactRootSha256, sourcePackageHash: candidate.sourcePackageHash };
  const control = { format: "flarex.core-application.control" as const, version: 1 as const, kind: "core" as const,
    route, maximumPushRequestBytes: 1_048_576 };
  return { candidate, profile, control, sourcePackage, manifest: current.manifest };
}

async function ordinaryDefinition() {
  const source = await createApplicationNativeMutationSourceBundle(false, 0, 0, true, false, false, true, true);
  const modules = source.modules.map(module => {
    const text = module.source.replace("  notify: action({ handler: users.notify }),\n", "");
    const bytes = new TextEncoder().encode(text);
    return { ...module, source: text, sourceSha256: createHash("sha256").update(bytes).digest("hex"), sourceByteLength: bytes.byteLength };
  });
  const rootSha256 = createHash("sha256").update(modules.map(module => `${module.path}:${module.sourceSha256}`).join("\n")).digest("hex");
  return createCoreApplicationDefinition({ modules, sourceArtifact: { ...source.sourceArtifact, rootSha256,
    modules: modules.map(({ source: _source, ...module }) => module) } });
}
