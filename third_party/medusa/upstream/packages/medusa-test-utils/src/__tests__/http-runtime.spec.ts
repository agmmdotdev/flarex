import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  resolveTestHttpRuntime,
  type TestHttpRuntime,
} from "../medusa-test-runner-utils/bootstrap-app"
import {
  findCloudflareWorkerWorkspaceRoot,
  resolveCloudflareHealthTimeout,
} from "../medusa-test-runner-utils/cloudflare-worker-process"

describe("HTTP integration runtime selection", () => {
  it.each([
    [undefined, "express"],
    ["", "express"],
    ["express", "express"],
    ["cloudflare", "cloudflare"],
  ] as Array<[string | undefined, TestHttpRuntime]>)(
    "resolves %s to %s",
    (value, expected) => {
      expect(resolveTestHttpRuntime(value)).toBe(expected)
    }
  )

  it("rejects unsupported runtime values", () => {
    expect(() => resolveTestHttpRuntime("hono")).toThrow(
      'Unsupported MEDUSA_TEST_HTTP_RUNTIME value "hono". Expected "express" or "cloudflare".'
    )
  })

  it.each([
    [undefined, 240000],
    ["", 240000],
    ["120000", 120000],
    ["0", 240000],
    ["invalid", 240000],
  ] as Array<[string | undefined, number]>)(
    "resolves Cloudflare health timeout %s to %s",
    (value, expected) => {
      expect(resolveCloudflareHealthTimeout(value)).toBe(expected)
    }
  )

  it("finds the Cloudflare Worker workspace root from a child directory", () => {
    const root = mkdtempSync(join(tmpdir(), "worker-workspace-"))
    const child = join(root, "apps", "medusa-cloudflare")

    try {
      mkdirSync(child, { recursive: true })
      writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []")

      expect(findCloudflareWorkerWorkspaceRoot(child)).toBe(root)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it("rejects Cloudflare Worker workspace root lookup without the pnpm workspace manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "missing-worker-workspace-"))
    const child = join(root, "apps", "medusa-cloudflare")

    try {
      mkdirSync(child, { recursive: true })

      expect(() => findCloudflareWorkerWorkspaceRoot(child)).toThrow(
        "Unable to find workspace root"
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
