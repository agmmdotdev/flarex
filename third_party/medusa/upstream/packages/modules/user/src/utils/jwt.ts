type JwtAlgorithm = "HS256" | "HS384" | "HS512"

export type JwtOptions = {
  algorithm?: string
  algorithms?: readonly string[]
  complete?: boolean
  expiresIn?: number | string
  jwtid?: string
}

type JwtHeader = {
  alg: JwtAlgorithm
  typ: "JWT"
  kid?: string
}

type JwtPayload = Record<string, unknown> & {
  exp?: number
  iat?: number
  jti?: string
}

export type VerifiedJwt = {
  header: JwtHeader
  payload: JwtPayload
  signature: string
}

export async function signJwt(
  payload: Record<string, unknown>,
  options: {
    secret: string
    jwtOptions: JwtOptions
  }
): Promise<string> {
  const algorithm = toSupportedAlgorithm(options.jwtOptions.algorithm)
  const issuedAt = Math.floor(Date.now() / 1000)
  const jwtPayload: JwtPayload = {
    ...payload,
    iat: issuedAt,
  }

  if (options.jwtOptions.expiresIn !== undefined) {
    jwtPayload.exp = issuedAt + parseTimespanSeconds(options.jwtOptions.expiresIn)
  }

  if (options.jwtOptions.jwtid) {
    jwtPayload.jti = options.jwtOptions.jwtid
  }

  const encodedHeader = encodeJson({ alg: algorithm, typ: "JWT" })
  const encodedPayload = encodeJson(jwtPayload)
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = await hmacSign(algorithm, options.secret, signingInput)

  return `${signingInput}.${signature}`
}

export async function verifyJwt(
  token: string,
  options: {
    secret: string
    jwtOptions: JwtOptions
  }
): Promise<VerifiedJwt> {
  const [encodedHeader, encodedPayload, signature] = token.split(".")
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error("jwt malformed")
  }

  const header = parseJson<JwtHeader>(encodedHeader)
  const payload = parseJson<JwtPayload>(encodedPayload)
  const algorithm = toSupportedAlgorithm(header.alg)
  const allowedAlgorithms = options.jwtOptions.algorithms

  if (allowedAlgorithms?.length && !allowedAlgorithms.includes(algorithm)) {
    throw new Error("invalid algorithm")
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`
  const expectedSignature = await hmacSign(
    algorithm,
    options.secret,
    signingInput
  )

  if (!timingSafeEqual(signature, expectedSignature)) {
    throw new Error("invalid signature")
  }

  if (payload.exp !== undefined && payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("jwt expired")
  }

  return {
    header,
    payload,
    signature,
  }
}

export function randomJwtId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function parseTimespanSeconds(value: string | number): number {
  if (typeof value === "number") {
    return value
  }

  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(?:\s*)(ms|s|m|h|d)?$/)
  if (!match) {
    throw new Error(`Invalid timespan value: ${value}`)
  }

  const amount = Number(match[1])
  const unit = match[2] ?? "ms"

  switch (unit) {
    case "ms":
      return Math.floor(amount / 1000)
    case "s":
      return amount
    case "m":
      return amount * 60
    case "h":
      return amount * 60 * 60
    case "d":
      return amount * 60 * 60 * 24
  }

  throw new Error(`Invalid timespan unit: ${unit}`)
}

function toSupportedAlgorithm(value: string | undefined): JwtAlgorithm {
  const algorithm = value ?? "HS256"
  if (algorithm === "HS256" || algorithm === "HS384" || algorithm === "HS512") {
    return algorithm
  }

  throw new Error(`Unsupported JWT algorithm: ${algorithm}`)
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)))
}

function parseJson<T>(value: string): T {
  const bytes = base64UrlDecode(value)
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}

async function hmacSign(
  algorithm: JwtAlgorithm,
  secret: string,
  signingInput: string
): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: hashAlgorithm(algorithm) },
    false,
    ["sign"]
  )
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput)
  )

  return base64UrlEncode(new Uint8Array(signature))
}

function hashAlgorithm(algorithm: JwtAlgorithm): string {
  switch (algorithm) {
    case "HS256":
      return "SHA-256"
    case "HS384":
      return "SHA-384"
    case "HS512":
      return "SHA-512"
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  const length = Math.max(leftBytes.length, rightBytes.length)
  let result = leftBytes.length ^ rightBytes.length

  for (let index = 0; index < length; index++) {
    result |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }

  return result === 0
}
