import {
  BigNumberInput,
  IPaymentModuleService,
  PaymentDTO,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { createStep, StepResponse, WorkflowDefinitionError } from "@medusajs/workflows-sdk"

// Native refund explicitly retrieves this relation. The finite module boundary
// checks its contents; this step additionally retains that selected presence.
const hasRefundRelations = (payment: PaymentDTO): payment is PaymentDTO & { refunds: NonNullable<PaymentDTO["refunds"]> } =>
  Array.isArray(payment.refunds)

/**
 * The data to refund a payment.
 */
export type RefundPaymentStepInput = {
  /**
   * The ID of the payment to refund.
   */
  payment_id: string
  /**
   * The ID of the user that refunded the payment.
   */
  created_by?: string
  /**
   * The amount to refund. If not provided, the full refundable amount is refunded.
   */
  amount?: BigNumberInput
}

export const refundPaymentStepId = "refund-payment-step"
/**
 * This step refunds a payment.
 */
export const refundPaymentStep = createStep(
  refundPaymentStepId,
  async (input: RefundPaymentStepInput, { container }) => {
    const paymentModule = container.resolve<IPaymentModuleService>(
      Modules.PAYMENT
    )

    const payment = await paymentModule.refundPayment(input)
    if (!hasRefundRelations(payment)) {
      throw new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Native refund omitted its refunds relation" })
    }

    return new StepResponse(payment)
  }
  // We don't want to compensate a refund automatically as the actual funds have already been sent
  // And in most cases we can't simply do another capture/authorization
)
