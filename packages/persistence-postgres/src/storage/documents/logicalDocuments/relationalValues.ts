import { Data, Effect, Result, Schema } from "effect";
import { logicalTableKey } from "flarex-protocol/internal/logical-schema-candidate";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { Json } from "flarex-protocol/json";
import type { FlarexMetadataDatabase } from "../../../application/deployments";
import { readLogicalStorageRequirements, requirePreparedLogicalStorageRequirements, LogicalStorageDefinitionError,
  type PreparedLogicalStorageRequirements } from "../../catalog/logicalStorageDefinitions";
import { prepareLogicalRelationalRowValues, hasPreparedLogicalRelationalTableMechanics,
  validateLogicalRelationalCanonicalRow, type PreparedLogicalRelationalTableMechanics } from "./relationalRows";
import { chargeHostPreparation } from "../../../execution/preparation/preparedHostRuntime";

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
  construction: Readonly<{ kind: "fresh" }> | Readonly<{ kind: "prepared"; requirements: PreparedLogicalStorageRequirements;
    tableMechanics: (tableId: CatalogTableId) => PreparedLogicalRelationalTableMechanics | undefined }>,
) {
  const { evidence } = yield* (construction.kind === "fresh" ? readLogicalStorageRequirements(db, deploymentId, schemaVersionId) :
    requirePreparedLogicalStorageRequirements(db, deploymentId, schemaVersionId, construction.requirements));
  if (construction.kind === "fresh") yield* chargeHostPreparation(JSON.stringify(evidence));
  const tables = new Map<CatalogTableId, ReturnType<typeof prepareLogicalRelationalRowValues<LogicalRelationalValueError>>>();
  const prepared = new Map<CatalogTableId, PreparedLogicalRelationalTableMechanics>();
  for (const source of evidence.candidate.sources) {
    if (source.definition.kind !== "relational") continue;
    for (const table of source.definition.schema.tables) {
      const binding = source.bindings.find(value => value.kind === "definition" && value.localName === table.identity.tableId);
      const bound = binding === undefined ? undefined : evidence.tableBindings.find(value =>
        logicalTableKey(value.table) === logicalTableKey(binding.table));
      if (bound === undefined || tables.has(bound.tableId)) return yield* Effect.fail(new LogicalStorageDefinitionError({ reason: "incompleteBinding" }));
      if (construction.kind === "fresh") tables.set(bound.tableId, prepareLogicalRelationalRowValues(table, source.definition.schema.capabilities,
        (_, cause) => new LogicalRelationalValueError({ reason: "invalidDocument", cause })));
      else {
        const mechanics = construction.tableMechanics(bound.tableId);
        if (mechanics === undefined || !hasPreparedLogicalRelationalTableMechanics(mechanics, table,
          source.definition.schema.capabilities))
          return yield* Effect.fail(new LogicalStorageDefinitionError({ reason: "incompleteBinding" }));
        tables.set(bound.tableId, (row, reason) => mechanics.validate(row, reason).pipe(Result.mapError(cause =>
          new LogicalRelationalValueError({ reason: "invalidDocument", cause: cause.cause }))));
        prepared.set(bound.tableId, mechanics);
      }
    }
  }
  const validate = (tableId: CatalogTableId, document: CanonicalFlarexValueV1) => Result.gen(function* () {
    const table = tables.get(tableId);
    if (table === undefined) return yield* Result.fail(new LogicalRelationalValueError({ reason: "invalidTable" }));
    const mechanics = prepared.get(tableId);
    if (mechanics !== undefined) return yield* validateLogicalRelationalCanonicalRow(mechanics, document, "documentInvalid")
      .pipe(Result.mapError(cause => new LogicalRelationalValueError({ reason: "invalidDocument", cause: cause.cause })));
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
