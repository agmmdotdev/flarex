import {
  ApiKeyType,
  PUBLISHABLE_KEY_HEADER,
} from "@medusajs/utils/api-key/api-key-type"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { MedusaError } from "@medusajs/utils/common/errors"
import type {
  MedusaNextFunction,
  MedusaResponse,
  MedusaStoreRequest,
} from "../types"
import { setMedusaRequestPublishableKeyContext } from "../utils/request-context"

type PublishableApiKeyQueryRow = {
  id: string
  token: string
  revoked_at: string | Date | null
  sales_channels_link: Array<{
    sales_channel_id: string
  }>
}

type PublishableApiKeyQueryResult = {
  data: PublishableApiKeyQueryRow[]
}

type PublishableApiKeyQuery = {
  graph: (
    query: {
      entity: "api_key"
      fields: string[]
      filters: {
        token: string
        type: ApiKeyType.PUBLISHABLE
      }
    },
    options: {
      cache: {
        enable: true
      }
    }
  ) => Promise<PublishableApiKeyQueryResult>
}

export async function ensurePublishableApiKeyMiddleware(
  req: MedusaStoreRequest,
  _: MedusaResponse,
  next: MedusaNextFunction
) {
  const publishableApiKey = req.get(PUBLISHABLE_KEY_HEADER)

  if (typeof publishableApiKey !== "string" || publishableApiKey.length === 0) {
    const error = new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Publishable API key required in the request header: ${PUBLISHABLE_KEY_HEADER}. You can manage your keys in settings in the dashboard.`
    )
    return next(error)
  }

  let apiKey: PublishableApiKeyQueryRow | undefined
  const query = req.scope.resolve(
    ContainerRegistrationKeys.QUERY
  ) as PublishableApiKeyQuery

  try {
    // Cache API key data and check revocation in memory
    const { data } = await query.graph(
      {
        entity: "api_key",
        fields: [
          "id",
          "token",
          "revoked_at",
          "sales_channels_link.sales_channel_id",
        ],
        filters: {
          token: publishableApiKey,
          type: ApiKeyType.PUBLISHABLE,
        },
      },
      {
        cache: {
          enable: true,
        },
      }
    )

    if (data.length) {
      const now = new Date()
      const cachedApiKey = data[0]
      const isRevoked =
        !!cachedApiKey.revoked_at && new Date(cachedApiKey.revoked_at) <= now

      if (!isRevoked) {
        apiKey = cachedApiKey
      }
    }
  } catch (e) {
    return next(e)
  }

  if (!apiKey) {
    try {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `A valid publishable key is required to proceed with the request`
      )
    } catch (e) {
      return next(e)
    }
  }

  setMedusaRequestPublishableKeyContext(req, {
    key: apiKey.token,
    sales_channel_ids: apiKey.sales_channels_link.map(
      (link) => link.sales_channel_id
    ),
  })

  return next()
}
