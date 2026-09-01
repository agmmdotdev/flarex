import { asFunction, asValue } from "@medusajs/deps/awilix"
import type {
  CreatePaymentProviderDTO,
  LoaderOptions,
  ModuleExports,
  StaticModuleResources,
} from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
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
} from "./models"
import { joinerConfig } from "./joiner-config"
import { SystemPaymentProvider } from "./providers/system"
import PaymentModuleService from "./services/payment-module"
import PaymentProviderService from "./services/payment-provider"

const PROVIDER_REGISTRATION_KEY = "payment_providers"
const SYSTEM_PAYMENT_PROVIDER_ID = "pp_system_default"

export const paymentModuleDefinition = ModulesDefinition[Modules.PAYMENT]

export const paymentModuleModels = [
  PaymentCollection,
  PaymentSession,
  Payment,
  Capture,
  Refund,
  RefundReason,
  AccountHolder,
  PaymentProvider,
]

export const loadSystemPaymentProvider = async ({
  container,
}: LoaderOptions): Promise<void> => {
  container.register({
    [SYSTEM_PAYMENT_PROVIDER_ID]: asFunction(
      (cradle) => new SystemPaymentProvider(cradle)
    ).singleton(),
  })

  container.registerAdd(
    PROVIDER_REGISTRATION_KEY,
    asValue(SYSTEM_PAYMENT_PROVIDER_ID)
  )

  const paymentProviderService = container.resolve<PaymentProviderService>(
    "paymentProviderService"
  )

  const providersToLoad = container.resolve<string[]>(
    PROVIDER_REGISTRATION_KEY
  )
  const existingProviders = await paymentProviderService.list(
    { id: providersToLoad },
    {}
  )

  const upsertData: CreatePaymentProviderDTO[] = []

  for (const { id } of existingProviders) {
    if (!providersToLoad.includes(id)) {
      upsertData.push({ id, is_enabled: false })
    }
  }

  for (const id of providersToLoad) {
    upsertData.push({ id, is_enabled: true })
  }

  await paymentProviderService.upsert(upsertData)
}

export const paymentModuleExports: ModuleExports = {
  service: PaymentModuleService,
  loaders: [loadSystemPaymentProvider],
}

export const paymentStaticResources: StaticModuleResources = {
  models: paymentModuleModels,
  services: [PaymentProviderService],
  repositories: [],
  loaders: [loadSystemPaymentProvider],
  moduleService: PaymentModuleService,
  joinerConfig,
}
