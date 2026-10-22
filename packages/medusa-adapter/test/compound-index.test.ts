import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { model } from "@medusajs/utils/dml/model";
import {
  normalizeRelationalSchema,
} from "flarex-protocol/internal/relational-schema";
import { decodeCompiledDml } from "../src/schema/compiled";
import { lowerDmlSchema } from "../src/schema/lower";
import { compileBooleanPartialIndexDml, prepareBooleanPartialIndexSchema } from "./support/boolean-partial-index-schema";

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

  it("retains the Boolean and active-row atoms emitted by the genuine DML builder", async () => {
    const checked = await Effect.runPromise(decodeCompiledDml(compileBooleanPartialIndexDml()));
    expect(checked.tables[0]?.indexes.map(index => index.where)).toEqual([
      '"selected" = true AND deleted_at IS NULL',
      '"selected" = true AND deleted_at IS NULL',
    ]);
    const schema = await Effect.runPromise(prepareBooleanPartialIndexSchema());
    const predicates = schema.tables[0]?.indexes.filter(index => index.predicate?.kind === "isNullAndBooleanEquals")
      .map(index => index.predicate);
    expect(predicates).toHaveLength(2);
    for (const predicate of predicates ?? []) expect(predicate).toMatchObject({ kind: "isNullAndBooleanEquals",
      nullColumn: { columnId: "deleted_at" }, booleanColumn: { columnId: "selected" }, value: true });
  });

  it("lowers false as its own Boolean literal without coercing or dropping the condition", async () => {
    const input = compileDmlSchema([Listing]);
    const index = input.tables[0]?.indexes[0];
    if (!index) throw new Error("Missing native index");
    index.where = '"selected" = false AND deleted_at IS NULL';
    const checked = await Effect.runPromise(decodeCompiledDml(JSON.parse(JSON.stringify(input))));
    expect(lowerDmlSchema(checked.tables, "listing").tables[0]?.indexes[0]?.predicate).toEqual({
      kind: "isNullAndBooleanEquals", nullColumnId: "deleted_at", booleanColumnId: "selected", value: false,
    });
    // This Listing has no selected Boolean column: the shared source owner must
    // reject the valid spelling's invalid reference rather than infer a column.
    expect(normalizeRelationalSchema(lowerDmlSchema(checked.tables, "listing"))).toMatchObject({ _tag: "Failure" });
  });

  it.each([
    '"selected" = true', 'selected = true AND deleted_at IS NULL',
    '"selected" = "true" AND deleted_at IS NULL', '"selected" = 1 AND deleted_at IS NULL',
    '"selected" = TRUE AND deleted_at IS NULL', '"selected" = true OR deleted_at IS NULL',
    '"selected" = true AND deleted_at IS NULL OR true', '"selected" = true AND deleted_at IS NOT NULL',
    '"selected" = true AND deleted_at IS NULL\n', '"bad column" = true AND deleted_at IS NULL',
    '"selected" OR true--" = true AND deleted_at IS NULL',
  ])("rejects unadmitted Boolean expression %s", async where => {
    const input = compileDmlSchema([Listing]), index = input.tables[0]?.indexes[0];
    if (!index) throw new Error("Missing native index");
    index.where = where;
    expect(await Effect.runPromise(Effect.result(decodeCompiledDml(JSON.parse(JSON.stringify(input))))))
      .toMatchObject({ _tag: "Failure" });
  });
});
