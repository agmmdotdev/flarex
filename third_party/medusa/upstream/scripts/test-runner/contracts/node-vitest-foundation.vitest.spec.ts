import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { load } from "js-yaml"
import { describe, expect, it, vi } from "vitest"

import {
  defineNodeVitestConfig,
  NODE_TEST_DEFAULT_TIMEOUT,
  NODE_TEST_DISCOVERY_GLOBS,
} from "../define-node-vitest-config"
import { defineNodeVitestIntegrationConfig } from "../define-node-vitest-integration-config"
import { filterExistingRepositoryFiles } from "../inventory-paths"
import {
  shouldTransformTestModule,
  transformTestModule,
} from "../swc-test-transform"
import {
  createLegacyJestBridge,
  LEGACY_JEST_BRIDGE_KEYS,
  type LegacyJestBridgeSource,
} from "../vitest-jest-compatibility"

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`)
  }

  return value
}

function requireSteps(
  value: unknown,
  label: string
): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`)
  }

  return value.map((entry, index) => requireRecord(entry, `${label}[${index}]`))
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`)
  }

  return value
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function normalizedFileDigest(path: string): string {
  const source = readFileSync(path, "utf8").replaceAll("\r\n", "\n")
  return createHash("sha256").update(source).digest("hex")
}

function fileDigest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function requireTwoCommandLines(
  value: unknown,
  label: string
): readonly [string, string] {
  const commands = requireString(value, label)
    .trim()
    .split(/\r?\n/)
    .map((command) => command.trim())
  const [firstCommand, secondCommand] = commands

  if (
    commands.length !== 2 ||
    firstCommand === undefined ||
    secondCommand === undefined
  ) {
    throw new Error(`${label} must contain exactly two command lines.`)
  }

  return [firstCommand, secondCommand]
}

describe("shared Node Vitest config", () => {
  it("drops indexed files that were deleted before inventory staging", () => {
    expect(
      filterExistingRepositoryFiles(resolve(process.cwd()), [
        "package.json",
        "scripts/test-runner/contracts/deleted-before-staging.spec.ts",
      ])
    ).toEqual(["package.json"])
  })

  it("requires an absolute root and an explicit discovery lane", () => {
    expect(NODE_TEST_DISCOVERY_GLOBS).toEqual([
      "**/__tests__/**/*.{js,ts}",
      "**/*.{spec,test}.{js,ts}",
    ])
    expect(() =>
      defineNodeVitestConfig({
        aliases: [],
        include: ["**/*.spec.ts"],
        root: ".",
      })
    ).toThrow("root must be absolute")
    expect(() =>
      defineNodeVitestConfig({
        aliases: [],
        include: [],
        root: resolve(process.cwd()),
      })
    ).toThrow("requires an explicit include list")

    expect(
      defineNodeVitestConfig({
        aliases: [],
        include: ["**/*.spec.ts"],
        root: resolve(process.cwd()),
      }).test
    ).toMatchObject({
      hookTimeout: NODE_TEST_DEFAULT_TIMEOUT,
      testTimeout: NODE_TEST_DEFAULT_TIMEOUT,
    })
  })

  it("uses the exact SWC decorator transform and dependency boundary", async () => {
    const localId = resolve(process.cwd(), "contract-fixture.ts")
    const result = await transformTestModule(
      `
        function field(): PropertyDecorator { return () => undefined }
        class Example { @field() value: string = "value" }
      `,
      localId
    )

    expect(result).not.toBeNull()
    expect(result?.code).toContain("_ts_decorate")
    expect(result?.map).toContain('"sources"')
    expect(result?.map).toContain(localId.replaceAll("\\", "/"))
    expect(shouldTransformTestModule(localId)).toBe(true)
    expect(
      shouldTransformTestModule(
        resolve(process.cwd(), "node_modules/msw/index.js")
      )
    ).toBe(true)
    expect(
      shouldTransformTestModule(
        resolve(process.cwd(), "node_modules/unrelated/index.js")
      )
    ).toBe(false)
    expect(
      shouldTransformTestModule(resolve(process.cwd(), "fixture.tsx"))
    ).toBe(false)
  })

  it("makes the integration profile serial and preserves timeout ownership", () => {
    const config = defineNodeVitestIntegrationConfig({
      aliases: [],
      include: ["integration-foundation.spec.ts"],
      root: resolve(process.cwd()),
    })

    expect(config.test).toMatchObject({
      fileParallelism: false,
      hookTimeout: NODE_TEST_DEFAULT_TIMEOUT,
      maxWorkers: 1,
      sequence: {
        concurrent: false,
        hooks: "list",
        setupFiles: "list",
      },
      testTimeout: NODE_TEST_DEFAULT_TIMEOUT,
    })
    expect(config.test?.setupFiles).toEqual([
      expect.stringMatching(/vitest-jest-compatibility-setup\.ts$/),
      expect.stringMatching(/integration-tests[\\/]setup-env\.js$/),
    ])
  })

  it("supports a native integration profile with explicit timeout ownership", () => {
    const config = defineNodeVitestIntegrationConfig({
      aliases: [],
      hookTimeout: 100_000,
      include: ["integration-foundation.spec.ts"],
      legacyJestBridge: false,
      root: resolve(process.cwd()),
      testTimeout: 100_000,
    })

    expect(config.test).toMatchObject({
      hookTimeout: 100_000,
      testTimeout: 100_000,
    })
    expect(config.test?.setupFiles).toEqual([
      expect.stringMatching(/integration-tests[\\/]setup-env\.js$/),
    ])
  })
})

describe("legacy Jest compatibility bridge", () => {
  it("installs only the frozen eight-method allowlist", () => {
    expect(Object.keys(jest).sort()).toEqual(
      [...LEGACY_JEST_BRIDGE_KEYS].sort()
    )
    expect(Object.isFrozen(jest)).toBe(true)

    for (const blockedKey of [
      "doMock",
      "isolateModules",
      "mock",
      "requireActual",
      "resetAllMocks",
      "resetModules",
      "advanceTimersByTime",
      "clearAllTimers",
      "runAllTimers",
    ]) {
      expect(blockedKey in jest).toBe(false)
    }
  })

  it("keeps chaining inside the bridge and delegates the narrow timer surface", () => {
    const timeoutConfigs: unknown[] = []
    const setSystemTime = vi.fn<LegacyJestBridgeSource["setSystemTime"]>(
      () => vi
    )
    const useFakeTimers = vi.fn<LegacyJestBridgeSource["useFakeTimers"]>(
      () => vi
    )
    const useRealTimers = vi.fn<LegacyJestBridgeSource["useRealTimers"]>(
      () => vi
    )
    const source = {
      clearAllMocks: vi.clearAllMocks,
      fn: vi.fn,
      restoreAllMocks: vi.restoreAllMocks,
      setConfig: (config): void => {
        timeoutConfigs.push(config)
      },
      setSystemTime,
      spyOn: vi.spyOn,
      useFakeTimers,
      useRealTimers,
    } satisfies LegacyJestBridgeSource
    const bridge = createLegacyJestBridge(source)
    const now = 1_700_000_000_000

    expect(bridge.clearAllMocks()).toBe(bridge)
    expect(bridge.restoreAllMocks()).toBe(bridge)
    expect(bridge.setTimeout(1_234)).toBe(bridge)
    expect(bridge.useFakeTimers().setSystemTime(now).useRealTimers()).toBe(
      bridge
    )
    expect(timeoutConfigs).toEqual([
      {
        hookTimeout: 1_234,
        testTimeout: 1_234,
      },
    ])
    expect(useFakeTimers).toHaveBeenCalledTimes(1)
    expect(useFakeTimers).toHaveBeenCalledWith()
    expect(setSystemTime).toHaveBeenCalledWith(now)
    expect(useRealTimers).toHaveBeenCalledTimes(1)
    expect(useRealTimers).toHaveBeenCalledWith()
  })

  it("uses Vitest fake time through the narrow bridge", () => {
    const now = 1_700_000_000_000
    const bridge = createLegacyJestBridge(vi)

    try {
      expect(bridge.useFakeTimers().setSystemTime(now)).toBe(bridge)
      expect(Date.now()).toBe(now)
    } finally {
      expect(bridge.useRealTimers()).toBe(bridge)
    }
  })
})

describe("unit test CI argument boundary", () => {
  it("applies Turbo filters before forwarding runner arguments", () => {
    const rootPackage = requireRecord(
      JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")),
      "root package"
    )
    const rootScripts = requireRecord(
      rootPackage.scripts,
      "root package scripts"
    )
    const workflow = requireRecord(
      load(
        readFileSync(
          resolve(process.cwd(), ".github/workflows/action.yml"),
          "utf8"
        )
      ),
      "workflow"
    )
    const jobs = requireRecord(workflow.jobs, "workflow.jobs")
    const unitMatrixJob = requireRecord(
      jobs["unit-tests-matrix"],
      "workflow.jobs.unit-tests-matrix"
    )
    const unitMatrixStrategy = requireRecord(
      unitMatrixJob.strategy,
      "workflow.jobs.unit-tests-matrix.strategy"
    )
    const unitMatrix = requireRecord(
      unitMatrixStrategy.matrix,
      "workflow.jobs.unit-tests-matrix.strategy.matrix"
    )
    const unitMatrixSteps = requireSteps(
      unitMatrixJob.steps,
      "workflow.jobs.unit-tests-matrix.steps"
    )
    const unitRunSteps = unitMatrixSteps.filter(
      (step) => step.name === "Run unit tests"
    )
    const [unitRunStep] = unitRunSteps

    if (unitRunSteps.length !== 1 || unitRunStep === undefined) {
      throw new Error(
        "workflow.jobs.unit-tests-matrix must contain exactly one Run unit tests step."
      )
    }

    const [generalCommand, serialCommand] = requireTwoCommandLines(
      unitRunStep.run,
      "workflow.jobs.unit-tests-matrix Run unit tests command"
    )

    expect(requireString(rootScripts.test, "root package scripts.test")).toBe(
      "turbo run test --no-daemon --no-cache --force"
    )
    expect(unitMatrixJob.needs).toBe("setup")
    expect(unitMatrixStrategy["fail-fast"]).toBe(true)
    expect(unitMatrix.shard_index).toEqual([1, 2, 3, 4])
    expect([generalCommand, serialCommand]).toEqual([
      "pnpm test --filter='!@medusajs/framework' --filter='!@medusajs/utils' -- -- --shard=${{ matrix.shard_index }}/4 --maxWorkers=${{ steps.cpu-cores.outputs.count }} --passWithNoTests",
      "pnpm test --filter=@medusajs/framework --filter=@medusajs/utils -- -- --shard=${{ matrix.shard_index }}/4 --passWithNoTests",
    ])
    expect(generalCommand).not.toContain("pnpm test -- --filter")
    expect(serialCommand).not.toContain("pnpm test -- --filter")
    expect(generalCommand).toContain(" -- -- --shard=")
    expect(serialCommand).toContain(" -- -- --shard=")
    expect(generalCommand).toContain(
      "--maxWorkers=${{ steps.cpu-cores.outputs.count }}"
    )
    expect(serialCommand).not.toContain("--maxWorkers")
  })
})

describe("package integration CI ownership", () => {
  it("keeps one-file Vitest lanes out of generic shards and in dedicated jobs", () => {
    const rootPackage = requireRecord(
      JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")),
      "root package"
    )
    const rootScripts = requireRecord(
      rootPackage.scripts,
      "root package scripts"
    )
    const apiKeyPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/api-key/package.json"),
          "utf8"
        )
      ),
      "API Key package"
    )
    const apiKeyScripts = requireRecord(
      apiKeyPackage.scripts,
      "API Key package scripts"
    )
    const translationPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/translation/package.json"),
          "utf8"
        )
      ),
      "Translation package"
    )
    const translationScripts = requireRecord(
      translationPackage.scripts,
      "Translation package scripts"
    )
    const settingsPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/settings/package.json"),
          "utf8"
        )
      ),
      "Settings package"
    )
    const settingsScripts = requireRecord(
      settingsPackage.scripts,
      "Settings package scripts"
    )
    const storePackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/store/package.json"),
          "utf8"
        )
      ),
      "Store package"
    )
    const storeScripts = requireRecord(
      storePackage.scripts,
      "Store package scripts"
    )
    const authModulePackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/auth/package.json"),
          "utf8"
        )
      ),
      "Auth module package"
    )
    const authModuleScripts = requireRecord(
      authModulePackage.scripts,
      "Auth module package scripts"
    )
    const regionPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/region/package.json"),
          "utf8"
        )
      ),
      "Region package"
    )
    const regionScripts = requireRecord(
      regionPackage.scripts,
      "Region package scripts"
    )
    const rbacPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/rbac/package.json"),
          "utf8"
        )
      ),
      "RBAC package"
    )
    const rbacScripts = requireRecord(
      rbacPackage.scripts,
      "RBAC package scripts"
    )
    const userPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/user/package.json"),
          "utf8"
        )
      ),
      "User package"
    )
    const userScripts = requireRecord(
      userPackage.scripts,
      "User package scripts"
    )
    const salesChannelPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/sales-channel/package.json"),
          "utf8"
        )
      ),
      "Sales Channel package"
    )
    const salesChannelScripts = requireRecord(
      salesChannelPackage.scripts,
      "Sales Channel package scripts"
    )
    const customerPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/customer/package.json"),
          "utf8"
        )
      ),
      "Customer package"
    )
    const customerScripts = requireRecord(
      customerPackage.scripts,
      "Customer package scripts"
    )
    const analyticsPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/analytics/package.json"),
          "utf8"
        )
      ),
      "Analytics package"
    )
    const analyticsScripts = requireRecord(
      analyticsPackage.scripts,
      "Analytics package scripts"
    )
    const filePackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/file/package.json"),
          "utf8"
        )
      ),
      "File package"
    )
    const fileScripts = requireRecord(
      filePackage.scripts,
      "File package scripts"
    )
    const stockLocationPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/modules/stock-location/package.json"
          ),
          "utf8"
        )
      ),
      "Stock Location package"
    )
    const stockLocationScripts = requireRecord(
      stockLocationPackage.scripts,
      "Stock Location package scripts"
    )
    const inventoryPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/inventory/package.json"),
          "utf8"
        )
      ),
      "Inventory package"
    )
    const inventoryScripts = requireRecord(
      inventoryPackage.scripts,
      "Inventory package scripts"
    )
    const taxPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/tax/package.json"),
          "utf8"
        )
      ),
      "Tax package"
    )
    const taxScripts = requireRecord(taxPackage.scripts, "Tax package scripts")
    const paymentPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/payment/package.json"),
          "utf8"
        )
      ),
      "Payment package"
    )
    const paymentScripts = requireRecord(
      paymentPackage.scripts,
      "Payment package scripts"
    )
    const notificationPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/notification/package.json"),
          "utf8"
        )
      ),
      "Notification package"
    )
    const notificationScripts = requireRecord(
      notificationPackage.scripts,
      "Notification package scripts"
    )
    const fulfillmentPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/fulfillment/package.json"),
          "utf8"
        )
      ),
      "Fulfillment package"
    )
    const fulfillmentScripts = requireRecord(
      fulfillmentPackage.scripts,
      "Fulfillment package scripts"
    )
    const promotionPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/promotion/package.json"),
          "utf8"
        )
      ),
      "Promotion package"
    )
    const promotionScripts = requireRecord(
      promotionPackage.scripts,
      "Promotion package scripts"
    )
    const productPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/product/package.json"),
          "utf8"
        )
      ),
      "Product package"
    )
    const productScripts = requireRecord(
      productPackage.scripts,
      "Product package scripts"
    )
    const pricingPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/pricing/package.json"),
          "utf8"
        )
      ),
      "Pricing package"
    )
    const pricingScripts = requireRecord(
      pricingPackage.scripts,
      "Pricing package scripts"
    )
    const cartPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/cart/package.json"),
          "utf8"
        )
      ),
      "Cart package"
    )
    const cartScripts = requireRecord(
      cartPackage.scripts,
      "Cart package scripts"
    )
    const orderPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "packages/modules/order/package.json"),
          "utf8"
        )
      ),
      "Order package"
    )
    const orderScripts = requireRecord(
      orderPackage.scripts,
      "Order package scripts"
    )
    const authPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/modules/providers/auth-emailpass/package.json"
          ),
          "utf8"
        )
      ),
      "Auth Emailpass package"
    )
    const authScripts = requireRecord(
      authPackage.scripts,
      "Auth Emailpass package scripts"
    )
    const githubPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/modules/providers/auth-github/package.json"
          ),
          "utf8"
        )
      ),
      "Auth GitHub package"
    )
    const githubScripts = requireRecord(
      githubPackage.scripts,
      "Auth GitHub package scripts"
    )
    const googlePackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/modules/providers/auth-google/package.json"
          ),
          "utf8"
        )
      ),
      "Auth Google package"
    )
    const googleScripts = requireRecord(
      googlePackage.scripts,
      "Auth Google package scripts"
    )
    const fileLocalPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/modules/providers/file-local/package.json"
          ),
          "utf8"
        )
      ),
      "File Local package"
    )
    const fileLocalScripts = requireRecord(
      fileLocalPackage.scripts,
      "File Local package scripts"
    )
    const fileLocalDevDependencies = requireRecord(
      fileLocalPackage.devDependencies,
      "File Local package devDependencies"
    )
    const fileS3Package = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/modules/providers/file-s3/package.json"
          ),
          "utf8"
        )
      ),
      "File S3 package"
    )
    const fileS3Scripts = requireRecord(
      fileS3Package.scripts,
      "File S3 package scripts"
    )
    const fileS3DevDependencies = requireRecord(
      fileS3Package.devDependencies,
      "File S3 package devDependencies"
    )
    const fileS3Dependencies = requireRecord(
      fileS3Package.dependencies,
      "File S3 package dependencies"
    )
    const notificationLocalPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/modules/providers/notification-local/package.json"
          ),
          "utf8"
        )
      ),
      "Notification Local package"
    )
    const notificationLocalScripts = requireRecord(
      notificationLocalPackage.scripts,
      "Notification Local package scripts"
    )
    const notificationSendgridPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/modules/providers/notification-sendgrid/package.json"
          ),
          "utf8"
        )
      ),
      "Notification SendGrid package"
    )
    const notificationSendgridScripts = requireRecord(
      notificationSendgridPackage.scripts,
      "Notification SendGrid package scripts"
    )
    const notificationSendgridDevDependencies = requireRecord(
      notificationSendgridPackage.devDependencies,
      "Notification SendGrid package devDependencies"
    )
    const notificationSendgridDependencies = requireRecord(
      notificationSendgridPackage.dependencies,
      "Notification SendGrid package dependencies"
    )
    const notificationSendgridPeerDependencies = requireRecord(
      notificationSendgridPackage.peerDependencies,
      "Notification SendGrid package peerDependencies"
    )
    const lockingPostgresPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/modules/providers/locking-postgres/package.json"
          ),
          "utf8"
        )
      ),
      "Locking Postgres package"
    )
    const lockingPostgresScripts = requireRecord(
      lockingPostgresPackage.scripts,
      "Locking Postgres package scripts"
    )
    const lockingPostgresDevDependencies = requireRecord(
      lockingPostgresPackage.devDependencies,
      "Locking Postgres package devDependencies"
    )
    const lockingPostgresPeerDependencies = requireRecord(
      lockingPostgresPackage.peerDependencies,
      "Locking Postgres package peerDependencies"
    )
    const lockingRedisPackage = requireRecord(
      JSON.parse(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/modules/providers/locking-redis/package.json"
          ),
          "utf8"
        )
      ),
      "Locking Redis package"
    )
    const lockingRedisScripts = requireRecord(
      lockingRedisPackage.scripts,
      "Locking Redis package scripts"
    )
    const lockingRedisDependencies = requireRecord(
      lockingRedisPackage.dependencies,
      "Locking Redis package dependencies"
    )
    const lockingRedisDevDependencies = requireRecord(
      lockingRedisPackage.devDependencies,
      "Locking Redis package devDependencies"
    )
    const lockingRedisPeerDependencies = requireRecord(
      lockingRedisPackage.peerDependencies,
      "Locking Redis package peerDependencies"
    )
    const toolingTypecheckCommand = requireString(
      rootScripts["typecheck:test-runner-tooling"],
      "root package scripts.typecheck:test-runner-tooling"
    )
    const fastPackageCommand = requireString(
      rootScripts["test:integration:packages:fast"],
      "root package scripts.test:integration:packages:fast"
    )
    const slowPackageCommand = requireString(
      rootScripts["test:integration:packages:slow"],
      "root package scripts.test:integration:packages:slow"
    )
    const allPackagesCommand = requireString(
      rootScripts["test:integration:packages"],
      "root package scripts.test:integration:packages"
    )

    expect(fastPackageCommand).toBe(
      "turbo run test:integration --concurrency=1 --no-daemon --no-cache --force --filter=./packages/core/* --filter=./packages/medusa --filter=./packages/modules/* --filter=./packages/modules/providers/* --filter=!./packages/modules/{workflow-engine-redis,index,product,order,cart} --filter=!./packages/modules/currency --filter=!./packages/modules/providers/auth-emailpass --filter=!./packages/modules/providers/auth-github --filter=!./packages/modules/providers/auth-google --filter=!./packages/modules/providers/file-local --filter=!./packages/modules/providers/file-s3 --filter=!./packages/modules/providers/notification-local --filter=!./packages/modules/providers/notification-sendgrid --filter=!./packages/modules/providers/locking-postgres --filter=!./packages/modules/providers/locking-redis --filter=!./packages/modules/api-key --filter=!./packages/modules/translation --filter=!./packages/modules/settings --filter=!./packages/modules/store --filter=!./packages/modules/region --filter=!./packages/modules/rbac --filter=!./packages/modules/sales-channel --filter=!./packages/modules/stock-location --filter=!./packages/modules/inventory --filter=!./packages/modules/tax --filter=!./packages/modules/payment --filter=!./packages/modules/notification"
    )
    expect(slowPackageCommand).toBe(
      "turbo run test:integration --concurrency=1 --no-daemon --no-cache --force --filter=./packages/modules/{workflow-engine-redis,index,product,order,cart}"
    )
    expect(allPackagesCommand).toBe(
      "turbo run test:integration --concurrency=1 --no-daemon --no-cache --force --filter=./packages/core/* --filter=./packages/medusa --filter=./packages/modules/* --filter=./packages/modules/providers/*"
    )
    expect(rootScripts["check:api-key-integration"]).toBeUndefined()
    expect(apiKeyScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(apiKeyScripts["test:jest"]).toBe(
      "jest --bail --forceExit --testPathPattern=src"
    )
    expect(apiKeyScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(apiKeyScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.ts"'
    )
    expect(apiKeyScripts["test:integration:vitest"]).toBeUndefined()
    const apiKeyConfigTypecheckPath =
      "./packages/modules/api-key/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === apiKeyConfigTypecheckPath)
    ).toEqual([apiKeyConfigTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/api-key/integration-tests/__tests__/api-key-module-service.spec.ts"
        )
      )
    ).toBe("5d8cddfb7adc1be6187cd9a75e816d22e268d4dd3dfd4d1799c26715568797e2")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/api-key/integration-tests/__fixtures__/index.ts"
        )
      )
    ).toBe("d58ffcbac802bccc5b3263575dce2aa71973c84218d400eec1d780999bedde37")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/api-key",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("ee7d6ed8b351066f0fd908d319e8ebd3ee00146b5dc51c36601ac5a21fcd95a9")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/api-key/vitest.config.mts")
      )
    ).toBe("52958a368def2a79e1d0cfd5c8278d996f0f6fcd5f948d55124adbb2b9df5935")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/api-key/vitest.integration.config.mts"
        )
      )
    ).toBe("27209ecc3e77d13c47bb8456a18ac2477b77ef7c1712b00543c75349a6ce27b8")
    expect(rootScripts["check:translation-integration"]).toBeUndefined()
    expect(translationScripts.test).toBe(
      "vitest run --config vitest.config.mts"
    )
    expect(translationScripts["test:jest"]).toBe(
      "jest --passWithNoTests --bail --forceExit --testPathPattern=src"
    )
    expect(translationScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(translationScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.ts"'
    )
    expect(translationScripts["test:integration:vitest"]).toBeUndefined()
    const translationConfigTypecheckPath =
      "./packages/modules/translation/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === translationConfigTypecheckPath)
    ).toEqual([translationConfigTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/translation/integration-tests/__tests__/translation-module-service.spec.ts"
        )
      )
    ).toBe("82c07ea1896c5b10f09616d708b0ecbff5f80645d5404f832c62c199016b4822")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/translation/integration-tests/__fixtures__/index.ts"
        )
      )
    ).toBe("b9fc360f33e2488ac15487b999dee2663fb736178d508e545894b914952a2ee6")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/translation",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("8d576098455343f4025810089e414c229b432e90557adaff7af8acf655d6432a")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/translation/vitest.config.mts")
      )
    ).toBe("9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/translation/vitest.integration.config.mts"
        )
      )
    ).toBe("ce18dae67e8247368ae9afed93d7421cf50359a82908a76dfe0ee0f0b53e3439")
    expect(rootScripts["check:settings-integration"]).toBeUndefined()
    expect(settingsScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(settingsScripts["test:jest"]).toBe(
      "jest --passWithNoTests --bail --forceExit --testPathPattern=src"
    )
    expect(settingsScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(settingsScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.ts"'
    )
    expect(settingsScripts["test:integration:vitest"]).toBeUndefined()
    const settingsConfigTypecheckPath =
      "./packages/modules/settings/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === settingsConfigTypecheckPath)
    ).toEqual([settingsConfigTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/settings/integration-tests/__tests__/settings-module.spec.ts"
        )
      )
    ).toBe("672ffc69ac91c98fc19ab19ccd1490f4f18157a66b8246bb3b71615aed9e9df5")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/settings",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("abe0c3cacda174ac06f22404fe754c2d9a762c311164b6f97bd23ac0cd89a470")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/settings/vitest.config.mts")
      )
    ).toBe("9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/settings/vitest.integration.config.mts"
        )
      )
    ).toBe("7a162924556ae07e68c3fd942989d8674818ad0a17c0f36cdaf3e5b8fc73fbc0")
    expect(rootScripts["check:store-integration"]).toBeUndefined()
    expect(storeScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(storeScripts["test:jest"]).toBe(
      "jest --bail --forceExit --testPathPattern=src"
    )
    expect(storeScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(storeScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.ts"'
    )
    expect(storeScripts["test:integration:vitest"]).toBeUndefined()
    const storeConfigTypecheckPath =
      "./packages/modules/store/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === storeConfigTypecheckPath)
    ).toEqual([storeConfigTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/store/integration-tests/__tests__/store-module-service.spec.ts"
        )
      )
    ).toBe("0ab033fde113a47dd26cf93144b35622e3e2ef94f01d0a7b5fd72b939ae2088c")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/store/integration-tests/__fixtures__/index.ts"
        )
      )
    ).toBe("759ef4e1e67efe309e30c77aae52bfa0bbd5da94754423cc6a8623a1672553df")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/store",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/store/vitest.config.mts")
      )
    ).toBe("9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/store/vitest.integration.config.mts"
        )
      )
    ).toBe("72604382520d901bd177420fed668dea22347518b1a343705f6ea121ff13bce9")
    expect(authModuleScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(authModuleScripts["test:jest"]).toBe(
      "jest --bail --passWithNoTests --forceExit --testPathPattern=src"
    )
    expect(authModuleScripts["test:vitest"]).toBeUndefined()
    expect(authModuleScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(authModuleScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.ts"'
    )
    expect(authModuleScripts["test:integration:vitest"]).toBeUndefined()
    const authModuleConfigTypecheckPath =
      "./packages/modules/auth/vitest.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === authModuleConfigTypecheckPath)
    ).toEqual([authModuleConfigTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/auth/src/__tests__/static-manifest.spec.ts"
        )
      )
    ).toBe("f1588645cc48bf8c2e70ffaae45ed53d121bb63f557e9bb5f7cda73748af401d")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/auth",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("ee7d6ed8b351066f0fd908d319e8ebd3ee00146b5dc51c36601ac5a21fcd95a9")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/auth/tsconfig.json")
      )
    ).toBe("e4a0e8beb92f159284d70b75a703d41b667a9d84e5e965844fa6bb77a0218086")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/auth/vitest.config.mts")
      )
    ).toBe("52958a368def2a79e1d0cfd5c8278d996f0f6fcd5f948d55124adbb2b9df5935")
    const authModuleIntegrationConfigTypecheckPath =
      "./packages/modules/auth/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === authModuleIntegrationConfigTypecheckPath)
    ).toEqual([authModuleIntegrationConfigTypecheckPath])
    const authModuleProviderFixtureTypecheckPath =
      "./packages/modules/auth/integration-tests/__fixtures__/providers/default-provider.js"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === authModuleProviderFixtureTypecheckPath)
    ).toEqual([authModuleProviderFixtureTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/auth/vitest.integration.config.mts"
        )
      )
    ).toBe("1c5d5e398c4d35dce9cb42a51f9d15678440c3f5f2f105894af8a88d12df94c6")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/auth/integration-tests/__tests__/auth-module-service/auth-identity.spec.ts"
        )
      )
    ).toBe("b850f81257e340d6504390de1695dfb7beafd478a16c743e1fbb5bccf7296bd0")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/auth/integration-tests/__tests__/auth-module-service/index.spec.ts"
        )
      )
    ).toBe("f149ae477b43443b3dc728c122190ad7d6d718259f9532d6fef22c5f3965570f")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/auth/integration-tests/__tests__/auth-module-service/medusa-cloud-auth.spec.ts"
        )
      )
    ).toBe("21cc0e876b8f047752435173779196827058f6241d33e6926e06163275b29b16")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/auth/integration-tests/__fixtures__/auth-identity/index.ts"
        )
      )
    ).toBe("e9100b84c79bb0a4ed948797a3125ac4995481069fba300d5147aff895ebf9bd")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/auth/integration-tests/__fixtures__/providers/default-provider.js"
        )
      )
    ).toBe("afb01b5f86b2f1d1177b96bd73619c2d046562ab240430517b4516f5f3554695")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/auth/integration-tests/__fixtures__/providers/index.ts"
        )
      )
    ).toBe("c73070f55df71c562e3b68cdcdbea41c5bdbf5cd8bde1cf17eeaeaa362a58739")
    expect(regionScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(regionScripts["test:jest"]).toBe(
      "jest --passWithNoTests --bail --forceExit --testPathPattern=src"
    )
    expect(regionScripts["test:vitest"]).toBeUndefined()
    expect(regionScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(regionScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.ts"'
    )
    expect(regionScripts["test:integration:vitest"]).toBeUndefined()
    const regionConfigTypecheckPath =
      "./packages/modules/region/vitest.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === regionConfigTypecheckPath)
    ).toEqual([regionConfigTypecheckPath])
    const regionIntegrationConfigTypecheckPath =
      "./packages/modules/region/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === regionIntegrationConfigTypecheckPath)
    ).toEqual([regionIntegrationConfigTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/region/src/__tests__/static-manifest.spec.ts"
        )
      )
    ).toBe("325e94aa0180eb7e2dffa4d7a7d71854a90d754b87b045be67f142caa5a8dd35")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/region",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/region/tsconfig.json")
      )
    ).toBe("e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/region/vitest.config.mts")
      )
    ).toBe("9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/region/vitest.integration.config.mts"
        )
      )
    ).toBe("bc37718b8a248afe0d060beb308ed011a46b454b443923ec0f8dd193553dbf7d")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/region/integration-tests/__tests__/region-module.spec.ts"
        )
      )
    ).toBe("4c062b161e2b2e8d7325fd07fe600f855abf845a1772e99fb373349663957888")
    expect(rbacScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(rbacScripts["test:jest"]).toBe(
      "jest --passWithNoTests --bail --forceExit --testPathPattern=src"
    )
    expect(rbacScripts["test:vitest"]).toBeUndefined()
    expect(rbacScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(rbacScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.ts"'
    )
    expect(rbacScripts["test:integration:vitest"]).toBeUndefined()
    const rbacConfigTypecheckPath = "./packages/modules/rbac/vitest.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === rbacConfigTypecheckPath)
    ).toEqual([rbacConfigTypecheckPath])
    const rbacIntegrationConfigTypecheckPath =
      "./packages/modules/rbac/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === rbacIntegrationConfigTypecheckPath)
    ).toEqual([rbacIntegrationConfigTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/rbac/src/__tests__/static-manifest.spec.ts"
        )
      )
    ).toBe("d40b045b410d79cd82a68a0dc77c45c809d552615a5c4c4ac1ca90654ed4c8bc")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/rbac",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/rbac/tsconfig.json")
      )
    ).toBe("e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/rbac/vitest.config.mts")
      )
    ).toBe("9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/rbac/vitest.integration.config.mts"
        )
      )
    ).toBe("b6e519d8cbfbd3108f5020d88f5ca16b766c4e3c1525635a29f99f432f47af4d")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/rbac/integration-tests/__tests__/rbac.spec.ts"
        )
      )
    ).toBe("e8785589b08cd3cce24c2d2d4e8d1698135cd441a29b85096aa0405c0f39490c")
    expect(userScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(userScripts["test:jest"]).toBe(
      "jest --passWithNoTests --bail --forceExit --testPathPattern=src"
    )
    expect(userScripts["test:vitest"]).toBeUndefined()
    expect(userScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(userScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.ts"'
    )
    expect(userScripts["test:integration:vitest"]).toBeUndefined()
    const userConfigTypecheckPath = "./packages/modules/user/vitest.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === userConfigTypecheckPath)
    ).toEqual([userConfigTypecheckPath])
    const userIntegrationConfigTypecheckPath =
      "./packages/modules/user/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === userIntegrationConfigTypecheckPath)
    ).toEqual([userIntegrationConfigTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/user/src/__tests__/static-manifest.spec.ts"
        )
      )
    ).toBe("d1f735b3f46a93975cb9239c92cf604114668258ce04471a1958efce185be4c6")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/user",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/user/tsconfig.json")
      )
    ).toBe("e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/user/vitest.config.mts")
      )
    ).toBe("9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/user/vitest.integration.config.mts"
        )
      )
    ).toBe("d638776636212ba2f0ea0193cad8f63e4b268d44c1aec6be9a4ecf2cdfaf13c7")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/user/integration-tests/__tests__/invite.spec.ts"
        )
      )
    ).toBe("170a1eaee231069615f8af46eac3983b696c69188ae6f0c9509c27068e9124e7")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/user/integration-tests/__tests__/user.spec.ts"
        )
      )
    ).toBe("ab5fcb38ea396d2228451c30163ab74ece2619d5f026971da7d4c5c3535b7ccf")
    expect(salesChannelScripts.test).toBe(
      "vitest run --config vitest.config.mts"
    )
    expect(salesChannelScripts["test:jest"]).toBe(
      "jest --bail --forceExit --testPathPattern=src"
    )
    expect(salesChannelScripts["test:vitest"]).toBeUndefined()
    expect(salesChannelScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(salesChannelScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.ts"'
    )
    expect(salesChannelScripts["test:integration:vitest"]).toBeUndefined()
    const salesChannelConfigTypecheckPath =
      "./packages/modules/sales-channel/vitest.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === salesChannelConfigTypecheckPath)
    ).toEqual([salesChannelConfigTypecheckPath])
    const salesChannelIntegrationConfigTypecheckPath =
      "./packages/modules/sales-channel/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === salesChannelIntegrationConfigTypecheckPath)
    ).toEqual([salesChannelIntegrationConfigTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/sales-channel/src/__tests__/static-manifest.spec.ts"
        )
      )
    ).toBe("d67f28dd8354626308c777f0cccf462295e7ef3753823a5c9af84946019f77bc")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/sales-channel/src/services/__tests__/index.ts"
        )
      )
    ).toBe("3956bd1aefab04aa7dfc836dd78f0029d7378a45b009b82c28d417f9e7df56bf")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/sales-channel",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/sales-channel/tsconfig.json")
      )
    ).toBe("e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/sales-channel/vitest.config.mts"
        )
      )
    ).toBe("9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/sales-channel/vitest.integration.config.mts"
        )
      )
    ).toBe("ab88fc6a6cfe162e0406742ed6e34076d472a77bcf477aa99f37c8ecb3deafbf")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/sales-channel/integration-tests/__tests__/services/sales-channel-module.spec.ts"
        )
      )
    ).toBe("10d9f98b9c52f0e67cdc2584c9d4e0599941ad67c35b2673057f10235230a147")
    expect(customerScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(customerScripts["test:jest"]).toBe(
      "jest --bail --passWithNoTests --forceExit --testPathPattern=src"
    )
    expect(customerScripts["test:vitest"]).toBeUndefined()
    expect(customerScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(customerScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.ts"'
    )
    expect(customerScripts["test:integration:vitest"]).toBeUndefined()
    const customerConfigTypecheckPath =
      "./packages/modules/customer/vitest.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === customerConfigTypecheckPath)
    ).toEqual([customerConfigTypecheckPath])
    const customerIntegrationConfigTypecheckPath =
      "./packages/modules/customer/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === customerIntegrationConfigTypecheckPath)
    ).toEqual([customerIntegrationConfigTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/customer/src/__tests__/static-manifest.spec.ts"
        )
      )
    ).toBe("a21b5ddc9a6c1c782588822b4150b110b9bc454ff3226ab702aa66d851ec9f53")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/customer",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("ee7d6ed8b351066f0fd908d319e8ebd3ee00146b5dc51c36601ac5a21fcd95a9")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/customer/tsconfig.json")
      )
    ).toBe("e4a0e8beb92f159284d70b75a703d41b667a9d84e5e965844fa6bb77a0218086")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/customer/vitest.config.mts")
      )
    ).toBe("52958a368def2a79e1d0cfd5c8278d996f0f6fcd5f948d55124adbb2b9df5935")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/customer/vitest.integration.config.mts"
        )
      )
    ).toBe("6fbdfe940a2039dd405df109ba6d84ee7c636db6507b451092371a752ef057e9")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/customer/integration-tests/__tests__/services/customer-module/index.spec.ts"
        )
      )
    ).toBe("3d90479251097aba0c6e99fdecf89cb474a734d0b4e446ae0230e0f2790a0f0f")
    expect(analyticsScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(analyticsScripts["test:jest"]).toBe(
      "jest --passWithNoTests --bail --forceExit --testPathPattern=src"
    )
    expect(analyticsScripts["test:vitest"]).toBeUndefined()
    expect(analyticsScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(analyticsScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.ts"'
    )
    expect(analyticsScripts["test:integration:vitest"]).toBeUndefined()
    const analyticsConfigTypecheckPath =
      "./packages/modules/analytics/vitest.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === analyticsConfigTypecheckPath)
    ).toEqual([analyticsConfigTypecheckPath])
    const analyticsIntegrationConfigTypecheckPath =
      "./packages/modules/analytics/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === analyticsIntegrationConfigTypecheckPath)
    ).toEqual([analyticsIntegrationConfigTypecheckPath])
    const analyticsProviderFixtureTypecheckPath =
      "./packages/modules/analytics/integration-tests/__fixtures__/providers/default-provider.js"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === analyticsProviderFixtureTypecheckPath)
    ).toEqual([analyticsProviderFixtureTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/analytics/src/__tests__/static-manifest.spec.ts"
        )
      )
    ).toBe("03a35786e94cfff950e1b2fbbb05ae3c1cf4e81023a03e2cadf842b622500ba7")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/analytics/integration-tests/__tests__/module.spec.ts"
        )
      )
    ).toBe("b260f6cbcd3895198d175a97e591ada66e894a6b331c985e551d6799e730851b")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/analytics/integration-tests/__fixtures__/providers/default-provider.js"
        )
      )
    ).toBe("79eba31652a6926ba24984ccb9be3fa9f3a8ae2992a103a1aadf26e7bbba3f14")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/analytics/integration-tests/__fixtures__/providers/index.ts"
        )
      )
    ).toBe("c73070f55df71c562e3b68cdcdbea41c5bdbf5cd8bde1cf17eeaeaa362a58739")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/analytics",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/analytics/tsconfig.json")
      )
    ).toBe("08ed3b294081e2e0d812680fe0a4bf40411fd4e8da918eb4150cb8cce656739b")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/analytics/vitest.config.mts")
      )
    ).toBe("9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/analytics/vitest.integration.config.mts"
        )
      )
    ).toBe("60b74722fe1a4e2e2aec0fe8581613c2f771548f0db6283076a240005a47e727")
    expect(fileScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(fileScripts["test:jest"]).toBe(
      "jest --passWithNoTests --bail --forceExit --testPathPattern=src"
    )
    expect(fileScripts["test:vitest"]).toBeUndefined()
    expect(fileScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(fileScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testTimeout=100000 --testPathPattern="integration-tests/__tests__/.*\\.ts"'
    )
    expect(fileScripts["test:integration:vitest"]).toBeUndefined()
    const fileConfigTypecheckPath = "./packages/modules/file/vitest.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === fileConfigTypecheckPath)
    ).toEqual([fileConfigTypecheckPath])
    const fileIntegrationConfigTypecheckPath =
      "./packages/modules/file/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === fileIntegrationConfigTypecheckPath)
    ).toEqual([fileIntegrationConfigTypecheckPath])
    const fileProviderFixtureTypecheckPath =
      "./packages/modules/file/integration-tests/__fixtures__/providers/default-provider.js"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === fileProviderFixtureTypecheckPath)
    ).toEqual([fileProviderFixtureTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/file/src/__tests__/static-manifest.spec.ts"
        )
      )
    ).toBe("aac4021008c7710bfd70df60e1e5544f165d46da70fccfd6f5f5f330cc0666f0")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/file/src/services/__tests__/file.spec.ts"
        )
      )
    ).toBe("d9ec7e78806642bf72ff8308f88b88353608bf782596615bd57ce9e971e26625")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/file/integration-tests/__tests__/module.spec.ts"
        )
      )
    ).toBe("dd8b415a5cfe357e0d39ee82eca960ac2a8c85d18dcbf1ae8ef525aebeb2cffe")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/file/integration-tests/__fixtures__/providers/default-provider.js"
        )
      )
    ).toBe("1d9fe1a76d9562a6ea8b0deef4c17dca63ecadb51bbd3cabccf2d0faf6665de0")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/file/integration-tests/__fixtures__/providers/index.ts"
        )
      )
    ).toBe("c73070f55df71c562e3b68cdcdbea41c5bdbf5cd8bde1cf17eeaeaa362a58739")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/file",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("ee7d6ed8b351066f0fd908d319e8ebd3ee00146b5dc51c36601ac5a21fcd95a9")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/file/tsconfig.json")
      )
    ).toBe("e4a0e8beb92f159284d70b75a703d41b667a9d84e5e965844fa6bb77a0218086")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/file/vitest.config.mts")
      )
    ).toBe("52958a368def2a79e1d0cfd5c8278d996f0f6fcd5f948d55124adbb2b9df5935")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/file/vitest.integration.config.mts"
        )
      )
    ).toBe("92e1d02f11f99fc1954999aa5f76171556d59d69862bfdcc58040c666eead715")
    expect(stockLocationScripts.test).toBe(
      "vitest run --config vitest.config.mts"
    )
    expect(stockLocationScripts["test:jest"]).toBe(
      "jest --bail --forceExit --testPathPattern=src"
    )
    expect(stockLocationScripts["test:vitest"]).toBeUndefined()
    expect(stockLocationScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(stockLocationScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testTimeout=100000 --testPathPattern="integration-tests/__tests__/.*\\.spec\\.ts"'
    )
    expect(stockLocationScripts["test:integration:vitest"]).toBeUndefined()
    const stockLocationConfigTypecheckPath =
      "./packages/modules/stock-location/vitest.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === stockLocationConfigTypecheckPath)
    ).toEqual([stockLocationConfigTypecheckPath])
    const stockLocationIntegrationConfigTypecheckPath =
      "./packages/modules/stock-location/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter(
          (token) => token === stockLocationIntegrationConfigTypecheckPath
        )
    ).toEqual([stockLocationIntegrationConfigTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/stock-location/src/__tests__/static-manifest.spec.ts"
        )
      )
    ).toBe("8b11425320da87d37da4b7ccc00be4404e87cb188190270abd952e14e4174d62")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/stock-location/src/services/__tests__/noop.ts"
        )
      )
    ).toBe("a8fce584e64fea146c0a551341a1a9e7effd794270765f7bebd9347c4942b75d")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/stock-location/integration-tests/__tests__/stock-location-module-service.spec.ts"
        )
      )
    ).toBe("51aae9196ebdda1242c260f667fe82391d323f28885eb3d0e7cade81f44ad7e6")
    expect(
      readFileSync(
        resolve(
          process.cwd(),
          "packages/modules/stock-location/integration-tests/__tests__/stock-location-module-service.spec.ts"
        ),
        "utf8"
      )
    ).not.toMatch(/\bjest\./)
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/stock-location",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/stock-location/tsconfig.json")
      )
    ).toBe("e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/stock-location/vitest.config.mts"
        )
      )
    ).toBe("9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/stock-location/vitest.integration.config.mts"
        )
      )
    ).toBe("b16f68566d6a5a357f8c38f01fe875cc06ad4f23a5d385a9bdea362a83aa6286")
    expect(inventoryScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(inventoryScripts["test:jest"]).toBe(
      "jest --bail --forceExit --testPathPattern=src"
    )
    expect(inventoryScripts["test:vitest"]).toBeUndefined()
    expect(inventoryScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(inventoryScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testTimeout=100000 --testPathPattern="integration-tests/__tests__/.*\\.spec\\.ts"'
    )
    expect(inventoryScripts["test:integration:vitest"]).toBeUndefined()
    const inventoryConfigTypecheckPath =
      "./packages/modules/inventory/vitest.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === inventoryConfigTypecheckPath)
    ).toEqual([inventoryConfigTypecheckPath])
    const inventoryIntegrationConfigTypecheckPath =
      "./packages/modules/inventory/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === inventoryIntegrationConfigTypecheckPath)
    ).toEqual([inventoryIntegrationConfigTypecheckPath])
    const inventoryJestShimTypecheckPath =
      "./packages/modules/inventory/integration-tests/__fixtures__/vitest-jest-shim.ts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === inventoryJestShimTypecheckPath)
    ).toEqual([inventoryJestShimTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/inventory/src/__tests__/static-manifest.spec.ts"
        )
      )
    ).toBe("d947fbb9c2025911c048ca0bacc2ea3a3056e726557435fdc9d73412a04cb6a4")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/inventory/src/services/__tests__/noop.ts"
        )
      )
    ).toBe("a8fce584e64fea146c0a551341a1a9e7effd794270765f7bebd9347c4942b75d")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/inventory/integration-tests/__tests__/inventory-module-service.spec.ts"
        )
      )
    ).toBe("4cbe73bcd241b83fbae956ff9f95d0a51242d891c853f0ec11c64b8ab8b8594e")
    const inventoryIntegrationSource = readFileSync(
      resolve(
        process.cwd(),
        "packages/modules/inventory/integration-tests/__tests__/inventory-module-service.spec.ts"
      ),
      "utf8"
    )
    expect(inventoryIntegrationSource).toContain('import { vi } from "vitest"')
    expect(inventoryIntegrationSource).toContain("vi.spyOn(")
    expect(inventoryIntegrationSource).not.toMatch(/\bjest\./)
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/inventory/integration-tests/__fixtures__/vitest-jest-shim.ts"
        )
      )
    ).toBe("5bbe1cac9fad3ed79fc388c22225001a9ce2604de585659ce94c61ed24341c9f")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/inventory",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("6f009cd30f3606a3f9960cf1ebad1a3aee13b5a6797c73f764237dbe141b74df")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/inventory/tsconfig.json")
      )
    ).toBe("e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/inventory/vitest.config.mts")
      )
    ).toBe("9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/inventory/vitest.integration.config.mts"
        )
      )
    ).toBe("dd02aab839e0ba3c68a6ecf66775bbf347f5e83e65fec7597ae3393c0ea6e891")
    expect(taxScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(taxScripts["test:jest"]).toBe(
      "jest --bail --forceExit --testPathPattern=src"
    )
    expect(taxScripts["test:vitest"]).toBeUndefined()
    expect(taxScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(taxScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testTimeout=30000 --testPathPattern="integration-tests/__tests__/.*\\.spec\\.ts"'
    )
    expect(taxScripts["test:integration:vitest"]).toBeUndefined()
    const taxConfigTypecheckPath = "./packages/modules/tax/vitest.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === taxConfigTypecheckPath)
    ).toEqual([taxConfigTypecheckPath])
    const taxIntegrationConfigTypecheckPath =
      "./packages/modules/tax/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === taxIntegrationConfigTypecheckPath)
    ).toEqual([taxIntegrationConfigTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/tax/src/__tests__/static-manifest.spec.ts"
        )
      )
    ).toBe("606a49ec17d3582f1eecddb39546d00580d362ad5fc0e783ae839d48797fb1a5")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/tax/src/services/__tests__/noop.ts"
        )
      )
    ).toBe("a8fce584e64fea146c0a551341a1a9e7effd794270765f7bebd9347c4942b75d")
    const taxIntegrationPaths = [
      "packages/modules/tax/integration-tests/__tests__/index.spec.ts",
      "packages/modules/tax/integration-tests/__tests__/local-providers.spec.ts",
    ] as const
    for (const taxIntegrationPath of taxIntegrationPaths) {
      const taxIntegrationSource = readFileSync(
        resolve(process.cwd(), taxIntegrationPath),
        "utf8"
      )
      expect(taxIntegrationSource).not.toMatch(/\bjest\./)
    }
    expect(
      normalizedFileDigest(resolve(process.cwd(), taxIntegrationPaths[0]))
    ).toBe("98c5fa216bd4ad5c4906c25d2fe51ec42bd5f4d75b2013f45bd6946a0b77e15c")
    expect(
      normalizedFileDigest(resolve(process.cwd(), taxIntegrationPaths[1]))
    ).toBe("7c2de340fb6b40ae366b389dc1707731d9d6827ddf9831da5463c9ae70ee02eb")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/tax",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/tax/tsconfig.json")
      )
    ).toBe("e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/tax/vitest.config.mts")
      )
    ).toBe("9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/tax/vitest.integration.config.mts"
        )
      )
    ).toBe("a0f68497784eddae509ae8343d2bfa7f5f79b59e4505dd6f93a5e8291bcf1904")
    expect(paymentScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(paymentScripts["test:jest"]).toBe(
      "jest --bail --passWithNoTests --forceExit --testPathPattern=src"
    )
    expect(paymentScripts["test:vitest"]).toBeUndefined()
    expect(paymentScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(paymentScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testTimeout=30000 --testPathPattern="integration-tests/__tests__/.*\\.ts"'
    )
    expect(paymentScripts["test:integration:vitest"]).toBeUndefined()
    const paymentConfigTypecheckPath =
      "./packages/modules/payment/vitest.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === paymentConfigTypecheckPath)
    ).toEqual([paymentConfigTypecheckPath])
    const paymentSourcePaths = [
      "packages/modules/payment/src/__tests__/static-manifest.spec.ts",
      "packages/modules/payment/src/providers/payment-medusa/utils/__tests__/get-smallest-unit.ts",
    ] as const
    for (const paymentSourcePath of paymentSourcePaths) {
      expect(
        readFileSync(resolve(process.cwd(), paymentSourcePath), "utf8")
      ).not.toMatch(/\bjest\./)
    }
    expect(
      normalizedFileDigest(resolve(process.cwd(), paymentSourcePaths[0]))
    ).toBe("a86c0187a922246316ba0abe373e8f2e728253944ce825207a2cf72180858a7f")
    expect(
      normalizedFileDigest(resolve(process.cwd(), paymentSourcePaths[1]))
    ).toBe("a06631472aab93fbb8e4662224d3a94b971a9420491c8171f940659c476e1f86")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/payment",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("6f009cd30f3606a3f9960cf1ebad1a3aee13b5a6797c73f764237dbe141b74df")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/payment/tsconfig.json")
      )
    ).toBe("e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/payment/vitest.config.mts")
      )
    ).toBe("9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605")
    const paymentIntegrationConfigTypecheckPath =
      "./packages/modules/payment/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === paymentIntegrationConfigTypecheckPath)
    ).toEqual([paymentIntegrationConfigTypecheckPath])
    const paymentVitestJestShimTypecheckPath =
      "./packages/modules/payment/integration-tests/__fixtures__/vitest-jest-shim.ts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === paymentVitestJestShimTypecheckPath)
    ).toEqual([paymentVitestJestShimTypecheckPath])
    const paymentIntegrationPaths = [
      "packages/modules/payment/integration-tests/__tests__/loaders/providers.spec.ts",
      "packages/modules/payment/integration-tests/__tests__/services/payment-module/index.spec.ts",
    ] as const
    for (const paymentIntegrationPath of paymentIntegrationPaths) {
      expect(
        readFileSync(resolve(process.cwd(), paymentIntegrationPath), "utf8")
      ).not.toMatch(/\bjest\./)
    }
    expect(
      normalizedFileDigest(resolve(process.cwd(), paymentIntegrationPaths[0]))
    ).toBe("bebacd56daae80ba6c4e892d9c8c407201d921fd618e341f0a16e865b5be7a54")
    expect(
      normalizedFileDigest(resolve(process.cwd(), paymentIntegrationPaths[1]))
    ).toBe("b652a0bd98258c6154c3715efc9be203cc9d026b834e7788e517cf7521544c45")
    expect(
      readFileSync(
        resolve(process.cwd(), paymentIntegrationPaths[1]),
        "utf8"
      ).match(/\bvi\s*\.\s*(?:clearAllMocks|spyOn)\b/g)
    ).toHaveLength(11)
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/payment/integration-tests/__fixtures__/vitest-jest-shim.ts"
        )
      )
    ).toBe("9f56fd9b178f0ff0b4a145cb07514b2c23f7eab2cc8f026044cb1a6f4a303349")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/payment/vitest.integration.config.mts"
        )
      )
    ).toBe("7fc17334413c0923f9f2669f7159b72ceac9edc85b698577f79dcf23fca2fd66")
    expect(notificationScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(notificationScripts["test:jest"]).toBe(
      "jest --bail --forceExit --passWithNoTests --testPathPattern=src"
    )
    expect(notificationScripts["test:vitest"]).toBeUndefined()
    expect(notificationScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(notificationScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testTimeout=30000 --testPathPattern="integration-tests/__tests__/.*\\.spec\\.ts"'
    )
    expect(notificationScripts["test:integration:vitest"]).toBeUndefined()
    const notificationConfigTypecheckPath =
      "./packages/modules/notification/vitest.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === notificationConfigTypecheckPath)
    ).toEqual([notificationConfigTypecheckPath])
    const notificationSourcePath =
      "packages/modules/notification/src/__tests__/static-manifest.spec.ts"
    expect(
      readFileSync(resolve(process.cwd(), notificationSourcePath), "utf8")
    ).not.toMatch(/\bjest\./)
    expect(
      normalizedFileDigest(resolve(process.cwd(), notificationSourcePath))
    ).toBe("95cfff86f34fc79430044930da2f070c5c2d14d9c0d6860f3fa27b787142ab24")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/notification",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("6f009cd30f3606a3f9960cf1ebad1a3aee13b5a6797c73f764237dbe141b74df")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/notification/tsconfig.json")
      )
    ).toBe("e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/notification/vitest.config.mts"
        )
      )
    ).toBe("9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605")
    const notificationIntegrationConfigTypecheckPath =
      "./packages/modules/notification/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === notificationIntegrationConfigTypecheckPath)
    ).toEqual([notificationIntegrationConfigTypecheckPath])
    const notificationVitestJestShimTypecheckPath =
      "./packages/modules/notification/integration-tests/__fixtures__/vitest-jest-shim.ts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === notificationVitestJestShimTypecheckPath)
    ).toEqual([notificationVitestJestShimTypecheckPath])
    const notificationProviderFixtureTypecheckPath =
      "./packages/modules/notification/integration-tests/__fixtures__/providers/default-provider.js"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === notificationProviderFixtureTypecheckPath)
    ).toEqual([notificationProviderFixtureTypecheckPath])
    const notificationIntegrationPaths = [
      "packages/modules/notification/integration-tests/__tests__/notification-module-service/index.spec.ts",
      "packages/modules/notification/integration-tests/__tests__/notification-module-service/medusa-cloud-email.spec.ts",
    ] as const
    for (const notificationIntegrationPath of notificationIntegrationPaths) {
      expect(
        readFileSync(resolve(process.cwd(), notificationIntegrationPath), "utf8")
      ).not.toMatch(/\bjest\./)
    }
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), notificationIntegrationPaths[0])
      )
    ).toBe("34b9b93617f51ffbbae02e9d8b5cfd5775e8da0817077e7486af6a9b76acf25f")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), notificationIntegrationPaths[1])
      )
    ).toBe("352b3ac4edf62e138413d1398760e2257f2bd036175a16e5480a1a59eeacb00d")
    expect(
      notificationIntegrationPaths
        .flatMap((notificationIntegrationPath) =>
          readFileSync(
            resolve(process.cwd(), notificationIntegrationPath),
            "utf8"
          ).match(/\bvi\s*\.\s*(?:clearAllMocks|spyOn)\b/g)
        )
        .filter(Boolean)
    ).toHaveLength(4)
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/notification/integration-tests/__fixtures__/vitest-jest-shim.ts"
        )
      )
    ).toBe("5bbe1cac9fad3ed79fc388c22225001a9ce2604de585659ce94c61ed24341c9f")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/notification/integration-tests/__fixtures__/providers/default-provider.js"
        )
      )
    ).toBe("0748eaa8c42548c9c762fcbf15041a713d4648c4b366bcd220129c705c6795c4")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/notification/vitest.integration.config.mts"
        )
      )
    ).toBe("a0af3184d01e7cee4d7a4b6c9de437d09b0816586edd6544da23d6e126eae2b5")
    expect(fulfillmentScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(fulfillmentScripts["test:jest"]).toBe(
      "jest --bail --forceExit --passWithNoTests --testPathPattern=src"
    )
    expect(fulfillmentScripts["test:vitest"]).toBeUndefined()
    expect(fulfillmentScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(fulfillmentScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testTimeout=1000000 --testPathPattern="integration-tests/__tests__/.*\\.spec\\.ts"'
    )
    expect(fulfillmentScripts["test:integration:vitest"]).toBeUndefined()
    const fulfillmentConfigTypecheckPath =
      "./packages/modules/fulfillment/vitest.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === fulfillmentConfigTypecheckPath)
    ).toEqual([fulfillmentConfigTypecheckPath])
    const fulfillmentSourcePaths = [
      "packages/modules/fulfillment/src/__tests__/static-manifest.spec.ts",
      "packages/modules/fulfillment/src/utils/__tests__/utils.spec.ts",
    ] as const
    for (const fulfillmentSourcePath of fulfillmentSourcePaths) {
      expect(
        readFileSync(resolve(process.cwd(), fulfillmentSourcePath), "utf8")
      ).not.toMatch(/\bjest\./)
    }
    expect(
      normalizedFileDigest(resolve(process.cwd(), fulfillmentSourcePaths[0]))
    ).toBe("58341ae916ab8db99adc38decfed9716b9f824b941bb6e9d2161741898dc5513")
    expect(
      normalizedFileDigest(resolve(process.cwd(), fulfillmentSourcePaths[1]))
    ).toBe("e70ce448a76561d50f4d816b8d11be1c846cc885bc47ecb2cc435aef6314fa33")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/fulfillment",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("6f009cd30f3606a3f9960cf1ebad1a3aee13b5a6797c73f764237dbe141b74df")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/fulfillment/tsconfig.json")
      )
    ).toBe("e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/fulfillment/vitest.config.mts")
      )
    ).toBe("9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605")
    const fulfillmentIntegrationConfigTypecheckPath =
      "./packages/modules/fulfillment/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === fulfillmentIntegrationConfigTypecheckPath)
    ).toEqual([fulfillmentIntegrationConfigTypecheckPath])
    const fulfillmentVitestJestShimTypecheckPath =
      "./packages/modules/fulfillment/integration-tests/__fixtures__/vitest-jest-shim.ts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === fulfillmentVitestJestShimTypecheckPath)
    ).toEqual([fulfillmentVitestJestShimTypecheckPath])
    const fulfillmentProviderFixtureTypecheckPath =
      "./packages/modules/fulfillment/integration-tests/__fixtures__/providers/default-provider.js"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === fulfillmentProviderFixtureTypecheckPath)
    ).toEqual([fulfillmentProviderFixtureTypecheckPath])
    const fulfillmentIntegrationPaths = [
      "packages/modules/fulfillment/integration-tests/__tests__/fulfillment-module-service/fulfillment-set.spec.ts",
      "packages/modules/fulfillment/integration-tests/__tests__/fulfillment-module-service/fulfillment.spec.ts",
      "packages/modules/fulfillment/integration-tests/__tests__/fulfillment-module-service/geo-zone.spec.ts",
      "packages/modules/fulfillment/integration-tests/__tests__/fulfillment-module-service/index.spec.ts",
      "packages/modules/fulfillment/integration-tests/__tests__/fulfillment-module-service/service-zone.spec.ts",
      "packages/modules/fulfillment/integration-tests/__tests__/fulfillment-module-service/shipping-option.spec.ts",
      "packages/modules/fulfillment/integration-tests/__tests__/fulfillment-module-service/shipping-profile.spec.ts",
    ] as const
    for (const fulfillmentIntegrationPath of fulfillmentIntegrationPaths) {
      expect(
        readFileSync(resolve(process.cwd(), fulfillmentIntegrationPath), "utf8")
      ).not.toMatch(/\bjest\./)
    }
    expect(
      normalizedFileDigest(resolve(process.cwd(), fulfillmentIntegrationPaths[0]))
    ).toBe("9ac73289af9cfc3cc0a72b983db07b4ffa5b26eb9b2a6eea1ec09681d46787bd")
    expect(
      normalizedFileDigest(resolve(process.cwd(), fulfillmentIntegrationPaths[1]))
    ).toBe("fd16c286cea8bb0688a8990d09573b505ce5a6b567314d3d86cf84b6a9e8b8e1")
    expect(
      normalizedFileDigest(resolve(process.cwd(), fulfillmentIntegrationPaths[2]))
    ).toBe("d2f7fb47632a903bbc894f3a45142f6865733fe1bb110a129f6d3862c0924652")
    expect(
      normalizedFileDigest(resolve(process.cwd(), fulfillmentIntegrationPaths[3]))
    ).toBe("5a9c5288d5b13a6b509a9cab68038b176ab4b77c28f035d58fd5184daff80836")
    expect(
      normalizedFileDigest(resolve(process.cwd(), fulfillmentIntegrationPaths[4]))
    ).toBe("90ef5fa26d168eb7dbe38559a617f8dbe27479af2ac553bd7cc25627a87977bd")
    expect(
      normalizedFileDigest(resolve(process.cwd(), fulfillmentIntegrationPaths[5]))
    ).toBe("6c71c8f3dc4c56dcb06efaf5bbd84ff18c166c1bf13b577ce9bfc5213bc7240f")
    expect(
      normalizedFileDigest(resolve(process.cwd(), fulfillmentIntegrationPaths[6]))
    ).toBe("a5a45835b345ffcbb201bb0e7cf4b7a29f53af77cfccd35cf9d8d166d1b524d6")
    expect(
      fulfillmentIntegrationPaths
        .flatMap((fulfillmentIntegrationPath) =>
          readFileSync(
            resolve(process.cwd(), fulfillmentIntegrationPath),
            "utf8"
          ).match(/\bvi\s*\.\s*(?:clearAllMocks|spyOn)\b/g)
        )
        .filter(Boolean)
    ).toHaveLength(28)
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/fulfillment/integration-tests/__fixtures__/vitest-jest-shim.ts"
        )
      )
    ).toBe("9f56fd9b178f0ff0b4a145cb07514b2c23f7eab2cc8f026044cb1a6f4a303349")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/fulfillment/integration-tests/__fixtures__/providers/default-provider.js"
        )
      )
    ).toBe("fe563df707432a8265a28d16a3a7d4fdf5d2fe34d42ec5deca50f5485b70af89")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/fulfillment/vitest.integration.config.mts"
        )
      )
    ).toBe("47a667018ffda86f671667a39570d43aec8f77f311ceafbe138f1ad760ba1626")
    expect(promotionScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(promotionScripts["test:jest"]).toBe(
      "jest --passWithNoTests --bail --forceExit --testPathPattern=src"
    )
    expect(promotionScripts["test:vitest"]).toBeUndefined()
    expect(promotionScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(promotionScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testTimeout=30000 --testPathPattern="integration-tests/__tests__/.*\\.spec\\.ts"'
    )
    expect(promotionScripts["test:integration:vitest"]).toBeUndefined()
    const promotionConfigTypecheckPath =
      "./packages/modules/promotion/vitest.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === promotionConfigTypecheckPath)
    ).toEqual([promotionConfigTypecheckPath])
    const promotionSourcePath =
      "packages/modules/promotion/src/__tests__/static-manifest.spec.ts"
    expect(
      readFileSync(resolve(process.cwd(), promotionSourcePath), "utf8")
    ).not.toMatch(/\bjest\./)
    expect(
      normalizedFileDigest(resolve(process.cwd(), promotionSourcePath))
    ).toBe("77f1d943c9df8495f948fa95ecc40cddc94145d450a313171a134e25f98a2510")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/promotion",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/promotion/tsconfig.json")
      )
    ).toBe("e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/promotion/vitest.config.mts")
      )
    ).toBe("9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605")
    const promotionIntegrationConfigTypecheckPath =
      "./packages/modules/promotion/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === promotionIntegrationConfigTypecheckPath)
    ).toEqual([promotionIntegrationConfigTypecheckPath])
    const promotionIntegrationPaths = [
      "packages/modules/promotion/integration-tests/__tests__/services/promotion-module/campaign.spec.ts",
      "packages/modules/promotion/integration-tests/__tests__/services/promotion-module/compute-actions.spec.ts",
      "packages/modules/promotion/integration-tests/__tests__/services/promotion-module/evaluate-rule-value-condition.spec.ts",
      "packages/modules/promotion/integration-tests/__tests__/services/promotion-module/promotion.spec.ts",
      "packages/modules/promotion/integration-tests/__tests__/services/promotion-module/register-usage.spec.ts",
      "packages/modules/promotion/integration-tests/__tests__/services/promotion-module/revert-usage.spec.ts",
    ] as const
    for (const promotionIntegrationPath of promotionIntegrationPaths) {
      expect(
        readFileSync(resolve(process.cwd(), promotionIntegrationPath), "utf8")
      ).not.toMatch(/\bjest\./)
    }
    expect(
      normalizedFileDigest(resolve(process.cwd(), promotionIntegrationPaths[0]))
    ).toBe("da6744ed2877a227de5abd1927bffdb2f78bf4cc59f71096cbe8a066d8ba4fe9")
    expect(
      normalizedFileDigest(resolve(process.cwd(), promotionIntegrationPaths[1]))
    ).toBe("dc68b1a58f2146f65609eea3a257a5b266a8833381b2a66f74aed0d63d64c955")
    expect(
      normalizedFileDigest(resolve(process.cwd(), promotionIntegrationPaths[2]))
    ).toBe("9c7339c2ad17ee3c86a4ecfb5fbed4084fcca3cdc05c15026b229603a17ddf77")
    expect(
      normalizedFileDigest(resolve(process.cwd(), promotionIntegrationPaths[3]))
    ).toBe("7bfabb53d65d3e3c160c8b336c33ea3249c67ce8c3f30fddb491ec1331dbdf97")
    expect(
      normalizedFileDigest(resolve(process.cwd(), promotionIntegrationPaths[4]))
    ).toBe("a9f0afec8d16aacfe8be2e6ca0ea02b2a2e3e872569dc1e30c8eb5636f6e951b")
    expect(
      normalizedFileDigest(resolve(process.cwd(), promotionIntegrationPaths[5]))
    ).toBe("05a34368aef1b5885c0852f8eb84c1bd40e8eb34130607f6f4c916bb071ba15c")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/promotion/vitest.integration.config.mts"
        )
      )
    ).toBe("7d9e89e67e0c92bbad79870ff5abace16188f9bee9bda3efc07d7142044e4a0b")
    expect(productScripts.test).toBe("vitest run --config vitest.config.mts")
    expect(productScripts["test:jest"]).toBe(
      "jest --bail --forceExit --testPathPattern=src"
    )
    expect(productScripts["test:vitest"]).toBeUndefined()
    expect(productScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(productScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --bail --forceExit --testTimeout=300000 --testPathPattern="integration-tests/__tests__/.*\\.spec\\.ts"'
    )
    expect(productScripts["test:integration:vitest"]).toBeUndefined()
    const productConfigTypecheckPath =
      "./packages/modules/product/vitest.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === productConfigTypecheckPath)
    ).toEqual([productConfigTypecheckPath])
    const productIntegrationConfigTypecheckPath =
      "./packages/modules/product/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === productIntegrationConfigTypecheckPath)
    ).toEqual([productIntegrationConfigTypecheckPath])
    const productSourcePaths = [
      "packages/modules/product/src/__tests__/static-manifest.spec.ts",
      "packages/modules/product/src/services/__tests__/index.ts",
    ] as const
    for (const productSourcePath of productSourcePaths) {
      expect(
        readFileSync(resolve(process.cwd(), productSourcePath), "utf8")
      ).not.toMatch(/\bjest\./)
    }
    expect(
      normalizedFileDigest(resolve(process.cwd(), productSourcePaths[0]))
    ).toBe("52583bc237f1049e4191e4549e8e58a0cfa52b9f279c1902e158fc46c0d4c60b")
    expect(
      normalizedFileDigest(resolve(process.cwd(), productSourcePaths[1]))
    ).toBe("3956bd1aefab04aa7dfc836dd78f0029d7378a45b009b82c28d417f9e7df56bf")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/product",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("21b23ef984feac7fe0f9e132f512513bf8f57e62a5cf92eb861059eb5c774005")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/product/tsconfig.json")
      )
    ).toBe("e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/product/vitest.config.mts")
      )
    ).toBe("9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605")
    const productIntegrationPaths = [
      "packages/modules/product/integration-tests/__tests__/product-category.spec.ts",
      "packages/modules/product/integration-tests/__tests__/product-module-service/events.spec.ts",
      "packages/modules/product/integration-tests/__tests__/product-module-service/product-categories.spec.ts",
      "packages/modules/product/integration-tests/__tests__/product-module-service/product-collections.spec.ts",
      "packages/modules/product/integration-tests/__tests__/product-module-service/product-options.spec.ts",
      "packages/modules/product/integration-tests/__tests__/product-module-service/product-tags.spec.ts",
      "packages/modules/product/integration-tests/__tests__/product-module-service/product-types.spec.ts",
      "packages/modules/product/integration-tests/__tests__/product-module-service/product-variants.spec.ts",
      "packages/modules/product/integration-tests/__tests__/product-module-service/products.spec.ts",
      "packages/modules/product/integration-tests/__tests__/product.spec.ts",
    ] as const
    for (const productIntegrationPath of productIntegrationPaths) {
      expect(
        readFileSync(resolve(process.cwd(), productIntegrationPath), "utf8")
      ).not.toMatch(/\bjest\./)
    }
    expect(
      normalizedFileDigest(resolve(process.cwd(), productIntegrationPaths[0]))
    ).toBe("c724ea052769d3ce2969dad377835a603dfb568edb9c7aecea881ee79a83654b")
    expect(
      normalizedFileDigest(resolve(process.cwd(), productIntegrationPaths[1]))
    ).toBe("3ddc010ae9fe9b397f436a200f28822cb69ae23b019d1141cb0047e93ebc0258")
    expect(
      normalizedFileDigest(resolve(process.cwd(), productIntegrationPaths[2]))
    ).toBe("e8bef28367a3bea5f4888baea12aabdabcd94ff3f265783241b01bf6a6f56bac")
    expect(
      normalizedFileDigest(resolve(process.cwd(), productIntegrationPaths[3]))
    ).toBe("4b955556a5a86efc74e546f57328a7c953ce3dd5b860e5abb417723ab0e3dd04")
    expect(
      normalizedFileDigest(resolve(process.cwd(), productIntegrationPaths[4]))
    ).toBe("eb095c9ebcc8247e17ebd33ec607855af37186c50ca1b6701649c80cbe23320a")
    expect(
      normalizedFileDigest(resolve(process.cwd(), productIntegrationPaths[5]))
    ).toBe("6ecf1cd00d41809bef1f8ce8f9df1e302502b62dda7f8c64ddb5968eff88e810")
    expect(
      normalizedFileDigest(resolve(process.cwd(), productIntegrationPaths[6]))
    ).toBe("dbab7a7b4202ad277f70c7f8d208923eeb21401ed3ad4ce96e4f0bf3af7a3a58")
    expect(
      normalizedFileDigest(resolve(process.cwd(), productIntegrationPaths[7]))
    ).toBe("66a30d18619b2b7032077528a8c8b8d75c05bf958a38e621e97d0cd3264e0a58")
    expect(
      normalizedFileDigest(resolve(process.cwd(), productIntegrationPaths[8]))
    ).toBe("57d77f21e64bf3b4f2b10344a87a9d0ff8dd2f145f4c1c64160e570a6205ea96")
    expect(
      normalizedFileDigest(resolve(process.cwd(), productIntegrationPaths[9]))
    ).toBe("a37ae8e00431ae59499bad02ceb076446210149eb42116541b2643f44c5467b4")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/product/vitest.integration.config.mts"
        )
      )
    ).toBe("f20cbaecb9e09a6e6fe5a4f3260475bf4b33f531e2176a29405505ba3d2f7209")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/product/integration-tests/__fixtures__/vitest-jest-shim.ts"
        )
      )
    ).toBe("9f56fd9b178f0ff0b4a145cb07514b2c23f7eab2cc8f026044cb1a6f4a303349")
    expect(pricingScripts.test).toBe("jest --bail --forceExit --testPathPattern=src")
    expect(pricingScripts["test:jest"]).toBeUndefined()
    expect(pricingScripts["test:vitest"]).toBeUndefined()
    expect(pricingScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(pricingScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testTimeout=30000 --testPathPattern="integration-tests/__tests__/.*\\.ts"'
    )
    expect(pricingScripts["test:integration:vitest"]).toBeUndefined()
    const pricingIntegrationConfigTypecheckPath =
      "./packages/modules/pricing/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === pricingIntegrationConfigTypecheckPath)
    ).toEqual([pricingIntegrationConfigTypecheckPath])
    const pricingVitestJestShimTypecheckPath =
      "./packages/modules/pricing/integration-tests/__fixtures__/vitest-jest-shim.ts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === pricingVitestJestShimTypecheckPath)
    ).toEqual([pricingVitestJestShimTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/pricing/jest.config.js")
      )
    ).toBe("21b23ef984feac7fe0f9e132f512513bf8f57e62a5cf92eb861059eb5c774005")
    expect(
      normalizedFileDigest(resolve(process.cwd(), "packages/modules/pricing/tsconfig.json"))
    ).toBe("e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a")
    const pricingIntegrationPaths = [
      "packages/modules/pricing/integration-tests/__tests__/services/pricing-module/calculate-price.spec.ts",
      "packages/modules/pricing/integration-tests/__tests__/services/pricing-module/index.spec.ts",
      "packages/modules/pricing/integration-tests/__tests__/services/pricing-module/price-list-rule.spec.ts",
      "packages/modules/pricing/integration-tests/__tests__/services/pricing-module/price-list.spec.ts",
      "packages/modules/pricing/integration-tests/__tests__/services/pricing-module/price-rule.spec.ts",
      "packages/modules/pricing/integration-tests/__tests__/services/pricing-module/price-set.spec.ts",
    ] as const
    for (const pricingIntegrationPath of pricingIntegrationPaths) {
      expect(
        readFileSync(resolve(process.cwd(), pricingIntegrationPath), "utf8")
      ).not.toMatch(/\bjest\./)
    }
    expect(
      normalizedFileDigest(resolve(process.cwd(), pricingIntegrationPaths[0]))
    ).toBe("7dd5aac92bd804f8a5b1edbe8e0b06a199e9bde37799229cda198f26aa79ba88")
    expect(
      normalizedFileDigest(resolve(process.cwd(), pricingIntegrationPaths[1]))
    ).toBe("a16044ca8fa438bf5183e9fd234b8722c8369ff817db807061066af1ddda74c2")
    expect(
      normalizedFileDigest(resolve(process.cwd(), pricingIntegrationPaths[2]))
    ).toBe("bc428f2a542cd6fbd96969e177366313989b3cb2b526116cafba58bfbeb677dd")
    expect(
      normalizedFileDigest(resolve(process.cwd(), pricingIntegrationPaths[3]))
    ).toBe("13760eb58d7881b5fff909158a62f5e8586d8aaed0987032ce6eb57fd3d66302")
    expect(
      normalizedFileDigest(resolve(process.cwd(), pricingIntegrationPaths[4]))
    ).toBe("08268ba9d98e93e7efe00ea638b7ab78e7c0f054329a0783a2512905867ae51f")
    expect(
      normalizedFileDigest(resolve(process.cwd(), pricingIntegrationPaths[5]))
    ).toBe("0b79017a3204a179ab75967632781753b1ca08428786b9646203b7f949bb59af")
    expect(
      pricingIntegrationPaths
        .flatMap((pricingIntegrationPath) =>
          readFileSync(
            resolve(process.cwd(), pricingIntegrationPath),
            "utf8"
          ).match(/\bvi\s*\.\s*(?:clearAllMocks|spyOn)\b/g)
        )
        .filter(Boolean)
    ).toHaveLength(4)
    expect(
      readFileSync(
        resolve(
          process.cwd(),
          "packages/modules/pricing/integration-tests/__fixtures__/seed-price-data.ts"
        ),
        "utf8"
      )
    ).not.toMatch(/\bjest\./)
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/pricing/integration-tests/__fixtures__/seed-price-data.ts"
        )
      )
    ).toBe("bba710b9f0a8af4b2b3f9f03a2fab606046952fb63db6706a3e697447afa8c17")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/pricing/integration-tests/__fixtures__/vitest-jest-shim.ts"
        )
      )
    ).toBe("9f56fd9b178f0ff0b4a145cb07514b2c23f7eab2cc8f026044cb1a6f4a303349")
    expect(cartScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(cartScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testTimeout=50000 --testPathPattern="integration-tests/__tests__/.*\\.ts"'
    )
    expect(cartScripts["test:integration:vitest"]).toBeUndefined()
    const cartIntegrationConfigTypecheckPath =
      "./packages/modules/cart/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === cartIntegrationConfigTypecheckPath)
    ).toEqual([cartIntegrationConfigTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/cart/jest.config.js")
      )
    ).toBe("ee7d6ed8b351066f0fd908d319e8ebd3ee00146b5dc51c36601ac5a21fcd95a9")
    expect(
      normalizedFileDigest(resolve(process.cwd(), "packages/modules/cart/tsconfig.json"))
    ).toBe("e4a0e8beb92f159284d70b75a703d41b667a9d84e5e965844fa6bb77a0218086")
    expect(
      readFileSync(
        resolve(
          process.cwd(),
          "packages/modules/cart/integration-tests/__tests__/services/cart-module/index.spec.ts"
        ),
        "utf8"
      )
    ).not.toMatch(/\bjest\./)
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/cart/integration-tests/__tests__/services/cart-module/index.spec.ts"
        )
      )
    ).toBe("165fae5b2cf73d867d215639e77376e9330ccb21d45a2cb02babc11df392e708")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/cart/vitest.integration.config.mts")
      )
    ).toBe("ab328aa63436deb6c6dc04b12df0a7f65a9b89061403c6fab44625fc509f3c20")
    expect(orderScripts["test:integration"]).toBe(
      'jest --passWithNoTests --forceExit --testTimeout=1000000 --testPathPattern="integration-tests/__tests__/.*\\.spec\\.ts"'
    )
    expect(orderScripts["test:integration:jest"]).toBeUndefined()
    expect(orderScripts["test:integration:vitest"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    const orderIntegrationConfigTypecheckPath =
      "./packages/modules/order/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === orderIntegrationConfigTypecheckPath)
    ).toEqual([orderIntegrationConfigTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/order/jest.config.js")
      )
    ).toBe("22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76")
    expect(
      normalizedFileDigest(resolve(process.cwd(), "packages/modules/order/tsconfig.json"))
    ).toBe("e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a")
    const orderIntegrationPaths = [
      "packages/modules/order/integration-tests/__tests__/create-order.spec.ts",
      "packages/modules/order/integration-tests/__tests__/delete-order.spec.ts",
      "packages/modules/order/integration-tests/__tests__/index.spec.ts",
      "packages/modules/order/integration-tests/__tests__/order-claim.spec.ts",
      "packages/modules/order/integration-tests/__tests__/order-edit.spec.ts",
      "packages/modules/order/integration-tests/__tests__/order-exchange.spec.ts",
      "packages/modules/order/integration-tests/__tests__/order-items-shipping.spec.ts",
      "packages/modules/order/integration-tests/__tests__/order-return.spec.ts",
      "packages/modules/order/integration-tests/__tests__/returns.spec.ts",
    ] as const
    for (const orderIntegrationPath of orderIntegrationPaths) {
      expect(
        readFileSync(resolve(process.cwd(), orderIntegrationPath), "utf8")
      ).not.toMatch(/\bjest\./)
    }
    expect(
      normalizedFileDigest(resolve(process.cwd(), orderIntegrationPaths[0]))
    ).toBe("6b16516a1d9e43ee0127ca372459bb05ec5629ef8fdc2d943b9768835f46a06f")
    expect(
      normalizedFileDigest(resolve(process.cwd(), orderIntegrationPaths[1]))
    ).toBe("939c6b5adf5a9f988d89346d122aa3c5cfc42b25c9a7a4b0a86898cbedef675e")
    expect(
      normalizedFileDigest(resolve(process.cwd(), orderIntegrationPaths[2]))
    ).toBe("4641c774b62745dc70614c9cdca1721e27e62bce9cf9393f0af1195d8963e979")
    expect(
      normalizedFileDigest(resolve(process.cwd(), orderIntegrationPaths[3]))
    ).toBe("4bcf6bbdf207e4d002ec52fd2db9186a1e4d462e05299f0db81a98906c0a5ef6")
    expect(
      normalizedFileDigest(resolve(process.cwd(), orderIntegrationPaths[4]))
    ).toBe("69c26df152d05c7c98c5d7e1de7ddcad839816a537ba9864ca3ef4f601c57a51")
    expect(
      normalizedFileDigest(resolve(process.cwd(), orderIntegrationPaths[5]))
    ).toBe("86f0420a6bb9a3327036d21c9d4c8329d0dd48ef04c5cf9b8da27e3a55d523ce")
    expect(
      normalizedFileDigest(resolve(process.cwd(), orderIntegrationPaths[6]))
    ).toBe("316320c8adc19ce8c6de8b676d2f1e107cfd43d27944708f81b48383473d7f67")
    expect(
      normalizedFileDigest(resolve(process.cwd(), orderIntegrationPaths[7]))
    ).toBe("c4c281d6ce1a2189ac8202c53e34198532b284d1e4dc476a5b627bbcb7f9d364")
    expect(
      normalizedFileDigest(resolve(process.cwd(), orderIntegrationPaths[8]))
    ).toBe("2fb9823f42a19ea2929177d189dbb2ddcffef1151e5c2ce928974c42a29dd5e6")
    expect(
      normalizedFileDigest(
        resolve(process.cwd(), "packages/modules/order/vitest.integration.config.mts")
      )
    ).toBe("80e8d881b3de8c0f6226a7861fcd67979485db13f332a6f4282c682180f25de3")
    expect(rootScripts["check:auth-emailpass-integration"]).toBeUndefined()
    expect(authScripts.test).toBeUndefined()
    expect(authScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(authScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.spec\\.ts"'
    )
    expect(authScripts["test:integration:vitest"]).toBeUndefined()
    expect(rootScripts["check:auth-github-integration"]).toBeUndefined()
    expect(githubScripts.test).toBeUndefined()
    expect(githubScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(githubScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.spec\\.ts"'
    )
    expect(githubScripts["test:integration:vitest"]).toBeUndefined()
    const githubConfigTypecheckPath =
      "./packages/modules/providers/auth-github/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === githubConfigTypecheckPath)
    ).toEqual([githubConfigTypecheckPath])
    expect(rootScripts["check:auth-google-integration"]).toBeUndefined()
    expect(googleScripts.test).toBeUndefined()
    expect(googleScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(googleScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.spec\\.ts"'
    )
    expect(googleScripts["test:integration:vitest"]).toBeUndefined()
    const googleConfigTypecheckPath =
      "./packages/modules/providers/auth-google/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === googleConfigTypecheckPath)
    ).toEqual([googleConfigTypecheckPath])
    expect(rootScripts["check:file-local-integration"]).toBeUndefined()
    expect(fileLocalScripts.test).toBeUndefined()
    expect(fileLocalScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(fileLocalScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/[^/]*\\.spec\\.ts"'
    )
    expect(fileLocalScripts["test:integration:vitest"]).toBeUndefined()
    expect(fileLocalDevDependencies["@medusajs/utils"]).toBe("workspace:*")
    const fileLocalConfigTypecheckPath =
      "./packages/modules/providers/file-local/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === fileLocalConfigTypecheckPath)
    ).toEqual([fileLocalConfigTypecheckPath])
    expect(rootScripts["check:file-s3-integration"]).toBeUndefined()
    expect(fileS3Scripts.test).toBeUndefined()
    expect(fileS3Scripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(fileS3Scripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/[^/]*\\.spec\\.ts"'
    )
    expect(fileS3Scripts["test:integration:vitest"]).toBeUndefined()
    expect(fileS3DevDependencies.axios).toBe("^1.13.1")
    expect(fileS3Dependencies.axios).toBeUndefined()
    const fileS3ConfigTypecheckPath =
      "./packages/modules/providers/file-s3/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === fileS3ConfigTypecheckPath)
    ).toEqual([fileS3ConfigTypecheckPath])
    expect(rootScripts["check:notification-local-integration"]).toBeUndefined()
    expect(notificationLocalScripts.test).toBeUndefined()
    expect(notificationLocalScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(notificationLocalScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.spec\\.ts"'
    )
    expect(notificationLocalScripts["test:integration:vitest"]).toBeUndefined()
    const notificationLocalConfigTypecheckPath =
      "./packages/modules/providers/notification-local/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === notificationLocalConfigTypecheckPath)
    ).toEqual([notificationLocalConfigTypecheckPath])
    expect(
      rootScripts["check:notification-sendgrid-integration"]
    ).toBeUndefined()
    expect(notificationSendgridScripts.test).toBeUndefined()
    expect(notificationSendgridScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(notificationSendgridScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.spec\\.ts"'
    )
    expect(
      notificationSendgridScripts["test:integration:vitest"]
    ).toBeUndefined()
    expect(notificationSendgridDevDependencies["@medusajs/framework"]).toBe(
      "workspace:*"
    )
    expect(notificationSendgridDependencies["@sendgrid/mail"]).toBe("^8.1.6")
    expect(notificationSendgridPeerDependencies["@medusajs/framework"]).toBe(
      "workspace:*"
    )
    const notificationSendgridConfigTypecheckPath =
      "./packages/modules/providers/notification-sendgrid/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === notificationSendgridConfigTypecheckPath)
    ).toEqual([notificationSendgridConfigTypecheckPath])
    expect(rootScripts["check:locking-postgres-integration"]).toBeUndefined()
    expect(lockingPostgresScripts.test).toBeUndefined()
    expect(lockingPostgresScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(lockingPostgresScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.spec\\.ts"'
    )
    expect(lockingPostgresScripts["test:integration:vitest"]).toBeUndefined()
    expect(lockingPostgresPackage.dependencies).toBeUndefined()
    expect(lockingPostgresDevDependencies["@medusajs/framework"]).toBe(
      "workspace:*"
    )
    expect(lockingPostgresPeerDependencies["@medusajs/framework"]).toBe(
      "workspace:*"
    )
    const lockingPostgresConfigTypecheckPath =
      "./packages/modules/providers/locking-postgres/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === lockingPostgresConfigTypecheckPath)
    ).toEqual([lockingPostgresConfigTypecheckPath])
    expect(lockingRedisScripts.test).toBeUndefined()
    expect(lockingRedisScripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts"
    )
    expect(lockingRedisScripts["test:integration:jest"]).toBe(
      'jest --passWithNoTests --testPathPattern="integration-tests/__tests__/.*\\.spec\\.ts"'
    )
    expect(lockingRedisScripts["test:integration:vitest"]).toBeUndefined()
    expect(lockingRedisDependencies.ioredis).toBe("^5.4.1")
    expect(lockingRedisDevDependencies["@medusajs/framework"]).toBe(
      "workspace:*"
    )
    expect(lockingRedisPeerDependencies["@medusajs/framework"]).toBe(
      "workspace:*"
    )
    const lockingRedisConfigTypecheckPath =
      "./packages/modules/providers/locking-redis/vitest.integration.config.mts"
    expect(
      toolingTypecheckCommand
        .split(/\s+/)
        .filter((token) => token === lockingRedisConfigTypecheckPath)
    ).toEqual([lockingRedisConfigTypecheckPath])
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/auth-emailpass/integration-tests/__tests__/services.spec.ts"
        )
      )
    ).toBe("6892c74183528270d00d64bce8c0769a165aada8d45c8b3c64e819ca81689645")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/auth-emailpass",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/auth-emailpass/vitest.integration.config.mts"
        )
      )
    ).toBe("3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/auth-github/integration-tests/__tests__/services.spec.ts"
        )
      )
    ).toBe("1679ec9a5a3da285a95ac0d170f9376f661a6d3f1c076199baa196e75aab42c8")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/auth-github",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/auth-github/vitest.integration.config.mts"
        )
      )
    ).toBe("3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/auth-google/integration-tests/__tests__/services.spec.ts"
        )
      )
    ).toBe("3ac8100ddd8f69b15c8161dfb1ebd2fbe681d195f1577eaf790e24a198d19a4d")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/auth-google",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/auth-google/vitest.integration.config.mts"
        )
      )
    ).toBe("3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/file-local/integration-tests/__tests__/services.spec.ts"
        )
      )
    ).toBe("a71b84503c0c2214552e4705b8094c7bb3bd930b683a9c92d15c6e5eb5aa4a01")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/file-local",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/file-local/vitest.integration.config.mts"
        )
      )
    ).toBe("3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241")
    expect(
      fileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/file-local/integration-tests/__fixtures__/catphoto.jpg"
        )
      )
    ).toBe("68ca5bf09d8850ea11adc9f6a1dd0660dc52a4ec900a5f9cfb718673a2e01268")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/file-s3/integration-tests/__tests__/services.spec.ts"
        )
      )
    ).toBe("3061da765a3afd73cc117f119d104af3205705304efef426f08c794fc4b0410b")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/file-s3",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/file-s3/vitest.integration.config.mts"
        )
      )
    ).toBe("3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241")
    expect(
      fileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/file-s3/integration-tests/__fixtures__/catphoto.jpg"
        )
      )
    ).toBe("68ca5bf09d8850ea11adc9f6a1dd0660dc52a4ec900a5f9cfb718673a2e01268")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/notification-local/integration-tests/__tests__/services.spec.ts"
        )
      )
    ).toBe("c9b0e5be6be8dce37d0f0d2baf38f2b030a9c1e7d40e103170c433196587b4b6")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/notification-local",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/notification-local/vitest.integration.config.mts"
        )
      )
    ).toBe("3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/notification-sendgrid/integration-tests/__tests__/services.spec.ts"
        )
      )
    ).toBe("a4c687431dc46a9c8c535fe3ac13ac96eda8b7e8a39546288dad9bb2bc7695f8")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/notification-sendgrid",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/notification-sendgrid/vitest.integration.config.mts"
        )
      )
    ).toBe("3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/locking-postgres/integration-tests/__tests__/index.spec.ts"
        )
      )
    ).toBe("027b840cb2e10e1d9286456a430c30f2df7f8b69bb1a8b87cc5b9253e09b3b8d")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/locking-postgres",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/locking-postgres/vitest.integration.config.mts"
        )
      )
    ).toBe("69b01480ab6cce348730a134543f7c5ef37a29f23f55f54e787cac831d7eb632")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/locking-redis/integration-tests/__tests__/index.spec.ts"
        )
      )
    ).toBe("71ba55deaa77220ed6bb4ce47751d5099c10255b0ec76ca77be5a1de21ae7ab7")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/locking-redis",
          ["jest", "config.js"].join(".")
        )
      )
    ).toBe("5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8")
    expect(
      normalizedFileDigest(
        resolve(
          process.cwd(),
          "packages/modules/providers/locking-redis/vitest.integration.config.mts"
        )
      )
    ).toBe("69b01480ab6cce348730a134543f7c5ef37a29f23f55f54e787cac831d7eb632")

    const workflow = requireRecord(
      load(
        readFileSync(
          resolve(process.cwd(), ".github/workflows/action.yml"),
          "utf8"
        )
      ),
      "workflow"
    )
    const jobs = requireRecord(workflow.jobs, "workflow.jobs")
    expect(jobs["fulfillment-integration"]).toBeUndefined()
    expect(jobs["promotion-integration"]).toBeUndefined()
    expect(jobs["product-integration"]).toBeUndefined()
    const packageMatrixJob = requireRecord(
      jobs["integration-tests-packages-matrix"],
      "workflow.jobs.integration-tests-packages-matrix"
    )
    const packageMatrixStrategy = requireRecord(
      packageMatrixJob.strategy,
      "workflow.jobs.integration-tests-packages-matrix.strategy"
    )
    const packageMatrix = requireRecord(
      packageMatrixStrategy.matrix,
      "workflow.jobs.integration-tests-packages-matrix.strategy.matrix"
    )
    const packageMatrixSteps = requireSteps(
      packageMatrixJob.steps,
      "workflow.jobs.integration-tests-packages-matrix.steps"
    )

    expect(packageMatrix).toMatchObject({
      group: ["slow", "fast"],
      shard_index: [1, 2, 3],
    })
    expect(packageMatrixSteps).toContainEqual(
      expect.objectContaining({
        run: "pnpm test:integration:packages:${{ matrix.group }} -- --shard=${{ matrix.shard_index }}/3 --maxWorkers=${{ steps.cpu-cores.outputs.count }}",
      })
    )

    const packageAggregateJob = requireRecord(
      jobs["integration-tests-packages"],
      "workflow.jobs.integration-tests-packages"
    )
    const packageAggregateSteps = requireSteps(
      packageAggregateJob.steps,
      "workflow.jobs.integration-tests-packages.steps"
    )
    const packageAggregateFailure = packageAggregateSteps.find(
      (step) => step.run === "exit 1"
    )
    const packageAggregateSuccess = packageAggregateSteps.find(
      (step) => step.run === "exit 0"
    )

    expect(packageAggregateJob.needs).toEqual([
      "integration-tests-packages-matrix",
      "currency-integration-shadow",
      "api-key-integration",
      "translation-integration",
      "settings-integration",
      "store-integration",
      "region-integration",
      "rbac-integration",
      "sales-channel-integration",
      "stock-location-integration",
      "inventory-integration",
      "tax-integration",
      "payment-integration",
      "notification-integration",
      "auth-emailpass-integration",
      "auth-github-integration",
      "auth-google-integration",
      "file-local-integration",
      "file-s3-integration",
      "notification-local-integration",
      "notification-sendgrid-integration",
      "locking-postgres-integration",
      "locking-redis-integration",
    ])
    expect(packageAggregateJob["continue-on-error"]).toBeUndefined()
    expect(packageAggregateSteps).toStrictEqual([
      {
        if: packageAggregateFailure?.if,
        run: "exit 1",
      },
      {
        if: packageAggregateSuccess?.if,
        run: "exit 0",
      },
    ])
    expect(
      normalizeWhitespace(
        requireString(
          packageAggregateJob.if,
          "workflow.jobs.integration-tests-packages.if"
        )
      )
    ).toBe("${{ always() }}")
    expect(
      normalizeWhitespace(
        requireString(
          packageAggregateFailure?.if,
          "workflow.jobs.integration-tests-packages failure condition"
        )
      )
    ).toBe(
      [
        "${{",
        "contains(needs.integration-tests-packages-matrix.result, 'failure')",
        "|| contains(needs.integration-tests-packages-matrix.result, 'cancelled')",
        "|| contains(needs.integration-tests-packages-matrix.result, 'skipped')",
        "|| contains(needs.currency-integration-shadow.result, 'failure')",
        "|| contains(needs.currency-integration-shadow.result, 'cancelled')",
        "|| contains(needs.currency-integration-shadow.result, 'skipped')",
        "|| contains(needs.api-key-integration.result, 'failure')",
        "|| contains(needs.api-key-integration.result, 'cancelled')",
        "|| contains(needs.api-key-integration.result, 'skipped')",
        "|| contains(needs.translation-integration.result, 'failure')",
        "|| contains(needs.translation-integration.result, 'cancelled')",
        "|| contains(needs.translation-integration.result, 'skipped')",
        "|| contains(needs.settings-integration.result, 'failure')",
        "|| contains(needs.settings-integration.result, 'cancelled')",
        "|| contains(needs.settings-integration.result, 'skipped')",
        "|| contains(needs.store-integration.result, 'failure')",
        "|| contains(needs.store-integration.result, 'cancelled')",
        "|| contains(needs.store-integration.result, 'skipped')",
        "|| contains(needs.region-integration.result, 'failure')",
        "|| contains(needs.region-integration.result, 'cancelled')",
        "|| contains(needs.region-integration.result, 'skipped')",
        "|| contains(needs.rbac-integration.result, 'failure')",
        "|| contains(needs.rbac-integration.result, 'cancelled')",
        "|| contains(needs.rbac-integration.result, 'skipped')",
        "|| contains(needs.sales-channel-integration.result, 'failure')",
        "|| contains(needs.sales-channel-integration.result, 'cancelled')",
        "|| contains(needs.sales-channel-integration.result, 'skipped')",
        "|| contains(needs.stock-location-integration.result, 'failure')",
        "|| contains(needs.stock-location-integration.result, 'cancelled')",
        "|| contains(needs.stock-location-integration.result, 'skipped')",
        "|| contains(needs.inventory-integration.result, 'failure')",
        "|| contains(needs.inventory-integration.result, 'cancelled')",
        "|| contains(needs.inventory-integration.result, 'skipped')",
        "|| contains(needs.tax-integration.result, 'failure')",
        "|| contains(needs.tax-integration.result, 'cancelled')",
        "|| contains(needs.tax-integration.result, 'skipped')",
        "|| contains(needs.payment-integration.result, 'failure')",
        "|| contains(needs.payment-integration.result, 'cancelled')",
        "|| contains(needs.payment-integration.result, 'skipped')",
        "|| contains(needs.notification-integration.result, 'failure')",
        "|| contains(needs.notification-integration.result, 'cancelled')",
        "|| contains(needs.notification-integration.result, 'skipped')",
        "|| contains(needs.auth-emailpass-integration.result, 'failure')",
        "|| contains(needs.auth-emailpass-integration.result, 'cancelled')",
        "|| contains(needs.auth-emailpass-integration.result, 'skipped')",
        "|| contains(needs.auth-github-integration.result, 'failure')",
        "|| contains(needs.auth-github-integration.result, 'cancelled')",
        "|| contains(needs.auth-github-integration.result, 'skipped')",
        "|| contains(needs.auth-google-integration.result, 'failure')",
        "|| contains(needs.auth-google-integration.result, 'cancelled')",
        "|| contains(needs.auth-google-integration.result, 'skipped')",
        "|| contains(needs.file-local-integration.result, 'failure')",
        "|| contains(needs.file-local-integration.result, 'cancelled')",
        "|| contains(needs.file-local-integration.result, 'skipped')",
        "|| contains(needs.file-s3-integration.result, 'failure')",
        "|| contains(needs.file-s3-integration.result, 'cancelled')",
        "|| contains(needs.file-s3-integration.result, 'skipped')",
        "|| contains(needs.notification-local-integration.result, 'failure')",
        "|| contains(needs.notification-local-integration.result, 'cancelled')",
        "|| contains(needs.notification-local-integration.result, 'skipped')",
        "|| contains(needs.notification-sendgrid-integration.result, 'failure')",
        "|| contains(needs.notification-sendgrid-integration.result, 'cancelled')",
        "|| contains(needs.notification-sendgrid-integration.result, 'skipped')",
        "|| contains(needs.locking-postgres-integration.result, 'failure')",
        "|| contains(needs.locking-postgres-integration.result, 'cancelled')",
        "|| contains(needs.locking-postgres-integration.result, 'skipped')",
        "|| contains(needs.locking-redis-integration.result, 'failure')",
        "|| contains(needs.locking-redis-integration.result, 'cancelled')",
        "|| contains(needs.locking-redis-integration.result, 'skipped')",
        "}}",
      ].join(" ")
    )
    expect(
      normalizeWhitespace(
        requireString(
          packageAggregateSuccess?.if,
          "workflow.jobs.integration-tests-packages success condition"
        )
      )
    ).toBe(
      [
        "${{",
        "contains(needs.integration-tests-packages-matrix.result, 'success')",
        "&& contains(needs.currency-integration-shadow.result, 'success')",
        "&& contains(needs.api-key-integration.result, 'success')",
        "&& contains(needs.translation-integration.result, 'success')",
        "&& contains(needs.settings-integration.result, 'success')",
        "&& contains(needs.store-integration.result, 'success')",
        "&& contains(needs.region-integration.result, 'success')",
        "&& contains(needs.rbac-integration.result, 'success')",
        "&& contains(needs.sales-channel-integration.result, 'success')",
        "&& contains(needs.stock-location-integration.result, 'success')",
        "&& contains(needs.inventory-integration.result, 'success')",
        "&& contains(needs.tax-integration.result, 'success')",
        "&& contains(needs.payment-integration.result, 'success')",
        "&& contains(needs.notification-integration.result, 'success')",
        "&& contains(needs.auth-emailpass-integration.result, 'success')",
        "&& contains(needs.auth-github-integration.result, 'success')",
        "&& contains(needs.auth-google-integration.result, 'success')",
        "&& contains(needs.file-local-integration.result, 'success')",
        "&& contains(needs.file-s3-integration.result, 'success')",
        "&& contains(needs.notification-local-integration.result, 'success')",
        "&& contains(needs.notification-sendgrid-integration.result, 'success')",
        "&& contains(needs.locking-postgres-integration.result, 'success')",
        "&& contains(needs.locking-redis-integration.result, 'success')",
        "}}",
      ].join(" ")
    )

    const pgliteJob = requireRecord(
      jobs["integration-tests-pglite"],
      "workflow.jobs.integration-tests-pglite"
    )
    const pgliteSteps = requireSteps(
      pgliteJob.steps,
      "workflow.jobs.integration-tests-pglite.steps"
    )

    expect(pgliteSteps.filter((step) => typeof step.run === "string")).toEqual([
      expect.objectContaining({
        run: "pnpm test:integration:pglite",
      }),
    ])

    const shadowJob = requireRecord(
      jobs["currency-integration-shadow"],
      "workflow.jobs.currency-integration-shadow"
    )
    const services = requireRecord(
      shadowJob.services,
      "workflow.jobs.currency-integration-shadow.services"
    )
    const shadowSteps = requireSteps(
      shadowJob.steps,
      "workflow.jobs.currency-integration-shadow.steps"
    )
    const shadowRunStep = shadowSteps.find(
      (step) => step.run === "pnpm check:currency-integration-shadow"
    )

    expect(shadowJob).toMatchObject({
      name: "Currency Integration Shadow",
      needs: "setup",
      "timeout-minutes": 10,
    })
    expect(shadowJob.strategy).toBeUndefined()
    expect(Object.keys(services)).toEqual(["postgres"])
    expect(shadowRunStep).toMatchObject({
      env: {
        DB_HOST: "127.0.0.1",
        DB_PASSWORD: "postgres",
        DB_PORT: "5432",
        DB_USERNAME: "postgres",
      },
      run: "pnpm check:currency-integration-shadow",
    })
    expect(String(shadowJob.name)).not.toMatch(/\bjest\b/i)

    const apiKeyJob = requireRecord(
      jobs["api-key-integration"],
      "workflow.jobs.api-key-integration"
    )
    const apiKeyServices = requireRecord(
      apiKeyJob.services,
      "workflow.jobs.api-key-integration.services"
    )
    const apiKeyPostgresService = requireRecord(
      apiKeyServices.postgres,
      "workflow.jobs.api-key-integration.services.postgres"
    )
    const apiKeySteps = requireSteps(
      apiKeyJob.steps,
      "workflow.jobs.api-key-integration.steps"
    )
    const apiKeyJobName = requireString(
      apiKeyJob.name,
      "workflow.jobs.api-key-integration.name"
    )

    expect(apiKeyJob).toMatchObject({
      name: "API Key Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(apiKeyJob.env).toBeUndefined()
    expect(apiKeyJob.strategy).toBeUndefined()
    expect(Object.keys(apiKeyServices)).toEqual(["postgres"])
    expect(apiKeyPostgresService).toEqual({
      image: "postgres",
      env: {
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_USER: "postgres",
      },
      options:
        "--health-cmd pg_isready --health-interval 1s --health-timeout 10s --health-retries 10",
      ports: ["5432:5432"],
    })
    expect(apiKeySteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        env: {
          DB_HOST: "127.0.0.1",
          DB_PASSWORD: "postgres",
          DB_PORT: "5432",
          DB_USERNAME: "postgres",
        },
        name: "Run API Key integration",
        run: "pnpm --filter @medusajs/api-key test:integration",
      },
    ])
    expect(apiKeyJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const translationJob = requireRecord(
      jobs["translation-integration"],
      "workflow.jobs.translation-integration"
    )
    const translationServices = requireRecord(
      translationJob.services,
      "workflow.jobs.translation-integration.services"
    )
    const translationPostgresService = requireRecord(
      translationServices.postgres,
      "workflow.jobs.translation-integration.services.postgres"
    )
    const translationSteps = requireSteps(
      translationJob.steps,
      "workflow.jobs.translation-integration.steps"
    )
    const translationJobName = requireString(
      translationJob.name,
      "workflow.jobs.translation-integration.name"
    )

    expect(translationJob).toMatchObject({
      name: "Translation Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(translationJob.env).toBeUndefined()
    expect(translationJob.strategy).toBeUndefined()
    expect(Object.keys(translationServices)).toEqual(["postgres"])
    expect(translationPostgresService).toEqual({
      image: "postgres",
      env: {
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_USER: "postgres",
      },
      options:
        "--health-cmd pg_isready --health-interval 1s --health-timeout 10s --health-retries 10",
      ports: ["5432:5432"],
    })
    expect(translationSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        env: {
          DB_HOST: "127.0.0.1",
          DB_PASSWORD: "postgres",
          DB_PORT: "5432",
          DB_USERNAME: "postgres",
        },
        name: "Run Translation integration",
        run: "pnpm --filter @medusajs/translation test:integration",
      },
    ])
    expect(translationJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const settingsJob = requireRecord(
      jobs["settings-integration"],
      "workflow.jobs.settings-integration"
    )
    const settingsServices = requireRecord(
      settingsJob.services,
      "workflow.jobs.settings-integration.services"
    )
    const settingsPostgresService = requireRecord(
      settingsServices.postgres,
      "workflow.jobs.settings-integration.services.postgres"
    )
    const settingsSteps = requireSteps(
      settingsJob.steps,
      "workflow.jobs.settings-integration.steps"
    )
    const settingsJobName = requireString(
      settingsJob.name,
      "workflow.jobs.settings-integration.name"
    )

    expect(settingsJob).toMatchObject({
      name: "Settings Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(settingsJob.env).toBeUndefined()
    expect(settingsJob.strategy).toBeUndefined()
    expect(Object.keys(settingsServices)).toEqual(["postgres"])
    expect(settingsPostgresService).toEqual({
      image: "postgres",
      env: {
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_USER: "postgres",
      },
      options:
        "--health-cmd pg_isready --health-interval 1s --health-timeout 10s --health-retries 10",
      ports: ["5432:5432"],
    })
    expect(settingsSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        env: {
          DB_HOST: "127.0.0.1",
          DB_PASSWORD: "postgres",
          DB_PORT: "5432",
          DB_USERNAME: "postgres",
        },
        name: "Run Settings integration",
        run: "pnpm --filter @medusajs/settings test:integration",
      },
    ])
    expect(settingsJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const storeJob = requireRecord(
      jobs["store-integration"],
      "workflow.jobs.store-integration"
    )
    const storeServices = requireRecord(
      storeJob.services,
      "workflow.jobs.store-integration.services"
    )
    const storePostgresService = requireRecord(
      storeServices.postgres,
      "workflow.jobs.store-integration.services.postgres"
    )
    const storeSteps = requireSteps(
      storeJob.steps,
      "workflow.jobs.store-integration.steps"
    )
    const storeJobName = requireString(
      storeJob.name,
      "workflow.jobs.store-integration.name"
    )

    expect(storeJob).toMatchObject({
      name: "Store Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(storeJob.env).toBeUndefined()
    expect(storeJob.strategy).toBeUndefined()
    expect(Object.keys(storeServices)).toEqual(["postgres"])
    expect(storePostgresService).toEqual({
      image: "postgres",
      env: {
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_USER: "postgres",
      },
      options:
        "--health-cmd pg_isready --health-interval 1s --health-timeout 10s --health-retries 10",
      ports: ["5432:5432"],
    })
    expect(storeSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        env: {
          DB_HOST: "127.0.0.1",
          DB_PASSWORD: "postgres",
          DB_PORT: "5432",
          DB_USERNAME: "postgres",
        },
        name: "Run Store integration",
        run: "pnpm --filter @medusajs/store test:integration",
      },
    ])
    expect(storeJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const regionJob = requireRecord(
      jobs["region-integration"],
      "workflow.jobs.region-integration"
    )
    const regionServices = requireRecord(
      regionJob.services,
      "workflow.jobs.region-integration.services"
    )
    const regionPostgresService = requireRecord(
      regionServices.postgres,
      "workflow.jobs.region-integration.services.postgres"
    )
    const regionSteps = requireSteps(
      regionJob.steps,
      "workflow.jobs.region-integration.steps"
    )
    const regionJobName = requireString(
      regionJob.name,
      "workflow.jobs.region-integration.name"
    )

    expect(regionJob).toMatchObject({
      name: "Region Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(regionJob.env).toBeUndefined()
    expect(regionJob.strategy).toBeUndefined()
    expect(Object.keys(regionServices)).toEqual(["postgres"])
    expect(regionPostgresService).toEqual({
      image: "postgres",
      env: {
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_USER: "postgres",
      },
      options:
        "--health-cmd pg_isready --health-interval 1s --health-timeout 10s --health-retries 10",
      ports: ["5432:5432"],
    })
    expect(regionSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        env: {
          DB_HOST: "127.0.0.1",
          DB_PASSWORD: "postgres",
          DB_PORT: "5432",
          DB_USERNAME: "postgres",
        },
        name: "Run Region integration",
        run: "pnpm --filter @medusajs/region test:integration",
      },
    ])
    expect(regionJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const rbacJob = requireRecord(
      jobs["rbac-integration"],
      "workflow.jobs.rbac-integration"
    )
    const rbacServices = requireRecord(
      rbacJob.services,
      "workflow.jobs.rbac-integration.services"
    )
    const rbacPostgresService = requireRecord(
      rbacServices.postgres,
      "workflow.jobs.rbac-integration.services.postgres"
    )
    const rbacSteps = requireSteps(
      rbacJob.steps,
      "workflow.jobs.rbac-integration.steps"
    )
    const rbacJobName = requireString(
      rbacJob.name,
      "workflow.jobs.rbac-integration.name"
    )

    expect(rbacJob).toMatchObject({
      name: "RBAC Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(rbacJob.env).toBeUndefined()
    expect(rbacJob.strategy).toBeUndefined()
    expect(Object.keys(rbacServices)).toEqual(["postgres"])
    expect(rbacPostgresService).toEqual({
      image: "postgres",
      env: {
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_USER: "postgres",
      },
      options:
        "--health-cmd pg_isready --health-interval 1s --health-timeout 10s --health-retries 10",
      ports: ["5432:5432"],
    })
    expect(rbacSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        env: {
          DB_HOST: "127.0.0.1",
          DB_PASSWORD: "postgres",
          DB_PORT: "5432",
          DB_USERNAME: "postgres",
        },
        name: "Run RBAC integration",
        run: "pnpm --filter @medusajs/rbac test:integration",
      },
    ])
    expect(rbacJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const salesChannelJob = requireRecord(
      jobs["sales-channel-integration"],
      "workflow.jobs.sales-channel-integration"
    )
    const salesChannelServices = requireRecord(
      salesChannelJob.services,
      "workflow.jobs.sales-channel-integration.services"
    )
    const salesChannelPostgresService = requireRecord(
      salesChannelServices.postgres,
      "workflow.jobs.sales-channel-integration.services.postgres"
    )
    const salesChannelSteps = requireSteps(
      salesChannelJob.steps,
      "workflow.jobs.sales-channel-integration.steps"
    )
    const salesChannelJobName = requireString(
      salesChannelJob.name,
      "workflow.jobs.sales-channel-integration.name"
    )

    expect(salesChannelJob).toMatchObject({
      name: "Sales Channel Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(salesChannelJob.env).toBeUndefined()
    expect(salesChannelJob.strategy).toBeUndefined()
    expect(Object.keys(salesChannelServices)).toEqual(["postgres"])
    expect(salesChannelPostgresService).toEqual({
      image: "postgres",
      env: {
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_USER: "postgres",
      },
      options:
        "--health-cmd pg_isready --health-interval 1s --health-timeout 10s --health-retries 10",
      ports: ["5432:5432"],
    })
    expect(salesChannelSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        env: {
          DB_HOST: "127.0.0.1",
          DB_PASSWORD: "postgres",
          DB_PORT: "5432",
          DB_USERNAME: "postgres",
        },
        name: "Run Sales Channel integration",
        run: "pnpm --filter @medusajs/sales-channel test:integration",
      },
    ])
    expect(salesChannelJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const stockLocationJob = requireRecord(
      jobs["stock-location-integration"],
      "workflow.jobs.stock-location-integration"
    )
    const stockLocationServices = requireRecord(
      stockLocationJob.services,
      "workflow.jobs.stock-location-integration.services"
    )
    const stockLocationPostgresService = requireRecord(
      stockLocationServices.postgres,
      "workflow.jobs.stock-location-integration.services.postgres"
    )
    const stockLocationSteps = requireSteps(
      stockLocationJob.steps,
      "workflow.jobs.stock-location-integration.steps"
    )
    const stockLocationJobName = requireString(
      stockLocationJob.name,
      "workflow.jobs.stock-location-integration.name"
    )

    expect(stockLocationJob).toMatchObject({
      name: "Stock Location Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(stockLocationJob.env).toBeUndefined()
    expect(stockLocationJob.strategy).toBeUndefined()
    expect(Object.keys(stockLocationServices)).toEqual(["postgres"])
    expect(stockLocationPostgresService).toEqual({
      image: "postgres",
      env: {
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_USER: "postgres",
      },
      options:
        "--health-cmd pg_isready --health-interval 1s --health-timeout 10s --health-retries 10",
      ports: ["5432:5432"],
    })
    expect(stockLocationSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        env: {
          DB_HOST: "127.0.0.1",
          DB_PASSWORD: "postgres",
          DB_PORT: "5432",
          DB_USERNAME: "postgres",
        },
        name: "Run Stock Location integration",
        run: "pnpm --filter @medusajs/stock-location test:integration",
      },
    ])
    expect(stockLocationJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const inventoryJob = requireRecord(
      jobs["inventory-integration"],
      "workflow.jobs.inventory-integration"
    )
    const inventoryServices = requireRecord(
      inventoryJob.services,
      "workflow.jobs.inventory-integration.services"
    )
    const inventoryPostgresService = requireRecord(
      inventoryServices.postgres,
      "workflow.jobs.inventory-integration.services.postgres"
    )
    const inventorySteps = requireSteps(
      inventoryJob.steps,
      "workflow.jobs.inventory-integration.steps"
    )
    const inventoryJobName = requireString(
      inventoryJob.name,
      "workflow.jobs.inventory-integration.name"
    )

    expect(inventoryJob).toMatchObject({
      name: "Inventory Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(inventoryJob.env).toBeUndefined()
    expect(inventoryJob.strategy).toBeUndefined()
    expect(Object.keys(inventoryServices)).toEqual(["postgres"])
    expect(inventoryPostgresService).toEqual({
      image: "postgres",
      env: {
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_USER: "postgres",
      },
      options:
        "--health-cmd pg_isready --health-interval 1s --health-timeout 10s --health-retries 10",
      ports: ["5432:5432"],
    })
    expect(inventorySteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        env: {
          DB_HOST: "127.0.0.1",
          DB_PASSWORD: "postgres",
          DB_PORT: "5432",
          DB_USERNAME: "postgres",
        },
        name: "Run Inventory integration",
        run: "pnpm --filter @medusajs/inventory test:integration",
      },
    ])
    expect(inventoryJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const taxJob = requireRecord(
      jobs["tax-integration"],
      "workflow.jobs.tax-integration"
    )
    const taxServices = requireRecord(
      taxJob.services,
      "workflow.jobs.tax-integration.services"
    )
    const taxPostgresService = requireRecord(
      taxServices.postgres,
      "workflow.jobs.tax-integration.services.postgres"
    )
    const taxSteps = requireSteps(
      taxJob.steps,
      "workflow.jobs.tax-integration.steps"
    )
    const taxJobName = requireString(
      taxJob.name,
      "workflow.jobs.tax-integration.name"
    )

    expect(taxJob).toMatchObject({
      name: "Tax Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(taxJob.env).toBeUndefined()
    expect(taxJob.strategy).toBeUndefined()
    expect(Object.keys(taxServices)).toEqual(["postgres"])
    expect(taxPostgresService).toEqual({
      image: "postgres",
      env: {
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_USER: "postgres",
      },
      options:
        "--health-cmd pg_isready --health-interval 1s --health-timeout 10s --health-retries 10",
      ports: ["5432:5432"],
    })
    expect(taxSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        env: {
          DB_HOST: "127.0.0.1",
          DB_PASSWORD: "postgres",
          DB_PORT: "5432",
          DB_USERNAME: "postgres",
        },
        name: "Run Tax integration",
        run: "pnpm --filter @medusajs/tax test:integration",
      },
    ])
    expect(taxJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const paymentJob = requireRecord(
      jobs["payment-integration"],
      "workflow.jobs.payment-integration"
    )
    const paymentServices = requireRecord(
      paymentJob.services,
      "workflow.jobs.payment-integration.services"
    )
    const paymentPostgresService = requireRecord(
      paymentServices.postgres,
      "workflow.jobs.payment-integration.services.postgres"
    )
    const paymentSteps = requireSteps(
      paymentJob.steps,
      "workflow.jobs.payment-integration.steps"
    )
    const paymentJobName = requireString(
      paymentJob.name,
      "workflow.jobs.payment-integration.name"
    )

    expect(paymentJob).toMatchObject({
      name: "Payment Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(paymentJob.env).toBeUndefined()
    expect(paymentJob.strategy).toBeUndefined()
    expect(Object.keys(paymentServices)).toEqual(["postgres"])
    expect(paymentPostgresService).toEqual({
      image: "postgres",
      env: {
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_USER: "postgres",
      },
      options:
        "--health-cmd pg_isready --health-interval 1s --health-timeout 10s --health-retries 10",
      ports: ["5432:5432"],
    })
    expect(paymentSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        env: {
          DB_HOST: "127.0.0.1",
          DB_PASSWORD: "postgres",
          DB_PORT: "5432",
          DB_USERNAME: "postgres",
        },
        name: "Run Payment integration",
        run: "pnpm --filter @medusajs/payment test:integration",
      },
    ])
    expect(paymentJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const notificationJob = requireRecord(
      jobs["notification-integration"],
      "workflow.jobs.notification-integration"
    )
    const notificationServices = requireRecord(
      notificationJob.services,
      "workflow.jobs.notification-integration.services"
    )
    const notificationPostgresService = requireRecord(
      notificationServices.postgres,
      "workflow.jobs.notification-integration.services.postgres"
    )
    const notificationSteps = requireSteps(
      notificationJob.steps,
      "workflow.jobs.notification-integration.steps"
    )
    const notificationJobName = requireString(
      notificationJob.name,
      "workflow.jobs.notification-integration.name"
    )

    expect(notificationJob).toMatchObject({
      name: "Notification Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(notificationJob.env).toBeUndefined()
    expect(notificationJob.strategy).toBeUndefined()
    expect(Object.keys(notificationServices)).toEqual(["postgres"])
    expect(notificationPostgresService).toEqual({
      image: "postgres",
      env: {
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_USER: "postgres",
      },
      options:
        "--health-cmd pg_isready --health-interval 1s --health-timeout 10s --health-retries 10",
      ports: ["5432:5432"],
    })
    expect(notificationSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        env: {
          DB_HOST: "127.0.0.1",
          DB_PASSWORD: "postgres",
          DB_PORT: "5432",
          DB_USERNAME: "postgres",
        },
        name: "Run Notification integration",
        run: "pnpm --filter @medusajs/notification test:integration",
      },
    ])
    expect(notificationJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const authJob = requireRecord(
      jobs["auth-emailpass-integration"],
      "workflow.jobs.auth-emailpass-integration"
    )
    const authSteps = requireSteps(
      authJob.steps,
      "workflow.jobs.auth-emailpass-integration.steps"
    )

    expect(authJob).toMatchObject({
      name: "Auth Emailpass Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(authJob.env).toBeUndefined()
    expect(authJob.strategy).toBeUndefined()
    expect(authJob.services).toBeUndefined()
    expect(authSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        name: "Run Auth Emailpass integration",
        run: "pnpm --filter @medusajs/auth-emailpass test:integration",
      },
    ])
    expect(String(authJob.name)).not.toMatch(/\b(?:jest|vitest)\b/i)

    const githubJob = requireRecord(
      jobs["auth-github-integration"],
      "workflow.jobs.auth-github-integration"
    )
    const githubSteps = requireSteps(
      githubJob.steps,
      "workflow.jobs.auth-github-integration.steps"
    )
    const githubJobName = requireString(
      githubJob.name,
      "workflow.jobs.auth-github-integration.name"
    )

    expect(githubJob).toMatchObject({
      name: "Auth GitHub Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(githubJob.env).toBeUndefined()
    expect(githubJob.strategy).toBeUndefined()
    expect(githubJob.services).toBeUndefined()
    expect(githubSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        name: "Run Auth GitHub integration",
        run: "pnpm --filter @medusajs/auth-github test:integration",
      },
    ])
    expect(githubJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const googleJob = requireRecord(
      jobs["auth-google-integration"],
      "workflow.jobs.auth-google-integration"
    )
    const googleSteps = requireSteps(
      googleJob.steps,
      "workflow.jobs.auth-google-integration.steps"
    )
    const googleJobName = requireString(
      googleJob.name,
      "workflow.jobs.auth-google-integration.name"
    )

    expect(googleJob).toMatchObject({
      name: "Auth Google Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(googleJob.env).toBeUndefined()
    expect(googleJob.strategy).toBeUndefined()
    expect(googleJob.services).toBeUndefined()
    expect(googleSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        name: "Run Auth Google integration",
        run: "pnpm --filter @medusajs/auth-google test:integration",
      },
    ])
    expect(googleJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const fileLocalJob = requireRecord(
      jobs["file-local-integration"],
      "workflow.jobs.file-local-integration"
    )
    const fileLocalSteps = requireSteps(
      fileLocalJob.steps,
      "workflow.jobs.file-local-integration.steps"
    )
    const fileLocalJobName = requireString(
      fileLocalJob.name,
      "workflow.jobs.file-local-integration.name"
    )

    expect(fileLocalJob).toMatchObject({
      name: "File Local Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(fileLocalJob.env).toBeUndefined()
    expect(fileLocalJob.strategy).toBeUndefined()
    expect(fileLocalJob.services).toBeUndefined()
    expect(fileLocalSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        name: "Run File Local integration",
        run: "pnpm --filter @medusajs/file-local test:integration",
      },
    ])
    expect(fileLocalJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const fileS3Job = requireRecord(
      jobs["file-s3-integration"],
      "workflow.jobs.file-s3-integration"
    )
    const fileS3Steps = requireSteps(
      fileS3Job.steps,
      "workflow.jobs.file-s3-integration.steps"
    )
    const fileS3JobName = requireString(
      fileS3Job.name,
      "workflow.jobs.file-s3-integration.name"
    )

    expect(fileS3Job).toMatchObject({
      name: "File S3 Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(fileS3Job.env).toBeUndefined()
    expect(fileS3Job.strategy).toBeUndefined()
    expect(fileS3Job.services).toBeUndefined()
    expect(fileS3Steps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        name: "Run File S3 integration",
        run: "pnpm --filter @medusajs/file-s3 test:integration",
      },
    ])
    expect(fileS3JobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const notificationLocalJob = requireRecord(
      jobs["notification-local-integration"],
      "workflow.jobs.notification-local-integration"
    )
    const notificationLocalSteps = requireSteps(
      notificationLocalJob.steps,
      "workflow.jobs.notification-local-integration.steps"
    )
    const notificationLocalJobName = requireString(
      notificationLocalJob.name,
      "workflow.jobs.notification-local-integration.name"
    )

    expect(notificationLocalJob).toMatchObject({
      name: "Notification Local Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(notificationLocalJob.env).toBeUndefined()
    expect(notificationLocalJob.strategy).toBeUndefined()
    expect(notificationLocalJob.services).toBeUndefined()
    expect(notificationLocalSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        name: "Run Notification Local integration",
        run: "pnpm --filter @medusajs/notification-local test:integration",
      },
    ])
    expect(notificationLocalJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const notificationSendgridJob = requireRecord(
      jobs["notification-sendgrid-integration"],
      "workflow.jobs.notification-sendgrid-integration"
    )
    const notificationSendgridSteps = requireSteps(
      notificationSendgridJob.steps,
      "workflow.jobs.notification-sendgrid-integration.steps"
    )
    const notificationSendgridJobName = requireString(
      notificationSendgridJob.name,
      "workflow.jobs.notification-sendgrid-integration.name"
    )

    expect(notificationSendgridJob).toMatchObject({
      name: "Notification SendGrid Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(notificationSendgridJob.env).toBeUndefined()
    expect(notificationSendgridJob.strategy).toBeUndefined()
    expect(notificationSendgridJob.services).toBeUndefined()
    expect(notificationSendgridSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        name: "Run Notification SendGrid integration",
        run: "pnpm --filter @medusajs/notification-sendgrid test:integration",
      },
    ])
    expect(notificationSendgridJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const lockingPostgresJob = requireRecord(
      jobs["locking-postgres-integration"],
      "workflow.jobs.locking-postgres-integration"
    )
    const lockingPostgresServices = requireRecord(
      lockingPostgresJob.services,
      "workflow.jobs.locking-postgres-integration.services"
    )
    const lockingPostgresService = requireRecord(
      lockingPostgresServices.postgres,
      "workflow.jobs.locking-postgres-integration.services.postgres"
    )
    const lockingPostgresSteps = requireSteps(
      lockingPostgresJob.steps,
      "workflow.jobs.locking-postgres-integration.steps"
    )
    const lockingPostgresJobName = requireString(
      lockingPostgresJob.name,
      "workflow.jobs.locking-postgres-integration.name"
    )

    expect(lockingPostgresJob).toMatchObject({
      name: "Locking Postgres Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(lockingPostgresJob.env).toBeUndefined()
    expect(lockingPostgresJob.strategy).toBeUndefined()
    expect(Object.keys(lockingPostgresServices)).toEqual(["postgres"])
    expect(lockingPostgresService).toEqual({
      image: "postgres",
      env: {
        POSTGRES_DB: "medusa-locking-integration-vitest-1",
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_USER: "postgres",
      },
      options:
        "--health-cmd pg_isready --health-interval 1s --health-timeout 10s --health-retries 10",
      ports: ["5432:5432"],
    })
    expect(lockingPostgresSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        name: "Run Locking Postgres integration",
        run: "pnpm --filter @medusajs/locking-postgres test:integration",
        env: {
          DB_HOST: "127.0.0.1",
          DB_PASSWORD: "postgres",
          DB_PORT: "5432",
          DB_USERNAME: "postgres",
        },
      },
    ])
    expect(lockingPostgresJobName).not.toMatch(/\b(?:jest|vitest)\b/i)

    const lockingRedisJob = requireRecord(
      jobs["locking-redis-integration"],
      "workflow.jobs.locking-redis-integration"
    )
    const lockingRedisServices = requireRecord(
      lockingRedisJob.services,
      "workflow.jobs.locking-redis-integration.services"
    )
    const lockingRedisService = requireRecord(
      lockingRedisServices.redis,
      "workflow.jobs.locking-redis-integration.services.redis"
    )
    const lockingRedisSteps = requireSteps(
      lockingRedisJob.steps,
      "workflow.jobs.locking-redis-integration.steps"
    )
    const lockingRedisJobName = requireString(
      lockingRedisJob.name,
      "workflow.jobs.locking-redis-integration.name"
    )

    expect(lockingRedisJob).toMatchObject({
      name: "Locking Redis Integration",
      needs: "setup",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
    expect(lockingRedisJob.env).toBeUndefined()
    expect(lockingRedisJob.strategy).toBeUndefined()
    expect(lockingRedisJob["continue-on-error"]).toBeUndefined()
    expect(Object.keys(lockingRedisServices)).toEqual(["redis"])
    expect(lockingRedisService).toEqual({
      image: "redis",
      options:
        '--health-cmd "redis-cli ping" --health-interval 1s --health-timeout 10s --health-retries 10',
      ports: ["6379:6379"],
    })
    expect(lockingRedisSteps).toEqual([
      {
        name: "Checkout",
        uses: "actions/checkout@v4",
        with: {
          "fetch-depth": 100,
        },
      },
      {
        name: "Install dependencies",
        uses: "./.github/actions/cache-deps",
        with: {
          extension: "pipeline",
          "skip-build": "true",
        },
      },
      {
        name: "Download build artifacts",
        uses: "actions/download-artifact@v4",
        with: {
          name: "build-artifacts",
          path: ".",
        },
      },
      {
        name: "Run Locking Redis integration",
        run: "pnpm --filter @medusajs/locking-redis test:integration",
        env: {
          REDIS_URL: "redis://127.0.0.1:6379",
        },
      },
    ])
    expect(lockingRedisJobName).not.toMatch(/\b(?:jest|vitest)\b/i)
  })
})
