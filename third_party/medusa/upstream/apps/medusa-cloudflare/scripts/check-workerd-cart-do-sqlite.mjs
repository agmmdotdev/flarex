import { spawn, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const appRootDirectory = path.resolve(appDirectory, "..")
const rootDirectory = path.resolve(appDirectory, "../../..")
const pnpmCommand = process.platform === "win32" ? "cmd.exe" : "pnpm"
const pnpmArgs = (args) =>
  process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...args] : args
const port = 8793
const medusaCloudflareWorkerProofJwtSecret =
  "medusa-cloudflare-worker-proof-secret"
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
  await assertTenantScopedCartDurableObjectRouting()
  await seedStaticProductProof()

  const httpProofResponse = await fetch(
    `http://127.0.0.1:${port}/http-proof/workerd?source=workerd`
  )
  const httpProof = await httpProofResponse.json()
  if (
    !httpProofResponse.ok ||
    httpProofResponse.headers.get("x-medusa-http-proof") !== "static-fetch" ||
    httpProof?.id !== "workerd" ||
    httpProof?.middlewareApplied !== true ||
    httpProof?.source !== "workerd"
  ) {
    throw new Error(
      `Static HTTP resources did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        httpProof
      )}`
    )
  }

  await assertAdminIndexRoutes()
  await assertAdminUserReadRoutes()
  await assertPaymentWebhookRoute()
  await assertAuthRoutes()
  await assertAuthSessionRoute()
  await assertWorkflowExecutionReadRoutes()

  const pluginsResponse = await fetch(
    `http://127.0.0.1:${port}/admin/plugins`
  )
  const plugins = await pluginsResponse.json()
  if (
    !pluginsResponse.ok ||
    !Array.isArray(plugins?.plugins) ||
    plugins.plugins.length !== 2 ||
    plugins.plugins[0]?.name !== "worker-static-plugin" ||
    plugins.plugins[1]?.name !== "worker-object-plugin"
  ) {
    throw new Error(
      `Real Medusa admin/plugins route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        plugins
      )}`
    )
  }

  const currenciesRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/currencies?fields=code,symbol,name&code=usd&limit=5&offset=1&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const currenciesRoute = await currenciesRouteResponse.json()
  if (
    !currenciesRouteResponse.ok ||
    currenciesRouteResponse.headers.get("x-medusa-publishable-key-proof") !==
      "pk_worker_http_proof" ||
    currenciesRouteResponse.headers.get(
      "x-medusa-publishable-sales-channel-count"
    ) !== "1" ||
    currenciesRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    currenciesRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    !Array.isArray(currenciesRoute?.currencies) ||
    currenciesRoute.currencies.length !== 1 ||
    currenciesRoute.currencies[0]?.code !== "usd" ||
    currenciesRoute.currencies[0]?.symbol !== "$" ||
    currenciesRoute.currencies[0]?.name !== "US Dollar" ||
    currenciesRoute.currencies[0]?.filter !== "usd" ||
    currenciesRoute?.count !== 1 ||
    currenciesRoute?.offset !== 1 ||
    currenciesRoute?.limit !== 5
  ) {
    throw new Error(
      `Real Medusa store/currencies route did not receive prepared request metadata in workerd: ${JSON.stringify(
        currenciesRoute
      )}`
    )
  }

  const currencyRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/currencies/usd?fields=code,symbol,name&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const currencyRoute = await currencyRouteResponse.json()
  if (
    !currencyRouteResponse.ok ||
    currencyRouteResponse.headers.get("x-medusa-publishable-key-proof") !==
      "pk_worker_http_proof" ||
    currencyRouteResponse.headers.get("x-medusa-locale-proof") !== "en-US" ||
    currencyRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    currencyRoute?.currency?.code !== "usd" ||
    currencyRoute.currency?.symbol !== "$" ||
    currencyRoute.currency?.name !== "US Dollar"
  ) {
    throw new Error(
      `Real Medusa store/currencies/:code route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        currencyRoute
      )}`
    )
  }

  const adminCurrenciesRouteResponse = await fetch(
    `http://127.0.0.1:${port}/admin/currencies?order=code`
  )
  const adminCurrenciesRoute = await adminCurrenciesRouteResponse.json()
  if (
    !adminCurrenciesRouteResponse.ok ||
    !Array.isArray(adminCurrenciesRoute?.currencies) ||
    adminCurrenciesRoute.currencies.length !== 123 ||
    !adminCurrenciesRoute.currencies.some(
      (currency) =>
        currency?.code === "usd" && currency?.name === "US Dollar"
    ) ||
    adminCurrenciesRoute?.count !== 123 ||
    adminCurrenciesRoute?.offset !== 0 ||
    adminCurrenciesRoute?.limit !== 200
  ) {
    throw new Error(
      `Real Medusa admin/currencies route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        adminCurrenciesRoute
      )}`
    )
  }

  const filteredAdminCurrenciesRouteResponse = await fetch(
    `http://127.0.0.1:${port}/admin/currencies?q=us&order=code`
  )
  const filteredAdminCurrenciesRoute =
    await filteredAdminCurrenciesRouteResponse.json()
  if (
    !filteredAdminCurrenciesRouteResponse.ok ||
    !Array.isArray(filteredAdminCurrenciesRoute?.currencies) ||
    !["aud", "byn", "rub", "usd"].every((code) =>
      filteredAdminCurrenciesRoute.currencies.some(
        (currency) => currency?.code === code
      )
    )
  ) {
    throw new Error(
      `Real Medusa admin/currencies route did not apply query middleware in workerd: ${JSON.stringify(
        filteredAdminCurrenciesRoute
      )}`
    )
  }

  const missingCurrencyRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/currencies/zzz?fields=code,symbol,name&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const missingCurrencyRoute = await missingCurrencyRouteResponse.json()
  if (
    missingCurrencyRouteResponse.status !== 404 ||
    missingCurrencyRoute?.type !== "not_found" ||
    missingCurrencyRoute?.message !==
      "Currency with code: zzz was not found"
  ) {
    throw new Error(
      `Real Medusa store/currencies/:code route did not return the expected not-found error through the Fetch adapter in workerd: ${JSON.stringify(
        missingCurrencyRoute
      )}`
    )
  }

  const regionsRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/regions?fields=id,name,currency_code&id=reg_worker_http_proof&limit=5&offset=2&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const regionsRoute = await regionsRouteResponse.json()
  if (
    !regionsRouteResponse.ok ||
    regionsRouteResponse.headers.get("x-medusa-publishable-key-proof") !==
      "pk_worker_http_proof" ||
    regionsRouteResponse.headers.get("x-medusa-locale-proof") !== "en-US" ||
    regionsRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    !Array.isArray(regionsRoute?.regions) ||
    regionsRoute.regions.length !== 1 ||
    regionsRoute.regions[0]?.id !== "reg_worker_http_proof" ||
    regionsRoute.regions[0]?.name !== "Worker Region" ||
    regionsRoute.regions[0]?.currency_code !== "usd" ||
    regionsRoute.regions[0]?.filter?.id !== "reg_worker_http_proof" ||
    regionsRoute?.count !== 1 ||
    regionsRoute?.offset !== 2 ||
    regionsRoute?.limit !== 5
  ) {
    throw new Error(
      `Real Medusa store/regions route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        regionsRoute
      )}`
    )
  }

  const regionRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/regions/reg_worker_http_proof?fields=id,name,currency_code&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const regionRoute = await regionRouteResponse.json()
  if (
    !regionRouteResponse.ok ||
    regionRouteResponse.headers.get("x-medusa-publishable-key-proof") !==
      "pk_worker_http_proof" ||
    regionRouteResponse.headers.get("x-medusa-locale-proof") !== "en-US" ||
    regionRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    regionRoute?.region?.id !== "reg_worker_http_proof" ||
    regionRoute.region?.name !== "Worker Region" ||
    regionRoute.region?.currency_code !== "usd"
  ) {
    throw new Error(
      `Real Medusa store/regions/:id route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        regionRoute
      )}`
    )
  }

  const missingRegionRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/regions/reg_missing_worker_http_proof?fields=id,name,currency_code&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const missingRegionRoute = await missingRegionRouteResponse.json()
  if (
    missingRegionRouteResponse.status !== 404 ||
    missingRegionRoute?.type !== "not_found" ||
    missingRegionRoute?.message !==
      "Region with id: reg_missing_worker_http_proof was not found"
  ) {
    throw new Error(
      `Real Medusa store/regions/:id route did not return the expected not-found error through the Fetch adapter in workerd: ${JSON.stringify(
        missingRegionRoute
      )}`
    )
  }

  const paymentProvidersRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/payment-providers?fields=id,is_enabled&region_id=reg_worker_http_proof&limit=5&offset=1&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const paymentProvidersRoute = await paymentProvidersRouteResponse.json()
  if (
    !paymentProvidersRouteResponse.ok ||
    paymentProvidersRouteResponse.headers.get(
      "x-medusa-publishable-key-proof"
    ) !== "pk_worker_http_proof" ||
    paymentProvidersRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    paymentProvidersRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    !Array.isArray(paymentProvidersRoute?.payment_providers) ||
    paymentProvidersRoute.payment_providers.length !== 1 ||
    paymentProvidersRoute.payment_providers[0]?.id !== "pp_system_default" ||
    paymentProvidersRoute.payment_providers[0]?.is_enabled !== true ||
    paymentProvidersRoute?.count !== 1 ||
    paymentProvidersRoute?.offset !== 1 ||
    paymentProvidersRoute?.limit !== 5
  ) {
    throw new Error(
      `Real Medusa store/payment-providers route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        paymentProvidersRoute
      )}`
    )
  }

  const missingPaymentProvidersRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/payment-providers?fields=id,is_enabled&region_id=reg_missing_worker_http_proof&limit=5&offset=1&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const missingPaymentProvidersRoute =
    await missingPaymentProvidersRouteResponse.json()
  if (
    !missingPaymentProvidersRouteResponse.ok ||
    !Array.isArray(missingPaymentProvidersRoute?.payment_providers) ||
    missingPaymentProvidersRoute.payment_providers.length !== 0 ||
    missingPaymentProvidersRoute?.count !== 0 ||
    missingPaymentProvidersRoute?.offset !== 1 ||
    missingPaymentProvidersRoute?.limit !== 5
  ) {
    throw new Error(
      `Real Medusa store/payment-providers route did not return an empty list for an unmatched region in workerd: ${JSON.stringify(
        missingPaymentProvidersRoute
      )}`
    )
  }

  const updatedCartRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/carts/cart_worker_http_proof?fields=id,email,total,currency_code&locale=en-us`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-publishable-api-key": "pk_worker_http_proof",
      },
      body: JSON.stringify({
        email: "updated-worker-cart@example.com",
        metadata: {
          source: "worker-http-proof",
        },
      }),
    }
  )
  const updatedCartRoute = await updatedCartRouteResponse.json()
  if (
    !updatedCartRouteResponse.ok ||
    updatedCartRouteResponse.headers.get("x-medusa-publishable-key-proof") !==
      "pk_worker_http_proof" ||
    updatedCartRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    updatedCartRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    updatedCartRoute?.cart?.id !== "cart_worker_http_proof" ||
    updatedCartRoute.cart?.email !== "updated-worker-cart@example.com" ||
    updatedCartRoute.cart?.total !== 3210 ||
    updatedCartRoute.cart?.currency_code !== "usd" ||
    updatedCartRoute.cart?.filter?.id !== "cart_worker_http_proof"
  ) {
    throw new Error(
      `Real Medusa store/carts/:id mutation route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        updatedCartRoute
      )}`
    )
  }

  const addCartLineItemRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/carts/cart_worker_http_proof/line-items?fields=id,email,total,currency_code,items.id,items.variant_id,items.quantity&locale=en-us`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-publishable-api-key": "pk_worker_http_proof",
      },
      body: JSON.stringify({
        variant_id: "variant_worker_http_proof",
        quantity: 2,
        metadata: {
          source: "worker-http-proof",
        },
      }),
    }
  )
  const addCartLineItemRoute = await addCartLineItemRouteResponse.json()
  const addedCartLineItem = addCartLineItemRoute?.cart?.items?.[0]
  if (
    !addCartLineItemRouteResponse.ok ||
    addCartLineItemRouteResponse.headers.get(
      "x-medusa-publishable-key-proof"
    ) !== "pk_worker_http_proof" ||
    addCartLineItemRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    addCartLineItemRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    addCartLineItemRoute?.cart?.id !== "cart_worker_http_proof" ||
    addCartLineItemRoute.cart?.email !== "updated-worker-cart@example.com" ||
    addedCartLineItem?.id !== "line_item_worker_http_proof" ||
    addedCartLineItem?.variant_id !== "variant_worker_http_proof" ||
    addedCartLineItem?.quantity !== 2
  ) {
    throw new Error(
      `Real Medusa store/carts/:id/line-items route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        addCartLineItemRoute
      )}`
    )
  }

  const updateCartLineItemRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/carts/cart_worker_http_proof/line-items/line_item_worker_http_proof?fields=id,email,total,currency_code,items.id,items.variant_id,items.quantity&locale=en-us`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-publishable-api-key": "pk_worker_http_proof",
      },
      body: JSON.stringify({
        quantity: 4,
        metadata: {
          source: "worker-http-proof",
        },
      }),
    }
  )
  const updateCartLineItemRoute = await updateCartLineItemRouteResponse.json()
  const updatedCartLineItem = updateCartLineItemRoute?.cart?.items?.[0]
  if (
    !updateCartLineItemRouteResponse.ok ||
    updateCartLineItemRouteResponse.headers.get(
      "x-medusa-publishable-key-proof"
    ) !== "pk_worker_http_proof" ||
    updateCartLineItemRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    updateCartLineItemRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    updateCartLineItemRoute?.cart?.id !== "cart_worker_http_proof" ||
    updatedCartLineItem?.id !== "line_item_worker_http_proof" ||
    updatedCartLineItem?.variant_id !== "variant_worker_http_proof" ||
    updatedCartLineItem?.quantity !== 4
  ) {
    throw new Error(
      `Real Medusa store/carts/:id/line-items/:line_id update route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        updateCartLineItemRoute
      )}`
    )
  }

  const deleteCartLineItemRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/carts/cart_worker_http_proof/line-items/line_item_worker_http_proof?fields=id,email,total,currency_code,items.id,items.variant_id,items.quantity&locale=en-us`,
    {
      method: "DELETE",
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const deleteCartLineItemRoute = await deleteCartLineItemRouteResponse.json()
  if (
    !deleteCartLineItemRouteResponse.ok ||
    deleteCartLineItemRouteResponse.headers.get(
      "x-medusa-publishable-key-proof"
    ) !== "pk_worker_http_proof" ||
    deleteCartLineItemRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    deleteCartLineItemRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    deleteCartLineItemRoute?.id !== "line_item_worker_http_proof" ||
    deleteCartLineItemRoute?.object !== "line-item" ||
    deleteCartLineItemRoute?.deleted !== true ||
    deleteCartLineItemRoute?.parent?.id !== "cart_worker_http_proof" ||
    !Array.isArray(deleteCartLineItemRoute.parent?.items) ||
    deleteCartLineItemRoute.parent.items.length !== 0
  ) {
    throw new Error(
      `Real Medusa store/carts/:id/line-items/:line_id delete route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        deleteCartLineItemRoute
      )}`
    )
  }

  const addCartPromotionRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/carts/cart_worker_http_proof/promotions?fields=id,email,total,currency_code,promotions.id,promotions.code&locale=en-us`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-publishable-api-key": "pk_worker_http_proof",
      },
      body: JSON.stringify({
        promo_codes: ["PROMO_WORKER_HTTP_PROOF"],
      }),
    }
  )
  const addCartPromotionRoute = await addCartPromotionRouteResponse.json()
  const addedCartPromotion = addCartPromotionRoute?.cart?.promotions?.[0]
  if (
    !addCartPromotionRouteResponse.ok ||
    addCartPromotionRouteResponse.headers.get(
      "x-medusa-publishable-key-proof"
    ) !== "pk_worker_http_proof" ||
    addCartPromotionRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    addCartPromotionRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    addCartPromotionRoute?.cart?.id !== "cart_worker_http_proof" ||
    addedCartPromotion?.id !== "promo_promo_worker_http_proof" ||
    addedCartPromotion?.code !== "PROMO_WORKER_HTTP_PROOF"
  ) {
    throw new Error(
      `Real Medusa store/carts/:id/promotions route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        addCartPromotionRoute
      )}`
    )
  }

  const removeCartPromotionRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/carts/cart_worker_http_proof/promotions?fields=id,email,total,currency_code,promotions.id,promotions.code&locale=en-us`,
    {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-publishable-api-key": "pk_worker_http_proof",
      },
      body: JSON.stringify({
        promo_codes: ["PROMO_WORKER_HTTP_PROOF"],
      }),
    }
  )
  const removeCartPromotionRoute =
    await removeCartPromotionRouteResponse.json()
  if (
    !removeCartPromotionRouteResponse.ok ||
    removeCartPromotionRouteResponse.headers.get(
      "x-medusa-publishable-key-proof"
    ) !== "pk_worker_http_proof" ||
    removeCartPromotionRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    removeCartPromotionRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    removeCartPromotionRoute?.cart?.id !== "cart_worker_http_proof" ||
    !Array.isArray(removeCartPromotionRoute.cart?.promotions) ||
    removeCartPromotionRoute.cart.promotions.length !== 0
  ) {
    throw new Error(
      `Real Medusa store/carts/:id/promotions delete route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        removeCartPromotionRoute
      )}`
    )
  }

  const addCartShippingMethodRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/carts/cart_worker_http_proof/shipping-methods?fields=id,email,total,currency_code,shipping_methods.id,shipping_methods.shipping_option_id,shipping_methods.data&locale=en-us`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-publishable-api-key": "pk_worker_http_proof",
      },
      body: JSON.stringify({
        option_id: "so_worker_http_proof",
        data: {
          carrier: "worker-carrier",
        },
      }),
    }
  )
  const addCartShippingMethodRoute =
    await addCartShippingMethodRouteResponse.json()
  const addedCartShippingMethod =
    addCartShippingMethodRoute?.cart?.shipping_methods?.[0]
  if (
    !addCartShippingMethodRouteResponse.ok ||
    addCartShippingMethodRouteResponse.headers.get(
      "x-medusa-publishable-key-proof"
    ) !== "pk_worker_http_proof" ||
    addCartShippingMethodRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    addCartShippingMethodRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    addCartShippingMethodRoute?.cart?.id !== "cart_worker_http_proof" ||
    addedCartShippingMethod?.id !== "shipping_method_worker_http_proof" ||
    addedCartShippingMethod?.shipping_option_id !== "so_worker_http_proof" ||
    addedCartShippingMethod?.data?.carrier !== "worker-carrier"
  ) {
    throw new Error(
      `Real Medusa store/carts/:id/shipping-methods route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        addCartShippingMethodRoute
      )}`
    )
  }

  const calculateCartTaxesRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/carts/cart_worker_http_proof/taxes?fields=id,email,total,currency_code,tax_total&locale=en-us`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-publishable-api-key": "pk_worker_http_proof",
      },
      body: JSON.stringify({}),
    }
  )
  const calculateCartTaxesRoute = await calculateCartTaxesRouteResponse.json()
  if (
    !calculateCartTaxesRouteResponse.ok ||
    calculateCartTaxesRouteResponse.headers.get(
      "x-medusa-publishable-key-proof"
    ) !== "pk_worker_http_proof" ||
    calculateCartTaxesRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    calculateCartTaxesRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    calculateCartTaxesRoute?.cart?.id !== "cart_worker_http_proof" ||
    calculateCartTaxesRoute.cart?.tax_total !== 111
  ) {
    throw new Error(
      `Real Medusa store/carts/:id/taxes route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        calculateCartTaxesRoute
      )}`
    )
  }

  const transferCartCustomerRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/carts/cart_worker_http_proof/customer?fields=id,email,total,currency_code,customer_id&locale=en-us`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-medusa-customer-id-proof": "cus_worker_http_proof",
        "x-publishable-api-key": "pk_worker_http_proof",
      },
      body: JSON.stringify({}),
    }
  )
  const transferCartCustomerRoute =
    await transferCartCustomerRouteResponse.json()
  if (
    !transferCartCustomerRouteResponse.ok ||
    transferCartCustomerRouteResponse.headers.get(
      "x-medusa-publishable-key-proof"
    ) !== "pk_worker_http_proof" ||
    transferCartCustomerRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    transferCartCustomerRouteResponse.headers.get("x-medusa-auth-proof") !==
      "customer" ||
    transferCartCustomerRoute?.cart?.id !== "cart_worker_http_proof" ||
    transferCartCustomerRoute.cart?.customer_id !== "cus_worker_http_proof"
  ) {
    throw new Error(
      `Real Medusa store/carts/:id/customer route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        transferCartCustomerRoute
      )}`
    )
  }

  const completeCartRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/carts/cart_worker_http_proof/complete?fields=id,display_id,status,email,currency_code,cart_id&locale=en-us`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-publishable-api-key": "pk_worker_http_proof",
      },
      body: JSON.stringify({}),
    }
  )
  const completeCartRoute = await completeCartRouteResponse.json()
  if (
    !completeCartRouteResponse.ok ||
    completeCartRouteResponse.headers.get(
      "x-medusa-publishable-key-proof"
    ) !== "pk_worker_http_proof" ||
    completeCartRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    completeCartRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    completeCartRoute?.type !== "order" ||
    completeCartRoute.order?.id !== "order_worker_http_proof" ||
    completeCartRoute.order?.cart_id !== "cart_worker_http_proof"
  ) {
    throw new Error(
      `Real Medusa store/carts/:id/complete route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        completeCartRoute
      )}`
    )
  }

  const productsRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/products?fields=id,title,handle&limit=3&offset=0&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const productsRoute = await productsRouteResponse.json()
  if (
    !productsRouteResponse.ok ||
    productsRouteResponse.headers.get("x-medusa-publishable-key-proof") !==
      "pk_worker_http_proof" ||
    productsRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    productsRouteResponse.headers.get("x-medusa-locale-proof") !== "en-US" ||
    !Array.isArray(productsRoute?.products) ||
    productsRoute.products.length !== 1 ||
    productsRoute.products[0]?.id !== "prod_worker_http_proof" ||
    productsRoute.products[0]?.title !== "Worker Product" ||
    productsRoute?.count !== 1 ||
    productsRoute?.offset !== 0 ||
    productsRoute?.limit !== 3
  ) {
    throw new Error(
      `Real Medusa store/products route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        productsRoute
      )}`
    )
  }

  const productRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/products/prod_worker_http_proof?fields=id,title,handle&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const productRoute = await productRouteResponse.json()
  if (
    !productRouteResponse.ok ||
    productRouteResponse.headers.get("x-medusa-publishable-key-proof") !==
      "pk_worker_http_proof" ||
    productRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    productRouteResponse.headers.get("x-medusa-locale-proof") !== "en-US" ||
    productRoute?.product?.id !== "prod_worker_http_proof" ||
    productRoute.product?.title !== "Worker Product" ||
    productRoute.product?.handle !== "worker-product"
  ) {
    throw new Error(
      `Real Medusa store/products/:id route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        productRoute
      )}`
    )
  }

  const missingProductRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/products/prod_missing_worker_http_proof?fields=id,title,handle&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const missingProductRoute = await missingProductRouteResponse.json()
  if (
    missingProductRouteResponse.status !== 404 ||
    missingProductRoute?.type !== "not_found" ||
    missingProductRoute?.message !==
      "Product with id: prod_missing_worker_http_proof was not found"
  ) {
    throw new Error(
      `Real Medusa store/products/:id route did not return the expected not-found error through the Fetch adapter in workerd: ${JSON.stringify(
        missingProductRoute
      )}`
    )
  }

  const pricedProductsRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/products?fields=id,title,variants.calculated_price&region_id=reg_worker_http_proof&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const pricedProductsRoute = await pricedProductsRouteResponse.json()
  const pricingContext =
    pricedProductsRoute?.products?.[0]?.pricing_context
  if (
    !pricedProductsRouteResponse.ok ||
    pricedProductsRouteResponse.headers.get(
      "x-medusa-publishable-key-proof"
    ) !== "pk_worker_http_proof" ||
    !Array.isArray(pricedProductsRoute?.products) ||
    pricedProductsRoute.products.length !== 1 ||
    pricedProductsRoute.products[0]?.id !== "prod_worker_http_proof" ||
    pricingContext?.region_id !== "reg_worker_http_proof" ||
    pricingContext?.currency_code !== "usd" ||
    pricingContext?.__type !== "QueryContext" ||
    pricedProductsRoute.products[0]?.fields?.includes(
      "variants.calculated_price"
    ) !== false ||
    pricedProductsRoute.products[0]?.fields?.includes(
      "variants.calculated_price.*"
    ) !== true
  ) {
    throw new Error(
      `Real Medusa store/products route did not populate pricing context through the Fetch adapter in workerd: ${JSON.stringify(
        pricedProductsRoute
      )}`
    )
  }

  const taxedProductsRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/products?fields=id,title,variants.calculated_price&region_id=reg_worker_http_proof&country_code=us&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const taxedProductsRoute = await taxedProductsRouteResponse.json()
  const taxedProductVariant =
    taxedProductsRoute?.products?.[0]?.variants?.[0]
  const taxedProductPrice = taxedProductVariant?.calculated_price
  if (
    !taxedProductsRouteResponse.ok ||
    taxedProductsRouteResponse.headers.get(
      "x-medusa-publishable-key-proof"
    ) !== "pk_worker_http_proof" ||
    taxedProductsRoute?.products?.[0]?.id !== "prod_worker_http_proof" ||
    taxedProductVariant?.id !== "variant_worker_http_proof" ||
    taxedProductPrice?.calculated_amount !== 100 ||
    taxedProductPrice?.calculated_amount_with_tax !== 110 ||
    taxedProductPrice?.calculated_amount_without_tax !== 100 ||
    taxedProductPrice?.original_amount !== 120 ||
    taxedProductPrice?.original_amount_with_tax !== 132 ||
    taxedProductPrice?.original_amount_without_tax !== 120
  ) {
    throw new Error(
      `Real Medusa store/products route did not apply tax context to calculated prices through the Fetch adapter in workerd: ${JSON.stringify(
        taxedProductsRoute
      )}`
    )
  }

  const inventoryProductsRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/products?fields=id,title,variants,variants.inventory_quantity&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const inventoryProductsRoute =
    await inventoryProductsRouteResponse.json()
  const inventoryProductVariant =
    inventoryProductsRoute?.products?.[0]?.variants?.[0]
  if (
    !inventoryProductsRouteResponse.ok ||
    inventoryProductsRouteResponse.headers.get(
      "x-medusa-publishable-key-proof"
    ) !== "pk_worker_http_proof" ||
    inventoryProductsRoute?.products?.[0]?.id !== "prod_worker_http_proof" ||
    inventoryProductVariant?.id !== "variant_worker_http_proof" ||
    inventoryProductVariant?.inventory_quantity !== 7 ||
    inventoryProductsRoute.products[0]?.fields?.includes(
      "variants.inventory_quantity"
    ) !== false
  ) {
    throw new Error(
      `Real Medusa store/products route did not compute inventory quantity through the Fetch adapter in workerd: ${JSON.stringify(
        inventoryProductsRoute
      )}`
    )
  }

  const productVariantsRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/product-variants?fields=id,title,sku&limit=2&offset=1&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const productVariantsRoute = await productVariantsRouteResponse.json()
  if (
    !productVariantsRouteResponse.ok ||
    productVariantsRouteResponse.headers.get(
      "x-medusa-publishable-key-proof"
    ) !== "pk_worker_http_proof" ||
    productVariantsRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    productVariantsRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    !Array.isArray(productVariantsRoute?.variants) ||
    productVariantsRoute.variants.length !== 1 ||
    productVariantsRoute.variants[0]?.id !== "variant_worker_http_proof" ||
    productVariantsRoute.variants[0]?.title !== "Worker Product Variant" ||
    productVariantsRoute.variants[0]?.sku !== "worker-variant" ||
    productVariantsRoute?.count !== 1 ||
    productVariantsRoute?.offset !== 1 ||
    productVariantsRoute?.limit !== 2
  ) {
    throw new Error(
      `Real Medusa store/product-variants route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        productVariantsRoute
      )}`
    )
  }

  const productVariantRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/product-variants/variant_worker_http_proof?fields=id,title,sku,inventory_quantity&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const productVariantRoute = await productVariantRouteResponse.json()
  if (
    !productVariantRouteResponse.ok ||
    productVariantRouteResponse.headers.get(
      "x-medusa-publishable-key-proof"
    ) !== "pk_worker_http_proof" ||
    productVariantRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    productVariantRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    productVariantRoute?.variant?.id !== "variant_worker_http_proof" ||
    productVariantRoute.variant?.title !== "Worker Product Variant" ||
    productVariantRoute.variant?.sku !== "worker-variant" ||
    productVariantRoute.variant?.inventory_quantity !== 7 ||
    productVariantRoute.variant?.fields?.includes("inventory_quantity") !==
      false
  ) {
    throw new Error(
      `Real Medusa store/product-variants/:id route did not compute inventory quantity through the Fetch adapter in workerd: ${JSON.stringify(
        productVariantRoute
      )}`
    )
  }

  const missingProductVariantRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/product-variants/variant_missing_worker_http_proof?fields=id,title,sku&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const missingProductVariantRoute =
    await missingProductVariantRouteResponse.json()
  if (
    missingProductVariantRouteResponse.status !== 404 ||
    missingProductVariantRoute?.type !== "not_found" ||
    missingProductVariantRoute?.message !==
      "Product variant with id: variant_missing_worker_http_proof was not found"
  ) {
    throw new Error(
      `Real Medusa store/product-variants/:id route did not return the expected not-found error through the Fetch adapter in workerd: ${JSON.stringify(
        missingProductVariantRoute
      )}`
    )
  }

  const collectionsRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/collections?fields=id,title,handle&q=worker&limit=3&offset=1&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const collectionsRoute = await collectionsRouteResponse.json()
  if (
    !collectionsRouteResponse.ok ||
    collectionsRouteResponse.headers.get("x-medusa-publishable-key-proof") !==
      "pk_worker_http_proof" ||
    collectionsRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    collectionsRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    !Array.isArray(collectionsRoute?.collections) ||
    collectionsRoute.collections.length !== 1 ||
    collectionsRoute.collections[0]?.id !== "pcol_worker_http_proof_1" ||
    collectionsRoute.collections[0]?.title !== "Worker Collection" ||
    collectionsRoute.collections[0]?.handle !== "worker-collection" ||
    collectionsRoute?.count !== 1 ||
    collectionsRoute?.offset !== 1 ||
    collectionsRoute?.limit !== 3
  ) {
    throw new Error(
      `Real Medusa store/collections route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        collectionsRoute
      )}`
    )
  }

  const collectionRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/collections/pcol_worker_http_proof_1?fields=id,title,handle&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const collectionRoute = await collectionRouteResponse.json()
  if (
    !collectionRouteResponse.ok ||
    collectionRouteResponse.headers.get("x-medusa-publishable-key-proof") !==
      "pk_worker_http_proof" ||
    collectionRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    collectionRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    collectionRoute?.collection?.id !== "pcol_worker_http_proof_1" ||
    collectionRoute.collection?.title !== "Worker Collection" ||
    collectionRoute.collection?.handle !== "worker-collection"
  ) {
    throw new Error(
      `Real Medusa store/collections/:id route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        collectionRoute
      )}`
    )
  }

  const missingCollectionRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/collections/pcol_missing_worker_http_proof?fields=id,title,handle&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const missingCollectionRoute = await missingCollectionRouteResponse.json()
  if (
    missingCollectionRouteResponse.status !== 404 ||
    missingCollectionRoute?.type !== "not_found" ||
    missingCollectionRoute?.message !==
      "Collection with id: pcol_missing_worker_http_proof was not found"
  ) {
    throw new Error(
      `Real Medusa store/collections/:id route did not return the expected not-found error through the Fetch adapter in workerd: ${JSON.stringify(
        missingCollectionRoute
      )}`
    )
  }

  const productTagsRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/product-tags?fields=id,value&q=worker&limit=4&offset=2&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const productTagsRoute = await productTagsRouteResponse.json()
  if (
    !productTagsRouteResponse.ok ||
    productTagsRouteResponse.headers.get("x-medusa-publishable-key-proof") !==
      "pk_worker_http_proof" ||
    productTagsRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    productTagsRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    !Array.isArray(productTagsRoute?.product_tags) ||
    productTagsRoute.product_tags.length !== 1 ||
    productTagsRoute.product_tags[0]?.id !== "ptag_worker_http_proof_1" ||
    productTagsRoute.product_tags[0]?.value !== "worker-tag" ||
    productTagsRoute?.count !== 1 ||
    productTagsRoute?.offset !== 2 ||
    productTagsRoute?.limit !== 4
  ) {
    throw new Error(
      `Real Medusa store/product-tags route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        productTagsRoute
      )}`
    )
  }

  const productTagRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/product-tags/ptag_worker_http_proof_1?fields=id,value&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const productTagRoute = await productTagRouteResponse.json()
  if (
    !productTagRouteResponse.ok ||
    productTagRouteResponse.headers.get("x-medusa-publishable-key-proof") !==
      "pk_worker_http_proof" ||
    productTagRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    productTagRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    productTagRoute?.product_tag?.id !== "ptag_worker_http_proof_1" ||
    productTagRoute.product_tag?.value !== "worker-tag"
  ) {
    throw new Error(
      `Real Medusa store/product-tags/:id route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        productTagRoute
      )}`
    )
  }

  const missingProductTagRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/product-tags/ptag_missing_worker_http_proof?fields=id,value&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const missingProductTagRoute = await missingProductTagRouteResponse.json()
  if (
    missingProductTagRouteResponse.status !== 404 ||
    missingProductTagRoute?.type !== "not_found" ||
    missingProductTagRoute?.message !==
      "Product tag with id: ptag_missing_worker_http_proof was not found"
  ) {
    throw new Error(
      `Real Medusa store/product-tags/:id route did not return the expected not-found error through the Fetch adapter in workerd: ${JSON.stringify(
        missingProductTagRoute
      )}`
    )
  }

  const productTypesRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/product-types?fields=id,value&q=worker&limit=6&offset=3&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const productTypesRoute = await productTypesRouteResponse.json()
  if (
    !productTypesRouteResponse.ok ||
    productTypesRouteResponse.headers.get("x-medusa-publishable-key-proof") !==
      "pk_worker_http_proof" ||
    productTypesRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    productTypesRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    !Array.isArray(productTypesRoute?.product_types) ||
    productTypesRoute.product_types.length !== 1 ||
    productTypesRoute.product_types[0]?.id !==
      "ptyp_000000000000000000000001" ||
    productTypesRoute.product_types[0]?.value !== "worker-type" ||
    productTypesRoute?.count !== 1 ||
    productTypesRoute?.offset !== 3 ||
    productTypesRoute?.limit !== 6
  ) {
    throw new Error(
      `Real Medusa store/product-types route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        productTypesRoute
      )}`
    )
  }

  const productTypeRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/product-types/ptyp_000000000000000000000001?fields=id,value&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const productTypeRoute = await productTypeRouteResponse.json()
  if (
    !productTypeRouteResponse.ok ||
    productTypeRouteResponse.headers.get("x-medusa-publishable-key-proof") !==
      "pk_worker_http_proof" ||
    productTypeRouteResponse.headers.get("x-medusa-auth-proof") !==
      "unauthenticated" ||
    productTypeRouteResponse.headers.get("x-medusa-locale-proof") !==
      "en-US" ||
    productTypeRoute?.product_type?.id !==
      "ptyp_000000000000000000000001" ||
    productTypeRoute.product_type?.value !== "worker-type"
  ) {
    throw new Error(
      `Real Medusa store/product-types/:id route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        productTypeRoute
      )}`
    )
  }

  const missingProductTypeRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/product-types/ptyp_missing_worker_http_proof?fields=id,value&locale=en-us`,
    {
      headers: {
        "x-publishable-api-key": "pk_worker_http_proof",
      },
    }
  )
  const missingProductTypeRoute = await missingProductTypeRouteResponse.json()
  if (
    missingProductTypeRouteResponse.status !== 404 ||
    missingProductTypeRoute?.type !== "not_found" ||
    missingProductTypeRoute?.message !==
      "Product type with id: ptyp_missing_worker_http_proof was not found"
  ) {
    throw new Error(
      `Real Medusa store/product-types/:id route did not return the expected not-found error through the Fetch adapter in workerd: ${JSON.stringify(
        missingProductTypeRoute
      )}`
    )
  }

  const aggregate = `cart_worker_partition_${Date.now()}`
  const base = `http://127.0.0.1:${port}/do-cart/${aggregate}`

  const scenarioResponse = await fetch(`${base}/scenario`, {
    method: "POST",
  })
  const scenario = await scenarioResponse.json()
  if (
    !scenarioResponse.ok ||
    scenario?.transactionMode !== "atomic" ||
    typeof scenario?.apiKeyId !== "string" ||
    !scenario.apiKeyId.startsWith("apk_") ||
    scenario?.apiKeyCount !== 1 ||
    scenario?.apiKeyTokenPrefix !== "pk_" ||
    typeof scenario?.userId !== "string" ||
    !scenario.userId.startsWith("user_") ||
    scenario?.userCount !== 1 ||
    scenario?.analyticsTrackCount !== 1 ||
    scenario?.analyticsIdentifyCount !== 1 ||
    scenario?.analyticsTrackedEvent !== "worker-cart-proof" ||
    scenario?.analyticsIdentifiedActor !== scenario.userId ||
    scenario?.workflowEngineProvider !== "inmemory" ||
    scenario?.workflowId !== "worker-workflow-proof" ||
    scenario?.workflowTransactionFinished !== true ||
    scenario?.workflowExecutionCount !== 1 ||
    scenario?.workflowExecutionPersisted !== true ||
    scenario?.workflowExecutionStoreState !== "done" ||
    typeof scenario?.cachingKeyLength !== "number" ||
    scenario.cachingKeyLength < 1 ||
    scenario?.cachingValue !== "worker-cache-value" ||
    scenario?.cachingTagResultCount !== 1 ||
    scenario?.cachingCleared !== true ||
    typeof scenario?.authIdentityId !== "string" ||
    !scenario.authIdentityId.startsWith("authid_") ||
    scenario?.authIdentityCount !== 1 ||
    scenario?.authProviderIdentityCount !== 1 ||
    scenario?.authProvider !== "manual" ||
    typeof scenario?.rbacRoleId !== "string" ||
    !scenario.rbacRoleId.startsWith("role_") ||
    typeof scenario?.rbacPolicyId !== "string" ||
    !scenario.rbacPolicyId.startsWith("rpol_") ||
    scenario?.rbacRolePolicyCount !== 1 ||
    scenario?.rbacRoleRelationPolicyCount !== 1 ||
    scenario?.rbacPolicyKey !== "worker:read" ||
    typeof scenario?.settingsViewId !== "string" ||
    !scenario.settingsViewId.startsWith("vconf_") ||
    scenario?.settingsFilterCount !== 0 ||
    scenario?.settingsSortingIsNull !== true ||
    scenario?.settingsActiveViewId !== scenario.settingsViewId ||
    scenario?.fileId !== "worker-file.txt" ||
    scenario?.fileUrl !== "worker-file.txt" ||
    scenario?.retrievedFileUrl !== "worker-file-content" ||
    scenario?.listedFileCount !== 1 ||
    scenario?.listedFileUrl !== "worker-file-content" ||
    scenario?.uploadFileKey !== "worker-upload.txt" ||
    scenario?.uploadFileUrl !== "memory-upload://worker-upload.txt" ||
    typeof scenario?.notificationId !== "string" ||
    !scenario.notificationId.startsWith("noti_") ||
    scenario?.notificationProviderId !== "worker-email" ||
    scenario?.notificationExternalId !== "worker-memory-1" ||
    scenario?.notificationStatus !== "success" ||
    scenario?.retrievedNotificationStatus !== "success" ||
    typeof scenario?.inviteId !== "string" ||
    !scenario.inviteId.startsWith("invite_") ||
    scenario?.inviteEmail !== "worker-invite@example.com" ||
    scenario?.inviteTokenPartCount !== 3 ||
    typeof scenario?.storeId !== "string" ||
    !scenario.storeId.startsWith("store_") ||
    scenario?.storeCount !== 1 ||
    scenario?.storeCurrencyCount !== 2 ||
    scenario?.storeLocaleCount !== 1 ||
    typeof scenario?.regionId !== "string" ||
    !scenario.regionId.startsWith("reg_") ||
    scenario?.regionCount !== 1 ||
    scenario?.regionCountryCount !== 1 ||
    typeof scenario?.customerId !== "string" ||
    !scenario.customerId.startsWith("cus_") ||
    typeof scenario?.customerGroupId !== "string" ||
    !scenario.customerGroupId.startsWith("cusgroup_") ||
    scenario?.customerGroupFilterCount !== 1 ||
    scenario?.customerAddressCount !== 1 ||
    scenario?.customerGroupCount !== 1 ||
    typeof scenario?.productId !== "string" ||
    !scenario.productId.startsWith("prod_") ||
    scenario?.productCount !== 1 ||
    typeof scenario?.productTypeId !== "string" ||
    !scenario.productTypeId.startsWith("ptyp_") ||
    scenario?.productTypeCount !== 1 ||
    scenario?.eventBusProvider !== "cloudflare-queue" ||
    scenario?.productCacheInvalidatedByEvent !== false ||
    scenario?.lockingProvider !== "cloudflare-durable-object" ||
    scenario?.lockingSuccessfulSales !== 3 ||
    scenario?.lockingRemainingStock !== 0 ||
    scenario?.translationLocaleCount !== 1 ||
    typeof scenario?.translationId !== "string" ||
    !scenario.translationId.startsWith("trans_") ||
    scenario?.translationSearchCount !== 1 ||
    scenario?.translationListCount !== 1 ||
    scenario?.translationCount !== 1 ||
    scenario?.translationTitle !== "Worker Translated Product" ||
    scenario?.translationIgnoredFieldVisible !== false ||
    scenario?.translationStatisticsTranslated !== 1 ||
    scenario?.translationStatisticsExpected <
      scenario?.translationStatisticsTranslated ||
    scenario?.translationProductFieldCount < 1 ||
    typeof scenario?.priceSetId !== "string" ||
    !scenario.priceSetId.startsWith("pset_") ||
    scenario?.calculatedPriceAmount !== 123 ||
    typeof scenario?.taxRegionId !== "string" ||
    !scenario.taxRegionId.startsWith("txreg_") ||
    scenario?.taxRegionCount !== 1 ||
    scenario?.taxRateCount !== 1 ||
    typeof scenario?.fulfillmentProviderId !== "string" ||
    scenario.fulfillmentProviderId !== "fp_do_sqlite" ||
    typeof scenario?.fulfillmentSetId !== "string" ||
    !scenario.fulfillmentSetId.startsWith("fuset_") ||
    scenario?.fulfillmentSetCount !== 1 ||
    scenario?.fulfillmentServiceZoneCount !== 1 ||
    scenario?.fulfillmentGeoZoneCount !== 1 ||
    typeof scenario?.shippingProfileId !== "string" ||
    !scenario.shippingProfileId.startsWith("sp_") ||
    typeof scenario?.shippingOptionId !== "string" ||
    !scenario.shippingOptionId.startsWith("so_") ||
    scenario?.shippingOptionCount !== 1 ||
    typeof scenario?.orderId !== "string" ||
    !scenario.orderId.startsWith("order_") ||
    scenario?.orderDisplayId !== 1 ||
    scenario?.orderItemCount !== 1 ||
    scenario?.orderShippingMethodCount !== 1 ||
    scenario?.orderTransactionCount !== 1 ||
    scenario?.orderHasBillingAddress !== true ||
    scenario?.orderHasShippingAddress !== true ||
    typeof scenario?.promotionId !== "string" ||
    !scenario.promotionId.startsWith("promo_") ||
    scenario?.promotionCount !== 1 ||
    scenario?.promotionApplicationMethodValue !== 10 ||
    typeof scenario?.salesChannelId !== "string" ||
    !scenario.salesChannelId.startsWith("sc_") ||
    scenario?.salesChannelCount !== 1 ||
    typeof scenario?.stockLocationId !== "string" ||
    !scenario.stockLocationId.startsWith("sloc_") ||
    scenario?.stockLocationCount !== 1 ||
    scenario?.stockLocationAddressCount !== 1 ||
    typeof scenario?.inventoryItemId !== "string" ||
    !scenario.inventoryItemId.startsWith("iitem_") ||
    scenario?.inventoryItemCount !== 1 ||
    typeof scenario?.inventoryLevelId !== "string" ||
    !scenario.inventoryLevelId.startsWith("ilev_") ||
    scenario?.inventoryLevelCount !== 1 ||
    scenario?.inventoryStockedQuantity !== 5 ||
    scenario?.inventoryReservedQuantity !== 0 ||
    scenario?.itemCount !== 1 ||
    scenario?.shippingMethodCount !== 1 ||
    scenario?.lineItemAdjustmentCount !== 1 ||
    scenario?.lineItemTaxLineCount !== 1 ||
    scenario?.shippingMethodAdjustmentCount !== 1 ||
    scenario?.shippingMethodTaxLineCount !== 1 ||
    scenario?.total !== 319 ||
    scenario?.rawTotal !== "319"
  ) {
    throw new Error(
      `Cart DO SQLite scenario did not return expected adjustments, tax lines, and totals: ${JSON.stringify(
        scenario
      )}`
    )
  }

  const headerlessCartRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/carts/${aggregate}?fields=id,currency_code`
  )
  const headerlessCartRoute = await headerlessCartRouteResponse.json()
  if (
    !headerlessCartRouteResponse.ok ||
    headerlessCartRouteResponse.headers.get("x-medusa-http-proof") !== null ||
    headerlessCartRouteResponse.headers.get("x-medusa-partition-name") !==
      `partition:local:local:development:dev:cart:${aggregate}` ||
    headerlessCartRoute?.cart?.id !== aggregate ||
    headerlessCartRoute.cart?.currency_code !== "eur"
  ) {
    throw new Error(
      `Real Medusa store/carts/:id route did not derive the Cart DO partition and execute through the production Fetch adapter in workerd: ${JSON.stringify(
        headerlessCartRoute
      )}`
    )
  }

  const capabilitiesResponse = await fetch(`${base}/capabilities`)
  const capabilities = await capabilitiesResponse.json()
  if (
    !capabilitiesResponse.ok ||
    capabilities?.transactionMode !== "atomic"
  ) {
    throw new Error("Cart DO SQLite manager did not expose atomic semantics")
  }

  const httpProductionOptionsResponse = await fetch(
    `${base}/http-production-options-proof`,
    { method: "POST" }
  )
  const httpProductionOptions = await httpProductionOptionsResponse.json()
  if (
    !httpProductionOptionsResponse.ok ||
    httpProductionOptions?.transactionMode !== "atomic" ||
    httpProductionOptions?.adminPluginsHandled !== true ||
    httpProductionOptions?.requestScopeCreated !== true ||
    httpProductionOptions?.cartServiceResolved !== true ||
    httpProductionOptions?.sessionCreateStatus !== 201 ||
    httpProductionOptions?.sessionCookieIssued !== true ||
    httpProductionOptions?.sessionReadStatus !== 200 ||
    httpProductionOptions?.sessionActorId !==
      "user_http_production_session" ||
    httpProductionOptions?.sessionDestroyStatus !== 200 ||
    httpProductionOptions?.sessionDestroyCookieIssued !== true ||
    httpProductionOptions?.sessionStoreCountAfterDestroy !== 0 ||
    httpProductionOptions?.remoteQueryCurrencyStatus !== 200 ||
    httpProductionOptions?.remoteQueryCurrencyCode !== "usd" ||
    httpProductionOptions?.remoteQueryCurrencyCount !== 1 ||
    httpProductionOptions?.remoteQueryCurrencyOffset !== 0 ||
    httpProductionOptions?.remoteQueryCurrencyLimit !== 5 ||
    httpProductionOptions?.queryGraphProductTypeStatus !== 200 ||
    httpProductionOptions?.queryGraphProductTypeValue !== "do-sqlite-type" ||
    httpProductionOptions?.queryGraphProductTypeCount !== 1 ||
    httpProductionOptions?.queryGraphProductTypeOffset !== 0 ||
    httpProductionOptions?.queryGraphProductTypeLimit !== 5 ||
    httpProductionOptions?.queryGraphProductTagStatus !== 200 ||
    httpProductionOptions?.queryGraphProductTagValue !== "do-sqlite-tag" ||
    httpProductionOptions?.queryGraphProductTagCount !== 1 ||
    httpProductionOptions?.queryGraphProductTagOffset !== 0 ||
    httpProductionOptions?.queryGraphProductTagLimit !== 5 ||
    httpProductionOptions?.queryGraphCollectionStatus !== 200 ||
    typeof httpProductionOptions?.queryGraphCollectionId !== "string" ||
    httpProductionOptions.queryGraphCollectionId.length === 0 ||
    typeof httpProductionOptions?.queryGraphCollectionProductId !== "string" ||
    httpProductionOptions.queryGraphCollectionProductId.length === 0 ||
    httpProductionOptions?.queryGraphCollectionProductTitle !==
      "HTTP Production Relation Product"
  ) {
    throw new Error(
      `Production HTTP runtime source did not compose against the Cart DO runtime, durable session store, Remote Query route, Query.graph route, and relation traversal: ${JSON.stringify(
        httpProductionOptions
      )}`
    )
  }

  const partitionHttpResponse = await fetch(
    `http://127.0.0.1:${port}/medusa-http-runtime/partitions/${encodeURIComponent(
      aggregate
    )}/store/currencies?fields=code,symbol,name&code=usd&limit=5&offset=0`
  )
  const partitionHttp = await partitionHttpResponse.json()
  if (
    !partitionHttpResponse.ok ||
    partitionHttpResponse.headers.get("x-medusa-partition-name") !==
      `partition:local:local:development:dev:cart:${aggregate}` ||
    !Array.isArray(partitionHttp?.currencies) ||
    partitionHttp.currencies.length !== 1 ||
    partitionHttp.currencies[0]?.code !== "usd" ||
    partitionHttp.currencies[0]?.symbol !== "$" ||
    partitionHttp.currencies[0]?.name !== "US Dollar" ||
    partitionHttp?.count !== 1 ||
    partitionHttp?.offset !== 0 ||
    partitionHttp?.limit !== 5
  ) {
    throw new Error(
      `Top-level production HTTP partition route did not delegate to the Cart DO module runtime: ${JSON.stringify(
        partitionHttp
      )}`
    )
  }

  const defaultPartitionHttpResponse = await fetch(
    `http://127.0.0.1:${port}/store/currencies?fields=code,symbol,name&code=usd&limit=5&offset=0`,
    {
      headers: {
        "x-medusa-partition-key": aggregate,
      },
    }
  )
  const defaultPartitionHttp = await defaultPartitionHttpResponse.json()
  if (
    !defaultPartitionHttpResponse.ok ||
    defaultPartitionHttpResponse.headers.get("x-medusa-partition-name") !==
      `partition:local:local:development:dev:cart:${aggregate}` ||
    !Array.isArray(defaultPartitionHttp?.currencies) ||
    defaultPartitionHttp.currencies.length !== 1 ||
    defaultPartitionHttp.currencies[0]?.code !== "usd" ||
    defaultPartitionHttp.currencies[0]?.symbol !== "$" ||
    defaultPartitionHttp.currencies[0]?.name !== "US Dollar" ||
    defaultPartitionHttp?.count !== 1 ||
    defaultPartitionHttp?.offset !== 0 ||
    defaultPartitionHttp?.limit !== 5
  ) {
    throw new Error(
      `Default store/currencies route did not opt into the Cart DO production module runtime with a partition header: ${JSON.stringify(
        defaultPartitionHttp
      )}`
    )
  }

  const defaultSessionPartitionHttpResponse = await fetch(
    `http://127.0.0.1:${port}/auth/session`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${await createStaticAuthContextToken({
          actorId: "user_worker_http_proof",
          actorType: "user",
          authIdentityId: "auth_user_worker_http_proof",
        })}`,
        "x-medusa-partition-key": aggregate,
      },
    }
  )
  const defaultSessionPartitionHttp =
    await defaultSessionPartitionHttpResponse.json()
  const defaultSessionPartitionCookie =
    defaultSessionPartitionHttpResponse.headers.get("set-cookie")
  if (
    !defaultSessionPartitionHttpResponse.ok ||
    defaultSessionPartitionHttpResponse.headers.get(
      "x-medusa-partition-name"
    ) !== `partition:local:local:development:dev:cart:${aggregate}` ||
    defaultSessionPartitionHttp?.user?.actor_id !== "user_worker_http_proof" ||
    !defaultSessionPartitionCookie?.startsWith("connect.sid=do_session_")
  ) {
    throw new Error(
      `Default auth/session route did not opt into the Cart DO production module runtime with a partition header and durable session store: ${JSON.stringify(
        { defaultSessionPartitionHttp, defaultSessionPartitionCookie }
      )}`
    )
  }

  const defaultSessionDestroyPartitionHttpResponse = await fetch(
    `http://127.0.0.1:${port}/auth/session`,
    {
      method: "DELETE",
      headers: {
        cookie: defaultSessionPartitionCookie ?? "",
        "x-medusa-partition-key": aggregate,
      },
    }
  )
  const defaultSessionDestroyPartitionHttp =
    await defaultSessionDestroyPartitionHttpResponse.json()
  if (
    !defaultSessionDestroyPartitionHttpResponse.ok ||
    defaultSessionDestroyPartitionHttpResponse.headers.get(
      "x-medusa-partition-name"
    ) !== `partition:local:local:development:dev:cart:${aggregate}` ||
    defaultSessionDestroyPartitionHttpResponse.headers.get("set-cookie") !==
      "connect.sid=; Path=/; HttpOnly; Max-Age=0" ||
    defaultSessionDestroyPartitionHttp?.success !== true
  ) {
    throw new Error(
      `Default auth/session DELETE route did not clear the Cart DO production durable session with a partition header: ${JSON.stringify(
        defaultSessionDestroyPartitionHttp
      )}`
    )
  }

  const defaultProductTypesPartitionHttpResponse = await fetch(
    `http://127.0.0.1:${port}/store/product-types?fields=id,value&value=do-sqlite-type&limit=5&offset=0`,
    {
      headers: {
        "x-medusa-partition-key": aggregate,
      },
    }
  )
  const defaultProductTypesPartitionHttp =
    await defaultProductTypesPartitionHttpResponse.json()
  if (
    !defaultProductTypesPartitionHttpResponse.ok ||
    defaultProductTypesPartitionHttpResponse.headers.get(
      "x-medusa-partition-name"
    ) !== `partition:local:local:development:dev:cart:${aggregate}` ||
    !Array.isArray(defaultProductTypesPartitionHttp?.product_types) ||
    defaultProductTypesPartitionHttp.product_types.length !== 1 ||
    defaultProductTypesPartitionHttp.product_types[0]?.value !==
      "do-sqlite-type" ||
    defaultProductTypesPartitionHttp?.count !== 1 ||
    defaultProductTypesPartitionHttp?.offset !== 0 ||
    defaultProductTypesPartitionHttp?.limit !== 5
  ) {
    throw new Error(
      `Default store/product-types route did not opt into the Cart DO production module runtime with a partition header: ${JSON.stringify(
        defaultProductTypesPartitionHttp
      )}`
    )
  }

  const defaultProductTagsPartitionHttpResponse = await fetch(
    `http://127.0.0.1:${port}/store/product-tags?fields=id,value&value=do-sqlite-tag&limit=5&offset=0`,
    {
      headers: {
        "x-medusa-partition-key": aggregate,
      },
    }
  )
  const defaultProductTagsPartitionHttp =
    await defaultProductTagsPartitionHttpResponse.json()
  if (
    !defaultProductTagsPartitionHttpResponse.ok ||
    defaultProductTagsPartitionHttpResponse.headers.get(
      "x-medusa-partition-name"
    ) !== `partition:local:local:development:dev:cart:${aggregate}` ||
    !Array.isArray(defaultProductTagsPartitionHttp?.product_tags) ||
    defaultProductTagsPartitionHttp.product_tags.length !== 1 ||
    defaultProductTagsPartitionHttp.product_tags[0]?.value !==
      "do-sqlite-tag" ||
    defaultProductTagsPartitionHttp?.count !== 1 ||
    defaultProductTagsPartitionHttp?.offset !== 0 ||
    defaultProductTagsPartitionHttp?.limit !== 5
  ) {
    throw new Error(
      `Default store/product-tags route did not opt into the Cart DO production module runtime with a partition header: ${JSON.stringify(
        defaultProductTagsPartitionHttp
      )}`
    )
  }

  const collectionId = httpProductionOptions.queryGraphCollectionId
  const defaultCollectionPartitionHttpResponse = await fetch(
    `http://127.0.0.1:${port}/store/collections/${encodeURIComponent(
      collectionId
    )}?fields=id,title,products.id,products.title`,
    {
      headers: {
        "x-medusa-partition-key": aggregate,
      },
    }
  )
  const defaultCollectionPartitionHttp =
    await defaultCollectionPartitionHttpResponse.json()
  const firstDefaultCollectionProduct =
    defaultCollectionPartitionHttp?.collection?.products?.[0]
  if (
    !defaultCollectionPartitionHttpResponse.ok ||
    defaultCollectionPartitionHttpResponse.headers.get(
      "x-medusa-partition-name"
    ) !== `partition:local:local:development:dev:cart:${aggregate}` ||
    defaultCollectionPartitionHttp?.collection?.id !== collectionId ||
    firstDefaultCollectionProduct?.id !==
      httpProductionOptions.queryGraphCollectionProductId ||
    firstDefaultCollectionProduct?.title !== "HTTP Production Relation Product"
  ) {
    throw new Error(
      `Default store/collections/:id route did not opt into the Cart DO production module runtime with a partition header: ${JSON.stringify(
        defaultCollectionPartitionHttp
      )}`
    )
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
      "Cart DO SQLite manager did not provide read-your-own-writes and atomic rollback"
    )
  }

  const scheduleStoreResponse = await fetch(`${base}/schedule-store-proof`, {
    method: "POST",
  })
  const scheduleStore = await scheduleStoreResponse.json()
  if (
    !scheduleStoreResponse.ok ||
    typeof scheduleStore?.jobId !== "string" ||
    scheduleStore?.scheduledWorkflowName !== scheduleStore.jobId ||
    scheduleStore?.persistedBeforeRemove !== true ||
    scheduleStore?.runtimeBeforeRemove !== true ||
    scheduleStore?.expressionType !== "interval" ||
    Number(scheduleStore?.interval) !== 60_000 ||
    scheduleStore?.numberOfExecutions !== 0 ||
    scheduleStore?.configNumberOfExecutions !== 1 ||
    scheduleStore?.persistedAfterRemove !== false ||
    scheduleStore?.runtimeAfterRemove !== false
  ) {
    throw new Error(
      `Workflow schedule store did not persist and clean up an interval schedule through the DO SQLite store: ${JSON.stringify(
        scheduleStore
      )}`
    )
  }

  const scheduleAlarmResponse = await fetch(`${base}/schedule-alarm-proof`, {
    method: "POST",
  })
  const scheduleAlarm = await scheduleAlarmResponse.json()
  if (
    !scheduleAlarmResponse.ok ||
    typeof scheduleAlarm?.jobId !== "string" ||
    scheduleAlarm?.scheduledWorkflowName !== scheduleAlarm.jobId ||
    scheduleAlarm?.alarmScheduledBeforeRecovery !== true ||
    scheduleAlarm?.alarmMatchesNextExecution !== true ||
    scheduleAlarm?.runtimeScheduleMissingBeforeRecovery !== true ||
    scheduleAlarm?.dueCount !== 1 ||
    scheduleAlarm?.recoveredJobCount !== 1 ||
    scheduleAlarm?.recoveredJobId !== scheduleAlarm.jobId ||
    scheduleAlarm?.skippedRuntimeJobCount !== 0 ||
    scheduleAlarm?.workflowExecutionCount !== 1 ||
    scheduleAlarm?.persistedExecutionCount !== 1 ||
    scheduleAlarm?.alarmClearedAfterCleanup !== true ||
    scheduleAlarm?.persistedAfterCleanup !== false
  ) {
    throw new Error(
      `Workflow schedule alarm recovery did not run a persisted schedule after runtime timers were cleared: ${JSON.stringify(
        scheduleAlarm
      )}`
    )
  }

  const executionCleanerResponse = await fetch(
    `${base}/execution-cleaner-proof`,
    {
      method: "POST",
    }
  )
  const executionCleaner = await executionCleanerResponse.json()
  const expectedRemainingTransactionIds = [
    `${executionCleaner?.workflowId}-not-expired`,
    `${executionCleaner?.workflowId}-running`,
  ].sort()
  if (
    !executionCleanerResponse.ok ||
    typeof executionCleaner?.workflowId !== "string" ||
    executionCleaner?.expirableBeforeCount !== 3 ||
    executionCleaner?.expirableAfterCount !== 1 ||
    executionCleaner?.deletedExpiredFinishedCount !== 2 ||
    executionCleaner?.expiredDoneDeleted !== true ||
    executionCleaner?.expiredFailedDeleted !== true ||
    executionCleaner?.notExpiredFinishedPreserved !== true ||
    executionCleaner?.expiredRunningPreserved !== true ||
    executionCleaner?.remainingExecutionCount !== 2 ||
    !Array.isArray(executionCleaner?.remainingTransactionIds) ||
    executionCleaner.remainingTransactionIds.join("|") !==
      expectedRemainingTransactionIds.join("|")
  ) {
    throw new Error(
      `Workflow execution cleaner did not delete only expired finished executions through the DO SQLite store: ${JSON.stringify(
        executionCleaner
      )}`
    )
  }

  const delayedActionAlarmResponse = await fetch(
    `${base}/delayed-action-alarm-proof`,
    {
      method: "POST",
    }
  )
  const delayedActionAlarm = await delayedActionAlarmResponse.json()
  if (
    !delayedActionAlarmResponse.ok ||
    typeof delayedActionAlarm?.workflowId !== "string" ||
    delayedActionAlarm?.workflowName !== delayedActionAlarm.workflowId ||
    typeof delayedActionAlarm?.transactionId !== "string" ||
    typeof delayedActionAlarm?.actionId !== "string" ||
    delayedActionAlarm?.actionKind !== "retry-step" ||
    delayedActionAlarm?.alarmScheduledBeforeRecovery !== true ||
    delayedActionAlarm?.alarmMatchesDueAt !== true ||
    delayedActionAlarm?.persistedBeforeRecovery !== true ||
    delayedActionAlarm?.failedActionCount !== 0 ||
    (delayedActionAlarm?.recoveredByManualCall !== true &&
      delayedActionAlarm?.recoveredByDurableObjectAlarm !== true) ||
    (delayedActionAlarm?.recoveredByManualCall === true &&
      (delayedActionAlarm?.dueCount !== 1 ||
        delayedActionAlarm?.recoveredActionCount !== 1 ||
        delayedActionAlarm?.recoveredActionId !==
          delayedActionAlarm.actionId)) ||
    (delayedActionAlarm?.recoveredByDurableObjectAlarm === true &&
      (delayedActionAlarm?.dueCount !== 0 ||
        delayedActionAlarm?.recoveredActionCount !== 0)) ||
    delayedActionAlarm?.attemptCount !== 2 ||
    delayedActionAlarm?.workflowExecutionCount !== 1 ||
    delayedActionAlarm?.handledAfterRecovery !== true ||
    delayedActionAlarm?.pendingAfterRecovery !== 0 ||
    delayedActionAlarm?.alarmClearedAfterCleanup !== true ||
    delayedActionAlarm?.persistedAfterCleanup !== false
  ) {
    throw new Error(
      `Workflow delayed-action alarm recovery did not recover a persisted retry action through the Workflow Engine service: ${JSON.stringify(
        delayedActionAlarm
      )}`
    )
  }

  const stepTimeoutAlarmResponse = await fetch(
    `${base}/step-timeout-alarm-proof`,
    {
      method: "POST",
    }
  )
  const stepTimeoutAlarm = await stepTimeoutAlarmResponse.json()
  if (
    !stepTimeoutAlarmResponse.ok ||
    typeof stepTimeoutAlarm?.workflowId !== "string" ||
    stepTimeoutAlarm?.workflowName !== stepTimeoutAlarm.workflowId ||
    typeof stepTimeoutAlarm?.transactionId !== "string" ||
    typeof stepTimeoutAlarm?.actionId !== "string" ||
    stepTimeoutAlarm?.actionKind !== "step-timeout" ||
    typeof stepTimeoutAlarm?.stepId !== "string" ||
    stepTimeoutAlarm?.alarmScheduledBeforeRecovery !== true ||
    stepTimeoutAlarm?.alarmMatchesDueAt !== true ||
    stepTimeoutAlarm?.persistedBeforeRecovery !== true ||
    stepTimeoutAlarm?.failedActionCount !== 0 ||
    (stepTimeoutAlarm?.recoveredByManualCall !== true &&
      stepTimeoutAlarm?.recoveredByDurableObjectAlarm !== true) ||
    (stepTimeoutAlarm?.recoveredByManualCall === true &&
      (stepTimeoutAlarm?.dueCount !== 1 ||
        stepTimeoutAlarm?.recoveredActionCount !== 1 ||
        stepTimeoutAlarm?.recoveredActionId !== stepTimeoutAlarm.actionId)) ||
    (stepTimeoutAlarm?.recoveredByDurableObjectAlarm === true &&
      (stepTimeoutAlarm?.dueCount !== 0 ||
        stepTimeoutAlarm?.recoveredActionCount !== 0)) ||
    stepTimeoutAlarm?.stepInvocationCount !== 1 ||
    stepTimeoutAlarm?.transactionStateAfterRecovery !== "reverted" ||
    stepTimeoutAlarm?.resultIsUndefined !== true ||
    stepTimeoutAlarm?.errorCount !== 1 ||
    !String(stepTimeoutAlarm?.errorAction ?? "").endsWith(
      "step-timeout-step"
    ) ||
    stepTimeoutAlarm?.errorIsStepTimeout !== true ||
    stepTimeoutAlarm?.workflowExecutionCount !== 1 ||
    stepTimeoutAlarm?.handledAfterRecovery !== true ||
    stepTimeoutAlarm?.pendingAfterRecovery !== 0 ||
    stepTimeoutAlarm?.alarmClearedAfterCleanup !== true ||
    stepTimeoutAlarm?.persistedAfterCleanup !== false
  ) {
    throw new Error(
      `Workflow step-timeout alarm recovery did not recover a persisted timeout action through the Workflow Engine service: ${JSON.stringify(
        stepTimeoutAlarm
      )}`
    )
  }

  const transactionTimeoutAlarmResponse = await fetch(
    `${base}/transaction-timeout-alarm-proof`,
    {
      method: "POST",
    }
  )
  const transactionTimeoutAlarm =
    await transactionTimeoutAlarmResponse.json()
  if (
    !transactionTimeoutAlarmResponse.ok ||
    typeof transactionTimeoutAlarm?.workflowId !== "string" ||
    transactionTimeoutAlarm?.workflowName !==
      transactionTimeoutAlarm.workflowId ||
    typeof transactionTimeoutAlarm?.transactionId !== "string" ||
    typeof transactionTimeoutAlarm?.actionId !== "string" ||
    transactionTimeoutAlarm?.actionKind !== "transaction-timeout" ||
    transactionTimeoutAlarm?.alarmScheduledBeforeRecovery !== true ||
    transactionTimeoutAlarm?.alarmMatchesDueAt !== true ||
    transactionTimeoutAlarm?.persistedBeforeRecovery !== true ||
    transactionTimeoutAlarm?.failedActionCount !== 0 ||
    (transactionTimeoutAlarm?.recoveredByManualCall !== true &&
      transactionTimeoutAlarm?.recoveredByDurableObjectAlarm !== true) ||
    (transactionTimeoutAlarm?.recoveredByManualCall === true &&
      (transactionTimeoutAlarm?.dueCount !== 1 ||
        transactionTimeoutAlarm?.recoveredActionCount !== 1 ||
        transactionTimeoutAlarm?.recoveredActionId !==
          transactionTimeoutAlarm.actionId)) ||
    (transactionTimeoutAlarm?.recoveredByDurableObjectAlarm === true &&
      (transactionTimeoutAlarm?.dueCount !== 0 ||
        transactionTimeoutAlarm?.recoveredActionCount !== 0)) ||
    transactionTimeoutAlarm?.stepInvocationCount !== 1 ||
    transactionTimeoutAlarm?.transactionStateAfterRecovery !== "reverted" ||
    transactionTimeoutAlarm?.resultIsUndefined !== true ||
    transactionTimeoutAlarm?.errorCount !== 1 ||
    !String(transactionTimeoutAlarm?.errorAction ?? "").endsWith(
      "transaction-timeout-step"
    ) ||
    transactionTimeoutAlarm?.errorIsTransactionTimeout !== true ||
    transactionTimeoutAlarm?.workflowExecutionCount !== 1 ||
    transactionTimeoutAlarm?.handledAfterRecovery !== true ||
    transactionTimeoutAlarm?.pendingAfterRecovery !== 0 ||
    transactionTimeoutAlarm?.alarmClearedAfterCleanup !== true ||
    transactionTimeoutAlarm?.persistedAfterCleanup !== false
  ) {
    throw new Error(
      `Workflow transaction-timeout alarm recovery did not recover a persisted timeout action through the Workflow Engine service: ${JSON.stringify(
        transactionTimeoutAlarm
      )}`
    )
  }

  const queueProofId = `queue-proof-${Date.now()}`
  const queueProofResponse = await fetch(
    `http://127.0.0.1:${port}/queue-consumer-proof/${queueProofId}`,
    { method: "POST" }
  )
  const queueProof = await queueProofResponse.json()
  if (
    !queueProofResponse.ok ||
    queueProof?.dispatched !== true ||
    queueProof?.record?.id !== queueProofId ||
    queueProof?.record?.eventName !== "cloudflare.queue.proof"
  ) {
    throw new Error(
      `Cloudflare Queue consumer did not dispatch the proof event: ${JSON.stringify(
        queueProof
      )}`
    )
  }

  const coldMissingCartId = `cart_missing_worker_partition_${Date.now()}`
  const coldMissingCartRouteResponse = await fetch(
    `http://127.0.0.1:${port}/store/carts/${coldMissingCartId}?fields=id,currency_code`
  )
  const coldMissingCartRouteText = await coldMissingCartRouteResponse.text()
  const coldMissingCartRoute = JSON.parse(coldMissingCartRouteText)
  if (
    coldMissingCartRouteResponse.status !== 404 ||
    coldMissingCartRouteResponse.headers.get("x-medusa-http-proof") !== null ||
    coldMissingCartRouteResponse.headers.get("x-medusa-partition-name") !==
      `partition:local:local:development:dev:cart:${coldMissingCartId}` ||
    coldMissingCartRoute?.type !== "not_found" ||
    coldMissingCartRoute?.message !==
      `Cart with id '${coldMissingCartId}' not found`
  ) {
    throw new Error(
      `Real Medusa store/carts/:id route did not return the expected not-found error from a URL-derived Cart DO partition in workerd: ${coldMissingCartRouteText}`
    )
  }

  console.log(
    "Actual Durable Object Locking, Queue Event Bus consumer, Workflow execution store, Workflow schedule store and alarm recovery, Workflow delayed-action store and alarm recovery, Workflow step-timeout delayed-action recovery, Workflow transaction-timeout delayed-action recovery, Analytics, Caching, API Key, Auth, RBAC, Settings, Translation, File, Notification, Fulfillment, Order, Promotion, Tax, Pricing, Payment, Product, Inventory, Customer, Stock Location, Region, Sales Channel, Store, User, and Cart module services passed Durable Object SQLite module-set, totals, cache invalidation, serialized locking, queue dispatch, execution persistence, schedule persistence, delayed-action persistence, alarm recovery, and atomic rollback proof"
  )
} finally {
  stopProcessTree(server.pid)
}

