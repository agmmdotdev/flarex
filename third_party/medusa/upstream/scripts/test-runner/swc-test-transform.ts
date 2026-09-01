import { transform, type Options } from "@swc/core"
import type { Plugin } from "vite"

const SCRIPT_EXTENSION_PATTERN = /\.[jt]s$/
const NODE_MODULES_SEGMENT = "/node_modules/"
const TRANSFORMED_DEPENDENCY_PATTERN =
  /\/node_modules\/(?:until-async|msw)(?:\/|$)/

const SWC_TEST_OPTIONS = {
  configFile: false,
  jsc: {
    parser: {
      decorators: true,
      syntax: "typescript",
    },
    target: "es2021",
    transform: {
      decoratorMetadata: true,
      legacyDecorator: true,
      useDefineForClassFields: false,
    },
  },
  module: {
    type: "es6",
  },
  sourceMaps: true,
  swcrc: false,
} satisfies Options

export interface SwcTestTransformResult {
  readonly code: string
  readonly map: string | undefined
}

function normalizeModuleId(id: string): string {
  const queryIndex = id.indexOf("?")
  const path = queryIndex === -1 ? id : id.slice(0, queryIndex)

  return path.replaceAll("\\", "/")
}

export function shouldTransformTestModule(id: string): boolean {
  const normalizedId = normalizeModuleId(id)

  if (!SCRIPT_EXTENSION_PATTERN.test(normalizedId)) {
    return false
  }

  if (!normalizedId.includes(NODE_MODULES_SEGMENT)) {
    return true
  }

  return TRANSFORMED_DEPENDENCY_PATTERN.test(normalizedId)
}

export async function transformTestModule(
  source: string,
  id: string
): Promise<SwcTestTransformResult | null> {
  const filename = normalizeModuleId(id)

  if (!shouldTransformTestModule(filename)) {
    return null
  }

  const output = await transform(source, {
    ...SWC_TEST_OPTIONS,
    filename,
  })

  return {
    code: output.code,
    map: output.map,
  }
}

export function medusaNodeTestSwcPlugin(): Plugin {
  return {
    enforce: "pre",
    name: "medusa-node-test-swc",
    async transform(source, id) {
      return transformTestModule(source, id)
    },
  }
}
