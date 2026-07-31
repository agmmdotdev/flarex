import type {
  DeclarativeV2AuthenticatedCommandProducerApiV1,
} from "./AuthenticatedCommandProducer";

export {
  DECLARATIVE_V2_DEPLOYMENT_ANALYSIS_CODEC_IDENTITY_V1,
  DECLARATIVE_V2_DEPLOYMENT_CODEGEN_ANALYSIS_CODEC_IDENTITY_V1,
} from "./AuthenticatedCommandProducer";
export type {
  DeclarativeV2AuthenticatedCommandProducerV1Error,
  DeclarativeV2AuthenticatedRegistrationCandidateV1,
  DeclarativeV2AuthenticatedRegistrationCommandV1,
  DeclarativeV2AuthenticatedRegistrationEvidenceV1,
} from "./AuthenticatedCommandProducer";

export type DeclarativeV2AuthenticatedApplicationRevisionEvidencePortV1 =
  Pick<
    DeclarativeV2AuthenticatedCommandProducerApiV1,
    | "issueRegistrationEvidence"
    | "bindRegistrationEvidence"
    | "claimRegistrationCandidate"
    | "claimRegistrationCommand"
  >;

/**
 * Narrows the request-scoped authenticated command producer to the only
 * registration-evidence operations the private Standard composition needs.
 * The returned port cannot produce commands or inspect backend read sessions.
 */
export function makeDeclarativeV2AuthenticatedApplicationRevisionEvidencePortV1(
  producer: DeclarativeV2AuthenticatedCommandProducerApiV1,
): DeclarativeV2AuthenticatedApplicationRevisionEvidencePortV1 {
  return Object.freeze({
    issueRegistrationEvidence: producer.issueRegistrationEvidence,
    bindRegistrationEvidence: producer.bindRegistrationEvidence,
    claimRegistrationCandidate: producer.claimRegistrationCandidate,
    claimRegistrationCommand: producer.claimRegistrationCommand,
  });
}
