import type {
  ScopePhysicalLocator,
  SharedDatabaseScopePhysicalLocator,
  SplitScopePhysicalLocator,
} from "./scopeMetadataTypes";

/** Copies a typed, already-validated locator into an owned frozen snapshot. */
export function captureScopePhysicalLocator(
  locator: SharedDatabaseScopePhysicalLocator,
): SharedDatabaseScopePhysicalLocator;
export function captureScopePhysicalLocator(
  locator: SplitScopePhysicalLocator,
): SplitScopePhysicalLocator;
export function captureScopePhysicalLocator(
  locator: ScopePhysicalLocator,
): ScopePhysicalLocator;
export function captureScopePhysicalLocator(
  locator: ScopePhysicalLocator,
): ScopePhysicalLocator {
  const kind = locator.kind;
  switch (kind) {
    case "shared_database":
    case "schema_per_scope":
    case "database_per_scope": {
      const databaseKey = locator.databaseKey;
      const schemaName = locator.schemaName;
      return Object.freeze({
        kind,
        databaseKey,
        schemaName,
      });
    }
  }
}

/** Compares the complete persisted identity of two scope physical locators. */
export function scopePhysicalLocatorsEqual(
  left: ScopePhysicalLocator,
  right: ScopePhysicalLocator,
): boolean {
  return (
    left.kind === right.kind &&
    left.databaseKey === right.databaseKey &&
    left.schemaName === right.schemaName
  );
}
