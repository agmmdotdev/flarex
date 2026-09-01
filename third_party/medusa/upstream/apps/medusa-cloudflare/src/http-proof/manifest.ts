import type { StaticHttpResourceManifest } from "@medusajs/framework/http/static"
import * as featureFlagCustomRoute from "../../../../integration-tests/http/__fixtures__/feature-flag/src/api/custom/route"
import { default as featureFlagMiddlewareConfig } from "../../../../integration-tests/http/__fixtures__/feature-flag/src/api/middlewares"
import * as httpProofRoute from "./route"

declare const __MEDUSA_CLOUDFLARE_CUSTOM_FF__: boolean

export const staticHttpProofManifest = {
  routes: [
    ...(__MEDUSA_CLOUDFLARE_CUSTOM_FF__
      ? [
          {
            route: "/custom",
            module: featureFlagCustomRoute,
            relativePath:
              "integration-tests/http/__fixtures__/feature-flag/src/api/custom/route.ts",
          },
        ]
      : []),
    {
      route: "/http-proof/:proofId",
      module: httpProofRoute,
      relativePath: "apps/medusa-cloudflare/src/http-proof/route.ts",
    },
  ],
  middlewares: [
    ...(__MEDUSA_CLOUDFLARE_CUSTOM_FF__
      ? [
          {
            module: {
              default: featureFlagMiddlewareConfig,
            },
            source:
              "integration-tests/http/__fixtures__/feature-flag/src/api/middlewares.ts",
          },
        ]
      : []),
  ],
} satisfies StaticHttpResourceManifest
