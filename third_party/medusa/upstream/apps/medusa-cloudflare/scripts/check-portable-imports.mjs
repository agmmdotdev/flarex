import { build } from "esbuild"
import { builtinModules } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(appDirectory, "../../..")

const aliases = {
  "@models": path.join(
    rootDirectory,
    "packages/modules/currency/src/models/index.ts"
  ),
  "@services": path.join(
    rootDirectory,
    "packages/modules/currency/src/services/index.ts"
  ),
  "@medusajs/currency/models": path.join(
    rootDirectory,
    "packages/modules/currency/src/models/index.ts"
  ),
  "@medusajs/currency/services": path.join(
    rootDirectory,
    "packages/modules/currency/src/services/index.ts"
  ),
  "@medusajs/currency/static-manifest": path.join(
    rootDirectory,
    "packages/modules/currency/src/static-manifest.ts"
  ),
  "@medusajs/customer/models": path.join(
    rootDirectory,
    "packages/modules/customer/src/models/index.ts"
  ),
  "@medusajs/customer/services": path.join(
    rootDirectory,
    "packages/modules/customer/src/services/index.ts"
  ),
  "@medusajs/customer/static-manifest": path.join(
    rootDirectory,
    "packages/modules/customer/src/static-manifest.ts"
  ),
  "@medusajs/index/relation-query-proof-runner": path.join(
    rootDirectory,
    "packages/modules/index/src/relation-query-proof-runner.ts"
  ),
  "@medusajs/index/worker-composition": path.join(
    rootDirectory,
    "packages/modules/index/src/worker-composition.ts"
  ),
  "@medusajs/link-modules/index-worker-static-manifest": path.join(
    rootDirectory,
    "packages/modules/link-modules/src/index-worker-static-manifest.ts"
  ),
  "@medusajs/pricing/index-worker-static-manifest": path.join(
    rootDirectory,
    "packages/modules/pricing/src/index-worker-static-manifest.ts"
  ),
  "@medusajs/product/index-worker-static-manifest": path.join(
    rootDirectory,
    "packages/modules/product/src/index-worker-static-manifest.ts"
  ),
  "@medusajs/sales-channel/index-worker-static-manifest": path.join(
    rootDirectory,
    "packages/modules/sales-channel/src/index-worker-static-manifest.ts"
  ),
  "@medusajs/core-flows/auth/workflows/generate-reset-password-token": path.join(
    rootDirectory,
    "packages/core/core-flows/src/auth/workflows/generate-reset-password-token.ts"
  ),
  "@medusajs/core-flows/user/workflows/remove-user-account": path.join(
    rootDirectory,
    "packages/core/core-flows/src/user/workflows/remove-user-account.ts"
  ),
  "@medusajs/core-flows/user/workflows/assign-user-roles": path.join(
    rootDirectory,
    "packages/core/core-flows/src/user/workflows/assign-user-roles.ts"
  ),
  "@medusajs/core-flows/user/workflows/remove-user-roles": path.join(
    rootDirectory,
    "packages/core/core-flows/src/user/workflows/remove-user-roles.ts"
  ),
  "@medusajs/payment/models": path.join(
    rootDirectory,
    "packages/modules/payment/src/models/index.ts"
  ),
  "@medusajs/payment/services": path.join(
    rootDirectory,
    "packages/modules/payment/src/services/index.ts"
  ),
  "@medusajs/payment/static-manifest": path.join(
    rootDirectory,
    "packages/modules/payment/src/static-manifest.ts"
  ),
  "@medusajs/analytics/static-manifest": path.join(
    rootDirectory,
    "packages/modules/analytics/src/static-manifest.ts"
  ),
  "@medusajs/api-key/static-manifest": path.join(
    rootDirectory,
    "packages/modules/api-key/src/static-manifest.ts"
  ),
  "@medusajs/auth/static-manifest": path.join(
    rootDirectory,
    "packages/modules/auth/src/static-manifest.ts"
  ),
  "@medusajs/file/static-manifest": path.join(
    rootDirectory,
    "packages/modules/file/src/static-manifest.ts"
  ),
  "@medusajs/notification/static-manifest": path.join(
    rootDirectory,
    "packages/modules/notification/src/static-manifest.ts"
  ),
  "@medusajs/fulfillment/static-manifest": path.join(
    rootDirectory,
    "packages/modules/fulfillment/src/static-manifest.ts"
  ),
  "@medusajs/order/static-manifest": path.join(
    rootDirectory,
    "packages/modules/order/src/static-manifest.ts"
  ),
  "@medusajs/product/models": path.join(
    rootDirectory,
    "packages/modules/product/src/models/index.ts"
  ),
  "@medusajs/product/static-manifest": path.join(
    rootDirectory,
    "packages/modules/product/src/static-manifest.ts"
  ),
  "@medusajs/promotion/static-manifest": path.join(
    rootDirectory,
    "packages/modules/promotion/src/static-manifest.ts"
  ),
  "@medusajs/rbac/static-manifest": path.join(
    rootDirectory,
    "packages/modules/rbac/src/static-manifest.ts"
  ),
  "@medusajs/region/models": path.join(
    rootDirectory,
    "packages/modules/region/src/models/index.ts"
  ),
  "@medusajs/region/services": path.join(
    rootDirectory,
    "packages/modules/region/src/services/index.ts"
  ),
  "@medusajs/region/static-manifest": path.join(
    rootDirectory,
    "packages/modules/region/src/static-manifest.ts"
  ),
  "@medusajs/settings/static-manifest": path.join(
    rootDirectory,
    "packages/modules/settings/src/static-manifest.ts"
  ),
  "@medusajs/translation/static-manifest": path.join(
    rootDirectory,
    "packages/modules/translation/src/static-manifest.ts"
  ),
  "@medusajs/cart/models": path.join(
    rootDirectory,
    "packages/modules/cart/src/models/index.ts"
  ),
  "@medusajs/cart/services": path.join(
    rootDirectory,
    "packages/modules/cart/src/services/index.ts"
  ),
  "@medusajs/cart/static-manifest": path.join(
    rootDirectory,
    "packages/modules/cart/src/static-manifest.ts"
  ),
  "@medusajs/caching/static-manifest": path.join(
    rootDirectory,
    "packages/modules/caching/src/static-manifest.ts"
  ),
  "@medusajs/event-bus-cloudflare": path.join(
    rootDirectory,
    "packages/modules/event-bus-cloudflare/src/index.ts"
  ),
  "@medusajs/event-bus-cloudflare/static-manifest": path.join(
    rootDirectory,
    "packages/modules/event-bus-cloudflare/src/static-manifest.ts"
  ),
  "@medusajs/workflow-engine-inmemory/static-manifest": path.join(
    rootDirectory,
    "packages/modules/workflow-engine-inmemory/src/static-manifest.ts"
  ),
  "@medusajs/locking/static-manifest": path.join(
    rootDirectory,
    "packages/modules/locking/src/static-manifest.ts"
  ),
  "@medusajs/locking-cloudflare/provider": path.join(
    rootDirectory,
    "packages/modules/providers/locking-cloudflare/src/provider.ts"
  ),
  "@medusajs/stock-location/models": path.join(
    rootDirectory,
    "packages/modules/stock-location/src/models/index.ts"
  ),
  "@medusajs/stock-location/services": path.join(
    rootDirectory,
    "packages/modules/stock-location/src/services/index.ts"
  ),
  "@medusajs/stock-location/static-manifest": path.join(
    rootDirectory,
    "packages/modules/stock-location/src/static-manifest.ts"
  ),
  "@medusajs/user/static-manifest": path.join(
    rootDirectory,
    "packages/modules/user/src/static-manifest.ts"
  ),
  "@medusajs/dal": path.join(rootDirectory, "packages/core/dal/src/index.ts"),
  "@medusajs/dml": path.join(rootDirectory, "packages/core/dml/src/index.ts"),
  "@medusajs/drizzle/medusa": path.join(
    rootDirectory,
    "packages/database/drizzle/src/medusa.ts"
  ),
  "@medusajs/framework/types": path.join(
    rootDirectory,
    "packages/core/types/src/index.ts"
  ),
  "@medusajs/types": path.join(rootDirectory, "packages/core/types/src/index.ts"),
  "@medusajs/medusa/static/http-manifest": path.join(
    rootDirectory,
    "packages/medusa/src/static/http-manifest.ts"
  ),
  "@medusajs/medusa/static/fetch-http-handler": path.join(
    rootDirectory,
    "packages/medusa/src/static/fetch-http-handler.ts"
  ),
  "@medusajs/medusa/static/http-proof-manifest": path.join(
    rootDirectory,
    "packages/medusa/src/static/http-proof-manifest.ts"
  ),
  "@medusajs/framework/utils": path.join(
    rootDirectory,
    "apps/medusa-cloudflare/src/medusa-framework-utils.ts"
  ),
  "@medusajs/framework/common/container": path.join(
    rootDirectory,
    "packages/core/framework/src/common/container.ts"
  ),
  "@medusajs/framework/modules-sdk": path.join(
    rootDirectory,
    "apps/medusa-cloudflare/src/medusa-framework-modules-sdk.ts"
  ),
  "@medusajs/framework/http": path.join(
    rootDirectory,
    "packages/core/framework/src/http/portable.ts"
  ),
  "@medusajs/framework/http/fetch": path.join(
    rootDirectory,
    "packages/core/framework/src/http/fetch.ts"
  ),
  "@medusajs/framework/http/static": path.join(
    rootDirectory,
    "packages/core/framework/src/http/static.ts"
  ),
  "@medusajs/framework/zod": path.join(
    rootDirectory,
    "packages/core/framework/src/zod/index.ts"
  ),
  "@medusajs/framework/orchestration": path.join(
    rootDirectory,
    "packages/core/framework/src/orchestration/index.ts"
  ),
  "@medusajs/framework/workflows-sdk": path.join(
    rootDirectory,
    "packages/core/framework/src/workflows-sdk/index.ts"
  ),
  "@medusajs/orchestration": path.join(
    rootDirectory,
    "packages/core/orchestration/src/index.ts"
  ),
  "@medusajs/orchestration/transaction": path.join(
    rootDirectory,
    "packages/core/orchestration/src/transaction/index.ts"
  ),
  "@medusajs/orchestration/transaction/errors": path.join(
    rootDirectory,
    "packages/core/orchestration/src/transaction/errors.ts"
  ),
  "@medusajs/orchestration/workflow/scheduler": path.join(
    rootDirectory,
    "packages/core/orchestration/src/workflow/scheduler.ts"
  ),
  "@medusajs/orchestration/workflow/local-workflow": path.join(
    rootDirectory,
    "packages/core/orchestration/src/workflow/local-workflow.ts"
  ),
  "@medusajs/orchestration/workflow/workflow-manager": path.join(
    rootDirectory,
    "packages/core/orchestration/src/workflow/workflow-manager.ts"
  ),
  "@medusajs/workflows-sdk/composer": path.join(
    rootDirectory,
    "packages/core/workflows-sdk/src/utils/composer/index.ts"
  ),
  "@medusajs/workflows-sdk/helper/type": path.join(
    rootDirectory,
    "packages/core/workflows-sdk/src/helper/type.ts"
  ),
  "@medusajs/workflows-sdk/medusa-workflow": path.join(
    rootDirectory,
    "packages/core/workflows-sdk/src/medusa-workflow.ts"
  ),
  "@medusajs/workflows-sdk": path.join(
    rootDirectory,
    "packages/core/workflows-sdk/src/index.ts"
  ),
  "@medusajs/modules-sdk/static-module-loader": path.join(
    rootDirectory,
    "packages/core/modules-sdk/src/loaders/static-module-loader.ts"
  ),
  "@medusajs/modules-sdk/medusa-module": path.join(
    rootDirectory,
    "packages/core/modules-sdk/src/medusa-module.ts"
  ),
  "@medusajs/modules-sdk/definitions": path.join(
    rootDirectory,
    "packages/core/modules-sdk/src/definitions.ts"
  ),
  "@mikro-orm/postgresql": path.join(
    rootDirectory,
    "apps/medusa-cloudflare/src/raw-filter-shim.ts"
  ),
  "@medusajs/deps/awilix": path.join(
    rootDirectory,
    "node_modules/awilix/lib/awilix.browser.js"
  ),
  "@medusajs/deps/zod": path.join(rootDirectory, "node_modules/zod/index.js"),
  "@medusajs/framework/awilix": path.join(
    rootDirectory,
    "node_modules/awilix/lib/awilix.browser.js"
  ),
  "@medusajs/utils/common/container": path.join(
    rootDirectory,
    "packages/core/utils/src/common/container.ts"
  ),
  "@medusajs/utils/common/create-portable-id": path.join(
    rootDirectory,
    "packages/core/utils/src/common/create-portable-id.ts"
  ),
  "@medusajs/utils/common/get-caller-file-path": path.join(
    rootDirectory,
    "packages/core/utils/src/common/get-caller-file-path.ts"
  ),
  "@medusajs/utils/common/get-selects-and-relations-from-object-array": path.join(
    rootDirectory,
    "packages/core/utils/src/common/get-selects-and-relations-from-object-array.ts"
  ),
  "@medusajs/utils/common/array-difference": path.join(
    rootDirectory,
    "packages/core/utils/src/common/array-difference.ts"
  ),
  "@medusajs/utils/common/build-query": path.join(
    rootDirectory,
    "packages/core/utils/src/common/build-query.ts"
  ),
  "@medusajs/utils/payment/abstract-payment-provider": path.join(
    rootDirectory,
    "packages/core/utils/src/payment/abstract-payment-provider.ts"
  ),
  "@medusajs/utils/payment/payment-collection": path.join(
    rootDirectory,
    "packages/core/utils/src/payment/payment-collection.ts"
  ),
  "@medusajs/utils/payment/payment-session": path.join(
    rootDirectory,
    "packages/core/utils/src/payment/payment-session.ts"
  ),
  "@medusajs/utils/payment/webhook": path.join(
    rootDirectory,
    "packages/core/utils/src/payment/webhook.ts"
  ),
  "@medusajs/utils/api-key/api-key-type": path.join(
    rootDirectory,
    "packages/core/utils/src/api-key/api-key-type.ts"
  ),
  "@medusajs/utils/order/status": path.join(
    rootDirectory,
    "packages/core/utils/src/order/status.ts"
  ),
  "@medusajs/utils/order/order-change-action": path.join(
    rootDirectory,
    "packages/core/utils/src/order/order-change-action.ts"
  ),
  "@medusajs/utils/order/order-change": path.join(
    rootDirectory,
    "packages/core/utils/src/order/order-change.ts"
  ),
  "@medusajs/utils/orchestration/types": path.join(
    rootDirectory,
    "packages/core/utils/src/orchestration/types.ts"
  ),
  "@medusajs/utils/orchestration/symbol": path.join(
    rootDirectory,
    "packages/core/utils/src/orchestration/symbol.ts"
  ),
  "@medusajs/utils/modules-sdk/decorators/inject-shared-context": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/decorators/inject-shared-context.ts"
  ),
  "@medusajs/utils/totals/shipping-method": path.join(
    rootDirectory,
    "packages/core/utils/src/totals/shipping-method/index.ts"
  ),
  "@medusajs/utils/totals/promotion": path.join(
    rootDirectory,
    "packages/core/utils/src/totals/promotion/index.ts"
  ),
  "@medusajs/utils/totals/transform-properties-to-bignumber": path.join(
    rootDirectory,
    "packages/core/utils/src/totals/transform-properties-to-bignumber.ts"
  ),
  "@medusajs/utils/common/deduplicate": path.join(
    rootDirectory,
    "packages/core/utils/src/common/deduplicate.ts"
  ),
  "@medusajs/utils/common/pick-deep": path.join(
    rootDirectory,
    "packages/core/utils/src/common/pick-deep.ts"
  ),
  "@medusajs/utils/common/deep-copy": path.join(
    rootDirectory,
    "packages/core/utils/src/common/deep-copy.ts"
  ),
  "@medusajs/utils/common/deep-equal-obj": path.join(
    rootDirectory,
    "packages/core/utils/src/common/deep-equal-obj.ts"
  ),
  "@medusajs/utils/common/normalize-locale": path.join(
    rootDirectory,
    "packages/core/utils/src/common/normalize-locale.ts"
  ),
  "@medusajs/utils/common/to-snake-case": path.join(
    rootDirectory,
    "packages/core/utils/src/common/to-snake-case.ts"
  ),
  "@medusajs/utils/common/dynamic-import": path.join(
    rootDirectory,
    "packages/core/utils/src/common/dynamic-import.ts"
  ),
  "@medusajs/utils/common/errors": path.join(
    rootDirectory,
    "packages/core/utils/src/common/errors.ts"
  ),
  "@medusajs/utils/common/generate-entity-id": path.join(
    rootDirectory,
    "packages/core/utils/src/common/generate-entity-id.ts"
  ),
  "@medusajs/utils/common/flatten-object-to-key-value-pairs": path.join(
    rootDirectory,
    "packages/core/utils/src/common/flatten-object-to-key-value-pairs.ts"
  ),
  "@medusajs/utils/common/get-set-difference": path.join(
    rootDirectory,
    "packages/core/utils/src/common/get-set-difference.ts"
  ),
  "@medusajs/utils/common/is-defined": path.join(
    rootDirectory,
    "packages/core/utils/src/common/is-defined.ts"
  ),
  "@medusajs/utils/common/is-error-like": path.join(
    rootDirectory,
    "packages/core/utils/src/common/is-error-like.ts"
  ),
  "@medusajs/utils/common/is-object": path.join(
    rootDirectory,
    "packages/core/utils/src/common/is-object.ts"
  ),
  "@medusajs/utils/common/is-present": path.join(
    rootDirectory,
    "packages/core/utils/src/common/is-present.ts"
  ),
  "@medusajs/utils/common/is-string": path.join(
    rootDirectory,
    "packages/core/utils/src/common/is-string.ts"
  ),
  "@medusajs/utils/common/medusa-container": path.join(
    rootDirectory,
    "packages/core/utils/src/common/medusa-container.ts"
  ),
  "@medusajs/utils/common/parse-stringify-if-necessary": path.join(
    rootDirectory,
    "packages/core/utils/src/common/parse-stringify-if-necessary.ts"
  ),
  "@medusajs/utils/common/remote-query-object-from-string": path.join(
    rootDirectory,
    "packages/core/utils/src/common/remote-query-object-from-string.ts"
  ),
  "@medusajs/utils/common/promise-all": path.join(
    rootDirectory,
    "packages/core/utils/src/common/promise-all.ts"
  ),
  "@medusajs/utils/common/remove-undefined-properties": path.join(
    rootDirectory,
    "packages/core/utils/src/common/remove-undefined-properties.ts"
  ),
  "@medusajs/utils/common/partition-array": path.join(
    rootDirectory,
    "packages/core/utils/src/common/partition-array.ts"
  ),
  "@medusajs/utils/common/pick-value-from-object": path.join(
    rootDirectory,
    "packages/core/utils/src/common/pick-value-from-object.ts"
  ),
  "@medusajs/utils/common/simple-hash": path.join(
    rootDirectory,
    "packages/core/utils/src/common/simple-hash.ts"
  ),
  "@medusajs/utils/common/serialize-error": path.join(
    rootDirectory,
    "packages/core/utils/src/common/serialize-error.ts"
  ),
  "@medusajs/utils/common/to-handle": path.join(
    rootDirectory,
    "packages/core/utils/src/common/to-handle.ts"
  ),
  "@medusajs/utils/common/to-kebab-case": path.join(
    rootDirectory,
    "packages/core/utils/src/common/to-kebab-case.ts"
  ),
  "@medusajs/utils/common/to-camel-case": path.join(
    rootDirectory,
    "packages/core/utils/src/common/to-camel-case.ts"
  ),
  "@medusajs/utils/common/stringify-circular": path.join(
    rootDirectory,
    "packages/core/utils/src/common/stringify-circular.ts"
  ),
  "@medusajs/utils/common/string-to-select-relation-object": path.join(
    rootDirectory,
    "packages/core/utils/src/common/string-to-select-relation-object.ts"
  ),
  "@medusajs/utils/common/upper-case-first": path.join(
    rootDirectory,
    "packages/core/utils/src/common/upper-case-first.ts"
  ),
  "@medusajs/utils/common/validate-handle": path.join(
    rootDirectory,
    "packages/core/utils/src/common/validate-handle.ts"
  ),
  "@medusajs/utils/common/rules": path.join(
    rootDirectory,
    "packages/core/utils/src/common/rules.ts"
  ),
  "@medusajs/utils/defaults/countries": path.join(
    rootDirectory,
    "packages/core/utils/src/defaults/countries.ts"
  ),
  "@medusajs/utils/dml/model": path.join(
    rootDirectory,
    "packages/core/utils/src/dml/entity-builder.ts"
  ),
  "@medusajs/utils/dml/entity": path.join(
    rootDirectory,
    "packages/core/utils/src/dml/entity.ts"
  ),
  "@medusajs/utils/event-bus/common-events": path.join(
    rootDirectory,
    "packages/core/utils/src/event-bus/common-events.ts"
  ),
  "@medusajs/utils/core-flows/events": path.join(
    rootDirectory,
    "packages/core/utils/src/core-flows/events.ts"
  ),
  "@medusajs/utils/event-bus/message-aggregator": path.join(
    rootDirectory,
    "packages/core/utils/src/event-bus/message-aggregator.ts"
  ),
  "@medusajs/utils/event-bus/utils": path.join(
    rootDirectory,
    "packages/core/utils/src/event-bus/utils.ts"
  ),
  "@medusajs/utils/fulfillment/events": path.join(
    rootDirectory,
    "packages/core/utils/src/fulfillment/events.ts"
  ),
  "@medusajs/utils/fulfillment/geo-zone": path.join(
    rootDirectory,
    "packages/core/utils/src/fulfillment/geo-zone.ts"
  ),
  "@medusajs/utils/fulfillment/shipping-options": path.join(
    rootDirectory,
    "packages/core/utils/src/fulfillment/shipping-options.ts"
  ),
  "@medusajs/utils/graphql/clean-graphql": path.join(
    rootDirectory,
    "packages/core/utils/src/graphql/clean-graphql.ts"
  ),
  "@medusajs/utils/graphql/get-fields-and-relations": path.join(
    rootDirectory,
    "packages/core/utils/src/graphql/get-fields-and-relations.ts"
  ),
  "@medusajs/utils/user/events": path.join(
    rootDirectory,
    "packages/core/utils/src/user/events.ts"
  ),
  "@medusajs/utils/notification/common": path.join(
    rootDirectory,
    "packages/core/utils/src/notification/common.ts"
  ),
  "@medusajs/utils/common/lower-case-first": path.join(
    rootDirectory,
    "packages/core/utils/src/common/lower-case-first.ts"
  ),
  "@medusajs/utils/totals/cart": path.join(
    rootDirectory,
    "packages/core/utils/src/totals/cart/index.ts"
  ),
  "@medusajs/utils/totals/create-raw-properties-from-bignumber": path.join(
    rootDirectory,
    "packages/core/utils/src/totals/create-raw-properties-from-bignumber.ts"
  ),
  "@medusajs/utils/modules-sdk/container-loader": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/loaders/container-loader-factory.ts"
  ),
  "@medusajs/utils/feature-flags/flag-router": path.join(
    rootDirectory,
    "packages/core/utils/src/feature-flags/flag-router.ts"
  ),
  "@medusajs/utils/modules-sdk/define-policies": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/define-policies.ts"
  ),
  "@medusajs/utils/modules-sdk/definition": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/definition.ts"
  ),
  "@medusajs/utils/modules-sdk/decorators/context-parameter": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/decorators/context-parameter.ts"
  ),
  "@medusajs/utils/modules-sdk/policy-registry": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/policy-registry.ts"
  ),
  "@medusajs/utils/modules-sdk/decorators/emit-events": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/decorators/emit-events.ts"
  ),
  "@medusajs/utils/modules-sdk/decorators/inject-manager": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/decorators/inject-manager.ts"
  ),
  "@medusajs/utils/modules-sdk/decorators/inject-transaction-manager": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/decorators/inject-transaction-manager.ts"
  ),
  "@medusajs/utils/modules-sdk/event-builder-factory": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/event-builder-factory.ts"
  ),
  "@medusajs/utils/modules-sdk/medusa-service": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/medusa-service.ts"
  ),
  "@medusajs/utils/modules-sdk/module-types": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/module-types.ts"
  ),
  "@medusajs/utils/modules-sdk/module-provider-registration-key": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/module-provider-registration-key.ts"
  ),
  "@medusajs/utils/modules-sdk/module-types": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/module-types.ts"
  ),
  "@medusajs/utils/modules-sdk/portable-joiner-config-builder": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/portable-joiner-config-builder.ts"
  ),
  "@medusajs/utils/modules-sdk/portable": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/portable.ts"
  ),
  "@medusajs/utils/modules-sdk/query-context": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/query-context.ts"
  ),
  "@medusajs/utils/product/enums": path.join(
    rootDirectory,
    "packages/core/utils/src/product/enums.ts"
  ),
  "@medusajs/utils/product/get-variant-availability": path.join(
    rootDirectory,
    "packages/core/utils/src/product/get-variant-availability.ts"
  ),
  "@medusajs/utils/product/events": path.join(
    rootDirectory,
    "packages/core/utils/src/product/events.ts"
  ),
  "@medusajs/utils/totals/tax": path.join(
    rootDirectory,
    "packages/core/utils/src/totals/tax/index.ts"
  ),
  "@medusajs/utils/translations/apply-translations-to-tax-lines": path.join(
    rootDirectory,
    "packages/core/utils/src/translations/apply-translations-to-tax-lines.ts"
  ),
  "@medusajs/utils/promotion": path.join(
    rootDirectory,
    "packages/core/utils/src/promotion/index.ts"
  ),
  awilix: path.join(rootDirectory, "node_modules/awilix/lib/awilix.browser.js"),
}

