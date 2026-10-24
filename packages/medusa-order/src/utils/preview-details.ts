import type { Context, IOrderModuleService } from "@medusajs/framework/types"
import { isDefined } from "@medusajs/framework/utils/portable"

type PreviewReads = Pick<IOrderModuleService, "listOrderLineItems" | "listOrderShippingMethods">

/** Pinned native preview enrichment. Callers supply its two native read ports;
 * arithmetic, mutation order and receiver-owned borrowing remain unchanged. */
export async function includeOrderPreviewDetails(
  reads: PreviewReads,
  order,
  itemsToUpsert,
  shippingMethodsToUpsert,
  lineItemAdjustmentsToCreate,
  sharedContext: Context = {}
) {
    const addedItems = {}
    const addedShippingMethods = {}

    for (const item of order.items) {
      const isExistingItem = item.id === item.detail?.item_id
      if (!isExistingItem) {
        addedItems[item.id] = {
          ...item,
          quantity: item.detail?.quantity ?? item.quantity,
          unit_price: item.detail?.unit_price || item.unit_price,
          compare_at_unit_price:
            item.detail?.compare_at_unit_price ||
            item.compare_at_unit_price ||
            null,
        }
      }
    }

    for (const sm of order.shipping_methods) {
      if (!isDefined(sm.shipping_option_id)) {
        addedShippingMethods[sm.id] = sm
      }
    }

    if (Object.keys(addedItems).length > 0) {
      const addedItemDetails = await reads.listOrderLineItems(
        { id: Object.keys(addedItems) },
        {
          relations: ["adjustments", "tax_lines"],
        },
        sharedContext
      )

      order.items.forEach((item, idx) => {
        if (!addedItems[item.id]) {
          return
        }

        const lineItem = addedItemDetails.find((d) => d.id === item.id) as any

        const actions = item.actions
        delete item.actions

        //@ts-ignore
        const newItem = itemsToUpsert.find((d) => d.item_id === item.id)!

        const adjustments = lineItemAdjustmentsToCreate.filter(
          (d) => d.item_id === newItem.item_id
        )

        const unitPrice = newItem?.unit_price ?? item.unit_price
        const compareAtUnitPrice =
          newItem?.compare_at_unit_price ?? item.compare_at_unit_price

        delete lineItem.raw_unit_price
        delete lineItem.raw_compare_at_unit_price

        order.items[idx] = {
          ...lineItem,
          actions,
          quantity: newItem.quantity,
          unit_price: unitPrice,
          compare_at_unit_price: compareAtUnitPrice || null,
          adjustments: adjustments,
          detail: {
            ...newItem,
            ...item,
          },
        }
      })
    }

    if (Object.keys(addedShippingMethods).length > 0) {
      const addedShippingDetails = await reads.listOrderShippingMethods(
        { id: Object.keys(addedShippingMethods) },
        {
          relations: ["adjustments", "tax_lines"],
        },
        sharedContext
      )

      order.shipping_methods.forEach((sm, idx) => {
        if (!addedShippingMethods[sm.id]) {
          return
        }

        const shippingMethod = addedShippingDetails.find(
          (d) => d.id === sm.id
        ) as any

        const actions = sm.actions
        delete sm.actions

        const newItem = shippingMethodsToUpsert.find((d) => d.id === sm.id)!

        sm.shipping_method_id = sm.id
        delete sm.id

        order.shipping_methods[idx] = {
          ...shippingMethod,
          actions,
          detail: {
            ...sm,
            ...newItem,
          },
        }
      })
    }
  }
