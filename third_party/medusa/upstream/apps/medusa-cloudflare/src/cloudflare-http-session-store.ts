import { createCookieBackedFetchAuthSessionHooks } from "@medusajs/framework/http/fetch"
import type {
  AuthContext,
  CookieBackedFetchAuthSessionHooks,
  CookieBackedFetchAuthSessionOptions,
  FetchHttpAuthSessionStore,
} from "@medusajs/framework/http/fetch"

const authSessionSchemaSql = `
CREATE TABLE IF NOT EXISTS medusa_http_auth_session (
  session_id TEXT PRIMARY KEY,
  auth_context_json TEXT NOT NULL
)
`

type AuthSessionRow = {
  auth_context_json: string
}

export class DurableObjectSqliteFetchAuthSessionStore
  implements FetchHttpAuthSessionStore
{
  constructor(private readonly storage: DurableObjectStorage) {
    this.storage.sql.exec(authSessionSchemaSql)
  }

  getAuthContext(sessionId: string): AuthContext | undefined {
    const row = this.storage.sql
      .exec<AuthSessionRow>(
        "SELECT auth_context_json FROM medusa_http_auth_session WHERE session_id = ?",
        sessionId
      )
      .toArray()[0]

    if (!row) {
      return undefined
    }

    return parseAuthContext(row.auth_context_json)
  }

  setAuthContext(sessionId: string, authContext: AuthContext): void {
    this.storage.sql.exec(
      `INSERT OR REPLACE INTO medusa_http_auth_session (
        session_id,
        auth_context_json
      ) VALUES (?, ?)`,
      sessionId,
      JSON.stringify(authContext)
    )
  }

  deleteAuthContext(sessionId: string): void {
    this.storage.sql.exec(
      "DELETE FROM medusa_http_auth_session WHERE session_id = ?",
      sessionId
    )
  }

  count(): number {
    const row = this.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM medusa_http_auth_session"
      )
      .toArray()[0]

    return row?.count ?? 0
  }
}

export type DurableObjectFetchAuthSessionRuntime = {
  hooks: CookieBackedFetchAuthSessionHooks
  store: DurableObjectSqliteFetchAuthSessionStore
}

export type DurableObjectFetchAuthSessionRuntimeOptions = {
  shouldCommitSession?: CookieBackedFetchAuthSessionOptions["shouldCommitSession"]
}

export function createDurableObjectFetchAuthSessionRuntime(
  storage: DurableObjectStorage,
  options: DurableObjectFetchAuthSessionRuntimeOptions = {}
): DurableObjectFetchAuthSessionRuntime {
  const store = new DurableObjectSqliteFetchAuthSessionStore(storage)

  return {
    hooks: createCookieBackedFetchAuthSessionHooks({
      createSessionId: () => `do_session_${crypto.randomUUID()}`,
      store,
      shouldCommitSession: options.shouldCommitSession,
    }),
    store,
  }
}

function parseAuthContext(value: string): AuthContext | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    return isAuthContext(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
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
