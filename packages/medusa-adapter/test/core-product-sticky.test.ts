import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { logicalCommerceBatchResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { createCoreProductFixture } from "./support/core-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid native Product sticky witness driver");

describe("actual Product facade sticky failure owner", () => {
  it("rolls back a caught native restore conflict without replaying its service or publishing events", async () => {
    const fixture = await createCoreProductFixture(driver);
    try {
      const { commands } = fixture.runtime;
      await fixture.run(fixture.host.run(fixture.host.newRequestKey(), commands.create,
        { id: "sticky-old-product", title: "old", handle: "sticky-conflicting-handle" }));
      await fixture.run(fixture.host.run(fixture.host.newRequestKey(), commands.softDelete, ["sticky-old-product"]));
      await fixture.run(fixture.host.run(fixture.host.newRequestKey(), commands.create,
        { id: "sticky-new-product", title: "new", handle: "sticky-conflicting-handle" }));
      let callbacks = 0, caught = 0;
      const probe = defineCommerceCommand("productCaughtRestoreConflict", "write", Effect.fn(ctx => fixture.runtime.withService(ctx,
        async ({ service, context }) => {
          callbacks++;
          try { await service.restoreProducts(["sticky-old-product"], {}, context); }
          catch { caught++; }
          return null;
        })));
      const selected = [probe];
      const host = await fixture.run(fixture.openHost({ commands: selected,
        identityAndAccessPolicy: { profile: "actual-product-caught-restore" }, resources: logicalCommerceBatchResources }));
      try {
        const before = await fixture.inventory();
        await expect(fixture.run(host.run(host.newRequestKey(), probe, null))).rejects.toBeDefined();
        expect(callbacks).toBe(1);
        expect(caught).toBe(1);
        const after = await fixture.inventory();
        expect(after.rows).toEqual(before.rows);
        expect(after.revisions).toEqual(before.revisions);
        expect(after.indexes).toEqual(before.indexes);
      } finally { await fixture.run(host.close); }
    } finally { await fixture.close(); }
  }, 180_000);
});
