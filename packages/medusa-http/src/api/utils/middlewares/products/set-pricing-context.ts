import type { RegionDTO, CustomerGroupDTO } from "@medusajs/framework/types"
import type {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  refetchEntities,
  refetchEntity,
} from "@medusajs/framework/http"
import type { MedusaPricingContext } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/utils/common/errors"
import type { MedusaNextFunction as NextFunction } from "@medusajs/framework/http"
import { DEFAULT_PRICE_FIELD_PATHS } from "./constants"

type PricingContextOptions = {
  priceFieldPaths?: string[]
}

export function setPricingContext(options: PricingContextOptions = {}) {
  const { priceFieldPaths = DEFAULT_PRICE_FIELD_PATHS } = options

  return async (
    req: MedusaRequest & { pricingContext?: MedusaPricingContext },
    _: MedusaResponse,
    next: NextFunction
  ) => {
    const withCalculatedPrice = req.queryConfig.fields.some((field) =>
      priceFieldPaths.some(
        (pricePath) => field === pricePath || field.startsWith(`${pricePath}.`)
      )
    )
    if (!withCalculatedPrice) {
      return next()
    }

    // We validate the region ID in the previous middleware
    const region = await refetchEntity<Pick<RegionDTO, "id" | "currency_code">>({
      entity: "region",
      idOrFilter: req.filterableFields.region_id!,
      scope: req.scope,
      fields: ["id", "currency_code"],
      options: {
        cache: {
          enable: true,
        },
      },
    })

    if (!region) {
      try {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Region with id ${req.filterableFields.region_id} not found when populating the pricing context`
        )
      } catch (e) {
        return next(e)
      }
    }

    const pricingContext: MedusaPricingContext = {
      region_id: region.id,
      currency_code: region.currency_code,
    }

    // Find all the customer groups the customer is a part of and set
    if (req.auth_context?.actor_id) {
      const { data: customerGroups } = await refetchEntities<Pick<CustomerGroupDTO, "id">>({
        entity: "customer_group",
        idOrFilter: { customers: { id: req.auth_context.actor_id } },
        scope: req.scope,
        fields: ["id"],
      })

      pricingContext.customer = { groups: [] }
      customerGroups.map((cg) =>
        pricingContext.customer?.groups?.push({ id: cg.id })
      )
    }

    req.pricingContext = pricingContext
    return next()
  }
}
