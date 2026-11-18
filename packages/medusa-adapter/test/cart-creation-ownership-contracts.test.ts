import { describe, expect, it, vi } from "vitest";
import { prepareCartCreationAddresses, cartCreationSnapshot, decodeCartCreationSnapshot,
  decodeCartCreationRecord, decodeCartCreationHandle, decodeCartCreationClaims, decodeCartCreationAddressClaims } from "@medusajs/cart/creation";

describe("native Cart creation ownership contracts", () => {
  it("authenticates canonical target primary keys rather than active-only unique indexes", () => {
    expect(decodeCartCreationClaims([{ id: "cart", operation_id: "operation", cart_id: "cart" }])).toHaveLength(1);
    expect(decodeCartCreationAddressClaims([{ id: "address", operation_id: "operation", address_id: "address" }])).toHaveLength(1);
    expect(() => decodeCartCreationClaims([{ id: "unrelated", operation_id: "operation", cart_id: "cart" }])).toThrow("stored Cart creation ownership");
    expect(() => decodeCartCreationAddressClaims([{ id: "unrelated", operation_id: "operation", address_id: "address" }])).toThrow("stored Cart creation ownership");
  });
  it("claims only fresh inline Addresses and preserves existing string references", () => {
    const data = [{ currency_code: "usd", shipping_address: { country_code: "us" }, billing_address: "existing-address" }];
    const plans = prepareCartCreationAddresses(data);
    expect(plans).toEqual([{ shipping: true, billing: false }]);
    expect(cartCreationSnapshot([{ id: "cart-created", shipping_address_id: "address-new", billing_address_id: "existing-address" }], plans)).toEqual({
      carts: [{ id: "cart-created", shipping_address_id: "address-new", billing_address_id: "existing-address" }], addresses: ["address-new"],
    });
    expect(data[0]?.billing_address).toBe("existing-address");
  });

  it("refuses ambiguous inline identities and accessors before native creation", () => {
    const getter = vi.fn(() => "us");
    const withId = { currency_code: "usd", shipping_address: { id: "existing", country_code: "us" } };
    const mixed = { currency_code: "usd", shipping_address: { country_code: "us" }, shipping_address_id: "existing" };
    const accessor = { currency_code: "usd", shipping_address: Object.defineProperty({ country_code: "us" }, "country_code", { get: getter }) };
    for (const row of [withId, mixed, accessor]) expect(() => prepareCartCreationAddresses([row])).toThrow("fresh plain inline Address");
    expect(getter).not.toHaveBeenCalled();
  });

  it("extracts actual FK scalars without running unrelated serializers or inventing nulls", () => {
    const serializer = vi.fn(() => { throw new Error("Unrelated serializer"); });
    const plans = prepareCartCreationAddresses([{ currency_code: "usd" }]);
    expect(cartCreationSnapshot([{ id: "cart", shipping_address_id: null, billing_address_id: null,
      metadata: { toJSON: serializer } }], plans)).toEqual({ carts: [{ id: "cart", shipping_address_id: null, billing_address_id: null }], addresses: [] });
    expect(serializer).not.toHaveBeenCalled();
    expect(() => cartCreationSnapshot([{ id: "cart", shipping_address_id: null }], plans)).toThrow("stored Cart creation ownership");
    expect(() => cartCreationSnapshot([], plans)).toThrow("result cardinality");
  });

  it("requires original Cart membership and unique identity in snapshots and durable records", () => {
    const cart = { id: "cart", shipping_address_id: "address", billing_address_id: null };
    expect(decodeCartCreationSnapshot({ carts: [cart], addresses: ["address"] })).toEqual({ carts: [cart], addresses: ["address"] });
    for (const snapshot of [{ carts: [cart, cart], addresses: ["address"] }, { carts: [cart], addresses: ["address", "address"] },
      { carts: [cart], addresses: ["outside"] }]) expect(() => decodeCartCreationSnapshot(snapshot)).toThrow("ownership input");
    for (const record of [{ id: "operation", carts: [], addresses: [], state: "applied" },
      { id: "operation", carts: [cart], addresses: ["outside"], state: "applied" },
      { id: "operation", carts: [cart], addresses: ["address"], state: "unknown" }])
      expect(() => decodeCartCreationRecord(record)).toThrow("stored Cart creation ownership");
    expect(() => decodeCartCreationHandle({ operation_id: "operation", cart_id: "unissued" })).toThrow("ownership input");
  });
});
