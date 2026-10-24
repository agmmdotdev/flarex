import { Result } from "effect";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { fillEmptyToManyRelations } from "@medusajs/drizzle/relation-query";
import { formatScalarForeignKeyConstraintMessage, formatTextUniqueConstraintMessage } from "@medusajs/utils/dal/database-constraint";
import { formatRequiredPropertyMessage } from "@medusajs/utils/dal/required-validation";
import { inspectLogicalReferenceFailure, inspectLogicalRelationalFailure } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommerceTransactionError, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { jsonEqual } from "flarex-protocol/json";
import { lowerDmlSchema } from "../../schema/lower";
import type { compileTaxRegionCreationContracts } from "./region-create-input";
import type { makeTaxRegionCreationPlan } from "./region-create-plan";

type Contracts = Result.Result.Success<ReturnType<typeof compileTaxRegionCreationContracts>>;

/** Approved portable required-field diagnostic. One detached pending record is
 * public through both accessors; the private storage evidence remains owned. */
export class TaxCreationValidationError extends Error {
  override readonly name = "ValidationError";
  constructor(message: string, readonly entity: JsonObject) { super(message); }
  getEntity(): JsonObject { return this.entity; }
}

/** Approved portable CHECK diagnostic, separate from the SQL-bearing native
 * baseline. Integrated behavior remains a candidate pending validation. */
export class TaxCreationCheckConstraintError extends Error {
  override readonly name = "CheckConstraintViolationException";
  readonly code = "23514";
  readonly table = "tax_region";
  constructor(readonly constraint: "ck_tax_region_provider_top_level" | "ck_tax_region_country_top_level") {
    super('new row for relation "tax_region" violates check constraint "' + constraint + '"');
  }
}

/** Presentation consumes only the exact storage-issued failure while this
 * creation plan is flushing its authenticated model group. It never parses a
 * public cause or fabricates a SQL exception/detail. Original Causes and sticky
 * rollback remain with the existing Promise and request owners. */
export function prepareTaxRegionFailurePresentation(contracts: Contracts) {
  return Result.gen(function* () {
    const schema = yield* normalizeRelationalSchema(lowerDmlSchema(contracts.tables, "commerce.tax"));
    return (plan: ReturnType<typeof makeTaxRegionCreationPlan>) => (failure: CommerceTransactionError): Error | undefined => {
      const pending = plan.pendingFailure();
      if (pending === undefined) return undefined;
      const required = inspectLogicalRelationalFailure(failure);
      if (required !== undefined && (required.kind === "missing" || required.kind === "null")) {
        const table = schema.tables.find(table => jsonEqual(table.identity, required.table));
        const column = pending.table.columns.find(column => column.name === required.column && !column.nullable);
        const candidate = required.candidate;
        if (table?.identity.tableId !== pending.table.name || column === undefined || candidate === undefined ||
          !pending.plan.entities.some(row => row.id === candidate.id) ||
          required.kind === "null" && candidate[required.column] !== null ||
          required.kind === "missing" && Object.hasOwn(candidate, required.column)) return undefined;
        const entity = structuredClone(candidate);
        fillEmptyToManyRelations([entity], new Map(pending.table.relationships.map(relationship => [relationship.name, { relationship }])));
        return new TaxCreationValidationError(formatRequiredPropertyMessage(pending.model, column.name,
          required.kind === "null" ? null : undefined), entity);
      }
      if (required !== undefined && (required.kind === "check" || required.kind === "unique")) {
        const table = schema.tables.find(table => jsonEqual(table.identity, required.table));
        const candidate = required.candidate;
        if (table === undefined || table.identity.tableId !== pending.table.name || candidate === undefined ||
          typeof candidate.id !== "string" || !pending.plan.entities.some(row => row.id === candidate.id)) return undefined;
        if (required.kind === "check") {
          const constraint = table.constraints.find(constraint => jsonEqual(constraint.identity, required.constraint));
          if (required.origin !== "row" || pending.table !== contracts.region || constraint?.kind !== "nullImplication" ||
            constraint.requiredColumn.columnId !== required.column) return undefined;
          // Match only the two approved normalized DML identities. The storage
          // owner already rejected the CHECK; candidate predicates are not rerun.
          switch (constraint.identity.constraintId) {
            case "CK_tax_region_provider_top_level":
              return new TaxCreationCheckConstraintError("ck_tax_region_provider_top_level");
            case "CK_tax_region_country_top_level":
              return new TaxCreationCheckConstraintError("ck_tax_region_country_top_level");
            default: return undefined;
          }
        }
        const columns = required.columns, key = required.key;
        if (columns.length === 0 || columns.length !== required.values.length) return undefined;
        const values: string[] = [];
        for (const [index, column] of columns.entries()) {
          const value = required.values[index];
          if (typeof value !== "string" || candidate[column] !== value ||
            table.columns.find(declared => declared.identity.columnId === column)?.type !== "text") return undefined;
          values.push(value);
        }
        const declaredCohort = key.kind === "primary"
          ? required.origin === "input" && table.keys.some(declared => declared.kind === "primary" &&
            jsonEqual(declared.identity, key.identity) && jsonEqual(declared.columns.map(column => column.columnId), columns))
          : required.origin === "row" && (table.keys.some(declared => declared.kind === "unique" &&
            jsonEqual(declared.columns.map(column => column.columnId), columns)) ||
            table.indexes.some(declared => declared.kind === "uniqueBtree" &&
              jsonEqual(declared.columns.map(column => column.columnId), columns)));
        if (!declaredCohort) return undefined;
        // A Catalog unique definition ID stays opaque and authenticated by its
        // issuer. Matching a declared column cohort does not convert that ID
        // into a relational key/index identity or recheck its predicate.
        return new MedusaError(MedusaError.Types.INVALID_DATA,
          formatTextUniqueConstraintMessage(pending.table.name, columns, values));
      }
      const reference = inspectLogicalReferenceFailure(failure);
      if (reference?.origin !== "checkpoint" || reference.child.tableName !== pending.table.name ||
        !pending.table.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === reference.sourceColumn &&
          key.referencedTable === reference.target.tableName && key.referencedColumns.length === 1 &&
          key.referencedColumns[0] === reference.target.column) ||
        !pending.plan.entities.some(row => row[reference.sourceColumn] === reference.target.key)) return undefined;
      return new MedusaError(MedusaError.Types.NOT_FOUND,
        formatScalarForeignKeyConstraintMessage(reference.sourceColumn, reference.target.key));
    };
  });
}
