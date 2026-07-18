export class StableLogicalIndexCatalogCorruptionError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly detail: string,
    options?: ErrorOptions,
  ) {
    super(
      `Stable logical index catalog is corrupt for ${deploymentId}: ${detail}`,
      options,
    );
    this.name = "StableLogicalIndexCatalogCorruptionError";
  }
}
