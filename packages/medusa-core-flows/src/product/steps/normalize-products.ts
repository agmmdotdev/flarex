import type { z } from "@medusajs/deps/zod"
import { CSVNormalizer } from "@medusajs/utils/product/csv-normalizer"
import * as productValidators from "@medusajs/utils/product/validators"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"
import { convertCsvToJson } from "../utils/csvtojson"

/**
 * The CSV file content to parse.
 */
export type NormalizeProductCsvStepInput = string

export const normalizeCsvStepId = "normalize-product-csv"
/**
 * This step parses a CSV file holding products to import, returning the products as
 * objects that can be imported.
 *
 * @example
 * const data = parseProductCsvStep("products.csv")
 */
export const normalizeCsvStep = createStep(
  normalizeCsvStepId,
  async (fileContent: NormalizeProductCsvStepInput) => {
    const csvProducts =
      convertCsvToJson<Record<string, number | string | boolean>>(fileContent)
    const normalizer = new CSVNormalizer(
      csvProducts.map((row, index) => CSVNormalizer.preProcess(row, index + 1))
    )
    const products = normalizer.proccess()

    const create = Object.keys(products.toCreate).reduce<
      z.infer<typeof productValidators.CreateProduct>[]
    >((result, toCreateHandle) => {
      result.push(
        productValidators.CreateProduct.parse(
          products.toCreate[toCreateHandle]
        )
      )
      return result
    }, [])

    const update = Object.keys(products.toUpdate).reduce<
      z.infer<typeof productValidators.UpdateProduct>[]
    >((result, toUpdateId) => {
      result.push(
        productValidators.UpdateProduct.parse(products.toUpdate[toUpdateId])
      )
      return result
    }, [])

    return new StepResponse({
      create,
      update,
    })
  }
)
