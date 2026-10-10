import type { LocatedReadCommittedAttemptTargetV1 } from "../../execution/transactionSessionAttemptKernel";
import type {
  ExactTrustedScopeAuthorityResolutionPorts,
  TrustedScopeAuthority,
  TrustedScopeAuthorityResolutionPorts,
} from "../../scope/scopeAuthorityResolution";
import type { ApplicationReadinessContext } from "../readiness/constructionContracts";
import type {
  ApplicationActivationTargetProfile,
  ApplicationReadinessRepository,
} from "../readiness/contracts";
import type {
  ApplicationRelationReadinessFoldRepository,
} from "../relations/applicationRelationReadinessFold";
import type { ScopeId } from "flarex-protocol/storage-authority";

export interface ApplicationActivationContext<SchemaFailure, ColdFailure> {
  readonly activation: ApplicationActivationTargetProfile;
  readonly readinessContract?: never;
  readonly deploymentId: string;
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly readiness: ApplicationReadinessRepository<SchemaFailure, ColdFailure>;
  readonly authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1> &
    ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  /** Test-only failure or transaction gate after an owned persistence step. */
  readonly faultAfter?: (
    point: "activationInserted" | "indexMaintenanceWritten" | "uniqueMaintenanceWritten" | "headWritten",
  ) => void | Promise<void>;
}

export interface ApplicationRelationActivationContext<SchemaFailure, ColdFailure> {
  readonly activation: ApplicationActivationTargetProfile;
  readonly deploymentId: string;
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly readiness: ApplicationReadinessRepository<SchemaFailure, ColdFailure>;
  readonly relationReadiness: ApplicationRelationReadinessFoldRepository;
  readonly authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1> &
    ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  /** Test-only failure or transaction gate after an owned persistence step. */
  readonly faultAfter?: (
    point: "activationInserted" | "indexMaintenanceWritten" | "uniqueMaintenanceWritten" | "headWritten",
  ) => void | Promise<void>;
}

export interface ApplicationStandaloneBindingContext {
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1> &
    ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  readonly protectedMetadata: NonNullable<ApplicationReadinessContext<unknown, unknown>["protectedMetadata"]>;
}
