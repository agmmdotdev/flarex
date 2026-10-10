import type { FlarexMetadataDatabase } from "../deployments";
import type { ProtectedMetadataPreparation } from "../../execution/preparation/preparedMetadataEpoch";
import type {
  TrustedScopeAuthorityResolutionPorts,
  ExactTrustedScopeAuthorityResolutionPorts,
} from "../../scope/scopeAuthorityResolution";
import type { LocatedReadCommittedAttemptTargetV1 } from "../../execution/transactionSessionAttemptKernel";
import type { ApplicationSchemaAuthorityPublisher } from "../applicationSchemaAuthority";
import type { ApplicationTaskCatalogSnapshotPort } from "../tasks/applicationTaskBindings";
import type { AppSchemaCandidateReadinessPort } from "../../storage/catalog/appSchemaCandidateValidation";
import type { PhysicalDefinitionLifecyclePort } from "../../installation/physicalDefinitionLifecycle";
import type { ApplicationReadinessColdMaterializationPort } from "./contracts";

export interface ApplicationReadinessContext<SchemaFailure, ColdFailure> {
  readonly controlDb: FlarexMetadataDatabase;
  /** Optional authenticated target installation for bounded structural reuse. */
  readonly protectedMetadata?: Readonly<{ database: FlarexMetadataDatabase;
    token: ProtectedMetadataPreparation }>;
  readonly authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1> &
    ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  readonly schema: ApplicationSchemaAuthorityPublisher<SchemaFailure>;
  readonly taskCatalog: ApplicationTaskCatalogSnapshotPort;
  readonly candidateValidation: AppSchemaCandidateReadinessPort;
  /** Exact point-commit factory result; structural substitutes fail closed. */
  readonly pointCommit: unknown;
  /** Exact scope-local physical-definition availability authority. */
  readonly physicalDefinitionLifecycle: PhysicalDefinitionLifecyclePort;
  readonly cold: ApplicationReadinessColdMaterializationPort<ColdFailure>;
}
