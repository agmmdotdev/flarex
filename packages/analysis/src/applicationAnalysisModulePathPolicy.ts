export const APPLICATION_ANALYSIS_FRAMEWORK_MODULE_PATHS = Object.freeze([
  "flarex/server",
  "flarex/values",
] as const);

/** Finds a source path that would occupy a trusted per-directory shim. */
export function findApplicationAnalysisFrameworkShimCollision(
  modulePaths: ReadonlyArray<string>,
): string | undefined {
  const paths = new Set(modulePaths);
  for (const importingPath of modulePaths) {
    const directory = importingPath.slice(0, importingPath.lastIndexOf("/") + 1);
    for (const frameworkPath of APPLICATION_ANALYSIS_FRAMEWORK_MODULE_PATHS) {
      const collision = `${directory}${frameworkPath}`;
      if (paths.has(collision)) return collision;
    }
  }
  return undefined;
}
