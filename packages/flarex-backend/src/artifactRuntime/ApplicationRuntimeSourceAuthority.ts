import type { ApplicationManifestV1 } from
  "@flarex/analysis/application-analysis";

import type { ApplicationAnalysisSourceBundle } from
  "../sourceArtifactV2/ApplicationAnalysisReader";

export function applicationRuntimeSourceMatchesManifest(
  source: ApplicationAnalysisSourceBundle,
  manifest: ApplicationManifestV1,
): boolean {
  const expected = manifest.sourceArtifact;
  const observed = source.sourceArtifact;
  if (
    observed.rootSha256 !== expected.rootSha256 ||
    observed.executionModulePath !== expected.executionModulePath ||
    observed.schemaModulePath !== expected.schemaModulePath ||
    observed.modules.length !== expected.modules.length ||
    source.modules.length !== expected.modules.length
  ) return false;
  for (let index = 0; index < expected.modules.length; index += 1) {
    const expectedModule = expected.modules[index];
    const observedIdentity = observed.modules[index];
    const observedModule = source.modules[index];
    if (
      expectedModule === undefined || observedIdentity === undefined ||
      observedModule === undefined ||
      observedIdentity.path !== expectedModule.path ||
      observedIdentity.roles !== expectedModule.roles ||
      observedIdentity.sourceSha256 !== expectedModule.sourceSha256 ||
      observedIdentity.sourceByteLength !== expectedModule.sourceByteLength ||
      observedModule.path !== expectedModule.path ||
      observedModule.roles !== expectedModule.roles ||
      observedModule.sourceSha256 !== expectedModule.sourceSha256 ||
      observedModule.sourceByteLength !== expectedModule.sourceByteLength
    ) return false;
  }
  return true;
}
