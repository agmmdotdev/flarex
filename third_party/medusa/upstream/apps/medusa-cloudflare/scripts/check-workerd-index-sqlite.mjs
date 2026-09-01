import { spawn, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const appRootDirectory = path.resolve(appDirectory, "..")
const rootDirectory = path.resolve(appDirectory, "../../..")
const pnpmCommand = process.platform === "win32" ? "cmd.exe" : "pnpm"
const pnpmArgs = (args) =>
  process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...args] : args
const port = 8794
const environment = {
  ...process.env,
  CI: "true",
  WRANGLER_SEND_METRICS: "false",
}

runPnpm(["--filter", "medusa-cloudflare", "build:index-proof"])

const server = spawn(
  pnpmCommand,
  pnpmArgs([
    "--filter",
    "medusa-cloudflare",
    "exec",
    "wrangler",
    "dev",
    "--config",
    "dist/medusa_cloudflare_index_proof/wrangler.json",
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
  await assertTenantRuntimeScope()
  await assertTenantScopedDurableObjectRouting()
  await assertTenantScopedD1ProjectionRouting()

  const aggregate = `index-proof-${Date.now()}`
  const base = `http://127.0.0.1:${port}/do-index/${aggregate}`

  const doResponse = await fetch(`${base}/query-proof`, { method: "POST" })
  const doProof = await doResponse.json()

  assertIndexProof(
    doResponse,
    doProof,
    "Index Durable Object SQLite proof failed"
  )

  await assertIndexCompositionRuntime(
    `${base}/composition-check`,
    "Index Durable Object SQLite composition check failed"
  )
  await assertIndexEventIngestion(
    `${base}/event-ingestion-check`,
    "Index Durable Object SQLite event ingestion check failed"
  )
  await assertIndexLinkAttachDetach(
    `${base}/link-attach-detach-check`,
    "Index Durable Object SQLite link attach/detach check failed"
  )

  const d1Response = await fetch(
    `http://127.0.0.1:${port}/d1-index/query-proof`,
    { method: "POST" }
  )
  const d1Proof = await d1Response.json()

  assertIndexProof(d1Response, d1Proof, "Index D1 SQLite proof failed")

  await assertIndexCompositionRuntime(
    `http://127.0.0.1:${port}/d1-index/composition-check`,
    "Index D1 SQLite composition check failed"
  )
  await assertIndexEventIngestion(
    `http://127.0.0.1:${port}/d1-index/event-ingestion-check`,
    "Index D1 SQLite event ingestion check failed"
  )
  await assertIndexLinkAttachDetach(
    `http://127.0.0.1:${port}/d1-index/link-attach-detach-check`,
    "Index D1 SQLite link attach/detach check failed"
  )

  console.log(
    "Actual Index module service passed Durable Object SQLite and D1 relation query proofs, no-seed composition checks, event ingestion checks, link attach/detach checks, and tenant runtime scope checks"
  )
} finally {
  stopProcessTree(server.pid)
}

async function assertTenantRuntimeScope() {
  const tenantA = await fetchTenantRuntimeCheck("tenant_a")
  const tenantB = await fetchTenantRuntimeCheck("tenant_b")

  if (
    tenantA.context?.tenantId !== "tenant_a" ||
    tenantB.context?.tenantId !== "tenant_b" ||
    tenantA.cartPartition?.name !==
      "partition:tenant_a:storefront:prod:v1:cart:cart_local" ||
    tenantB.cartPartition?.name !==
      "partition:tenant_b:storefront:prod:v1:cart:cart_local" ||
    tenantA.indexPartition?.name !==
      "partition:tenant_a:storefront:prod:v1:index:index_local" ||
    tenantB.indexPartition?.name !==
      "partition:tenant_b:storefront:prod:v1:index:index_local" ||
    tenantA.catalogProjection?.key !==
      "projection:tenant_a:storefront:prod:v1:catalog" ||
    tenantB.catalogProjection?.key !==
      "projection:tenant_b:storefront:prod:v1:catalog" ||
    tenantA.cartPartition.name === tenantB.cartPartition.name ||
    tenantA.indexPartition.name === tenantB.indexPartition.name ||
    tenantA.catalogProjection.key === tenantB.catalogProjection.key
  ) {
    throw new Error(
      `Tenant runtime scope check failed: ${JSON.stringify({
        tenantA,
        tenantB,
      })}`
    )
  }

  const invalidResponse = await fetch(
    `http://127.0.0.1:${port}/tenant-runtime/check`,
    {
      headers: {
        "x-medusa-tenant-id": "tenant:bad",
      },
    }
  )
  const invalidCheck = await invalidResponse.json()

  if (invalidResponse.status !== 400 || invalidCheck?.field !== "tenantId") {
    throw new Error(
      `Tenant runtime validation check failed: ${JSON.stringify(invalidCheck)}`
    )
  }
}

async function assertTenantScopedDurableObjectRouting() {
  const aggregate = "shared-index-proof-scope"
  const url = `http://127.0.0.1:${port}/do-index/${aggregate}/composition-check`
  const tenantAResponse = await fetch(url, {
    method: "POST",
    headers: tenantHeaders("tenant_a"),
  })
  const tenantACheck = await tenantAResponse.json()
  const tenantBResponse = await fetch(url, {
    method: "POST",
    headers: tenantHeaders("tenant_b"),
  })
  const tenantBCheck = await tenantBResponse.json()
  const tenantAPartition = tenantAResponse.headers.get(
    "x-medusa-partition-name"
  )
  const tenantBPartition = tenantBResponse.headers.get(
    "x-medusa-partition-name"
  )

  assertIndexCompositionCheck(
    tenantAResponse,
    tenantACheck,
    "Tenant A Index Durable Object composition check failed"
  )
  assertIndexCompositionCheck(
    tenantBResponse,
    tenantBCheck,
    "Tenant B Index Durable Object composition check failed"
  )

  if (
    tenantAPartition !==
      "partition:tenant_a:storefront:prod:v1:index:shared-index-proof-scope" ||
    tenantBPartition !==
      "partition:tenant_b:storefront:prod:v1:index:shared-index-proof-scope" ||
    tenantAPartition === tenantBPartition
  ) {
    throw new Error(
      `Tenant Durable Object partition routing failed: ${JSON.stringify({
        tenantAPartition,
        tenantBPartition,
      })}`
    )
  }

  const invalidResponse = await fetch(url, {
    method: "POST",
    headers: {
      ...tenantHeaders("tenant:bad"),
    },
  })
  const invalidCheck = await invalidResponse.json()

  if (invalidResponse.status !== 400 || invalidCheck?.field !== "tenantId") {
    throw new Error(
      `Tenant Durable Object validation check failed: ${JSON.stringify(
        invalidCheck
      )}`
    )
  }
}

async function assertTenantScopedD1ProjectionRouting() {
  const tenantAResponse = await fetch(
    `http://127.0.0.1:${port}/d1-index/query-proof`,
    {
      method: "POST",
      headers: tenantHeaders("tenant_a"),
    }
  )
  const tenantAProof = await tenantAResponse.json()
  const tenantBResponse = await fetch(
    `http://127.0.0.1:${port}/d1-index/query-proof`,
    {
      method: "POST",
      headers: tenantHeaders("tenant_b"),
    }
  )
  const tenantBProof = await tenantBResponse.json()
  const tenantADatabase = tenantAResponse.headers.get(
    "x-medusa-projection-database"
  )
  const tenantBDatabase = tenantBResponse.headers.get(
    "x-medusa-projection-database"
  )
  const tenantABinding = tenantAResponse.headers.get("x-medusa-d1-binding")
  const tenantBBinding = tenantBResponse.headers.get("x-medusa-d1-binding")

  assertIndexProof(
    tenantAResponse,
    tenantAProof,
    "Tenant A Index D1 projection proof failed"
  )
  assertIndexProof(
    tenantBResponse,
    tenantBProof,
    "Tenant B Index D1 projection proof failed"
  )

  if (
    tenantADatabase !== "projection-db:tenant_a:storefront:prod:v1:index" ||
    tenantBDatabase !== "projection-db:tenant_b:storefront:prod:v1:index" ||
    tenantABinding !== "INDEX_DB_TENANT_A" ||
    tenantBBinding !== "INDEX_DB_TENANT_B" ||
    tenantADatabase === tenantBDatabase ||
    tenantABinding === tenantBBinding
  ) {
    throw new Error(
      `Tenant D1 projection routing failed: ${JSON.stringify({
        tenantADatabase,
        tenantBDatabase,
        tenantABinding,
        tenantBBinding,
      })}`
    )
  }

  const invalidResponse = await fetch(
    `http://127.0.0.1:${port}/d1-index/composition-check`,
    {
      method: "POST",
      headers: tenantHeaders("tenant:bad"),
    }
  )
  const invalidCheck = await invalidResponse.json()

  if (invalidResponse.status !== 400 || invalidCheck?.field !== "tenantId") {
    throw new Error(
      `Tenant D1 projection validation check failed: ${JSON.stringify(
        invalidCheck
      )}`
    )
  }
}

async function fetchTenantRuntimeCheck(tenantId) {
  const response = await fetch(
    `http://127.0.0.1:${port}/tenant-runtime/check`,
    {
      headers: tenantHeaders(tenantId),
    }
  )
  const check = await response.json()

  if (!response.ok) {
    throw new Error(`Tenant runtime check failed: ${JSON.stringify(check)}`)
  }

  return check
}

function tenantHeaders(tenantId) {
  return {
    "x-medusa-tenant-id": tenantId,
    "x-medusa-deployment-id": "storefront",
    "x-medusa-environment": "prod",
    "x-medusa-deployment-version": "v1",
  }
}

function assertIndexProof(response, proof, message) {
  if (
    !response.ok ||
    proof?.matched !== true ||
    proof?.categoryFilterMatched !== true ||
    proof?.productSearchMatched !== true ||
    proof?.unfilteredProductListMatched !== true ||
    proof?.unfilteredProductCount !== 2 ||
    proof?.productIdFilterMatched !== true ||
    proof?.productStatusFilterMatched !== true ||
    proof?.productDirectScalarFiltersMatched !== true ||
    proof?.productTypeCollectionFilterMatched !== true ||
    proof?.productRouteRelationFiltersMatched !== true ||
    proof?.variantIdFilterMatched !== true ||
    proof?.variantRouteFiltersMatched !== true ||
    proof?.tagFilterMatched !== true ||
    proof?.productId !== "prod_1" ||
    proof?.firstCategoryHandle !== "category-1" ||
    proof?.firstCategoryName !== "Category 1" ||
    proof?.collectionHandle !== "collection-1" ||
    proof?.collectionTitle !== "Collection 1" ||
    proof?.firstImageRank !== 0 ||
    proof?.firstImageUrl !== "https://example.test/product-image-1.png" ||
    proof?.firstOptionTitle !== "Color" ||
    proof?.firstOptionValue !== "Red" ||
    proof?.firstSalesChannelName !== "Default Sales Channel" ||
    proof?.firstTagValue !== "Featured" ||
    proof?.productTypeValue !== "Type 1" ||
    proof?.firstVariantImageUrl !==
      "https://example.test/variant-image-1.png" ||
    proof?.firstVariantOptionValue !== "Red" ||
    proof?.firstVariantSku !== "aaa test aaa" ||
    proof?.firstPriceAmount !== 100 ||
    proof?.firstPriceRuleAttribute !== "region_id" ||
    proof?.firstPriceRuleValue !== "reg_1"
  ) {
    throw new Error(`${message}: ${JSON.stringify(proof)}`)
  }
}

async function assertIndexCompositionRuntime(url, message) {
  const firstResponse = await fetch(url, { method: "POST" })
  const firstCheck = await firstResponse.json()
  const secondResponse = await fetch(url, { method: "POST" })
  const secondCheck = await secondResponse.json()

  assertIndexCompositionCheck(firstResponse, firstCheck, message)
  assertIndexCompositionCheck(secondResponse, secondCheck, message)

  if (
    firstCheck.runtimeInstanceId !== secondCheck.runtimeInstanceId ||
    firstCheck.serviceInitializations !== 1 ||
    secondCheck.serviceInitializations !== 1
  ) {
    throw new Error(
      `${message}: runtime was not reused: ${JSON.stringify({
        firstCheck,
        secondCheck,
      })}`
    )
  }
}

function assertIndexCompositionCheck(response, check, message) {
  if (
    !response.ok ||
    check?.matched !== true ||
    check?.seeded !== false ||
    check?.moduleEntity !== "Product" ||
    check?.rootAlias !== "product" ||
    check?.dataCount !== 0 ||
    check?.estimateCount !== 0 ||
    typeof check?.runtimeInstanceId !== "number" ||
    check?.serviceInitializations !== 1
  ) {
    throw new Error(`${message}: ${JSON.stringify(check)}`)
  }
}

async function assertIndexEventIngestion(url, message) {
  const response = await fetch(url, { method: "POST" })
  const check = await response.json()

  if (
    !response.ok ||
    check?.matched !== true ||
    check?.createMatched !== true ||
    check?.updateMatched !== true ||
    check?.deleteMatched !== true ||
    check?.moduleEntity !== "Product" ||
    check?.rootAlias !== "product" ||
    check?.writePath !== "event" ||
    check?.productId !== "prod_worker_index_event" ||
    check?.productHandle !== "worker-index-event-product" ||
    check?.productExternalId !== "external_worker_index_event" ||
    check?.productTitle !== "Worker Index Event Product" ||
    check?.updatedProductHandle !== "worker-index-event-product-updated" ||
    check?.updatedProductTitle !== "Worker Index Event Product Updated" ||
    check?.deleteDataCount !== 0 ||
    check?.deleteEstimateCount !== 0 ||
    check?.serviceInitializations !== 1
  ) {
    throw new Error(`${message}: ${JSON.stringify(check)}`)
  }
}

async function assertIndexLinkAttachDetach(url, message) {
  const response = await fetch(url, { method: "POST" })
  const check = await response.json()

  if (
    !response.ok ||
    check?.matched !== true ||
    check?.attachMatched !== true ||
    check?.detachMatched !== true ||
    check?.moduleEntity !== "LinkProductVariantPriceSet" ||
    check?.rootAlias !== "product" ||
    check?.writePath !== "event" ||
    check?.attachDataCount !== 1 ||
    check?.detachDataCount !== 0 ||
    check?.detachEstimateCount !== 0 ||
    check?.productId !== "prod_worker_index_link" ||
    check?.productVariantId !== "var_worker_index_link" ||
    check?.variantPriceId !== "price_worker_index_link" ||
    check?.variantPriceAmount !== 500 ||
    check?.serviceInitializations !== 1
  ) {
    throw new Error(`${message}: ${JSON.stringify(check)}`)
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
      // The workerd-backed Wrangler server is still starting.
    }
  }

  throw new Error("Timed out waiting for the workerd-backed Wrangler server")
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
