import {
  createBearerAuthContextPrepareRequest,
  createHs256Jwt,
  createHs256JwtBearerAuthContextVerifier,
  decodeUnverifiedJwtBearerAuthContext,
  getBearerToken,
} from "../utils/bearer-auth-context"
import { getMedusaRequestAuthContext } from "../utils/request-context"
import type { MedusaRequest } from "../types"

const jwtSecret = "test-secret"
const now = () => new Date("2026-07-05T00:00:00.000Z")

describe("bearer auth context helpers", () => {
  it("extracts bearer tokens from authorization headers", () => {
    expect(getBearerToken("Bearer token_123")).toBe("token_123")
    expect(getBearerToken("bearer token_123")).toBe("token_123")
    expect(getBearerToken("Basic token_123")).toBeUndefined()
    expect(getBearerToken(null)).toBeUndefined()
  })

  it("verifies a signed HS256 JWT auth context from a bearer token payload", async () => {
    const token = await createHs256Jwt({
      secret: jwtSecret,
      payload: {
        actor_id: "user_worker_http_proof",
        actor_type: "user",
        auth_identity_id: "auth_user_worker_http_proof",
        app_metadata: {
          user_id: "user_worker_http_proof",
        },
        user_metadata: {
          email: "worker@example.com",
        },
        exp: Math.floor(now().getTime() / 1000) + 60,
      },
    })
    const verifyToken = createHs256JwtBearerAuthContextVerifier({
      secret: jwtSecret,
      now,
    })

    expect(await verifyToken(token)).toEqual({
      actor_id: "user_worker_http_proof",
      actor_type: "user",
      auth_identity_id: "auth_user_worker_http_proof",
      app_metadata: {
        user_id: "user_worker_http_proof",
      },
      user_metadata: {
        email: "worker@example.com",
      },
    })
  })

  it("rejects tampered and inactive HS256 JWT bearer token payloads", async () => {
    const verifyToken = createHs256JwtBearerAuthContextVerifier({
      secret: jwtSecret,
      now,
    })
    const activeToken = await createHs256Jwt({
      secret: jwtSecret,
      payload: {
        actor_id: "user_worker_http_proof",
        actor_type: "user",
        auth_identity_id: "auth_user_worker_http_proof",
        app_metadata: {},
        user_metadata: {},
        exp: Math.floor(now().getTime() / 1000) + 60,
      },
    })
    const expiredToken = await createHs256Jwt({
      secret: jwtSecret,
      payload: {
        actor_id: "user_worker_http_proof",
        actor_type: "user",
        auth_identity_id: "auth_user_worker_http_proof",
        app_metadata: {},
        user_metadata: {},
        exp: Math.floor(now().getTime() / 1000) - 1,
      },
    })
    const notBeforeToken = await createHs256Jwt({
      secret: jwtSecret,
      payload: {
        actor_id: "user_worker_http_proof",
        actor_type: "user",
        auth_identity_id: "auth_user_worker_http_proof",
        app_metadata: {},
        user_metadata: {},
        nbf: Math.floor(now().getTime() / 1000) + 60,
      },
    })

    expect(await verifyToken(`${activeToken.slice(0, -1)}x`)).toBeUndefined()
    expect(await verifyToken(expiredToken)).toBeUndefined()
    expect(await verifyToken(notBeforeToken)).toBeUndefined()
  })

  it("decodes an unverified JWT auth context from a bearer token payload", () => {
    const token = createProofJwt({
      actor_id: "user_worker_http_proof",
      actor_type: "user",
      auth_identity_id: "auth_user_worker_http_proof",
      app_metadata: {
        user_id: "user_worker_http_proof",
      },
      user_metadata: {
        email: "worker@example.com",
      },
    })

    expect(decodeUnverifiedJwtBearerAuthContext(token)).toEqual({
      actor_id: "user_worker_http_proof",
      actor_type: "user",
      auth_identity_id: "auth_user_worker_http_proof",
      app_metadata: {
        user_id: "user_worker_http_proof",
      },
      user_metadata: {
        email: "worker@example.com",
      },
    })
  })

  it("ignores invalid unverified JWT bearer token payloads", () => {
    expect(
      decodeUnverifiedJwtBearerAuthContext("invalid-token")
    ).toBeUndefined()
  })

  it("prepares request auth context through an injected verifier", async () => {
    const req = {} as MedusaRequest
    const prepareRequest = createBearerAuthContextPrepareRequest(
      createHs256JwtBearerAuthContextVerifier({
        secret: jwtSecret,
        now,
      })
    )
    const token = await createHs256Jwt({
      secret: jwtSecret,
      payload: {
        actor_id: "user_worker_http_proof",
        actor_type: "user",
        auth_identity_id: "auth_user_worker_http_proof",
        app_metadata: {},
        user_metadata: {},
        exp: Math.floor(now().getTime() / 1000) + 60,
      },
    })

    await prepareRequest(
      req,
      new Request("https://worker.test/auth/session", {
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
    )

    expect(getMedusaRequestAuthContext(req)).toEqual({
      actor_id: "user_worker_http_proof",
      actor_type: "user",
      auth_identity_id: "auth_user_worker_http_proof",
      app_metadata: {},
      user_metadata: {},
    })
  })
})

function createProofJwt(payload: Record<string, unknown>): string {
  return [
    encodeJwtSegment({ alg: "none", typ: "JWT" }),
    encodeJwtSegment(payload),
    "worker-http-proof",
  ].join(".")
}

function encodeJwtSegment(value: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ""

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}
