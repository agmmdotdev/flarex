import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  defineFileConfig,
  FeatureFlag,
} from "@medusajs/framework/utils"
import { HttpTypes } from "@medusajs/framework/types"
import TranslationFeatureFlag from "../../../feature-flags/translation"

type StoreLocaleRow = {
  locale_code: string
  locale: {
    name: string
  }
}

/**
 * @since 2.12.3
 * @featureFlag translation
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse<HttpTypes.StoreLocaleListResponse>
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const {
    data: [store],
  } = await query.graph({
    entity: "store",
    fields: ["supported_locales.*", "supported_locales.locale.*"],
    pagination: {
      take: 1,
    },
  })

  const locales = getSupportedLocales(store).map((locale) => ({
    code: locale.locale_code,
    name: locale.locale.name,
  }))

  res.json({
    locales,
  })
}

defineFileConfig({
  isDisabled: () => !FeatureFlag.isFeatureEnabled(TranslationFeatureFlag.key),
})

function getSupportedLocales(store: unknown): StoreLocaleRow[] {
  if (!isRecord(store) || !Array.isArray(store.supported_locales)) {
    return []
  }

  return store.supported_locales.filter(
    (locale): locale is StoreLocaleRow => {
      if (!isRecord(locale) || typeof locale.locale_code !== "string") {
        return false
      }

      const localeDetails = locale.locale

      return isRecord(localeDetails) && typeof localeDetails.name === "string"
    }
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  )
}
