import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { PreparedCoLocatedReadInstallation } from "../../installationLifecycle";
import type { LogicalSourceReadPin } from "../../logicalStorageDefinitions";
import type { CmsHostConfiguration } from "../hostConfiguration";

/** An independently executed CMS read needs installation and source read
 * authority; it receives no mutation, publication or recovery configuration. */
export interface CmsReadHostInput<Failure> extends CmsHostConfiguration<Failure> {
  readonly installation: PreparedCoLocatedReadInstallation;
  readonly logicalStorage: Readonly<{
    schemaVersionId: CatalogSchemaVersionId;
    source: LogicalSourceReadPin;
  }>;
}
