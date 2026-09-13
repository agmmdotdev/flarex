import type { Json } from "flarex-protocol/json";
import type { ApplicationBindingSelectionReader } from "../applicationActivation";
import type { FlarexMetadataDatabase } from "../deployments";
import type { FrameworkSchemaTarget } from "../frameworkSchema/target";
import type { RelationalSession } from "../relationalTransaction/session";
import type { TrustedScopeAuthorityResolutionPorts } from "../scopeAuthorityResolution";
import type { LocatedReadCommittedAttemptTargetV1 } from "../transactionSessionAttemptKernel";

/** Trusted deployment composition shared by standalone and atomic commerce.
 * These are borrowed capabilities; each host validates their common authority. */
export interface CommerceHostConfiguration<Failure> {
  readonly database: FlarexMetadataDatabase;
  readonly session: RelationalSession;
  readonly target: FrameworkSchemaTarget;
  readonly deploymentId: string;
  readonly authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  readonly application: ApplicationBindingSelectionReader<Failure>;
  readonly identityAndAccessPolicy: Json;
}