async function assertTenantScopedCartDurableObjectRouting() {
  const aggregate = "shared-cart-proof-scope"
  const url = `http://127.0.0.1:${port}/do-cart/${aggregate}/capabilities`
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
      "partition:tenant_a:storefront:prod:v1:cart:shared-cart-proof-scope" ||
    tenantBPartition !==
      "partition:tenant_b:storefront:prod:v1:cart:shared-cart-proof-scope" ||
    tenantAPartition === tenantBPartition
  ) {
    throw new Error(
      `Tenant Cart Durable Object partition routing failed: ${JSON.stringify({
        tenantACapabilities,
        tenantBCapabilities,
        tenantAPartition,
        tenantBPartition,
      })}`
    )
  }

  const invalidResponse = await fetch(url, {
    headers: tenantHeaders("tenant:bad"),
  })
  const invalidCheck = await invalidResponse.json()

  if (invalidResponse.status !== 400 || invalidCheck?.field !== "tenantId") {
    throw new Error(
      `Tenant Cart Durable Object validation check failed: ${JSON.stringify(
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

async function assertAdminIndexRoutes() {
  const authHeaders = {
    "x-medusa-access-token": "user_worker_http_proof",
  }
  const detailsResponse = await fetch(
    `http://127.0.0.1:${port}/admin/index/details`,
    {
      headers: authHeaders,
    }
  )
  const details = await detailsResponse.json()

  if (
    !detailsResponse.ok ||
    !Array.isArray(details?.metadata) ||
    !details.metadata.some(
      (metadata) =>
        metadata?.entity === "Product" &&
        Array.isArray(metadata?.fields) &&
        metadata.fields.includes("title") &&
        metadata?.status === "pending"
    )
  ) {
    throw new Error(
      `Real Medusa admin/index/details route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        details
      )}`
    )
  }

  const syncResponse = await fetch(
    `http://127.0.0.1:${port}/admin/index/sync`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({ strategy: "full" }),
    }
  )
  const syncBody = await syncResponse.text()

  if (!syncResponse.ok || syncBody !== "OK") {
    throw new Error(
      `Real Medusa admin/index/sync route did not execute through the Fetch adapter in workerd: ${syncResponse.status} ${syncBody}`
    )
  }
}

