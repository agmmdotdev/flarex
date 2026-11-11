import type { SalesChannelDTO } from "@medusajs/framework/types"
import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string"

export const refetchSalesChannel = async (
  salesChannelId: string,
  scope: MedusaRequest["scope"],
  fields: string[]
) => {
  const remoteQuery = scope.resolve<(input: ReturnType<typeof remoteQueryObjectFromString>) => Promise<SalesChannelDTO[]>>(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "sales_channel",
    variables: {
      filters: { id: salesChannelId },
    },
    fields: fields,
  })

  const salesChannels = await remoteQuery(queryObject)
  return salesChannels[0]
}
