import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]
const writeChanges = process.argv.includes("--write")
const unsupportedArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--write")

if (unsupportedArguments.length > 0) {
  console.error(`Unsupported arguments: ${unsupportedArguments.join(", ")}`)
  process.exit(1)
}

const pnpmCommand = process.platform === "win32" ? "cmd.exe" : "pnpm"
const pnpmArguments = ["list", "-r", "--depth", "-1", "--json"]
const pnpmResult = spawnSync(
  pnpmCommand,
  process.platform === "win32"
    ? ["/d", "/s", "/c", "pnpm", ...pnpmArguments]
    : pnpmArguments,
  {
    encoding: "utf8",
    stdio: "pipe",
  }
)

if (pnpmResult.error) {
  console.error(pnpmResult.error)
  process.exit(1)
}

if (pnpmResult.status !== 0) {
  process.stderr.write(pnpmResult.stderr ?? "")
  process.exit(pnpmResult.status ?? 1)
}

let workspaces

try {
  workspaces = JSON.parse(pnpmResult.stdout)
} catch (error) {
  console.error("Could not parse pnpm workspace output.")
  console.error(error)
  process.exit(1)
}

const repositoryRoot = resolve(process.cwd())
const workspaceNames = new Set(
  workspaces
    .map((workspace) => workspace.name)
    .filter((name) => typeof name === "string")
)
const inspectedWorkspaces = workspaces.filter((workspace) => {
  const workspacePath = resolve(workspace.path)
  const relativePath = relative(repositoryRoot, workspacePath)

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  )
})
const violations = []
const changedManifests = []

for (const workspace of inspectedWorkspaces) {
  const manifestPath = join(workspace.path, "package.json")
  const manifestSource = readFileSync(manifestPath, "utf8")
  const manifest = JSON.parse(manifestSource)
  let changed = false

  for (const field of dependencyFields) {
    const dependencies = manifest[field]

    if (!dependencies) {
      continue
    }

    for (const [dependencyName, specifier] of Object.entries(dependencies)) {
      if (
        workspaceNames.has(dependencyName) &&
        typeof specifier === "string" &&
        specifier !== "workspace:*"
      ) {
        violations.push({
          dependencyName,
          field,
          manifestPath,
          packageName: manifest.name,
          specifier,
        })

        if (writeChanges) {
          dependencies[dependencyName] = "workspace:*"
          changed = true
        }
      }
    }
  }

  if (changed) {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    changedManifests.push(manifestPath)
  }
}

if (violations.length === 0) {
  console.log(
    `All local dependency edges in ${inspectedWorkspaces.length} workspace manifests use workspace:*.`
  )
  process.exit(0)
}

if (writeChanges) {
  console.log(
    `Updated ${violations.length} local dependency edges across ${changedManifests.length} workspace manifests.`
  )
  process.exit(0)
}

for (const violation of violations) {
  const manifestPath = relative(repositoryRoot, violation.manifestPath)
  console.error(
    `${manifestPath}: ${violation.packageName} ${violation.field}.${violation.dependencyName} uses ${violation.specifier}`
  )
}

console.error(
  `Found ${violations.length} local dependency edges that do not use workspace:*. Run "pnpm check:workspace-dependencies -- --write" to update them.`
)
process.exit(1)
