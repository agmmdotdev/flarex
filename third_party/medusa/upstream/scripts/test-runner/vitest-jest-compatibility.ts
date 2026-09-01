import type { VitestUtils } from "vitest"

export type LegacyJestBridgeSource = Pick<
  VitestUtils,
  | "clearAllMocks"
  | "fn"
  | "restoreAllMocks"
  | "setConfig"
  | "setSystemTime"
  | "spyOn"
  | "useFakeTimers"
  | "useRealTimers"
>

export type LegacyJestBridge = Readonly<
  Pick<VitestUtils, "fn" | "spyOn"> & {
    clearAllMocks(): LegacyJestBridge
    restoreAllMocks(): LegacyJestBridge
    setSystemTime(
      ...args: Parameters<VitestUtils["setSystemTime"]>
    ): LegacyJestBridge
    setTimeout(timeout: number): LegacyJestBridge
    useFakeTimers(
      ...args: Parameters<VitestUtils["useFakeTimers"]>
    ): LegacyJestBridge
    useRealTimers(
      ...args: Parameters<VitestUtils["useRealTimers"]>
    ): LegacyJestBridge
  }
>

export const LEGACY_JEST_BRIDGE_KEYS = [
  "clearAllMocks",
  "fn",
  "restoreAllMocks",
  "setSystemTime",
  "setTimeout",
  "spyOn",
  "useFakeTimers",
  "useRealTimers",
] as const satisfies ReadonlyArray<keyof LegacyJestBridge>

export function createLegacyJestBridge(
  source: LegacyJestBridgeSource
): LegacyJestBridge {
  const bridge = {
    clearAllMocks(): LegacyJestBridge {
      source.clearAllMocks()
      return bridge
    },
    fn: source.fn,
    restoreAllMocks(): LegacyJestBridge {
      source.restoreAllMocks()
      return bridge
    },
    setSystemTime(
      ...args: Parameters<VitestUtils["setSystemTime"]>
    ): LegacyJestBridge {
      source.setSystemTime(...args)
      return bridge
    },
    setTimeout(timeout: number): LegacyJestBridge {
      source.setConfig({
        hookTimeout: timeout,
        testTimeout: timeout,
      })
      return bridge
    },
    spyOn: source.spyOn,
    useFakeTimers(
      ...args: Parameters<VitestUtils["useFakeTimers"]>
    ): LegacyJestBridge {
      source.useFakeTimers(...args)
      return bridge
    },
    useRealTimers(
      ...args: Parameters<VitestUtils["useRealTimers"]>
    ): LegacyJestBridge {
      source.useRealTimers(...args)
      return bridge
    },
  } satisfies LegacyJestBridge

  return Object.freeze(bridge)
}

export function installLegacyJestBridge(
  source: LegacyJestBridgeSource
): LegacyJestBridge {
  if (Object.prototype.hasOwnProperty.call(globalThis, "jest")) {
    throw new Error(
      "The Vitest legacy Jest bridge cannot replace an existing global jest value."
    )
  }

  const bridge = createLegacyJestBridge(source)

  Object.defineProperty(globalThis, "jest", {
    configurable: true,
    enumerable: false,
    value: bridge,
    writable: false,
  })

  return bridge
}
