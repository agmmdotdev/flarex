import type { AuthContext, MedusaRequest } from "../types"
import { createMedusaContainer } from "@medusajs/utils"
import { asValue } from "../../deps/awilix"
import {
  setMedusaRequestContext,
  getMedusaRequestAuthContext,
  getMedusaRequestPublishableKeyContext,
  getMedusaRequestValidatedTokenPayload,
  setMedusaRequestAuthContext,
  setMedusaRequestPublishableKeyContext,
  setMedusaRequestValidatedTokenPayload,
  setupMedusaHttpRequest,
  type MedusaRequestSetupTarget,
} from "../utils/request-context"

describe("request context helpers", () => {
  const authContext: AuthContext = {
    actor_id: "user_123",
    actor_type: "user",
    auth_identity_id: "auth_123",
    app_metadata: {
      roles: ["admin"],
    },
    user_metadata: {},
  }

  it("sets and reads auth context on a Medusa request", () => {
    const req = createRequest()

    setMedusaRequestAuthContext(req, authContext)

    expect(getMedusaRequestAuthContext(req)).toBe(authContext)
    expect(req.session).toBeUndefined()
  })

  it("persists auth context into the request session when requested", () => {
    const req = createRequest({
      session: {
        existing: true,
      },
    })

    setMedusaRequestAuthContext(req, authContext, { persistSession: true })

    expect(req.session).toEqual({
      existing: true,
      auth_context: authContext,
    })
  })

  it("sets and reads publishable key context on a Medusa request", () => {
    const req = createRequest()
    const publishableKeyContext = {
      key: "pk_test",
      sales_channel_ids: ["sc_123"],
    }

    setMedusaRequestPublishableKeyContext(req, publishableKeyContext)

    expect(getMedusaRequestPublishableKeyContext(req)).toBe(
      publishableKeyContext
    )
  })

  it("sets and reads a validated token payload on a Medusa request", () => {
    const req = createRequest()
    const payload = {
      actor_type: "user",
      entity_id: "user@example.com",
      provider: "emailpass",
    }

    setMedusaRequestValidatedTokenPayload(req, payload)

    expect(getMedusaRequestValidatedTokenPayload(req)).toBe(payload)
  })

  it("sets up a runtime-neutral request scope, request id, and request context", () => {
    const container = createMedusaContainer()
    container.register({
      runtimeValue: asValue("shared-runtime"),
    })
    const req: MedusaRequestSetupTarget = {}

    setupMedusaHttpRequest(req, {
      container,
      requestId: "req_123",
      ipAddress: "127.0.0.1",
    })

    if (!req.scope) {
      throw new Error("Expected request scope to be created")
    }

    expect(req.scope).not.toBe(container)
    expect(req.scope.resolve<string>("runtimeValue")).toBe("shared-runtime")
    expect(req.requestId).toBe("req_123")
    expect(req.request_context).toEqual({
      ip_address: "127.0.0.1",
    })
  })

  it("merges request context without writing undefined values", () => {
    const req: MedusaRequestSetupTarget = {
      request_context: {
        ip_address: "127.0.0.1",
      },
    }

    setMedusaRequestContext(req, {
      ip_address: undefined,
    })

    expect(req.request_context).toEqual({
      ip_address: "127.0.0.1",
    })
  })
})

function createRequest(input: Partial<MedusaRequest> = {}): MedusaRequest {
  return input as MedusaRequest
}
