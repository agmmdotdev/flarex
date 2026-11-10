import type { MedusaRequest } from "@medusajs/framework/http"
import type { ProductTypes, RemoteQueryFunction } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string"

export const refetchProductType = async (
  productTypeId: string,
  scope: MedusaRequest["scope"],
  fields: string[]
): Promise<ProductTypes.ProductTypeDTO | undefined> => {
  const remoteQuery = scope.resolve<RemoteQueryFunction>(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "product_type",
    variables: {
      filters: { id: productTypeId },
    },
    fields: fields,
  })

  const productTypes = await remoteQuery(queryObject)
  return productTypes[0]
}
