import { Effect } from "effect";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { model } from "@medusajs/utils/dml/model";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { decodeCompiledDml } from "../../src/schema/compiled";
import { lowerDmlSchema } from "../../src/schema/lower";

const Address = model.define("BooleanPartialAddress", {
  id: model.id().primaryKey(),
  parent_id: model.text(),
  selected: model.boolean().default(false),
}).indexes([
  { on: ["parent_id"], unique: true, where: '"selected" = true' },
  { on: ["selected", "id"], where: '"selected" = true' },
]);

export const compileBooleanPartialIndexDml = (): unknown =>
  JSON.parse(JSON.stringify(compileDmlSchema([Address])));

export const prepareBooleanPartialIndexSchema = Effect.fn("BooleanPartialIndexFixture.prepareSchema")(function* () {
  const checked = yield* decodeCompiledDml(compileBooleanPartialIndexDml());
  return yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(checked.tables, "boolean-partial-address")));
});
