/** The complete native creation graph shared by conformance and measurements. */
export const productCreationInput = (prefix: string, count = 4) => ({ additional_data: { external_reference: prefix },
  products: Array.from({ length: count }, (_, index) => ({ id: prefix + "-product-" + index, title: prefix + " " + index,
    handle: prefix + "-handle-" + index, status: "published", description: "Native root description", metadata: { index },
    type_id: "root-type", collection_id: "root-collection", discountable: false,
    tag_ids: Array.from({ length: 4 }, (_, i) => "root-tag-" + i), category_ids: Array.from({ length: 4 }, (_, i) => "root-category-" + i),
    images: [{ url: "https://example.test/first.png" }, { url: "https://example.test/second.png" }],
    options: [{ title: "Size", values: ["0", "1", "2", "3"] }],
    sales_channels: [{ id: "root-channel-0" }, { id: "root-channel-1" }], shipping_profile_id: "root-profile-0",
    variants: [{ id: prefix + "-variant-" + index, title: prefix + " variant " + index, sku: prefix + "-sku-" + index,
      options: { Size: "0" }, prices: [{ currency_code: "USD", amount: "123.4567890123456789", rules: { region_id: "r1" } },
        { currency_code: "EUR", amount: 200, rules: { region_id: "r2" } }] }],
  })) });
