import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

export type CustomerInitialRow = Readonly<{ table: string; row: JsonObject }>;
const stamp = "2026-10-22T00:00:00.000Z", managed = { created_at: stamp, updated_at: stamp, deleted_at: null };

export function customerRow(id: string, email: string | null, has_account = false, deleted = false): CustomerInitialRow {
  return { table: "customer", row: { id, company_name: null, first_name: null, last_name: null, email, phone: null,
    has_account, metadata: null, created_by: null, ...managed, ...(deleted ? { deleted_at: stamp } : {}) } };
}

export function customerDescendants(prefix: string, count: number, deleted = false): readonly CustomerInitialRow[] {
  const rows: CustomerInitialRow[] = [customerRow(prefix, prefix + "@example.invalid", false, deleted)];
  for (let index = 0; index < count; index++) {
    const history = index % 2 === 1 ? { deleted_at: stamp } : {};
    rows.push({ table: "customer_group", row: { id: prefix + "-group-" + index, name: prefix + " group " + index,
      metadata: null, created_by: null, ...managed } });
    rows.push({ table: "customer_address", row: { id: prefix + "-address-" + index, customer_id: prefix,
      address_name: null, is_default_shipping: false, is_default_billing: false, company: null, first_name: null, last_name: null,
      address_1: null, address_2: null, city: null, country_code: null, province: null, postal_code: null, phone: null,
      metadata: null, ...managed, ...history } });
    rows.push({ table: "customer_group_customer", row: { id: prefix + "-membership-" + index, customer_id: prefix,
      customer_group_id: prefix + "-group-" + index, created_by: null, metadata: null, ...managed, ...history } });
  }
  return rows;
}

export const customerSelectionInitial: readonly CustomerInitialRow[] = [
  customerRow("cus-account", "account@example.invalid", true), customerRow("cus-guest", "guest@example.invalid"),
  customerRow("cus-target", "target@example.invalid"), customerRow("cus-deleted", "deleted@example.invalid", false, true),
  customerRow("cus-z-mixed-account", "mixed@example.invalid", true), customerRow("cus-a-mixed-guest", "mixed@example.invalid"),
  customerRow("cus-z-guest-last", "account-first@example.invalid"), customerRow("cus-a-account-first", "account-first@example.invalid", true),
  customerRow("cus-null-email", null),
];
