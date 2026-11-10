import type { MedusaRequest } from "@medusajs/framework/http"
import type { ProductTypes, RemoteQueryFunction } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string"

export const refetchCollection = async (
  collectionId: string,
  scope: MedusaRequest["scope"],
  fields: string[]
): Promise<ProductTypes.ProductCollectionDTO | undefined> => {
  const remoteQuery = scope.resolve<RemoteQueryFunction>(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "product_collection",
    variables: {
      filters: { id: collectionId },
    },
    fields: fields,
  })

  const collections = await remoteQuery(queryObject)
  return collections[0]
}
