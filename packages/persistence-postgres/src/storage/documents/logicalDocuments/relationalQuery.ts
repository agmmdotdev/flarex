import { Result } from "effect";
import type { RelationalPersistenceCapability, RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import type { JsonObject } from "flarex-protocol/json";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { LogicalDocumentFailure } from "./model";
import { prepareLogicalRelationalRowValues, relationalTextIdentity, hasPreparedLogicalRelationalTableMechanics,
  inspectLogicalRelationalCanonicalRow, type PreparedLogicalRelationalTableMechanics } from "./relationalRows";
import { prepareRelationalRead, type RelationalReadAccess } from "../../../values/relationalQuery";
import { issuePostgresRelationalPredicate } from "./postgresRelationalPredicate";

export { relationalReadLimits, relationalSelectionValues as logicalRelationalSelectionValues } from "../../../values/relationalQuery";
export type { StorageInsertionOrder, RelationalReadAccess as LogicalRelationalReadAccess,
  RelationalReadDemand as LogicalRelationalReadDemand } from "../../../values/relationalQuery";

export function compileLogicalRelationalRead<Failure>(table: RelationalTableDefinition, capabilities: readonly RelationalPersistenceCapability[], input: unknown,
  pageRows: number, error: LogicalDocumentFailure<Failure>, mechanics?: PreparedLogicalRelationalTableMechanics, access?: RelationalReadAccess) {
  return prepareLogicalRelationalRead(table, capabilities, input, pageRows, error, mechanics)
    .pipe(Result.flatMap(prepared => prepared.compile(access)));
}

/** Retained execution authority wraps the shared value compiler. Canonical row
 * validation and PostgreSQL program issuance never enter the SQL-free owner. */
export function prepareLogicalRelationalRead<Failure>(sourceTable: RelationalTableDefinition, capabilities: readonly RelationalPersistenceCapability[], input: unknown,
  pageRows: number, error: LogicalDocumentFailure<Failure>, mechanics?: PreparedLogicalRelationalTableMechanics) {
  return Result.gen(function* () {
    if (mechanics !== undefined && !hasPreparedLogicalRelationalTableMechanics(mechanics, sourceTable))
      return yield* Result.fail(error("invalidAuthority"));
    const table = mechanics?.table ?? sourceTable;
    // Preserve the retained mechanics verdict before decoding the query.
    yield* mechanics === undefined ? relationalTextIdentity(table, error) :
      mechanics.identity.pipe(Result.mapError(cause => error(cause.reason, cause.cause)));
    const validate = mechanics === undefined ? prepareLogicalRelationalRowValues(table, capabilities, error) :
      (row: JsonObject, reason: "documentInvalid" | "storedCorruption") => mechanics.validate(row, reason)
        .pipe(Result.mapError(cause => error(cause.reason, cause.cause)));
    const prepared = yield* prepareRelationalRead(table, input, pageRows, error);
    // Issuance remains once, after the validated visit and before any deferred
    // access compilation. A pure AST never grants PostgreSQL execution.
    const postgresPredicate = prepared.postgresPredicate === undefined ? undefined : yield* issuePostgresRelationalPredicate(
      sourceTable, prepared.postgresPredicate, error);
    const validateRow = (row: JsonObject, document?: CanonicalFlarexValueV1) => Result.gen(function* () {
      const retained = mechanics === undefined || document === undefined ? undefined : yield* inspectLogicalRelationalCanonicalRow(
        mechanics, document, row, "storedCorruption").pipe(Result.mapError(cause => error(cause.reason, cause.cause)));
      if (retained === undefined) {
        const { _id: _internalId, _creationTime: _internalTime, ...native } = row;
        yield* validate(native, "storedCorruption");
      }
    });
    const compile = (access?: RelationalReadAccess) => prepared.compile(access).pipe(Result.map(program => {
      const { inspectOrder, ...compiled } = program;
      return Object.freeze({ ...compiled, postgresPredicate,
        inspectRow: (row: JsonObject, document?: CanonicalFlarexValueV1) => validateRow(row, document)
          .pipe(Result.flatMap(() => inspectOrder(row))),
        inspect: (row: JsonObject, document?: CanonicalFlarexValueV1) => postgresPredicate === undefined
          ? validateRow(row, document).pipe(Result.flatMap(() => program.inspect(row))) : Result.fail(error("invalidInput")),
      });
    }));
    return Object.freeze({ demand: prepared.demand, pointDemand: prepared.pointDemand, compile, predicate: prepared.predicate,
      complexity: prepared.complexity });
  });
}
