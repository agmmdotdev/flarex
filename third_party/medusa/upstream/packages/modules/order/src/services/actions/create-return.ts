import type {
  Context,
  CreateOrderChangeActionDTO,
  OrderTypes,
} from "@medusajs/framework/types"
import {
  ChangeActionType,
  type GetShippingMethodTotalInput,
  OrderChangeType,
  ReturnStatus,
  generateEntityId,
  getShippingMethodsTotals,
  isDefined,
  isString,
} from "@medusajs/framework/utils"

type MutableOrderEntity = {
  id: string
  [key: string]: unknown
}

function createReturnReference(data, order): MutableOrderEntity {
  return {
    id: generateEntityId(undefined, "return"),
    order_id: data.order_id,
    order_version: order.version,
    status: ReturnStatus.REQUESTED,
    no_notification: data.no_notification,
    refund_amount: (data.refund_amount as unknown) ?? null,
    location_id: data.location_id ?? null,
  }
}

function createReturnItems(data, returnRef, actions): MutableOrderEntity[] {
  return data.items.map((item) => {
    actions.push({
      action: ChangeActionType.RETURN_ITEM,
      return_id: returnRef.id,
      internal_note: item.internal_note,
      reference: "return",
      reference_id: returnRef.id,
      details: {
        reference_id: item.id,
        quantity: item.quantity,
        metadata: item.metadata,
      },
    })

    return {
      id: generateEntityId(undefined, "retitem"),
      reason_id: item.reason_id,
      return_id: returnRef.id,
      item_id: item.id,
      quantity: item.quantity,
      note: item.note,
      metadata: item.metadata,
    }
  })
}

async function processShippingMethod(
  service,
  data,
  returnRef,
  actions,
  sharedContext
) {
  let shippingMethodId
  let shippingMethod: GetShippingMethodTotalInput

  if (!isDefined(data.shipping_method)) {
    return
  }

  if (!isString(data.shipping_method)) {
    const methods = await service.createOrderShippingMethods(
      [
        {
          ...data.shipping_method,
          order_id: data.order_id,
          return_id: returnRef.id,
        },
      ],
      undefined,
      sharedContext
    )
    shippingMethodId = methods[0].id
    shippingMethod = methods[0]
  } else {
    shippingMethodId = data.shipping_method
    shippingMethod = await service.retrieveOrderShippingMethod(
      shippingMethodId,
      { relations: ["tax_lines", "adjustments"] },
      sharedContext
    )
  }

  const calculatedAmount = getShippingMethodsTotals([shippingMethod], {})[
    shippingMethod.id
  ]

  if (shippingMethodId) {
    actions.push({
      action: ChangeActionType.SHIPPING_ADD,
      reference: "order_shipping_method",
      reference_id: shippingMethodId,
      amount: calculatedAmount.total,
      details: {
        order_id: returnRef.order_id,
        return_id: returnRef.id,
      },
    })
  }
}

async function createOrderChange(
  service,
  data,
  returnRef,
  actions,
  sharedContext
) {
  return await service.createOrderChange_(
    {
      order_id: data.order_id,
      return_id: returnRef.id,
      change_type: OrderChangeType.RETURN_REQUEST,
      reference: "return",
      reference_id: returnRef.id,
      description: data.description,
      internal_note: data.internal_note,
      created_by: data.created_by,
      metadata: data.metadata,
      actions,
    },
    sharedContext
  )
}

export async function createReturn(
  this: any,
  data: OrderTypes.CreateOrderReturnDTO,
  sharedContext?: Context
) {
  const order = await this.orderService_.retrieve(
    data.order_id,
    { relations: ["items"] },
    sharedContext
  )

  const returnRef = createReturnReference(data, order)
  const actions: CreateOrderChangeActionDTO[] = []

  returnRef.items = createReturnItems(data, returnRef, actions)

  await this.createReturns([returnRef], sharedContext)

  await processShippingMethod(this, data, returnRef, actions, sharedContext)

  const change = await createOrderChange(
    this,
    data,
    returnRef,
    actions,
    sharedContext
  )

  await this.confirmOrderChange(change[0].id, sharedContext)

  return returnRef
}
