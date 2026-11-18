import { afterAll, beforeEach, describe } from "vitest";
import { Effect, Schema } from "effect";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalInventoryHosts, prepareInventoryCreateHost } from "./support/logical-inventory-fixture";
import { registerNativeInventoryTests, type NativeInventoryInput, type NativeInventoryRow } from "./support/inventory-native-tests";
import { captureCommerceInput } from "../src/value/input";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid native Inventory driver");
const cleanup: Array<() => Promise<void>> = [];
let selected: Awaited<ReturnType<typeof prepareLogicalInventoryHosts>>;
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let count = 0;
let resource: Awaited<ReturnType<typeof logicalCurrencyFixture>>["resource"] | undefined;
const row = Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]);
describe("selected pinned Inventory item creation assertions", () => {
  beforeEach(async () => {
    const ordinal = ++count;
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      ...(resource === undefined ? {} : { resource }), includeProduct: true, includePricing: true, includeVariantInventory: true,
      fixtureIdentity: { deploymentId: "native_inventory_" + ordinal, projectId: "native_inventory_" + ordinal, uuidOffset: 5_000 + ordinal * 1_000 },
    });
    resource = fixture.resource;
    selected = await prepareLogicalInventoryHosts(fixture);
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });
  function createInventoryItems(input: NativeInventoryInput): Promise<NativeInventoryRow>;
  function createInventoryItems(input: NativeInventoryInput[]): Promise<readonly NativeInventoryRow[]>;
  async function createInventoryItems(input: NativeInventoryInput | NativeInventoryInput[]): Promise<NativeInventoryRow | readonly NativeInventoryRow[]> {
    const { host, create } = await prepareInventoryCreateHost(fixture, selected.inventory);
    try {
      const value = await Effect.runPromise(Effect.fromResult(captureCommerceInput(input)));
      const result = await Effect.runPromise(host.run(host.newRequestKey(), create, value));
      return Array.isArray(input) ? Schema.decodeUnknownSync(Schema.Array(row))(result) : Schema.decodeUnknownSync(row)(result);
    } finally { await Effect.runPromise(host.close); }
  }
  registerNativeInventoryTests({ createInventoryItems });
});