async function assertAdminUserReadRoutes() {
  const authHeaders = {
    "x-medusa-access-token": "user_worker_http_proof",
  }
  const meResponse = await fetch(`http://127.0.0.1:${port}/admin/users/me`, {
    headers: authHeaders,
  })
  const meBody = await meResponse.json()

  if (
    !meResponse.ok ||
    meResponse.headers.get("x-medusa-http-proof") !== null ||
    meBody?.user?.id !== "user_worker_http_proof" ||
    meBody.user?.email !== "user_worker_http_proof@worker-http-proof.local"
  ) {
    throw new Error(
      `Real Medusa admin/users/me route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        meBody
      )}`
    )
  }

  const listResponse = await fetch(
    `http://127.0.0.1:${port}/admin/users?q=worker_http_proof&limit=10&offset=0`,
    {
      headers: authHeaders,
    }
  )
  const listBody = await listResponse.json()
  const seededUser = Array.isArray(listBody?.users)
    ? listBody.users.find((user) => user?.id === "user_worker_http_proof")
    : undefined

  if (
    !listResponse.ok ||
    listResponse.headers.get("x-medusa-http-proof") !== null ||
    seededUser?.email !== "user_worker_http_proof@worker-http-proof.local" ||
    listBody?.count < 1 ||
    listBody?.offset !== 0 ||
    listBody?.limit !== 10
  ) {
    throw new Error(
      `Real Medusa admin/users list route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        listBody
      )}`
    )
  }

  const retrieveResponse = await fetch(
    `http://127.0.0.1:${port}/admin/users/user_worker_http_proof`,
    {
      headers: authHeaders,
    }
  )
  const retrieveBody = await retrieveResponse.json()

  if (
    !retrieveResponse.ok ||
    retrieveResponse.headers.get("x-medusa-http-proof") !== null ||
    retrieveBody?.user?.id !== "user_worker_http_proof" ||
    retrieveBody.user?.email !== "user_worker_http_proof@worker-http-proof.local"
  ) {
    throw new Error(
      `Real Medusa admin/users retrieve route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        retrieveBody
      )}`
    )
  }

  const updateResponse = await fetch(
    `http://127.0.0.1:${port}/admin/users/user_worker_http_proof`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        first_name: "Updated",
        last_name: "Worker",
        metadata: {
          source: "workerd-fetch-static-proof",
        },
      }),
    }
  )
  const updateBody = await updateResponse.json()

  if (
    !updateResponse.ok ||
    updateResponse.headers.get("x-medusa-http-proof") !== null ||
    updateBody?.user?.id !== "user_worker_http_proof" ||
    updateBody.user?.email !== "user_worker_http_proof@worker-http-proof.local" ||
    updateBody.user?.first_name !== "Updated" ||
    updateBody.user?.last_name !== "Worker"
  ) {
    throw new Error(
      `Real Medusa admin/users update route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        updateBody
      )}`
    )
  }

  const rolesResponse = await fetch(
    `http://127.0.0.1:${port}/admin/users/user_worker_http_proof/roles?limit=10&offset=0`,
    {
      headers: authHeaders,
    }
  )
  const rolesBody = await rolesResponse.json()

  if (
    !rolesResponse.ok ||
    rolesResponse.headers.get("x-medusa-http-proof") !== null ||
    !Array.isArray(rolesBody?.roles) ||
    typeof rolesBody?.count !== "number" ||
    rolesBody?.offset !== 0 ||
    rolesBody?.limit !== 10
  ) {
    throw new Error(
      `Real Medusa admin/users roles route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        rolesBody
      )}`
    )
  }

  const assignRolesResponse = await fetch(
    `http://127.0.0.1:${port}/admin/users/user_worker_http_proof/roles`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({ roles: ["role_super_admin"] }),
    }
  )
  const assignRolesBody = await assignRolesResponse.json()
  const assignedRole = Array.isArray(assignRolesBody?.roles)
    ? assignRolesBody.roles.find((role) => role?.id === "role_super_admin")
    : undefined

  if (
    !assignRolesResponse.ok ||
    assignRolesResponse.headers.get("x-medusa-http-proof") !== null ||
    !assignedRole
  ) {
    throw new Error(
      `Real Medusa admin/users role assignment route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        assignRolesBody
      )}`
    )
  }

  const removeRolesResponse = await fetch(
    `http://127.0.0.1:${port}/admin/users/user_worker_http_proof/roles`,
    {
      method: "DELETE",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({ roles: ["role_super_admin"] }),
    }
  )
  const removeRolesBody = await removeRolesResponse.json()
  if (
    !removeRolesResponse.ok ||
    removeRolesResponse.headers.get("x-medusa-http-proof") !== null ||
    !Array.isArray(removeRolesBody?.ids) ||
    removeRolesBody.ids[0] !== "role_super_admin" ||
    removeRolesBody?.object !== "user_role" ||
    removeRolesBody?.deleted !== true
  ) {
    throw new Error(
      `Real Medusa admin/users roles delete route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        removeRolesBody
      )}`
    )
  }

  const reassignRolesResponse = await fetch(
    `http://127.0.0.1:${port}/admin/users/user_worker_http_proof/roles`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({ roles: ["role_super_admin"] }),
    }
  )
  if (
    !reassignRolesResponse.ok ||
    reassignRolesResponse.headers.get("x-medusa-http-proof") !== null
  ) {
    const reassignRolesBody = await reassignRolesResponse.json()
    throw new Error(
      `Real Medusa admin/users role reassignment route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        reassignRolesBody
      )}`
    )
  }

  const removeRoleResponse = await fetch(
    `http://127.0.0.1:${port}/admin/users/user_worker_http_proof/roles/role_super_admin`,
    {
      method: "DELETE",
      headers: authHeaders,
    }
  )
  const removeRoleBody = await removeRoleResponse.json()
  if (
    !removeRoleResponse.ok ||
    removeRoleResponse.headers.get("x-medusa-http-proof") !== null ||
    removeRoleBody?.id !== "role_super_admin" ||
    removeRoleBody?.object !== "user_role" ||
    removeRoleBody?.deleted !== true
  ) {
    throw new Error(
      `Real Medusa admin/users role delete route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        removeRoleBody
      )}`
    )
  }

  await fetch(`http://127.0.0.1:${port}/http-proof/users`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      users: [
        {
          id: "user_worker_http_delete_proof",
          email: "user_worker_http_delete_proof@worker-http-proof.local",
        },
      ],
    }),
  })
  await fetch(`http://127.0.0.1:${port}/http-proof/auth-identities`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      auth_identities: [
        {
          id: "auth_identity_worker_http_delete_proof",
          app_metadata: {
            user_id: "user_worker_http_delete_proof",
          },
          provider_identities: [
            {
              provider: "emailpass",
              entity_id: "user_worker_http_delete_proof@worker-http-proof.local",
            },
          ],
        },
      ],
    }),
  })

  const deleteUserResponse = await fetch(
    `http://127.0.0.1:${port}/admin/users/user_worker_http_delete_proof`,
    {
      method: "DELETE",
      headers: authHeaders,
    }
  )
  const deleteUserBody = await deleteUserResponse.json()
  if (
    !deleteUserResponse.ok ||
    deleteUserResponse.headers.get("x-medusa-http-proof") !== null ||
    deleteUserBody?.id !== "user_worker_http_delete_proof" ||
    deleteUserBody?.object !== "user" ||
    deleteUserBody?.deleted !== true
  ) {
    throw new Error(
      `Real Medusa admin/users delete route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        deleteUserBody
      )}`
    )
  }
}

