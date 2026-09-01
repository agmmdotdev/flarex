import { isFileDisabled } from "@medusajs/utils/common/define-file-config"

const MEDUSA_SKIP_FILE = Symbol.for("__MEDUSA_SKIP_FILE__")

export function isStaticHttpFileSkipped(
  exported: unknown,
  path?: string
): boolean {
  if (isFileDisabled(path)) {
    return true
  }

  if (
    exported === null ||
    (typeof exported !== "object" && typeof exported !== "function")
  ) {
    return false
  }

  return Boolean((exported as Record<symbol, unknown>)[MEDUSA_SKIP_FILE])
}
