import type { BasePaymentProvider } from "../common"

export interface AdminPaymentProvider extends BasePaymentProvider {
  /**
   * Whether the payment provider is enabled.
   */
  is_enabled: boolean
}