async function assertPaymentWebhookRoute() {
  const rawWebhookBody = JSON.stringify({
    id: "evt_worker_http_proof",
    type: "payment_intent.succeeded",
  })
  const webhookResponse = await fetch(
    `http://127.0.0.1:${port}/hooks/payment/pp_system_default`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-proof": "raw-body",
      },
      body: rawWebhookBody,
    }
  )
  const webhookBody = await webhookResponse.text()

  if (!webhookResponse.ok || webhookBody !== "OK") {
    throw new Error(
      `Real Medusa payment webhook route did not execute through the Fetch adapter in workerd: ${webhookResponse.status} ${webhookBody}`
    )
  }

  const eventsResponse = await fetch(
    `http://127.0.0.1:${port}/http-proof/webhook-events`
  )
  const eventsBody = await eventsResponse.json()
  const events = Array.isArray(eventsBody?.events) ? eventsBody.events : []
  const event = events.find((candidate) =>
    isNamedWebhookEvent(candidate, "payment.webhook_received")
  )
  const payload = event?.message?.data?.payload

  if (
    !eventsResponse.ok ||
    event?.message?.name !== "payment.webhook_received" ||
    event.message?.data?.provider !== "pp_system_default" ||
    payload?.data?.id !== "evt_worker_http_proof" ||
    payload?.data?.type !== "payment_intent.succeeded" ||
    payload?.rawData?.type !== "Uint8Array" ||
    payload.rawData?.length !== rawWebhookBody.length ||
    payload.rawData?.text !== rawWebhookBody ||
    payload?.headers?.["x-webhook-proof"] !== "raw-body" ||
    event?.options?.delay !== 5000 ||
    event.options?.attempts !== 1
  ) {
    throw new Error(
      `Real Medusa payment webhook route did not preserve parsed body, raw body, headers, provider, and emit options in workerd: ${JSON.stringify(
        eventsBody
      )}`
    )
  }
}

