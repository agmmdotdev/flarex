type CryptoProvider = {
  randomUUID?: () => string
  getRandomValues?: <T extends Uint8Array>(array: T) => T
}

let portableIdCounter = 0

export function createPortableId(prefix = "id"): string {
  const cryptoProvider = (globalThis as { crypto?: CryptoProvider }).crypto

  try {
    if (cryptoProvider?.randomUUID) {
      return `${prefix}_${cryptoProvider.randomUUID().replaceAll("-", "")}`
    }

    if (cryptoProvider?.getRandomValues) {
      const bytes = cryptoProvider.getRandomValues(new Uint8Array(16))
      const value = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")

      return `${prefix}_${value}`
    }
  } catch {
    // Cloudflare Workers disallow random values during global-scope module
    // evaluation. Top-level workflow composition still needs stable IDs.
  }

  portableIdCounter += 1

  return `${prefix}_${portableIdCounter.toString(36)}`
}