const nodeSpecifiers = new Set([
  ...builtinModules,
  ...builtinModules.map((specifier) => `node:${specifier}`),
])
const optionalNodeSpecifiers = new Set([
  "better-sqlite3",
  "libsql",
  "mariadb/callback",
])

const result = await build({
  entryPoints: [
    path.join(rootDirectory, "apps/medusa-cloudflare/src/worker.ts"),
  ],
  bundle: true,
  format: "esm",
  metafile: true,
  platform: "browser",
  conditions: ["browser"],
  mainFields: ["browser", "module", "main"],
  write: false,
  plugins: [
    {
      name: "workspace-aliases",
      setup(buildApi) {
        buildApi.onResolve({ filter: /.*/ }, (args) => {
          if (
            nodeSpecifiers.has(args.path) ||
            optionalNodeSpecifiers.has(args.path)
          ) {
            return {
              path: args.path,
              external: true,
            }
          }
        })

        for (const [specifier, target] of Object.entries(aliases)) {
          buildApi.onResolve(
            { filter: new RegExp(`^${escapeRegExp(specifier)}$`) },
            () => ({
              path: target,
            })
          )
        }
      },
    },
  ],
})

if (process.env.MEDUSA_CF_PRINT_SUSPECT_INPUTS === "1") {
  const suspectInputs = Object.keys(result.metafile.inputs)
    .filter((input) =>
      /(^|[/\\])node_modules[/\\]|[/\\]dist[/\\].*\.js$/i.test(input)
    )
    .sort()

  console.log(
    suspectInputs
      .map((input) => `suspect-input: ${input}`)
      .join("\n")
  )
}

