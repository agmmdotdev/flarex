import { spawn, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const appRootDirectory = path.resolve(appDirectory, "..")
const rootDirectory = path.resolve(appDirectory, "../../..")
const pnpmCommand = process.platform === "win32" ? "cmd.exe" : "pnpm"
const pnpmArgs = (args) =>
  process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...args] : args
const port = 8792
const environment = {
  ...process.env,
  CI: "true",
  WRANGLER_SEND_METRICS: "false",
}

runPnpm(["--filter", "medusa-cloudflare", "build"])

const server = spawn(
  pnpmCommand,
  pnpmArgs([
    "--filter",
    "medusa-cloudflare",
    "exec",
    "wrangler",
    "dev",
    "--config",
    "dist/medusa_cloudflare/wrangler.json",
    "--ip",
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
  await assertTenantScopedCurrencyDurableObjectRouting()
  const aggregate = `proof-${Date.now()}`
  const base = `http://127.0.0.1:${port}/do-currency/${aggregate}`
  const code = `do_${Date.now()}`
  const createdResponse = await fetch(`${base}/currencies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      symbol: "D",
      symbol_native: "D",
      name: "Durable Object Currency",
    }),
  })
  if (!createdResponse.ok) {
    throw new Error(`DO Currency create returned HTTP ${createdResponse.status}`)
  }

  const listResponse = await fetch(`${base}/currencies`)
  const currencies = await listResponse.json()
  if (
    !listResponse.ok ||
    !Array.isArray(currencies) ||
    !currencies.some((currency) => currency?.code === code)
  ) {
    throw new Error("DO SQLite manager did not persist the Currency row")
  }

  const capabilitiesResponse = await fetch(`${base}/capabilities`)
  const capabilities = await capabilitiesResponse.json()
  if (
    !capabilitiesResponse.ok ||
    capabilities?.transactionMode !== "atomic"
  ) {
    throw new Error("DO SQLite manager did not expose atomic semantics")
  }

  const rollbackResponse = await fetch(`${base}/transaction-rollback-proof`, {
    method: "POST",
  })
  const rollback = await rollbackResponse.json()
  if (
    !rollbackResponse.ok ||
    rollback?.transactionMode !== "atomic" ||
    rollback?.visibleInsideTransaction !== true ||
    rollback?.rolledBack !== true
  ) {
    throw new Error(
      "DO SQLite manager did not provide read-your-own-writes and atomic rollback"
    )
  }

  console.log(
    "Actual Currency module service passed Durable Object SQLite execution and atomic async transaction rollback"
  )
} finally {
  stopProcessTree(server.pid)
}

async function assertTenantScopedCurrencyDurableObjectRouting() {
  const aggregate = "shared-currency-proof-scope"
  const url = `http://127.0.0.1:${port}/do-currency/${aggregate}/capabilities`
  const tenantAResponse = await fetch(url, {
    headers: tenantHeaders("tenant_a"),
  })
  const tenantACapabilities = await tenantAResponse.json()
  const tenantBResponse = await fetch(url, {
    headers: tenantHeaders("tenant_b"),
  })
  const tenantBCapabilities = await tenantBResponse.json()
  const tenantAPartition = tenantAResponse.headers.get(
    "x-medusa-partition-name"
  )
  const tenantBPartition = tenantBResponse.headers.get(
    "x-medusa-partition-name"
  )

  if (
    !tenantAResponse.ok ||
    !tenantBResponse.ok ||
    tenantACapabilities?.transactionMode !== "atomic" ||
    tenantBCapabilities?.transactionMode !== "atomic" ||
    tenantAPartition !==
      "partition:tenant_a:storefront:prod:v1:currency:shared-currency-proof-scope" ||
    tenantBPartition !==
      "partition:tenant_b:storefront:prod:v1:currency:shared-currency-proof-scope" ||
    tenantAPartition === tenantBPartition
  ) {
    throw new Error(
      `Tenant Currency Durable Object partition routing failed: ${JSON.stringify(
        {
          tenantACapabilities,
          tenantBCapabilities,
          tenantAPartition,
          tenantBPartition,
        }
      )}`
    )
  }

  const invalidResponse = await fetch(url, {
    headers: tenantHeaders("tenant:bad"),
  })
  const invalidCheck = await invalidResponse.json()

  if (invalidResponse.status !== 400 || invalidCheck?.field !== "tenantId") {
    throw new Error(
      `Tenant Currency Durable Object validation check failed: ${JSON.stringify(
        invalidCheck
      )}`
    )
  }
}

function tenantHeaders(tenantId) {
  return {
    "x-medusa-tenant-id": tenantId,
    "x-medusa-deployment-id": "storefront",
    "x-medusa-environment": "prod",
    "x-medusa-deployment-version": "v1",
  }
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

function runPnpm(args) {
  const result = spawnSync(pnpmCommand, pnpmArgs(args), {
    cwd: rootDirectory,
    env: environment,
    stdio: "inherit",
  })

  if (result.status !== 0) {
    throw new Error(`pnpm command failed: pnpm ${args.join(" ")}`)
  }
}
