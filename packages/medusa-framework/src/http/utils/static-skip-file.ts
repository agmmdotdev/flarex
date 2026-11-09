// The private static profile has no filesystem-disabled-file registry.
const MEDUSA_SKIP_FILE = Symbol.for("__MEDUSA_SKIP_FILE__")
export function isStaticHttpFileSkipped(exported: unknown, _path?: string): boolean {
 return exported !== null && (typeof exported === "object" || typeof exported === "function") && Boolean((exported as Record<symbol, unknown>)[MEDUSA_SKIP_FILE])
}
