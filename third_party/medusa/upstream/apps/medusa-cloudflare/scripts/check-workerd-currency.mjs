import { spawn, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(appDirectory, "../../..")
const pnpmCommand = process.platform === "win32" ? "cmd.exe" : "pnpm"
const pnpmArgs = (args) =>
  process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...args] : args
const port = 8791
const environment = {
  ...process.env,
  CI: "true",
  WRANGLER_SEND_METRICS: "false",
}

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
  ],
  {
    tolerateTimeout: process.platform === "win32",
    timeoutMs: 45_000,
  }
)

const server = spawn(
  pnpmCommand,
  pnpmArgs([
    "--filter",
    "medusa-cloudflare",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ]),
  {
    cwd: rootDirectory,
    env: environment,
    stdio: "inherit",
  }
)

try {
  await waitForHealth()
  const response = await fetch(`http://127.0.0.1:${port}/currencies`)
  if (!response.ok) {
    throw new Error(`Currency Worker returned HTTP ${response.status}`)
  }

  const currencies = await response.json()
  if (
    !Array.isArray(currencies) ||
    !currencies.some(
      (currency) =>
        currency &&
        typeof currency === "object" &&
        "code" in currency &&
        currency.code === "usd"
    )
  ) {
    throw new Error("Actual Currency module did not return the seeded USD row")
  }

  const code = `workerd_${Date.now()}`
  const createdResponse = await fetch(`http://127.0.0.1:${port}/currencies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      symbol: "W",
      symbol_native: "W",
      name: "Workerd Currency",
    }),
  })
  if (!createdResponse.ok) {
    throw new Error(`Currency create returned HTTP ${createdResponse.status}`)
  }
  const created = await createdResponse.json()
  if (
    !created ||
    created.code !== code ||
    created.name !== "Workerd Currency"
  ) {
    throw new Error("Actual Currency module did not create the D1 row")
  }

  const updatedResponse = await fetch(
    `http://127.0.0.1:${port}/currencies/${encodeURIComponent(code)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Updated Workerd Currency" }),
    }
  )
  if (!updatedResponse.ok) {
    throw new Error(`Currency update returned HTTP ${updatedResponse.status}`)
  }
  const updated = await updatedResponse.json()
  if (
    !updated ||
    updated.code !== code ||
    updated.name !== "Updated Workerd Currency"
  ) {
    throw new Error("Actual Currency module did not update the D1 row")
  }

  const softDeletedResponse = await fetch(
    `http://127.0.0.1:${port}/currencies/${encodeURIComponent(
      code
    )}/soft-delete`,
    { method: "POST" }
  )
  if (!softDeletedResponse.ok) {
    throw new Error(
      `Currency soft delete returned HTTP ${softDeletedResponse.status}`
    )
  }
  const softDeleted = await softDeletedResponse.json()
  if (
    !softDeleted ||
    !Array.isArray(softDeleted.Currency) ||
    !softDeleted.Currency.some(
      (currency) =>
        currency &&
        typeof currency === "object" &&
        "code" in currency &&
        currency.code === code
    )
  ) {
    throw new Error("Actual Currency module did not return its soft-delete map")
  }

  const afterSoftDeleteResponse = await fetch(
    `http://127.0.0.1:${port}/currencies`
  )
  const afterSoftDelete = await afterSoftDeleteResponse.json()
  if (
    !afterSoftDeleteResponse.ok ||
    !Array.isArray(afterSoftDelete) ||
    afterSoftDelete.some(
      (currency) =>
        currency &&
        typeof currency === "object" &&
        "code" in currency &&
        currency.code === code
    )
  ) {
    throw new Error("Actual Currency module did not hide the soft-deleted row")
  }

  const restoredResponse = await fetch(
    `http://127.0.0.1:${port}/currencies/${encodeURIComponent(code)}/restore`,
    { method: "POST" }
  )
  if (!restoredResponse.ok) {
    throw new Error(`Currency restore returned HTTP ${restoredResponse.status}`)
  }
  const restored = await restoredResponse.json()
  if (
    !restored ||
    !Array.isArray(restored.Currency) ||
    !restored.Currency.some(
      (currency) =>
        currency &&
        typeof currency === "object" &&
        "code" in currency &&
        currency.code === code
    )
  ) {
    throw new Error("Actual Currency module did not return its restore map")
  }

  const afterRestoreResponse = await fetch(
    `http://127.0.0.1:${port}/currencies`
  )
  const afterRestore = await afterRestoreResponse.json()
  if (
    !afterRestoreResponse.ok ||
    !Array.isArray(afterRestore) ||
    !afterRestore.some(
      (currency) =>
        currency &&
        typeof currency === "object" &&
        "code" in currency &&
        currency.code === code &&
        "name" in currency &&
        currency.name === "Updated Workerd Currency"
    )
  ) {
    throw new Error("Actual Currency module did not restore the D1 row")
  }

  const capabilitiesResponse = await fetch(
    `http://127.0.0.1:${port}/persistence-capabilities`
  )
  const capabilities = await capabilitiesResponse.json()
  if (
    !capabilitiesResponse.ok ||
    !capabilities ||
    capabilities.transactionMode !== "statement"
  ) {
    throw new Error("D1 transaction limitation is not exposed by the runtime")
  }

  const deletedResponse = await fetch(
    `http://127.0.0.1:${port}/currencies/${encodeURIComponent(code)}`,
    { method: "DELETE" }
  )
  if (deletedResponse.status !== 204) {
    throw new Error(`Currency delete returned HTTP ${deletedResponse.status}`)
  }

  const afterDeleteResponse = await fetch(`http://127.0.0.1:${port}/currencies`)
  const afterDelete = await afterDeleteResponse.json()
  if (
    !afterDeleteResponse.ok ||
    !Array.isArray(afterDelete) ||
    afterDelete.some(
      (currency) =>
        currency &&
        typeof currency === "object" &&
        "code" in currency &&
        currency.code === code
    )
  ) {
    throw new Error("Actual Currency module did not delete the D1 row")
  }

  console.log(
    `Actual Currency module passed D1 read/create/update/soft-delete/restore/delete with ${capabilities.transactionMode} transaction semantics`
  )
} finally {
  stopProcessTree(server.pid)
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) {
        return
      }
    } catch {
      // The workerd-backed Vite server is still starting.
    }
  }

  throw new Error("Timed out waiting for the workerd-backed Vite server")
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
            console.warn(
              "Wrangler local D1 migration command timed out during cleanup; continuing to the workerd runtime assertion."
            )
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
