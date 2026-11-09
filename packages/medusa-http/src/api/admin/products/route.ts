import { refetchEntity, type AuthenticatedMedusaRequest, type MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import type { ProductTypes } from "@medusajs/framework/types"
import type { AdminCreateProductBody } from "./validators"
import { remapKeysForProduct, remapProductResponse } from "./helpers"

const createProductsWorkflowId = "create-products"

type CreateProductsWorkflowEngine = {
  run(id: typeof createProductsWorkflowId, options: {
    input: { products: Omit<AdminCreateProductBody, "additional_data">[]; additional_data?: AdminCreateProductBody["additional_data"] }
  }): Promise<{ result: { id: string }[] }>
}

// Selected pinned Admin Products POST. Workflow settlement precedes refetch.
export const POST = async (
  req: AuthenticatedMedusaRequest<AdminCreateProductBody>,
  res: MedusaResponse<{ product: ReturnType<typeof remapProductResponse> }>
) => {
  const { additional_data, ...products } = req.validatedBody

  const workflowEngine = req.scope.resolve<CreateProductsWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  const { result } = await workflowEngine.run(createProductsWorkflowId, {
    input: { products: [products], additional_data },
  })

  const product = await refetchEntity<ProductTypes.ProductDTO>({
    entity: "product",
    idOrFilter: result[0].id,
    scope: req.scope,
    fields: remapKeysForProduct(req.queryConfig.fields ?? []),
  })

  res.status(200).json({ product: remapProductResponse(product) })
}
