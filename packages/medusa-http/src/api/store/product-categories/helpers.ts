import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export const applyCategoryFilters = (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
  if (!req.filterableFields) {
    req.filterableFields = {}
  }

  req.filterableFields = {
    ...req.filterableFields,
    is_active: true,
    is_internal: false,
  }

  next()
}
