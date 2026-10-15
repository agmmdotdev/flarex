import type { CatalogIndexDefinitionId } from "flarex-protocol/catalog";
import type {
  AppPhysicalIndexAccessIdentityV1,
  AppIndexPhysicalSpecCodecVersion,
  CanonicalAppIndexPhysicalSpecBytesHexV1,
  AppIndexPhysicalSpecSha256HexV1,
} from "flarex-protocol/index-definition";
import type { AppOrderedIndexPhysicalSpecV1 } from "flarex-protocol/ordered-index";
import type { ScopeId } from "flarex-protocol/storage-authority";

export interface AppIndexDefinitionRecord {
  readonly deploymentId: string;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly access: AppPhysicalIndexAccessIdentityV1;
  readonly physicalSpecCodecVersion: AppIndexPhysicalSpecCodecVersion;
  readonly physicalSpec: AppOrderedIndexPhysicalSpecV1;
  readonly physicalSpecBytesHex: CanonicalAppIndexPhysicalSpecBytesHexV1;
  readonly physicalSpecSha256Hex: AppIndexPhysicalSpecSha256HexV1;
  readonly createdAt: Date;
}

const locatedAppIndexDefinitionBrand: unique symbol = Symbol(
  "FlarexDB/LocatedAppIndexDefinitionV1",
);

export interface LocatedAppIndexDefinitionV1 extends AppIndexDefinitionRecord {
  readonly scopeId: ScopeId;
  readonly [locatedAppIndexDefinitionBrand]: true;
}

const locatedAppIndexDefinitions = new WeakSet<object>();

export function isLocatedAppIndexDefinitionV1(
  value: unknown,
): value is LocatedAppIndexDefinitionV1 {
  return typeof value === "object" && value !== null &&
    locatedAppIndexDefinitions.has(value);
}

/** Package-private issuance after the catalog owner validates a stored definition. */
export function markLocatedAppIndexDefinition(
  scopeId: ScopeId,
  definition: AppIndexDefinitionRecord,
): LocatedAppIndexDefinitionV1 {
  // SAFETY: the copy carries every record field plus the scope, and the
  // non-enumerable brand property is installed immediately below.
  const located = { ...definition, scopeId } as LocatedAppIndexDefinitionV1;
  Object.defineProperty(located, locatedAppIndexDefinitionBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  const frozen = Object.freeze(located);
  locatedAppIndexDefinitions.add(frozen);
  return frozen;
}
