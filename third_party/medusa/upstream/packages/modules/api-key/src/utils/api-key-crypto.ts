type HexBytes = {
  toString(encoding: "hex"): string
}

type ScryptCallback = (error: Error | null, derivedKey?: HexBytes) => void

type NodeCryptoModule = {
  randomBytes(size: number): HexBytes
  scrypt(
    token: string,
    salt: string,
    keyLength: number,
    callback: ScryptCallback
  ): void
}

type NodeRequire = (moduleName: string) => unknown

declare const __MEDUSA_CLOUDFLARE_WORKER__: boolean | undefined
declare const require: NodeRequire | undefined

export function randomHex(byteLength: number): string {
  const nodeCrypto = loadNodeCrypto()
  if (nodeCrypto) {
    return nodeCrypto.randomBytes(byteLength).toString("hex")
  }

  const webCrypto = globalThis.crypto
  if (webCrypto?.getRandomValues) {
    const bytes = new Uint8Array(byteLength)
    webCrypto.getRandomValues(bytes)
    return bytesToHex(bytes)
  }

  throw new Error("No cryptographic random source is available")
}

export async function scryptHex(
  token: string,
  salt: string,
  keyLength: number
): Promise<string> {
  const nodeCrypto = loadNodeCrypto()

  if (!nodeCrypto) {
    throw new Error(
      "Secret API keys require a scrypt-capable crypto adapter in this runtime"
    )
  }

  return await new Promise((resolve, reject) => {
    nodeCrypto.scrypt(token, salt, keyLength, (error, derivedKey) => {
      if (error) {
        reject(error)
        return
      }

      if (!derivedKey) {
        reject(new Error("Node crypto.scrypt did not return a derived key"))
        return
      }

      resolve(derivedKey.toString("hex"))
    })
  })
}

function loadNodeCrypto(): NodeCryptoModule | undefined {
  const requireModule = loadNodeRequire()

  if (!requireModule) {
    return undefined
  }

  const cryptoModule = requireModule(["cr", "ypto"].join(""))

  if (!isNodeCryptoModule(cryptoModule)) {
    throw new Error("Node crypto module could not be loaded")
  }

  return cryptoModule
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

function isNodeCryptoModule(value: unknown): value is NodeCryptoModule {
  return (
    isRecord(value) &&
    "randomBytes" in value &&
    typeof value.randomBytes === "function" &&
    "scrypt" in value &&
    typeof value.scrypt === "function"
  )
}

function bytesToHex(bytes: Uint8Array): string {
  let result = ""

  for (const byte of bytes) {
    result += byte.toString(16).padStart(2, "0")
  }

  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
