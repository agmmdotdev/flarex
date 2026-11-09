import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createStaticHttpManifestInputFromFileList } from "@medusajs/framework/build-tools/static-http-manifest"
import { describe, expect, it } from "vitest"
import { readManifestSpec, validateManifestBindings } from "../scripts/static-manifest-spec.mjs"

const valid = JSON.parse(await readFile(new URL("../static-manifest.json", import.meta.url), "utf8"))

async function decode(input: unknown) {
  const directory = await mkdtemp(path.join(tmpdir(), "medusa-static-manifest-"))
  const file = path.join(directory, "manifest.json")
  try {
    await writeFile(file, JSON.stringify(input))
    return await readManifestSpec(file)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe("static HTTP manifest JSON decoding", () => {
  it("retains the pinned file-list contract including optional renderer inputs", async () => {
    const input = {
      ...valid,
      routes: [{ relativePath: "api/store/currencies/route.ts", binding: "currencyRoute", importPath: "./api/store/currencies/route", route: "/store/currencies", routeRoot: "api" }],
      middlewares: [{ relativePath: "api/store/currencies/middlewares.ts", binding: "storeCurrencyRoutesMiddlewares", importPath: "./api/store/currencies/middlewares", exportName: "storeCurrencyRoutesMiddlewares" }],
    }
    expect(await decode(input)).toEqual(input)
  })

  it.each([
    { exportName: "default" },
    { exportName: "await" },
    { exportName: "arguments" },
    { exportName: "eval" },
    { exportName: "manifest;process.exit()" },
    { generatedBy: "command\nexport const injected = true" },
    { routes: [null] },
    { routes: [{ relativePath: "route.ts", binding: 42 }] },
    { routes: [{ relativePath: "route.ts", binding: "123route" }] },
    { routes: [{ relativePath: "route.ts", binding: "class" }] },
    { routes: [{ relativePath: "route.ts", importPath: false }] },
    { routes: [{ relativePath: "route.ts", importPath: './route";inject()' }] },
    { routes: [{ relativePath: "route.ts", route: [] }] },
    { routes: [{ relativePath: "route.ts", routeRoot: null }] },
    { middlewares: [{ relativePath: "middlewares.ts", binding: {} }] },
    { middlewares: [{ relativePath: "middlewares.ts", importPath: 42 }] },
    { middlewares: [{ relativePath: "middlewares.ts", exportName: "import" }] },
    { middlewares: [{ relativePath: "middlewares.ts", exportName: 42 }] },
    { routes: [{ relativePath: "route.ts", unrecognized: true }] },
    { extra: true },
  ])("rejects malformed input before rendering: %j", async (change) => {
    await expect(decode({ ...valid, ...change })).rejects.toThrow()
  })

  it("validates derived identifiers and rejects collisions before rendering", () => {
    const invalid = createStaticHttpManifestInputFromFileList({
      manifestDirectory: "api", routeRoot: "api", routes: [{ relativePath: "api/123/route.ts" }],
    })
    expect(() => validateManifestBindings(invalid, "manifest")).toThrow()
    expect(() => validateManifestBindings({ routes: [{ binding: "manifest" }], middlewares: [] }, "manifest")).toThrow("unique")
  })
})
