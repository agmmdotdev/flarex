import { Modules } from "@medusajs/framework/utils"
import loadDefaults from "../loaders/defaults"
import { Locale, Settings, Translation } from "../models"
import TranslationModuleService from "../services/translation-module"
import {
  translationModuleDefinition,
  translationModuleExports,
  translationModuleModels,
  translationStaticResources,
} from "../static-manifest"

describe("Translation static manifest", () => {
  it("matches the normal Translation module export and explicit static resources", () => {
    expect(translationModuleDefinition.key).toBe(Modules.TRANSLATION)
    expect(translationModuleExports.service).toBe(TranslationModuleService)
    expect(translationModuleExports.loaders).toEqual([loadDefaults])
    expect(translationModuleModels).toEqual([Locale, Translation, Settings])
    expect(translationStaticResources.models).toBe(translationModuleModels)
    expect(translationStaticResources.services).toEqual([])
    expect(translationStaticResources.repositories).toEqual([])
    expect(translationStaticResources.loaders).toEqual([loadDefaults])
    expect(translationStaticResources.moduleService).toBe(
      TranslationModuleService
    )
    expect(translationStaticResources.joinerConfig?.serviceName).toBe(
      Modules.TRANSLATION
    )
    expect(translationStaticResources.joinerConfig?.linkableKeys).toMatchObject(
      {
        locale_id: "Locale",
        translation_id: "Translation",
        translation_settings_id: "TranslationSettings",
      }
    )
  })
})
