import type {
  CatalogSchemaVersionId,
  SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";

import {
  type ApplicationRevisionSyscallValidatorV1,
} from "../src/applicationRevisionSyscallValidatorV1";
import {
  issueApplicationRevisionSyscallValidatorStateV1,
  revokeApplicationRevisionSyscallValidatorStateV1,
  setupSeededSyscallValidatorStateV1,
} from "../src/applicationRevisionSyscallValidatorStateV1";

/**
 * Setup-seeded C04B1 proof adapter used only by persistence/executor tests.
 * Delete it once every prepared-start test enters through FSV05 + C03-V.
 */
export function issueSetupSeededSyscallValidatorProofV1(input: Readonly<{
  readonly scopeId?: ScopeId;
  readonly schemaVersionId?: CatalogSchemaVersionId;
  readonly schemaManifest?: SchemaManifestAppSchemaV1;
}> = {}): ApplicationRevisionSyscallValidatorV1 {
  return issueApplicationRevisionSyscallValidatorStateV1(
    setupSeededSyscallValidatorStateV1(input),
  );
}

export const SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1 =
  issueSetupSeededSyscallValidatorProofV1();

export function revokeSetupSeededSyscallValidatorProofV1(
  capability: ApplicationRevisionSyscallValidatorV1,
): void {
  revokeApplicationRevisionSyscallValidatorStateV1(capability);
}
