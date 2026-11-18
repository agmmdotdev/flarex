import { describe, expect, it } from "vitest"
import {
  formatForeignKeyConstraintMessage,
  formatUniqueConstraintMessage,
  formatTextUniqueConstraintMessage,
  formatScalarForeignKeyConstraintMessage,
  parseDatabaseConstraintInfo,
} from "../database-constraint"

describe("native database constraint presentation", () => {
  it("retains native table normalization and composite key/value order", () => {
    const info = parseDatabaseConstraintInfo({
      table: "tax_rate_rule",
      detail: "Key ( reference_id, reference )=( first, product ) already exists.",
    })
    expect(info).toEqual({
      table: "tax rate rule",
      keys: ["reference_id", "reference"],
      values: ["first", "product"],
    })
    expect(formatForeignKeyConstraintMessage(info)).toBe(
      "You tried to set relationship reference_id: first,reference: product, but such entity does not exist",
    )
  })

  it.each([undefined, null, "", "no constraint detail", "Key (provider_id) has no value"])(
    "retains the native undefined relationship for unparsed detail %s",
    detail => {
      const info = parseDatabaseConstraintInfo({ table: "tax_region", detail })
      expect(info).toBeNull()
      expect(formatForeignKeyConstraintMessage(info)).toBe(
        "You tried to set relationship undefined, but such entity does not exist",
      )
    },
  )

  it.each([
    ["missing,provider", "missing"],
    ["missing(provider", "provider"],
    ["missing)provider", "missing)provider"],
  ])("retains the original parser's punctuation behavior for %s", (value, parsed) => {
    const info = parseDatabaseConstraintInfo({
      table: "tax_region",
      detail: `Key (provider_id)=(${value}) is not present in table "tax_provider".`,
    })
    expect(formatForeignKeyConstraintMessage(info)).toBe(
      `You tried to set relationship provider_id: ${parsed}, but such entity does not exist`,
    )
  })

  it("keeps raw Boolean values for the unique-constraint caller's own conversion", () => {
    expect(parseDatabaseConstraintInfo({
      table: "tax_rate", detail: "Key (is_default, is_combinable)=(t, f) already exists.",
    })?.values).toEqual(["t", "f"])
  })

  it("retains absent values for mismatched native key/value counts", () => {
    expect(formatForeignKeyConstraintMessage(parseDatabaseConstraintInfo({
      table: "tax_rate", detail: "Key (id, tax_region_id)=(first) is not present.",
    }))).toBe(
      "You tried to set relationship id: first,tax_region_id: undefined, but such entity does not exist",
    )
  })

  it("does not read the native table property when detail cannot be parsed", () => {
    expect(parseDatabaseConstraintInfo({
      detail: "malformed",
      get table(): string { throw new Error("table must remain unread") },
    })).toBeNull()
  })
})

/** Native-detail reference fixtures use the pinned single-column grammar only
 * in tests. Production scalar rendering frames its own value tuple and never
 * manufactures a SQL detail string, driver exception or SQLSTATE. */
describe("bounded scalar foreign-key compatibility presentation", () => {
  it.each([
    ["tp_missing", "tp_missing"],
    ["tp_missing,tail", "tp_missing"],
    ["tp_missing(tail", "tail"],
    ["tp_missing)tail", "tp_missing)tail"],
    ["  tp_missing  ", "tp_missing"],
    ["first(second(tail, ignored", "tail"],
    ["a(b)c(d", "b"],
    ["a(b)c(d)e", "b"],
    ["", ""],
    ["()", ")"],
    ["()(", ""],
    ["a()b(c", ""],
    ["a(b)c)d", "b)c)d"],
    ["a\nb", "a\nb"],
    ["a,\nb", "a"],
    [" \n a(b)c(d \n", "b"],
  ])("retains the pinned scalar presentation for %s", (value, expected) => {
    expect(formatScalarForeignKeyConstraintMessage("provider_id", value)).toBe(
      `You tried to set relationship provider_id: ${expected}, but such entity does not exist`,
    )
    expect(formatScalarForeignKeyConstraintMessage("provider_id", value)).toBe(
      formatForeignKeyConstraintMessage(parseDatabaseConstraintInfo({
        table: "tax_region",
        detail: `Key (provider_id)=(${value}) is not present in table "tax_provider".`,
      })),
    )
  })
})

