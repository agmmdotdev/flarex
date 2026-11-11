import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string"
import { MedusaError } from "@medusajs/utils/common/errors"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { HttpTypes, RemoteQueryFunction } from "@medusajs/framework/types"

export const GET = async (
  req: MedusaRequest<HttpTypes.SelectParams>,
  res: MedusaResponse<HttpTypes.StoreRegionResponse>
) => {
  const remoteQuery = req.scope.resolve<RemoteQueryFunction>(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "region",
    variables: {
      filters: { id: req.params.id },
    },
    fields: req.queryConfig.fields,
  })

  const [region] = await remoteQuery(queryObject)

  if (!region) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Region with id: ${req.params.id} was not found`
    )
  }

  res.status(200).json({ region })
}
