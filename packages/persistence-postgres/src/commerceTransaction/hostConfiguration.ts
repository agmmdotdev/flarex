import type { Json } from "flarex-protocol/json";
import type { PreparedHostRuntime } from "../preparedHostRuntime";
import type { ApplicationBindingSelectionReader } from "../applicationActivation";
import type { FlarexMetadataDatabase } from "../deployments";
import type { FrameworkSchemaTarget } from "../frameworkSchema/target";
import type { RelationalSession } from "../relationalTransaction/session";
import type { ExactTrustedScopeAuthorityResolutionPorts } from "../scopeAuthorityResolution";
import type { LocatedReadCommittedAttemptTargetV1 } from "../transactionSessionAttemptKernel";
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
