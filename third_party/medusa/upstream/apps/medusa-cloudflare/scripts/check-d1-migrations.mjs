import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(appDirectory, "../../..")
const pnpmCommand = process.platform === "win32" ? "cmd.exe" : "pnpm"
const pnpmArgs = (args) =>
  process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...args] : args
const persistencePath = await fs.mkdtemp(
  path.join(os.tmpdir(), "medusa-d1-migrations-")
)
const environment = {
  ...process.env,
  CI: "true",
  WRANGLER_SEND_METRICS: "false",
}

try {
  await runPnpm(["--filter", "medusa-cloudflare", "check:d1-migrations"])
  await runPnpm(
    [
      "--filter",
      "medusa-cloudflare",
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "medusa-cloudflare",
      "--local",
      "--persist-to",
      persistencePath,
    ],
    {
      tolerateTimeout: process.platform === "win32",
      timeoutMs: 45_000,
    }
  )

  const databasePath = await findCurrencyDatabase(persistencePath)
  const database = new DatabaseSync(databasePath)
  try {
    const columns = database.prepare("PRAGMA table_info(currency)").all()
    const rawRounding = columns.find((column) => column.name === "raw_rounding")
    if (
      !rawRounding ||
      rawRounding.notnull !== 1 ||
      rawRounding.dflt_value !== `'{"value":"0","precision":20}'`
    ) {
      throw new Error("Fresh D1 schema does not match Currency DML defaults")
    }

    const seed = database
      .prepare("SELECT code, raw_rounding FROM currency WHERE code = ?")
      .get("usd")
    if (
      !seed ||
      seed.code !== "usd" ||
      seed.raw_rounding !== '{"value":"0","precision":20}'
    ) {
      throw new Error("Fresh D1 database does not contain the Currency seed")
    }
  } finally {
    database.close()
  }

  console.log("Generated Currency migrations passed against a fresh local D1")
} finally {
  await fs.rm(persistencePath, { recursive: true, force: true })
}

async function findCurrencyDatabase(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = await findCurrencyDatabase(entryPath).catch(
        () => undefined
      )
      if (nested) {
        return nested
      }
      continue
    }

    if (!entry.name.endsWith(".sqlite")) {
      continue
    }

    const database = new DatabaseSync(entryPath)
    try {
      const table = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'currency'"
        )
        .get()
      if (table) {
        return entryPath
      }
    } finally {
      database.close()
    }
  }

  throw new Error("Wrangler did not create a Currency D1 database")
}

function runPnpm(args, { timeoutMs, tolerateTimeout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpmCommand, pnpmArgs(args), {
      cwd: rootDirectory,
      env: environment,
      stdio: "inherit",
    })
    let settled = false
    const timeout = timeoutMs
      ? setTimeout(() => {
          if (settled) {
            return
          }
          settled = true
          stopProcessTree(child.pid)
          if (tolerateTimeout) {
            resolve()
            return
          }
          reject(new Error(`pnpm command timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      : undefined

    child.once("error", (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.once("exit", (code) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`pnpm command exited with code ${code}`))
    })
  })
}

function stopProcessTree(pid) {
  if (!pid) {
    return
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
    })
    return
  }

  process.kill(pid, "SIGTERM")
}