async function assertAuthRoutes() {
  const credentials = {
    email: "auth-route-workerd@example.com",
    password: "auth-route-workerd-password",
  }
  const registerResponse = await fetch(
    `http://127.0.0.1:${port}/auth/user/emailpass/register`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(credentials),
    }
  )
  const registerBody = await registerResponse.json()
  const registerPayload = registerBody?.token
    ? decodeStaticJwtPayload(registerBody.token)
    : undefined

  if (
    !registerResponse.ok ||
    registerResponse.headers.get("x-medusa-http-proof") !== null ||
    registerPayload?.actor_type !== "user" ||
    registerPayload?.auth_identity_id !== "authid_worker_http_proof_1" ||
    registerPayload?.user_metadata?.email !== credentials.email
  ) {
    throw new Error(
      `Real Medusa auth register route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        registerBody
      )}`
    )
  }

  const resetPasswordResponse = await fetch(
    `http://127.0.0.1:${port}/auth/user/emailpass/reset-password`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        identifier: credentials.email,
        metadata: {
          source: "auth-route-workerd",
        },
      }),
    }
  )
  const resetPasswordBody = await resetPasswordResponse.text()

  if (
    resetPasswordResponse.status !== 201 ||
    resetPasswordResponse.headers.get("x-medusa-http-proof") !== null ||
    resetPasswordBody !== "Created"
  ) {
    throw new Error(
      `Real Medusa auth reset-password route did not execute through the Fetch adapter in workerd: ${resetPasswordResponse.status} ${resetPasswordBody}`
    )
  }

  const authEventsResponse = await fetch(
    `http://127.0.0.1:${port}/http-proof/webhook-events`
  )
  const authEventsBody = await authEventsResponse.json()
  const resetPasswordEvent = Array.isArray(authEventsBody?.events)
    ? authEventsBody.events.find((event) =>
        isNamedWebhookEvent(event, "auth.password_reset")
      )
    : undefined
  const resetPasswordToken = resetPasswordEvent?.message?.data?.token
  const resetPasswordPayload =
    typeof resetPasswordToken === "string"
      ? decodeStaticJwtPayload(resetPasswordToken)
      : undefined

  if (
    !authEventsResponse.ok ||
    resetPasswordEvent?.message?.data?.entity_id !== credentials.email ||
    resetPasswordEvent.message?.data?.actor_type !== "user" ||
    resetPasswordEvent.message?.data?.metadata?.source !==
      "auth-route-workerd" ||
    resetPasswordEvent.options !== undefined ||
    resetPasswordPayload?.entity_id !== credentials.email ||
    resetPasswordPayload?.provider !== "emailpass" ||
    resetPasswordPayload?.actor_type !== "user"
  ) {
    throw new Error(
      `Real Medusa auth reset-password route did not release auth.password_reset through the event bus in workerd: ${JSON.stringify(
        authEventsBody
      )}`
    )
  }

  const loginResponse = await fetch(
    `http://127.0.0.1:${port}/auth/user/emailpass`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(credentials),
    }
  )
  const loginBody = await loginResponse.json()
  const loginPayload = loginBody?.token
    ? decodeStaticJwtPayload(loginBody.token)
    : undefined

  if (
    !loginResponse.ok ||
    loginResponse.headers.get("x-medusa-http-proof") !== null ||
    loginPayload?.actor_type !== "user" ||
    loginPayload?.auth_identity_id !== "authid_worker_http_proof_1" ||
    loginPayload?.user_metadata?.email !== credentials.email
  ) {
    throw new Error(
      `Real Medusa auth login route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        loginBody
      )}`
    )
  }

  const refreshResponse = await fetch(
    `http://127.0.0.1:${port}/auth/token/refresh`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${loginBody.token}`,
        "x-medusa-access-token": "user_worker_http_proof",
      },
    }
  )
  const refreshBody = await refreshResponse.json()
  const refreshPayload = refreshBody?.token
    ? decodeStaticJwtPayload(refreshBody.token)
    : undefined

  if (
    !refreshResponse.ok ||
    refreshResponse.headers.get("x-medusa-http-proof") !== null ||
    refreshPayload?.actor_type !== "user" ||
    refreshPayload?.auth_identity_id !== "authid_worker_http_proof_1" ||
    JSON.stringify(refreshPayload?.user_metadata) !== "{}"
  ) {
    throw new Error(
      `Real Medusa auth token refresh route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        refreshBody
      )}`
    )
  }

  const updatedPassword = "auth-route-workerd-updated-password"
  const updateToken = createStaticUpdateProviderToken({
    actorType: "user",
    provider: "emailpass",
    entityId: credentials.email,
  })
  const updateResponse = await fetch(
    `http://127.0.0.1:${port}/auth/user/emailpass/update`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${updateToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        password: updatedPassword,
      }),
    }
  )
  const updateBody = await updateResponse.json()

  if (
    !updateResponse.ok ||
    updateResponse.headers.get("x-medusa-http-proof") !== null ||
    updateBody?.success !== true
  ) {
    throw new Error(
      `Real Medusa auth update route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        updateBody
      )}`
    )
  }

  const updatedLoginResponse = await fetch(
    `http://127.0.0.1:${port}/auth/user/emailpass`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: credentials.email,
        password: updatedPassword,
      }),
    }
  )
  const updatedLoginBody = await updatedLoginResponse.json()
  const updatedLoginPayload = updatedLoginBody?.token
    ? decodeStaticJwtPayload(updatedLoginBody.token)
    : undefined

  if (
    !updatedLoginResponse.ok ||
    updatedLoginResponse.headers.get("x-medusa-http-proof") !== null ||
    updatedLoginPayload?.actor_type !== "user" ||
    updatedLoginPayload?.auth_identity_id !== "authid_worker_http_proof_1"
  ) {
    throw new Error(
      `Real Medusa auth update route did not persist provider changes in workerd: ${JSON.stringify(
        updatedLoginBody
      )}`
    )
  }
}

