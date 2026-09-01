import type { AuthContext, MedusaRequest } from "../types"
import { setMedusaRequestAuthContext } from "./request-context"

export type BearerAuthContextVerifier = (
  token: string
) => AuthContext | Promise<AuthContext | undefined> | undefined

export type BearerAuthContextPrepareRequest = (
  req: MedusaRequest,
  fetchRequest: Request
) => Promise<void>

export interface Hs256JwtBearerAuthContextVerifierOptions {
  secret: string
  now?: () => Date
}

export interface CreateHs256JwtOptions {
  secret: string
  payload: Record<string, unknown>
}

export function createBearerAuthContextPrepareRequest(
  verifyToken: BearerAuthContextVerifier
): BearerAuthContextPrepareRequest {
  return async (req, fetchRequest) => {
    const token = getBearerToken(fetchRequest.headers.get("authorization"))
    if (!token) {
      return
    }

    const authContext = await verifyToken(token)
    if (!authContext) {
      return
    }

    setMedusaRequestAuthContext(req, authContext)
  }
}

export function createHs256JwtBearerAuthContextVerifier({
  secret,
  now = () => new Date(),
}: Hs256JwtBearerAuthContextVerifierOptions): BearerAuthContextVerifier {
  return async (token) => {
    const payload = await verifyHs256JwtPayload(token, secret)
    if (!isRecord(payload) || isJwtPayloadInactive(payload, now())) {
      return undefined
    }

    return getAuthContextFromJwtPayload(payload)
  }
}

export async function createHs256Jwt({
  secret,
  payload,
}: CreateHs256JwtOptions): Promise<string> {
  const headerSegment = encodeBase64UrlJson({ alg: "HS256", typ: "JWT" })
  const payloadSegment = encodeBase64UrlJson(payload)
  const signatureSegment = await signHs256JwtInput(
    `${headerSegment}.${payloadSegment}`,
    secret
  )

  return `${headerSegment}.${payloadSegment}.${signatureSegment}`
}

export function decodeUnverifiedJwtBearerAuthContext(
  token: string
): AuthContext | undefined {
  const payload = decodeJwtPayload(token)
  if (!isRecord(payload)) {
    return undefined
  }

  return getAuthContextFromJwtPayload(payload)
}

export function getBearerToken(
  authHeader: string | null | undefined
): string | undefined {
  const [tokenType, token] = authHeader?.split(" ") ?? []

  return tokenType?.toLowerCase() === "bearer" && token ? token : undefined
}

async function verifyHs256JwtPayload(
  token: string,
  secret: string
): Promise<unknown> {
  const parts = token.split(".")
  if (parts.length !== 3) {
    return undefined
  }

  const [headerSegment, payloadSegment, signatureSegment] = parts
  if (!headerSegment || !payloadSegment || !signatureSegment) {
    return undefined
  }

  const header = decodeJwtSegment(headerSegment)
  if (!isRecord(header) || header.alg !== "HS256") {
    return undefined
  }

  const expectedSignature = await signHs256JwtInput(
    `${headerSegment}.${payloadSegment}`,
    secret
  )
  if (!safeEqual(signatureSegment, expectedSignature)) {
    return undefined
  }

  return decodeJwtSegment(payloadSegment)
}

async function signHs256JwtInput(
  input: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(input))

  return encodeBase64UrlBytes(new Uint8Array(signature))
}

function getAuthContextFromJwtPayload(
  payload: Record<string, unknown>
): AuthContext | undefined {
  if (!isRecord(payload)) {
    return undefined
  }

  const actorType = getStringValue(payload, "actor_type")
  const authIdentityId = getStringValue(payload, "auth_identity_id")
  if (!actorType || !authIdentityId) {
    return undefined
  }

  return {
    actor_id: getStringValue(payload, "actor_id") ?? "",
    actor_type: actorType,
    auth_identity_id: authIdentityId,
    app_metadata: getRecordValue(payload, "app_metadata") ?? {},
    user_metadata: getRecordValue(payload, "user_metadata") ?? {},
  }
}

function decodeJwtPayload(token: string): unknown {
  const payloadSegment = token.split(".")[1]
  if (!payloadSegment) {
    return undefined
  }

  return decodeJwtSegment(payloadSegment)
}

function decodeJwtSegment(segment: string): unknown {
  const base64 = segment
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(segment.length / 4) * 4, "=")

  try {
    return JSON.parse(atob(base64)) as unknown
  } catch {
    return undefined
  }
}

function encodeBase64UrlJson(value: Record<string, unknown>): string {
  return encodeBase64UrlBytes(new TextEncoder().encode(JSON.stringify(value)))
}

function encodeBase64UrlBytes(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false
  }

  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return diff === 0
}

function isJwtPayloadInactive(
  payload: Record<string, unknown>,
  now: Date
): boolean {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const exp = payload.exp
  if (typeof exp === "number" && nowSeconds >= exp) {
    return true
  }

  const nbf = payload.nbf
  if (typeof nbf === "number" && nowSeconds < nbf) {
    return true
  }

  return false
}

function getStringValue(
  value: Record<string, unknown>,
  key: string
): string | undefined {
  const entry = value[key]
  return typeof entry === "string" ? entry : undefined
}

function getRecordValue(
  value: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const entry = value[key]
  return isRecord(entry) ? entry : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
