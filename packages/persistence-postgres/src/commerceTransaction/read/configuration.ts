import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { PreparedCoLocatedReadInstallation } from "../../installationLifecycle";
import type { LogicalSourceReadPin } from "../../logicalStorageDefinitions";
import type { CommerceHostConfiguration } from "../hostConfiguration";
import type { CommerceCommand } from "../commands";
import type { CommerceReadInitialization } from "../initializationContract";
import type { CommerceResources } from "../resources";

/** Trusted construction selects one managed installation and immutable source.
 * Business calls receive only the existing Commerce command context. */
export interface CommerceReadHostInput<Failure> extends CommerceHostConfiguration<Failure> {
  readonly installation: PreparedCoLocatedReadInstallation;
  readonly commands: readonly CommerceCommand[];
  readonly logicalResources?: CommerceResources;
  readonly logicalStorage: Readonly<{
    schemaVersionId: CatalogSchemaVersionId;
    source: LogicalSourceReadPin;
    initialization: CommerceReadInitialization;
  }>;
}