async function assertWorkflowExecutionReadRoutes() {
  const workflowId = "workflow_worker_http_read_workerd"
  const transactionId = "trx_worker_http_read_workerd"
  const runResponse = await fetch(
    `http://127.0.0.1:${port}/admin/workflows-executions/${workflowId}/run`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        transaction_id: transactionId,
        input: {
          source: "workerd-read-proof",
        },
      }),
    }
  )
  const runBody = await runResponse.json()

  if (
    !runResponse.ok ||
    runResponse.headers.get("x-medusa-http-proof") !== null ||
    runBody?.acknowledgement?.transactionId !== transactionId ||
    runBody.acknowledgement?.workflowId !== workflowId ||
    runBody.acknowledgement?.hasFailed !== false ||
    runBody.acknowledgement?.hasFinished !== false
  ) {
    throw new Error(
      `Real Medusa workflow execution run route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        runBody
      )}`
    )
  }

  const listResponse = await fetch(
    `http://127.0.0.1:${port}/admin/workflows-executions?q=read_workerd&limit=10&offset=0`,
    {
      headers: {
        "x-medusa-access-token": "user_worker_http_proof",
      },
    }
  )
  const listBody = await listResponse.json()
  const listedExecution = Array.isArray(listBody?.workflow_executions)
    ? listBody.workflow_executions.find(
        (execution) =>
          execution?.workflow_id === workflowId &&
          execution?.transaction_id === transactionId
      )
    : undefined

  if (
    !listResponse.ok ||
    listResponse.headers.get("x-medusa-http-proof") !== null ||
    listBody?.count < 1 ||
    !listedExecution?.id
  ) {
    throw new Error(
      `Real Medusa workflow execution list route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        listBody
      )}`
    )
  }

  const byIdResponse = await fetch(
    `http://127.0.0.1:${port}/admin/workflows-executions/${listedExecution.id}`,
    {
      headers: {
        "x-medusa-access-token": "user_worker_http_proof",
      },
    }
  )
  const byIdBody = await byIdResponse.json()

  if (
    !byIdResponse.ok ||
    byIdResponse.headers.get("x-medusa-http-proof") !== null ||
    byIdBody?.workflow_execution?.id !== listedExecution.id ||
    byIdBody.workflow_execution?.workflow_id !== workflowId ||
    byIdBody.workflow_execution?.transaction_id !== transactionId ||
    byIdBody.workflow_execution?.state !== "invoking"
  ) {
    throw new Error(
      `Real Medusa workflow execution by-id route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        byIdBody
      )}`
    )
  }

  const stepId = "step_worker_http_read_workerd"
  const stepResponse = { result: "workerd-step-success" }
  const compensateInput = { revert: "workerd-step-success" }
  const successResponse = await fetch(
    `http://127.0.0.1:${port}/admin/workflows-executions/${workflowId}/steps/success`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-medusa-access-token": "user_worker_http_proof",
      },
      body: JSON.stringify({
        transaction_id: transactionId,
        step_id: stepId,
        response: stepResponse,
        compensate_input: compensateInput,
      }),
    }
  )
  const successBody = await successResponse.json()

  if (
    !successResponse.ok ||
    successResponse.headers.get("x-medusa-http-proof") !== null ||
    successBody?.success !== true
  ) {
    throw new Error(
      `Real Medusa workflow execution step success route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        successBody
      )}`
    )
  }

  const byWorkflowTransactionResponse = await fetch(
    `http://127.0.0.1:${port}/admin/workflows-executions/${workflowId}/${transactionId}`,
    {
      headers: {
        "x-medusa-access-token": "user_worker_http_proof",
      },
    }
  )
  const byWorkflowTransactionBody = await byWorkflowTransactionResponse.json()

  if (
    !byWorkflowTransactionResponse.ok ||
    byWorkflowTransactionResponse.headers.get("x-medusa-http-proof") !== null ||
    byWorkflowTransactionBody?.workflow_execution?.id !== listedExecution.id ||
    byWorkflowTransactionBody.workflow_execution?.workflow_id !== workflowId ||
    byWorkflowTransactionBody.workflow_execution?.transaction_id !==
      transactionId ||
    byWorkflowTransactionBody.workflow_execution?.state !== "done" ||
    byWorkflowTransactionBody.workflow_execution?.execution?.hasWaitingSteps !==
      false ||
    JSON.stringify(
      byWorkflowTransactionBody.workflow_execution?.context?.data?.invoke?.[
        stepId
      ]
    ) !==
      JSON.stringify({
        __type: "Symbol(WorkflowStepResponse)",
        output: stepResponse,
        compensateInput,
      })
  ) {
    throw new Error(
      `Real Medusa workflow execution workflow/transaction route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        byWorkflowTransactionBody
      )}`
    )
  }

  const failureWorkflowId = "workflow_worker_http_failure_workerd"
  const failureTransactionId = "trx_worker_http_failure_workerd"
  const failureStepId = "step_worker_http_failure_workerd"
  const failureResponse = { error: "workerd-step-failure" }
  const failureCompensateInput = { revert: "workerd-step-failure" }
  const failureRunResponse = await fetch(
    `http://127.0.0.1:${port}/admin/workflows-executions/${failureWorkflowId}/run`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        transaction_id: failureTransactionId,
        input: {
          source: "workerd-failure-proof",
        },
      }),
    }
  )

  if (
    !failureRunResponse.ok ||
    failureRunResponse.headers.get("x-medusa-http-proof") !== null
  ) {
    throw new Error(
      `Real Medusa workflow execution run route did not seed failure proof in workerd: ${failureRunResponse.status} ${await failureRunResponse.text()}`
    )
  }

  const failureStepResponse = await fetch(
    `http://127.0.0.1:${port}/admin/workflows-executions/${failureWorkflowId}/steps/failure`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-medusa-access-token": "user_worker_http_proof",
      },
      body: JSON.stringify({
        transaction_id: failureTransactionId,
        step_id: failureStepId,
        response: failureResponse,
        compensate_input: failureCompensateInput,
      }),
    }
  )
  const failureStepBody = await failureStepResponse.json()

  if (
    !failureStepResponse.ok ||
    failureStepResponse.headers.get("x-medusa-http-proof") !== null ||
    failureStepBody?.success !== true
  ) {
    throw new Error(
      `Real Medusa workflow execution step failure route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        failureStepBody
      )}`
    )
  }

  const failedExecutionResponse = await fetch(
    `http://127.0.0.1:${port}/admin/workflows-executions/${failureWorkflowId}/${failureTransactionId}`,
    {
      headers: {
        "x-medusa-access-token": "user_worker_http_proof",
      },
    }
  )
  const failedExecutionBody = await failedExecutionResponse.json()

  if (
    !failedExecutionResponse.ok ||
    failedExecutionResponse.headers.get("x-medusa-http-proof") !== null ||
    failedExecutionBody?.workflow_execution?.state !== "reverted" ||
    failedExecutionBody.workflow_execution?.execution?.hasFailedSteps !==
      true ||
    failedExecutionBody.workflow_execution?.execution?.hasWaitingSteps !==
      false ||
    failedExecutionBody.workflow_execution?.execution?.hasRevertedSteps !==
      true ||
    JSON.stringify(
      failedExecutionBody.workflow_execution?.context?.data?.invoke?.[
        failureStepId
      ]
    ) !==
      JSON.stringify({
        __type: "Symbol(WorkflowStepResponse)",
        output: failureResponse,
        compensateInput: failureCompensateInput,
      })
  ) {
    throw new Error(
      `Real Medusa workflow execution failure state was not readable through the Fetch adapter in workerd: ${JSON.stringify(
        failedExecutionBody
      )}`
    )
  }
}

