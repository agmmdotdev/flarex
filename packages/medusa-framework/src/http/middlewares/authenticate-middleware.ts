import type { AuthContext, MedusaRequest, MedusaResponse, MedusaNextFunction, MiddlewareFunction } from "../types"
import { getMedusaRequestAuthContext, setMedusaRequestAuthContext } from "../utils/request-context"
const SESSION_AUTH = "session"
const BEARER_AUTH = "bearer"
export type AuthType = typeof SESSION_AUTH | typeof BEARER_AUTH
type MedusaSession = { auth_context: AuthContext }

export const authenticate = (
  actorType: string | string[],
  authType: AuthType | AuthType[],
  options: { allowUnauthenticated?: boolean; allowUnregistered?: boolean } = {}
): MiddlewareFunction => {
  const authenticateMiddleware = async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): Promise<void> => {
    const authTypes = Array.isArray(authType) ? authType : [authType]
    const actorTypes = Array.isArray(actorType) ? actorType : [actorType]

    // We try to extract the auth context from an upstream runtime hook, the
    // session, or a JWT token.
    let authContext: AuthContext | null = getPermittedExistingAuthContext(
      req,
      actorTypes
    )

    authContext ??= getAuthContextFromSession(
      req.session,
      authTypes,
      actorTypes
    )

    // The trusted Fetch prepareRequest hook supplies only cryptographically
    // verified bearer context. The portable core does not decode credentials.

    // If the entity is authenticated, and it is a registered actor we can continue
    if (authContext?.actor_id) {
      setMedusaRequestAuthContext(req, authContext)
      return next()
    }

    // If the entity is authenticated, but there is no registered actor yet, we can continue (eg. in the case of a user invite) if allow unregistered is set
    // We also don't want to allow creating eg. a customer with a token created for a `user` provider.
    if (
      authContext?.auth_identity_id &&
      options.allowUnregistered &&
      isActorTypePermitted(actorTypes, authContext.actor_type)
    ) {
      setMedusaRequestAuthContext(req, authContext)
      return next()
    }

    // If we allow unauthenticated requests (i.e public endpoints), just continue
    if (options.allowUnauthenticated) {
      return next()
    }

    res.status(401).json({ message: "Unauthorized" })
  }

  return authenticateMiddleware
}

const getAuthContextFromSession = (
  session: Partial<MedusaSession> = {},
  authTypes: AuthType[],
  actorTypes: string[]
): AuthContext | null => {
  if (!authTypes.includes(SESSION_AUTH)) {
    return null
  }

  if (
    session.auth_context &&
    isActorTypePermitted(actorTypes, session.auth_context?.actor_type)
  ) {
    return session.auth_context
  }

  return null
}

const getPermittedExistingAuthContext = (
  req: MedusaRequest,
  actorTypes: string[]
): AuthContext | null => {
  const authContext = getMedusaRequestAuthContext(req)
  if (
    authContext &&
    isActorTypePermitted(actorTypes, authContext.actor_type)
  ) {
    return authContext
  }

  return null
}

const isActorTypePermitted = (
  actorTypes: string | string[],
  currentActorType: string
) => {
  return actorTypes.includes("*") || actorTypes.includes(currentActorType)
}

