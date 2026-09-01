import {
  AuthenticatedMedusaRequest,
  getAuthContextFromJwtToken,
  getMedusaRequestValidatedTokenPayload,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ConfigModule, IAuthModuleService } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { HttpTypes } from "@medusajs/types"

export interface UpdateProviderJwtPayload {
  entity_id: string
  actor_type: string
  provider: string
}

// Middleware to validate that a token is valid
export const validateToken = () => {
  return async (
    req: MedusaRequest<HttpTypes.AdminUpdateProvider>,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    const { actor_type, auth_provider } = req.params

    const req_ = req as AuthenticatedMedusaRequest

    const { http } = req_.scope.resolve<ConfigModule>(
      ContainerRegistrationKeys.CONFIG_MODULE
    ).projectConfig

    const errorObject = new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      `Invalid token`
    )

    const token = getUpdateProviderJwtPayload(req, {
      actorType: actor_type,
      jwtSecret: http.jwtSecret!,
      jwtPublicKey: http.jwtPublicKey,
      jwtOptions: http.jwtVerifyOptions ?? http.jwtOptions,
    })

    if (!token) {
      return next(errorObject)
    }

    const authModule = req.scope.resolve<IAuthModuleService>(Modules.AUTH)

    if (!token?.entity_id) {
      return next(errorObject)
    }

    const [providerIdentity] = await authModule.listProviderIdentities(
      {
        entity_id: token.entity_id,
        provider: auth_provider,
      },
      {
        select: [
          "provider_metadata",
          "auth_identity_id",
          "entity_id",
          "user_metadata",
        ],
      }
    )

    if (!providerIdentity) {
      return next(errorObject)
    }

    req_.auth_context = {
      actor_type,
      auth_identity_id: providerIdentity.auth_identity_id!,
      actor_id: providerIdentity.entity_id,
      app_metadata: {},
      user_metadata: providerIdentity.user_metadata ?? {},
    }

    return next()
  }
}

function getUpdateProviderJwtPayload(
  req: MedusaRequest<HttpTypes.AdminUpdateProvider>,
  options: {
    actorType: string
    jwtSecret: ConfigModule["projectConfig"]["http"]["jwtSecret"]
    jwtPublicKey: ConfigModule["projectConfig"]["http"]["jwtPublicKey"]
    jwtOptions: ConfigModule["projectConfig"]["http"]["jwtVerifyOptions"]
  }
): UpdateProviderJwtPayload | null {
  const runtimePayload = getMedusaRequestValidatedTokenPayload(req)
  if (isUpdateProviderJwtPayload(runtimePayload, options.actorType)) {
    return runtimePayload
  }

  const jwtPayload = getAuthContextFromJwtToken(
    req.headers.authorization,
    options.jwtSecret!,
    ["bearer"],
    [options.actorType],
    options.jwtPublicKey,
    options.jwtOptions
  )

  if (isUpdateProviderJwtPayload(jwtPayload, options.actorType)) {
    return jwtPayload
  }

  return null
}

function isUpdateProviderJwtPayload(
  value: unknown,
  actorType: string
): value is UpdateProviderJwtPayload {
  return (
    isRecord(value) &&
    typeof value.entity_id === "string" &&
    value.actor_type === actorType
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
