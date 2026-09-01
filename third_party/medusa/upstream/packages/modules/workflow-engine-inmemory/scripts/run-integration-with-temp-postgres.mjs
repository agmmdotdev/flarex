import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(packageRoot, "..", "..", "..")
const isWindows = process.platform === "win32"

const testArgs = normalizeArgs(process.argv.slice(2))

const defaultJestRuns = [
  [
    "--passWithNoTests",
    "--forceExit",
    "--runInBand",
    "--testPathPattern=integration-tests/__tests__/index\\.spec\\.ts",
  ],
  [
    "--passWithNoTests",
    "--forceExit",
    "--runInBand",
    "--testPathPattern=integration-tests/__tests__/race\\.spec\\.ts",
  ],
  [
    "--passWithNoTests",
    "--forceExit",
    "--runInBand",
    "--testPathPattern=integration-tests/__tests__/subscribe\\.spec\\.ts",
  ],
  [
    "--passWithNoTests",
    "--forceExit",
    "--runInBand",
    "--testPathPattern=integration-tests/__tests__/retry-interval\\.spec\\.ts",
  ],
]

const pgBin = resolvePostgresBin()
const port = Number(process.env.TEMP_POSTGRES_PORT) || (await findOpenPort())
const tempRoot = path.join(
  os.tmpdir(),
  `medusa-workflow-engine-pg-${process.pid}-${Date.now()}`
)
const dataDir = path.join(tempRoot, "data")
const passwordFile = path.join(tempRoot, "pw.txt")
const logFile = path.join(tempRoot, "postgres.log")
const password = `medusa_test_${randomUUID().replaceAll("-", "")}`

let started = false

try {
  await mkdir(tempRoot, { recursive: true })
  await writeFile(passwordFile, password)

  await run(pgCommand("initdb"), [
    "-D",
    dataDir,
    "-U",
    "postgres",
    `--pwfile=${passwordFile}`,
    "--auth=scram-sha-256",
    "--encoding=UTF8",
    "--locale=C",
  ])

  await run(pgCommand("pg_ctl"), [
    "-D",
    dataDir,
    "-l",
    logFile,
    "-o",
    `-p ${port} -h 127.0.0.1 -c timezone=UTC`,
    "-w",
    "start",
  ])
  started = true

  const env = {
    ...process.env,
    DB_HOST: "127.0.0.1",
    DB_PORT: String(port),
    DB_USERNAME: "postgres",
    DB_PASSWORD: password,
    PGTZ: "UTC",
    TZ: "UTC",
  }

  const runs = testArgs.length ? [testArgs] : defaultJestRuns
  for (const args of runs) {
    await run(process.execPath, [resolveJestScript(), ...args], {
      cwd: packageRoot,
      env,
    })
  }
} finally {
  if (started) {
    await run(
      pgCommand("pg_ctl"),
      ["-D", dataDir, "-m", "fast", "-w", "stop"],
      {
        rejectOnFailure: false,
      }
    )
  }

  await rm(tempRoot, { recursive: true, force: true })
}

function normalizeArgs(args) {
  return args[0] === "--" ? args.slice(1) : args
}

function resolveJestScript() {
  return path.join(repoRoot, "node_modules", "jest", "bin", "jest.js")
}

function resolvePostgresBin() {
  if (process.env.PG_BIN) {
    return process.env.PG_BIN
  }

  if (isWindows) {
    const base = "C:\\Program Files\\PostgreSQL"
    const version = ["18", "17", "16", "15", "14", "13"].find((candidate) =>
      existsSync(path.join(base, candidate, "bin", "initdb.exe"))
    )

    if (version) {
      return path.join(base, version, "bin")
    }
  }

  return ""
}

function pgCommand(name) {
  const executable = isWindows ? `${name}.exe` : name
  return pgBin ? path.join(pgBin, executable) : executable
}

async function findOpenPort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate TCP port")))
        return
      }

      const { port } = address
      server.close(() => resolve(port))
    })
  })
}

async function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? packageRoot,
    env: options.env ?? process.env,
    stdio: "inherit",
    windowsHide: true,
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code) => resolve(code ?? 1))
  })

  if (exitCode !== 0 && options.rejectOnFailure !== false) {
    throw new Error(`${command} exited with code ${exitCode}`)
  }
}
