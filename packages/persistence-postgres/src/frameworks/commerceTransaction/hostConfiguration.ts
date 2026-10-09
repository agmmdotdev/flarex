import type { Json } from "flarex-protocol/json";
import type { PreparedHostRuntime } from "../../execution/preparation/preparedHostRuntime";
import type { ApplicationBindingSelectionReader } from "../../application/applicationActivation";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type { FrameworkSchemaTarget } from "../../installation/frameworkSchema/target";
import type { RelationalSession } from "../../database/relationalTransaction/session";
import type { ExactTrustedScopeAuthorityResolutionPorts } from "../../scope/scopeAuthorityResolution";
import type { LocatedReadCommittedAttemptTargetV1 } from "../../execution/transactionSessionAttemptKernel";
import type { ScopeId } from "flarex-protocol/storage-authority";

/** Trusted deployment composition shared by standalone and atomic commerce.
 * These are borrowed capabilities; each host validates their common authority. */
export interface CommerceHostConfiguration<Failure> {
  readonly hostRuntime: PreparedHostRuntime;
  readonly database: FlarexMetadataDatabase;
  readonly session: RelationalSession;
  readonly target: FrameworkSchemaTarget;
  readonly deploymentId: string;
  /** Selected by trusted composition, never by a business command. */
  readonly scopeId: ScopeId;
  readonly authority: ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  readonly application: ApplicationBindingSelectionReader<Failure>;
  readonly identityAndAccessPolicy: Json;
}
