import type { BigNumberInput, CreateCaptureDTO, CreateRefundDTO } from "@medusajs/framework/types"
import { BigNumber, MathBN, MedusaError, PaymentCollectionStatus, PaymentSessionStatus } from "@medusajs/framework/utils/portable"

/** Pure accounting and currency rounding extracted from the pinned native
 * PaymentModuleService. The service retains all reads, writes and providers. */
export interface PaymentCollectionAccountingInput {
  readonly amount: BigNumberInput
  readonly currency_code: string
  readonly payment_sessions: readonly { readonly status: string; readonly amount: BigNumberInput }[]
  readonly payments: readonly { readonly captures: readonly { readonly amount: BigNumberInput }[]; readonly refunds: readonly { readonly amount: BigNumberInput }[] }[]
}

export function roundToCurrencyPrecision(
  amount: BigNumberInput,
  currencyCode: string
): BigNumberInput {
  let precision: number | undefined = undefined
  try {
    const formatted = Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
    }).format(0.1111111)

    precision = formatted.split(".")[1].length
  } catch {
    // Unknown currency, keep the full precision
  }

  return MathBN.convert(amount, precision)
}


export function paymentCollectionUpdate(paymentCollection: PaymentCollectionAccountingInput, now: () => Date = () => new Date(),
  round: typeof roundToCurrencyPrecision = roundToCurrencyPrecision) {
  const paymentSessions = paymentCollection.payment_sessions
  const captures = paymentCollection.payments
    .map((pay) => [...pay.captures])
    .flat()
  const refunds = paymentCollection.payments
    .map((pay) => [...pay.refunds])
    .flat()

  let authorizedAmount = MathBN.convert(0)
  let capturedAmount = MathBN.convert(0)
  let refundedAmount = MathBN.convert(0)
  let completedAt: Date | undefined

  for (const ps of paymentSessions) {
    if (ps.status === PaymentSessionStatus.AUTHORIZED) {
      authorizedAmount = MathBN.add(authorizedAmount, ps.amount)
    }
  }

  for (const capture of captures) {
    capturedAmount = MathBN.add(capturedAmount, capture.amount)
  }

  for (const refund of refunds) {
    refundedAmount = MathBN.add(refundedAmount, refund.amount)
  }

  let status =
    paymentSessions.length === 0
      ? PaymentCollectionStatus.NOT_PAID
      : PaymentCollectionStatus.AWAITING

  if (MathBN.gt(authorizedAmount, 0)) {
    status = MathBN.gte(
      round(
        authorizedAmount,
        paymentCollection.currency_code
      ),
      round(
        paymentCollection.amount,
        paymentCollection.currency_code
      )
    )
      ? PaymentCollectionStatus.AUTHORIZED
      : PaymentCollectionStatus.PARTIALLY_AUTHORIZED
  }

  if (
    MathBN.gte(
      round(
        capturedAmount,
        paymentCollection.currency_code
      ),
      round(
        paymentCollection.amount,
        paymentCollection.currency_code
      )
    )
  ) {
    status = PaymentCollectionStatus.COMPLETED
    completedAt = now()
  }

  return { status, authorized_amount: authorizedAmount, captured_amount: capturedAmount, refunded_amount: refundedAmount, completed_at: completedAt }
}

export interface PaymentCaptureAccountingInput {
  readonly id: string
  readonly amount: BigNumberInput
  readonly raw_amount: unknown
  readonly currency_code: string
  readonly canceled_at?: unknown
  readonly captured_at?: unknown
  readonly captures: readonly { readonly raw_amount: unknown }[]
}

/** The native guard also fills the caller-owned missing/falsy amount. */
export function validatePaymentCapture(data: CreateCaptureDTO, payment: PaymentCaptureAccountingInput,
  round: typeof roundToCurrencyPrecision = roundToCurrencyPrecision) {
  if (payment.canceled_at) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `The payment: ${payment.id} has been canceled.`
    )
  }

  if (payment.captured_at) {
    return { isFullyCaptured: true }
  }

  // If no custom amount is passed, we assume the full amount needs to be captured
  if (!data.amount) {
    data.amount = payment.amount as number
  }

  const capturedAmount = payment.captures.reduce((captureAmount, next) => {
    return MathBN.add(captureAmount, next.raw_amount as BigNumberInput)
  }, MathBN.convert(0))

  const authorizedAmount = new BigNumber(payment.raw_amount as BigNumberInput)
  const newCaptureAmount = new BigNumber(data.amount)
  const remainingToCapture = MathBN.sub(authorizedAmount, capturedAmount)

  if (
    MathBN.gt(
      round(newCaptureAmount, payment.currency_code),
      round(remainingToCapture, payment.currency_code)
    )
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `You cannot capture more than the authorized amount substracted by what is already captured.`
    )
  }

  // When the entire authorized amount has been captured, we return it as complete
  const totalCaptured = MathBN.convert(
    MathBN.add(capturedAmount, newCaptureAmount)
  )
  const isFullyCaptured = MathBN.gte(
    round(totalCaptured, payment.currency_code),
    round(authorizedAmount, payment.currency_code)
  )

  return { isFullyCaptured }
}

export interface PaymentRefundAccountingInput {
  readonly amount: BigNumberInput
  readonly captures: readonly { readonly raw_amount: unknown }[]
  readonly refunds: readonly { readonly raw_amount: unknown }[]
}

export function validatePaymentRefund(payment: PaymentRefundAccountingInput, data: CreateRefundDTO) {
  if (!data.amount) {
    data.amount = payment.amount as BigNumberInput
  }

  const capturedAmount = payment.captures.reduce((captureAmount, next) => {
    const amountAsBigNumber = new BigNumber(next.raw_amount as BigNumberInput)
    return MathBN.add(captureAmount, amountAsBigNumber)
  }, MathBN.convert(0))
  const refundedAmount = payment.refunds.reduce((refundedAmount, next) => {
    return MathBN.add(refundedAmount, next.raw_amount as BigNumberInput)
  }, MathBN.convert(0))

  const totalRefundedAmount = MathBN.add(refundedAmount, data.amount)

  if (MathBN.lt(capturedAmount, totalRefundedAmount)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `You cannot refund more than what is captured on the payment.`
    )
  }

}
