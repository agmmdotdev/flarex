import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

const stamp = "2026-01-01T00:00:00.000Z";
export type DeletionScenario = "maximum" | "history" | "mixed-history" | "collision" | "same-model-id";

export function priceListCreationComparisonRows(linkTable: string) {
  const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
  const setIds = Array.from({ length: 4 }, (_, index) => "plist152-set-" + index);
  const variantIds = Array.from({ length: 4 }, (_, index) => "plist152-variant-" + index);
  const protectedIds = [...setIds, "plist152-protected-preference", "plist152-protected-base"];
  const seedRows: Array<{ table: string; row: JsonObject }> = [
    ...setIds.map((id, index) => ({ table: "price_set", row: { id, ...managed, deleted_at: index === 3 ? stamp : null } })),
    { table: "price_preference", row: { id: "plist152-protected-preference", attribute: "currency_code", value: "protected152", is_tax_inclusive: true, ...managed } },
    { table: "price", row: { id: "plist152-protected-base", title: null, currency_code: "USD", amount: "123.00000000000000000",
      raw_amount: { value: "123.00000000000000000", precision: 20 }, min_quantity: null, raw_min_quantity: null,
      max_quantity: null, raw_max_quantity: null, rules_count: 0, price_set_id: setIds[0]!, price_list_id: null, ...managed } },
  ];
  const historicalRootId = "plist152-comparison-history", historicalIds = [historicalRootId];
  seedRows.push({ table: "price_list", row: { id: historicalRootId, title: "historical comparison152", description: "stored history",
    status: "draft", type: "sale", starts_at: null, ends_at: null, rules_count: 3, ...managed, deleted_at: stamp } });
  for (const index of [0, 1, 2]) {
    const listRuleId = "plrule152-comparison-history-" + index;
    historicalIds.push(listRuleId);
    seedRows.push({ table: "price_list_rule", row: { id: listRuleId, price_list_id: historicalRootId,
      attribute: "comparison-" + index, value: ["history", String(index)], ...managed, deleted_at: index === 1 ? null : stamp } });
    const priceId = "price152-comparison-" + index;
    historicalIds.push(priceId);
    seedRows.push({ table: "price", row: { id: priceId, title: null, currency_code: "USD", amount: "1.0000000000000000000",
      raw_amount: { value: "1.0000000000000000000", precision: 20 }, min_quantity: null, raw_min_quantity: null,
      max_quantity: null, raw_max_quantity: null, rules_count: 3, price_set_id: setIds[0]!, price_list_id: historicalRootId,
      ...managed, deleted_at: index === 1 ? stamp : null } });
    for (const priority of [0, 1, 2]) {
      const ruleId = "prule152-comparison-" + index + "-" + priority;
      historicalIds.push(ruleId);
      seedRows.push({ table: "price_rule", row: { id: ruleId, price_id: priceId, attribute: "comparison-" + priority,
        value: String(index), operator: "eq", priority, ...managed, deleted_at: priority === 1 ? stamp : null } });
    }
  }
  const insertionRootIds = ["plist152-z-storage-order", "plist152-a-storage-order"];
  for (const id of insertionRootIds) seedRows.push({ table: "price_list", row: { id, title: id, description: "stored order comparison",
    status: "draft", type: "sale", starts_at: null, ends_at: null, rules_count: 0, ...managed, deleted_at: stamp } });
  const linkRows: Array<{ table: string; row: JsonObject }> = variantIds.map((variant_id, index) => ({ table: linkTable, row: {
    id: "plist152-link-" + index, variant_id, price_set_id: setIds[index]!, ...managed,
  } }));
  linkRows.push({ table: linkTable, row: { id: "plist152-link-history", variant_id: "plist152-variant-history", price_set_id: setIds[0]!, ...managed, deleted_at: stamp } });
  return { setIds, variantIds, protectedIds, seedRows, linkRows, historicalRootId, historicalIds, insertionRootIds };
}

