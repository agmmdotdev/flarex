import { Encoding } from "effect";

import type {
  PointCommitConflictEvidenceV1,
  PointCommitPublicationCommandV1,
} from
  "@flarex/persistence-postgres/point-commit-transaction";
import type { PointMutationSessionAttemptSelectorV1 } from
  "@flarex/persistence-postgres/transaction-session-activation";

import type {
  PointMutationExecutionClaimV1,
  PointMutationExecutionScopeV1,
} from "../pointMutationExecutionClaim";
import type { LoadedPointMutationSessionAttemptV1 } from
  "../pointMutationSessionActivation";
import type {
  AuthenticatedCommitAuthorityStateV1,
  AuthenticatedStoredAttemptStateV1,
  AuthorizedPointMutationOccRerunInspectionV1,
  FinishingPreparedPointCommitV1,
  StoredAttemptAuthorityStateV1,
  StoredAttemptSessionScalarsPortV1,
} from "../storedAttemptAuthentication";
import type { VerifiedCommitInputStateV1 } from
  "./commitInputVerification";
import type { PreparedPointCommitStateV1 } from "./pointCommitPlanning";

export interface PointCommitScalarProvenanceV1 {
  readonly authority: Readonly<StoredAttemptAuthorityStateV1>;
  readonly session: Readonly<StoredAttemptSessionScalarsPortV1>;
  readonly executionClaim: PointMutationExecutionScopeV1 | null;
}

export interface VerifiedCommitCapabilityStateV1 {
  readonly input: VerifiedCommitInputStateV1;
  readonly provenance: PointCommitScalarProvenanceV1;
  /** Complete authenticated execution provenance retained privately for B2. */
  readonly executionAuthority: AuthenticatedCommitAuthorityStateV1;
}

export interface PreparedPointCommitCapabilityStateV1 {
  readonly plan: PreparedPointCommitStateV1;
  readonly provenance: PointCommitScalarProvenanceV1;
  readonly executionAuthority: AuthenticatedCommitAuthorityStateV1;
}

export type CapturedPointMutationOccConflictV1 = PointCommitConflictEvidenceV1;

export interface PointMutationOccConflictTicketStateV1 {
  readonly finishing: FinishingPreparedPointCommitV1;
  readonly prepared: PreparedPointCommitCapabilityStateV1;
  readonly conflict: CapturedPointMutationOccConflictV1;
}

export interface PointCommitDecisionUncertainTicketStateV1 {
  readonly finishing: FinishingPreparedPointCommitV1;
  readonly prepared: PreparedPointCommitCapabilityStateV1;
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly command: PointCommitPublicationCommandV1;
}

export interface AuthorizedPointMutationOccRerunStateV1 {
  readonly loadedAttempt: LoadedPointMutationSessionAttemptV1;
  readonly executionClaim: PointMutationExecutionClaimV1;
  readonly prepared: PreparedPointCommitCapabilityStateV1;
  readonly conflict: CapturedPointMutationOccConflictV1;
  readonly inspection: AuthorizedPointMutationOccRerunInspectionV1;
}

export interface StoredPointMutationCapabilityVaultV1 {
  readonly authorityStates: WeakMap<
    object,
    Readonly<{
      readonly authority: StoredAttemptAuthorityStateV1;
      readonly executionScope: PointMutationExecutionScopeV1;
    }>
  >;
  readonly authenticatedStates: WeakMap<
    object,
    AuthenticatedStoredAttemptStateV1
  >;
  readonly commitAuthorityStates: WeakMap<
    object,
    AuthenticatedCommitAuthorityStateV1
  >;
  readonly verifiedCommitInputStates: WeakMap<
    object,
    VerifiedCommitCapabilityStateV1
  >;
  readonly preparedPointCommitStates: WeakMap<
    object,
    PreparedPointCommitCapabilityStateV1
  >;
  readonly finishingPreparedPointCommitStates: WeakSet<object>;
  readonly decisionUncertainTickets: WeakMap<
    object,
    PointCommitDecisionUncertainTicketStateV1
  >;
  readonly capturedDecisionUncertainties: WeakSet<object>;
  readonly consumedDecisionUncertainties: WeakSet<object>;
  readonly occConflictTickets: WeakMap<
    object,
    PointMutationOccConflictTicketStateV1
  >;
  readonly capturedOccConflicts: WeakSet<object>;
  readonly consumedOccConflicts: WeakSet<object>;
  readonly authorizedOccRerunStates: WeakMap<
    object,
    AuthorizedPointMutationOccRerunStateV1
  >;
  readonly mintedAuthorizedOccReruns: WeakSet<object>;
  readonly consumedAuthorizedOccReruns: WeakSet<object>;
}

export function makeStoredPointMutationCapabilityVaultV1():
  StoredPointMutationCapabilityVaultV1 {
  return Object.freeze({
    authorityStates: new WeakMap(),
    authenticatedStates: new WeakMap(),
    commitAuthorityStates: new WeakMap(),
    verifiedCommitInputStates: new WeakMap(),
    preparedPointCommitStates: new WeakMap(),
    finishingPreparedPointCommitStates: new WeakSet(),
    decisionUncertainTickets: new WeakMap(),
    capturedDecisionUncertainties: new WeakSet(),
    consumedDecisionUncertainties: new WeakSet(),
    occConflictTickets: new WeakMap(),
    capturedOccConflicts: new WeakSet(),
    consumedOccConflicts: new WeakSet(),
    authorizedOccRerunStates: new WeakMap(),
    mintedAuthorizedOccReruns: new WeakSet(),
    consumedAuthorizedOccReruns: new WeakSet(),
  } satisfies StoredPointMutationCapabilityVaultV1);
}

export function serializePrivateCapabilityStateForTestV1(
  state: unknown,
  onUndefined: () => Error,
): string {
  const serialized = JSON.stringify(
    state,
    (_key: string, value: unknown): unknown => {
      if (typeof value === "bigint") {
        return Object.freeze({ bigint: value.toString() });
      }
      if (value instanceof Uint8Array) {
        return Object.freeze({
          bytes: Encoding.encodeBase64Url(value),
        });
      }
      return value;
    },
  );
  if (serialized === undefined) {
    throw onUndefined();
  }
  return serialized;
}
