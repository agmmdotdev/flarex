import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type {
  ApplicationReadBindingSelectionReader,
} from "../../../application/activation/contracts";
import type { PreparedCoLocatedReadInstallation } from "../../../installation/installationLifecycle";
import type { LogicalSourceReadPin } from "../../../storage/catalog/logicalStorageDefinitions";
import type { CmsHostConfiguration } from "../hostConfiguration";

/** An independently executed CMS read needs installation and source read
 * authority; it receives no mutation, publication or recovery configuration. */
export interface CmsReadHostInput<Failure> extends Omit<CmsHostConfiguration<Failure>, "application"> {
  readonly application: ApplicationReadBindingSelectionReader<Failure>;
  readonly installation: PreparedCoLocatedReadInstallation;
  readonly logicalStorage: Readonly<{
    schemaVersionId: CatalogSchemaVersionId;
    source: LogicalSourceReadPin;
  }>;
}
