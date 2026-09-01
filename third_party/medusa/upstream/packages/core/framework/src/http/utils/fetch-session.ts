import type { AuthContext } from "../types"
import type {
  FetchHttpSession,
  FetchHttpSessionCommitInput,
} from "../adapters/fetch"

export type FetchHttpAuthSessionStore = {
  getAuthContext(sessionId: string): AuthContext | undefined
  setAuthContext(sessionId: string, authContext: AuthContext): void
  deleteAuthContext(sessionId: string): void
}

export type FetchHttpAuthSessionCommitPredicateInput = {
  request: Request
  pathname: string
  session: FetchHttpSession
}

export type CookieBackedFetchAuthSessionOptions = {
  cookieName?: string
  cookiePath?: string
  createSessionId: () => string
  store: FetchHttpAuthSessionStore
  shouldCommitSession?: (
    input: FetchHttpAuthSessionCommitPredicateInput
  ) => boolean
}

export type CookieBackedFetchAuthSessionHooks = {
  createSession: (request: Request) => FetchHttpSession
  commitSession: (input: FetchHttpSessionCommitInput) => void
}

type CookieBackedFetchAuthSession = FetchHttpSession & {
  __medusa_cookie_session_destroyed?: boolean
  __medusa_cookie_session_id?: string
  __medusa_cookie_session_pathname: string
  auth_context?: AuthContext
}

export function createCookieBackedFetchAuthSessionHooks({
  cookieName = "connect.sid",
  cookiePath = "/",
  createSessionId,
  store,
  shouldCommitSession = ({ pathname }) => pathname === "/auth/session",
}: CookieBackedFetchAuthSessionOptions): CookieBackedFetchAuthSessionHooks {
  return {
    createSession(request: Request): FetchHttpSession {
      const pathname = new URL(request.url).pathname
      const session: CookieBackedFetchAuthSession = {
        __medusa_cookie_session_pathname: pathname,
        destroy: () => {
          session.__medusa_cookie_session_destroyed = true
        },
      }
      const sessionId = getFetchCookieValue(
        request.headers.get("cookie") ?? undefined,
        cookieName
      )
      if (!sessionId) {
        return session
      }

      session.__medusa_cookie_session_id = sessionId
      const authContext = store.getAuthContext(sessionId)
      if (authContext) {
        session.auth_context = authContext
      }

      return session
    },

    commitSession(input: FetchHttpSessionCommitInput): void {
      const session = toCookieBackedFetchAuthSession(input.session)
      if (!session) {
        return
      }

      const pathname = session.__medusa_cookie_session_pathname
      if (
        !shouldCommitSession({
          request: input.request,
          pathname,
          session,
        })
      ) {
        return
      }

      const sessionId = session.__medusa_cookie_session_id
      if (session.__medusa_cookie_session_destroyed === true) {
        if (sessionId) {
          store.deleteAuthContext(sessionId)
        }
        input.responseHeaders.append(
          "set-cookie",
          `${cookieName}=; Path=${cookiePath}; HttpOnly; Max-Age=0`
        )
        return
      }

      if (!isAuthContext(session.auth_context)) {
        return
      }

      const nextSessionId = sessionId ?? createSessionId()
      store.setAuthContext(nextSessionId, session.auth_context)
      input.responseHeaders.append(
        "set-cookie",
        `${cookieName}=${nextSessionId}; Path=${cookiePath}; HttpOnly`
      )
    },
  }
}

export function getFetchCookieValue(
  cookieHeader: string | undefined,
  cookieName: string
): string | undefined {
  return cookieHeader
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1)
}

function toCookieBackedFetchAuthSession(
  session: FetchHttpSession
): CookieBackedFetchAuthSession | undefined {
  return typeof session.__medusa_cookie_session_pathname === "string"
    ? (session as CookieBackedFetchAuthSession)
    : undefined
}

function isAuthContext(value: unknown): value is AuthContext {
  return (
    isRecord(value) &&
    typeof value.actor_id === "string" &&
    typeof value.actor_type === "string" &&
    typeof value.auth_identity_id === "string" &&
    isRecord(value.app_metadata) &&
    isRecord(value.user_metadata)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
