type DevServerResource = {
  type: string
} & Record<string, unknown>

export function getCallerFilePath(): string | undefined {
  return undefined
}

export function registerDevServerResource(_resource: DevServerResource): void {}
