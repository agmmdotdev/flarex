import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import {
  createStaticHttpManifestInputFromFileList,
  renderStaticHttpManifestModule,
} from "@medusajs/framework/build-tools/static-http-manifest"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const medusaPackageRoot = path.resolve(scriptDirectory, "..")
const projectRoot = path.resolve(medusaPackageRoot, "../..")
const check = process.argv.includes("--check")
const manifestInputPath = path.join(
  projectRoot,
  "packages/medusa/static-http-manifests/store-admin.json"
)

const manifestSpec = await readManifestSpec(manifestInputPath)
const outputPath = path.join(projectRoot, manifestSpec.outputPath)

const generated = await renderManifest()

if (check) {
  const current = await fs.readFile(outputPath, "utf8")
  if (current !== generated) {
    throw new Error(
      "Static HTTP manifest is stale. Run pnpm --filter @medusajs/medusa generate:static-http-manifest."
    )
  }
} else {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, generated)
}

async function renderManifest() {
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

  return renderStaticHttpManifestModule({
    exportName: manifestSpec.exportName,
    generatedBy: manifestSpec.generatedBy,
    routes: manifestInput.routes,
    middlewares: manifestInput.middlewares,
  })
}

async function readManifestSpec(filePath) {
  const source = await fs.readFile(filePath, "utf8")
  const parsed = JSON.parse(source)

  assertString(parsed.exportName, "exportName")
  assertString(parsed.generatedBy, "generatedBy")
  assertString(parsed.manifestDirectory, "manifestDirectory")
  assertString(parsed.outputPath, "outputPath")
  assertString(parsed.routeRoot, "routeRoot")
  assertFileList(parsed.routes, "routes")
  assertFileList(parsed.middlewares, "middlewares")

  return parsed
}

async function validateListedFilesExist(files) {
  await Promise.all(
    files.map(async (file) => {
      await fs.access(path.join(projectRoot, file.relativePath))
    })
  )
}

function assertFileList(value, property) {
  if (!Array.isArray(value)) {
    throw new Error(`Static HTTP manifest input '${property}' must be an array.`)
  }

  for (const [index, file] of value.entries()) {
    assertString(file.relativePath, `${property}[${index}].relativePath`)
  }
}

function assertString(value, property) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Static HTTP manifest input '${property}' must be a non-empty string.`
    )
  }
}
