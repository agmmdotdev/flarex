import type {
  Context,
  CreateOrderChangeActionDTO,
  OrderTypes,
} from "@medusajs/framework/types"
import {
  ChangeActionType,
  ClaimType,
  OrderChangeType,
  ReturnStatus,
  generateEntityId,
  getShippingMethodsTotals,
  isString,
} from "@medusajs/framework/utils"

type MutableOrderEntity = {
  id: string
  [key: string]: unknown
}

function createClaimAndReturnEntities(data, order): {
  claimReference: MutableOrderEntity
  returnReference: MutableOrderEntity | undefined
} {
  const claimReference: MutableOrderEntity = {
    id: generateEntityId(undefined, "claim"),
    order_id: data.order_id,
    order_version: order.version,
    type: data.type as ClaimType,
    no_notification: data.no_notification,
    refund_amount: (data.refund_amount as unknown) ?? null,
  }

  let returnReference: MutableOrderEntity | undefined
  if (data.type === ClaimType.REPLACE) {
    returnReference = {
      id: generateEntityId(undefined, "return"),
      order_id: data.order_id,
      order_version: order.version,
      status: ReturnStatus.REQUESTED,
      claim_id: claimReference.id,
      refund_amount: (data.refund_amount as unknown) ?? null,
    }
  }

  claimReference.return_id = returnReference?.id

  return { claimReference, returnReference }
}

function createReturnItem(
  item,
  claimReference,
  returnReference,
  actions
): MutableOrderEntity {
  actions.push({
    action: ChangeActionType.RETURN_ITEM,
    reference: "return",
    reference_id: returnReference.id,
    details: {
      reference_id: item.id,
      quantity: item.quantity,
      metadata: item.metadata,
    },
  })

  return {
    id: generateEntityId(undefined, "retitem"),
    item_id: item.id,
    return_id: returnReference.id,
    quantity: item.quantity,
    note: item.note,
    metadata: item.metadata,
  }
}

function createClaimAndReturnItems(
  data,
  claimReference,
  returnReference,
  actions
) {
  const returnItems: Array<MutableOrderEntity | undefined> = []
  const claimItems = data.claim_items?.map((item) => {
    actions.push({
      action: ChangeActionType.WRITE_OFF_ITEM,
      reference: "claim",
      reference_id: claimReference.id,
      details: {
        reference_id: item.id,
        quantity: item.quantity,
        metadata: item.metadata,
      },
    })

    returnItems.push(
      returnReference
        ? createReturnItem(item, claimReference, returnReference, actions)
        : undefined
    )

    return {
      id: generateEntityId(undefined, "claitem"),
      item_id: item.id,
      reason: item.reason,
      quantity: item.quantity,
      note: item.note,
      metadata: item.metadata,
    }
  })

  return [claimItems, returnItems]
}

async function processAdditionalItems(
  service,
  data,
  order,
  claimReference,
  actions,
  sharedContext
) {
  const itemsToAdd: any[] = []
  const additionalNewItems: any[] = []
  const additionalItems: any[] = []
  data.additional_items?.forEach((item) => {
    const hasItem = item.id
      ? order.items.find((o) => o.item.id === item.id)
      : false

    if (hasItem) {
      actions.push({
        action: ChangeActionType.ITEM_ADD,
        claim_id: claimReference.id,
        internal_note: item.internal_note,
        reference: "claim",
        reference_id: claimReference.id,
        details: {
          reference_id: item.id,
          quantity: item.quantity,
          unit_price: item.unit_price ?? hasItem.item.unit_price,
          metadata: item.metadata,
        },
      })

      additionalItems.push(
        {
          id: generateEntityId(undefined, "claitem"),
          item_id: item.id,
          quantity: item.quantity,
          note: item.note,
          metadata: item.metadata,
          is_additional_item: true,
        }
      )
    } else {
      itemsToAdd.push(item)

      additionalNewItems.push(
        {
          id: generateEntityId(undefined, "claitem"),
          quantity: item.quantity,
          unit_price: item.unit_price,
          note: item.note,
          metadata: item.metadata,
          is_additional_item: true,
        }
      )
    }
  })

  const createItems = await service.orderLineItemService_.create(
    itemsToAdd,
    sharedContext
  )

  createItems.forEach((item, index) => {
    const addedItem = itemsToAdd[index]
    additionalNewItems[index].item_id = item.id
    actions.push({
      action: ChangeActionType.ITEM_ADD,
      claim_id: claimReference.id,
      internal_note: addedItem.internal_note,
      reference: "claim",
      reference_id: claimReference.id,
      details: {
        reference_id: item.id,
        claim_id: claimReference.id,
        quantity: addedItem.quantity,
        unit_price: item.unit_price,
        metadata: addedItem.metadata,
      },
    })
  })

  return additionalNewItems.concat(additionalItems)
}

