type MikroOrmHookModule = {
  applyMikroOrmEntityHooks(): void
}

type NodeRequire = (moduleName: string) => unknown

declare const __MEDUSA_CLOUDFLARE_WORKER__: boolean | undefined
declare const require: NodeRequire | undefined

let hooksApplied = false

export const applyEntityHooks = () => {
  if (hooksApplied) {
    return
  }

  const requireModule = loadNodeRequire()

  if (!requireModule) {
    return
  }

  const hooksModule = loadMikroOrmHooks(requireModule)

  if (!hooksModule) {
    return
  }


  hooksApplied = true
  hooksModule.applyMikroOrmEntityHooks()
}

function loadNodeRequire(): NodeRequire | undefined {
  if (
    typeof __MEDUSA_CLOUDFLARE_WORKER__ !== "undefined" &&
    __MEDUSA_CLOUDFLARE_WORKER__
  ) {
    return undefined
  }

  return typeof require === "function" ? require : undefined
}

function loadMikroOrmHooks(
  requireModule: NodeRequire
): MikroOrmHookModule | undefined {
  try {
    const hooksModule = requireModule("./apply-mikro-orm-decorators")

    if (!isMikroOrmHookModule(hooksModule)) {
      throw new Error("Inventory MikroORM hook module could not be loaded")
    }

    return hooksModule
  } catch (error) {
    if (isMissingMikroOrmHookModuleError(error)) {
      return undefined
    }

    throw error
  }
}

function isMikroOrmHookModule(value: unknown): value is MikroOrmHookModule {
  return (
    isRecord(value) &&
    "applyMikroOrmEntityHooks" in value &&
    typeof value.applyMikroOrmEntityHooks === "function"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isMissingMikroOrmHookModuleError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("./apply-mikro-orm-decorators") &&
    "code" in error &&
    error.code === "MODULE_NOT_FOUND"
  )
}
