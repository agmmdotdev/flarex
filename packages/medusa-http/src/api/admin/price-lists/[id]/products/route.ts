import { Modules } from "@medusajs/utils/modules-sdk/definition"
import type { PriceListDTO } from "@medusajs/framework/types"
import type { AdminRemoveProductsPriceListBody } from "../../validators"
import { MedusaError } from "@medusajs/utils/common/errors"
import {
  type AuthenticatedMedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { fetchPriceList, fetchPriceListPriceIdsForProduct } from "../../helpers"

type PriceListWorkflowEngine = {
  run(id: "batch-price-list-prices", options: { input: { data: { id: string; create: never[]; update: never[]; delete: string[] } } }): Promise<unknown>
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    AdminRemoveProductsPriceListBody
  >,
  res: MedusaResponse<{ price_list: PriceListDTO }>
) => {
  const id = req.params.id
  const { remove = [] } = req.validatedBody

  if (!remove.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No product ids passed to remove from price list"
    )
  }

  const productPriceIds = await fetchPriceListPriceIdsForProduct(
    id,
    remove,
    req.scope
  )

  const workflow = req.scope.resolve<PriceListWorkflowEngine>(Modules.WORKFLOW_ENGINE)
  await workflow.run("batch-price-list-prices", {
    input: {
      data: {
        id,
        create: [],
        update: [],
        delete: productPriceIds,
      },
    },
  })

  const priceList = await fetchPriceList(id, req.scope, req.queryConfig.fields)

  res.status(200).json({ price_list: priceList })
}
