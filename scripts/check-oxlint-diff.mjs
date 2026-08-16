import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** @typedef {{ line: number, column: number, offset: number, length: number }} OxlintSpan */
/** @typedef {{ span?: OxlintSpan }} OxlintLabel */
/** @typedef {{ labels?: OxlintLabel[] }} LocatableDiagnostic */
/**
 * @typedef {LocatableDiagnostic & {
 *   filename: string,
 *   message: string,
 *   code: string,
 * }} OxlintDiagnostic
 */
/**
 * @typedef {{
 *   diffArguments: string[],
 *   files: string[],
 *   sourceMode: "head" | "index" | "worktree",
 *   untracked: Set<string>,
 * }} ChangedFiles
 */

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const OXLINT_ENTRYPOINT = resolve(REPOSITORY_ROOT, "node_modules/oxlint/bin/oxlint");

export const OXLINT_SOURCE_ROOTS = Object.freeze([
  "packages/utils/src",
  "packages/flarex-protocol/src",
  "packages/executor/src",
  "packages/executor-http/src",
  "packages/executor-nitro/src",
  "packages/persistence-postgres/src",
]);

const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
export const OXLINT_POLICY_PATHS = Object.freeze([
  "oxlint.config.ts",
  "package.json",
  "scripts/check-oxlint-diff.mjs",
  "tools/oxlint",
]);

/** @param {string} value */
export const normalizeRepositoryPath = (value) =>
  value.replaceAll("\\", "/").split(sep).join("/");

/** @param {string} diff */
export const parseChangedLines = (diff) => {
  /** @type {Set<number>} */
  const changedLines = new Set();
  const hunkHeader = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;

  for (const match of diff.matchAll(hunkHeader)) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    for (let offset = 0; offset < count; offset += 1) {
      changedLines.add(start + offset);
    }
  }

  return changedLines;
};

/**
 * @param {string} source
 * @param {number} offset
 * @param {number} length
 */
const countLinesInSpan = (source, offset, length) => {
  let lineCount = 0;
  const end = Math.min(source.length, offset + length);
  for (let index = offset; index < end; index += 1) {
    if (source.charCodeAt(index) === 10) lineCount += 1;
  }
  return lineCount;
};

/**
 * @param {ReadonlySet<number>} changedLines
 * @param {number} start
 * @param {number} end
 */
const rangeTouchesChangedLine = (changedLines, start, end) => {
  for (let line = start; line <= end; line += 1) {
    if (changedLines.has(line)) return true;
  }
  return false;
};

/**
 * @param {LocatableDiagnostic} diagnostic
 * @param {ReadonlySet<number>} changedLines
 * @param {string} source
 */
export const diagnosticTouchesChangedLines = (diagnostic, changedLines, source) => {
  const spans = (diagnostic.labels ?? []).flatMap((label) => {
    const { span } = label;
    return span !== undefined &&
      Number.isSafeInteger(span.line) &&
      Number.isSafeInteger(span.offset) &&
      Number.isSafeInteger(span.length)
      ? [span]
      : [];
  });

  if (spans.length === 0) {
    // File-level diagnostics cannot be located more narrowly, so a changed
    // file owns them instead of silently allowing new unlocatable debt.
    return true;
  }

  return spans.some((span) => {
    const endLine = span.line + countLinesInSpan(source, span.offset, span.length);
    return rangeTouchesChangedLine(changedLines, span.line, endLine);
  });
};

/**
 * @param {string} command
 * @param {string[]} args
 * @param {number[]} [acceptedStatuses]
 */
const run = (command, args, acceptedStatuses = [0]) => {
  const result = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error !== undefined) throw result.error;
  if (!acceptedStatuses.includes(result.status ?? -1)) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout;
};

/** @param {string} output */
const parseNulSeparatedPaths = (output) =>
  output
    .split("\0")
    .filter((value) => value.length > 0)
    .map(normalizeRepositoryPath);

/** @param {string} file */
const isLintableSource = (file) => SOURCE_EXTENSIONS.has(extname(file));

/**
 * @param {"head" | "index" | "worktree"} sourceMode
 * @param {string} [repositoryRoot]
 */
