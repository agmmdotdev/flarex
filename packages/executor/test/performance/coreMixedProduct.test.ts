import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Result, Schema } from "effect";
import { coreNativeFixtureData } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import { coreNativeRelationalRow } from "../../../persistence-postgres/src/core/nativeRelationalQuery";
import { PointCommitPublicationObservation } from "../../../persistence-postgres/src/commit/point/observation";
import { createCoreMixedProductFixture, type CoreMixedProductFixture } from "./support/coreMixedProductFixture";
import { prepareMixedScenario } from "./support/mixed";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const decodeBusiness = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String,
  updated: Schema.Struct({ id: Schema.String, title: Schema.String, handle: Schema.String, status: Schema.String }),
  pending: Schema.Struct({ id: Schema.String, title: Schema.String }), listed: Schema.Array(Schema.Struct({ id: Schema.String })),
}));

describe(`current Core mixed Product construction on ${driver}`, () => {
  let fixture: CoreMixedProductFixture;
  beforeAll(async () => { fixture = await createCoreMixedProductFixture({ driver, suffix: "core-mixed-correctness", sampleCount: 4 }); }, 180_000);
  afterAll(async () => { if (fixture !== undefined) await fixture.close(); }, 180_000);

  it("publishes Application, native Product, events and outcome together, then replays without callbacks", async () => {
    const seed = await fixture.prepare(0);
    const before = await fixture.eventFamilies();
    const first = await fixture.invoke(0);
    expect(first.outcome.disposition).toBe("published");
    const business = decodeBusiness(first.outcome.value);
    expect(business.updated).toEqual({ id: seed.productId, title: seed.newTitle, handle: seed.newHandle, status: "published" });
    expect(business.pending).toEqual({ id: seed.productId, title: seed.newTitle });
    expect(business.listed).toEqual([{ id: seed.productId }]);
    expect(await fixture.readApplication(business.id)).toMatchObject({ name: seed.newTitle });
    expect(await fixture.readProduct(seed.productId)).toMatchObject(business.updated);
    expect([...fixture.nativeInvocations]).toEqual([["update", 1], ["retrieve", 1], ["listByHandle", 1]]);
    const families = await fixture.eventFamilies();
    expect(families).toHaveLength(before.length + 1);
    const familyId = families.find(id => !before.includes(id));
    if (familyId === undefined) throw new Error("Missing mixed Product event family");
    const family = await fixture.product.run(fixture.product.events.readFamily(familyId));
    expect(family.events).toHaveLength(1);
    expect(family.events[0]?.message).toMatchObject({ name: fixture.product.runtime.metadata.product.updatedEvent,
      data: { id: seed.productId } });
    const inventory = await fixture.product.inventory();
    const productTable = fixture.product.definition.tables.find(table => table.localName === "product");
    const eventTables = fixture.product.eventDefinition.tables.map(table => table.name);
    const productRow = inventory.rows.find(row => row.table === productTable?.name
      && Result.getOrThrow(coreNativeRelationalRow(row.value)).id === seed.productId);
    expect(productRow?.timestamp).toBe(first.outcome.timestamp);
    expect(inventory.rows.find(row => row.table === "users" && row.value._id === business.id)?.timestamp).toBe(first.outcome.timestamp);
    expect(inventory.rows.filter(row => eventTables.includes(row.table) && row.timestamp === first.outcome.timestamp).length).toBeGreaterThan(0);
    expect(inventory.outcomes.some(row => row.timestamp === first.outcome.timestamp)).toBe(true);
    const replay = await fixture.invoke(0);
    expect(replay.outcome).toEqual({ ...first.outcome, disposition: "replayed" });
    await fixture.reopen();
    const cold = await fixture.invoke(0);
    expect(cold.outcome).toEqual(replay.outcome);
    expect([...fixture.nativeInvocations]).toEqual([["update", 1], ["retrieve", 1], ["listByHandle", 1]]);
    expect(await fixture.eventFamilies()).toEqual(families);
  }, 180_000);

  it.each(["late-failure", "caught-native", "dropped-native"] as const)("rolls back the complete root after %s", async mode => {
    const index = mode === "late-failure" ? 1 : mode === "caught-native" ? 2 : 3;
    const seed = await fixture.prepare(index);
    const before = coreNativeFixtureData(await fixture.product.inventory());
    const families = await fixture.eventFamilies();
    const calls = new Map(fixture.nativeInvocations);
    await expect(fixture.invoke(index, mode)).rejects.toThrow();
    for (const method of ["update", "retrieve", "listByHandle"])
      expect(fixture.nativeInvocations.get(method)).toBe((calls.get(method) ?? 0) + 1);
    expect(coreNativeFixtureData(await fixture.product.inventory())).toEqual(before);
    expect(await fixture.eventFamilies()).toEqual(families);
    expect(await fixture.readProduct(seed.productId)).toMatchObject({ title: `Mixed draft core-mixed-correctness-${index}` });
  }, 180_000);
});

describe(`migrated mixed-product scenario on ${driver}`, () => {
  it("executes the actual selected caller with independent sample graphs", async () => {
    const scenario = await prepareMixedScenario("mixed-product", 2, driver);
    try {
      const first = await scenario.prepareSample("first", 0), second = await scenario.prepareSample("second", 1);
      let observations = 0;
      await expect(first.run(new PointCommitPublicationObservation({ detail: true, record: () => { observations++; } })))
        .rejects.toThrow("does not support legacy publication observation");
      expect(observations).toBe(0);
      const firstResult = await first.run();
      await first.verify(firstResult);
      const secondResult = await second.run();
      await second.verify(secondResult);
      expect(decodeBusiness(firstResult).updated.id).not.toBe(decodeBusiness(secondResult).updated.id);
      await expect(first.run()).rejects.toThrow("already used");
      scenario.setTrace(undefined);
      scenario.setEffectDiagnostics?.(undefined);
      await first.cleanup(); await second.cleanup();
    } finally { await scenario.dispose(); }
  }, 180_000);
});
