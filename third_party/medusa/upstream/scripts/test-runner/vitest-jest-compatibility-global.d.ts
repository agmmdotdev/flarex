import type { LegacyJestBridge } from "./vitest-jest-compatibility"

declare global {
  const jest: LegacyJestBridge
}

export {}
