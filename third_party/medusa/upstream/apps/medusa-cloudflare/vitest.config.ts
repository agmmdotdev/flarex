import { medusaCloudflareSharedViteConfig } from "./vite.config"
import { defineConfig } from "vitest/config"

export default defineConfig({
  ...medusaCloudflareSharedViteConfig,
  test: {
    deps: {
      optimizer: {
        client: {
          enabled: false,
        },
        ssr: {
          enabled: false,
        },
      },
    },
  },
})
