import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CheckoutCase } from "./core-checkout-fixture";

/** Existing persisted Cart/Variant/stock data. Native checkout, graph reads and
 * Inventory service perform every selection, validation and reservation. */
export function checkoutInventoryData() {
  const cases: CheckoutCase[] = [];
  const product: JsonObject[] = [], inventory: JsonObject[] = [], variantLinks: JsonObject[] = [],
    locations: JsonObject[] = [], channelLinks: JsonObject[] = [];
  const add = (name: string, options: { readonly quantity?: number; readonly required?: number; readonly stock?: string;
    readonly reserved?: string; readonly allowBackorder?: boolean; readonly unmanaged?: boolean;
    readonly wrongChannel?: boolean; readonly secondStock?: string; readonly components?: number } = {}) => {
    const variantId = "variant-" + name, inventoryId = "iitem-" + name, locationId = "sloc-" + name;
    cases.push({ name, variantId, salesChannelId: "sc-checkout", quantity: options.quantity ?? 1,
      unitPrice: "12.5", amount: String((options.quantity ?? 1) * 12.5) });
    product.push({ table: "product", row: { id: "prod-" + name, title: "Checkout Product " + name, handle: name, status: "published" } },
      { table: "product_variant", row: { id: variantId, product_id: "prod-" + name, title: "Checkout Variant " + name,
        sku: name, manage_inventory: !options.unmanaged, allow_backorder: options.allowBackorder ?? false } });
    if (options.unmanaged) return { variantId, inventoryId, locationId };
    for (let component = 0; component < (options.components ?? 1); component++) {
      const id = inventoryId + (component === 0 ? "" : "-" + component);
      inventory.push({ table: "inventory_item", row: { id, sku: id, requires_shipping: false } });
      variantLinks.push({ table: "product_variant_inventory_item", row: { id: "pvitem-" + name + "-" + component,
        variant_id: variantId, inventory_item_id: id, required_quantity: options.required ?? 1 } });
      for (const [suffix, stock] of [["", options.stock ?? "5"], ...options.secondStock === undefined ? [] : [["-second", options.secondStock]]] as const) {
        const stocked = stock ?? "5", reserved = options.reserved ?? "0";
        inventory.push({ table: "inventory_level", row: { id: "ilev-" + name + "-" + component + suffix,
          inventory_item_id: id, location_id: locationId + suffix, stocked_quantity: stocked,
          raw_stocked_quantity: { value: stocked, precision: 20 }, reserved_quantity: reserved,
          raw_reserved_quantity: { value: reserved, precision: 20 } } });
      }
    }
    for (const suffix of ["", ...options.secondStock === undefined ? [] : ["-second"]]) {
      locations.push({ table: "stock_location", row: { id: locationId + suffix, name: "Checkout Location " + name + suffix } });
      channelLinks.push({ id: "scloc-" + name + suffix, sales_channel_id: options.wrongChannel ? "sc-other" : "sc-checkout",
        stock_location_id: locationId + suffix });
    }
    return { variantId, inventoryId, locationId };
  };
  add("variant-available", { required: 2, quantity: 1.25, stock: "1", reserved: "0.25", secondStock: "9" });
  add("variant-insufficient", { quantity: 2, stock: "1" });
  add("variant-backorder", { quantity: 2, stock: "0", allowBackorder: true });
  add("variant-unmanaged", { unmanaged: true });
  add("variant-channel", { wrongChannel: true });
  add("variant-late", { quantity: 2 });
  add("variant-concurrent", { quantity: 2 });
  const competing = add("variant-competing-a", { quantity: 2, stock: "3" });
  cases.push({ name: "variant-competing-b", variantId: competing.variantId, salesChannelId: "sc-checkout", quantity: 2, unitPrice: "12.5", amount: "25" });
  add("variant-inverse", { required: 3 });
  const overflow = add("variant-overflow", { components: 2 });
  const overflowIndex = cases.findIndex(value => value.name === "variant-overflow");
  cases.splice(overflowIndex, 1, { name: "variant-overflow", salesChannelId: "sc-checkout", amount: "37.5",
    items: [0, 1, 2].map(() => ({ variantId: overflow.variantId, quantity: 1, unitPrice: "12.5" })) });
  const shared = add("variant-shared-stock", { stock: "3" });
  const sharedCase = cases.find(value => value.name === "variant-shared-stock");
  if (sharedCase === undefined) throw new Error("Missing shared-stock checkout case");
  cases.splice(cases.indexOf(sharedCase), 1, { ...sharedCase, amount: "50", items: [
    { variantId: shared.variantId, quantity: 2, unitPrice: "12.5" },
    { variantId: shared.variantId, quantity: 2, unitPrice: "12.5" },
  ] });
  const four = [0, 1, 2, 3].map(index => add("variant-four-" + index));
  // These four Variants belong to one Cart case; their standalone Cart seeds
  // are unused and would only add setup work.
  cases.splice(cases.length - four.length, four.length);
  cases.push({ name: "variant-four", salesChannelId: "sc-checkout", amount: "50",
    items: four.map(row => ({ variantId: row.variantId, quantity: 1, unitPrice: "12.5" })) });
  return { cases, seeds: {
    product: [...product.filter(row => row.table === "product"), ...product.filter(row => row.table === "product_variant")],
    inventory: [...inventory.filter(row => row.table === "inventory_item"), ...inventory.filter(row => row.table === "inventory_level")],
    variant_links: variantLinks, stock_location: locations,
    sales_channel: [{ id: "sc-checkout", name: "Checkout Channel" },
      { id: "sc-other", name: "Other Channel" }],
    sales_channel_locations: channelLinks } satisfies Readonly<Record<string, readonly JsonObject[]>> };
}