export const assertPolicyMatchesSnapshot = (
  sourceMode,
  repositoryRoot = REPOSITORY_ROOT,
) => {
  if (sourceMode === "worktree") return;
  const comparisonArguments = sourceMode === "index" ? [] : ["HEAD"];
  const result = spawnSync(
    "git",
    ["diff", "--quiet", ...comparisonArguments, "--", ...OXLINT_POLICY_PATHS],
    { cwd: repositoryRoot, windowsHide: true },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git diff --quiet failed with exit ${result.status}`);
  }

  const untrackedResult = spawnSync(
    "git",
    [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...OXLINT_POLICY_PATHS,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (untrackedResult.error !== undefined) throw untrackedResult.error;
  if (untrackedResult.status !== 0) {
    throw new Error(`git ls-files --others failed with exit ${untrackedResult.status}`);
  }
  const untrackedPolicyFiles = parseNulSeparatedPaths(untrackedResult.stdout);
  if (result.status === 0 && untrackedPolicyFiles.length === 0) return;

  const snapshot = sourceMode === "index" ? "staged" : "committed HEAD";
  const untrackedDetail =
    untrackedPolicyFiles.length === 0
      ? ""
      : ` Untracked policy files: ${untrackedPolicyFiles.join(", ")}.`;
  throw new Error(
    `Oxlint policy files differ from the ${snapshot} snapshot; stage or revert those policy edits before running this mode.${untrackedDetail}`,
  );
};

/** @param {string[]} args */
export const readArguments = (args) => {
  if (args.includes("--help")) {
    return { help: true, base: undefined, staged: false };
  }
  if (args.length === 0) {
    return { help: false, base: undefined, staged: false };
  }
  if (args.length === 1 && args[0] === "--staged") {
    return { help: false, base: undefined, staged: true };
  }
  if (args.length === 2 && args[0] === "--base" && args[1].length > 0) {
    return { help: false, base: args[1], staged: false };
  }
  throw new Error("Usage: pnpm lint:diff [--staged | --base <git-ref>]");
};

/**
 * @param {string | undefined} base
 * @param {boolean} staged
 * @returns {ChangedFiles}
 */
const collectChangedFiles = (base, staged) => {
  const diffArguments = staged
    ? ["--cached"]
    : [base === undefined ? "HEAD" : `${base}...HEAD`];
  const tracked = parseNulSeparatedPaths(
    run("git", [
      "diff",
      "--name-only",
      "-z",
      "--diff-filter=ACMR",
      "--find-renames",
      ...diffArguments,
      "--",
      ...OXLINT_SOURCE_ROOTS,
    ]),
  );
  const untracked =
    base === undefined && !staged
      ? parseNulSeparatedPaths(
          run("git", [
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            ...OXLINT_SOURCE_ROOTS,
          ]),
        )
      : [];

  return {
    diffArguments,
    files: [...new Set([...tracked, ...untracked])].filter(isLintableSource).sort(),
    sourceMode: staged ? "index" : base === undefined ? "worktree" : "head",
    untracked: new Set(untracked),
  };
};

/** @param {ChangedFiles} changedFiles */
const collectChangedLines = ({ diffArguments, files, untracked }) => {
  /** @type {Map<string, Set<number>>} */
  const changedLinesByFile = new Map();

  for (const file of files) {
    if (untracked.has(file)) {
      const source = readFileSync(resolve(REPOSITORY_ROOT, file), "utf8");
      const lineCount = source.length === 0 ? 0 : source.split(/\r?\n/u).length;
      changedLinesByFile.set(
        file,
        new Set(Array.from({ length: lineCount }, (_, index) => index + 1)),
      );
      continue;
    }

    const diff = run("git", [
      "diff",
      "--unified=0",
      "--no-color",
      "--find-renames",
      ...diffArguments,
      "--",
      file,
    ]);
    changedLinesByFile.set(file, parseChangedLines(diff));
  }

  return changedLinesByFile;
};

/**
 * @param {string} file
 * @param {ChangedFiles["sourceMode"]} sourceMode
 */
const readSource = (file, sourceMode) => {
  switch (sourceMode) {
    case "index":
      return run("git", ["show", `:${file}`]);
    case "head":
      return run("git", ["show", `HEAD:${file}`]);
    case "worktree":
      return readFileSync(resolve(REPOSITORY_ROOT, file), "utf8");
  }
};

/**
 * @param {string} filename
 * @param {string} [sourceRoot]
 */
const normalizeDiagnosticFile = (filename, sourceRoot = REPOSITORY_ROOT) =>
  normalizeRepositoryPath(isAbsolute(filename) ? relative(sourceRoot, filename) : filename);

/**
 * @param {OxlintDiagnostic[]} diagnostics
 * @param {ReadonlyMap<string, ReadonlySet<number>>} changedLinesByFile
 * @param {ReadonlyMap<string, string>} sourceByFile
 */
export const selectChangedLineDiagnostics = (diagnostics, changedLinesByFile, sourceByFile) =>
  diagnostics.filter((diagnostic) => {
    const filename = normalizeDiagnosticFile(diagnostic.filename);
    const changedLines = changedLinesByFile.get(filename);
    const source = sourceByFile.get(filename);
    return (
      changedLines !== undefined &&
      source !== undefined &&
      diagnosticTouchesChangedLines(diagnostic, changedLines, source)
    );
  });

/** @param {OxlintDiagnostic} diagnostic */
const formatDiagnostic = (diagnostic) => {
  const firstSpan = diagnostic.labels?.find((label) => label.span !== undefined)?.span;
  const location = firstSpan === undefined ? "" : `:${firstSpan.line}:${firstSpan.column}`;
  return `${normalizeDiagnosticFile(diagnostic.filename)}${location} ${diagnostic.code}: ${diagnostic.message}`;
};

const main = () => {
  const { base, help, staged } = readArguments(process.argv.slice(2));
  if (help) {
    process.stdout.write(
      "Check Oxlint diagnostics on changed lines.\n\nUsage: pnpm lint:diff [--staged | --base <git-ref>]\n",
    );
    return;
  }

  const changed = collectChangedFiles(base, staged);
  assertPolicyMatchesSnapshot(changed.sourceMode);
  if (changed.files.length === 0) {
    process.stdout.write("Oxlint diff check passed (no changed scoped source files).\n");
    return;
  }

  const changedLinesByFile = collectChangedLines(changed);
  const sourceByFile = new Map(
    changed.files.map((file) => [file, readSource(file, changed.sourceMode)]),
  );
  let lintRoot = REPOSITORY_ROOT;
  /** @type {string | undefined} */
  let temporaryRoot;
  let lintFiles = changed.files;
  if (changed.sourceMode !== "worktree") {
    const snapshotRoot = mkdtempSync(join(tmpdir(), "flarex-oxlint-"));
    temporaryRoot = snapshotRoot;
    lintRoot = snapshotRoot;
    lintFiles = changed.files.map((file) => {
      const target = resolve(snapshotRoot, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, sourceByFile.get(file) ?? "", "utf8");
      return target;
    });
  }

  let output;
  try {
    output = run(
      process.execPath,
      [
        OXLINT_ENTRYPOINT,
        "--config",
        resolve(REPOSITORY_ROOT, "oxlint.config.ts"),
        "--format=json",
        ...lintFiles,
      ],
      [0, 1],
    );
  } finally {
    if (temporaryRoot !== undefined) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
  const report = /** @type {{ diagnostics?: unknown }} */ (JSON.parse(output));
  if (!Array.isArray(report.diagnostics)) {
    throw new Error("Oxlint JSON output did not contain a diagnostics array.");
  }

  const repositoryDiagnostics = /** @type {OxlintDiagnostic[]} */ (
    report.diagnostics
  ).map((diagnostic) => ({
    ...diagnostic,
    filename: normalizeDiagnosticFile(diagnostic.filename, lintRoot),
  }));
  const diagnostics = selectChangedLineDiagnostics(
    repositoryDiagnostics,
    changedLinesByFile,
    sourceByFile,
  );
  if (diagnostics.length === 0) {
    process.stdout.write(
      `Oxlint diff check passed (${changed.files.length} changed scoped source files).\n`,
    );
    return;
  }

  process.stderr.write(
    `Oxlint found ${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"} on changed lines:\n${diagnostics.map(formatDiagnostic).join("\n")}\n`,
  );
  process.exitCode = 1;
};

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Oxlint diff check failed: ${message}\n`);
    process.exitCode = 1;
  }
}
