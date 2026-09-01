import type { RemoteQueryFunction } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

type PublishableApiKeyScopes = {
  sales_channel_ids: string[]
}

type PublishableApiKeyScopeRequest = MedusaRequest & {
  publishableApiKeyScopes?: PublishableApiKeyScopes
}

/**
 * If a publishable key (PK) is passed in the header of the request, we attach
 * the IDs of resources within the scope of the key.
 *
 * @param req - request object
 * @param res - response object
 * @param next - next middleware call
 *
 * @throws if sales channel id is passed as a url or body param
 *         but that id is not in the scope defined by the PK from the header
 */
export async function maybeAttachPublishableKeyScopes(
  req: PublishableApiKeyScopeRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const pubKey = req.get("x-publishable-api-key")

  if (pubKey) {
    const remoteQuery = req.scope.resolve<RemoteQueryFunction>(
      ContainerRegistrationKeys.REMOTE_QUERY
    )

    const queryObject = remoteQueryObjectFromString({
      entryPoint: "api_key",
      fields: ["sales_channels.id"],
      variables: {
        filters: { token: pubKey },
      },
    })

    const result: unknown = await remoteQuery(queryObject)

    req.publishableApiKeyScopes = {
      sales_channel_ids: getPublishableSalesChannelIds(result),
    }
  }

  next()
}

function getPublishableSalesChannelIds(result: unknown): string[] {
  if (!Array.isArray(result)) {
    return []
  }

  const [apiKey] = result
  if (!isRecord(apiKey) || !Array.isArray(apiKey.sales_channels)) {
    return []
  }

  return apiKey.sales_channels
    .map((salesChannel) =>
      isRecord(salesChannel) && typeof salesChannel.id === "string"
        ? salesChannel.id
        : undefined
    )
    .filter((id): id is string => typeof id === "string")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  )
}