const forbidden = [
  /(^|[/\\])express([/\\]|$)/,
  /mikro-orm/i,
  /(^|[/\\])pg([/\\]|$)/,
  /postgres/i,
  /packages[/\\]core[/\\]utils[/\\]src[/\\](migrations|dal[/\\]mikro-orm|modules-sdk[/\\](loaders[/\\](load-models|mikro-orm)|migration-scripts))/i,
  /packages[/\\]core[/\\]utils[/\\]src[/\\]modules-sdk[/\\]joiner-config-builder\.ts$/i,
]

const violations = [
  ...Object.keys(result.metafile.inputs).filter((input) =>
    forbidden.some((pattern) => pattern.test(input))
  ),
  ...Object.values(result.metafile.outputs).flatMap((output) =>
    output.imports
      .filter((entry) => entry.external && nodeSpecifiers.has(entry.path))
      .map((entry) => `external:${entry.path}`)
  ),
]
const entryPoint = Object.values(result.metafile.outputs).find(
  (output) => output.entryPoint
)?.entryPoint
const boundaryPaths = [
  /packages[/\\]core[/\\]utils[/\\]src[/\\]common[/\\]index\.ts/i,
  /packages[/\\]core[/\\]utils[/\\]src[/\\]modules-sdk[/\\]index\.ts/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]types[/\\]container\.ts/i,
  /node_modules[/\\]ulid[/\\]dist[/\\]index\.esm\.js/i,
].flatMap((pattern) => {
  const importPath = findShortestImportPath(entryPoint, pattern)
  return importPath ? [importPath] : []
})

