import type { BigNumberInput } from "@medusajs/framework/types"
import {
  BigNumber,
  createRawPropertiesFromBigNumber,
  MathBN,
  transformPropertiesToBigNumber,
} from "@medusajs/framework/utils/portable"

type PaymentSummary = {
  order_id: string
  totals: Record<"paid_total" | "refunded_total" | "transaction_total" | "pending_difference", BigNumberInput>
}
type PaymentTransaction = { order_id: string; version: number; amount: BigNumberInput }

/** Native updateOrderPaidRefundableAmount_ arithmetic. The native service
 * retains selection, its version contract, mutation and event ownership. */
export function updateOrderPaymentSummaries(
  summaries: PaymentSummary[],
  transactionData: PaymentTransaction[],
  isRemoved: boolean
) {
  summaries.forEach((summary) => {
    let trxs = transactionData.filter(
      (trx) => trx.order_id === summary.order_id
    )

    if (!trxs.length) {
      return
    }
    transformPropertiesToBigNumber(trxs)

    const op = isRemoved ? MathBN.sub : MathBN.add

    const initialTrxTotal = summary.totals.transaction_total

    for (const trx of trxs) {
      if (MathBN.gt(trx.amount, 0)) {
        summary.totals.paid_total = new BigNumber(
          op(summary.totals.paid_total, trx.amount)
        )
      } else {
        summary.totals.refunded_total = new BigNumber(
          op(summary.totals.refunded_total, MathBN.abs(trx.amount))
        )
      }

      summary.totals.transaction_total = new BigNumber(
        op(summary.totals.transaction_total, trx.amount)
      )
    }

    const initialDiff = MathBN.sub(
      summary.totals.transaction_total,
      initialTrxTotal
    )
    summary.totals.pending_difference = new BigNumber(
      MathBN.sub(summary.totals.pending_difference, initialDiff)
    )
  })

  createRawPropertiesFromBigNumber(summaries)
}
