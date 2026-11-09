import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import {
  createStaticHttpManifestInputFromFileList,
  renderStaticHttpManifestModule,
} from "@medusajs/framework/build-tools/static-http-manifest"
import { readManifestSpec, validateManifestBindings } from "./static-manifest-spec.mjs"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const medusaPackageRoot = path.resolve(scriptDirectory, "..")
const projectRoot = path.resolve(medusaPackageRoot, "../..")
const check = process.argv.includes("--check")
for (const input of ["static-manifest.json", "admin-product-static-manifest.json"]) {
  const manifestSpec = await readManifestSpec(path.join(medusaPackageRoot, input))
  const outputPath = path.join(projectRoot, manifestSpec.outputPath)
  const generated = await renderManifest(manifestSpec)
  if (check) {
    const current = await fs.readFile(outputPath, "utf8")
    if (current !== generated) {
      throw new Error(
        "Static HTTP manifest is stale. Run pnpm --filter @flarex/medusa-http generate."
      )
    }
  } else {
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, generated)
  }
}

async function renderManifest(manifestSpec) {
  await validateListedFilesExist([
    ...manifestSpec.routes,
    ...manifestSpec.middlewares,
  ])

  const manifestInput = createStaticHttpManifestInputFromFileList({
    manifestDirectory: manifestSpec.manifestDirectory,
    routeRoot: manifestSpec.routeRoot,
    routes: manifestSpec.routes,
    middlewares: manifestSpec.middlewares,
  })
  validateManifestBindings(manifestInput, manifestSpec.exportName)

  return renderStaticHttpManifestModule({
    exportName: manifestSpec.exportName,
    generatedBy: manifestSpec.generatedBy,
    routes: manifestInput.routes,
    middlewares: manifestInput.middlewares,
  })
}

async function validateListedFilesExist(files) {
  await Promise.all(
    files.map(async (file) => {
      await fs.access(path.join(projectRoot, file.relativePath))
    })
  )
}
