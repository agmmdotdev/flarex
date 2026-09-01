import {
  IPaymentModuleService,
  PaymentCollectionDTO,
  PaymentDTO,
  PaymentSessionDTO,
} from "@medusajs/framework/types"

import {
  defaultPaymentCollectionData,
  defaultPaymentData,
  defaultPaymentSessionData,
} from "./data"

export * from "./data"

type PaymentCollectionFixture = (typeof defaultPaymentCollectionData)[number]
type PaymentSessionFixture = (typeof defaultPaymentSessionData)[number]
type PaymentFixture = (typeof defaultPaymentData)[number]

type GeneratedPaymentFixtureService = IPaymentModuleService & {
  createPaymentCollections(
    data: PaymentCollectionFixture[]
  ): Promise<PaymentCollectionDTO[]>
  createPaymentSessions(
    data: PaymentSessionFixture[]
  ): Promise<PaymentSessionDTO[]>
  createPayments(data: PaymentFixture[]): Promise<PaymentDTO[]>
}

export async function createPaymentCollections(
  service: GeneratedPaymentFixtureService,
  paymentCollectionData = defaultPaymentCollectionData
): Promise<PaymentCollectionDTO[]> {
  return await service.createPaymentCollections(paymentCollectionData)
}

export async function createPaymentSessions(
  service: GeneratedPaymentFixtureService,
  paymentSessionData = defaultPaymentSessionData
): Promise<PaymentSessionDTO[]> {
  return await service.createPaymentSessions(paymentSessionData)
}

export async function createPayments(
  service: GeneratedPaymentFixtureService,
  paymentData = defaultPaymentData
): Promise<PaymentDTO[]> {
  return await service.createPayments(paymentData)
}