async function processShippingMethods(
  service,
  data,
  claimReference,
  actions,
  sharedContext
) {
  for (const shippingMethod of data.shipping_methods ?? []) {
    let shippingMethodId

    if (!isString(shippingMethod)) {
      const methods = await service.createOrderShippingMethods(
        [
          {
            ...shippingMethod,
            order_id: data.order_id,
            claim_id: claimReference.id,
          },
        ],
        undefined,
        sharedContext
      )
      shippingMethodId = methods[0].id
    } else {
      shippingMethodId = shippingMethod
    }

    const method = await service.retrieveOrderShippingMethod(
      shippingMethodId,
      { relations: ["tax_lines", "adjustments"] },
      sharedContext
    )

    const calculatedAmount = getShippingMethodsTotals([method as any], {})[
      method.id
    ]

    actions.push({
      action: ChangeActionType.SHIPPING_ADD,
      reference: "order_shipping_method",
      reference_id: shippingMethodId,
      claim_id: claimReference.id,
      amount: calculatedAmount.total,
    })
  }
}

async function processReturnShipping(
  service,
  data,
  claimReference,
  returnReference,
  actions,
  sharedContext
) {
  if (!returnReference) {
    return
  }

  if (data.return_shipping) {
    let returnShippingMethodId

    if (!isString(data.return_shipping)) {
      const methods = await service.createOrderShippingMethods(
        [
          {
            ...data.return_shipping,
            order_id: data.order_id,
            claim_id: claimReference.id,
            return_id: returnReference.id,
          },
        ],
        undefined,
        sharedContext
      )
      returnShippingMethodId = methods[0].id
    } else {
      returnShippingMethodId = data.return_shipping
    }

    const method = await service.retrieveOrderShippingMethod(
      returnShippingMethodId,
      { relations: ["tax_lines", "adjustments"] },
      sharedContext
    )

    const calculatedAmount = getShippingMethodsTotals([method as any], {})[
      method.id
    ]

    actions.push({
      action: ChangeActionType.SHIPPING_ADD,
      reference: "order_shipping_method",
      reference_id: returnShippingMethodId,
      return_id: returnReference.id,
      claim_id: claimReference.id,
      amount: calculatedAmount.total,
    })
  }
}

export async function createClaim(
  this: any,
  data: OrderTypes.CreateOrderClaimDTO,
  sharedContext?: Context
) {
  const order = await this.orderService_.retrieve(
    data.order_id,
    { relations: ["items"] },
    sharedContext
  )
  const actions: CreateOrderChangeActionDTO[] = []
  const { claimReference, returnReference } = createClaimAndReturnEntities(
    data,
    order
  )

  const [claimItems, returnItems] = createClaimAndReturnItems(
    data,
    claimReference,
    returnReference,
    actions
  )

  claimReference.claim_items = claimItems

  if (returnReference) {
    returnReference.items = returnItems
  }

  claimReference.additional_items = await processAdditionalItems(
    this,
    data,
    order,
    claimReference,
    actions,
    sharedContext
  )

  const returnId = claimReference.return_id
  delete claimReference.return_id

  await this.createOrderClaims([claimReference], sharedContext)
  if (returnReference) {
    await this.createReturns([returnReference], sharedContext)
  }
  if (returnId) {
    await this.orderClaimService_.update(
      [{ id: claimReference.id, return_id: returnId }],
      sharedContext
    )
    claimReference.return_id = returnId
  }

  await processShippingMethods(
    this,
    data,
    claimReference,
    actions,
    sharedContext
  )
  await processReturnShipping(
    this,
    data,
    claimReference,
    returnReference,
    actions,
    sharedContext
  )

  const change = await this.createOrderChange_(
    {
      order_id: data.order_id,
      claim_id: claimReference.id,
      return_id: returnReference?.id,
      change_type: OrderChangeType.CLAIM,
      reference: "claim",
      reference_id: claimReference.id,
      description: data.description,
      internal_note: data.internal_note,
      created_by: data.created_by,
      metadata: data.metadata,
      actions,
    },
    sharedContext
  )

  await this.confirmOrderChange(change[0].id, sharedContext)

  return claimReference
}
