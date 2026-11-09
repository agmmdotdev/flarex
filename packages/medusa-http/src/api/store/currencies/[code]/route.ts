import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { MedusaError } from "@medusajs/utils/common/errors"
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { HttpTypes, RemoteQueryFunction } from "@medusajs/framework/types"

export const GET = async (
  req: MedusaRequest<HttpTypes.SelectParams>,
  res: MedusaResponse<HttpTypes.StoreCurrencyResponse>
) => {
  const remoteQuery = req.scope.resolve<RemoteQueryFunction>(ContainerRegistrationKeys.REMOTE_QUERY)

  const variables = { filters: { code: req.params.code } }

  const queryObject = remoteQueryObjectFromString({
    entryPoint: "currency",
    variables,
    fields: req.queryConfig.fields,
  })

  const [currency] = await remoteQuery(queryObject)
  if (!currency) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Currency with code: ${req.params.code} was not found`
    )
  }

  res.status(200).json({ currency })
}
