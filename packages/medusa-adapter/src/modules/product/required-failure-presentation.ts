import { Cause, Effect, Result } from "effect";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { upperCaseFirst } from "@medusajs/utils/common/upper-case-first";
import { inspectLogicalRelationalFailure } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CoreNativeDefinition } from "@flarex/persistence-postgres/internal/core";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import type { ProductRuntimeMetadata } from "./runtime-metadata";

/** Product's settled native boundary presents only one authenticated required
 * column refusal. Storage validation, original Causes and sticky rollback stay
 * with their existing owners; this transform runs after the root has ended. */
export function prepareProductRequiredFailurePresentation(input: {
  readonly metadata: ProductRuntimeMetadata;
  readonly definition: CoreNativeDefinition;
}) {
  const source = input.definition.source;
  if (source.owner !== "medusa" || source.key !== "medusa.product" || source.writeProfile !== "medusa.product" ||
    source.definition.kind !== "relational") return Result.fail(commerceError("invalidAuthority"));
  const schema = source.definition.schema;
  if (schema.tables.length !== input.metadata.tables.length || schema.tables.some(table =>
    !input.metadata.tables.some(known => known.name === table.identity.tableId))) return Result.fail(commerceError("invalidAuthority"));
  const requiredColumn = (failure: CommerceTransactionError) => {
    if (failure.reason !== "invalidInput") return undefined;
    const evidence = inspectLogicalRelationalFailure(failure);
    if (evidence === undefined || evidence.kind !== "missing" && evidence.kind !== "null" || evidence.candidate === undefined) return undefined;
    const table = schema.tables.find(table => jsonEqual(table.identity, evidence.table));
    const known = input.metadata.tables.find(known => known.name === table?.identity.tableId);
    if (table === undefined || known === undefined ||
      !table.columns.some(column => column.identity.columnId === evidence.column && !column.nullable) ||
      !known.columns.some(column => column.name === evidence.column && !column.nullable) ||
      (evidence.kind === "missing" ? Object.hasOwn(evidence.candidate, evidence.column) : evidence.candidate[evidence.column] !== null)) return undefined;
    return { table: known.name, column: evidence.column };
  };
  const present = <Value, Requirements>(work: Effect.Effect<Value, CommerceTransactionError, Requirements>) =>
    work.pipe(Effect.catchCause(cause => {
      let original: CommerceTransactionError | undefined;
      let required: ReturnType<typeof requiredColumn>;
      for (const reason of cause.reasons) {
        if (!Cause.isFailReason(reason)) return Effect.failCause(cause);
        if (reason.error.reason === "rollbackOnly") continue;
        if (original !== undefined && reason.error !== original) return Effect.failCause(cause);
        const selected = requiredColumn(reason.error);
        if (selected === undefined) return Effect.failCause(cause);
        original = reason.error;
        required = selected;
      }
      if (original === undefined || required === undefined) return Effect.failCause(cause);
      // The pinned PostgreSQL dbErrorMapper owns this required-column wording.
      // One presentation instance covers repeated references to the same error;
      // its cause retains the complete original failure, including annotations.
      const message = `Cannot set field '${required.column}' of ${upperCaseFirst(required.table.split("_").join(" "))} to null`;
      const native = new MedusaError(MedusaError.Types.INVALID_DATA, message, undefined, message, { cause });
      const projected = commerceError("adapterFailure", native);
      return Effect.failCause(Cause.map(cause, error => error === original ? projected : error));
    }));
  return Result.succeed(present);
}
