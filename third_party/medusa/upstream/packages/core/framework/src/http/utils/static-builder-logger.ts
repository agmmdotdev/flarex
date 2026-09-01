export type StaticHttpBuilderLogger = {
  debug(message: string): void
  warn(message: string): void
}

export const silentStaticHttpBuilderLogger: StaticHttpBuilderLogger = {
  debug() {},
  warn() {},
}