if (violations.length) {
  const firstPartyBlockerEdges = Object.entries(result.metafile.inputs).flatMap(
    ([input, metadata]) =>
      input.includes("packages/")
        ? metadata.imports
            .filter((entry) =>
              forbidden.some((pattern) => pattern.test(entry.path))
            )
            .map((entry) => `${input} -> ${entry.path}`)
        : []
  )
  const broadFirstPartyEdges = Object.entries(result.metafile.inputs).flatMap(
    ([input, metadata]) =>
      input.includes("packages/")
        ? metadata.imports
            .filter(
              (entry) =>
                /packages[/\\]core[/\\]utils[/\\]dist[/\\](index|modules-sdk[/\\]index)\.js/i.test(
                  entry.path
                ) ||
                /packages[/\\]core[/\\]utils[/\\]dist[/\\]common[/\\]define-config\.js/i.test(
                  entry.path
                ) ||
                /packages[/\\]core[/\\]utils[/\\]dist[/\\]common[/\\]index\.js/i.test(
                  entry.path
                ) ||
                /packages[/\\]core[/\\]utils[/\\]src[/\\]modules-sdk[/\\]index\.ts/i.test(
                  entry.path
                ) ||
                /packages[/\\]core[/\\]utils[/\\]src[/\\]common[/\\]index\.ts/i.test(
                  entry.path
                )
            )
            .map((entry) => `${input} -> ${entry.path}`)
        : []
  )
  throw new Error(
    `Cloudflare portability check failed:\n${violations
      .slice(0, 50)
      .map((input) => `- ${input}`)
      .join("\n")}\nFirst-party blocker edges:\n${firstPartyBlockerEdges
      .slice(0, 50)
      .map((edge) => `- ${edge}`)
            .join("\n")}\nBroad first-party edges:\n${broadFirstPartyEdges
      .slice(0, 50)
      .map((edge) => `- ${edge}`)
      .join("\n")}\nExternal Node edges:\n${externalNodeEdges()
      .slice(0, 50)
      .map((edge) => `- ${edge}`)
      .join("\n")}\nShortest boundary paths:\n${boundaryPaths
      .map((importPath) => `- ${importPath.join(" -> ")}`)
      .join("\n")}`
  )
}

console.log(
  `Composed Worker import check passed (${
    Object.keys(result.metafile.inputs).length
  } bundled inputs)`
)

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function findShortestImportPath(start, targetPattern) {
  if (!start) {
    return undefined
  }

  const queue = [[start]]
  const visited = new Set([start])

  while (queue.length) {
    const currentPath = queue.shift()
    const current = currentPath.at(-1)

    if (targetPattern.test(current)) {
      return currentPath
    }

    for (const imported of result.metafile.inputs[current]?.imports ?? []) {
      if (
        !(imported.path in result.metafile.inputs) ||
        visited.has(imported.path)
      ) {
        continue
      }

      visited.add(imported.path)
      queue.push([...currentPath, imported.path])
    }
  }

  return undefined
}

function externalNodeEdges() {
  return Object.entries(result.metafile.inputs).flatMap(([input, metadata]) =>
    metadata.imports
      .filter((entry) => entry.external && nodeSpecifiers.has(entry.path))
      .map((entry) => `${input} -> external:${entry.path}`)
  )
}
