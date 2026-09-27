/** Trusted consumers may inspect selected source authority, but only the
 * persistence source issuers can construct it from catalog and binding state. */
export { LogicalParticipantAdmissionError, LogicalParticipantInvocationError,
  hasLogicalParticipantAttemptAdmission, inspectLogicalParticipantAttemptAdmission,
  hasLogicalParticipantCommitAuthority, inspectLogicalParticipantCommitAuthority,
  requireLogicalParticipantCommitAuthorityEffect } from "./logicalDocuments/participantAdmission";
export type { LogicalParticipantAttemptAdmission, LogicalParticipantCommitAuthority,
  LogicalParticipantSelection, LogicalParticipantAttemptRoot,
  LogicalParticipantAttemptReadTransaction } from "./logicalDocuments/participantAdmission";
