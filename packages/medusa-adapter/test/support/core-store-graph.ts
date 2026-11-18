import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

const stamp = "2026-10-17T00:00:00.000Z";
export type StoreDeletionInitialRow = Readonly<{ table: string; row: JsonObject }>;

/** Canonical fixture data, not an admitted native Store creation operation. */
export function storeDeletionGraph(prefix: string, count = 1, currencyCount = 1, localeCount = 1,
  history: Readonly<{ currencies?: number; locales?: number; stores?: boolean }> = {}) {
  const stores = Array.from({ length: count }, (_, index) => `${prefix}-store-${index}`);
  const currencies = stores.flatMap(id => Array.from({ length: currencyCount }, (_, index) => `${id}-currency-${index}`));
  const locales = stores.flatMap(id => Array.from({ length: localeCount }, (_, index) => `${id}-locale-${index}`));
  const managed = (deleted: boolean) => ({ created_at: stamp, updated_at: stamp, deleted_at: deleted ? stamp : null });
  const rows: StoreDeletionInitialRow[] = stores.flatMap(id => [
    { table: "store", row: { id, name: id, default_sales_channel_id: "protected-channel",
      default_region_id: "protected-region", default_location_id: "protected-location",
      metadata: { fixture: prefix }, ...managed(history.stores === true) } },
    ...Array.from({ length: currencyCount }, (_, index) => ({ table: "store_currency", row: {
      id: `${id}-currency-${index}`, store_id: id, currency_code: `currency-${index}`,
      is_default: index === 0, ...managed(index < (history.currencies ?? 0)) } })),
    ...Array.from({ length: localeCount }, (_, index) => ({ table: "store_locale", row: {
      id: `${id}-locale-${index}`, store_id: id, locale_code: `locale-${index}`,
      ...managed(index < (history.locales ?? 0)) } })),
  ]);
  return { stores, currencies, locales, rows };
}
