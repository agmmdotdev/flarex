export class StableLogicalIndexCatalogCorruptionError extends Error {
  readonly _tag = "StableLogicalIndexCatalogCorruptionError" as const;

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
