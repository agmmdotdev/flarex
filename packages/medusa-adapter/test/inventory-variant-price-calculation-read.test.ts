import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeLocalInventoryCommands } from "../src/modules/inventory/service";
import { InventoryVariantPriceCalculationItemRead, InventoryVariantPriceCalculationLevelRead } from "../src/modules/inventory/variant-price-calculation-read";
import { commerceDecoder } from "../src/value/decoder";
import { isGraphReadCommand } from "../src/local-graph/commands";
import { workflowModuleDefinition } from "../src/workflow/module";

let inventory: Effect.Success<ReturnType<typeof prepare>>;
const prepare = () => makeLocalInventoryCommands("variant-price-calculation");
const item = commerceDecoder(InventoryVariantPriceCalculationItemRead, "unsupportedProfile");
const level = commerceDecoder(InventoryVariantPriceCalculationLevelRead, "unsupportedProfile");
beforeAll(async () => { inventory = await Effect.runPromise(prepare()); });

describe("Inventory reads for native Variant price calculation", () => {
  it("exposes only two authenticated read commands and no native workflow mutation methods", () => {
    expect(inventory.workflow.methods).toEqual({});
    expect(inventory.commands).toEqual([inventory.count, inventory.countLevels]);
    expect(inventory.commands.map(command => commerceCommandIdentity(command)?.mode)).toEqual(["read", "read"]);
    expect(inventory.commands.every(isGraphReadCommand)).toBe(true);
    const definition = workflowModuleDefinition(inventory.workflow);
    expect(definition?.source).toEqual({ name: "flarex-inventory-local", profile: "inventory-variant-price-calculation" });
    expect(definition?.logical?.commands).toEqual(inventory.commands);
    expect(inventory.graph.reads.map(read => [read.model, read.command, read.paths, read.selectedFieldsOnly]))
      .toEqual([["InventoryItem", inventory.count, [], true], ["InventoryLevel", inventory.countLevels, [], true]]);
    expect(inventory.graph.aliases.map(alias => alias.name)).toEqual(expect.arrayContaining(["inventory_level", "inventory_levels"]));
    const read = inventory.graph.reads.find(candidate => candidate.model === "InventoryLevel");
    expect(read?.table.companions).toMatchObject({ stocked_quantity: "raw_stocked_quantity", reserved_quantity: "raw_reserved_quantity" });
  });

  it("retains empty and eight-ID cohorts without admitting unbounded or unrelated selectors", () => {
    for (const selected of [[], Array.from({ length: 8 }, (_, index) => "item-" + index)]) {
      expect(Result.getOrThrow(item({ filters: { id: selected } })).filters.id).toEqual(selected);
      expect(Result.getOrThrow(level({ filters: { inventory_item_id: selected } })).filters.inventory_item_id).toEqual(selected);
    }
    expect(Result.isSuccess(level({ filters: { id: ["level"], inventory_item_id: ["item"] }, config: {
      select: ["id", "stocked_quantity", "reserved_quantity", "raw_stocked_quantity", "raw_reserved_quantity"],
      relations: [], skip: 0, take: 16, order: { id: "ASC" },
    } }))).toBe(true);
    for (const decode of [item, level]) for (const value of [{ filters: {} }, {},
      { filters: { id: Array.from({ length: 9 }, (_, index) => "id-" + index) } },
      { filters: { id: ["id"] }, config: { skip: 1 } }, { filters: { id: ["id"] }, config: { withDeleted: true } },
      { filters: { id: ["id"] }, config: { relations: ["location_levels"] } },
      { filters: { id: ["id"] }, config: { order: { id: "DESC" } } }, { filters: { location_id: ["location"] } },
    ]) expect(decode(value)).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(item({ filters: { inventory_item_id: ["item"] } })).toMatchObject({ _tag: "Failure" });
  });

  it("keeps the existing Item profile and independently issued command tokens intact", async () => {
    const ordinary = await Effect.runPromise(makeLocalInventoryCommands("items"));
    expect(ordinary.workflow.methods.createInventoryItems).toBeDefined();
    expect(ordinary.graph.reads.map(read => read.model)).toEqual(["InventoryItem"]);
    const second = await Effect.runPromise(prepare());
    for (const command of second.commands) expect(inventory.commands).not.toContain(command);
  });
});
