import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { decodeRelationalSchemaMetadata, normalizeRelationalSchema, relationalSchemaSourceFromDefinition } from "flarex-protocol/internal/relational-schema";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { compileProductDefinition } from "../src/modules/product/definition";
import { prepareLogicalRelationalRowValues } from "../../persistence-postgres/src/storage/documents/logicalDocuments/relationalRows";

it("decodes an authenticated Product row projection while retaining derived columns and exact row contracts", async () => {
  const { schema } = await Effect.runPromise(compileProductDefinition());
  const table = schema.tables.find(member => member.identity.tableId === "product");
  if (table === undefined) throw new Error("Missing native Product table");
  const projected = { ...schema, tables: [{ ...table, keys: table.keys.filter(key => key.kind === "primary"),
    indexes: [], constraints: table.constraints.filter(constraint => constraint.kind !== "foreignKey"), relationships: [] }],
    capabilities: schema.capabilities.filter(capability => capability.kind === "exactNumericCompanion" &&
      capability.numericColumn.tableId === table.identity.tableId) };
  const source = relationalSchemaSourceFromDefinition(JSON.parse(JSON.stringify(projected)));
  expect(Result.isFailure(normalizeRelationalSchema(source))).toBe(true);
  const decoded = Result.getOrThrow(decodeRelationalSchemaMetadata(source));
  expect(encodeCanonicalJson(decoded, () => { throw new Error("Invalid fixture JSON"); }))
    .toBe(encodeCanonicalJson(projected, () => { throw new Error("Invalid fixture JSON"); }));
  const selected = decoded.tables[0];
  if (selected === undefined) throw new Error("Missing selected Product table");
  expect(selected.columns).toEqual(table.columns);
  expect(selected.columns.some(column => column.origin.kind === "derived")).toBe(true);
  expect(selected.columns.some(column => column.origin.kind === "implicit")).toBe(true);
  expect(selected.constraints).toEqual(table.constraints.filter(constraint => constraint.kind !== "foreignKey"));
  const validate = prepareLogicalRelationalRowValues(selected, decoded.capabilities, reason => new Error(reason));
  expect(validate({ id: "product_a" }, "storedCorruption"))
    .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
  const badSource = relationalSchemaSourceFromDefinition({ ...projected, tables: [{ ...selected,
    columns: selected.columns.map((column, index) => index === 0 ? { ...column, type: "unrecognized" } : column) }] });
  expect(Result.isFailure(decodeRelationalSchemaMetadata(badSource))).toBe(true);
  expect(Result.isFailure(decodeRelationalSchemaMetadata({ owner: schema.coordinate.owner,
    lineageId: schema.coordinate.lineageId, tables: [], capabilities: [], unsupported: true }))).toBe(true);
});
