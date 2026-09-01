import { isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import type { Alias, UserConfig } from "vite"
import { configDefaults, defineConfig } from "vitest/config"

import { medusaNodeTestSwcPlugin } from "./swc-test-transform"

const compatibilitySetupFile = fileURLToPath(
  new URL("./vitest-jest-compatibility-setup.ts", import.meta.url)
)

const BASE_EXCLUDES = [
  ...configDefaults.exclude,
  "**/dist/**",
  "**/__fixtures__/**",
  "**/__mocks__/**",
] as const

export const NODE_TEST_DISCOVERY_GLOBS = [
  "**/__tests__/**/*.{js,ts}",
  "**/*.{spec,test}.{js,ts}",
] as const

export const NODE_TEST_DEFAULT_TIMEOUT = 5_000

export interface NodeVitestAlias {
  readonly find: string | RegExp
  readonly replacement: string
}

export interface NodeVitestConfigOptions {
  readonly aliases: readonly NodeVitestAlias[]
  readonly exclude?: readonly string[]
  readonly fileParallelism?: boolean
  readonly hookTimeout?: number
  readonly include: readonly string[]
  readonly legacyJestBridge?: boolean
  readonly maxWorkers?: number
  readonly root: string
  readonly sequenceConcurrent?: boolean
  readonly setupFiles?: readonly string[]
  readonly testTimeout?: number
}

function resolveAliases(
  root: string,
  aliases: readonly NodeVitestAlias[]
): Alias[] {
  return aliases.map(({ find, replacement }) => ({
    find,
    replacement: isAbsolute(replacement)
      ? replacement
      : resolve(root, replacement),
  }))
}

export function defineNodeVitestConfig(
  options: NodeVitestConfigOptions
): UserConfig {
  if (!isAbsolute(options.root)) {
    throw new Error(
      `The shared Node Vitest root must be absolute. Received: ${options.root}`
    )
  }

  if (options.include.length === 0) {
    throw new Error(
      "The shared Node Vitest profile requires an explicit include list."
    )
  }

  const setupFiles = [
    ...(options.legacyJestBridge ? [compatibilitySetupFile] : []),
    ...(options.setupFiles ?? []),
  ]

  return defineConfig({
    plugins: [medusaNodeTestSwcPlugin()],
    resolve: {
      alias: resolveAliases(options.root, options.aliases),
    },
    root: options.root,
    test: {
      environment: "node",
      exclude: [...BASE_EXCLUDES, ...(options.exclude ?? [])],
      ...(options.fileParallelism === undefined
        ? {}
        : { fileParallelism: options.fileParallelism }),
      globals: true,
      hookTimeout: options.hookTimeout ?? NODE_TEST_DEFAULT_TIMEOUT,
      include: [...options.include],
      ...(options.maxWorkers === undefined
        ? {}
        : { maxWorkers: options.maxWorkers }),
      passWithNoTests: false,
      pool: "forks",
      sequence: {
        ...(options.sequenceConcurrent === undefined
          ? {}
          : { concurrent: options.sequenceConcurrent }),
        hooks: "list",
        setupFiles: "list",
      },
      server: {
        deps: {
          inline: ["until-async", "msw"],
        },
      },
      setupFiles,
      testTimeout: options.testTimeout ?? NODE_TEST_DEFAULT_TIMEOUT,
    },
  } satisfies UserConfig)
}
