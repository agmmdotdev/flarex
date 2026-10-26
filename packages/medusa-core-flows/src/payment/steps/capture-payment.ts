import {
  BigNumberInput,
  IPaymentModuleService,
  PaymentDTO,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep, WorkflowDefinitionError } from "@medusajs/workflows-sdk"

// This finite Payment method authenticates the complete DTO at its module
// boundary. Its native capture read must also include the captures relation.
const hasCaptureRelations = (payment: PaymentDTO): payment is PaymentDTO & { captures: NonNullable<PaymentDTO["captures"]> } =>
  Array.isArray(payment.captures)

/**
 * The data to capture a payment.
 */
export type CapturePaymentStepInput = {
  /**
   * The ID of the payment to capture.
   */
  payment_id: string
  /**
   * The ID of the user that captured the payment.
   */
  captured_by?: string
  /**
   * The amount to capture. If not provided, the full payment amount will be captured.
   */
  amount?: BigNumberInput
}

export const capturePaymentStepId = "capture-payment-step"
/**
 * This step captures a payment.
 */
export const capturePaymentStep = createStep(
  capturePaymentStepId,
  async (input: CapturePaymentStepInput, { container }) => {
    const paymentModule = container.resolve<IPaymentModuleService>(
      Modules.PAYMENT
    )

    const payment = await paymentModule.capturePayment(input)
    if (!hasCaptureRelations(payment)) {
      throw new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Native capture omitted its captures relation" })
    }

    return new StepResponse(payment)
  }
  // We don't want to compensate a capture automatically as the actual funds have already been taken.
  // The only want to compensate here is to issue a refund, but it's better to leave that as a manual operation for now.
)
