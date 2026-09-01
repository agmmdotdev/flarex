import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import {
  createStaticHttpManifestInputFromFileList,
  renderStaticHttpManifestModule,
} from "@medusajs/framework/build-tools/static-http-manifest"

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(appDirectory, "../../..")
const outputPath = path.join(
  projectRoot,
  "packages/medusa/src/static/http-proof-manifest.ts"
)
const check = process.argv.includes("--check")

const generated = await renderManifest()

if (check) {
  const current = await fs.readFile(outputPath, "utf8")
  if (current !== generated) {
    throw new Error(
      "Static HTTP proof manifest is stale. Run pnpm --filter medusa-cloudflare generate:http-proof-manifest."
    )
  }
} else {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, generated)
}

async function renderManifest() {
  const manifestInput = createStaticHttpManifestInputFromFileList({
    manifestDirectory: "packages/medusa/src/static",
    routeRoot: "packages/medusa/src/api",
    routes: [
      {
        relativePath: "packages/medusa/src/api/hooks/payment/[provider]/route.ts",
      },
    ],
    middlewares: [
      {
        relativePath: "packages/medusa/src/api/hooks/middlewares.ts",
        exportName: "hooksRoutesMiddlewares",
      },
    ],
  })

  return renderStaticHttpManifestModule({
    exportName: "medusaStaticHttpProofManifest",
    generatedBy: "apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs",
    routes: manifestInput.routes,
    middlewares: manifestInput.middlewares,
  })
}
