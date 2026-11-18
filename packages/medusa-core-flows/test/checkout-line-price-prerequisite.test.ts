import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "@typescript/typescript6";
import { Result, Schema } from "effect";
import { BigNumber, createRawPropertiesFromBigNumber, MathBN, OrderStatus } from "@medusajs/framework/utils/portable";
import { prepareAdjustmentsData, prepareLineItemData, prepareTaxLinesData } from "../src/cart/utils/prepare-line-item-data";
import { completeCartWorkflow } from "../src/cart/workflows/complete-cart";
import { prepareCheckoutOrderData } from "../src/cart/utils/prepare-checkout-order-data";

/** Execute the promoted native root's actual Cart-to-Order callback in isolation. This
 * probe does not simulate its graph reads, transaction or workflow runtime. */
function nativeCartToOrder(cart: unknown): unknown {
  const source = readFileSync(new URL("../src/cart/workflows/complete-cart.ts", import.meta.url), "utf8");
  const file = ts.createSourceFile("complete-cart.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const callbacks: ts.ArrowFunction[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "cartToOrder" &&
      node.initializer !== undefined && ts.isCallExpression(node.initializer)) {
      const callback = node.initializer.arguments[1];
      if (callback !== undefined && ts.isArrowFunction(callback)) callbacks.push(callback);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const [callback] = callbacks;
  if (callbacks.length !== 1 || callback === undefined) throw new Error("Missing pinned native Cart-to-Order transform");
  const emitted = ts.transpileModule("const cartToOrder = " + callback.getText(file), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  const invoke: unknown = new Function("prepareLineItemData", "prepareTaxLinesData", "prepareAdjustmentsData", "OrderStatus", "prepareCheckoutOrderData",
    emitted + "\nreturn cartToOrder;")(prepareLineItemData, prepareTaxLinesData, prepareAdjustmentsData, OrderStatus, prepareCheckoutOrderData);
  if (typeof invoke !== "function") throw new Error("Invalid pinned native transform");
  return Reflect.apply(invoke, undefined, [{ cart }]);
}

const Numeric = Schema.Union([Schema.Finite, Schema.String, Schema.Struct({ value: Schema.String, precision: Schema.Finite })]);
const decodeOrder = Schema.decodeUnknownSync(Schema.Struct({ items: Schema.Array(Schema.Struct({ unit_price: Numeric })) }));
describe("native checkout Cart-to-Order exact line price prerequisite", () => {
  it("prepares the complete native root and declared compensation child closure", () => {
    const prepared = Result.getOrThrow(completeCartWorkflow.prepare());
    expect(prepared.nodeCount).toBeLessThanOrEqual(64);
    expect(prepared.identity).toMatchObject({ store: true, retentionTime: 259200, idempotent: false });
  });
  it("retains the Cart's raw unit price when its public number rounds down", () => {
    const item = { id: "cali-exact-native-checkout", title: "Digital item", quantity: 1,
      requires_shipping: false, is_tax_inclusive: false, unit_price: new BigNumber("9007199254740993.0000") };
    createRawPropertiesFromBigNumber(item);
    // Native public serialization keeps the rounded numeric DTO and its raw
    // companion. The real root callback chooses which one enters Order creation.
    const cart: unknown = JSON.parse(JSON.stringify({ id: "cart-exact-native-checkout", currency_code: "usd", items: [item] }));
    expect(cart).toMatchObject({ items: [{ unit_price: 9007199254740992, raw_unit_price: { value: "9007199254740993", precision: 20 } }] });
    const order = decodeOrder(nativeCartToOrder(cart));
    const first = order.items[0];
    if (first === undefined) throw new Error("Missing genuine native Order input item");
    expect(MathBN.convert(first.unit_price).toString()).toBe("9007199254740993");
  });
});
