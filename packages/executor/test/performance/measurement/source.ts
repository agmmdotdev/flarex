import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const require = createRequire(import.meta.url);

/** Source stability evidence, outside request timers. Inventory authored package
 * code, dependency locks and the actual loaded native CommonJS source island. */
export async function measurementSourceDigest(native: boolean) {
  const files = new Set<string>();
  const packages = join(repository, "packages");
  for (const entry of await readdir(packages, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && /\.(?:ts|js|json)$/.test(entry.name) && !entry.name.endsWith(".test.ts") &&
      !entry.name.startsWith("vitest.") &&
      !/(?:^|[\\/])(?:node_modules|dist|benchmarks)(?:[\\/]|$)/.test(relative(packages, entry.parentPath))) {
      files.add(join(entry.parentPath, entry.name));
    }
  }
  for (const name of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json"]) files.add(join(repository, name));
  // This SDK reuses an authored benchmark owner that the broad package source
  // inventory deliberately excludes along with historical report files.
  files.add(join(repository, "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/server.ts"));
  for (const file of Object.keys(require.cache)) if (file.includes(`${sep}third_party${sep}medusa${sep}`)) files.add(file);
  if (native) {
    const root = join(repository, "work/native-business-baseline/dependencies");
    for (const name of ["package.json", "package-lock.json"]) files.add(join(root, name));
    for (const dependency of ["payload", "@payloadcms/db-postgres", "@payloadcms/drizzle"]) {
      const directory = join(root, "node_modules", dependency, "dist");
      for (const file of await readdir(directory, { recursive: true })) if (file.endsWith(".js")) files.add(join(directory, file));
    }
    for (const name of ["native.ts", "workflow.ts"]) files.add(join(repository,
      "packages/medusa-adapter/benchmarks/core-performance/native-business", name));
  }
  const hash = createHash("sha256");
  for (const file of [...files].toSorted()) {
    hash.update(relative(repository, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(createHash("sha256").update(await readFile(file)).digest());
  }
  return { digest: hash.digest("hex"), files: files.size };
}
