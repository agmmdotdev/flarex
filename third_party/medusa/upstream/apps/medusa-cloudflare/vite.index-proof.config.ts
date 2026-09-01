import { cloudflare } from "@cloudflare/vite-plugin"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

export default defineConfig({
  cacheDir: "node_modules/.vite-index-proof",
  plugins: [
    cloudflare({
      configPath: "./wrangler.index-proof.jsonc",
    }),
  ],
  resolve: {
    alias: {
      "@medusajs/framework/modules-sdk": fileURLToPath(
        new URL("src/medusa-framework-modules-sdk.ts", import.meta.url)
      ),
      "@medusajs/framework/types": fileURLToPath(
        new URL("../../packages/core/types/src/index.ts", import.meta.url)
      ),
      "@medusajs/framework/utils/portable": fileURLToPath(
        new URL(
          "../../packages/core/framework/src/utils/portable.ts",
          import.meta.url
        )
      ),
      "@medusajs/framework/utils": fileURLToPath(
        new URL(
          "../../packages/core/framework/src/utils/portable.ts",
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
      "@medusajs/pricing/joiner-config": fileURLToPath(
        new URL(
          "../../packages/modules/pricing/src/joiner-config.ts",
          import.meta.url
        )
      ),
      "@medusajs/product/joiner-config": fileURLToPath(
        new URL(
          "../../packages/modules/product/src/joiner-config.ts",
          import.meta.url
        )
      ),
      "@medusajs/cloudflare-runtime": fileURLToPath(
        new URL(
          "../../packages/core/cloudflare-runtime/src/index.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/container": fileURLToPath(
        new URL("../../packages/core/utils/src/common/container.ts", import.meta.url)
      ),
      "@medusajs/utils/dml/model": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/dml/entity-builder.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/is-defined": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/is-defined.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/lower-case-first": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/lower-case-first.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/promise-all": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/promise-all.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/common/to-kebab-case": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/common/to-kebab-case.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/event-bus/common-events": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/event-bus/common-events.ts",
          import.meta.url
        )
      ),
      "@medusajs/utils/event-bus/utils": fileURLToPath(
        new URL("../../packages/core/utils/src/event-bus/utils.ts", import.meta.url)
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
      "@medusajs/utils/link/links": fileURLToPath(
        new URL("../../packages/core/utils/src/link/links.ts", import.meta.url)
      ),
      "@medusajs/utils/modules-sdk/definition": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/modules-sdk/definition.ts",
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
      "@medusajs/utils/product/enums": fileURLToPath(
        new URL(
          "../../packages/core/utils/src/product/enums.ts",
          import.meta.url
        )
      ),
      "@medusajs/types": fileURLToPath(
        new URL("../../packages/core/types/src/index.ts", import.meta.url)
      ),
    },
  },
})