export function priceListUpdateComparisonRows() {
  const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
  const targetIds = ["plist153-a", "plist153-b", "plist153-c", "plist153-d"];
  const protectedRootId = "plist153-protected", deletionRootId = "plist153-delete", historicalRootId = "plist153-history", historyOwnerId = "plist153-active-history";
  const activeIds = [...targetIds, protectedRootId, deletionRootId, historyOwnerId];
  const seedRows: Array<{ table: string; row: JsonObject }> = [];
  const protectedIds: string[] = [protectedRootId, "prpref153-protected"];
  const selectedPricingIds: string[] = [];
  for (const [index, id] of activeIds.entries()) {
    const setId = "pset153-" + index, baseId = "price153-base-" + index;
    seedRows.push({ table: "price_list", row: { id, title: "Original title153-" + index, description: "Original description153-" + index,
        status: index % 2 ? "draft" : "active", type: "sale", starts_at: "2025-01-01T00:00:00.000Z",
        ends_at: "2030-01-01T00:00:00.000Z", rules_count: 2, ...managed } });
    const price = (priceId: string, listId: string | null, amount: string, rules: number): JsonObject => ({
      id: priceId, title: null, currency_code: "USD", amount, raw_amount: { value: amount, precision: 20 },
      min_quantity: null, raw_min_quantity: null, max_quantity: null, raw_max_quantity: null,
      rules_count: rules, price_set_id: setId, price_list_id: listId, ...managed,
    });
    // The protected graph covers all six tables; one updated root also has
    // attached Prices/Rules, proving native List updates preserve that graph.
    if (id === protectedRootId || id === targetIds[0]) {
      (id === protectedRootId ? protectedIds : selectedPricingIds).push(setId, baseId);
      seedRows.push({ table: "price_set", row: { id: setId, ...managed } },
        { table: "price", row: price(baseId, null, "100.00000000000000000", 0) });
    }
    for (const number of [0, 1]) {
      const listRuleId = "plrule153-" + index + "-" + number, priceId = "price153-" + index + "-" + number;
      seedRows.push({ table: "price_list_rule", row: { id: listRuleId, price_list_id: id,
        attribute: number ? "sales_channel_id" : "region_id", value: number ? ["web153", "app153"] : ["reg153-" + index], ...managed } });
      if (id === protectedRootId || id === targetIds[0] && number === 0) {
        seedRows.push({ table: "price", row: price(priceId, id, "40.000000000000000000", 2) });
        if (id === protectedRootId) protectedIds.push(listRuleId, priceId);
        else selectedPricingIds.push(priceId);
        for (const priority of [0, 1]) {
          const ruleId = "prule153-" + index + "-" + number + "-" + priority;
          seedRows.push({ table: "price_rule", row: { id: ruleId, price_id: priceId, attribute: priority ? "customer_group_id" : "region_id",
            value: "value153", operator: "eq", priority, ...managed } });
          (id === protectedRootId ? protectedIds : selectedPricingIds).push(ruleId);
        }
      }
    }
  }
  seedRows.push({ table: "price_preference", row: { id: "prpref153-protected", attribute: "protected153", value: "never-touch", is_tax_inclusive: true, ...managed } },
    { table: "price_list", row: { id: historicalRootId, title: "Historical153", description: "Canonical history", status: "draft", type: "sale",
      starts_at: null, ends_at: null, rules_count: 3, ...managed, deleted_at: stamp } });
  for (const index of [0, 1, 2]) seedRows.push({ table: "price_list_rule", row: { id: "plrule153-history-" + index,
    price_list_id: historicalRootId, attribute: "history153-" + index, value: ["history153"], ...managed, deleted_at: index === 1 ? null : stamp } });
  seedRows.push({ table: "price_list_rule", row: { id: "plrule153-active-root-history", price_list_id: historyOwnerId,
    attribute: "historical153", value: ["keep-history153"], ...managed, deleted_at: stamp } });
  return { targetIds, protectedIds, selectedPricingIds, protectedRootId, deletionRootId, historicalRootId, historyOwnerId, seedRows, stamp };
}

