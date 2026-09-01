import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { isDeepStrictEqual } from "node:util"

import { filterExistingRepositoryFiles } from "./inventory-paths.ts"

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url))
const baselinePath = resolve(
  repositoryRoot,
  "scripts/test-runner/remaining-jest-inventory.json"
)
const updateBaseline = process.argv.slice(2).includes("--update")
const unsupportedArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--update")

interface WorkspaceEntry {
  readonly name: string
  readonly path: string
}

interface ManifestScriptEntry {
  readonly command: string
  readonly manifest: string
  readonly packageName: string
  readonly script: string
}

interface ManifestDependencyEntry {
  readonly dependency: string
  readonly field: string
  readonly manifest: string
  readonly packageName: string
  readonly specifier: string
}

interface ApiFileEntry {
  readonly APIs: Readonly<Record<string, number>>
  readonly file: string
}

interface TextOccurrenceEntry {
  readonly count: number
  readonly file: string
}

interface FileDigestEntry {
  readonly digest: string
  readonly file: string
}

interface RemainingJestOwnership {
  readonly activeJestConfigs: readonly string[]
  readonly activeJestApiFiles: readonly ApiFileEntry[]
  readonly archivedJestFiles: readonly TextOccurrenceEntry[]
  readonly explicitJestImports: readonly TextOccurrenceEntry[]
  readonly foundationJestApiFiles: readonly ApiFileEntry[]
  readonly foundationJestConfigs: readonly string[]
  readonly foundationJestInvocations: readonly FileDigestEntry[]
  readonly jestNamespaceTypeFiles: readonly TextOccurrenceEntry[]
  readonly jestWorkerIdFiles: readonly TextOccurrenceEntry[]
  readonly manifestDependencies: readonly ManifestDependencyEntry[]
  readonly manifestScripts: readonly ManifestScriptEntry[]
  readonly manualMockFiles: readonly string[]
  readonly mockResetFiles: readonly TextOccurrenceEntry[]
  readonly rootAndCiInvocations: readonly FileDigestEntry[]
  readonly snapshotFiles: readonly string[]
  readonly snapshotMatcherFiles: readonly TextOccurrenceEntry[]
}

