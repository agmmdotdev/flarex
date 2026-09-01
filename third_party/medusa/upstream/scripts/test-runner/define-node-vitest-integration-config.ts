import { fileURLToPath } from "node:url"

import type { UserConfig } from "vite"

import {
  defineNodeVitestConfig,
  type NodeVitestConfigOptions,
} from "./define-node-vitest-config"

const integrationEnvironmentSetupFile = fileURLToPath(
  new URL("../../integration-tests/setup-env.js", import.meta.url)
)

export type NodeVitestIntegrationConfigOptions = Pick<
  NodeVitestConfigOptions,
  | "aliases"
  | "hookTimeout"
  | "include"
  | "legacyJestBridge"
  | "root"
  | "setupFiles"
  | "testTimeout"
>

export function defineNodeVitestIntegrationConfig(
  options: NodeVitestIntegrationConfigOptions
): UserConfig {
  return defineNodeVitestConfig({
    aliases: options.aliases,
    fileParallelism: false,
    hookTimeout: options.hookTimeout,
    include: options.include,
    legacyJestBridge: options.legacyJestBridge ?? true,
    maxWorkers: 1,
    root: options.root,
    sequenceConcurrent: false,
    setupFiles: [
      integrationEnvironmentSetupFile,
      ...(options.setupFiles ?? []),
    ],
    testTimeout: options.testTimeout,
  })
}
