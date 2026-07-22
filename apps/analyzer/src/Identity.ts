import {
  isPrivateAnalyzerIdentityV1,
  PRIVATE_ANALYZER_DEPLOYMENT_POSTURE_V1,
  PRIVATE_ANALYZER_PROTOCOL_IDENTITY_V1,
  PRIVATE_ANALYZER_PROTOCOL_VERSION_V1,
  privateAnalyzerHostConfigurationV1,
} from "./Configuration";
import { GENERATED_PRIVATE_ANALYZER_IDENTITY_V1 } from "./Identity.generated";

export function installedPrivateAnalyzerIdentityV1() {
  const marker = GENERATED_PRIVATE_ANALYZER_IDENTITY_V1.implementationIdentityMarker;
  const identityStart = GENERATED_PRIVATE_ANALYZER_IDENTITY_V1.implementationIdentityOffset;
  const identityEnd = identityStart +
    GENERATED_PRIVATE_ANALYZER_IDENTITY_V1.implementationIdentityLength;
  const implementationIdentity = marker.slice(identityStart, identityEnd);
  const configurationIdentity = GENERATED_PRIVATE_ANALYZER_IDENTITY_V1.configurationIdentity;
  if (
    !isPrivateAnalyzerIdentityV1(implementationIdentity) ||
    !isPrivateAnalyzerIdentityV1(configurationIdentity)
  ) {
    throw new Error("Private analyzer generated identity is malformed.");
  }
  return Object.freeze({
    configuration: privateAnalyzerHostConfigurationV1(
      GENERATED_PRIVATE_ANALYZER_IDENTITY_V1.toolchain,
      PRIVATE_ANALYZER_DEPLOYMENT_POSTURE_V1,
    ),
    identity: Object.freeze({
      protocolIdentity: PRIVATE_ANALYZER_PROTOCOL_IDENTITY_V1,
      protocolVersion: PRIVATE_ANALYZER_PROTOCOL_VERSION_V1,
      implementationIdentity,
      configurationIdentity,
    }),
  });
}
