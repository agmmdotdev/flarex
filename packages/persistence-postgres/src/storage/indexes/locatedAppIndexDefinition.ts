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

/** Physical interpretation may be shared across independently issued handles.
 * The catalog validates canonical bytes/hash before issuance; owned immutable
 * access/spec trees below keep that identity true for the handle's lifetime.
 * This comparison grants no lifecycle, readiness or application authority. */
export function sameLocatedAppIndexDefinition(left: unknown, right: unknown): boolean {
  return isLocatedAppIndexDefinitionV1(left) && isLocatedAppIndexDefinitionV1(right) &&
    left.scopeId === right.scopeId && left.deploymentId === right.deploymentId &&
    left.indexDefinitionId === right.indexDefinitionId && left.access.kind === right.access.kind &&
    left.access.tableId === right.access.tableId && (left.access.kind !== "developer" ||
      right.access.kind === "developer" && left.access.logicalIndexId === right.access.logicalIndexId) &&
    left.physicalSpecCodecVersion === right.physicalSpecCodecVersion &&
    left.physicalSpecBytesHex === right.physicalSpecBytesHex && left.physicalSpecSha256Hex === right.physicalSpecSha256Hex;
}

/** Package-private issuance after the catalog owner validates a stored definition. */
export function markLocatedAppIndexDefinition(
  scopeId: ScopeId,
  definition: AppIndexDefinitionRecord,
): LocatedAppIndexDefinitionV1 {
  const physicalSpec = structuredClone(definition.physicalSpec);
  for (const field of physicalSpec.orderedFields) Object.freeze(field);
  Object.freeze(physicalSpec.orderedFields);
  if (physicalSpec.predicate !== undefined) {
    if (physicalSpec.predicate.kind === "fieldsAreNull") Object.freeze(physicalSpec.predicate.fields);
    Object.freeze(physicalSpec.predicate);
  }
  Object.freeze(physicalSpec.tieBreaker);
  Object.freeze(physicalSpec);
  // SAFETY: the copy carries every record field plus the scope, and the
  // non-enumerable brand property is installed immediately below.
  const located = { ...definition, scopeId, access: Object.freeze({ ...definition.access }), physicalSpec } as LocatedAppIndexDefinitionV1;
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
