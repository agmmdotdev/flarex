import type { z } from "@medusajs/deps/zod"
import { CSVNormalizer } from "@medusajs/utils/product/csv-normalizer"
import * as productValidators from "@medusajs/utils/product/validators"
import { convertCsvToJson } from "./csvtojson.js"


/** Shared pinned CSV algorithm; profiles consume the parsed row count without reparsing. */
export function normalizeProductsFromCsv(fileContent: string) {
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

  return { batchRequest: { create, update }, parsedRecords: csvProducts.length }
}

export type NormalizedProductBatchRequest = ReturnType<typeof normalizeProductsFromCsv>["batchRequest"]
