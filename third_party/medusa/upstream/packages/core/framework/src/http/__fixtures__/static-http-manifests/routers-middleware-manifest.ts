import type { StaticHttpResourceManifest } from "../../utils/static-http-resources"
import * as customerRoute from "../routers-middleware/customers/route"
import * as middlewareConfig from "../routers-middleware/middlewares"
import * as productSyncRoute from "../routers-middleware/store/products/[id]/sync/route"
import * as webhookPaymentRoute from "../routers-middleware/webhooks/payment/route"

export const routersMiddlewareStaticHttpManifest = {
  routes: [
    {
      route: "/customers",
      module: customerRoute,
    },
    {
      route: "/webhooks/payment",
      module: webhookPaymentRoute,
    },
    {
      relativePath: "/store/products/[id]/sync/route.ts",
      module: productSyncRoute,
    },
  ],
  middlewares: [
    {
      module: middlewareConfig,
    },
  ],
} satisfies StaticHttpResourceManifest
