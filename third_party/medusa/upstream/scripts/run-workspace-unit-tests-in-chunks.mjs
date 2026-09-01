import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const pnpmCommand = process.platform === "win32" ? "cmd.exe" : "pnpm"
const pnpmArgs = (args) =>
  process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...args] : args

function runPnpm(args, options = {}) {
  return spawnSync(pnpmCommand, pnpmArgs(args), {
    stdio: options.stdio ?? "inherit",
    encoding: "utf8",
    ...options,
  })
}

function getChunks() {
  if (process.env.CHUNKS) {
    return JSON.parse(process.env.CHUNKS)
  }

  const result = runPnpm(["list", "-r", "--depth", "-1", "--json"], {
    stdio: "pipe",
  })

  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "")
    process.exit(result.status ?? 1)
  }

  const workspaceRoot = resolve(process.cwd())
  const workspaceNames = JSON.parse(result.stdout)
    .filter((workspace) => {
      return resolve(workspace.path) !== workspaceRoot
    })
    .map((workspace) => {
      return workspace.name
    })
  const chunkSize = Math.ceil(workspaceNames.length / 2)
  const chunks = []

  for (let index = 0; index < workspaceNames.length; index += chunkSize) {
    chunks.push(workspaceNames.slice(index, index + chunkSize))
  }

  return chunks
}

const chunks = getChunks()
const chunkIndex = Number.parseInt(process.env.CHUNK ?? "0", 10)
const workspaces = chunks[chunkIndex]

if (!Array.isArray(workspaces)) {
  console.error(`No workspace test chunk found for CHUNK=${process.env.CHUNK}`)
  process.exit(1)
}

console.log(`workspaces - ${JSON.stringify(workspaces)}`)

const filters = workspaces.flatMap((workspace) => [`--filter=${workspace}`])
const workspaceConcurrency = process.env.WORKSPACE_CONCURRENCY ?? "1"
const concurrencyArgs = workspaceConcurrency
  ? [`--workspace-concurrency=${workspaceConcurrency}`]
  : []
const result = runPnpm([
  ...concurrencyArgs,
  ...filters,
  "test",
  ...process.argv.slice(2),
])

process.exit(result.status ?? 1)
