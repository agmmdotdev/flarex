import { Option } from "effect";
import type { CommitSeq, ScopeId } from
  "flarex-protocol/storage-authority";

import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { scopePhysicalLocatorsEqual } from "./scopePhysicalLocator";

export interface RetainedHistoryPageExpectation {
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly physicalLocator: ScopePhysicalLocator;
  readonly storageGeneration: TrustedScopeAuthority["storageGeneration"];
  readonly storageGenerationFence:
    TrustedScopeAuthority["storageGenerationFence"];
  readonly epoch: TrustedScopeAuthority["epoch"];
  readonly retainedFloor: CommitSeq;
}

/** A no-write result produced under the owner page's scope-clock lock. */
export interface RetainedHistoryPageGuardChangedResult {
  readonly status: "compacted";
  readonly disposition: "guardChanged";
  readonly reason: "authorityChanged" | "floorChanged";
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly expectedRetainedFloor: CommitSeq;
  readonly retainedFloor: CommitSeq;
}

export function retainedHistoryPageGuardChanged(
  authority: TrustedScopeAuthority,
  retainedFloor: CommitSeq,
  expectation: RetainedHistoryPageExpectation | null,
): Option.Option<RetainedHistoryPageGuardChangedResult> {
  if (expectation === null) return Option.none();
  const reason = authorityMatchesExpectation(authority, expectation)
    ? retainedFloor === expectation.retainedFloor
      ? null
      : "floorChanged" as const
    : "authorityChanged" as const;
  return reason === null
    ? Option.none()
    : Option.some(Object.freeze({
        status: "compacted" as const,
        disposition: "guardChanged" as const,
        reason,
        deploymentId: authority.deploymentId,
        scopeId: authority.scopeId,
        expectedRetainedFloor: expectation.retainedFloor,
        retainedFloor,
      }));
}

function authorityMatchesExpectation(
  authority: TrustedScopeAuthority,
  expectation: RetainedHistoryPageExpectation,
): boolean {
  return authority.scopeId === expectation.scopeId &&
    scopePhysicalLocatorsEqual(
      authority.physicalLocator,
      expectation.physicalLocator,
    ) &&
    authority.storageGeneration === expectation.storageGeneration &&
    authority.storageGenerationFence === expectation.storageGenerationFence &&
    authority.epoch === expectation.epoch;
}
