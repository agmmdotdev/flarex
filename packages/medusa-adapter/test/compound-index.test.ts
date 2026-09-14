import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { model } from "@medusajs/utils/dml/model";
import { normalizeRelationalSchema } from "@flarex/persistence-postgres/internal/relational-schema-values";
import { decodeCompiledDml } from "../src/schema/compiled";
import { lowerDmlSchema } from "../src/schema/lower";

const Listing = model.define("Listing", {
  id: model.id().primaryKey(), status: model.enum(["active", "draft"]).default("draft"),
}).indexes([{ on: ["status"], where: "deleted_at IS NULL AND status = 'active'" }]);

describe("native compound partial index grammar", () => {
  it("lowers the admitted native expression without collapsing its equality atom", async () => {
    const checked = await Effect.runPromise(decodeCompiledDml(JSON.parse(JSON.stringify(compileDmlSchema([Listing])))));
    const lowered = lowerDmlSchema(checked.tables, "listing");
    expect(lowered.tables[0]?.indexes[0]?.predicate).toEqual({ kind: "isNullAndTextEquals", nullColumnId: "deleted_at", textColumnId: "status", value: "active" });
    const schema = Result.getOrThrow(normalizeRelationalSchema(lowered));
    expect(schema.capabilities.find(capability => capability.kind === "softDelete")).toMatchObject({ activeRowsIndex: { indexId: "listing.active" } });
    expect(lowered.tables[0]?.indexes.find(index => index.indexId === "listing.active")?.predicate).toEqual({ kind: "isNull", columnId: "deleted_at" });
  });

  it.each(["deleted_at IS NULL OR status = 'active'", "deleted_at IS NULL AND status = 'active' OR true", "status = 'active'", "deleted_at IS NOT NULL"])("rejects unadmitted native expression %s", async where => {
    const input = compileDmlSchema([Listing]);
    const index = input.tables[0]?.indexes[0];
    if (!index) throw new Error("Missing native index");
    index.where = where;
    expect(await Effect.runPromise(Effect.result(decodeCompiledDml(JSON.parse(JSON.stringify(input)))))).toMatchObject({ _tag: "Failure" });
  });
});
