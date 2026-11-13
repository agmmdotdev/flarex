import { decodeStoreOrderStatusView, type StoreOrderListResult, type StoreOrderListVariables } from "../../common/steps/store-order-query-views"
import { deduplicate } from "@medusajs/framework/utils/portable"
import {
  createWorkflow,
  transform,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/workflows-sdk"
import { useRemoteQueryStep } from "../../common/steps/use-remote-query"
import {
  getLastFulfillmentStatus,
  getLastPaymentStatus,
} from "../utils/aggregate-status"

/**
 * The retrieved list of orders. If you passed pagination configurations in the
 * input, the response will return an object that includes the list of
 * orders and their pagination details. Otherwise, only the list of orders are returned.
 */
export type GetOrdersListWorkflowOutput = StoreOrderListResult

export type GetOrdersListWorkflowInput = {
  /**
   * The fields and relations to retrieve in the order. These fields
   * are passed to [Query](https://docs.medusajs.com/learn/fundamentals/module-links/query),
   * so you can pass names of custom models linked to the order.
   */
  fields: string[]
  /**
   * Filters and pagination configurations to apply on the retrieved orders.
   */
  variables: StoreOrderListVariables
}

export const getOrdersListWorkflowId = "get-orders-list"
/**
 * This workflow retrieves a list of orders. It's used by the
 * [List Orders Admin API Route](https://docs.medusajs.com/api/admin#orders_getorders), and the
 * [List Orders Store API Route](https://docs.medusajs.com/api/store#orders_getorders).
 *
 * You can use this workflow within your customizations or your own custom workflows, allowing you to retrieve a list of
 * orders in your custom flows. For example, you can retrieve the list of orders to export them
 * to a third-party system.
 *
 * @example
 * To retrieve the list of orders:
 *
 * ```ts
 * const { result } = await getOrdersListWorkflow(container)
 * .run({
 *   input: {
 *     fields: ["id", "status", "items"],
 *   }
 * })
 * ```
 *
 * To retrieve the list of orders with pagination:
 *
 * ```ts
 * const { result } = await getOrdersListWorkflow(container)
 * .run({
 *   input: {
 *     fields: ["id", "status", "items"],
 *     variables: {
 *       skip: 0,
 *       take: 15,
 *     }
 *   }
 * })
 * ```
 *
 * @summary
 *
 * Retrieve a list of orders.
 */
export const getOrdersListWorkflow = createWorkflow(
  getOrdersListWorkflowId,
  (
    input: WorkflowData<GetOrdersListWorkflowInput>
  ): WorkflowResponse<GetOrdersListWorkflowOutput> => {
    const fields = transform(input, ({ fields }) => {
      return deduplicate([
        ...fields,
        "id",
        "status",
        "version",
        "items.*",
        "payment_collections.status",
        "payment_collections.amount",
        "payment_collections.captured_amount",
        "payment_collections.refunded_amount",
        "fulfillments.packed_at",
        "fulfillments.shipped_at",
        "fulfillments.delivered_at",
        "fulfillments.canceled_at",
      ])
    })

    const orders = useRemoteQueryStep({
      entry_point: "orders",
      fields,
      variables: input.variables,
      list: true,
    })

    const aggregatedOrders = transform(
      { orders, input },
      ({ orders, input }) => {
        const fields = input.fields
        const requiredPaymentFields = fields.some((f) =>
          f.includes("payment_collections")
        )
        const requiredFulfillmentFields = fields.some((f) =>
          f.includes("fulfillments")
        )

        const orders_ = orders
        const data = orders_.rows

        for (const order of data) {
          const order_ = decodeStoreOrderStatusView(order)

          order_.payment_status = getLastPaymentStatus(
            order_
          )
          order_.fulfillment_status = getLastFulfillmentStatus(
            order_
          )

          if (!requiredPaymentFields) {
            delete order.payment_collections
          }
          if (!requiredFulfillmentFields) {
            delete order.fulfillments
          }
        }

        return orders
      }
    )

    return new WorkflowResponse(aggregatedOrders)
  }
)
