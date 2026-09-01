import type { AuthContext } from "../types"
import {
  createCookieBackedFetchAuthSessionHooks,
  getFetchCookieValue,
  type FetchHttpAuthSessionStore,
} from "../utils/fetch-session"

describe("Fetch HTTP session helpers", () => {
  const authContext: AuthContext = {
    actor_id: "user_fetch_session",
    actor_type: "user",
    auth_identity_id: "auth_fetch_session",
    app_metadata: {},
    user_metadata: {},
  }

  it("loads, commits, and destroys cookie-backed auth sessions", () => {
    let sequence = 0
    const storeValues = new Map<string, AuthContext>()
    const store: FetchHttpAuthSessionStore = {
      getAuthContext: (sessionId) => storeValues.get(sessionId),
      setAuthContext: (sessionId, context) => {
        storeValues.set(sessionId, context)
      },
      deleteAuthContext: (sessionId) => {
        storeValues.delete(sessionId)
      },
    }
    const hooks = createCookieBackedFetchAuthSessionHooks({
      createSessionId: () => {
        sequence += 1
        return `session_${sequence}`
      },
      store,
    })

    const responseHeaders = new Headers()
    const request = new Request("https://medusa.test/auth/session", {
      method: "POST",
    })
    const session = hooks.createSession(request)
    session.auth_context = authContext

    hooks.commitSession({
      request,
      responseHeaders,
      session,
    })

    expect(responseHeaders.get("set-cookie")).toBe(
      "connect.sid=session_1; Path=/; HttpOnly"
    )
    expect(storeValues.get("session_1")).toBe(authContext)

    const nextSession = hooks.createSession(
      new Request("https://medusa.test/store/products", {
        headers: {
          cookie: "connect.sid=session_1",
        },
      })
    )
    expect(nextSession.auth_context).toBe(authContext)

    const destroySession = hooks.createSession(
      new Request("https://medusa.test/auth/session", {
        method: "DELETE",
        headers: {
          cookie: "connect.sid=session_1",
        },
      })
    )
    const destroyHeaders = new Headers()
    destroySession.destroy?.()
    hooks.commitSession({
      request: new Request("https://medusa.test/auth/session", {
        method: "DELETE",
      }),
      responseHeaders: destroyHeaders,
      session: destroySession,
    })

    expect(storeValues.has("session_1")).toBe(false)
    expect(destroyHeaders.get("set-cookie")).toBe(
      "connect.sid=; Path=/; HttpOnly; Max-Age=0"
    )
  })

  it("reads named cookie values from a Fetch cookie header", () => {
    expect(
      getFetchCookieValue("foo=1; connect.sid=session_1; other=2", "connect.sid")
    ).toBe("session_1")
    expect(getFetchCookieValue("foo=1", "connect.sid")).toBeUndefined()
  })
})
