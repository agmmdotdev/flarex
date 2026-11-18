import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureStoreMetadata, compileStoreDefinition } from "../src/modules/store/schema";
import { decodeStoreGuardRead, decodeStoreGuardArguments, decodeStoreGuardOutput, decodeStoreGuardQuery } from "../src/modules/store/input";
import { makeStoreGuardCommands } from "../src/modules/store/service";
import { workflowMethodDefinition, workflowModuleDefinition } from "../src/workflow/module";

const config = { select: ["default_sales_channel_id"] };
describe("native Store default Sales Channel guard admission", () => {
  it("retains the full checked three-model DML closure and indexed guard column", async () => {
    const metadata = await Effect.runPromise(captureStoreMetadata());
    expect(metadata.frame.tables.map(table => table.name).sort()).toEqual(["store", "store_currency", "store_locale"]);
    const store = metadata.frame.tables.find(table => table.name === "store");
    expect(store?.relationships.map(relation => relation.name).sort()).toEqual(["supported_currencies", "supported_locales"]);
    const definition = await Effect.runPromise(compileStoreDefinition());
    expect(definition.schema.tables.map(table => table.identity.tableId).sort()).toEqual(["store", "store_currency", "store_locale"]);
    const identity = { ...definition.schema.coordinate, tableId: "store" };
    expect(definition.schema.tables.find(table => table.identity.tableId === "store")?.indexes).toContainEqual({
      identity: { ...identity, indexId: "store.default-sales-channel-equality" }, kind: "textEquality",
      columns: [{ ...identity, columnId: "default_sales_channel_id" }],
      predicate: null, origin: { kind: "derived", sourceId: "store.default-sales-channel-equality" },
    });
  });

  it("admits the exact native empty/nonempty selector and retains repeated IDs", () => {
    for (const ids of [[], ["sc_a"], ["sc_b", "sc_a", "sc_b"], ["a", "b", "c", "d"]]) {
      const filters = { default_sales_channel_id: ids };
      expect(Result.getOrThrow(decodeStoreGuardRead({ filters, config }))).toEqual({ filters, config });
      expect(Result.getOrThrow(decodeStoreGuardArguments([filters, config]))).toEqual([filters, config]);
      expect(Result.isSuccess(decodeStoreGuardQuery({ where: filters, options: {
        fields: ["default_sales_channel_id"], populate: [], orderBy: { id: "ASC" },
      } }))).toBe(true);
    }
  });

  it("refuses sibling filters, relation hydration, paging and altered native projections", () => {
    const filters = { default_sales_channel_id: ["sc_a"] };
    for (const wrong of [{}, { default_sales_channel_id: "sc_a" }, { default_sales_channel_id: [""] },
      { default_sales_channel_id: ["a", "b", "c", "d", "e"] }, { ...filters, id: "store_a" }])
      expect(Result.isFailure(decodeStoreGuardRead({ filters: wrong, config }))).toBe(true);
    for (const wrong of [{}, { select: ["id"] }, { select: ["default_sales_channel_id", "id"] },
      { ...config, relations: ["supported_currencies"] }, { ...config, take: 1 }, { ...config, withDeleted: true }])
      expect(Result.isFailure(decodeStoreGuardRead({ filters, config: wrong }))).toBe(true);
    expect(Result.isFailure(decodeStoreGuardQuery({ where: filters, options: {
      fields: ["default_sales_channel_id"], populate: [], orderBy: { id: "ASC" }, limit: 1,
    } }))).toBe(true);
  });

  it("requires every returned native projection without adding an ID or limiting to one Store", () => {
    const rows = Array.from({ length: 256 }, () => ({ default_sales_channel_id: "sc_a" }));
    expect(Result.getOrThrow(decodeStoreGuardOutput(rows))).toEqual(rows);
    expect(Result.getOrThrow(decodeStoreGuardOutput([]))).toEqual([]);
    for (const wrong of [[{}], [{ default_sales_channel_id: 1 }], [{ default_sales_channel_id: "sc_a", id: "store_a" }],
      [...rows, rows[0]]]) expect(Result.isFailure(decodeStoreGuardOutput(wrong))).toBe(true);
  });

  it("exports only an authenticated read method with no arbitrary local graph surface", async () => {
    const commands = await Effect.runPromise(makeStoreGuardCommands());
    expect(Object.keys(commands.workflow.methods)).toEqual(["listStores"]);
    const definition = workflowModuleDefinition(commands.workflow);
    expect(definition?.source.profile).toBe("store.sales-channel-guard");
    expect(definition?.graph).toEqual({ aliases: [], reads: [] });
    expect(definition?.logical?.commands).toEqual([commands.list]);
    expect(workflowMethodDefinition(commands.workflow.methods.listStores)?.moduleEvents).toEqual([]);
  });
});
