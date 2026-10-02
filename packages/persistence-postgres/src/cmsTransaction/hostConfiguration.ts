import type { Json } from "flarex-protocol/json";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { ApplicationBindingSelectionReader } from "../applicationActivation";
import type { FlarexMetadataDatabase } from "../deployments";
import type { CmsRequestBudget } from "../frameworkExecutionPolicy";
import type { PreparedHostRuntime } from "../preparedHostRuntime";
import type { RelationalSession } from "../relationalTransaction/session";
import type { ExactTrustedScopeAuthorityResolutionPorts } from "../scopeAuthorityResolution";
import type { LocatedReadCommittedAttemptTargetV1 } from "../transactionSessionAttemptKernel";
import type { CmsCommand } from "./commands";

/** Trusted composition shared by direct readers and the genuine read/write host.
 * Each constructor authenticates these borrowed capabilities. */
export interface CmsHostConfiguration<Failure> {
  readonly hostRuntime: PreparedHostRuntime;
  readonly database: FlarexMetadataDatabase;
  readonly session: RelationalSession;
  readonly deploymentId: string;
  /** Selected by trusted composition, never by a Payload command. */
  readonly scopeId: ScopeId;
  readonly authority: ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  readonly application: ApplicationBindingSelectionReader<Failure>;
  readonly commands: readonly CmsCommand[];
  /** Authenticated by the private composition root; never adapter command input. */
  readonly identityAndAccessPolicy: Json;
  /** Trusted host-start selection; never read from a business request. */
  readonly requestBudget?: CmsRequestBudget;
  /** Optional closed-consumer restriction, checked after admission. */
  readonly expectedContentIdentity?: Readonly<{ configSha256: string; provenanceSha256: string }>;
}
