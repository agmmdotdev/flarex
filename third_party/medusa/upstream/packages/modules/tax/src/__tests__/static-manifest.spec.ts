import taxModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { TaxProvider, TaxRate, TaxRateRule, TaxRegion } from "../models"
import TaxModuleService from "../services/tax-module-service"
import TaxProviderService from "../services/tax-provider"
import {
  taxModuleDefinition,
  taxModuleExports,
  taxStaticResources,
} from "../static-manifest"

describe("Tax static manifest", () => {
  it("matches the normal Tax module export and explicit static resources", () => {
    expect(taxModuleDefinition).toEqual(ModulesDefinition[Modules.TAX])
    expect(taxModuleExports.service).toBe(taxModule.service)
    expect(taxModuleExports.loaders).toEqual([])
    expect(taxStaticResources.moduleService).toBe(TaxModuleService)
    expect(taxStaticResources.models).toEqual([
      TaxProvider,
      TaxRate,
      TaxRateRule,
      TaxRegion,
    ])
    expect(taxStaticResources.services).toEqual([TaxProviderService])
    expect(taxStaticResources.repositories).toEqual([])
    expect(taxStaticResources.loaders).toEqual([])

    const normalizedSchema = taxStaticResources.joinerConfig?.schema
      ?.replace(/\s+/g, " ")
      .trim()

    expect(normalizedSchema).toEqual(expect.stringContaining("type TaxRate"))
    expect(normalizedSchema).toEqual(expect.stringContaining("type TaxRegion"))
    expect(normalizedSchema).toEqual(
      expect.stringContaining("type TaxProvider")
    )
  })
})
