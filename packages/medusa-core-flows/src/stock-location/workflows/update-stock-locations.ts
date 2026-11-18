import type {
  FilterableStockLocationProps,
  StockLocationTypes,
  UpdateStockLocationInput,
  UpsertStockLocationAddressInput,
} from "@medusajs/framework/types"
import {
  type WorkflowData,
  type WorkflowDefinition,
  WorkflowResponse,
  createWorkflow,
  WorkflowDefinitionError,
  transform,
} from "@medusajs/workflows-sdk"

import { Result, Schema } from "effect"
import { useQueryGraphStep, type QueryGraphInput } from "../../common/steps/use-query-graph"
import { updateStockLocationsStep } from "../steps/update-stock-locations"
import { upsertStockLocationAddressesStep } from "../steps/upsert-stock-location-addresses"

// Query field selection yields partial JSON records, never a complete module DTO.
const decodeStockLocations = Schema.decodeUnknownResult(Schema.Array(Schema.Struct({
  id: Schema.String,
  address: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.String }))),
})), { onExcessProperty: "error" })

/**
 * The data to update the stock locations.
 */
export interface UpdateStockLocationsWorkflowInput {
  /**
   * The filters to select the stock locations to update.
   */
  selector: FilterableStockLocationProps
  /**
   * The data to update the stock locations with.
   */
  update: UpdateStockLocationInput
}
export type UpdateStockLocationsWorkflowOutput = StockLocationTypes.StockLocationDTO | undefined

export const updateStockLocationsWorkflowId = "update-stock-locations-workflow"
/**
 * This workflow updates stock locations matching the specified filters. It's used by the
 * [Update Stock Location Admin API Route](https://docs.medusajs.com/api/admin#stock-locations_poststocklocationsid).
 *
 * You can use this workflow within your own customizations or custom workflows, allowing you
 * to update stock locations in your custom flows.
 *
 * @example
 * const { result } = await updateStockLocationsWorkflow(container)
 * .run({
 *   input: {
 *     selector: {
 *       id: "sloc_123"
 *     },
 *     update: {
 *       name: "European Warehouse"
 *     }
 *   }
 * })
 *
 * @summary
 *
 * Update stock locations.
 */
export const updateStockLocationsWorkflow: WorkflowDefinition<
  UpdateStockLocationsWorkflowInput,
  WorkflowData<UpdateStockLocationsWorkflowOutput>,
  readonly []
> = createWorkflow(
  updateStockLocationsWorkflowId,
  (
    input: WorkflowData<UpdateStockLocationsWorkflowInput>
  ): WorkflowResponse<WorkflowData<UpdateStockLocationsWorkflowOutput>> => {
    const stockLocationsQuery = useQueryGraphStep({
      entity: "stock_location",
      filters: input.selector as NonNullable<QueryGraphInput["filters"]>,
      fields: ["id", "address.id"],
    }).config({ name: "get-stock-location" })

    const stockLocations = transform(
      { stockLocationsQuery },
      ({ stockLocationsQuery }) => Result.getOrThrow(decodeStockLocations(stockLocationsQuery.data).pipe(
        Result.mapError(() => new WorkflowDefinitionError({ reason: "unsupportedProfile", detail: "Stock Location updates require the selected Location and Address IDs" })),
      ))
    )

    const normalizedData = transform(
      { input, stockLocations },
      ({ input, stockLocations }) => {
        const { address, address_id, ...stockLocationInput } = input.update
        const addressesInput: UpsertStockLocationAddressInput[] = []

        if (address) {
          for (const stockLocation of stockLocations) {
            if (stockLocation.address?.id) {
              addressesInput.push({
                id: stockLocation.address?.id!,
                ...address,
              })
            } else {
              addressesInput.push(address)
            }
          }
        }

        return {
          stockLocationInput: {
            selector: input.selector,
            update: stockLocationInput,
          },
          addressesInput,
        }
      }
    )

    upsertStockLocationAddressesStep(normalizedData.addressesInput)

    return new WorkflowResponse(
      updateStockLocationsStep(normalizedData.stockLocationInput)
    )
  }
)
