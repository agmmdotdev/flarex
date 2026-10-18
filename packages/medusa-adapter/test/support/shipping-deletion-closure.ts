import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

type Seed = Readonly<{ table: string; row: JsonObject }>;
const stamp = "2026-10-18T00:00:00.000Z";

/** Canonical installed data, not a substitute for native cascade planning.
 * Eight Options select eight Links and the complete 72-row Pricing forest. */
export function shippingDeletionClosure(prefix: string, optionIds: readonly string[], locationIds: readonly string[], historical = false) {
  const managed = (deleted = false) => ({ created_at: stamp, updated_at: stamp, deleted_at: deleted ? stamp : null });
  const providers = [0, 1].map(index => prefix + "-provider-" + index);
  const providerRows: Seed[] = providers.map(id => ({ table: "fulfillment_provider", row: { id, is_enabled: true, ...managed() } }));
  const providerLinks: Seed[] = locationIds.flatMap(location => providers.map(provider => ({ table: "location_fulfillment_provider", row: {
    id: location + "-" + provider, stock_location_id: location, fulfillment_provider_id: provider,
    ...managed(historical && provider === providers[0]),
  } }))).slice(0, 8);
  const pricingRows: Seed[] = [], priceSetLinks: Seed[] = [], priceSetIds: string[] = [], priceIds: string[] = [], ruleIds: string[] = [];
  for (const [index, option] of optionIds.entries()) {
    const id = prefix + "-price-set-" + index, deleted = historical && index % 2 === 0;
    priceSetIds.push(id);
    pricingRows.push({ table: "price_set", row: { id, ...managed(deleted) } });
    priceSetLinks.push({ table: "shipping_option_price_set", row: { id: prefix + "-sops-" + index,
      shipping_option_id: option, price_set_id: id, ...managed(deleted) } });
    for (const currency of ["usd", "eur"]) {
      const price = id + "-" + currency; priceIds.push(price);
      pricingRows.push({ table: "price", row: { id: price, title: null, currency_code: currency, amount: "10.000000000000000000",
        raw_amount: { value: "10.000000000000000000", precision: 20 }, min_quantity: null, raw_min_quantity: null,
        max_quantity: null, raw_max_quantity: null, rules_count: 3, price_set_id: id, price_list_id: null, ...managed(deleted) } });
      for (const [ordinal, operator] of ["eq", "gte", "lt"].entries()) {
        const rule = price + "-rule-" + ordinal; ruleIds.push(rule);
        pricingRows.push({ table: "price_rule", row: { id: rule, attribute: "cart_total", operator, value: String(100 + ordinal),
          priority: ordinal, price_id: price, ...managed(deleted) } });
      }
    }
  }
  const orderedPricing = ["price_set", "price", "price_rule"].flatMap(table => pricingRows.filter(row => row.table === table));
  return { providerRows, providerLinks, priceSetLinks, pricingRows: orderedPricing, providers, priceSetIds, priceIds, ruleIds,
    allIds: [...priceSetIds, ...priceIds, ...ruleIds,
      ...[...providerLinks, ...priceSetLinks].flatMap(row => typeof row.row.id === "string" ? [row.row.id] : [])],
  };
}
