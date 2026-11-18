import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ItemTaxLinesInput } from "../../src/workflows/tax/item-tax-lines";

export type TaxInitialRow = Readonly<{ table: string; row: JsonObject }>;
const stamp = "2026-10-22T00:00:00.000Z", managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
export const taxCountry = "txreg163-us", taxProvince = "txreg163-ca";
export const taxItem = { id: "li163-one", product_id: "prod163-one", product_type_id: "ptyp163-one", quantity: 2, unit_price: 13.25 };
export const taxShipping = { id: "sm163-one", shipping_option_id: "so163-one", amount: 7.5, name: "Native163 shipping" };
export const taxCart = { id: "cart163-input", currency_code: "usd", locale: "en-US", region: { automatic_taxes: true },
  shipping_address: { country_code: "us", province: "ca", address_1: "Native163", postal_code: "90001", metadata: { source: "cart" } },
  customer: { id: "cus163-supplied", email: "native163@example.invalid", groups: [{ id: "cg163-one" }], metadata: { supplied: true } },
  shipping_methods: [taxShipping] };
export function taxInput(overrides: Partial<typeof ItemTaxLinesInput.Type> = {}): typeof ItemTaxLinesInput.Type {
  return { orderOrCart: structuredClone(taxCart), items: [structuredClone(taxItem)], shipping_methods: [structuredClone(taxShipping)], ...overrides };
}
export function taxRegion(id = taxCountry, extra: JsonObject = {}): TaxInitialRow {
  return { table: "tax_region", row: { id, country_code: "us", province_code: null, parent_id: null, provider_id: "tp_system",
    metadata: null, created_by: null, ...managed, ...extra } };
}
export function taxRate(id = "txr163-country", extra: JsonObject = {}): TaxInitialRow {
  return { table: "tax_rate", row: { id, tax_region_id: taxCountry, rate: 10, code: "N163_COUNTRY", name: "Native163 country",
    is_default: true, is_combinable: false, metadata: null, created_by: null, ...managed, ...extra } };
}
export function taxRule(id: string, rate: string, reference: string, reference_id: string, extra: JsonObject = {}): TaxInitialRow {
  return { table: "tax_rate_rule", row: { id, tax_rate_id: rate, reference, reference_id, metadata: null, created_by: null, ...managed, ...extra } };
}
export function taxSeed(rates: readonly TaxInitialRow[] = [taxRate()], regions: readonly TaxInitialRow[] = [taxRegion()],
  rules: readonly TaxInitialRow[] = []): readonly TaxInitialRow[] {
  return [{ table: "tax_provider", row: { id: "tp_system", is_enabled: true, ...managed } }, ...regions, ...rates, ...rules];
}

/** The original native supplement's complete graph, without persistence assembly. */
export function fullTaxGraph(layout: "mixed" | "items" | "shipping" = "mixed") {
  const kinds = ["default", "product", "type", "shipping"], rows: TaxInitialRow[] = [], rules: TaxInitialRow[] = [];
  for (const region of [0, 1]) {
    for (const [kind, name] of kinds.entries()) {
      const id = `txr163s-${region}-${kind}-${name}`;
      rows.push(taxRate(id, { tax_region_id: region === 0 ? taxCountry : taxProvince, rate: 1 + region * 10 + kind,
        code: `N163S_${region}_${name}`, name: `Native163s ${region} ${name}`, is_default: kind === 0, is_combinable: region === 1 }));
      for (const index of [0, 1]) {
        const reference = kind === 0 ? index === 0 ? "product" : "shipping_option"
          : layout === "items" ? "product" : layout === "shipping" ? "shipping_option"
          : kind === 1 ? "product" : kind === 2 ? "product_type" : "shipping_option";
        const referenceId = kind === 0 ? index === 0 ? "prod163s-unmatched" : "so163s-unmatched"
          : reference === "product" ? `prod163s-${index}` : reference === "product_type" ? `ptyp163s-${index}` : `so163s-${index}`;
        rules.push(taxRule(`txrule163s-${region}-${kind}-${index}`, id, reference, referenceId));
      }
    }
  }
  const shipping = Array.from({ length: 4 }, (_, index) => ({ id: `sm163s-${index}`,
    shipping_option_id: `so163s-${layout === "shipping" ? index % 2 : index}`, name: `Native163s shipping ${index}`, amount: index + 5.5 }));
  const input = taxInput({ orderOrCart: { ...structuredClone(taxCart), shipping_address: { ...taxCart.shipping_address, country_code: "US", province: "CA" },
    shipping_methods: shipping }, items: Array.from({ length: 4 }, (_, index) => ({ id: `li163s-${index}`,
      product_id: `prod163s-${layout === "items" ? index % 2 : index}`, product_type_id: `ptyp163s-${index % 2}`,
      quantity: index + 1, unit_price: index + 10.25 })), shipping_methods: shipping });
  return { input, rows: taxSeed(rows, [taxRegion(), taxRegion(taxProvince, { province_code: "ca", parent_id: taxCountry, provider_id: null })], rules) };
}
