import { StepResponse, createStep } from "@medusajs/workflows-sdk"
import { normalizeProductsFromCsv } from "../utils/normalize-products-from-csv.js"

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
  async (fileContent: NormalizeProductCsvStepInput) => new StepResponse(normalizeProductsFromCsv(fileContent).batchRequest)
)
