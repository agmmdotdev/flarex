import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureRegionMetadata } from "../src/modules/region/schema";
import { decodeRegionCartReadInput } from "../src/modules/region/cart-read-input";
import { prepareRegionCartReadRepository } from "../src/modules/region/cart-read-repository";
import { prepareRegionReadRepository } from "../src/modules/region/repository";

let prepared: Result.Result.Success<ReturnType<typeof prepareRegionCartReadRepository>>;
let scalar: Result.Result.Success<ReturnType<typeof prepareRegionReadRepository>>;
const stamp = "2026-10-22T00:00:00.000Z", region = { id: "reg-a", name: "Native", currency_code: "usd", automatic_taxes: true,
  metadata: null, created_at: stamp, updated_at: stamp, deleted_at: null };
const country = { iso_2: "us", iso_3: "usa", num_code: "840", name: "UNITED STATES", display_name: "United States", region_id: "reg-a",
  metadata: null, created_at: stamp, updated_at: stamp, deleted_at: null };
beforeAll(async () => { const metadata = (await Effect.runPromise(captureRegionMetadata())).frame;
  prepared = Result.getOrThrow(prepareRegionCartReadRepository(metadata)); scalar = Result.getOrThrow(prepareRegionReadRepository(metadata)); });

describe("native Cart Region/Country read contract", () => {
  it("admits native find-one-or-any selectors and only the checked countries edge", () => {
    for (const input of [{}, { filters: {} }, { filters: { id: null } }, { filters: { id: "reg-a" }, config: { select: ["*", "countries.*"], relations: ["countries"] } }])
      expect(Result.getOrThrow(decodeRegionCartReadInput(input))).toEqual(input);
    for (const input of [{ filters: { id: [null] } }, { filters: { id: Array(9).fill("reg-a") } }, { filters: { name: "Native" } },
      { config: { relations: ["countries.region"] } }, { config: { withDeleted: true } }]) expect(Result.isFailure(decodeRegionCartReadInput(input))).toBe(true);
    const plan = Result.getOrThrow(prepared.query({ where: { id: "reg-a" }, options: { fields: ["*", "countries.*"], populate: ["countries"] } }));
    expect(plan.paths).toEqual(["countries"]);
    expect(plan.projection.node.children[0]?.node.fields.has("iso_2")).toBe(true);
    expect(Result.isFailure(scalar.query({ where: { id: "reg-a" }, options: { populate: ["countries"] } }))).toBe(true);
    expect(Result.isFailure(prepared.query({ where: {}, options: { filters: { softDeletable: { withDeleted: true } } } }))).toBe(true);
    expect(Result.getOrThrow(prepared.query({ where: { id: null }, options: { populate: ["countries"] } })).query.predicate).toEqual({ kind: "and", children: [
      { kind: "and", children: [{ kind: "isNull", column: "id" }] }, { kind: "isNull", column: "deleted_at" }] });
    expect(Result.isFailure(scalar.query({ where: { id: null }, options: {} }))).toBe(true);
  });

  it("validates complete Country storage under its real iso_2 primary key before projection", () => {
    expect(Result.getOrThrow(prepared.contracts.decodeCountry(country))).toEqual(country);
    expect(Result.getOrThrow(prepared.contracts.decodeProjection([{ ...region, countries: [country] }]))).toEqual([{ ...region, countries: [country] }]);
    const { name: omitted, ...incomplete } = country;
    expect(omitted).toBe("UNITED STATES");
    for (const invalid of [incomplete, { ...country, iso_2: "" }, { ...country, num_code: 840 }, { ...country, id: "invented" }])
      expect(Result.isFailure(prepared.contracts.decodeCountry(invalid))).toBe(true);
    for (const countries of [[country, country], [{ ...country, region_id: "outside" }], [{ ...country, deleted_at: stamp }]])
      expect(Result.isFailure(prepared.contracts.decodeProjection([{ ...region, countries }]))).toBe(true);
  });

  it("preserves an empty Store default Region ID as a real empty-string selector", () => {
    expect(Result.getOrThrow(decodeRegionCartReadInput({ filters: { id: "" } }))).toEqual({ filters: { id: "" } });
    expect(Result.getOrThrow(prepared.query({ where: { id: "" }, options: { populate: ["countries"] } })).query.predicate).toEqual({
      kind: "and", children: [
        { kind: "and", children: [{ kind: "in", column: "id", values: [""] }] },
        { kind: "isNull", column: "deleted_at" },
      ],
    });
  });
});