async function assertAuthSessionRoute() {
  const sessionResponse = await fetch(
    `http://127.0.0.1:${port}/auth/session`,
    {
      method: "POST",
      headers: {
        "x-medusa-access-token": "user_worker_http_proof",
      },
    }
  )
  const sessionBody = await sessionResponse.json()
  const sessionCookie = sessionResponse.headers.get("set-cookie")

  if (
    !sessionResponse.ok ||
    sessionResponse.headers.get("x-medusa-http-proof") !== null ||
    sessionBody?.user?.actor_id !== "user_worker_http_proof" ||
    sessionBody.user?.actor_type !== "user" ||
    sessionCookie !==
      "connect.sid=session_worker_http_proof_1; Path=/; HttpOnly"
  ) {
    throw new Error(
      `Real Medusa auth session POST route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        { sessionBody, sessionCookie }
      )}`
    )
  }

  const deleteResponse = await fetch(
    `http://127.0.0.1:${port}/auth/session`,
    {
      method: "DELETE",
      headers: {
        cookie: sessionCookie ?? "",
      },
    }
  )
  const deleteBody = await deleteResponse.json()

  if (
    !deleteResponse.ok ||
    deleteResponse.headers.get("x-medusa-http-proof") !== null ||
    deleteResponse.headers.get("set-cookie") !==
      "connect.sid=; Path=/; HttpOnly; Max-Age=0" ||
    deleteBody?.success !== true
  ) {
    throw new Error(
      `Real Medusa auth session DELETE route did not execute through the Fetch adapter in workerd: ${JSON.stringify(
        deleteBody
      )}`
    )
  }
}

