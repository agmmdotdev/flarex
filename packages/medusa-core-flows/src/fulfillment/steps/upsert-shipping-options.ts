import {
  FulfillmentWorkflow,
  IFulfillmentModuleService,
  ShippingOptionDTO,
  UpsertShippingOptionDTO,
  CreateShippingOptionRuleDTO,
  FilterableShippingOptionRuleProps,
} from "@medusajs/framework/types"
import { arrayDifference, getSelectsAndRelationsFromObjectArray, Modules, } from "@medusajs/framework/utils/portable"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

/**
 * The data to create or update shipping options.
 */
export type UpsertShippingOptionsStepInput = Omit<
  | FulfillmentWorkflow.CreateShippingOptionsWorkflowInput
  | FulfillmentWorkflow.UpdateShippingOptionsWorkflowInput,
  "prices"
>[]

async function restoreShippingOptionRulePreimages(
  previous: { id: string; rules?: (CreateShippingOptionRuleDTO & { id: string })[] }[],
  service: IFulfillmentModuleService
) {
  const withRules = previous.filter(option => Object.hasOwn(option, "rules"))
  if (!withRules.length) return
  // The native DML supports the owner FK although its filter DTO omits it.
  const filters: FilterableShippingOptionRuleProps & { shipping_option_id: string[] } = {
    shipping_option_id: withRules.map(option => option.id),
  }
  const current = await service.listShippingOptionRules(
    filters,
    { select: ["id", "shipping_option_id"] }
  )
  const original = withRules.flatMap(option =>
    (option.rules ?? []).map(rule => ({ ...rule, shipping_option_id: option.id }))
  )
  const currentIds = new Set(current.map(rule => rule.id))
  const originalIds = new Set(original.map(rule => rule.id))
  const missing = original.filter(rule => !currentIds.has(rule.id))
  if (missing.length) await service.createShippingOptionRules(missing)
  const introduced = current.filter(rule => !originalIds.has(rule.id)).map(rule => rule.id)
  if (introduced.length) await service.deleteShippingOptionRules(introduced)
}

export const upsertShippingOptionsStepId = "create-shipping-options-step"
/**
 * This step creates or updates shipping options.
 */
export const upsertShippingOptionsStep = createStep(
  { name: upsertShippingOptionsStepId, compensation: "transactionCovered" },
  async (input: UpsertShippingOptionsStepInput, { container }) => {
    if (!input?.length) {
      return new StepResponse([], {})
    }

    const fulfillmentService = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    )

    const toUpdate: FulfillmentWorkflow.UpdateShippingOptionsWorkflowInput[] =
      []

    ;(
      input as FulfillmentWorkflow.UpdateShippingOptionsWorkflowInput[]
    ).forEach((inputItem) => {
      if (!!inputItem.id) {
        return toUpdate.push(inputItem)
      }
      return
    })

    let toUpdatePreviousData: ShippingOptionDTO[] = []

    if (toUpdate.length) {
      const { selects, relations } =
        getSelectsAndRelationsFromObjectArray(toUpdate)
      if (toUpdate.some(option => Object.hasOwn(option, "rules"))) {
        const fullSelects = selects.filter(field => !field.startsWith("rules."))
        selects.splice(0, selects.length, ...fullSelects, "rules.*")
        if (!relations.includes("rules")) relations.push("rules")
      }
      toUpdatePreviousData = await fulfillmentService.listShippingOptions(
        {
          id: toUpdate.map((s) => s.id),
        },
        {
          select: selects,
          relations,
        }
      )
    }

    const upsertedShippingOptions: ShippingOptionDTO[] =
      await fulfillmentService.upsertShippingOptions(
        input.map(inputItem => {
          const upsertShippingOption = inputItem as UpsertShippingOptionDTO
          if (inputItem.type_id) {
            upsertShippingOption.type = inputItem.type_id
          }
          return upsertShippingOption;
        })
      )

    const upsertedShippingOptionIds = upsertedShippingOptions.map((s) => s.id)

    const updatedIds = toUpdate.map((s) => s.id)
    return new StepResponse(upsertedShippingOptions, {
      updatedPreviousData: toUpdatePreviousData,
      createdIds: arrayDifference(
        upsertedShippingOptionIds,
        updatedIds
      ) as string[],
    })
  },
  async (shippingOptionIds: any, { container }) => {
    if (
      !shippingOptionIds?.updatedPreviousData?.length &&
      !shippingOptionIds?.createdIds?.length
    ) {
      return
    }

    const fulfillmentService = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    )

    if (shippingOptionIds.updatedPreviousData.length) {
      await restoreShippingOptionRulePreimages(
        shippingOptionIds.updatedPreviousData, fulfillmentService
      )
      await fulfillmentService.upsertShippingOptions(
        shippingOptionIds.updatedPreviousData
      )
    }

    if (shippingOptionIds.createdIds.length) {
      await fulfillmentService.deleteShippingOptions(
        shippingOptionIds.createdIds
      )
    }
  }
)
