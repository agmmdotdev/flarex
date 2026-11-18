import { describe, expect, it } from "vitest"
import { formatRequiredPropertyMessage } from "../required-validation"

describe("native required-property first-line presentation", () => {
  it.each([
    { value: undefined, text: "undefined" },
    { value: null, text: "null" },
  ])("retains the native nullish diagnostic for $text", ({ value, text }) => {
    expect(formatRequiredPropertyMessage("TaxRate", "code", value)).toBe(
      `Value for TaxRate.code is required, '${text}' found`,
    )
  })
  it("retains the model and property spelling without an entity dump", () => {
    expect(formatRequiredPropertyMessage("TaxRegion", "country_code", undefined)).toBe(
      "Value for TaxRegion.country_code is required, 'undefined' found",
    )
  })
})
