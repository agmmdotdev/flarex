import "./types"
import { Module } from "@medusajs/framework/utils"
import loadDefaults from "./loaders/defaults"
import TranslationModuleService from "./services/translation-module"

export const TRANSLATION_MODULE = "translation"

export default Module(TRANSLATION_MODULE, {
  service: TranslationModuleService,
  loaders: [loadDefaults],
})
