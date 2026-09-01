import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import * as yalc from "yalc"
import localPublishPlugin from "../publish"

async function writeJson(filePath: string, value: Record<string, unknown>) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

describe("localPublishPlugin", () => {
  it("publishes concrete workspace dependency versions without changing the source manifest", async () => {
    const testDirectory = await mkdtemp(
      path.join(tmpdir(), "medusa-plugin-publish-")
    )
    const pluginDirectory = path.join(testDirectory, "plugin")
    const storeDirectory = path.join(testDirectory, "yalc-store")
    const originalStoreDirectory = yalc.yalcGlobal.yalcStoreMainDir
    const sourceManifest = {
      name: "@test/workspace-plugin",
      version: "1.0.0",
      files: ["index.js"],
      dependencies: {
        "@medusajs/framework": "workspace:*",
      },
      devDependencies: {
        "@medusajs/dev-only": "workspace:*",
      },
      optionalDependencies: {
        "@medusajs/optional": "workspace:^",
      },
      peerDependencies: {
        "@medusajs/ui": "workspace:~",
      },
    }
    const sourceManifestText = `${JSON.stringify(sourceManifest, null, 2)}\n`

    await mkdir(pluginDirectory, { recursive: true })
    await writeFile(
      path.join(pluginDirectory, "package.json"),
      sourceManifestText
    )
    await writeFile(
      path.join(pluginDirectory, "index.js"),
      "module.exports = {}\n"
    )

    for (const [packageName, version] of [
      ["@medusajs/framework", "2.13.4"],
      ["@medusajs/dev-only", "2.13.4"],
      ["@medusajs/optional", "3.0.0"],
      ["@medusajs/ui", "4.1.4"],
    ]) {
      await writeJson(
        path.join(pluginDirectory, "node_modules", packageName, "package.json"),
        {
          name: packageName,
          version,
          exports: {
            ".": "./index.js",
          },
        }
      )
    }

    yalc.yalcGlobal.yalcStoreMainDir = storeDirectory

    try {
      await localPublishPlugin({ directory: pluginDirectory })

      const publishedManifestPath = path.join(
        storeDirectory,
        "packages",
        "@test/workspace-plugin",
        "1.0.0",
        "package.json"
      )
      const publishedManifest = JSON.parse(
        await readFile(publishedManifestPath, "utf8")
      )

      expect(publishedManifest.dependencies).toEqual({
        "@medusajs/framework": "2.13.4",
      })
      expect(publishedManifest.optionalDependencies).toEqual({
        "@medusajs/optional": "^3.0.0",
      })
      expect(publishedManifest.peerDependencies).toEqual({
        "@medusajs/ui": "~4.1.4",
      })
      expect(
        await readFile(path.join(pluginDirectory, "package.json"), "utf8")
      ).toBe(sourceManifestText)
    } finally {
      yalc.yalcGlobal.yalcStoreMainDir = originalStoreDirectory
      await rm(testDirectory, { recursive: true, force: true })
    }
  })
})
