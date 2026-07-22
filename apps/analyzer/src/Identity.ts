import {
  GENERATED_PRIVATE_ANALYZER_RELEASE_MANIFEST_V1,
  installedPrivateAnalyzerReleaseTupleV1,
} from "@flarex/analysis/internal/private-analyzer-release-v1";
import {
  PRIVATE_ANALYZER_DEPLOYMENT_POSTURE_V1,
  privateAnalyzerHostConfigurationV1,
} from "./Configuration";

export function installedPrivateAnalyzerIdentityV1() {
  return Object.freeze({
    configuration: privateAnalyzerHostConfigurationV1(
      GENERATED_PRIVATE_ANALYZER_RELEASE_MANIFEST_V1.toolchain,
      PRIVATE_ANALYZER_DEPLOYMENT_POSTURE_V1,
    ),
    identity: installedPrivateAnalyzerReleaseTupleV1(),
  });
}
