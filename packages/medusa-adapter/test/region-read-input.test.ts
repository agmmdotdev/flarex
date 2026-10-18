import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureRegionMetadata, compileRegionDefinition } from "../src/modules/region/schema";
import { compileRegionReadContracts, decodeRegionReadInput } from "../src/modules/region/input";
import { prepareRegionReadRepository } from "../src/modules/region/repository";

let contracts: Result.Result.Success<ReturnType<typeof compileRegionReadContracts>>;
let prepared: Result.Result.Success<ReturnType<typeof prepareRegionReadRepository>>;
const stamp = "2026-10-18T00:00:00.000Z";
const row = { id: "region-a", name: " Native Region ", currency_code: "usd", automatic_taxes: true, metadata: null,
  created_at: stamp, updated_at: stamp, deleted_at: null };
beforeAll(async () => { const metadata = (await Effect.runPromise(captureRegionMetadata())).frame;
  contracts = Result.getOrThrow(compileRegionReadContracts(metadata)); prepared = Result.getOrThrow(prepareRegionReadRepository(metadata)); });

describe("bounded native Region scalar reads", () => {
  it("admits the actual full/scalar-selected read ABIs and preserves an empty ID cohort", () => {
    for (const input of [{ filters: { id: [] } }, { filters: { id: Array.from({ length: 8 }, (_, index) => "region-" + index) } }, { filters: { id: ["region-a"] } },
      { filters: { id: ["region-a"] }, config: { select: ["id", "currency_code"] } }])
      expect(Result.getOrThrow(decodeRegionReadInput(input))).toEqual(input);
    for (const input of [{ filters: { id: [undefined] } }, { filters: { id: [null] } }, { filters: { id: [""] } },
      { filters: { id: Array(9).fill("region") } }, { filters: { name: "unadmitted" } },
      { filters: { id: [] }, config: { relations: ["countries"] } }, { filters: { id: [] }, config: { withDeleted: true } }])
      expect(Result.isFailure(decodeRegionReadInput(input))).toBe(true);
  });

  it("keeps genuine full reads scalar and validates DML types without inventing a countries relation", () => {
    expect(Result.getOrThrow(contracts.decodeRow(row))).toEqual(row);
    expect(Result.getOrThrow(contracts.decodeProjection([row]))).toEqual([row]);
    expect(Result.getOrThrow(contracts.decodeProjection([{ id: "region-a", currency_code: "usd" }]))).toEqual([{ id: "region-a", currency_code: "usd" }]);
    for (const invalid of [[{ ...row, countries: [] }], [{ ...row, automatic_taxes: "true" }], [{ ...row, deleted_at: stamp }],
      [{ id: "region-a", currency_code: 1 }], [row, row]]) expect(Result.isFailure(contracts.decodeProjection(invalid))).toBe(true);
  });

  it("applies native ID-filter order after the id-ordered database page", () => {
    const selection = { id: ["z", "a"] }, options = { fields: ["id", "currency_code"] }, rows = [{ ...row, id: "a" }, { ...row, id: "z" }];
    const whole = Result.getOrThrow(prepared.query({ where: selection, options }));
    expect(whole.window.select(rows).rows.map(row => row.id)).toEqual(["z", "a"]);
    const page = Result.getOrThrow(prepared.query({ where: selection, options: { ...options, limit: 1 } }));
    expect(page.window.select(rows).rows.map(row => row.id)).toEqual(["a"]);
    expect(Result.isFailure(prepared.query({ where: selection, options: { populate: ["countries"] } }))).toBe(true);
  });

  it("retains the complete two-model logical schema with the genuine Country primary key", async () => {
    const definition = await Effect.runPromise(compileRegionDefinition());
    expect(definition.schema.tables.map(table => table.identity.tableId)).toEqual(["region", "region_country"]);
    expect(definition.schema.tables.find(table => table.identity.tableId === "region_country")?.columns.some(column => column.identity.columnId === "iso_2")).toBe(true);
    expect(definition.provenance.revision).toBe("48d5cc675e4e8bc821e22c20c88a751acc66fb5f");
  });
});