interface InventoryBaseline {
  readonly digest: string
  readonly ownership: readonly string[]
  readonly schemaVersion: 1
  readonly summary: Readonly<Record<string, number>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function runCommand(command: string, arguments_: readonly string[]): string {
  const result = spawnSync(command, [...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "pipe",
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "")
    throw new Error(
      `${command} ${arguments_.join(" ")} failed with exit code ${String(
        result.status
      )}.`
    )
  }

  return result.stdout
}

function runPnpm(arguments_: readonly string[]): string {
  if (process.platform !== "win32") {
    return runCommand("pnpm", arguments_)
  }

  return runCommand("cmd.exe", ["/d", "/s", "/c", "pnpm", ...arguments_])
}

function normalizeRepositoryPath(path: string): string {
  const absolutePath = resolve(path)
  const relativePath = relative(repositoryRoot, absolutePath)

  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Inventory path is outside the repository: ${path}`)
  }

  return relativePath.replaceAll("\\", "/")
}

function parseWorkspaceEntries(value: unknown): readonly WorkspaceEntry[] {
  if (!Array.isArray(value)) {
    throw new Error("pnpm workspace output must be an array.")
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`pnpm workspace entry ${index} must be an object.`)
    }

    if (typeof entry.name !== "string" || typeof entry.path !== "string") {
      throw new Error(`pnpm workspace entry ${index} requires name and path.`)
    }

    return {
      name: entry.name,
      path: resolve(entry.path),
    }
  })
}

function loadWorkspaceEntries(): readonly WorkspaceEntry[] {
  const value: unknown = JSON.parse(
    runPnpm(["list", "-r", "--depth", "-1", "--json"])
  )
  return parseWorkspaceEntries(value)
}

function loadRepositoryFiles(): readonly string[] {
  const files = runCommand("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .split("\0")
    .filter((path) => path.length > 0)
    .map((path) => path.replaceAll("\\", "/"))

  return filterExistingRepositoryFiles(repositoryRoot, files).sort(
    compareStrings
  )
}

function isInsideWorkspace(
  file: string,
  workspaceRoots: readonly string[]
): boolean {
  return workspaceRoots.some(
    (workspaceRoot) =>
      file === workspaceRoot || file.startsWith(`${workspaceRoot}/`)
  )
}

function readRepositoryFile(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), "utf8")
}

function countMatches(source: string, pattern: RegExp): number {
  return Array.from(source.matchAll(pattern)).length
}

function collectApiEntry(file: string): ApiFileEntry | null {
  const source = readRepositoryFile(file)
  const APIs: Record<string, number> = {}

  for (const match of source.matchAll(/\bjest\.([A-Za-z_$][\w$]*)/g)) {
    const api = match[1]

    if (api === undefined) {
      throw new Error(`Could not read the Jest API occurrence in ${file}.`)
    }

    APIs[api] = (APIs[api] ?? 0) + 1
  }

  if (Object.keys(APIs).length === 0) {
    return null
  }

  return {
    APIs: Object.fromEntries(
      Object.entries(APIs).sort(([left], [right]) =>
        compareStrings(left, right)
      )
    ),
    file,
  }
}

function collectTextOccurrences(
  files: readonly string[],
  pattern: RegExp
): readonly TextOccurrenceEntry[] {
  return files.flatMap((file) => {
    const count = countMatches(readRepositoryFile(file), pattern)
    return count === 0 ? [] : [{ count, file }]
  })
}

function collectFileDigestsContaining(
  files: readonly string[],
  pattern: RegExp
): readonly FileDigestEntry[] {
  return files.flatMap((file) => {
    const source = readRepositoryFile(file).replaceAll("\r\n", "\n")

    return pattern.test(source)
      ? [
          {
            digest: createHash("sha256").update(source).digest("hex"),
            file,
          },
        ]
      : []
  })
}

function parseManifest(workspace: WorkspaceEntry): {
  readonly dependencies: readonly Omit<
    ManifestDependencyEntry,
    "manifest" | "packageName"
  >[]
  readonly name: string
  readonly scripts: Readonly<Record<string, string>>
} {
  const manifestPath = resolve(workspace.path, "package.json")
  const value: unknown = JSON.parse(readFileSync(manifestPath, "utf8"))

  if (!isRecord(value) || typeof value.name !== "string") {
    throw new Error(`Invalid package manifest: ${manifestPath}`)
  }

  const scriptsValue = value.scripts
  if (scriptsValue !== undefined && !isRecord(scriptsValue)) {
    throw new Error(`Invalid scripts object: ${manifestPath}`)
  }

  const scripts: Record<string, string> = {}
  for (const [script, command] of Object.entries(scriptsValue ?? {})) {
    if (typeof command !== "string") {
      throw new Error(`Invalid script ${script}: ${manifestPath}`)
    }
    scripts[script] = command
  }

  const dependencies: Array<
    Omit<ManifestDependencyEntry, "manifest" | "packageName">
  > = []
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const dependencyValue = value[field]

    if (dependencyValue === undefined) {
      continue
    }

    if (!isRecord(dependencyValue)) {
      throw new Error(`Invalid ${field} object: ${manifestPath}`)
    }

    for (const [dependency, specifier] of Object.entries(dependencyValue)) {
      if (typeof specifier !== "string") {
        throw new Error(`Invalid dependency ${dependency}: ${manifestPath}`)
      }

      if (isJestDependency(dependency)) {
        dependencies.push({ dependency, field, specifier })
      }
    }
  }

  return { dependencies, name: value.name, scripts }
}

function isJestDependency(dependency: string): boolean {
  return (
    dependency === "jest" ||
    dependency === "ts-jest" ||
    dependency === "babel-jest" ||
    dependency === "@types/jest" ||
    dependency === "@swc/jest" ||
    dependency === "@testing-library/jest-dom" ||
    dependency.startsWith("@jest/") ||
    dependency.startsWith("jest-")
  )
}

function containsJestCommand(command: string): boolean {
  return /(?:^|[\s;&|])jest(?:\.cmd)?(?=$|[\s;&|])/.test(command)
}

function collectManifestScripts(
  workspaces: readonly WorkspaceEntry[]
): readonly ManifestScriptEntry[] {
  return workspaces
    .flatMap((workspace) => {
      const manifest = parseManifest(workspace)
      const manifestPath = normalizeRepositoryPath(
        resolve(workspace.path, "package.json")
      )

      return Object.entries(manifest.scripts).flatMap(([script, command]) =>
        containsJestCommand(command)
          ? [
              {
                command,
                manifest: manifestPath,
                packageName: manifest.name,
                script,
              },
            ]
          : []
      )
    })
    .sort((left, right) => {
      const manifestOrder = compareStrings(left.manifest, right.manifest)
      return manifestOrder === 0
        ? compareStrings(left.script, right.script)
        : manifestOrder
    })
}

function collectManifestDependencies(
  workspaces: readonly WorkspaceEntry[]
): readonly ManifestDependencyEntry[] {
  return workspaces
    .flatMap((workspace) => {
      const manifest = parseManifest(workspace)
      const manifestPath = normalizeRepositoryPath(
        resolve(workspace.path, "package.json")
      )

      return manifest.dependencies.map((dependency) => ({
        ...dependency,
        manifest: manifestPath,
        packageName: manifest.name,
      }))
    })
    .sort((left, right) => {
      const manifestOrder = compareStrings(left.manifest, right.manifest)
      if (manifestOrder !== 0) {
        return manifestOrder
      }

      const fieldOrder = compareStrings(left.field, right.field)
      return fieldOrder === 0
        ? compareStrings(left.dependency, right.dependency)
        : fieldOrder
    })
}

function collectOwnership(): RemainingJestOwnership {
  const workspaces = loadWorkspaceEntries()
  const workspaceRoots = workspaces
    .filter((workspace) => resolve(workspace.path) !== resolve(repositoryRoot))
    .map((workspace) => normalizeRepositoryPath(workspace.path))
  const files = loadRepositoryFiles()
  const activeFiles = files.filter(
    (file) =>
      isInsideWorkspace(file, workspaceRoots) ||
      file.startsWith("integration-tests/")
  )
  const scriptFiles = activeFiles.filter(
    (file) =>
      /\.(?:[cm]?[jt]sx?)$/.test(file) &&
      !/(?:^|\/)jest\.config\.[cm]?[jt]s$/.test(file) &&
      !file.includes("/dist/") &&
      !file.includes("/node_modules/")
  )
  const foundationScriptFiles = files.filter(
    (file) =>
      file.startsWith("scripts/test-runner/contracts/") &&
      /\.(?:[cm]?[jt]sx?)$/.test(file)
  )
  const foundationVerifierFiles = files.filter(
    (file) =>
      file.startsWith("scripts/test-runner/verify-") && file.endsWith(".mts")
  )
  const apiFiles = scriptFiles
    .map(collectApiEntry)
    .filter((entry): entry is ApiFileEntry => entry !== null)
  const foundationApiFiles = foundationScriptFiles
    .map(collectApiEntry)
    .filter((entry): entry is ApiFileEntry => entry !== null)
  const textArchiveFiles = activeFiles.filter((file) => file.endsWith(".txt"))
  const rootAndCiFiles = files.filter(
    (file) =>
      file.startsWith(".github/") ||
      (file.startsWith("scripts/") && !file.startsWith("scripts/test-runner/"))
  )

  return {
    activeJestConfigs: files.filter(
      (file) =>
        (!file.includes("/") ||
          isInsideWorkspace(file, workspaceRoots) ||
          file.startsWith("integration-tests/")) &&
        /(?:^|\/)jest\.config\.[cm]?[jt]s$/.test(file)
    ),
    activeJestApiFiles: apiFiles,
    archivedJestFiles: collectTextOccurrences(textArchiveFiles, /\bjest\./g),
    explicitJestImports: collectTextOccurrences(
      scriptFiles,
      /(?:from\s+|require\()["']@jest\//g
    ),
    foundationJestApiFiles: foundationApiFiles,
    foundationJestConfigs: files.filter(
      (file) =>
        file.startsWith("scripts/test-runner/") &&
        /(?:^|\/)jest\.config\.[cm]?[jt]s$/.test(file)
    ),
    foundationJestInvocations: collectFileDigestsContaining(
      foundationVerifierFiles,
      /["']jest["']/
    ),
    jestNamespaceTypeFiles: collectTextOccurrences(
      scriptFiles,
      /\bjest\.(?:Mock|Mocked|MockedClass|MockedFunction|MockedObject|SpyInstance|SpiedFunction)\b/g
    ),
    jestWorkerIdFiles: collectTextOccurrences(
      scriptFiles,
      /\bJEST_WORKER_ID\b/g
    ),
    manifestDependencies: collectManifestDependencies(workspaces),
    manifestScripts: collectManifestScripts(workspaces),
    manualMockFiles: activeFiles.filter(
      (file) => file.includes("/__mocks__/") && /\.[cm]?[jt]sx?$/.test(file)
    ),
    mockResetFiles: collectTextOccurrences(scriptFiles, /\.mockReset\s*\(/g),
    rootAndCiInvocations: collectFileDigestsContaining(
      rootAndCiFiles,
      /\bjest\b/i
    ),
    snapshotFiles: activeFiles.filter((file) => file.endsWith(".snap")),
    snapshotMatcherFiles: collectTextOccurrences(
      scriptFiles,
      /\btoMatch(?:Inline)?Snapshot\b/g
    ),
  }
}

function sumApi(
  entries: readonly ApiFileEntry[],
  APIs: readonly string[]
): { readonly files: number; readonly occurrences: number } {
  const matchingEntries = entries.filter((entry) =>
    APIs.some((api) => (entry.APIs[api] ?? 0) > 0)
  )

  return {
    files: matchingEntries.length,
    occurrences: matchingEntries.reduce(
      (total, entry) =>
        total + APIs.reduce((sum, api) => sum + (entry.APIs[api] ?? 0), 0),
      0
    ),
  }
}

function createSummary(
  ownership: RemainingJestOwnership
): Readonly<Record<string, number>> {
  const fn = sumApi(ownership.activeJestApiFiles, ["fn"])
  const spyOn = sumApi(ownership.activeJestApiFiles, ["spyOn"])
  const setTimeout = sumApi(ownership.activeJestApiFiles, ["setTimeout"])
  const moduleMocks = sumApi(ownership.activeJestApiFiles, [
    "doMock",
    "mock",
    "requireActual",
  ])
  const fakeTimers = sumApi(ownership.activeJestApiFiles, [
    "advanceTimersByTime",
    "advanceTimersByTimeAsync",
    "clearAllTimers",
    "runAllTimers",
    "runAllTimersAsync",
    "runOnlyPendingTimers",
    "runOnlyPendingTimersAsync",
    "setSystemTime",
    "useFakeTimers",
    "useRealTimers",
  ])
  const moduleIsolation = sumApi(ownership.activeJestApiFiles, [
    "isolateModules",
    "isolateModulesAsync",
    "resetModules",
  ])
  const resetAllMocks = sumApi(ownership.activeJestApiFiles, ["resetAllMocks"])
  const totalApiOccurrences = ownership.activeJestApiFiles.reduce(
    (total, entry) =>
      total + Object.values(entry.APIs).reduce((sum, count) => sum + count, 0),
    0
  )

  return {
    activeJestApiFiles: ownership.activeJestApiFiles.length,
    activeJestApiOccurrences: totalApiOccurrences,
    activeJestConfigFiles: ownership.activeJestConfigs.length,
    archivedJestFiles: ownership.archivedJestFiles.length,
    explicitJestImportFiles: ownership.explicitJestImports.length,
    fakeTimerFiles: fakeTimers.files,
    fakeTimerOccurrences: fakeTimers.occurrences,
    foundationJestApiFiles: ownership.foundationJestApiFiles.length,
    foundationJestConfigFiles: ownership.foundationJestConfigs.length,
    foundationJestInvocationFiles: ownership.foundationJestInvocations.length,
    jestFnFiles: fn.files,
    jestFnOccurrences: fn.occurrences,
    jestNamespaceTypeFiles: ownership.jestNamespaceTypeFiles.length,
    jestSetTimeoutFiles: setTimeout.files,
    jestSetTimeoutOccurrences: setTimeout.occurrences,
    jestSpyOnFiles: spyOn.files,
    jestSpyOnOccurrences: spyOn.occurrences,
    jestWorkerIdFiles: ownership.jestWorkerIdFiles.length,
    manifestJestScriptEntries: ownership.manifestScripts.length,
    manifestJestScriptOwners: new Set(
      ownership.manifestScripts.map((entry) => entry.manifest)
    ).size,
    manifestJestDependencyEntries: ownership.manifestDependencies.length,
    manifestJestDependencyOwners: new Set(
      ownership.manifestDependencies.map((entry) => entry.manifest)
    ).size,
    manualMockFiles: ownership.manualMockFiles.length,
    mockResetFiles: ownership.mockResetFiles.length,
    moduleIsolationFiles: moduleIsolation.files,
    moduleIsolationOccurrences: moduleIsolation.occurrences,
    moduleMockFiles: moduleMocks.files,
    moduleMockOccurrences: moduleMocks.occurrences,
    rootAndCiInvocationFiles: ownership.rootAndCiInvocations.length,
    resetAllMocksFiles: resetAllMocks.files,
    resetAllMocksOccurrences: resetAllMocks.occurrences,
    snapshotFiles: ownership.snapshotFiles.length,
    snapshotMatcherFiles: ownership.snapshotMatcherFiles.length,
  }
}

function createOwnershipEntries(
  ownership: RemainingJestOwnership
): readonly string[] {
  const categories: ReadonlyArray<readonly [string, readonly unknown[]]> = [
    ["activeJestConfigs", ownership.activeJestConfigs],
    ["activeJestApiFiles", ownership.activeJestApiFiles],
    ["archivedJestFiles", ownership.archivedJestFiles],
    ["explicitJestImports", ownership.explicitJestImports],
    ["foundationJestApiFiles", ownership.foundationJestApiFiles],
    ["foundationJestConfigs", ownership.foundationJestConfigs],
    ["foundationJestInvocations", ownership.foundationJestInvocations],
    ["jestNamespaceTypeFiles", ownership.jestNamespaceTypeFiles],
    ["jestWorkerIdFiles", ownership.jestWorkerIdFiles],
    ["manifestDependencies", ownership.manifestDependencies],
    ["manifestScripts", ownership.manifestScripts],
    ["manualMockFiles", ownership.manualMockFiles],
    ["mockResetFiles", ownership.mockResetFiles],
    ["rootAndCiInvocations", ownership.rootAndCiInvocations],
    ["snapshotFiles", ownership.snapshotFiles],
    ["snapshotMatcherFiles", ownership.snapshotMatcherFiles],
  ]

  return categories
    .flatMap(([category, entries]) =>
      entries.map((entry) => {
        const serialized = JSON.stringify(entry)

        if (serialized === undefined) {
          throw new Error(`Could not serialize remaining-Jest ${category}.`)
        }

        return `${category}\t${serialized}`
      })
    )
    .sort(compareStrings)
}

function createDigest(
  ownership: readonly string[],
  summary: Readonly<Record<string, number>>
): string {
  return createHash("sha256")
    .update(JSON.stringify({ ownership, summary }))
    .digest("hex")
}

function parseBaseline(value: unknown): InventoryBaseline {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.digest !== "string" ||
    !Array.isArray(value.ownership) ||
    !isRecord(value.summary)
  ) {
    throw new Error(
      `Invalid remaining-Jest inventory baseline: ${baselinePath}`
    )
  }

  const summary: Record<string, number> = {}
  for (const [key, count] of Object.entries(value.summary)) {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw new Error(`Invalid inventory count for ${key}.`)
    }
    summary[key] = count
  }

  const ownership = value.ownership.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`Invalid inventory ownership entry ${index}.`)
    }
    return entry
  })

  const sortedOwnership = [...ownership].sort(compareStrings)

  if (!isDeepStrictEqual(ownership, sortedOwnership)) {
    throw new Error("Remaining-Jest ownership entries must be sorted.")
  }

  return {
    digest: value.digest,
    ownership,
    schemaVersion: 1,
    summary,
  }
}

if (unsupportedArguments.length > 0) {
  throw new Error(`Unsupported arguments: ${unsupportedArguments.join(", ")}`)
}

const ownership = collectOwnership()
const ownershipEntries = createOwnershipEntries(ownership)
const summary = createSummary(ownership)
const currentBaseline = {
  digest: createDigest(ownershipEntries, summary),
  ownership: ownershipEntries,
  schemaVersion: 1,
  summary,
} satisfies InventoryBaseline

if (updateBaseline) {
  writeFileSync(baselinePath, `${JSON.stringify(currentBaseline, null, 2)}\n`)
  console.log(
    `Updated the exact remaining-Jest inventory baseline (${currentBaseline.summary.activeJestApiFiles} active API files).`
  )
  process.exit(0)
}

const expectedValue: unknown = JSON.parse(readFileSync(baselinePath, "utf8"))
const expectedBaseline = parseBaseline(expectedValue)
const expectedDigest = createDigest(
  expectedBaseline.ownership,
  expectedBaseline.summary
)

if (expectedBaseline.digest !== expectedDigest) {
  throw new Error(
    "The remaining-Jest baseline digest does not match its ownership and summary."
  )
}

if (
  expectedBaseline.digest !== currentBaseline.digest ||
  !isDeepStrictEqual(expectedBaseline.summary, currentBaseline.summary) ||
  !isDeepStrictEqual(expectedBaseline.ownership, currentBaseline.ownership)
) {
  const expectedOwnership = new Set(expectedBaseline.ownership)
  const currentOwnership = new Set(currentBaseline.ownership)
  const removed = expectedBaseline.ownership.filter(
    (entry) => !currentOwnership.has(entry)
  )
  const added = currentBaseline.ownership.filter(
    (entry) => !expectedOwnership.has(entry)
  )

  console.error("The exact remaining-Jest ownership inventory changed.")
  console.error(`Expected digest: ${expectedBaseline.digest}`)
  console.error(`Current digest:  ${currentBaseline.digest}`)
  console.error("Expected summary:")
  console.error(JSON.stringify(expectedBaseline.summary, null, 2))
  console.error("Current summary:")
  console.error(JSON.stringify(currentBaseline.summary, null, 2))
  console.error("Removed ownership entries:")
  console.error(removed.length === 0 ? "(none)" : removed.join("\n"))
  console.error("Added ownership entries:")
  console.error(added.length === 0 ? "(none)" : added.join("\n"))
  console.error(
    'Review the ownership change, then run "pnpm check:remaining-jest --update" in the completed migration turn.'
  )
  process.exit(1)
}

console.log(
  `Remaining-Jest inventory is exact: ${currentBaseline.summary.activeJestConfigFiles} configs, ${currentBaseline.summary.manifestJestScriptEntries} scripts, ${currentBaseline.summary.activeJestApiFiles} API files.`
)