/** Native PostgreSQL diagnostic grammar is retained in test fixtures only.
 * The semantic production entry receives authenticated text keys/values. */
describe("native text UNIQUE constraint presentation", () => {
  it.each([
    { table: "tax_region", keys: ["id"], values: ["txreg_existing"],
      message: "Tax region with id: txreg_existing, already exists." },
    { table: "tax_region", keys: ["country_code", "province_code"], values: ["us", "ca"],
      message: "Tax region with country_code: us, province_code: ca, already exists." },
    { table: "tax_rate", keys: ["tax_region_id"], values: ["txreg_parent"],
      message: "Tax rate with tax_region_id: txreg_parent, already exists." },
    { table: "tax_rate_rule", keys: ["tax_rate_id", "reference", "reference_id"], values: ["txr_parent", "product", "prod_existing"],
      message: "Tax rate rule with tax_rate_id: txr_parent, reference: product, reference_id: prod_existing, already exists." },
    { table: "tax_region", keys: ["country_code"], values: ["t"],
      message: "Tax region with country_code: true, already exists." },
    { table: "tax_region", keys: ["country_code"], values: ["f"],
      message: "Tax region with country_code: false, already exists." },
    { table: "tax_region", keys: ["country_code"], values: ["T"],
      message: "Tax region with country_code: T, already exists." },
  ])("retains ordered pairs, table spelling and literal t/f conversion for $table", ({ table, keys, values, message }) => {
    expect(formatUniqueConstraintMessage({ table, keys, values })).toBe(message)
    expect(formatTextUniqueConstraintMessage(table, keys, values)).toBe(message)
  })

  it.each([
    { table: "tax_region", columns: ["country_code", "province_code"], values: ["us", "ca"],
      detail: "Key (country_code, province_code)=(us, ca) already exists." },
    { table: "tax_rate_rule", columns: ["tax_rate_id", "reference", "reference_id"], values: ["txr_parent", "product", "prod_existing"],
      detail: "Key (tax_rate_id, reference, reference_id)=(txr_parent, product, prod_existing) already exists." },
    { table: "tax_region", columns: ["country_code"], values: [" t "],
      detail: "Key (country_code)=( t ) already exists." },
    { table: "tax_region", columns: ["country_code", "province_code"], values: ["a,b", "c"],
      detail: "Key (country_code, province_code)=(a,b, c) already exists." },
    { table: "tax_region", columns: ["country_code", "province_code"], values: ["a(b)c(d", "tail"],
      detail: "Key (country_code, province_code)=(a(b)c(d, tail) already exists." },
    { table: "tax_region", columns: ["country_code", "province_code"], values: ["a(b)c(d)e", "tail"],
      detail: "Key (country_code, province_code)=(a(b)c(d)e, tail) already exists." },
    { table: "tax_region", columns: ["country_code", "province_code"], values: ["a)b", "c(d"],
      detail: "Key (country_code, province_code)=(a)b, c(d) already exists." },
    { table: "tax_region", columns: ["country_code", "province_code"], values: ["", ""],
      detail: "Key (country_code, province_code)=(, ) already exists." },
    { table: "tax_region", columns: ["country_code", "province_code"], values: ["()(", "tail"],
      detail: "Key (country_code, province_code)=(()(, tail) already exists." },
    { table: "tax_region", columns: ["country_code", "province_code"], values: ["a\nb", "c"],
      detail: "Key (country_code, province_code)=(a\nb, c) already exists." },
  ])("matches the genuine diagnostic parser for $detail", ({ table, columns, values, detail }) => {
    const info = parseDatabaseConstraintInfo({ table, detail })
    expect(info).not.toBeNull()
    if (info === null) throw new Error("Malformed native UNIQUE diagnostic fixture")
    expect(formatTextUniqueConstraintMessage(table, columns, values)).toBe(formatUniqueConstraintMessage(info))
  })

  it("preserves native undefined rendering for a truncated tuple", () => {
    expect(formatUniqueConstraintMessage({ table: "tax_rate_rule", keys: ["tax_rate_id", "reference"], values: ["txr_parent"] })).toBe(
      "Tax rate rule with tax_rate_id: txr_parent, reference: undefined, already exists.",
    )
  })
})
