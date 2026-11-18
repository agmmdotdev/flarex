import { MedusaError } from "@medusajs/utils/common/errors"
import { createStep, StepResponse } from "@medusajs/workflows-sdk/durable"
import { normalizeProductsFromCsv, type NormalizedProductBatchRequest } from "../../../product/utils/normalize-products-from-csv.js"

export const PRODUCT_IMPORT_MAX_CSV_BYTES = 256 * 1024
export const PRODUCT_IMPORT_MAX_CSV_RECORDS = 64
export const productImportPlanAdmissionService = "productImportPlanAdmission"

/** The trusted adapter admits the complete native-normalized batch. It cannot
 * replace or remove fields from the payload used by the native composer. */
export interface ProductImportPlanAdmissionPort {
  admit(batchRequest: NormalizedProductBatchRequest): Promise<void>
}

export const normalizeCsvStepId = "normalize-product-csv"

/** Profile admission surrounds the shared native CSV algorithm, before the
 * genuine workflow persists its confirmation wait. */
export const normalizeCsvStep = createStep(
  normalizeCsvStepId,
  async (fileContent: string, { container }) => {
    if (new TextEncoder().encode(fileContent).byteLength > PRODUCT_IMPORT_MAX_CSV_BYTES) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Product import CSV exceeds the admitted byte limit")
    }
    const { batchRequest, parsedRecords } = normalizeProductsFromCsv(fileContent)
    if (parsedRecords > PRODUCT_IMPORT_MAX_CSV_RECORDS) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Product import CSV exceeds the admitted record limit")
    }
    await container.resolve<ProductImportPlanAdmissionPort>(productImportPlanAdmissionService).admit(batchRequest)
    return new StepResponse(batchRequest)
  }
)