export function priceListDeletionComparisonRows(scenario: DeletionScenario = "maximum") {
  const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
  const targetIds = (scenario === "maximum" ? ["plist154-a", "plist154-b", "plist154-c", "plist154-d"] : ["plist154-a"]);
  const protectedRootId = "plist154-protected", setId = "pset154-shared";
  const seedRows: Array<{ table: string; row: JsonObject }> = [];
  const root = (id: string): JsonObject => ({ id, title: "Original154 " + id, description: "Original154", status: "draft", type: "sale",
    starts_at: null, ends_at: null, rules_count: id === protectedRootId ? 1 : (scenario === "history" || scenario === "mixed-history") ? 3 : 2, ...managed });
  const price = (id: string, listId: string | null, rules = 2): JsonObject => ({ id, title: null, currency_code: "USD", amount: "25.000000000000000000",
    raw_amount: { value: "25.000000000000000000", precision: 20 }, min_quantity: null, raw_min_quantity: null,
    max_quantity: null, raw_max_quantity: null, rules_count: rules, price_set_id: setId, price_list_id: listId, ...managed });
  seedRows.push({ table: "price_set", row: { id: setId, ...managed } }, { table: "price", row: price("price154-base", null, 0) });
  for (const id of [...targetIds, protectedRootId]) {
    const extra = (scenario === "history" || scenario === "mixed-history") && id === targetIds[0];
    const historicalRoot = scenario === "history" && id === targetIds[0];
    seedRows.push({ table: "price_list", row: { ...root(id), ...(historicalRoot ? { deleted_at: stamp } : {}) } });
    for (let index = 0; index < (id === protectedRootId ? 1 : extra ? 3 : 2); index++) {
      const listRuleId = scenario === "same-model-id" && id === targetIds[0] && index === 0 ? "same-id154" : "plrule154-" + id + "-" + index;
      const priceId = "price154-" + id + "-" + index;
      seedRows.push({ table: "price_list_rule", row: { id: listRuleId, price_list_id: id, attribute: "list154-" + index, value: ["value154"], ...managed,
        ...((extra && index !== 1 || scenario === "same-model-id" && id === targetIds[0] && index === 0) ? { deleted_at: stamp } : {}) } },
      { table: "price", row: { ...price(priceId, id, extra && index === 0 ? 3 : id === protectedRootId ? 1 : 2), ...(extra && index === 0 ? { deleted_at: stamp } : {}) } });
      for (let priority = 0; priority < (extra && index === 0 ? 3 : id === protectedRootId ? 1 : 2); priority++) {
        const ruleId = scenario === "same-model-id" && id === targetIds[0] && index === 0 && priority === 0 ? "same-id154" : "prule154-" + id + "-" + index + "-" + priority;
        seedRows.push({ table: "price_rule", row: { id: ruleId, price_id: priceId, attribute: "rule154-" + priority, value: "value154", operator: "eq", priority,
          ...managed, ...((extra && priority !== 1 || scenario === "collision" && id === targetIds[0] && index === 0 && priority === 0) ? { deleted_at: stamp } : {}) } });
      }
    }
  }
  if (scenario === "collision") seedRows.push({ table: "price_rule", row: { id: "prule154-active-twin", price_id: "price154-plist154-a-0",
    attribute: "rule154-0", value: "value154", operator: "eq", priority: 0, ...managed } });
  seedRows.push({ table: "price_preference", row: { id: "prpref154-protected", attribute: "protected154", value: "never-touch", is_tax_inclusive: true, ...managed } });
  const protectedIds = seedRows.filter(entry => entry.table === "price_set" || entry.table === "price_preference" || entry.row.id === "price154-base" ||
    entry.row.id === protectedRootId || entry.row.price_list_id === protectedRootId || String(entry.row.price_id).includes(protectedRootId)).map(entry => String(entry.row.id));
  // Reuse the initializer's adjacent-table batch owner. Stable grouping keeps
  // every canonical row and each family's source order while respecting FKs.
  const initializationTableOrder = ["price_set", "price_list", "price_list_rule", "price", "price_rule", "price_preference"];
  const groupedRows = initializationTableOrder.flatMap(table => seedRows.filter(entry => entry.table === table));
  if (groupedRows.length !== seedRows.length) throw new Error("Unknown canonical initialization table");
  return { targetIds, protectedIds, protectedRootId, seedRows: groupedRows, sourceRows: seedRows, initializationTableOrder, stamp, scenario };
}
