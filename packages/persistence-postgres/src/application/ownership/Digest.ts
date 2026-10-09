import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { ApplicationWriteOwnershipError, MAX_WRITE_OWNERSHIP_HISTORY_BYTES } from "./Model";

const digest = makeLivePrivateSha256V1({
  invalidBudget: () => new ApplicationWriteOwnershipError({ reason: "historyLimit" }),
  invalidBytes: () => new ApplicationWriteOwnershipError({ reason: "invalidEvidence" }),
  inputBytesExceeded: () => new ApplicationWriteOwnershipError({ reason: "historyLimit" }),
  unavailable: () => new ApplicationWriteOwnershipError({ reason: "resourceFailure" }),
  nativeRejected: cause => new ApplicationWriteOwnershipError({ reason: "resourceFailure", cause }),
  invalidDigestOutput: () => new Error("Invalid ownership SHA-256 output"),
});

export const digestApplicationWriteOwnership = (bytes: Uint8Array) => digest(bytes, { maximumInputBytes: MAX_WRITE_OWNERSHIP_HISTORY_BYTES });
