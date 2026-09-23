import { Data, Effect, Result, Schema } from "effect";
import { logicalTableKey } from "flarex-protocol/internal/logical-schema-candidate";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { Json } from "flarex-protocol/json";
import type { FlarexMetadataDatabase } from "../deployments";
import { readLogicalStorageRequirements, LogicalStorageDefinitionError } from "../logicalStorageDefinitions";
import { prepareLogicalRelationalRowValues } from "./relationalRows";
import { chargeHostPreparation } from "../preparedHostRuntime";

export class LogicalRelationalValueError extends Data.TaggedError("LogicalRelationalValueError")<{
  readonly reason: "invalidTable" | "invalidDocument";
  readonly cause?: unknown;
}> {}
const decodeDocument = Schema.decodeUnknownResult(Schema.JsonObject);

/** Prepare immutable row-local validation from the authenticated source and
 * stable table binding. This is semantic validation, not a serving token;
 * callers must separately retain fresh admission and complete capabilities. */
export const prepareLogicalRelationalValueValidation = Effect.fn("LogicalRelationalValues.prepare")(function* (
  db: FlarexMetadataDatabase, deploymentId: string, schemaVersionId: CatalogSchemaVersionId,
) {
  const { evidence } = yield* readLogicalStorageRequirements(db, deploymentId, schemaVersionId);
  yield* chargeHostPreparation(JSON.stringify(evidence));
  const tables = new Map<CatalogTableId, ReturnType<typeof prepareLogicalRelationalRowValues<LogicalRelationalValueError>>>();
  for (const source of evidence.candidate.sources) {
    if (source.definition.kind !== "relational") continue;
    for (const table of source.definition.schema.tables) {
      const binding = source.bindings.find(value => value.kind === "definition" && value.localName === table.identity.tableId);
      const bound = binding === undefined ? undefined : evidence.tableBindings.find(value =>
        logicalTableKey(value.table) === logicalTableKey(binding.table));
      if (bound === undefined || tables.has(bound.tableId)) return yield* Effect.fail(new LogicalStorageDefinitionError({ reason: "incompleteBinding" }));
      tables.set(bound.tableId, prepareLogicalRelationalRowValues(table, source.definition.schema.capabilities,
        (_, cause) => new LogicalRelationalValueError({ reason: "invalidDocument", cause })));
    }
  }
  const validate = (tableId: CatalogTableId, document: CanonicalFlarexValueV1) => Result.gen(function* () {
    const table = tables.get(tableId);
    if (table === undefined) return yield* Result.fail(new LogicalRelationalValueError({ reason: "invalidTable" }));
    const value = yield* decodeDocument(document.value).pipe(Result.mapError(cause =>
      new LogicalRelationalValueError({ reason: "invalidDocument", cause })));
    const fields: Record<string, Json> = {};
    for (const [name, member] of Object.entries(value)) {
      if (name !== "_id" && name !== "_creationTime") Object.defineProperty(fields, name, { value: member, enumerable: true });
    }
    return yield* table(fields, "documentInvalid");
  });
  return Object.freeze({ validate });
});
