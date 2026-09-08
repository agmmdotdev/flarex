import { beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { fxSystemScopeClocks } from "../../../persistence-postgres/src/schema";
import { commerceInventory } from "../../../persistence-postgres/test/commerceInventory";
import { clearProductRunnerRows, getProductRunnerFixture } from "./product-runner";

const run = Effect.runPromise;

describe("Product Type boundary", () => {
  beforeEach(clearProductRunnerRows);

  it("isolates Type reads and counts from foreign scope rows", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createTypes,
      { id: "ptype_owned", value: "shared-value" }));
    const clock = (await fixture.persistence.drizzle.select().from(fxSystemScopeClocks))[0];
    if (clock === undefined) throw new Error("Missing scope clock");
    const alienUuid = "bddca8df-4b80-4dd7-8c42-4b367ce0c6f9";
    await fixture.persistence.drizzle.insert(fxSystemScopeClocks).values({
      scopeId: ScopeIdSchema.make("scope_" + alienUuid), storageGeneration: clock.storageGeneration, epoch: clock.epoch,
    });
    const physical = fixture.descriptor.layout.frame.tables.find(table => table.identity.tableId === "product_type");
    const idColumn = physical?.columns.find(column => column.identity.columnId === "id");
    const valueColumn = physical?.columns.find(column => column.identity.columnId === "value");
    if (physical === undefined || idColumn === undefined || valueColumn === undefined) throw new Error("Missing Type layout");
    const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
    // Deliberate foreign-scope fixture using compiler-owned physical identifiers.
    // Identical values and an overlapping ID make missing scope predicates visible.
    await fixture.persistence.query(`insert into ${quote(fixture.descriptor.layout.frame.targetNamespace.schemaName)}.${quote(physical.name)}
      ("scope_uuid", ${quote(idColumn.name)}, ${quote(valueColumn.name)}) values ($1::uuid, $2, $3), ($1::uuid, $4, $5)`,
    [alienUuid, "ptype_owned", "shared-value", "ptype_foreign", "foreign-only"]);
    const before = await commerceInventory(fixture);
    const selected = { config: { select: ["value"] } };
    expect(await run(fixture.host.read(runtime.commands.listTypes, { ...selected, filters: { value: "shared-value" } })))
      .toEqual([{ id: "ptype_owned", value: "shared-value" }]);
    expect(await run(fixture.host.read(runtime.commands.countTypes, { ...selected, filters: { value: "shared-value" }, config: { select: ["value"], take: 1 } })))
      .toEqual([[{ id: "ptype_owned", value: "shared-value" }], 1]);
    expect(await run(fixture.host.read(runtime.commands.retrieveType, { ...selected, id: "ptype_owned" })))
      .toEqual({ id: "ptype_owned", value: "shared-value" });
    expect(await run(fixture.host.read(runtime.commands.countTypes, { filters: { id: "ptype_foreign" } }))).toEqual([[], 0]);
    expect(await run(Effect.result(fixture.host.read(runtime.commands.retrieveType, { id: "ptype_foreign" }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure", cause: { message: "ProductType with id: ptype_foreign was not found" } } });
    expect(await commerceInventory(fixture)).toEqual(before);
  });

  it("rejects unsupported read inputs without publication", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    const before = await commerceInventory(fixture);
    for (const input of [
      { scopeId: "other" }, { table: "product_tag" }, { id: "ignored-id" },
      { filters: { value: ["array-not-admitted"] } }, { filters: { metadata: {} } },
      { filters: { value: { equals: "nested-not-admitted" } } },
      { config: { select: ["missing"] } }, { config: { relations: ["products"] } },
      { config: { take: 257 } }, { config: { skip: -1 } }, { config: { order: { value: "ASC" } } },
    ]) {
      expect(await run(Effect.result(fixture.host.read(runtime.commands.listTypes, input))))
        .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    }
    for (const input of [{}, { id: "type", filters: { value: "ignored" } }]) {
      expect(await run(Effect.result(fixture.host.read(runtime.commands.retrieveType, input))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    }
    expect(await commerceInventory(fixture)).toEqual(before);
  });
});
