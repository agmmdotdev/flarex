import type { ScopePhysicalLocator } from "./scopeMetadataTypes";

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
