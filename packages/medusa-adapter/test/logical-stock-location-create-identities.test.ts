import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { fxAppRowCurrent, fxSystemCommits, fxSystemCommitAppRowChanges } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { prepareLogicalStockLocationUpdate } from "./support/logical-stock-location-update-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalStockLocationUpdate>>;
const snapshot = async () => ({ rows: await connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent),
  facts: await connected.fixture.persistence.drizzle.select().from(fxSystemCommitAppRowChanges),
  commits: await connected.fixture.persistence.drizzle.select().from(fxSystemCommits),
  events: await connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
    .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal) });
const child = (id?: string) => ({ ...(id === undefined ? {} : { id }), address_1: "First street", country_code: "US" });

describe(`genuine native Stock Location create identity normalization - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalStockLocationUpdate(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("returns every alias with final selected child values while committing only the unique graph and replaying it", async () => {
    const input = [
      { id: "stock-alias-a", name: "First A", address: { ...child("stock-alias-child-x"), city: null, metadata: null } },
      { id: "stock-alias-b", name: "B", address: { ...child("stock-alias-child-y"), city: "B city" } },
      { id: "stock-alias-a", name: "Ignored A", address: { ...child("stock-alias-child-x"), address_1: "Ignored street", city: "Filled", metadata: { later: 2 } } },
      { id: "stock-alias-a", name: "Ignored A", address: { ...child("stock-alias-child-ignored"), city: "Ignored" } },
    ];
    const before = await snapshot(), original = structuredClone(input), key = connected.creator.newRequestKey();
    const result = await Effect.runPromise(connected.creator.run(key, input));
    expect(input).toEqual(original); expect(result.map(row => row.id)).toEqual(["stock-alias-a", "stock-alias-b", "stock-alias-a", "stock-alias-a"]);
    expect(result[0]).toEqual(result[2]); expect(result[0]).toEqual(result[3]);
    expect(result[0]).toMatchObject({ name: "First A", address_id: "stock-alias-child-x",
      address: { id: "stock-alias-child-x", address_1: "First street", city: "Filled", metadata: { later: 2 } } });
    expect(await Effect.runPromise(connected.list(["stock-alias-a", "stock-alias-b"], true))).toEqual(result.slice(0, 2));
    expect(await Effect.runPromise(connected.addresses(["stock-alias-child-ignored"]))).toEqual([]);
    const after = await snapshot(), emitted = after.events.slice(before.events.length);
    expect(after.rows.length - before.rows.length).toBe(4); expect(after.facts.length - before.facts.length).toBe(4);
    expect(after.commits.length - before.commits.length).toBe(1);
    expect(emitted.map(row => row.envelope.contract)).toEqual([
      "stock_location.stock-location-address.created", "stock_location.stock-location-address.created",
      "stock_location.stock-location.created", "stock_location.stock-location.created",
    ]);
    expect(emitted.map(row => row.envelope.message)).toEqual(["stock-alias-child-x", "stock-alias-child-y", "stock-alias-a", "stock-alias-b"]
      .map(id => expect.objectContaining({ data: { id } })));
    expect(await Effect.runPromise(connected.creator.run(key, input))).toEqual(result); expect(await snapshot()).toEqual(after);
  }, 180_000);

  it("suppresses ignored child hydration before another root selects that same explicit identity", async () => {
    const result = await Effect.runPromise(connected.creator.run(connected.creator.newRequestKey(), [
      { id: "stock-selected-a", name: "A", address: { ...child("stock-selected-x"), city: "A selected" } },
      { id: "stock-selected-a", name: "Ignored", address: { ...child("stock-selected-y"), city: "Ignored by A" } },
      { id: "stock-selected-b", name: "B", address: { ...child("stock-selected-y"), city: "Selected by B" } },
    ]));
    expect(result[0]).toEqual(result[1]); expect(result[2]).toMatchObject({ address: { id: "stock-selected-y", city: "Selected by B" } });
    expect(await Effect.runPromise(connected.addresses(["stock-selected-y"]))).toMatchObject([{ id: "stock-selected-y", city: "Selected by B" }]);
  }, 180_000);

  it("keeps generated identities distinct but persists only the selected generated Address for a repeated root", async () => {
    const distinct = await Effect.runPromise(connected.creator.run(connected.creator.newRequestKey(), [
      { name: "Generated root", address: child() }, { name: "Generated root", address: child() },
    ]));
    expect(new Set(distinct.map(row => row.id)).size).toBe(2); expect(new Set(distinct.map(row => row.address_id)).size).toBe(2);
    const before = await snapshot(), result = await Effect.runPromise(connected.creator.run(connected.creator.newRequestKey(), [
      { id: "stock-generated-alias", name: "First root", address: { ...child(), city: "First" } },
      { id: "stock-generated-alias", name: "Later root", address: { ...child(), city: "Ignored" } },
    ]));
    expect(result[0]).toEqual(result[1]); expect(result[0]).toMatchObject({ name: "First root", address: { city: "First" } });
    const after = await snapshot(); expect(after.rows.length - before.rows.length).toBe(2); expect(after.events.length - before.events.length).toBe(2);
  }, 180_000);

  it("preserves immediate scalar FK alias presentation independently of the selected persisted relation", async () => {
    const result = await Effect.runPromise(connected.creator.run(connected.creator.newRequestKey(), [
      { id: "stock-fk-alias", name: "First root", address: child("stock-fk-selected") },
      { id: "stock-fk-alias", name: "Ignored", address_id: "stock-fk-presentation-only" },
    ]));
    expect(result[0]).toEqual(result[1]); expect(result[0]).toMatchObject({ address_id: "stock-fk-presentation-only", address: { id: "stock-fk-selected" } });
    expect(await Effect.runPromise(connected.list(["stock-fk-alias"], true))).toMatchObject([
      { id: "stock-fk-alias", address_id: "stock-fk-selected", address: { id: "stock-fk-selected" } },
    ]);
  }, 180_000);

  it("retains native shared-Address and existing-root constraint failures with complete graph rollback", async () => {
    const before = await snapshot();
    await expect(Effect.runPromise(connected.creator.run(connected.creator.newRequestKey(), [
      { id: "stock-shared-child-a", name: "A", address: child("stock-shared-child") },
      { id: "stock-shared-child-b", name: "B", address: child("stock-shared-child") },
    ]))).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    await expect(Effect.runPromise(connected.creator.run(connected.creator.newRequestKey(), [
      { id: "stock-alias-a", name: "Existing conflict", address: child("stock-existing-ignored") },
    ]))).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    // A first FK reference prevents later nested creation. Its missing target
    // must fail the genuine storage FK rather than leave the ignored child.
    await expect(Effect.runPromise(connected.creator.run(connected.creator.newRequestKey(), [
      { id: "stock-first-reference", name: "Reference", address_id: "stock-reference-missing" },
      { id: "stock-first-reference", name: "Ignored", address: child("stock-reference-ignored") },
    ]))).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  }, 180_000);
});
