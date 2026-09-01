export type ComposerGlobal = typeof globalThis & Record<string, unknown>

export const composerGlobal = globalThis as ComposerGlobal
