import { z } from "@medusajs/deps/zod"
export { nativePricingContextResult as pricingContextResult } from "@medusajs/workflows-sdk"
export const shippingOptionsContextResult = z.record(z.string(), z.any()).optional()
