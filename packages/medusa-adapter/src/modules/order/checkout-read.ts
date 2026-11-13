import { Result } from "effect";
import { cartTotalOutputFields, lineItemTotalsFields, shippingMethodTotalsFields } from "@medusajs/cart/utils/totals-selection";
import { orderTotalsFields } from "@medusajs/order/utils/totals-selection";
import type { GraphRelationPath } from "../../local-graph/model";
import { relationPaths } from "../../local-graph/module";
import type { ReadCatalog, ReadTable } from "../../query/catalog";

/** Order's native formatter flattens the versioned physical wrappers before
 * returning its public models. These are public read projections, never DML
 * tables or extra query capabilities. Its native read receipt owns the shape. */
export function prepareOrderCheckoutRead(catalog: ReadCatalog) {
  return Result.gen(function* () {
    const order = yield* catalog.table("order"), line = yield* catalog.table("order_line_item"),
      item = yield* catalog.table("order_item"), method = yield* catalog.table("order_shipping_method");
    const totals = (table: ReadTable, names: readonly string[]) => {
      const selected = [...new Set(names)].filter(name => !table.columns.includes(name));
      return { columns: selected.flatMap(name => [name, "raw_" + name]),
        companions: Object.fromEntries(selected.map(name => [name, "raw_" + name])) };
    };
    // Both native modules use the same decorateCartTotals owner. Selection
    // triggers stay Order's distinct includeOrderTotals policy.
    const orderTotals = totals(order, [...orderTotalsFields(), ...cartTotalOutputFields()]);
    const lineTotals = totals(line, lineItemTotalsFields()), methodTotals = totals(method, shippingMethodTotalsFields());
    const paths: GraphRelationPath[] = [
      { path: "items", table: line, many: true, nativeFields: true, sourceFields: ["id"], presentation: lineTotals },
      { path: "items.detail", table: item, many: false, nativeFields: true, sourceFields: ["id"] },
      { path: "shipping_methods", table: method, many: true, nativeFields: true, sourceFields: ["id"], presentation: methodTotals },
    ];
    for (const [root, table] of [["items", "order_line_item"], ["shipping_methods", "order_shipping_method"]] as const)
      for (const path of yield* relationPaths(catalog, table, ["tax_lines", "adjustments"], { nativeFields: true }))
        paths.push({ ...path, path: root + "." + path.path, nativeFields: true });
    for (const path of yield* relationPaths(catalog, "order", ["shipping_address", "billing_address", "credit_lines", "transactions"], { nativeFields: true }))
      paths.push({ ...path, ...(path.path.endsWith("address") ? { optional: true } : {}), nativeFields: true });
    return { table: order, line, paths,
      presentation: { columns: [...orderTotals.columns, "summary"], companions: orderTotals.companions },
      optionalFields: cartTotalOutputFields().filter(name => !orderTotalsFields().includes(name)).flatMap(name => [name, "raw_" + name]),
    };
  });
}
