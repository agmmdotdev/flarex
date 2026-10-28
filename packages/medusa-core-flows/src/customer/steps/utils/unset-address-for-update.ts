import {
  FilterableCustomerAddressProps,
  ICustomerModuleService,
  UpdateCustomerAddressDTO,
} from "@medusajs/framework/types"
import { StepResponse } from "@medusajs/workflows-sdk"

export const unsetForUpdate = async (
  data: {
    selector: FilterableCustomerAddressProps
    update: UpdateCustomerAddressDTO
  },
  customerService: ICustomerModuleService,
  field: "is_default_billing" | "is_default_shipping"
) => {
  if (!data.update[field]) {
    return new StepResponse(void 0)
  }

  const affectedCustomers = await customerService.listCustomerAddresses(
    data.selector,
    {
      select: ["id", "customer_id"],
    }
  )

  const customerIds = affectedCustomers.map((address) => address.customer_id)

  const customerDefaultAddresses = await customerService.listCustomerAddresses({
    customer_id: customerIds,
    [field]: true,
  })

  const affectedAddressIds = new Set(affectedCustomers.map((address) => address.id))
  const addressIds = customerDefaultAddresses
    .filter((address) => !affectedAddressIds.has(address.id))
    .map((address) => address.id)

  if (addressIds.length) {
    await customerService.updateCustomerAddresses(
      { id: addressIds },
      { [field]: false }
    )
  }

  return new StepResponse(
    void 0,
    addressIds
  )
}
