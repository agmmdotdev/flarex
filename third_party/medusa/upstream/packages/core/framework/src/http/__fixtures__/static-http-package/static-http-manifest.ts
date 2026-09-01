import type { StaticHttpResourceManifest } from "../../utils/static-http-resources"
import * as customerRoute from "../routers-middleware/customers/route"
import * as middlewareConfig from "./middlewares"
import * as productSyncRoute from "../routers-middleware/store/products/[id]/sync/route"

export const staticHttpManifest = {
  routes: [
    {
      route: "/customers",
      module: customerRoute,
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