function decodeStaticJwtPayload(token) {
  const payloadSegment = token.split(".")[1]
  if (!payloadSegment) {
    throw new Error("JWT did not include a payload segment")
  }

  return JSON.parse(decodeStaticBase64Url(payloadSegment))
}

function isNamedWebhookEvent(value, name) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.message !== null &&
    typeof value.message === "object" &&
    value.message.name === name &&
    value.message.data !== null &&
    typeof value.message.data === "object"
  )
}

function createStaticUpdateProviderToken(input) {
  const now = Math.floor(Date.now() / 1000)
  const header = encodeStaticBase64Url(
    JSON.stringify({ alg: "none", typ: "JWT" })
  )
  const payload = encodeStaticBase64Url(
    JSON.stringify({
      actor_type: input.actorType,
      provider: input.provider,
      entity_id: input.entityId,
      iat: now,
      exp: now + 60 * 60,
    })
  )

  return `${header}.${payload}.worker-http-proof`
}

async function createStaticAuthContextToken(input) {
  const header = encodeStaticBase64Url(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  )
  const payload = encodeStaticBase64Url(
    JSON.stringify({
      actor_id: input.actorId,
      actor_type: input.actorType,
      auth_identity_id: input.authIdentityId,
      app_metadata: {},
      user_metadata: {},
    })
  )
  const signature = await signStaticJwtInput(
    `${header}.${payload}`,
    medusaCloudflareWorkerProofJwtSecret
  )

  return `${header}.${payload}.${signature}`
}

async function signStaticJwtInput(input, secret) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(input))

  return encodeStaticBase64UrlBytes(new Uint8Array(signature))
}

function encodeStaticBase64Url(value) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function encodeStaticBase64UrlBytes(bytes) {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function decodeStaticBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(
    Math.ceil(normalized.length / 4) * 4,
    "="
  )
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new TextDecoder().decode(bytes)
}

async function seedStaticProductProof() {
  await postHttpProofState("collections", {
    collections: [
      {
        title: "Worker Collection",
        handle: "worker-collection",
        metadata: {
          source: "worker-http-proof",
        },
      },
    ],
  })

  await postHttpProofState("product-tags", {
    product_tags: [
      {
        value: "worker-tag",
        metadata: {
          source: "worker-http-proof",
        },
      },
    ],
  })

  await postHttpProofState("product-types", {
    product_types: [
      {
        value: "worker-type",
        metadata: {
          source: "worker-http-proof",
        },
      },
    ],
  })

  await postHttpProofState("products", {
    products: [
      {
        id: "prod_worker_http_proof",
        title: "Worker Product",
        handle: "worker-product",
        collection_id: "pcol_worker_http_proof_1",
        type_id: "ptyp_000000000000000000000001",
        status: "published",
        tags: [
          {
            id: "ptag_worker_http_proof_1",
            value: "worker-tag",
          },
        ],
        variants: [
          {
            id: "variant_worker_http_proof",
            title: "Worker Product Variant",
            sku: "worker-variant",
            product_id: "prod_worker_http_proof",
            manage_inventory: true,
            allow_backorder: false,
            prices: [
              {
                amount: 100,
                currency_code: "usd",
              },
            ],
            inventory_items: [
              {
                inventory_item_id: "iitem_worker_http_proof",
                required_quantity: 2,
              },
            ],
            calculated_price: {
              calculated_amount: 100,
              original_amount: 120,
              currency_code: "usd",
              is_calculated_price_tax_inclusive: false,
              is_original_price_tax_inclusive: false,
            },
          },
        ],
      },
    ],
  })

  await postHttpProofState("remote-links", {
    links: [
      {
        product: {
          product_id: "prod_worker_http_proof",
        },
        sales_channel: {
          sales_channel_id: "sc_worker_http_proof",
        },
      },
    ],
  })

  await postHttpProofState("promotions", {
    promotions: [
      {
        id: "promo_promo_worker_http_proof",
        code: "PROMO_WORKER_HTTP_PROOF",
        status: "active",
      },
    ],
  })
}

async function postHttpProofState(proofId, body) {
  const response = await fetch(`http://127.0.0.1:${port}/http-proof/${proofId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(
      `Failed to seed ${proofId} HTTP proof state: ${await response.text()}`
    )
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
