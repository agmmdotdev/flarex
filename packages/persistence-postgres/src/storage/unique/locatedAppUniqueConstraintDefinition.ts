import type {
  CatalogTableId,
  CatalogUniqueConstraintDefinitionId,
  CatalogUniqueConstraintId,
} from "flarex-protocol/catalog";
import type {
  AppUniqueConstraintPhysicalSpecCodecVersion,
  AppUniqueConstraintPhysicalSpecV1,
  CanonicalAppUniqueConstraintSpecBytesHexV1,
  AppUniqueConstraintSpecSha256HexV1,
} from "flarex-protocol/app-unique-constraint-definition";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";

export interface AppUniqueConstraintDefinitionRecordV1 {
  readonly deploymentId: string;
  readonly uniqueConstraintDefinitionId: CatalogUniqueConstraintDefinitionId;
  readonly logicalUniqueConstraintId: CatalogUniqueConstraintId;
  readonly tableId: CatalogTableId;
  readonly physicalSpecCodecVersion: AppUniqueConstraintPhysicalSpecCodecVersion;
  readonly physicalSpec: AppUniqueConstraintPhysicalSpecV1;
  readonly physicalSpecBytesHex: CanonicalAppUniqueConstraintSpecBytesHexV1;
  readonly physicalSpecSha256Hex: AppUniqueConstraintSpecSha256HexV1;
  readonly createdAt: Date;
}

const locatedDefinitionBrand: unique symbol = Symbol(
  "FlarexDB/LocatedAppUniqueConstraintDefinitionV1",
);

export interface LocatedAppUniqueConstraintDefinitionV1
  extends AppUniqueConstraintDefinitionRecordV1 {
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly [locatedDefinitionBrand]: true;
}

const locatedDefinitions = new WeakSet<object>();

export function isLocatedAppUniqueConstraintDefinitionV1(
  value: unknown,
): value is LocatedAppUniqueConstraintDefinitionV1 {
  return typeof value === "object" && value !== null &&
    locatedDefinitions.has(value);
}

/** Package-private issuance after the catalog owner validates a stored definition. */
export function markLocatedDefinition(
  scopeId: ScopeId,
  schemaVersionId: CatalogSchemaVersionId,
  definition: AppUniqueConstraintDefinitionRecordV1,
): LocatedAppUniqueConstraintDefinitionV1 {
  // SAFETY: the copy carries every record field plus the scope and schema
  // version, and the non-enumerable brand property is installed below.
  const located = {
    ...definition,
    scopeId,
    schemaVersionId,
  } as LocatedAppUniqueConstraintDefinitionV1;
  Object.defineProperty(located, locatedDefinitionBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  const frozen = Object.freeze(located);
  locatedDefinitions.add(frozen);
  return frozen;
}
