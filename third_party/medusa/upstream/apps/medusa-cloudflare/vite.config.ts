import { cloudflare } from "@cloudflare/vite-plugin"
import { fileURLToPath } from "node:url"
import { defineConfig, type UserConfig } from "vite"

const awilixBrowser = fileURLToPath(
  new URL("../../node_modules/awilix/lib/awilix.browser.js", import.meta.url)
)
const zodEsm = fileURLToPath(
  new URL("../../node_modules/zod/index.js", import.meta.url)
)

export const medusaCloudflareSharedViteConfig = {
  define: {
    __MEDUSA_CLOUDFLARE_CUSTOM_FF__: JSON.stringify(
      process.env.CUSTOM_FF === "true"
    ),
    __MEDUSA_CLOUDFLARE_WORKER__: JSON.stringify(true),
  },
  optimizeDeps: {
    exclude: [
      "@medusajs/orchestration",
      "@medusajs/orchestration/transaction",
      "@medusajs/orchestration/transaction/errors",
      "@medusajs/orchestration/workflow/local-workflow",
      "@medusajs/orchestration/workflow/scheduler",
      "@medusajs/orchestration/workflow/workflow-manager",
      "@medusajs/workflow-engine-inmemory",
      "@medusajs/workflow-engine-inmemory/static-manifest",
      "@medusajs/workflows-sdk",
      "@medusajs/workflows-sdk/composer",
      "@medusajs/workflows-sdk/helper/type",
      "@medusajs/workflows-sdk/medusa-workflow",
      "@medusajs/core-flows/auth/workflows/generate-reset-password-token",
      "@medusajs/core-flows/customer/workflows/update-customers",
      "@medusajs/core-flows/customer/workflows/create-addresses",
      "@medusajs/core-flows/customer/workflows/update-addresses",
      "@medusajs/core-flows/customer/workflows/delete-addresses",
      "@medusajs/core-flows/user/workflows/update-users",
      "@medusajs/core-flows/user/workflows/remove-user-account",
      "@medusajs/core-flows/user/workflows/assign-user-roles",
      "@medusajs/core-flows/user/workflows/remove-user-roles",
    ],
  },
  resolve: {
    alias: {
      "@models": fileURLToPath(
        new URL(
          "../../packages/modules/currency/src/models/index.ts",
          import.meta.url
        )
      ),
      "@services": fileURLToPath(
        new URL(
          "../../packages/modules/currency/src/services/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/currency/models": fileURLToPath(
        new URL(
          "../../packages/modules/currency/src/models/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/currency/services": fileURLToPath(
        new URL(
          "../../packages/modules/currency/src/services/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/currency/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/currency/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/cloudflare-runtime": fileURLToPath(
        new URL(
          "../../packages/core/cloudflare-runtime/src/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/medusa/static/fetch-http-handler": fileURLToPath(
        new URL(
          "../../packages/medusa/src/static/fetch-http-handler.ts",
          import.meta.url
        )
      ),
      "@medusajs/medusa/static/http-manifest": fileURLToPath(
        new URL(
          "../../packages/medusa/src/static/http-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/medusa/static/http-proof-manifest": fileURLToPath(
        new URL(
          "../../packages/medusa/src/static/http-proof-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/customer/models": fileURLToPath(
        new URL(
          "../../packages/modules/customer/src/models/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/customer/services": fileURLToPath(
        new URL(
          "../../packages/modules/customer/src/services/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/customer/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/customer/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/core-flows/auth/workflows/generate-reset-password-token": fileURLToPath(
        new URL(
          "../../packages/core/core-flows/src/auth/workflows/generate-reset-password-token.ts",
          import.meta.url
        )
      ),
      "@medusajs/core-flows/customer/workflows/update-customers": fileURLToPath(
        new URL(
          "../../packages/core/core-flows/src/customer/workflows/update-customers.ts",
          import.meta.url
        )
      ),
      "@medusajs/core-flows/customer/workflows/create-addresses": fileURLToPath(
        new URL(
          "../../packages/core/core-flows/src/customer/workflows/create-addresses.ts",
          import.meta.url
        )
      ),
      "@medusajs/core-flows/customer/workflows/update-addresses": fileURLToPath(
        new URL(
          "../../packages/core/core-flows/src/customer/workflows/update-addresses.ts",
          import.meta.url
        )
      ),
      "@medusajs/core-flows/customer/workflows/delete-addresses": fileURLToPath(
        new URL(
          "../../packages/core/core-flows/src/customer/workflows/delete-addresses.ts",
          import.meta.url
        )
      ),
      "@medusajs/core-flows/user/workflows/update-users": fileURLToPath(
        new URL(
          "../../packages/core/core-flows/src/user/workflows/update-users.ts",
          import.meta.url
        )
      ),
      "@medusajs/core-flows/user/workflows/remove-user-account": fileURLToPath(
        new URL(
          "../../packages/core/core-flows/src/user/workflows/remove-user-account.ts",
          import.meta.url
        )
      ),
      "@medusajs/core-flows/user/workflows/assign-user-roles": fileURLToPath(
        new URL(
          "../../packages/core/core-flows/src/user/workflows/assign-user-roles.ts",
          import.meta.url
        )
      ),
      "@medusajs/core-flows/user/workflows/remove-user-roles": fileURLToPath(
        new URL(
          "../../packages/core/core-flows/src/user/workflows/remove-user-roles.ts",
          import.meta.url
        )
      ),
      "@medusajs/inventory/models": fileURLToPath(
        new URL(
          "../../packages/modules/inventory/src/models/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/inventory/services": fileURLToPath(
        new URL(
          "../../packages/modules/inventory/src/services/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/inventory/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/inventory/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/index/relation-query-proof-runner": fileURLToPath(
        new URL(
          "../../packages/modules/index/src/relation-query-proof-runner.ts",
          import.meta.url
        )
      ),
      "@medusajs/index/worker-composition": fileURLToPath(
        new URL(
          "../../packages/modules/index/src/worker-composition.ts",
          import.meta.url
        )
      ),
      "@medusajs/link-modules/index-worker-static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/link-modules/src/index-worker-static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/pricing/index-worker-static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/pricing/src/index-worker-static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/product/index-worker-static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/product/src/index-worker-static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/sales-channel/index-worker-static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/sales-channel/src/index-worker-static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/link-modules/definitions/product-variant-price-set":
        fileURLToPath(
          new URL(
            "../../packages/modules/link-modules/src/definitions/product-variant-price-set.ts",
            import.meta.url
          )
        ),
      "@medusajs/payment/models": fileURLToPath(
        new URL(
          "../../packages/modules/payment/src/models/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/payment/services": fileURLToPath(
        new URL(
          "../../packages/modules/payment/src/services/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/payment/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/payment/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/analytics/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/analytics/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/api-key/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/api-key/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/auth/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/auth/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/file/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/file/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/notification/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/notification/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/fulfillment/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/fulfillment/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/order/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/order/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/order/status": fileURLToPath(
        new URL("../../packages/core/utils/src/order/status.ts", import.meta.url)
      ),
      "@medusajs/utils/order/order-change-action": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/order/order-change-action.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/order/order-change": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/order/order-change.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/orchestration/types": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/orchestration/types.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/orchestration/symbol": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/orchestration/symbol.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/modules-sdk/decorators/inject-shared-context": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/modules-sdk/decorators/inject-shared-context.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/totals/shipping-method": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/totals/shipping-method/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/totals/promotion": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/totals/promotion/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/totals/transform-properties-to-bignumber": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/totals/transform-properties-to-bignumber.ts",
          import.meta.url
        )
      ),
      "@medusajs/product/models": fileURLToPath(
        new URL(
          "../../packages/modules/product/src/models/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/product/joiner-config": fileURLToPath(
        new URL(
          "../../packages/modules/product/src/joiner-config.ts",
          import.meta.url
        )
      ),
      "@medusajs/product/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/product/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/pricing/models": fileURLToPath(
        new URL(
          "../../packages/modules/pricing/src/models/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/pricing/joiner-config": fileURLToPath(
        new URL(
          "../../packages/modules/pricing/src/joiner-config.ts",
          import.meta.url
        )
      ),
      "@medusajs/pricing/services": fileURLToPath(
        new URL(
          "../../packages/modules/pricing/src/services/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/pricing/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/pricing/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/promotion/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/promotion/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/rbac/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/rbac/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/region/models": fileURLToPath(
        new URL("../../packages/modules/region/src/models/index.ts", import.meta.url)
      ),
      "@medusajs/region/services": fileURLToPath(
        new URL("../../packages/modules/region/src/services/index.ts", import.meta.url)
      ),
      "@medusajs/region/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/region/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/settings/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/settings/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/translation/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/translation/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/cart/models": fileURLToPath(
        new URL("../../packages/modules/cart/src/models/index.ts", import.meta.url)
      ),
      "@medusajs/cart/services": fileURLToPath(
        new URL("../../packages/modules/cart/src/services/index.ts", import.meta.url)
      ),
      "@medusajs/cart/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/cart/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/caching/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/caching/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/event-bus-cloudflare/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/event-bus-cloudflare/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/event-bus-cloudflare": fileURLToPath(
        new URL(
          "../../packages/modules/event-bus-cloudflare/src/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/workflow-engine-inmemory/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/workflow-engine-inmemory/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/workflow-engine-cloudflare/schedule-store": fileURLToPath(
        new URL(
          "../../packages/modules/providers/workflow-engine-cloudflare/src/schedule-store.ts",
          import.meta.url
        )
      ),
      "@medusajs/workflow-engine-cloudflare/execution-store": fileURLToPath(
        new URL(
          "../../packages/modules/providers/workflow-engine-cloudflare/src/execution-store.ts",
          import.meta.url
        )
      ),
      "@medusajs/workflow-engine-cloudflare/delayed-action-store": fileURLToPath(
        new URL(
          "../../packages/modules/providers/workflow-engine-cloudflare/src/delayed-action-store.ts",
          import.meta.url
        )
      ),
      "@medusajs/workflow-engine-cloudflare/scheduler-adapter": fileURLToPath(
        new URL(
          "../../packages/modules/providers/workflow-engine-cloudflare/src/scheduler-adapter.ts",
          import.meta.url
        )
      ),
      "@medusajs/locking/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/locking/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/locking-cloudflare/provider": fileURLToPath(
        new URL(
          "../../packages/modules/providers/locking-cloudflare/src/provider.ts",
          import.meta.url
        )
      ),
      "@medusajs/framework/orchestration": fileURLToPath(
        new URL(
          "../../packages/core/framework/src/orchestration/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/framework/workflows-sdk": fileURLToPath(
        new URL(
          "../../packages/core/framework/src/workflows-sdk/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/orchestration/transaction/errors": fileURLToPath(
        new URL(
          "../../packages/core/orchestration/src/transaction/errors.ts",
          import.meta.url
        )
      ),
      "@medusajs/orchestration/transaction": fileURLToPath(
        new URL(
          "../../packages/core/orchestration/src/transaction/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/orchestration/workflow/scheduler": fileURLToPath(
        new URL(
          "../../packages/core/orchestration/src/workflow/scheduler.ts",
          import.meta.url
        )
      ),
      "@medusajs/orchestration/workflow/local-workflow": fileURLToPath(
        new URL(
          "../../packages/core/orchestration/src/workflow/local-workflow.ts",
          import.meta.url
        )
      ),
      "@medusajs/orchestration/workflow/workflow-manager": fileURLToPath(
        new URL(
          "../../packages/core/orchestration/src/workflow/workflow-manager.ts",
          import.meta.url
        )
      ),
      "@medusajs/orchestration": fileURLToPath(
        new URL("../../packages/core/orchestration/src/index.ts", import.meta.url)
      ),
      "@medusajs/workflows-sdk/composer": fileURLToPath(
        new URL(
          "../../packages/core/workflows-sdk/src/utils/composer/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/workflows-sdk/helper/type": fileURLToPath(
        new URL(
          "../../packages/core/workflows-sdk/src/helper/type.ts",
          import.meta.url
        )
      ),
      "@medusajs/workflows-sdk/medusa-workflow": fileURLToPath(
        new URL(
          "../../packages/core/workflows-sdk/src/medusa-workflow.ts",
          import.meta.url
        )
      ),
      "@medusajs/workflows-sdk": fileURLToPath(
        new URL("../../packages/core/workflows-sdk/src/index.ts", import.meta.url)
      ),
      "@medusajs/store/models": fileURLToPath(
        new URL(
          "../../packages/modules/store/src/models/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/store/services": fileURLToPath(
        new URL(
          "../../packages/modules/store/src/services/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/store/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/store/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/sales-channel/models": fileURLToPath(
        new URL(
          "../../packages/modules/sales-channel/src/models/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/sales-channel/services": fileURLToPath(
        new URL(
          "../../packages/modules/sales-channel/src/services/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/sales-channel/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/sales-channel/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/stock-location/models": fileURLToPath(
        new URL(
          "../../packages/modules/stock-location/src/models/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/stock-location/services": fileURLToPath(
        new URL(
          "../../packages/modules/stock-location/src/services/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/stock-location/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/stock-location/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/tax/models": fileURLToPath(
        new URL(
          "../../packages/modules/tax/src/models/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/tax/services": fileURLToPath(
        new URL(
          "../../packages/modules/tax/src/services/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/tax/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/tax/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/user/static-manifest": fileURLToPath(
        new URL(
          "../../packages/modules/user/src/static-manifest.ts",
          import.meta.url
        )
      ),
      "@medusajs/dal": fileURLToPath(
        new URL("../../packages/core/dal/src/index.ts", import.meta.url)
      ),
      "@medusajs/dml": fileURLToPath(
        new URL("../../packages/core/dml/src/index.ts", import.meta.url)
      ),
      "@medusajs/drizzle/medusa": fileURLToPath(
        new URL(
          "../../packages/database/drizzle/src/medusa.ts",
          import.meta.url
        )
      ),
      "@medusajs/drizzle": fileURLToPath(
        new URL("../../packages/database/drizzle/src/index.ts", import.meta.url)
      ),
      "@medusajs/drizzle-cloudflare": fileURLToPath(
        new URL(
          "../../packages/database/drizzle-cloudflare/src/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/deps/awilix": awilixBrowser,
      "@medusajs/deps/zod": zodEsm,
      "@medusajs/framework/awilix": awilixBrowser,
      "@medusajs/framework/common/container": fileURLToPath(
        new URL(
          "../../packages/core/framework/src/common/container.ts",
          import.meta.url
        )
      ),
      "@medusajs/framework/modules-sdk": fileURLToPath(
        new URL("src/medusa-framework-modules-sdk.ts", import.meta.url)
      ),
      "@medusajs/framework/http/fetch": fileURLToPath(
        new URL(
          "../../packages/core/framework/src/http/fetch.ts",
          import.meta.url
        )
      ),
      "@medusajs/framework/http/static": fileURLToPath(
        new URL(
          "../../packages/core/framework/src/http/static.ts",
          import.meta.url
        )
      ),
      "@medusajs/framework/http": fileURLToPath(
        new URL(
          "../../packages/core/framework/src/http/portable.ts",
          import.meta.url
        )
      ),
      "@medusajs/framework/zod": fileURLToPath(
        new URL(
          "../../packages/core/framework/src/zod/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/framework/types": fileURLToPath(
        new URL("../../packages/core/types/src/index.ts", import.meta.url)
      ),
      "@medusajs/types": fileURLToPath(
        new URL("../../packages/core/types/src/index.ts", import.meta.url)
      ),
      "@medusajs/framework/utils/portable": fileURLToPath(
        new URL(
          "../../packages/core/framework/src/utils/portable.ts",
          import.meta.url
        )
      ),
      "@medusajs/framework/utils": fileURLToPath(
        new URL("src/medusa-framework-utils.ts", import.meta.url)
      ),
      "@medusajs/modules-sdk/static-module-loader": fileURLToPath(
        new URL(
          "../../packages/core/modules-sdk/src/loaders/static-module-loader.ts",
          import.meta.url
        )
      ),
      "@medusajs/modules-sdk/static-app": fileURLToPath(
        new URL(
          "../../packages/core/modules-sdk/src/static-app.ts",
          import.meta.url
        )
      ),
      "@medusajs/modules-sdk/medusa-module": fileURLToPath(
        new URL(
          "../../packages/core/modules-sdk/src/medusa-module.ts",
          import.meta.url
        )
      ),
      "@medusajs/modules-sdk/definitions": fileURLToPath(
        new URL(
          "../../packages/core/modules-sdk/src/definitions.ts",
          import.meta.url
        )
      ),
      "@mikro-orm/postgresql": fileURLToPath(
        new URL("src/raw-filter-shim.ts", import.meta.url)
      ),
      "@medusajs/utils/common/container": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/container.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/create-portable-id": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/create-portable-id.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/array-difference": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/array-difference.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/build-query": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/build-query.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/payment/abstract-payment-provider": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/payment/abstract-payment-provider.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/payment/payment-collection": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/payment/payment-collection.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/payment/payment-session": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/payment/payment-session.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/payment/webhook": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/payment/webhook.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/api-key/api-key-type": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/api-key/api-key-type.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/deduplicate": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/deduplicate.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/deep-copy": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/deep-copy.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/deep-equal-obj": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/deep-equal-obj.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/normalize-locale": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/normalize-locale.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/to-snake-case": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/to-snake-case.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/dynamic-import": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/dynamic-import.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/define-file-config": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/define-file-config.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/get-caller-file-path": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/get-caller-file-path.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/get-selects-and-relations-from-object-array":
        fileURLToPath(
          new URL(
            "../../packages/core/utils/src/common/get-selects-and-relations-from-object-array.ts",
            import.meta.url
          )
        ),
      "@medusajs/utils/common/errors": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/errors.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/generate-entity-id": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/generate-entity-id.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/flatten-object-to-key-value-pairs": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/flatten-object-to-key-value-pairs.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/get-duplicates": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/get-duplicates.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/get-set-difference": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/get-set-difference.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/get-iso-string-from-date": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/get-iso-string-from-date.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/group-by": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/group-by.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/is-defined": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/is-defined.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/is-date": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/is-date.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/is-error-like": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/is-error-like.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/is-object": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/is-object.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/is-present": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/is-present.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/is-string": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/is-string.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/partition-array": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/partition-array.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/pick-value-from-object": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/pick-value-from-object.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/pick-deep": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/pick-deep.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/medusa-container": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/medusa-container.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/parse-stringify-if-necessary": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/parse-stringify-if-necessary.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/remote-query-object-from-string": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/remote-query-object-from-string.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/promise-all": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/promise-all.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/remove-undefined-properties": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/remove-undefined-properties.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/remove-undefined": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/remove-undefined.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/remove-nullisih": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/remove-nullisih.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/to-handle": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/to-handle.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/to-kebab-case": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/to-kebab-case.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/to-camel-case": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/to-camel-case.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/simple-hash": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/simple-hash.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/serialize-error": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/serialize-error.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/stringify-circular": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/stringify-circular.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/string-to-select-relation-object": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/string-to-select-relation-object.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/trim-zeros": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/trim-zeros.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/upper-case-first": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/upper-case-first.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/validate-handle": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/validate-handle.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/rules": fileURLToPath(
        new URL("../../packages/core/utils/src/common/rules.ts", import.meta.url)
      ),
      "@medusajs/utils/defaults/countries": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/defaults/countries.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/defaults/currencies": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/defaults/currencies.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/dml/model": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/dml/entity-builder.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/link/links": fileURLToPath(
        new URL("../../packages/core/utils/src/link/links.ts", import.meta.url)
      ),
      "@medusajs/utils/dml/entity": fileURLToPath(
        new URL("../../packages/core/utils/src/dml/entity.ts", import.meta.url)
      ),
      "@medusajs/utils/event-bus/common-events": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/event-bus/common-events.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/core-flows/events": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/core-flows/events.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/event-bus/message-aggregator": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/event-bus/message-aggregator.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/event-bus/utils": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/event-bus/utils.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/fulfillment/events": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/fulfillment/events.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/fulfillment/geo-zone": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/fulfillment/geo-zone.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/fulfillment/shipping-options": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/fulfillment/shipping-options.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/graphql/clean-graphql": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/graphql/clean-graphql.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/graphql/get-fields-and-relations": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/graphql/get-fields-and-relations.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/user/events": fileURLToPath(
        new URL("../../packages/core/utils/src/user/events.ts", import.meta.url)
      ),
      "@medusajs/utils/notification/common": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/notification/common.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/lower-case-first": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/lower-case-first.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/modules-sdk/container-loader": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/modules-sdk/loaders/container-loader-factory.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/feature-flags/flag-router": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/feature-flags/flag-router.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/modules-sdk/define-policies": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/modules-sdk/define-policies.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/modules-sdk/definition": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/modules-sdk/definition.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/modules-sdk/decorators/context-parameter":
        fileURLToPath(
          new URL(
            "../../packages/core/utils/src/modules-sdk/decorators/context-parameter.ts",
            import.meta.url
          )
        ),
      "@medusajs/utils/modules-sdk/policy-registry": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/modules-sdk/policy-registry.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/modules-sdk/decorators/emit-events": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/modules-sdk/decorators/emit-events.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/modules-sdk/decorators/inject-manager": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/modules-sdk/decorators/inject-manager.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/modules-sdk/decorators/inject-transaction-manager":
        fileURLToPath(
          new URL(
            "../../packages/core/utils/src/modules-sdk/decorators/inject-transaction-manager.ts",
            import.meta.url
          )
        ),
      "@medusajs/utils/modules-sdk/event-builder-factory": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/modules-sdk/event-builder-factory.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/modules-sdk/medusa-service": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/modules-sdk/medusa-service.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/modules-sdk/module-types": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/modules-sdk/module-types.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/modules-sdk/module-provider-registration-key":
        fileURLToPath(
          new URL(
            "../../packages/core/utils/src/modules-sdk/module-provider-registration-key.ts",
            import.meta.url
          )
        ),
      "@medusajs/utils/modules-sdk/portable-joiner-config-builder":
        fileURLToPath(
          new URL(
            "../../packages/core/utils/src/modules-sdk/portable-joiner-config-builder.ts",
            import.meta.url
          )
        ),
      "@medusajs/utils/modules-sdk/portable": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/modules-sdk/portable.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/modules-sdk/query-context": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/modules-sdk/query-context.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/product/enums": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/product/enums.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/product/get-variant-availability": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/product/get-variant-availability.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/product/events": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/product/events.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/pricing/enums": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/pricing/enums.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/pricing/price-list": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/pricing/price-list.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/totals/tax": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/totals/tax/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/translations/apply-translations-to-tax-lines":
        fileURLToPath(
          new URL(
            "../../packages/core/utils/src/translations/apply-translations-to-tax-lines.ts",
            import.meta.url
          )
        ),
      "@medusajs/utils/promotion": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/promotion/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/totals/big-number": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/totals/big-number.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/totals/math": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/totals/math.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/totals/cart": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/totals/cart/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/totals/create-raw-properties-from-bignumber":
        fileURLToPath(
          new URL(
            "../../packages/core/utils/src/totals/create-raw-properties-from-bignumber.ts",
            import.meta.url
          )
        ),
      awilix: awilixBrowser,
    },
  },
} satisfies UserConfig

export default defineConfig({
  plugins: [cloudflare()],
  ...medusaCloudflareSharedViteConfig,
})
