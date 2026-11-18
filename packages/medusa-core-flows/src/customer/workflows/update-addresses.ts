import {
  FilterableCustomerAddressProps,
  UpdateCustomerAddressDTO,
  AdditionalData,
  ICustomerModuleService,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import {
  WorkflowData,
  WorkflowResponse,
  createHook,
  createWorkflow,
  createStep,
  StepResponse,
  parallelize,
  transform,
} from "@medusajs/workflows-sdk"
import { maybeUnsetDefaultBillingAddressesStep } from "../steps/maybe-unset-default-billing-addresses"
import { maybeUnsetDefaultShippingAddressesStep } from "../steps/maybe-unset-default-shipping-addresses"
import { updateCustomerAddressesStep } from "../steps/update-addresses"

/**
 * The data to update one or more customer addresses, along with custom data that's passed to the workflow's hooks.
 */
export type UpdateCustomerAddressesWorkflowInput = {
  /**
   * The filters to select the addresses to update.
   */
  selector: FilterableCustomerAddressProps
  /**
   * The data to update in the addresses.
   */
  update: UpdateCustomerAddressDTO
} & AdditionalData

export const updateCustomerAddressesWorkflowId = "update-customer-addresses"

const selectCustomerAddressIdsStep = createStep(
  "select-customer-address-ids-for-update",
  async (selector: FilterableCustomerAddressProps, { container }) => {
    const service = container.resolve<ICustomerModuleService>(Modules.CUSTOMER)
    const addresses = await service.listCustomerAddresses(selector, {
      select: ["id"],
    })
    return new StepResponse(addresses.map((address) => address.id))
  }
)
/**
 * This workflow updates one or more addresses for customers. It's used by the [Update Customer Address Admin API Route](https://docs.medusajs.com/api/admin#customers_postcustomersidaddressesaddress_id)
 * and the [Update Customer Address Store API Route](https://docs.medusajs.com/api/store#customers_postcustomersmeaddressesaddress_id).
 * 
 * This workflow has a hook that allows you to perform custom actions on the updated customer addresses. For example, you can pass under `additional_data` custom data that
 * allows you to update custom data models linked to the addresses.
 * 
 * You can also use this workflow within your customizations or your own custom workflows, allowing you to wrap custom logic around updating customer addresses.
 * 
 * @example
 * const { result } = await updateCustomerAddressesWorkflow(container)
 * .run({
 *   input: {
 *     selector: {
 *       customer_id: "123"
 *     },
 *     update: {
 *       first_name: "John"
 *     },
 *     additional_data: {
 *       crm_id: "123"
 *     }
 *   }
 * })
 * 
 * @summary
 * 
 * Update one or more customer addresses.
 * 
 * @property hooks.addressesUpdated - This hook is executed after the addresses are updated. You can consume this hook to perform custom actions on the updated addresses.
 */
export const updateCustomerAddressesWorkflow = createWorkflow(
  updateCustomerAddressesWorkflowId,
  (input: WorkflowData<UpdateCustomerAddressesWorkflowInput>) => {
    const addressIds = selectCustomerAddressIdsStep(input.selector)
    const updateInput = transform({ input, addressIds }, ({ input, addressIds }) => ({
      ...input,
      selector: { id: addressIds },
    }))
    const unsetInput = transform(updateInput, (data) => ({
      update: data,
    }))

    parallelize(
      maybeUnsetDefaultShippingAddressesStep(unsetInput),
      maybeUnsetDefaultBillingAddressesStep(unsetInput)
    )

    const updatedAddresses = updateCustomerAddressesStep(updateInput)
    const addressesUpdated = createHook("addressesUpdated", {
      addresses: updatedAddresses,
      additional_data: input.additional_data,
    })

    return new WorkflowResponse(updatedAddresses, {
      hooks: [addressesUpdated],
    })
  }
)
