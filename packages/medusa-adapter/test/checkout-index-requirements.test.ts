import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { canonicalizeAppIndexPhysicalSpecV1 } from "flarex-protocol/index-definition";
import { compileLogicalSourceIndexes } from "flarex-protocol/internal/logical-storage-requirements";
import { checkoutModuleNames, customerCheckoutModuleNames } from "../src/workflows/cart/checkout-graph";
import { checkoutCoreDefinitions } from "./support/checkout-core-definitions";

const target = { scopeUuid: "24e6ff2f-9610-488a-9544-a524c1b92d8e", epochUuid: "4c86656f-a9d5-417c-a78c-bee23f8c1d1a" };
const cartCreationTables = ["cart_creation_address", "cart_creation_cart", "cart_creation_operation"];

it("retains every genuine checkout table and ordered-index requirement in the Core sources", async () => {
  const definitions = await Effect.runPromise(checkoutCoreDefinitions(target, true));
  expect(Object.keys(definitions).toSorted()).toEqual([...customerCheckoutModuleNames].toSorted());
  const requirements = [], fingerprints: Record<string, string> = {};
  for (const name of customerCheckoutModuleNames) {
    const definition = definitions[name];
    if (definition === undefined) throw new Error("Missing checkout definition " + name);
    const tables = definition.source.bindings.map(binding => binding.localName);
    expect(definition.tables.map(table => table.localName).toSorted()).toEqual(tables.toSorted());
    const indexes = Result.getOrThrow(compileLogicalSourceIndexes(definition.source));
    if (name === "cart") {
      expect(tables).toHaveLength(12);
      for (const table of cartCreationTables) {
        expect(tables).toContain(table);
        expect(indexes).toContainEqual(expect.objectContaining({ localName: table, descriptor: `key/${table}.primary` }));
      }
    }
    const checkoutTables = tables.filter(table => !cartCreationTables.includes(table));
    const checkoutIndexes = indexes.filter(index => !cartCreationTables.includes(index.localName));
    requirements.push([name, [checkoutTables.length, checkoutIndexes.length]] as const);
    const descriptors = await Promise.all(checkoutIndexes.map(async index => [index.localName, index.descriptor,
      (await canonicalizeAppIndexPhysicalSpecV1(index.physicalSpec)).sha256Hex]));
    fingerprints[name] = createHash("sha256").update(JSON.stringify([checkoutTables, descriptors.map(row => JSON.stringify(row)).toSorted()])).digest("hex");
  }
  // Keep the original closure counts and pin the authenticated schema's exact
  // ordered fields, value formats and predicates against same-count drift.
  expect(Object.fromEntries(requirements)).toEqual({
    cart: [9, 48],
    order: [23, 169],
    payment: [9, 33],
    customer: [4, 15],
    region: [2, 6],
    promotion: [10, 47],
    fulfillment: [12, 46],
    cart_payment_collection_links: [1, 7],
    order_payment_collection_links: [1, 7],
    order_cart_links: [1, 7],
    cart_promotion_links: [1, 7],
    product: [13, 60],
    inventory: [3, 16],
    stock_location: [2, 6],
    sales_channel: [1, 4],
    product_links: [2, 14],
    variant_links: [2, 14],
    sales_channel_locations: [1, 7],
    customer_account_holder_links: [1, 7],
  });
  expect(fingerprints).toMatchInlineSnapshot(`
    {
      "cart": "381ec0b9ffaa1fafbf82ebf7b5bbcc296e9fde596bb6fb75bc90b9963ad6025d",
      "cart_payment_collection_links": "ac37781cf4ba2eae8749acf9d4a0dfcb4b3b5f9678cc258a224ea1168f7477dc",
      "cart_promotion_links": "c3352e2232159e30bdbfb6ef29fccf5e263ae2ccfca0490879e00f9277179ae4",
      "customer": "c6331f08bb3402c32ad4ceb1f8fdb4ba0ed374dcc0fc1c8adca3ecdf3a7b9379",
      "customer_account_holder_links": "0b0c825ea832912b0b9e3e89f0309920e6b38f1b6f756144f42e702e1e9588b5",
      "fulfillment": "55b66172a2aeead51327135ffa689f7ad683ab23e8e6d5e6c3019903ffe2912e",
      "inventory": "3fccb3df0c85b9d2b8db29a5461d4530df133530da158977c87bd67a103368be",
      "order": "9d651b75eb1ef7b44035b2b19a4b605b0e1271cf71fdfd73f55aa50b31aa09fb",
      "order_cart_links": "94219353e9a2fe15ee09db821d38e37643366d1f522b89d92a523bd2d24c571f",
      "order_payment_collection_links": "7257e84c1642da4ed891e88674a97011a2dbb4bddf1cac0b2f4c1c9fbdac5643",
      "payment": "772386e6effcd48c771a76f0efddbb2a9897f99fc377dd624db0ce977bbe014e",
      "product": "2ae969cae651d92e27fb2f791ba65f1198054908103ec3cd52025a140d6c19cd",
      "product_links": "a717dadb612745f102ab52f5455fe73e2db8eaf2ef695042804d03df89b8b746",
      "promotion": "e87e9f63e24de0752601e7acfd1edfd553e112f666a2fcff4dccd4763cb12a72",
      "region": "d9c93594c3abf14858329f0b6f4f01b01f79b82c0d06f505001241034202e6f7",
      "sales_channel": "c787ece52955abb990ca0d2ca8806f2a60fb31d2ed4976a3b4ddbe876ee46d70",
      "sales_channel_locations": "b3c82cd2d048f3d76c3b5af16913e81f72aff9a1875c382599ce6cf4a588e318",
      "stock_location": "a7fe0ce55d3edfd4b5f9079603f9322e9ce8ced1e4b1d0b4b2775184fecc3cc6",
      "variant_links": "50354aa1fbcd329ccf1c5821f2b0cdb7431675d915a38af9f7ec2315eb335839",
    }
  `);
});

it("omits the Customer AccountHolder Link from the ordinary checkout sources", async () => {
  const definitions = await Effect.runPromise(checkoutCoreDefinitions(target, false));
  expect(Object.keys(definitions).toSorted()).toEqual([...checkoutModuleNames].toSorted());
});
