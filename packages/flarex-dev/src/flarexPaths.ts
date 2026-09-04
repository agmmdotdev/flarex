import path from "node:path";

export interface FlarexDirOptions {
  readonly root: string;
  readonly appDir?: string | undefined;
  readonly generatedDir?: string | undefined;
}

export interface ResolvedFlarexDirs {
  readonly appDir: string;
  readonly generatedDir: string;
}

/**
 * Resolves the Flarex application directory from a project root.
 *
 * Node path mechanics stay with this host owner; callers retain their
 * option names, defaults, diagnostics, and recovery policy.
 */
export function resolveFlarexAppDir(
  root: string,
  appDir?: string | undefined,
): string {
  return path.resolve(root, appDir ?? "flarex");
}

/** Resolves a generated-output directory below a resolved app directory. */
export function resolveFlarexGeneratedDir(
  appDir: string,
  generatedDir?: string | undefined,
): string {
  return path.resolve(appDir, generatedDir ?? "_generated");
}

/** Resolves the Flarex application and generated-output directories. */
export function resolveFlarexDirs(
  options: FlarexDirOptions,
): ResolvedFlarexDirs {
  const appDir = resolveFlarexAppDir(options.root, options.appDir);
  return {
    appDir,
    generatedDir: resolveFlarexGeneratedDir(appDir, options.generatedDir),
  };
}

/**
 * Returns whether a child path is the parent directory itself or lies under
 * it. The check fails closed: any relative path starting with ".." is
 * rejected, including literal in-directory names such as "..foo".
 * Callers retain any additional policy such as same-directory exclusion,
 * project-scoped prefixes, or filesystem-root rejection.
 */
export function isPathWithinDir(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative));
}
