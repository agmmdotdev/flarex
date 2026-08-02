import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { dirname, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const islandRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(
  await readFile(resolve(islandRoot, "SOURCE.json"), "utf8"),
);
const manifestPath = resolve(islandRoot, "SOURCE_SHA256SUMS");
const manifest = await readFile(manifestPath, "utf8");
const entries = manifest.split("\n").filter(Boolean);
const upstreamRoot = resolve(islandRoot, "upstream");
const expectedPaths = new Set();
const executablePaths = new Set(source.executableFiles);

function checkedUpstreamPath(relativePath) {
  if (
    !relativePath.startsWith("upstream/") ||
    posix.normalize(relativePath) !== relativePath
  ) {
    throw new Error(`Source manifest path escapes upstream/: ${relativePath}`);
  }

  const absolutePath = resolve(islandRoot, relativePath);
  if (!absolutePath.startsWith(`${upstreamRoot}${sep}`)) {
    throw new Error(`Source manifest path escapes upstream/: ${relativePath}`);
  }

  return absolutePath;
}

const { stdout: repoRootOutput } = await execFileAsync(
  "git",
  ["rev-parse", "--show-toplevel"],
  { cwd: islandRoot, encoding: "utf8" },
);
const repoRoot = repoRootOutput.trim();
const islandGitRoot = relative(repoRoot, islandRoot).split(sep).join("/");
const { stdout: indexOutput } = await execFileAsync(
  "git",
  ["ls-files", "-s", "-z", "--", `${islandGitRoot}/upstream`],
  { cwd: repoRoot, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
);
const actualPaths = new Map();

for (const record of indexOutput.split("\0").filter(Boolean)) {
  const match = /^(\d{6}) ([a-f0-9]+) \d+\t(.+)$/.exec(record);
  if (!match) {
    throw new Error(`Invalid Git index entry: ${record}`);
  }

  const relativePath = match[3].slice(islandGitRoot.length + 1);
  actualPaths.set(relativePath, { mode: match[1], object: match[2] });
}

for (const entry of entries) {
  const separator = entry.indexOf("  ");
  if (separator !== 64) {
    throw new Error(`Invalid source manifest entry: ${entry}`);
  }

  const expected = entry.slice(0, separator);
  const relativePath = entry.slice(separator + 2);
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error(`Invalid source checksum: ${relativePath}`);
  }
  if (expectedPaths.has(relativePath)) {
    throw new Error(`Duplicate source manifest path: ${relativePath}`);
  }
  expectedPaths.add(relativePath);

  const absolutePath = checkedUpstreamPath(relativePath);
  const contents = await readFile(absolutePath);
  const actual = createHash("sha256").update(contents).digest("hex");
  if (actual !== expected) {
    throw new Error(`Source checksum mismatch: ${relativePath}`);
  }

}

for (const executablePath of executablePaths) {
  if (!expectedPaths.has(executablePath)) {
    throw new Error(`Executable path is absent from source manifest: ${executablePath}`);
  }
}

for (const [relativePath, expectedTarget] of Object.entries(source.symlinks)) {
  checkedUpstreamPath(relativePath);
  if (expectedPaths.has(relativePath)) {
    throw new Error(`Duplicate source manifest path: ${relativePath}`);
  }
  expectedPaths.add(relativePath);

  const indexEntry = actualPaths.get(relativePath);
  if (!indexEntry) {
    throw new Error(`Source symlink is absent from Git index: ${relativePath}`);
  }
  const { stdout: actualTarget } = await execFileAsync(
    "git",
    ["cat-file", "blob", indexEntry.object],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (actualTarget !== expectedTarget) {
    throw new Error(`Source symlink index mismatch: ${relativePath}`);
  }

  const absolutePath = checkedUpstreamPath(relativePath);
  const stats = await lstat(absolutePath);
  const materializedTarget = stats.isSymbolicLink()
    ? await readlink(absolutePath)
    : await readFile(absolutePath, "utf8");
  if (materializedTarget !== expectedTarget) {
    throw new Error(`Source symlink worktree mismatch: ${relativePath}`);
  }
}

const unexpectedPaths = [...actualPaths.keys()].filter((path) => !expectedPaths.has(path));
if (unexpectedPaths.length > 0) {
  throw new Error(
    `Unexpected files in frozen upstream Git index:\n${unexpectedPaths.sort().join("\n")}`,
  );
}

const missingPaths = [...expectedPaths].filter((path) => !actualPaths.has(path));
if (missingPaths.length > 0) {
  throw new Error(
    `Missing files from frozen upstream Git index:\n${missingPaths.sort().join("\n")}`,
  );
}

for (const relativePath of expectedPaths) {
  const expectedMode = source.symlinks[relativePath] !== undefined
    ? "120000"
    : executablePaths.has(relativePath)
      ? "100755"
      : "100644";
  if (actualPaths.get(relativePath)?.mode !== expectedMode) {
    throw new Error(`Source Git mode mismatch: ${relativePath}`);
  }
}

console.log(
  `Verified ${entries.length} files and ${Object.keys(source.symlinks).length} symlinks from Trigger.dev ${source.commit}.`,
);
