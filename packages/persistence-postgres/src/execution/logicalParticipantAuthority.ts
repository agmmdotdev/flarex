/** Trusted consumers may inspect selected source authority, but only the
 * persistence source issuers can construct it from catalog and binding state. */
export {
  hasLogicalParticipantAttemptAdmission,
  inspectLogicalParticipantAttemptAdmission,
  inspectLogicalParticipantAdmissionBundle,
  hasLogicalParticipantCommitAuthority,
  inspectLogicalParticipantCommitAuthority,
  inspectLogicalParticipantCommitAuthoritySource,
  requireLogicalParticipantCommitAuthorityEffect,
} from "../storage/documents/logicalDocuments/participantAdmission";
export type { LogicalParticipantAttemptAdmission, LogicalParticipantCommitAuthority,
  LogicalParticipantAdmissionBundle,
  LogicalParticipantSelection, LogicalParticipantAttemptRoot,
  LogicalParticipantAttemptReadTransaction } from "../storage/documents/logicalDocuments/participantAdmission";
