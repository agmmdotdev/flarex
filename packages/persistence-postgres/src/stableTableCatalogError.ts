export class StableTableCatalogCorruptionError extends Error {
  readonly _tag = "StableTableCatalogCorruptionError" as const;

  constructor(
    readonly deploymentId: string,
    readonly detail: string,
    options?: ErrorOptions,
  ) {
    super(
      `Stable table catalog is corrupt for ${deploymentId}: ${detail}`,
      options,
    );
    this.name = "StableTableCatalogCorruptionError";
  }
}
