import type {
  FulfillmentTypes,
  IFulfillmentModuleService,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

// Query supplies a selected record, not the complete StockLocationDTO. The
// container boundary keeps that transient provider context partial; all native
// persistence inputs and result/cancellation contracts retain their own types.
type CreationInput = Omit<FulfillmentTypes.CreateFulfillmentDTO, "location"> & {
  location?: Record<string, unknown> | undefined
}
type CreationService = {
  createFulfillment(data: CreationInput): ReturnType<IFulfillmentModuleService["createFulfillment"]>
}

export const createFulfillmentStepId = "create-fulfillment"
/**
 * This step creates a fulfillment.
 *
 * @example
 * const data = createFulfillmentStep({
 *   location_id: "sloc_123",
 *   provider_id: "provider_123",
 *   delivery_address: {
 *     first_name: "John",
 *     last_name: "Doe",
 *     address_1: "Test Street 1",
 *     city: "Test City",
 *     postal_code: "12345",
 *     country_code: "US",
 *     phone: "123456789",
 *   },
 *   items: [
 *     {
 *       title: "Shirt",
 *       sku: "shirt",
 *       quantity: 1,
 *       barcode: "123456789",
 *     }
 *   ]
 * })
 */
export const createFulfillmentStep = createStep(
  { name: createFulfillmentStepId, compensation: "transactionCovered" },
  async (data: CreationInput, { container }) => {
    const service = container.resolve<CreationService>(
      Modules.FULFILLMENT
    )

    const fulfillment = await service.createFulfillment(data)

    return new StepResponse(fulfillment, fulfillment.id)
  },
  async (id, { container }) => {
    if (!id) {
      return
    }

    const service = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    )

    await service.cancelFulfillment(id)
  }
)
