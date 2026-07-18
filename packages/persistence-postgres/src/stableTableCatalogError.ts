export class StableTableCatalogCorruptionError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly detail: string,
  ) {
    super(`Stable table catalog is corrupt for ${deploymentId}: ${detail}`);
    this.name = "StableTableCatalogCorruptionError";
  }
}
