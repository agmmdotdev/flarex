import fulfillmentModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import {
  Fulfillment,
  FulfillmentAddress,
  FulfillmentItem,
  FulfillmentLabel,
  FulfillmentProvider,
  FulfillmentSet,
  GeoZone,
  ServiceZone,
  ShippingOption,
  ShippingOptionRule,
  ShippingOptionType,
  ShippingProfile,
} from "../models"
import FulfillmentModuleService from "../services/fulfillment-module-service"
import FulfillmentProviderService from "../services/fulfillment-provider"
import {
  fulfillmentModuleDefinition,
  fulfillmentModuleExports,
  fulfillmentStaticResources,
} from "../static-manifest"

describe("Fulfillment static manifest", () => {
  it("matches the normal Fulfillment module export and explicit static resources", () => {
    expect(fulfillmentModuleDefinition).toEqual(
      ModulesDefinition[Modules.FULFILLMENT]
    )
    expect(fulfillmentModuleExports.service).toBe(fulfillmentModule.service)
    expect(fulfillmentModuleExports.loaders).toEqual([])
    expect(fulfillmentStaticResources.moduleService).toBe(
      FulfillmentModuleService
    )
    expect(fulfillmentStaticResources.models).toEqual([
      FulfillmentAddress,
      Fulfillment,
      FulfillmentItem,
      FulfillmentLabel,
      FulfillmentProvider,
      FulfillmentSet,
      GeoZone,
      ServiceZone,
      ShippingOption,
      ShippingOptionRule,
      ShippingOptionType,
      ShippingProfile,
    ])
    expect(fulfillmentStaticResources.services).toEqual([
      FulfillmentProviderService,
    ])
    expect(fulfillmentStaticResources.repositories).toEqual([])
    expect(fulfillmentStaticResources.loaders).toEqual([])

    const normalizedSchema = fulfillmentStaticResources.joinerConfig?.schema
      ?.replace(/\s+/g, " ")
      .trim()

    expect(normalizedSchema).toEqual(
      expect.stringContaining("type Fulfillment")
    )
    expect(normalizedSchema).toEqual(
      expect.stringContaining("type FulfillmentSet")
    )
    expect(normalizedSchema).toEqual(
      expect.stringContaining("type ShippingOption")
    )
  })
})
