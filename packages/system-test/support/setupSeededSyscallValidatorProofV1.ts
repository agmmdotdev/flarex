import type {
  CatalogSchemaVersionId,
  SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";

import type {
  ApplicationRevisionSyscallValidatorV1,
} from "@flarex/persistence-postgres/internal/system-test/applicationRevisionSyscallValidatorV1";
import {
  issueApplicationRevisionSyscallValidatorStateV1,
  setupSeededSyscallValidatorStateV1,
} from "@flarex/persistence-postgres/internal/system-test/applicationRevisionSyscallValidatorStateV1";

/** Temporary C07-only adapter until that proof enters through FSV05 + C03-V. */
export function issueSetupSeededSyscallValidatorProofV1(input: Readonly<{
  readonly scopeId?: ScopeId;
  readonly schemaVersionId?: CatalogSchemaVersionId;
  readonly schemaManifest?: SchemaManifestAppSchemaV1;
}> = {}): ApplicationRevisionSyscallValidatorV1 {
  return issueApplicationRevisionSyscallValidatorStateV1(
    setupSeededSyscallValidatorStateV1(input),
  );
}
