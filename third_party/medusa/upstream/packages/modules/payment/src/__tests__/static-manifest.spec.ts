import paymentModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import {
  AccountHolder,
  Capture,
  Payment,
  PaymentCollection,
  PaymentProvider,
  PaymentSession,
  Refund,
  RefundReason,
} from "../models"
import { joinerConfig } from "../joiner-config"
import { SystemPaymentProvider } from "../providers/system"
import PaymentModuleService from "../services/payment-module"
import PaymentProviderService from "../services/payment-provider"
import {
  loadSystemPaymentProvider,
  paymentModuleDefinition,
  paymentModuleExports,
  paymentStaticResources,
} from "../static-manifest"

describe("Payment static manifest", () => {
  it("matches the normal Payment service export and explicit static resources", () => {
    expect(paymentModuleDefinition).toEqual(ModulesDefinition[Modules.PAYMENT])
    expect(paymentModuleExports.service).toBe(paymentModule.service)
    expect(paymentModuleExports.loaders).toEqual([loadSystemPaymentProvider])
    expect(paymentStaticResources.moduleService).toBe(PaymentModuleService)
    expect(paymentStaticResources.models).toEqual([
      PaymentCollection,
      PaymentSession,
      Payment,
      Capture,
      Refund,
      RefundReason,
      AccountHolder,
      PaymentProvider,
    ])
    expect(paymentStaticResources.services).toEqual([PaymentProviderService])
    expect(paymentStaticResources.repositories).toEqual([])
    expect(paymentStaticResources.loaders).toEqual([loadSystemPaymentProvider])
    expect(paymentStaticResources.joinerConfig).toBe(joinerConfig)
  })

  it("keeps the Worker static provider path scoped to the system provider", () => {
    expect(SystemPaymentProvider.identifier).toBe("system")
    expect(paymentStaticResources.loaders).toHaveLength(1)
  })
})
